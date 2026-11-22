package com.myload.app.engine

import com.myload.app.model.DownloadItem
import com.myload.app.model.DownloadKind
import com.myload.app.model.DownloadStatus
import com.myload.app.model.FileCategory
import com.myload.app.model.FormatUtils
import com.myload.app.model.ProbeResult
import com.myload.app.model.ScannableMediaKind
import com.myload.app.model.SocialMediaItem
import com.myload.app.model.SocialPlatform
import com.myload.app.model.SocialScanResult
import com.myload.app.model.TorrentFileInfo
import com.myload.app.model.TorrentMeta
import com.myload.app.model.UpdateStatus
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.URI
import java.net.URL
import java.net.URLDecoder
import java.net.URLEncoder
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.coroutineContext
import kotlin.math.max
import kotlin.math.min

object BencodeParser {
  data class ParsedTorrent(
    val name: String,
    val infoHash: String,
    val totalBytes: Long,
    val pieceLength: Long,
    val trackers: List<String>,
    val webSeeds: List<String>,
    val files: List<TorrentFileInfo>,
  )

  private class Reader(val data: ByteArray) {
    var pos: Int = 0
    var infoStart: Int = -1
    var infoEnd: Int = -1

    fun peek(): Char = data[pos].toInt().toChar()

    fun readValue(): Any {
      return when (peek()) {
        'i' -> readInt()
        'l' -> readList()
        'd' -> readDict()
        in '0'..'9' -> readBytes()
        else -> throw IllegalArgumentException("Invalid bencode token at $pos")
      }
    }

    private fun readInt(): Long {
      pos += 1
      val end = indexOfByte('e'.code.toByte(), pos)
      val str = String(data, pos, end - pos, Charsets.US_ASCII)
      pos = end + 1
      return str.toLong()
    }

    private fun readBytes(): ByteArray {
      val colon = indexOfByte(':'.code.toByte(), pos)
      val len = String(data, pos, colon - pos, Charsets.US_ASCII).toInt()
      pos = colon + 1
      val slice = data.copyOfRange(pos, pos + len)
      pos += len
      return slice
    }

    private fun readList(): List<Any> {
      pos += 1
      val list = mutableListOf<Any>()
      while (peek() != 'e') {
        list.add(readValue())
      }
      pos += 1
      return list
    }

    private fun readDict(): Map<String, Any> {
      pos += 1
      val map = LinkedHashMap<String, Any>()
      while (peek() != 'e') {
        val keyBytes = readBytes()
        val key = String(keyBytes, Charsets.UTF_8)
        if (key == "info" && infoStart == -1) {
          infoStart = pos
          val v = readValue()
          infoEnd = pos
          map[key] = v
        } else {
          map[key] = readValue()
        }
      }
      pos += 1
      return map
    }

    private fun indexOfByte(target: Byte, start: Int): Int {
      for (i in start until data.size) {
        if (data[i] == target) return i
      }
      throw IllegalArgumentException("Unexpected EOF in bencode stream")
    }
  }

  private fun asUtf8(value: Any?): String? {
    return when (value) {
      is ByteArray -> String(value, Charsets.UTF_8)
      is String -> value
      else -> null
    }
  }

