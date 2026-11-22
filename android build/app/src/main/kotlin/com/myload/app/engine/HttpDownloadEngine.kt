package com.myload.app.engine

import com.myload.app.model.DownloadItem
import com.myload.app.model.DownloadKind
import com.myload.app.model.DownloadStatus
import com.myload.app.model.DuplicatePolicy
import com.myload.app.model.FormatUtils
import com.myload.app.model.ProbeResult
import com.myload.app.model.SegmentInfo
import com.myload.app.model.SegmentStatus
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.net.URLDecoder
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.coroutineContext
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToLong

class HttpDownloadEngine(
  private val globalThrottle: TokenBucket,
  private val onLog: (level: String, scope: String, message: String, downloadId: String?) -> Unit,
) {
  companion object {
    private const val MAX_REDIRECTS = 10
    private const val CONNECT_TIMEOUT_MS = 18000
    private const val READ_TIMEOUT_MS = 20000
    private const val WRITE_BUFFER_BYTES = 128 * 1024
    private const val WRITE_FLUSH_INTERVAL_MS = 120L
    private const val MAX_CONNECTIONS = 32
    private const val USER_AGENT = "MyLoad/1.0.12 (Android; Multi-Segment Download Manager)"

    private val MIME_EXTENSIONS = mapOf(
      "image/jpeg" to ".jpg",
      "image/png" to ".png",
      "image/gif" to ".gif",
      "image/webp" to ".webp",
      "image/svg+xml" to ".svg",
      "application/pdf" to ".pdf",
      "application/zip" to ".zip",
      "application/x-7z-compressed" to ".7z",
      "application/x-rar-compressed" to ".rar",
      "application/gzip" to ".gz",
      "application/x-bittorrent" to ".torrent",
      "application/vnd.android.package-archive" to ".apk",
      "video/mp4" to ".mp4",
      "video/webm" to ".webm",
      "video/x-matroska" to ".mkv",
      "audio/mpeg" to ".mp3",
      "audio/mp4" to ".m4a",
      "audio/wav" to ".wav",
      "text/plain" to ".txt",
      "application/json" to ".json",
    )

    fun buildInitialSegments(
      totalBytes: Long?,
      resumeSupported: Boolean,
      requestedConnections: Int,
    ): List<SegmentInfo> {
      if (!resumeSupported || totalBytes == null || totalBytes < 256L * 1024L || requestedConnections <= 1) {
        return listOf(
          SegmentInfo(
            index = 0,
            start = 0L,
            end = if (totalBytes != null && totalBytes > 0L) totalBytes - 1L else -1L,
            downloaded = 0L,
            speed = 0L,
            status = SegmentStatus.PENDING,
          )
        )
      }
      val count = requestedConnections.coerceIn(1, MAX_CONNECTIONS)
      val chunkSize = totalBytes / count
      val list = mutableListOf<SegmentInfo>()
      for (i in 0 until count) {
        val start = i * chunkSize
        val end = if (i == count - 1) totalBytes - 1L else ((i + 1) * chunkSize) - 1L
        list.add(
          SegmentInfo(
            index = i,
            start = start,
            end = end,
            downloaded = 0L,
            speed = 0L,
            status = SegmentStatus.PENDING,
          )
        )
      }
      return list
    }

    fun resolveTargetFile(saveDir: String, fileName: String, policy: DuplicatePolicy): File {
      val dir = File(saveDir)
      if (!dir.exists()) dir.mkdirs()
      val safeName = FormatUtils.sanitizeFileName(fileName)
      val baseFile = File(dir, safeName)
      if (policy == DuplicatePolicy.OVERWRITE) return baseFile
      val existsAny = { f: File -> f.exists() || File("${f.absolutePath}.myload.part").exists() }
      if (!existsAny(baseFile)) return baseFile
      val dotIdx = safeName.lastIndexOf('.')
      val stem = if (dotIdx > 0) safeName.substring(0, dotIdx) else safeName
      val ext = if (dotIdx > 0) safeName.substring(dotIdx) else ""
      for (i in 1..9999) {
        val candidate = File(dir, "$stem ($i)$ext")
        if (!existsAny(candidate)) return candidate
      }
      return File(dir, "$stem (${System.currentTimeMillis()})$ext")
    }
  }

  private val activeJobs = ConcurrentHashMap<String, Job>()

  fun isRunning(id: String): Boolean = activeJobs[id]?.isActive == true

  fun pause(id: String) {
    activeJobs.remove(id)?.cancel()
  }

  fun cancel(id: String) {
    pause(id)
  }

  suspend fun probeUrl(
    rawUrl: String,
    requestHeaders: Map<String, String> = emptyMap(),
  ): ProbeResult = withContext(Dispatchers.IO) {
    val cleanUrl = rawUrl.trim()
    val headInfo = try {
      performProbeRequest(cleanUrl, "HEAD", requestHeaders)
    } catch (_: Exception) {
      null
    }

    val headLen = headInfo?.headers?.get("content-length")?.toLongOrNull()
    val needsGet =
      headInfo == null ||
        headInfo.statusCode == 405 ||
        headInfo.statusCode == 501 ||
        headInfo.statusCode == 400 ||
        headInfo.statusCode == 403 ||
        headLen == null

    var finalInfo = headInfo
    if (needsGet) {
      try {
        val rangeHeaders = requestHeaders.toMutableMap()
        rangeHeaders["Range"] = "bytes=0-0"
        finalInfo = performProbeRequest(cleanUrl, "GET", rangeHeaders)
      } catch (e: Exception) {
        if (headInfo == null) throw e
      }
    }

    val resolved = finalInfo ?: throw IllegalStateException("Unable to connect to remote server")
    if (resolved.statusCode >= 400) {
      throw IllegalStateException("Server responded with HTTP ${resolved.statusCode}")
    }

    val contentRangeTotal = parseContentRangeTotal(resolved.headers["content-range"])
    val contentLength = resolved.headers["content-length"]?.toLongOrNull()
    val totalBytes = if (resolved.statusCode == 206) contentRangeTotal else contentLength
    val acceptRanges = (resolved.headers["accept-ranges"] ?: "").lowercase(Locale.US)
    val resumeSupported = resolved.statusCode == 206 || acceptRanges.contains("bytes")
    val fileName = extractFileName(
      resolved.headers["content-disposition"],
      resolved.finalUrl,
      resolved.headers["content-type"],
    )

    ProbeResult(
      kind = DownloadKind.HTTP,
      source = cleanUrl,
      finalUrl = resolved.finalUrl,
      fileName = fileName,
      totalBytes = totalBytes,
      resumeSupported = resumeSupported,
      category = FormatUtils.classifyFileName(fileName, DownloadKind.HTTP),
    )
  }

  fun start(
    scope: CoroutineScope,
    item: DownloadItem,
    connections: Int,
    maxRetries: Int,
    duplicatePolicy: DuplicatePolicy,
    throttleOverride: TokenBucket? = null,
    onProgress: (DownloadItem.() -> DownloadItem) -> Unit,
    onComplete: (finalPath: String, totalBytes: Long) -> Unit,
    onError: (message: String) -> Unit,
  ) {
    if (isRunning(item.id)) return
    val job = scope.launch(Dispatchers.IO) {
      val fileMutex = Mutex()
      var raf: RandomAccessFile? = null
      try {
        val saveDirFile = File(item.saveDir)
        if (!saveDirFile.exists() && !saveDirFile.mkdirs()) {
          throw IllegalStateException("Unable to create download directory: ${item.saveDir}")
        }

        var targetUrl = item.source
        var totalBytes = item.totalBytes
        var resumeSupported = item.resumeSupported
        var resolvedName = item.name

        if (totalBytes == null || item.segments.isEmpty()) {
          onProgress { copy(status = DownloadStatus.PROBING, errorMessage = null) }
          val probe = probeUrl(item.source, item.requestHeaders)
          ensureActive()
          targetUrl = probe.finalUrl.ifBlank { item.source }
          totalBytes = probe.totalBytes
          resumeSupported = probe.resumeSupported
          if (resolvedName.isBlank() || resolvedName == "download.bin") {
            resolvedName = probe.fileName
          }
        }

        val effectiveHeaders = stripUnsafeRedirectHeaders(item.requestHeaders, item.source, targetUrl)
        val isFresh = item.downloadedBytes == 0L && item.segments.isEmpty()
        val finalFile = if (isFresh) {
          resolveTargetFile(item.saveDir, resolvedName, duplicatePolicy)
        } else {
          File(item.filePath)
        }
        val finalName = finalFile.name
        val partFile = File("${finalFile.absolutePath}.myload.part")

        val mutableSegments = item.segments.map { it.copy() }.toMutableList()
        var partExists = partFile.exists()
        if (mutableSegments.isEmpty() || !partExists || !resumeSupported) {
          if (!resumeSupported && partExists) {
            partFile.delete()
            partExists = false
          }
          mutableSegments.clear()
          mutableSegments.addAll(buildInitialSegments(totalBytes, resumeSupported, connections))
        }

        if (mutableSegments.size == 1 && mutableSegments[0].end == -1L && partExists && resumeSupported) {
          mutableSegments[0] = mutableSegments[0].copy(downloaded = partFile.length())
        }

        val initialDownloaded = mutableSegments.sumOf { it.downloaded }
        onProgress {
          copy(
            name = finalName,
            filePath = finalFile.absolutePath,
            category = FormatUtils.classifyFileName(finalName, item.kind),
            status = DownloadStatus.DOWNLOADING,
            totalBytes = totalBytes,
            downloadedBytes = initialDownloaded,
            resumeSupported = resumeSupported,
            segments = mutableSegments.toList(),
            errorMessage = null,
          )
        }

        onLog(
          "info",
          "HTTP",
          "Starting $finalName (${mutableSegments.size} segment(s), resume=${if (resumeSupported) "yes" else "no"})",
          item.id,
        )

        raf = RandomAccessFile(partFile, "rw")
        val targetRaf = raf
        val segDownloads = LongArray(mutableSegments.size) { mutableSegments[it].downloaded }
        val segLastBytes = LongArray(mutableSegments.size) { mutableSegments[it].downloaded }
        val segSpeeds = LongArray(mutableSegments.size) { 0L }
        val segStatuses = Array(mutableSegments.size) { mutableSegments[it].status }
        var lastTickTime = System.currentTimeMillis()
        var lastTickBytes = initialDownloaded
        var smoothedSpeed = 0.0

        val emitProgress = { force: Boolean ->
          val now = System.currentTimeMillis()
          val elapsedMs = now - lastTickTime
          if (force || elapsedMs >= 220L) {
            val totalDl = segDownloads.sum()
            if (elapsedMs > 0L) {
              val delta = max(0L, totalDl - lastTickBytes)
              val instant = (delta.toDouble() / elapsedMs.toDouble()) * 1000.0
              smoothedSpeed = if (smoothedSpeed == 0.0) instant else (smoothedSpeed * 0.55 + instant * 0.45)
              for (i in mutableSegments.indices) {
                val segDelta = max(0L, segDownloads[i] - segLastBytes[i])
                segSpeeds[i] = ((segDelta.toDouble() / elapsedMs.toDouble()) * 1000.0).roundToLong()
                segLastBytes[i] = segDownloads[i]
              }
              lastTickTime = now
              lastTickBytes = totalDl
            }
            val speed = smoothedSpeed.roundToLong()
            val rem = totalBytes?.let { max(0L, it - totalDl) }
            val eta = if (rem != null && speed > 0L) ceil(rem.toDouble() / speed.toDouble()).toLong() else null
            val snapSegments = mutableSegments.indices.map { i ->
              mutableSegments[i].copy(
                downloaded = segDownloads[i],
                speed = segSpeeds[i],
                status = segStatuses[i],
              )
            }
            onProgress {
              copy(
                status = DownloadStatus.DOWNLOADING,
                totalBytes = totalBytes,
                downloadedBytes = totalDl,
                downloadSpeed = speed,
                etaSeconds = eta,
                segments = snapSegments,
              )
            }
          }
        }

        val effectiveBucket = throttleOverride ?: globalThrottle

        coroutineScope {
          val ticker = launch {
            while (isActive) {
              delay(250L)
              emitProgress(true)
            }
          }
          try {
            val workers = mutableSegments.indices.map { idx ->
              async {
                downloadSegment(
                  downloadId = item.id,
                  segIndex = idx,
                  seg = mutableSegments[idx],
                  url = targetUrl,
                  headers = effectiveHeaders,
                  resumeSupported = resumeSupported,
                  maxRetries = maxRetries,
                  bucket = effectiveBucket,
                  raf = targetRaf,
                  fileMutex = fileMutex,
                  segDownloads = segDownloads,
                  segStatuses = segStatuses,
                  onDiscoveredTotal = { discovered ->
                    if (totalBytes == null && discovered != null && discovered > 0L) {
                      totalBytes = discovered
                      mutableSegments[idx] = mutableSegments[idx].copy(end = discovered - 1L)
                    }
                  },
                  onBytes = { emitProgress(false) },
                )
              }
            }
            workers.awaitAll()
          } finally {
            ticker.cancel()
          }
        }

        ensureActive()
        raf.close()
        raf = null

        if (finalFile.exists()) {
          finalFile.delete()
        }
        if (!partFile.renameTo(finalFile)) {
          partFile.copyTo(finalFile, overwrite = true)
          partFile.delete()
        }

        val finalTotal = totalBytes ?: segDownloads.sum()
        val doneSegments = mutableSegments.indices.map { i ->
          mutableSegments[i].copy(
            downloaded = segDownloads[i],
            speed = 0L,
            status = SegmentStatus.DONE,
          )
        }
        onProgress {
          copy(
            filePath = finalFile.absolutePath,
            name = finalFile.name,
            totalBytes = finalTotal,
            downloadedBytes = finalTotal,
            downloadSpeed = 0L,
            etaSeconds = 0L,
            status = DownloadStatus.COMPLETED,
            completedAt = System.currentTimeMillis(),
            segments = doneSegments,
          )
        }
        onLog("info", "HTTP", "Completed $finalName ($finalTotal bytes)", item.id)
        onComplete(finalFile.absolutePath, finalTotal)
      } catch (e: CancellationException) {
        try {
          raf?.close()
        } catch (_: Exception) {
        }
      } catch (e: Exception) {
        try {
          raf?.close()
        } catch (_: Exception) {
        }
        val msg = e.message ?: "Download failed"
        onLog("error", "HTTP", "Failed ${item.name}: $msg", item.id)
        onError(msg)
      } finally {
        activeJobs.remove(item.id)
      }
    }
    activeJobs[item.id] = job
  }

  private suspend fun downloadSegment(
    downloadId: String,
    segIndex: Int,
    seg: SegmentInfo,
    url: String,
    headers: Map<String, String>,
    resumeSupported: Boolean,
    maxRetries: Int,
    bucket: TokenBucket,
    raf: RandomAccessFile,
    fileMutex: Mutex,
    segDownloads: LongArray,
    segStatuses: Array<SegmentStatus>,
    onDiscoveredTotal: (Long?) -> Unit,
    onBytes: () -> Unit,
  ) {
    val targetLen = if (seg.end >= seg.start) (seg.end - seg.start + 1L) else null
    if (targetLen != null && segDownloads[segIndex] >= targetLen) {
      segStatuses[segIndex] = SegmentStatus.DONE
      return
    }

    var attempt = 0
    while (true) {
      coroutineContext.ensureActive()
      segStatuses[segIndex] = SegmentStatus.ACTIVE
      try {
        runSegmentAttempt(
          segIndex = segIndex,
          seg = seg,
          url = url,
          headers = headers,
          resumeSupported = resumeSupported,
          bucket = bucket,
          raf = raf,
          fileMutex = fileMutex,
          segDownloads = segDownloads,
          onDiscoveredTotal = onDiscoveredTotal,
          onBytes = onBytes,
        )
        segStatuses[segIndex] = SegmentStatus.DONE
        return
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        attempt += 1
        if (attempt > maxRetries) {
          segStatuses[segIndex] = SegmentStatus.ERROR
          throw e
        }
        val delayMs = (1000.0 * 2.0.pow((attempt - 1).toDouble())).toLong()
        onLog(
          "warn",
          "HTTP",
          "Segment ${segIndex + 1} dropped (${e.message}); retrying ($attempt/$maxRetries) in ${delayMs}ms",
          downloadId,
        )
        delay(delayMs)
      }
    }
  }

  private suspend fun runSegmentAttempt(
    segIndex: Int,
    seg: SegmentInfo,
    url: String,
    headers: Map<String, String>,
    resumeSupported: Boolean,
    bucket: TokenBucket,
    raf: RandomAccessFile,
    fileMutex: Mutex,
    segDownloads: LongArray,
    onDiscoveredTotal: (Long?) -> Unit,
    onBytes: () -> Unit,
  ) {
    val reqHeaders = headers.toMutableMap()
    val hasKnownEnd = seg.end >= seg.start
    val currentDownloaded = segDownloads[segIndex]
    if (resumeSupported && (hasKnownEnd || currentDownloaded > 0L)) {
      val startByte = seg.start + currentDownloaded
      reqHeaders["Range"] = if (hasKnownEnd) "bytes=$startByte-${seg.end}" else "bytes=$startByte-"
    }

    val conn = openFollowConnection(url, "GET", reqHeaders)
    try {
      val code = conn.responseCode
      if (code >= 400) {
        throw IllegalStateException("HTTP $code")
      }
      if (code == 200 && segDownloads[segIndex] > 0L) {
        if (segIndex == 0 && !hasKnownEnd) {
          segDownloads[0] = 0L
          fileMutex.withLock { raf.setLength(0L) }
        } else if (seg.start + segDownloads[segIndex] > 0L) {
          throw IllegalStateException("Server refused byte-range resume (HTTP 200)")
        }
      }

      val discoveredLen = conn.getHeaderField("Content-Length")?.toLongOrNull()
      if (!hasKnownEnd && discoveredLen != null) {
        onDiscoveredTotal(discoveredLen)
      }

      val expectedSegmentLen = if (hasKnownEnd) (seg.end - seg.start + 1L) else null
      val bufferOut = ByteArrayOutputStream(WRITE_BUFFER_BYTES + 32768)
      var lastFlushAt = System.currentTimeMillis()

      suspend fun flushBuffer() {
        val size = bufferOut.size()
        if (size <= 0) return
        coroutineContext.ensureActive()
        val bytes = bufferOut.toByteArray()
        bufferOut.reset()
        lastFlushAt = System.currentTimeMillis()
        val writeOffset = seg.start + segDownloads[segIndex]
        fileMutex.withLock {
          raf.seek(writeOffset)
          raf.write(bytes, 0, bytes.size)
        }
        segDownloads[segIndex] += bytes.size.toLong()
        onBytes()
      }

      conn.inputStream.use { input ->
        val readBuf = ByteArray(32 * 1024)
        while (true) {
          coroutineContext.ensureActive()
          val n = input.read(readBuf)
          if (n < 0) break
          if (n == 0) continue

          var toTake = n
          if (expectedSegmentLen != null) {
            val remaining = expectedSegmentLen - (segDownloads[segIndex] + bufferOut.size().toLong())
            if (remaining <= 0L) break
            if (toTake.toLong() > remaining) {
              toTake = remaining.toInt()
            }
          }
          if (toTake <= 0) continue

          bucket.consume(toTake)
          coroutineContext.ensureActive()
          bufferOut.write(readBuf, 0, toTake)

          val throttled = bucket.getLimit() != null
          val reachedEnd =
            expectedSegmentLen != null &&
              (segDownloads[segIndex] + bufferOut.size().toLong()) >= expectedSegmentLen
          val windowElapsed = (System.currentTimeMillis() - lastFlushAt) >= WRITE_FLUSH_INTERVAL_MS

          if (throttled || bufferOut.size() >= WRITE_BUFFER_BYTES || windowElapsed || reachedEnd) {
            flushBuffer()
          }
          if (reachedEnd) break
        }
      }

      flushBuffer()

      if (expectedSegmentLen != null && segDownloads[segIndex] < expectedSegmentLen) {
        throw IllegalStateException(
          "Incomplete segment ${segIndex + 1} (${segDownloads[segIndex]}/$expectedSegmentLen)"
        )
      }
    } finally {
      conn.disconnect()
    }
  }

  private data class ProbeHttpResponse(
    val finalUrl: String,
    val statusCode: Int,
    val headers: Map<String, String>,
  )

  private fun performProbeRequest(
    urlStr: String,
    method: String,
    headers: Map<String, String>,
  ): ProbeHttpResponse {
    val conn = openFollowConnection(urlStr, method, headers)
    return try {
      val code = conn.responseCode
      val headerMap = mutableMapOf<String, String>()
      for ((k, values) in conn.headerFields) {
        if (k != null && !values.isNullOrEmpty()) {
          headerMap[k.lowercase(Locale.US)] = values.first()
        }
      }
      ProbeHttpResponse(
        finalUrl = conn.url.toString(),
        statusCode = code,
        headers = headerMap,
      )
    } finally {
      conn.disconnect()
    }
  }

  private fun openFollowConnection(
    initialUrl: String,
    method: String,
    headers: Map<String, String>,
  ): HttpURLConnection {
    var currentUrl = initialUrl
    var currentHeaders = headers
    var hops = 0
    while (true) {
      val conn = (URL(currentUrl).openConnection() as HttpURLConnection).apply {
        requestMethod = method
        connectTimeout = CONNECT_TIMEOUT_MS
        readTimeout = READ_TIMEOUT_MS
        instanceFollowRedirects = false
        setRequestProperty("User-Agent", USER_AGENT)
        for ((k, v) in currentHeaders) {
          setRequestProperty(k, v)
        }
      }
      val code = conn.responseCode
      val location = conn.getHeaderField("Location")
      if (location != null && code in listOf(301, 302, 303, 307, 308) && hops < MAX_REDIRECTS) {
        conn.disconnect()
        val nextUrl = URL(URL(currentUrl), location).toString()
        currentHeaders = stripUnsafeRedirectHeaders(currentHeaders, currentUrl, nextUrl)
        currentUrl = nextUrl
        hops += 1
        continue
      }
      return conn
    }
  }

  private fun stripUnsafeRedirectHeaders(
    headers: Map<String, String>,
    fromUrl: String,
    toUrl: String,
  ): Map<String, String> {
    if (headers.isEmpty()) return headers
    return try {
      val a = URI(fromUrl)
      val b = URI(toUrl)
      val sameOrigin =
        a.scheme.equals(b.scheme, ignoreCase = true) &&
          a.host.equals(b.host, ignoreCase = true) &&
          a.port == b.port
      if (sameOrigin) {
        headers
      } else {
        headers.filterKeys { k ->
          !k.equals("cookie", ignoreCase = true) &&
            !k.equals("authorization", ignoreCase = true)
        }
      }
    } catch (_: Exception) {
      headers.filterKeys { k ->
        !k.equals("cookie", ignoreCase = true) &&
          !k.equals("authorization", ignoreCase = true)
      }
    }
  }

  private fun parseContentRangeTotal(raw: String?): Long? {
    if (raw.isNullOrBlank()) return null
    val m = Regex("/(\\d+)\\s*$").find(raw) ?: return null
    return m.groupValues[1].toLongOrNull()
  }

  private fun extractFileName(
    contentDisposition: String?,
    finalUrl: String,
    contentType: String?,
  ): String {
    if (!contentDisposition.isNullOrBlank()) {
      val starMatch = Regex("filename\\*\\s*=\\s*(?:UTF-8''|utf-8'')?([^;\\n]+)", RegexOption.IGNORE_CASE)
        .find(contentDisposition)
      if (starMatch != null) {
        val raw = starMatch.groupValues[1].trim().trim('"', '\'')
        return try {
          FormatUtils.sanitizeFileName(URLDecoder.decode(raw, "UTF-8"))
        } catch (_: Exception) {
          FormatUtils.sanitizeFileName(raw)
        }
      }
      val plainMatch = Regex("filename\\s*=\\s*\"([^\"]+)\"|filename\\s*=\\s*([^;\\n]+)", RegexOption.IGNORE_CASE)
        .find(contentDisposition)
      val extracted = plainMatch?.groupValues?.get(1)?.ifBlank { plainMatch.groupValues[2] }
      if (!extracted.isNullOrBlank()) {
        return FormatUtils.sanitizeFileName(extracted.trim().trim('"', '\''))
      }
    }

    val derived = FormatUtils.deriveNameFromSource(finalUrl)
    if (derived.contains('.')) return derived
    val mime = contentType?.substringBefore(';')?.trim()?.lowercase(Locale.US)
    val ext = if (mime != null) MIME_EXTENSIONS[mime] else null
    return if (ext != null && !derived.endsWith(ext, ignoreCase = true)) "$derived$ext" else derived
  }
}