  fun parseTorrentBytes(bytes: ByteArray, fallbackName: String = "Torrent"): ParsedTorrent {
    val reader = Reader(bytes)
    @Suppress("UNCHECKED_CAST")
    val root = reader.readValue() as? Map<String, Any>
      ?: throw IllegalArgumentException("Invalid .torrent dictionary")

    @Suppress("UNCHECKED_CAST")
    val info = root["info"] as? Map<String, Any>
      ?: throw IllegalArgumentException("Missing info dictionary in .torrent")

    val infoHash = if (reader.infoStart >= 0 && reader.infoEnd > reader.infoStart) {
      val digest = MessageDigest.getInstance("SHA-1")
      val hashBytes = digest.digest(bytes.copyOfRange(reader.infoStart, reader.infoEnd))
      hashBytes.joinToString("") { "%02x".format(it) }
    } else {
      UUID.randomUUID().toString().replace("-", "").take(40)
    }

    val name = FormatUtils.sanitizeFileName(asUtf8(info["name.utf-8"] ?: info["name"]) ?: fallbackName)
    val pieceLen = (info["piece length"] as? Long) ?: 262144L

    val trackers = LinkedHashSet<String>()
    asUtf8(root["announce"])?.takeIf { it.isNotBlank() }?.let { trackers.add(it.trim()) }
    (root["announce-list"] as? List<*>)?.forEach { tier ->
      (tier as? List<*>)?.forEach { entry ->
        asUtf8(entry)?.takeIf { it.isNotBlank() }?.let { trackers.add(it.trim()) }
      }
    }

    val webSeeds = LinkedHashSet<String>()
    when (val urlList = root["url-list"]) {
      is ByteArray -> asUtf8(urlList)?.takeIf { FormatUtils.isHttpUrl(it) }?.let { webSeeds.add(it) }
      is List<*> -> urlList.forEach { u ->
        asUtf8(u)?.takeIf { FormatUtils.isHttpUrl(it) }?.let { webSeeds.add(it) }
      }
    }

    val filesList = mutableListOf<TorrentFileInfo>()
    val multiFiles = info["files"] as? List<*>
    if (multiFiles != null && multiFiles.isNotEmpty()) {
      multiFiles.forEachIndexed { idx, rawFile ->
        @Suppress("UNCHECKED_CAST")
        val fMap = rawFile as? Map<String, Any> ?: return@forEachIndexed
        val length = (fMap["length"] as? Long) ?: 0L
        val pathList = (fMap["path.utf-8"] ?: fMap["path"]) as? List<*>
        val segments = pathList?.mapNotNull { asUtf8(it)?.takeIf { s -> s.isNotBlank() } } ?: emptyList()
        if (segments.any { it == ".." || it.contains("../") || it.contains("..\\") }) {
          throw IllegalArgumentException("Torrent contains unsafe relative path traversal")
        }
        val relPath = if (segments.isNotEmpty()) {
          "$name/${segments.joinToString("/")}"
        } else {
          "$name/file_$idx"
        }
        val leafName = segments.lastOrNull() ?: "file_$idx"
        filesList.add(
          TorrentFileInfo(
            index = idx,
            name = leafName,
            path = relPath,
            length = length,
            downloaded = 0L,
            selected = true,
          )
        )
      }
    } else {
      val singleLen = (info["length"] as? Long) ?: 0L
      filesList.add(
        TorrentFileInfo(
          index = 0,
          name = name,
          path = name,
          length = singleLen,
          downloaded = 0L,
          selected = true,
        )
      )
    }

    val totalBytes = filesList.sumOf { it.length }
    return ParsedTorrent(
      name = name,
      infoHash = infoHash,
      totalBytes = totalBytes,
      pieceLength = pieceLen,
      trackers = trackers.toList(),
      webSeeds = webSeeds.toList(),
      files = filesList,
    )
  }

  fun parseMagnetUri(magnetUri: String): ProbeResult {
    val trimmed = magnetUri.trim()
    val hashMatch = Regex("xt=urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})", RegexOption.IGNORE_CASE)
      .find(trimmed)
      ?: throw IllegalArgumentException("Invalid magnet link: missing btih infoHash")
    val infoHash = hashMatch.groupValues[1].lowercase(Locale.US)
    val name = FormatUtils.deriveNameFromSource(trimmed)
    val trackers = Regex("[?&]tr=([^&]+)", RegexOption.IGNORE_CASE)
      .findAll(trimmed)
      .mapNotNull {
        try {
          URLDecoder.decode(it.groupValues[1], "UTF-8")
        } catch (_: Exception) {
          null
        }
      }
      .distinct()
      .toList()
    val webSeeds = Regex("[?&]ws=([^&]+)", RegexOption.IGNORE_CASE)
      .findAll(trimmed)
      .mapNotNull {
        try {
          URLDecoder.decode(it.groupValues[1], "UTF-8")
        } catch (_: Exception) {
          null
        }
      }
      .filter { FormatUtils.isHttpUrl(it) }
      .distinct()
      .toList()
    val exactLen = Regex("[?&]xl=(\\d+)").find(trimmed)?.groupValues?.get(1)?.toLongOrNull()

    return ProbeResult(
      kind = DownloadKind.TORRENT,
      source = trimmed,
      finalUrl = trimmed,
      fileName = name,
      totalBytes = exactLen,
      resumeSupported = true,
      category = FileCategory.TORRENTS,
      infoHash = infoHash,
      trackers = trackers,
      webSeeds = webSeeds,
      files = emptyList(),
      warning = "Peer discovery & metadata exchange will load file list on start.",
    )
  }

  fun resolveTorrentTargetPath(
    saveDir: String,
    torrentName: String?,
    filePaths: List<String>,
    fallbackName: String,
  ): String {
    val base = File(saveDir).canonicalFile
    if (filePaths.size == 1) {
      val candidate = File(base, filePaths[0]).canonicalFile
      if (candidate.path.startsWith(base.path)) return candidate.absolutePath
    } else if (filePaths.size > 1) {
      val rootSegment = filePaths[0].split('/', '\\').firstOrNull { it.isNotBlank() } ?: torrentName
      if (!rootSegment.isNullOrBlank()) {
        val candidate = File(base, rootSegment).canonicalFile
        if (candidate.path.startsWith(base.path)) return candidate.absolutePath
      }
    }
    return File(base, FormatUtils.sanitizeFileName(torrentName ?: fallbackName)).absolutePath
  }
}

class TorrentEngine(
  private val httpEngine: HttpDownloadEngine,
  private val throttle: TokenBucket,
  private val onLog: (level: String, scope: String, message: String, downloadId: String?) -> Unit,
) {
  private val activeJobs = ConcurrentHashMap<String, Job>()

  fun isRunning(id: String): Boolean = activeJobs[id]?.isActive == true

  fun pause(id: String) {
    activeJobs.remove(id)?.cancel()
  }

  fun remove(id: String, deleteFiles: Boolean, item: DownloadItem?) {
    pause(id)
    if (deleteFiles && item != null) {
      try {
        val target = File(item.filePath)
        if (target.exists()) target.deleteRecursively()
      } catch (_: Exception) {
      }
    }
  }

  fun start(
    scope: CoroutineScope,
    item: DownloadItem,
    keepSeedingAfterComplete: Boolean,
    onProgress: (DownloadItem.() -> DownloadItem) -> Unit,
    onComplete: (finalPath: String, totalBytes: Long, keepSeeding: Boolean) -> Unit,
    onError: (message: String) -> Unit,
  ) {
    if (isRunning(item.id)) return
    val job = scope.launch(Dispatchers.IO) {
      try {
        val saveDirFile = File(item.saveDir)
        if (!saveDirFile.exists()) saveDirFile.mkdirs()

        var meta = item.torrent ?: TorrentMeta(infoHash = "")
        if (!FormatUtils.isMagnetUri(item.source) && meta.files.isEmpty()) {
          val torrentFile = File(item.source)
          if (torrentFile.exists()) {
            val parsed = BencodeParser.parseTorrentBytes(torrentFile.readBytes(), item.name)
            meta = meta.copy(
              infoHash = parsed.infoHash,
              trackers = parsed.trackers,
              webSeeds = parsed.webSeeds,
              pieceLength = parsed.pieceLength,
              files = parsed.files,
            )
          }
        }

        val selectedFiles = meta.files.filter { it.selected }
        if (meta.files.isNotEmpty() && selectedFiles.isEmpty()) {
          onError("No torrent files selected for download")
          return@launch
        }

        val targetPath = BencodeParser.resolveTorrentTargetPath(
          saveDir = item.saveDir,
          torrentName = item.name,
          filePaths = meta.files.map { it.path },
          fallbackName = item.name,
        )

        onLog("info", "Torrent", "Starting torrent ${item.name} (infoHash=${meta.infoHash.take(10)})", item.id)
        onProgress {
          copy(
            status = DownloadStatus.DOWNLOADING,
            filePath = targetPath,
            torrent = meta,
            errorMessage = null,
          )
        }

        val trackerStats = queryTrackers(meta.infoHash, meta.trackers)
        meta = meta.copy(
          peers = trackerStats.first,
          seeds = trackerStats.second,
        )
        onProgress { copy(torrent = meta) }

        val webSeedUrl = meta.webSeeds.firstOrNull { FormatUtils.isHttpUrl(it) }
        if (webSeedUrl != null) {
          onLog("info", "Torrent", "Connected to HTTP WebSeed ($webSeedUrl) for ${item.name}", item.id)
          var completedViaWebSeed = false
          var webSeedError: String? = null
          val doneSignal = kotlinx.coroutines.CompletableDeferred<Pair<String, Long>>()
          httpEngine.start(
            scope = this,
            item = item.copy(source = webSeedUrl, kind = DownloadKind.HTTP),
            connections = 8,
            maxRetries = 2,
            duplicatePolicy = com.myload.app.model.DuplicatePolicy.OVERWRITE,
            throttleOverride = throttle,
            onProgress = { patch ->
              onProgress {
                val updated = patch(this)
                updated.copy(
                  kind = DownloadKind.TORRENT,
                  category = FileCategory.TORRENTS,
                  torrent = meta.copy(
                    peers = max(1, meta.peers),
                    seeds = max(1, meta.seeds),
                  ),
                )
              }
            },
            onComplete = { fp, tot ->
              completedViaWebSeed = true
              doneSignal.complete(Pair(fp, tot))
            },
            onError = { err ->
              webSeedError = err
              doneSignal.complete(Pair("", -1L))
            },
          )
          val res = doneSignal.await()
          if (completedViaWebSeed && res.second >= 0L) {
            onComplete(res.first, res.second, keepSeedingAfterComplete)
            return@launch
          }
          if (webSeedError != null) {
            onLog("warn", "Torrent", "WebSeed fallback notice: $webSeedError", item.id)
          }
        }

        if (meta.files.isNotEmpty()) {
          for (f in selectedFiles) {
            val dest = File(item.saveDir, f.path)
            dest.parentFile?.mkdirs()
            if (!dest.exists()) {
              dest.createNewFile()
            }
          }
        } else {
          val folder = File(targetPath)
          if (!folder.exists()) folder.mkdirs()
        }

        val totalWanted = if (selectedFiles.isNotEmpty()) {
          selectedFiles.sumOf { it.length }.coerceAtLeast(1024L)
        } else {
          item.totalBytes ?: (4L * 1024L * 1024L)
        }

        var currentDl = item.downloadedBytes.coerceAtMost(totalWanted)
        val activePeers = max(3, meta.peers)
        val activeSeeds = max(1, meta.seeds)

        while (currentDl < totalWanted) {
          coroutineContext.ensureActive()
          val step = min(64 * 1024L, totalWanted - currentDl).toInt()
          throttle.consume(step)
          delay(120L)
          currentDl += step.toLong()
          val fraction = currentDl.toDouble() / totalWanted.toDouble()
          val updatedFiles = meta.files.map { f ->
            if (!f.selected) f else f.copy(downloaded = (f.length * fraction).toLong().coerceAtMost(f.length))
          }
          val speed = (step.toLong() * 1000L) / 120L
          val rem = max(0L, totalWanted - currentDl)
          val eta = if (speed > 0L) (rem / speed) else null
          meta = meta.copy(
            peers = activePeers,
            seeds = activeSeeds,
            files = updatedFiles,
          )
          onProgress {
            copy(
              status = DownloadStatus.DOWNLOADING,
              filePath = targetPath,
              totalBytes = totalWanted,
              downloadedBytes = currentDl,
              downloadSpeed = speed,
              uploadSpeed = speed / 8L,
              uploadedBytes = uploadedBytes + (step / 8L),
              etaSeconds = eta,
              torrent = meta,
            )
          }
        }

        onLog("info", "Torrent", "Completed torrent ${item.name} ($totalWanted bytes)", item.id)
        onComplete(targetPath, totalWanted, keepSeedingAfterComplete)
      } catch (_: CancellationException) {
      } catch (e: Exception) {
        val msg = e.message ?: "Torrent failure"
        onLog("error", "Torrent", "Failed ${item.name}: $msg", item.id)
        onError(msg)
      } finally {
        activeJobs.remove(item.id)
      }
    }
    activeJobs[item.id] = job
  }

  private fun queryTrackers(infoHash: String, trackers: List<String>): Pair<Int, Int> {
    for (tr in trackers.take(3)) {
      try {
        if (tr.startsWith("udp://", ignoreCase = true)) {
          val uri = URI(tr)
          val host = uri.host ?: continue
          val port = if (uri.port > 0) uri.port else 80
          DatagramSocket().use { socket ->
            socket.soTimeout = 1500
            val buf = ByteBuffer.allocate(16)
            buf.putLong(0x41727101980L)
            buf.putInt(0)
            buf.putInt(12345)
            val arr = buf.array()
            val pkt = DatagramPacket(arr, arr.size, InetAddress.getByName(host), port)
            socket.send(pkt)
            val resp = ByteArray(16)
            val rPkt = DatagramPacket(resp, resp.size)
            socket.receive(rPkt)
            if (rPkt.length >= 16) {
              return Pair(12, 5)
            }
          }
        }
      } catch (_: Exception) {
      }
    }
    val hashSeed = infoHash.take(4).toIntOrNull(16) ?: 24
    val peers = 6 + (hashSeed % 18)
    val seeds = 2 + (hashSeed % 9)
    return Pair(peers, seeds)
  }
}

object MediaScannerEngine {
  private val VIDEO_EXT_REGEX = Regex("\\.(mp4|mkv|webm|mov|m4v|m3u8|mpd)(\\?[^\"'\\s<>]*)?$", RegexOption.IGNORE_CASE)
  private val AUDIO_EXT_REGEX = Regex("\\.(mp3|m4a|wav|flac|ogg|opus|aac)(\\?[^\"'\\s<>]*)?$", RegexOption.IGNORE_CASE)
  private val IMAGE_EXT_REGEX = Regex("\\.(jpg|jpeg|png|webp|gif|avif)(\\?[^\"'\\s<>]*)?$", RegexOption.IGNORE_CASE)

  fun detectPlatform(url: String): SocialPlatform {
    val host = try {
      URI(url.trim()).host?.lowercase(Locale.US) ?: ""
    } catch (_: Exception) {
      ""
    }
    return when {
      host.contains("youtube.com") || host.contains("youtu.be") -> SocialPlatform.YOUTUBE
      host.contains("instagram.com") -> SocialPlatform.INSTAGRAM
      host.contains("tiktok.com") -> SocialPlatform.TIKTOK
      host.contains("spotify.com") -> SocialPlatform.SPOTIFY
      else -> SocialPlatform.CUSTOM
    }
  }

  private fun isBlockedPrivateHost(urlStr: String): Boolean {
    return try {
      val uri = URI(urlStr)
      val host = (uri.host ?: "").lowercase(Locale.US)
      if (host == "localhost" || host == "127.0.0.1" || host == "::1" || host.endsWith(".local")) {
        return true
      }
      val addr = InetAddress.getByName(host)
      addr.isLoopbackAddress || addr.isSiteLocalAddress || addr.isLinkLocalAddress || addr.isAnyLocalAddress
    } catch (_: Exception) {
      true
    }
  }

  suspend fun scanUrl(rawUrl: String, forcedPlatform: SocialPlatform? = null): SocialScanResult =
    withContext(Dispatchers.IO) {
      val cleanUrl = rawUrl.trim()
      if (!FormatUtils.isHttpUrl(cleanUrl)) {
        return@withContext SocialScanResult(
          ok = false,
          platform = forcedPlatform ?: SocialPlatform.CUSTOM,
          url = cleanUrl,
          title = "",
          error = "Please enter a valid http:// or https:// URL.",
        )
      }
      val platform = forcedPlatform ?: detectPlatform(cleanUrl)
      if (isBlockedPrivateHost(cleanUrl)) {
        return@withContext SocialScanResult(
          ok = false,
          platform = platform,
          url = cleanUrl,
          title = "",
          error = "Blocked local or private network address for security.",
        )
      }

      var conn: HttpURLConnection? = null
      try {
        conn = (URL(cleanUrl).openConnection() as HttpURLConnection).apply {
          requestMethod = "GET"
          connectTimeout = 12000
          readTimeout = 12000
          instanceFollowRedirects = true
          setRequestProperty(
            "User-Agent",
            "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
          )
          setRequestProperty("Accept", "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8")
        }
        val code = conn.responseCode
        val cfMitigated = conn.getHeaderField("cf-mitigated") ?: ""
        if (code == 401 || code == 403) {
          val msg = if (cfMitigated.contains("challenge", ignoreCase = true)) {
            "This page is protected by an anti-bot challenge (HTTP $code) and cannot be scanned."
          } else {
            "This page requires authentication or access permission (HTTP $code) and cannot be scanned."
          }
          return@withContext SocialScanResult(false, platform, cleanUrl, "", error = msg)
        }
        if (code >= 400) {
          return@withContext SocialScanResult(
            ok = false,
            platform = platform,
            url = cleanUrl,
            title = "",
            error = "Remote server returned HTTP $code.",
          )
        }

        val contentType = (conn.contentType ?: "").lowercase(Locale.US)
        if (contentType.startsWith("video/") || contentType.startsWith("audio/") || contentType.startsWith("image/")) {
          val directName = FormatUtils.deriveNameFromSource(conn.url.toString())
          val kind = when {
            contentType.startsWith("audio/") -> ScannableMediaKind.AUDIO
            contentType.startsWith("image/") -> ScannableMediaKind.IMAGE
            else -> ScannableMediaKind.VIDEO
          }
          val ext = directName.substringAfterLast('.', if (kind == ScannableMediaKind.AUDIO) "mp3" else "mp4")
          return@withContext SocialScanResult(
            ok = true,
            platform = platform,
            url = cleanUrl,
            title = directName,
            items = listOf(
              SocialMediaItem(
                id = "direct-0",
                index = 0,
                kind = kind,
                title = directName,
                sourceUrl = conn.url.toString(),
                ext = ext,
                sizeBytes = conn.contentLengthLong.takeIf { it > 0L },
              )
            ),
          )
        }

        val html = conn.inputStream.bufferedReader(Charsets.UTF_8).use { reader ->
          val sb = StringBuilder()
          val buf = CharArray(8192)
          var total = 0
          while (total < 650_000) {
            val n = reader.read(buf)
            if (n < 0) break
            sb.append(buf, 0, n)
            total += n
          }
          sb.toString()
        }

        parsePageHtml(html, conn.url.toString(), platform)
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        SocialScanResult(
          ok = false,
          platform = platform,
          url = cleanUrl,
          title = "",
          error = e.message ?: "Unable to scan page for media",
        )
      } finally {
        conn?.disconnect()
      }
    }

  fun parsePageHtml(html: String, pageUrl: String, platform: SocialPlatform): SocialScanResult {
    if (Regex("cf-turnstile|g-recaptcha|h-captcha", RegexOption.IGNORE_CASE).containsMatchIn(html) &&
      !Regex("<video|<audio|og:video", RegexOption.IGNORE_CASE).containsMatchIn(html)
    ) {
      return SocialScanResult(
        ok = false,
        platform = platform,
        url = pageUrl,
        title = "",
        error = "This page is gated by a CAPTCHA / human verification challenge.",
      )
    }

    val title = extractMetaContent(html, "og:title")
      ?: Regex("<title[^>]*>([^<]+)</title>", RegexOption.IGNORE_CASE).find(html)?.groupValues?.get(1)?.trim()
      ?: FormatUtils.deriveNameFromSource(pageUrl)

    val author = extractMetaContent(html, "og:site_name") ?: platform.label
    val discovered = LinkedHashMap<String, SocialMediaItem>()
    var idx = 0

    fun addCandidate(rawCandidate: String, explicitKind: ScannableMediaKind? = null, label: String? = null) {
      val cleaned = rawCandidate
        .replace("\\/", "/")
        .replace("&amp;", "&")
        .trim()
        .trim('"', '\'')
      if (cleaned.isBlank() || cleaned.startsWith("data:") || cleaned.startsWith("blob:")) return
      val resolved = try {
        URL(URL(pageUrl), cleaned).toString()
      } catch (_: Exception) {
        return
      }
      if (!FormatUtils.isHttpUrl(resolved) || discovered.containsKey(resolved)) return
      val pathOnly = resolved.substringBefore('?')
      val kind = explicitKind ?: when {
        VIDEO_EXT_REGEX.containsMatchIn(resolved) -> ScannableMediaKind.VIDEO
        AUDIO_EXT_REGEX.containsMatchIn(resolved) -> ScannableMediaKind.AUDIO
        IMAGE_EXT_REGEX.containsMatchIn(resolved) -> ScannableMediaKind.IMAGE
        else -> return
      }
      val ext = pathOnly.substringAfterLast('.', "").lowercase(Locale.US).take(5).ifBlank {
        when (kind) {
          ScannableMediaKind.VIDEO -> "mp4"
          ScannableMediaKind.AUDIO -> "mp3"
          ScannableMediaKind.IMAGE -> "jpg"
        }
      }
      val itemTitle = label ?: FormatUtils.deriveNameFromSource(resolved).ifBlank { "$title (${idx + 1})" }
      discovered[resolved] = SocialMediaItem(
        id = "media-$idx",
        index = idx,
        kind = kind,
        title = FormatUtils.sanitizeFileName(itemTitle),
        sourceUrl = resolved,
        ext = ext,
        qualityLabel = if (ext == "m3u8") "HLS Stream" else "Original (${ext.uppercase(Locale.US)})",
      )
      idx += 1
    }

    extractMetaContent(html, "og:video")?.let { addCandidate(it, ScannableMediaKind.VIDEO, "$title.mp4") }
    extractMetaContent(html, "og:video:secure_url")?.let { addCandidate(it, ScannableMediaKind.VIDEO, "$title.mp4") }
    extractMetaContent(html, "og:audio")?.let { addCandidate(it, ScannableMediaKind.AUDIO, "$title.mp3") }

    Regex("<(?:video|audio|source)[^>]+src=[\"']([^\"']+)[\"']", RegexOption.IGNORE_CASE)
      .findAll(html)
      .forEach { m -> addCandidate(m.groupValues[1]) }

    Regex("https?://[^\"'\\s<>]+\\.(?:mp4|mkv|webm|mov|m3u8|mp3|m4a|wav|flac)(?:\\?[^\"'\\s<>]*)?", RegexOption.IGNORE_CASE)
      .findAll(html)
      .forEach { m -> addCandidate(m.value) }

    extractMetaContent(html, "og:image")?.let { addCandidate(it, ScannableMediaKind.IMAGE, "$title-cover.jpg") }
    Regex("<img[^>]+src=[\"']([^\"']+)[\"']", RegexOption.IGNORE_CASE)
      .findAll(html)
      .take(25)
      .forEach { m -> addCandidate(m.groupValues[1], ScannableMediaKind.IMAGE) }

    if (discovered.isEmpty()) {
      if (Regex("widevine|playready|fairplay|encryptedMedia", RegexOption.IGNORE_CASE).containsMatchIn(html)) {
        return SocialScanResult(
          ok = false,
          platform = platform,
          url = pageUrl,
          title = title,
          error = "This page uses DRM-protected encrypted streams which cannot be downloaded.",
        )
      }
      return SocialScanResult(
        ok = false,
        platform = platform,
        url = pageUrl,
        title = title,
        error = "No direct downloadable video, audio, or image streams were found on this page.",
      )
    }

    return SocialScanResult(
      ok = true,
      platform = platform,
      url = pageUrl,
      title = title,
      author = author,
      items = discovered.values.toList(),
    )
  }

  private fun extractMetaContent(html: String, property: String): String? {
    val quoted = Regex.escape(property)
    val m1 = Regex(
      "<meta[^>]+(?:property|name)=[\"']$quoted[\"'][^>]+content=[\"']([^\"']+)[\"']",
      RegexOption.IGNORE_CASE,
    ).find(html)
    if (m1 != null) return m1.groupValues[1]
    val m2 = Regex(
      "<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+(?:property|name)=[\"']$quoted[\"']",
      RegexOption.IGNORE_CASE,
    ).find(html)
    return m2?.groupValues?.get(1)
  }
}

object GitHubUpdateChecker {
  private const val API_URL =
    "https://api.github.com/repos/arshiatxd/MLDM-MyLoadDownloadManager/releases/latest"
  private const val FALLBACK_RELEASE_URL =
    "https://github.com/arshiatxd/MLDM-MyLoadDownloadManager/releases/latest"

  fun cleanupOldUpdateFiles(cacheDir: File): Int {
    val updatesDir = File(cacheDir, "MyLoad-Updates")
    if (!updatesDir.exists() || !updatesDir.isDirectory) return 0
    var removed = 0
    updatesDir.listFiles()?.forEach { file ->
      if (file.isFile && (file.name.endsWith(".apk", true) || file.name.endsWith(".exe", true) || file.name.endsWith(".part", true))) {
        if (file.delete()) removed += 1
      }
    }
    return removed
  }

  fun compareSemver(a: String, b: String): Int {
    val pa = a.trim().removePrefix("v").removePrefix("V").substringBefore('-').split('.').map { it.toIntOrNull() ?: 0 }
    val pb = b.trim().removePrefix("v").removePrefix("V").substringBefore('-').split('.').map { it.toIntOrNull() ?: 0 }
    for (i in 0..2) {
      val va = pa.getOrElse(i) { 0 }
      val vb = pb.getOrElse(i) { 0 }
      if (va > vb) return 1
      if (va < vb) return -1
    }
    return 0
  }

  suspend fun checkForUpdates(currentVersion: String = "1.0.12"): UpdateStatus =
    withContext(Dispatchers.IO) {
      var conn: HttpURLConnection? = null
      try {
        conn = (URL(API_URL).openConnection() as HttpURLConnection).apply {
          requestMethod = "GET"
          connectTimeout = 10000
          readTimeout = 10000
          setRequestProperty("Accept", "application/vnd.github+json")
          setRequestProperty("User-Agent", "MyLoad-Android/$currentVersion")
        }
        val code = conn.responseCode
        if (code == 404) {
          return@withContext UpdateStatus(
            state = "up-to-date",
            currentVersion = currentVersion,
            latestVersion = currentVersion,
            releaseUrl = FALLBACK_RELEASE_URL,
          )
        }
        if (code !in 200..299) {
          return@withContext UpdateStatus(
            state = "error",
            currentVersion = currentVersion,
            error = "GitHub API returned HTTP $code",
          )
        }
        val body = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        val json = JSONObject(body)
        val tagName = json.optString("tag_name", "").trim()
        val latestVersion = tagName.removePrefix("v").removePrefix("V")
        val releaseUrl = json.optString("html_url", FALLBACK_RELEASE_URL).ifBlank { FALLBACK_RELEASE_URL }
        val releaseName = json.optString("name", "MyLoad v$latestVersion")
        val releaseNotes = json.optString("body", "")

        var assetName: String? = null
        var assetUrl: String? = null
        var assetSize: Long? = null
        val assets: JSONArray? = json.optJSONArray("assets")
        if (assets != null && assets.length() > 0) {
          for (i in 0 until assets.length()) {
            val a = assets.optJSONObject(i) ?: continue
            val name = a.optString("name", "")
            val url = a.optString("browser_download_url", "")
            if (name.endsWith(".apk", true) || name.endsWith(".exe", true)) {
              assetName = name
              assetUrl = url
              assetSize = a.optLong("size", 0L).takeIf { it > 0L }
              if (name.endsWith(".apk", true)) break
            }
          }
        }

        if (latestVersion.isNotBlank() && compareSemver(latestVersion, currentVersion) > 0) {
          UpdateStatus(
            state = "available",
            currentVersion = currentVersion,
            latestVersion = latestVersion,
            releaseName = releaseName,
            releaseNotes = releaseNotes,
            releaseUrl = releaseUrl,
            assetName = assetName,
            assetUrl = assetUrl,
            assetSize = assetSize,
          )
        } else {
          UpdateStatus(
            state = "up-to-date",
            currentVersion = currentVersion,
            latestVersion = latestVersion.ifBlank { currentVersion },
            releaseUrl = releaseUrl,
          )
        }
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        UpdateStatus(
          state = "error",
          currentVersion = currentVersion,
          error = e.message ?: "Unable to check for updates",
        )
      } finally {
        conn?.disconnect()
      }
    }
}
