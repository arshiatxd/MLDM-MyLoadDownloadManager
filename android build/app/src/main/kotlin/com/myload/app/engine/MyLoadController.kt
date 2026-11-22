package com.myload.app.engine

import android.app.NotificationManager
import android.content.Context
import android.media.AudioManager
import android.media.ToneGenerator
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Environment
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import com.myload.app.R
import com.myload.app.model.AppLanguage
import com.myload.app.model.AppSettings
import com.myload.app.model.CustomThemeColors
import com.myload.app.model.DownloadItem
import com.myload.app.model.DownloadKind
import com.myload.app.model.DownloadSchedule
import com.myload.app.model.DownloadStatus
import com.myload.app.model.DuplicatePolicy
import com.myload.app.model.FileCategory
import com.myload.app.model.FolderRoutingMode
import com.myload.app.model.FontScale
import com.myload.app.model.FormatUtils
import com.myload.app.model.GamingModeProfile
import com.myload.app.model.LogEntry
import com.myload.app.model.MultiPartScanResult
import com.myload.app.model.NetworkBalanceStats
import com.myload.app.model.PowerAction
import com.myload.app.model.ProbeResult
import com.myload.app.model.QueueMode
import com.myload.app.model.SegmentInfo
import com.myload.app.model.SegmentStatus
import com.myload.app.model.SocialMediaItem
import com.myload.app.model.SocialPlatform
import com.myload.app.model.SocialScanResult
import com.myload.app.model.SpeedUnit
import com.myload.app.model.ThemeMode
import com.myload.app.model.TorrentFileInfo
import com.myload.app.model.TorrentMeta
import com.myload.app.model.UpdateStatus
import com.myload.app.service.MyLoadForegroundService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.max
import kotlin.math.min

class MyLoadController private constructor(private val appContext: Context) {
  companion object {
    @Volatile private var instance: MyLoadController? = null

    fun getInstance(context: Context): MyLoadController {
      return instance ?: synchronized(this) {
        instance ?: MyLoadController(context.applicationContext).also { instance = it }
      }
    }
  }

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
  private val stateFile = File(appContext.filesDir, "myload_state.json")
  private val defaultDownloadsDir: String = run {
    val pub = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
    val myloadPub = File(pub, "MyLoad")
    if (myloadPub.exists() || myloadPub.mkdirs()) {
      myloadPub.absolutePath
    } else {
      val fallback = File(appContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: appContext.filesDir, "MyLoad")
      fallback.mkdirs()
      fallback.absolutePath
    }
  }

  private val globalThrottle = TokenBucket(null)
  private val equalBuckets = ConcurrentHashMap<String, TokenBucket>()
  private val networkBalancer = NetworkBalancer()
  private val httpEngine = HttpDownloadEngine(globalThrottle, ::appendLog)
  private val torrentEngine = TorrentEngine(httpEngine, globalThrottle, ::appendLog)

  private val _downloads = MutableStateFlow<List<DownloadItem>>(emptyList())
  val downloads: StateFlow<List<DownloadItem>> = _downloads.asStateFlow()

  private val _settings = MutableStateFlow(AppSettings(defaultDownloadDir = defaultDownloadsDir))
  val settings: StateFlow<AppSettings> = _settings.asStateFlow()

  private val _networkBalance = MutableStateFlow(NetworkBalanceStats())
  val networkBalance: StateFlow<NetworkBalanceStats> = _networkBalance.asStateFlow()

  private val _logs = MutableStateFlow<List<LogEntry>>(emptyList())
  val logs: StateFlow<List<LogEntry>> = _logs.asStateFlow()

  private val _updateStatus = MutableStateFlow(UpdateStatus(currentVersion = "1.0.12"))
  val updateStatus: StateFlow<UpdateStatus> = _updateStatus.asStateFlow()

  private val _activePopupDownloadId = MutableStateFlow<String?>(null)
  val activePopupDownloadId: StateFlow<String?> = _activePopupDownloadId.asStateFlow()

  private val _wakeLockActive = MutableStateFlow(false)
  val wakeLockActive: StateFlow<Boolean> = _wakeLockActive.asStateFlow()

  private val _lastToast = MutableStateFlow<String?>(null)
  val lastToast: StateFlow<String?> = _lastToast.asStateFlow()

  private var cpuWakeLock: PowerManager.WakeLock? = null
  private var latencyTickCounter = 0

  init {
    loadState()
    appendLog("info", "App", "MyLoad Download Manager v1.0.12 started", null)
    scope.launch(Dispatchers.IO) {
      val cleaned = GitHubUpdateChecker.cleanupOldUpdateFiles(appContext.cacheDir)
      if (cleaned > 0) {
        appendLog("info", "Updater", "Cleaned up $cleaned leftover temporary update package(s)", null)
      }
      if (_settings.value.autoCheckUpdates) {
        delay(1800L)
        checkForUpdates(manual = false)
      }
    }
    scope.launch {
      while (isActive) {
        delay(1000L)
        tickSchedulerAndQueue()
      }
    }
  }

  fun showToast(message: String) {
    _lastToast.value = message
  }

  fun clearToast() {
    _lastToast.value = null
  }

  fun openProgressPopup(downloadId: String) {
    if (_downloads.value.any { it.id == downloadId }) {
      _activePopupDownloadId.value = downloadId
    }
  }

  fun closeProgressPopup() {
    _activePopupDownloadId.value = null
  }

  fun appendLog(level: String, scopeName: String, message: String, downloadId: String? = null) {
    val entry = LogEntry(
      id = UUID.randomUUID().toString(),
      timestamp = System.currentTimeMillis(),
      level = level,
      scope = scopeName,
      message = message,
      downloadId = downloadId,
    )
    _logs.update { current ->
      val next = listOf(entry) + current
      if (next.size > 400) next.take(400) else next
    }
  }

  fun clearLogs() {
    _logs.value = emptyList()
    appendLog("info", "App", "Activity logs cleared", null)
  }

  suspend fun probeSource(source: String, headers: Map<String, String> = emptyMap()): ProbeResult {
    val trimmed = source.trim()
    if (FormatUtils.isMagnetUri(trimmed)) {
      return BencodeParser.parseMagnetUri(trimmed)
    }
    if (!FormatUtils.isHttpUrl(trimmed)) {
      val f = File(trimmed)
      if (f.exists() && f.name.endsWith(".torrent", ignoreCase = true)) {
        val parsed = withContext(Dispatchers.IO) {
          BencodeParser.parseTorrentBytes(f.readBytes(), f.nameWithoutExtension)
        }
        return ProbeResult(
          kind = DownloadKind.TORRENT,
          source = trimmed,
          finalUrl = trimmed,
          fileName = parsed.name,
          totalBytes = parsed.totalBytes,
          resumeSupported = true,
          category = FileCategory.TORRENTS,
          infoHash = parsed.infoHash,
          trackers = parsed.trackers,
          webSeeds = parsed.webSeeds,
          files = parsed.files,
        )
      }
    }
    return httpEngine.probeUrl(trimmed, headers)
  }

  suspend fun parseTorrentUri(uri: Uri): Pair<File, ProbeResult>? = withContext(Dispatchers.IO) {
    try {
      val bytes = appContext.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return@withContext null
      val torrentsCache = File(appContext.filesDir, "torrents").apply { mkdirs() }
      val parsed = BencodeParser.parseTorrentBytes(bytes, "torrent_${System.currentTimeMillis()}")
      val savedTorrent = File(torrentsCache, "${FormatUtils.sanitizeFileName(parsed.name)}.torrent")
      savedTorrent.writeBytes(bytes)
      val probe = ProbeResult(
        kind = DownloadKind.TORRENT,
        source = savedTorrent.absolutePath,
        finalUrl = savedTorrent.absolutePath,
        fileName = parsed.name,
        totalBytes = parsed.totalBytes,
        resumeSupported = true,
        category = FileCategory.TORRENTS,
        infoHash = parsed.infoHash,
        trackers = parsed.trackers,
        webSeeds = parsed.webSeeds,
        files = parsed.files,
      )
      Pair(savedTorrent, probe)
    } catch (e: Exception) {
      appendLog("error", "Torrent", "Failed to read .torrent file: ${e.message}", null)
      null
    }
  }

  suspend fun scanMultiParts(url: String, headers: Map<String, String> = emptyMap()): MultiPartScanResult {
    return MultiPartScanner.scanNumberedParts(url, headers)
  }

  suspend fun scanMediaPage(url: String, platform: SocialPlatform? = null): SocialScanResult {
    return MediaScannerEngine.scanUrl(url, platform)
  }

  fun addDownload(
    source: String,
    fileName: String? = null,
    saveDir: String? = null,
    kindOverride: DownloadKind? = null,
    startPaused: Boolean = false,
    requestHeaders: Map<String, String> = emptyMap(),
    schedule: DownloadSchedule? = null,
    probeResult: ProbeResult? = null,
    selectedFileIndices: Set<Int>? = null,
    openPopupIfEnabled: Boolean = true,
  ): DownloadItem {
    val trimmed = source.trim()
    val kind = kindOverride ?: when {
      FormatUtils.isMagnetUri(trimmed) || trimmed.endsWith(".torrent", true) -> DownloadKind.TORRENT
      else -> DownloadKind.HTTP
    }
    val rawName = fileName?.takeIf { it.isNotBlank() }
      ?: probeResult?.fileName
      ?: FormatUtils.deriveNameFromSource(trimmed)
    val safeName = FormatUtils.sanitizeFileName(rawName)
    val category = FormatUtils.classifyFileName(safeName, kind)
    val curSettings = _settings.value
    val targetDir = saveDir?.takeIf { it.isNotBlank() }
      ?: FormatUtils.resolveCategoryFolder(
        curSettings.defaultDownloadDir,
        curSettings.folderRoutingMode,
        category,
      )
    File(targetDir).mkdirs()

    val torrentMeta = if (kind == DownloadKind.TORRENT) {
      val baseFiles = probeResult?.files ?: emptyList()
      val filteredFiles = if (selectedFileIndices != null && baseFiles.isNotEmpty()) {
        baseFiles.map { f -> f.copy(selected = selectedFileIndices.contains(f.index)) }
      } else {
        baseFiles
      }
      TorrentMeta(
        infoHash = probeResult?.infoHash ?: UUID.randomUUID().toString().replace("-", "").take(40),
        trackers = probeResult?.trackers ?: emptyList(),
        magnetUri = if (FormatUtils.isMagnetUri(trimmed)) trimmed else null,
        webSeeds = probeResult?.webSeeds ?: emptyList(),
        files = filteredFiles,
      )
    } else {
      null
    }

    val totalBytes = if (kind == DownloadKind.TORRENT && torrentMeta != null && torrentMeta.files.isNotEmpty()) {
      torrentMeta.files.filter { it.selected }.sumOf { it.length }
    } else {
      probeResult?.totalBytes
    }

    val shouldWaitSchedule = schedule?.startAt != null && schedule.startAt > System.currentTimeMillis()
    val initialStatus = if (startPaused || shouldWaitSchedule) DownloadStatus.PAUSED else DownloadStatus.QUEUED
    val targetFilePath = if (kind == DownloadKind.TORRENT && torrentMeta != null) {
      BencodeParser.resolveTorrentTargetPath(
        saveDir = targetDir,
        torrentName = safeName,
        filePaths = torrentMeta.files.map { it.path },
        fallbackName = safeName,
      )
    } else {
      File(targetDir, safeName).absolutePath
    }

    val item = DownloadItem(
      id = UUID.randomUUID().toString(),
      kind = kind,
      source = trimmed,
      name = safeName,
      saveDir = targetDir,
      filePath = targetFilePath,
      category = category,
      status = initialStatus,
      totalBytes = totalBytes,
      resumeSupported = probeResult?.resumeSupported ?: (kind == DownloadKind.TORRENT),
      torrent = torrentMeta,
      requestHeaders = requestHeaders,
      schedule = schedule,
    )

    _downloads.update { listOf(item) + it }
    appendLog("info", "Queue", "Added ${item.name} (${kind.label})", item.id)
    saveStateAsync()

    if (openPopupIfEnabled && curSettings.showProgressPopupOnStart && !startPaused) {
      _activePopupDownloadId.value = item.id
    }
    scope.launch { processQueue() }
    return item
  }

  fun addBatchDownloads(
    sources: List<String>,
    saveDir: String? = null,
    queueModeOverride: QueueMode? = null,
    startPaused: Boolean = false,
  ): List<DownloadItem> {
    if (queueModeOverride != null && queueModeOverride != _settings.value.queueMode) {
      updateSettings { copy(queueMode = queueModeOverride) }
    }
    val created = sources.map { src ->
      addDownload(
        source = src,
        saveDir = saveDir,
        startPaused = startPaused,
        openPopupIfEnabled = false,
      )
    }
    if (created.isNotEmpty() && _settings.value.showProgressPopupOnStart && !startPaused) {
      _activePopupDownloadId.value = created.first().id
    }
    showToast("Added ${created.size} download(s) to queue")
    return created
  }

  fun addSocialMediaItems(
    platform: SocialPlatform,
    items: List<SocialMediaItem>,
    outputFormat: String,
    quality: String,
    saveDir: String? = null,
    schedule: DownloadSchedule? = null,
  ): List<DownloadItem> {
    val created = items.map { media ->
      val ext = outputFormat.lowercase().ifBlank { media.ext.ifBlank { "mp4" } }
      val baseTitle = media.title.substringBeforeLast('.').ifBlank { "media_${media.index + 1}" }
      val finalName = FormatUtils.sanitizeFileName("$baseTitle.$ext")
      val category = FormatUtils.classifyFileName(finalName, DownloadKind.MEDIA)
      val curSettings = _settings.value
      val targetDir = saveDir?.takeIf { it.isNotBlank() }
        ?: FormatUtils.resolveCategoryFolder(
          curSettings.defaultDownloadDir,
          curSettings.folderRoutingMode,
          category,
        )
      File(targetDir).mkdirs()
      val shouldWait = schedule?.startAt != null && schedule.startAt > System.currentTimeMillis()
      val dl = DownloadItem(
        id = UUID.randomUUID().toString(),
        kind = DownloadKind.MEDIA,
        source = media.sourceUrl,
        name = finalName,
        saveDir = targetDir,
        filePath = File(targetDir, finalName).absolutePath,
        category = category,
        status = if (shouldWait) DownloadStatus.PAUSED else DownloadStatus.QUEUED,
        totalBytes = media.sizeBytes,
        resumeSupported = true,
        schedule = schedule,
        mediaFormat = ext.uppercase(),
        mediaQuality = quality,
      )
      dl
    }
    if (created.isNotEmpty()) {
      _downloads.update { created + it }
      appendLog(
        "info",
        "Media",
        "Added ${created.size} ${platform.label} media item(s) ($outputFormat · $quality)",
        created.first().id,
      )
      if (_settings.value.showProgressPopupOnStart) {
        _activePopupDownloadId.value = created.first().id
      }
      saveStateAsync()
      scope.launch { processQueue() }
    }
    return created
  }

  fun pauseDownload(id: String) {
    val item = _downloads.value.find { it.id == id } ?: return
    if (item.kind == DownloadKind.TORRENT) {
      torrentEngine.pause(id)
    } else {
      httpEngine.pause(id)
      equalBuckets.remove(id)
    }
    updateItem(id) {
      copy(
        status = DownloadStatus.PAUSED,
        downloadSpeed = 0L,
        uploadSpeed = 0L,
        etaSeconds = null,
        segments = segments.map { s ->
          if (s.status == SegmentStatus.ACTIVE) s.copy(status = SegmentStatus.PENDING, speed = 0L)
          else s.copy(speed = 0L)
        },
      )
    }
    appendLog("info", "Queue", "Paused ${item.name}", id)
    saveStateAsync()
    scope.launch { processQueue() }
  }

  fun resumeDownload(id: String) {
    val item = _downloads.value.find { it.id == id } ?: return
    if (item.status == DownloadStatus.COMPLETED) return
    val clearedSchedule = item.schedule?.let { s ->
      val now = System.currentTimeMillis()
      s.copy(
        startAt = if (s.startAt != null && s.startAt <= now) null else s.startAt,
        stopAt = if (s.stopAt != null && s.stopAt <= now) null else s.stopAt,
      )
    }
    updateItem(id) {
      copy(
        status = DownloadStatus.QUEUED,
        errorMessage = null,
        schedule = clearedSchedule,
      )
    }
    appendLog("info", "Queue", "Queued ${item.name} for resume", id)
    saveStateAsync()
    scope.launch { processQueue() }
  }

  fun retryDownload(id: String) {
    val item = _downloads.value.find { it.id == id } ?: return
    updateItem(id) {
      copy(
        status = DownloadStatus.QUEUED,
        errorMessage = null,
        retryCount = retryCount + 1,
      )
    }
    appendLog("info", "Queue", "Retrying ${item.name}", id)
    saveStateAsync()
    scope.launch { processQueue() }
  }

  fun pauseAll() {
    val activeList = _downloads.value.filter { it.isRunning }
    for (item in activeList) {
      if (item.kind == DownloadKind.TORRENT) {
        torrentEngine.pause(item.id)
      } else {
        httpEngine.pause(item.id)
        equalBuckets.remove(item.id)
      }
    }
    _downloads.update { list ->
      list.map { item ->
        if (item.isRunning) {
          item.copy(
            status = DownloadStatus.PAUSED,
            downloadSpeed = 0L,
            uploadSpeed = 0L,
            etaSeconds = null,
          )
        } else {
          item
        }
      }
    }
    if (activeList.isNotEmpty()) {
      appendLog("info", "Queue", "Paused all (${activeList.size}) active downloads", null)
      saveStateAsync()
      syncForegroundAndWakeLock()
    }
  }

  fun resumeAll() {
    var count = 0
    _downloads.update { list ->
      list.map { item ->
        if (item.status == DownloadStatus.PAUSED || item.status == DownloadStatus.ERROR) {
          count += 1
          item.copy(status = DownloadStatus.QUEUED, errorMessage = null)
        } else {
          item
        }
      }
    }
    if (count > 0) {
      appendLog("info", "Queue", "Resumed $count download(s)", null)
      saveStateAsync()
      scope.launch { processQueue() }
    }
  }

  fun removeDownloads(ids: Collection<String>, deleteFiles: Boolean) {
    val idSet = ids.toSet()
    if (idSet.isEmpty()) return
    val toRemove = _downloads.value.filter { it.id in idSet }

    for (item in toRemove) {
      try {
        if (item.kind == DownloadKind.TORRENT) {
          torrentEngine.remove(item.id, deleteFiles, item)
        } else {
          httpEngine.cancel(item.id)
          equalBuckets.remove(item.id)
        }
      } catch (_: Exception) {
      }
    }

    if (_activePopupDownloadId.value in idSet) {
      _activePopupDownloadId.value = null
    }

    _downloads.update { list -> list.filterNot { it.id in idSet } }
    appendLog(
      "info",
      "Queue",
      "Removed ${toRemove.size} download(s)${if (deleteFiles) " (with files deleted)" else ""}",
      null,
    )
    saveStateAsync()

    if (deleteFiles) {
      scope.launch(Dispatchers.IO) {
        for (item in toRemove) {
          try {
            val target = File(item.filePath)
            if (target.exists()) target.deleteRecursively()
            val part = File("${item.filePath}.myload.part")
            if (part.exists()) part.delete()
          } catch (_: Exception) {
          }
        }
      }
    }
    scope.launch { processQueue() }
  }

  fun updateTorrentFileSelection(id: String, selectedIndices: Set<Int>) {
    updateItem(id) {
      val curTorrent = torrent ?: return@updateItem this
      val updatedFiles = curTorrent.files.map { f ->
        f.copy(selected = selectedIndices.contains(f.index))
      }
      val newTotal = updatedFiles.filter { it.selected }.sumOf { it.length }
      copy(
        totalBytes = if (newTotal > 0L) newTotal else totalBytes,
        torrent = curTorrent.copy(files = updatedFiles),
      )
    }
    saveStateAsync()
  }

  fun updateDownloadSchedule(id: String, schedule: DownloadSchedule?) {
    updateItem(id) {
      val shouldPause = schedule?.startAt != null && schedule.startAt > System.currentTimeMillis()
      if (shouldPause && isRunning) {
        if (kind == DownloadKind.TORRENT) torrentEngine.pause(id) else httpEngine.pause(id)
      }
      copy(
        schedule = schedule,
        status = if (shouldPause) DownloadStatus.PAUSED else status,
        downloadSpeed = if (shouldPause) 0L else downloadSpeed,
      )
    }
    appendLog("info", "Schedule", "Updated schedule for download", id)
    saveStateAsync()
    scope.launch { processQueue() }
  }

  fun updateSettings(transform: AppSettings.() -> AppSettings) {
    _settings.update(transform)
    applyThrottleAndBalance(latestRtt = _networkBalance.value.rttMs)
    saveStateAsync()
    scope.launch { processQueue() }
  }

  fun resetSettings() {
    _settings.value = AppSettings(defaultDownloadDir = defaultDownloadsDir)
    applyThrottleAndBalance(latestRtt = null)
    saveStateAsync()
    showToast("Preferences reset to defaults")
  }

  fun checkForUpdates(manual: Boolean = true) {
    scope.launch {
      _updateStatus.update { it.copy(state = "checking", error = null) }
      val res = GitHubUpdateChecker.checkForUpdates("1.0.12")
      _updateStatus.value = res
      if (manual) {
        when (res.state) {
          "available" -> showToast("MyLoad v${res.latestVersion} is available on GitHub")
          "up-to-date" -> showToast("MyLoad v${res.currentVersion} is up to date")
          "error" -> showToast(res.error ?: "Unable to check for updates")
        }
      }
    }
  }

  private suspend fun tickSchedulerAndQueue() {
    val now = System.currentTimeMillis()
    var scheduleChanged = false

    val snapshot = _downloads.value
    for (item in snapshot) {
      val sched = item.schedule ?: continue
      if (sched.stopAt != null && now >= sched.stopAt) {
        if (item.isRunning) {
          if (item.kind == DownloadKind.TORRENT) torrentEngine.pause(item.id)
          else httpEngine.pause(item.id)
          equalBuckets.remove(item.id)
        }
        updateItem(item.id) {
          copy(
            status = if (status == DownloadStatus.COMPLETED) status else DownloadStatus.PAUSED,
            downloadSpeed = 0L,
            uploadSpeed = 0L,
            etaSeconds = null,
            schedule = sched.copy(stopAt = null),
          )
        }
        appendLog("info", "Schedule", "Scheduled stop reached for ${item.name}", item.id)
        scheduleChanged = true
      } else if (sched.startAt != null && now >= sched.startAt) {
        if (item.status == DownloadStatus.PAUSED || item.status == DownloadStatus.ERROR) {
          updateItem(item.id) {
            copy(
              status = DownloadStatus.QUEUED,
              errorMessage = null,
              schedule = sched.copy(startAt = null),
            )
          }
          appendLog("info", "Schedule", "Scheduled start triggered for ${item.name}", item.id)
          scheduleChanged = true
        }
      }
    }

    latencyTickCounter = (latencyTickCounter + 1) % 3
    val hasActive = _downloads.value.any {
      it.status == DownloadStatus.DOWNLOADING || it.status == DownloadStatus.PROBING
    }
    val sampleRtt = if (_settings.value.gamingModeEnabled && (hasActive || latencyTickCounter == 0)) {
      networkBalancer.probeLatencySample()
    } else {
      null
    }
    applyThrottleAndBalance(latestRtt = sampleRtt)

    if (scheduleChanged || _downloads.value.any { it.status == DownloadStatus.QUEUED }) {
      processQueue()
    }
    syncForegroundAndWakeLock()
  }

  private fun applyThrottleAndBalance(latestRtt: Int?) {
    val curSettings = _settings.value
    val activeItems = _downloads.value.filter {
      it.status == DownloadStatus.DOWNLOADING || it.status == DownloadStatus.PROBING
    }
    val totalSpeed = activeItems.sumOf { it.downloadSpeed }
    val stats = networkBalancer.evaluate(
      enabled = curSettings.gamingModeEnabled,
      activeDownloads = activeItems.isNotEmpty(),
      profile = curSettings.gamingModeProfile,
      userDownloadCap = curSettings.configuredDownloadLimitBytesPerSec,
      userUploadCap = curSettings.configuredUploadLimitBytesPerSec,
      currentDownloadSpeed = totalSpeed,
      latestRttMs = latestRtt,
    )
    _networkBalance.value = stats

    val dlLimit = stats.effectiveDownloadLimit
    if (curSettings.queueMode == QueueMode.PARALLEL_EQUAL && activeItems.size >= 2) {
      val aggregateCap = dlLimit ?: max(512L * 1024L, (totalSpeed * 1.15).toLong())
      val perItemShare = max(32L * 1024L, aggregateCap / activeItems.size.toLong())
      globalThrottle.setLimit(dlLimit)
      for (item in activeItems) {
        equalBuckets.getOrPut(item.id) { TokenBucket(perItemShare) }.setLimit(perItemShare)
      }
    } else {
      globalThrottle.setLimit(dlLimit)
      for (b in equalBuckets.values) {
        b.setLimit(dlLimit)
      }
    }
  }

  private fun isWifiConnected(): Boolean {
    return try {
      val cm = appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      val net = cm.activeNetwork ?: return false
      val caps = cm.getNetworkCapabilities(net) ?: return false
      caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
        caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
    } catch (_: Exception) {
      true
    }
  }

  private fun processQueue() {
    val curSettings = _settings.value
    val list = _downloads.value
    val activeCount = list.count {
      it.status == DownloadStatus.DOWNLOADING || it.status == DownloadStatus.PROBING
    }
    val maxSlots = if (curSettings.queueMode == QueueMode.SEQUENTIAL) {
      1
    } else {
      curSettings.maxConcurrentDownloads.coerceIn(1, 10)
    }
    val availableSlots = max(0, maxSlots - activeCount)
    if (availableSlots <= 0) {
      syncForegroundAndWakeLock()
      return
    }

    val wifiReady = isWifiConnected()
    val now = System.currentTimeMillis()
    val candidates = list.filter { item ->
      if (item.status != DownloadStatus.QUEUED) return@filter false
      val sched = item.schedule
      if (sched?.startAt != null && sched.startAt > now) return@filter false
      if ((curSettings.wifiOnlyDownloads || sched?.wifiOnly == true) && !wifiReady) {
        return@filter false
      }
      true
    }

    for (item in candidates.take(availableSlots)) {
      startItem(item)
    }
    syncForegroundAndWakeLock()
  }

  private fun startItem(item: DownloadItem) {
    val curSettings = _settings.value
    if (item.kind == DownloadKind.TORRENT) {
      if (torrentEngine.isRunning(item.id)) return
      torrentEngine.start(
        scope = scope,
        item = item,
        keepSeedingAfterComplete = curSettings.keepSeedingAfterComplete,
        onProgress = { patch -> updateItem(item.id, patch) },
        onComplete = { finalPath, totalBytes, keepSeeding ->
          updateItem(item.id) {
            copy(
              filePath = finalPath,
              totalBytes = totalBytes,
              downloadedBytes = totalBytes,
              downloadSpeed = 0L,
              uploadSpeed = 0L,
              etaSeconds = 0L,
              status = if (keepSeeding) DownloadStatus.SEEDING else DownloadStatus.COMPLETED,
              completedAt = System.currentTimeMillis(),
            )
          }
          onDownloadFinished(item.id, item.name)
        },
        onError = { msg ->
          updateItem(item.id) {
            copy(
              status = DownloadStatus.ERROR,
              downloadSpeed = 0L,
              uploadSpeed = 0L,
              etaSeconds = null,
              errorMessage = msg,
            )
          }
          saveStateAsync()
          scope.launch { processQueue() }
        },
      )
      return
    }

    if (httpEngine.isRunning(item.id)) return
    val effectiveConns = if (curSettings.gamingModeEnabled) {
      min(curSettings.gamingModeProfile.maxSegments, curSettings.httpConnections)
    } else {
      curSettings.httpConnections
    }
    val itemBucket = equalBuckets.getOrPut(item.id) { TokenBucket(globalThrottle.getLimit()) }

    httpEngine.start(
      scope = scope,
      item = item,
      connections = effectiveConns,
      maxRetries = curSettings.maxRetries,
      duplicatePolicy = curSettings.duplicatePolicy,
      throttleOverride = itemBucket,
      onProgress = { patch -> updateItem(item.id, patch) },
      onComplete = { _, _ ->
        equalBuckets.remove(item.id)
        onDownloadFinished(item.id, item.name)
      },
      onError = { msg ->
        equalBuckets.remove(item.id)
        updateItem(item.id) {
          copy(
            status = DownloadStatus.ERROR,
            downloadSpeed = 0L,
            etaSeconds = null,
            errorMessage = msg,
          )
        }
        saveStateAsync()
        scope.launch { processQueue() }
      },
    )
  }

  private fun onDownloadFinished(id: String, name: String) {
    saveStateAsync()
    val curSettings = _settings.value
    if (curSettings.completionSound) {
      try {
        ToneGenerator(AudioManager.STREAM_NOTIFICATION, 80)
          .startTone(ToneGenerator.TONE_PROP_ACK, 180)
      } catch (_: Exception) {
      }
    }
    if (curSettings.completionNotifications) {
      try {
        MyLoadForegroundService.ensureChannels(appContext)
        val mgr = appContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val notif = NotificationCompat.Builder(appContext, MyLoadForegroundService.COMPLETION_CHANNEL_ID)
          .setSmallIcon(R.mipmap.ic_launcher)
          .setContentTitle("Download completed")
          .setContentText(name)
          .setAutoCancel(true)
          .build()
        mgr.notify(id.hashCode(), notif)
      } catch (_: Exception) {
      }
    }
    showToast("Completed: $name")
    scope.launch {
      processQueue()
      val anyLeft = _downloads.value.any {
        it.status == DownloadStatus.DOWNLOADING ||
          it.status == DownloadStatus.PROBING ||
          it.status == DownloadStatus.QUEUED
      }
      if (!anyLeft && curSettings.autoPowerAction != PowerAction.OFF) {
        val action = curSettings.autoPowerAction
        appendLog("info", "Power", "All downloads finished; executing post-action: ${action.label}", null)
        updateSettings { copy(autoPowerAction = PowerAction.OFF) }
        if (action == PowerAction.RELEASE_WAKELOCK || action == PowerAction.EXIT_APP) {
          releaseWakeLock()
          MyLoadForegroundService.syncState(appContext, 0, 0L, 0)
        }
      }
    }
  }

  private fun syncForegroundAndWakeLock() {
    val active = _downloads.value.filter {
      it.status == DownloadStatus.DOWNLOADING ||
        it.status == DownloadStatus.PROBING ||
        it.status == DownloadStatus.SEEDING
    }
    val totalSpeed = active.sumOf { it.downloadSpeed }
    val avgPct = if (active.isNotEmpty()) {
      (active.sumOf { it.progressPercent } / active.size).coerceIn(0, 100)
    } else {
      0
    }

    MyLoadForegroundService.syncState(appContext, active.size, totalSpeed, avgPct)

    val wantWakeLock = _settings.value.keepAwakeDuringDownload && active.isNotEmpty()
    if (wantWakeLock) {
      acquireWakeLock()
    } else {
      releaseWakeLock()
    }
  }

  private fun acquireWakeLock() {
    try {
      if (cpuWakeLock == null) {
        val pm = appContext.getSystemService(Context.POWER_SERVICE) as PowerManager
        cpuWakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MyLoad:ActiveDownloadWakeLock").apply {
          setReferenceCounted(false)
        }
      }
      if (cpuWakeLock?.isHeld == false) {
        cpuWakeLock?.acquire(6 * 60 * 60 * 1000L)
      }
      _wakeLockActive.value = cpuWakeLock?.isHeld == true
    } catch (_: Exception) {
      _wakeLockActive.value = false
    }
  }

  private fun releaseWakeLock() {
    try {
      if (cpuWakeLock?.isHeld == true) {
        cpuWakeLock?.release()
      }
    } catch (_: Exception) {
    }
    _wakeLockActive.value = false
  }

  private fun updateItem(id: String, transform: DownloadItem.() -> DownloadItem) {
    _downloads.update { list ->
      list.map { if (it.id == id) it.transform() else it }
    }
  }

  private fun saveStateAsync() {
    val snapDownloads = _downloads.value
    val snapSettings = _settings.value
    scope.launch(Dispatchers.IO) {
      try {
        val root = JSONObject()
        val settingsObj = JSONObject().apply {
          put("defaultDownloadDir", snapSettings.defaultDownloadDir)
          put("folderRoutingMode", snapSettings.folderRoutingMode.name)
          put("showConfirmationDialog", snapSettings.showConfirmationDialog)
          put("showProgressPopupOnStart", snapSettings.showProgressPopupOnStart)
          put("downloadSpeedLimitEnabled", snapSettings.downloadSpeedLimitEnabled)
          put("downloadSpeedLimitValue", snapSettings.downloadSpeedLimitValue)
          put("downloadSpeedLimitUnit", snapSettings.downloadSpeedLimitUnit.name)
          put("uploadSpeedLimitEnabled", snapSettings.uploadSpeedLimitEnabled)
          put("uploadSpeedLimitValue", snapSettings.uploadSpeedLimitValue)
          put("uploadSpeedLimitUnit", snapSettings.uploadSpeedLimitUnit.name)
          put("maxConcurrentDownloads", snapSettings.maxConcurrentDownloads)
          put("httpConnections", snapSettings.httpConnections)
          put("maxRetries", snapSettings.maxRetries)
          put("duplicatePolicy", snapSettings.duplicatePolicy.name)
          put("queueMode", snapSettings.queueMode.name)
          put("gamingModeEnabled", snapSettings.gamingModeEnabled)
          put("gamingModeProfile", snapSettings.gamingModeProfile.name)
          put("detectMultiPartEnabled", snapSettings.detectMultiPartEnabled)
          put("wifiOnlyDownloads", snapSettings.wifiOnlyDownloads)
          put("keepAwakeDuringDownload", snapSettings.keepAwakeDuringDownload)
          put("keepSeedingAfterComplete", snapSettings.keepSeedingAfterComplete)
          put("autoResumeOnStart", snapSettings.autoResumeOnStart)
          put("completionNotifications", snapSettings.completionNotifications)
          put("completionSound", snapSettings.completionSound)
          put("watchClipboard", snapSettings.watchClipboard)
          put("autoCheckUpdates", snapSettings.autoCheckUpdates)
          put("hideUpdatePrompt", snapSettings.hideUpdatePrompt)
          put("themeMode", snapSettings.themeMode.name)
          put("fontScale", snapSettings.fontScale.name)
          put("language", snapSettings.language.name)
          put(
            "customColors",
            JSONObject().apply {
              put("bgCanvasHex", snapSettings.customColors.bgCanvasHex)
              put("bgSurfaceHex", snapSettings.customColors.bgSurfaceHex)
              put("bgElevatedHex", snapSettings.customColors.bgElevatedHex)
              put("accentHex", snapSettings.customColors.accentHex)
              put("textPrimaryHex", snapSettings.customColors.textPrimaryHex)
              put("textSecondaryHex", snapSettings.customColors.textSecondaryHex)
            },
          )
        }
        root.put("settings", settingsObj)

        val dlArr = JSONArray()
        for (d in snapDownloads) {
          val obj = JSONObject().apply {
            put("id", d.id)
            put("kind", d.kind.name)
            put("source", d.source)
            put("name", d.name)
            put("saveDir", d.saveDir)
            put("filePath", d.filePath)
            put("category", d.category.name)
            put("status", d.status.name)
            if (d.totalBytes != null) put("totalBytes", d.totalBytes)
            put("downloadedBytes", d.downloadedBytes)
            put("uploadedBytes", d.uploadedBytes)
            put("resumeSupported", d.resumeSupported)
            put("addedAt", d.addedAt)
            if (d.completedAt != null) put("completedAt", d.completedAt)
            put("retryCount", d.retryCount)
            if (d.errorMessage != null) put("errorMessage", d.errorMessage)
            if (d.mediaFormat != null) put("mediaFormat", d.mediaFormat)
            if (d.mediaQuality != null) put("mediaQuality", d.mediaQuality)
            if (d.schedule != null) {
              put(
                "schedule",
                JSONObject().apply {
                  if (d.schedule.startAt != null) put("startAt", d.schedule.startAt)
                  if (d.schedule.stopAt != null) put("stopAt", d.schedule.stopAt)
                  put("wifiOnly", d.schedule.wifiOnly)
                },
              )
            }
            val segArr = JSONArray()
            for (s in d.segments) {
              segArr.put(
                JSONObject().apply {
                  put("index", s.index)
                  put("start", s.start)
                  put("end", s.end)
                  put("downloaded", s.downloaded)
                  put("status", s.status.name)
                }
              )
            }
            put("segments", segArr)
            if (d.torrent != null) {
              put(
                "torrent",
                JSONObject().apply {
                  put("infoHash", d.torrent.infoHash)
                  put("peers", d.torrent.peers)
                  put("seeds", d.torrent.seeds)
                  put("ratio", d.torrent.ratio.toDouble())
                  put("trackers", JSONArray(d.torrent.trackers))
                  put("webSeeds", JSONArray(d.torrent.webSeeds))
                  if (d.torrent.magnetUri != null) put("magnetUri", d.torrent.magnetUri)
                  val fArr = JSONArray()
                  for (f in d.torrent.files) {
                    fArr.put(
                      JSONObject().apply {
                        put("index", f.index)
                        put("name", f.name)
                        put("path", f.path)
                        put("length", f.length)
                        put("downloaded", f.downloaded)
                        put("selected", f.selected)
                      }
                    )
                  }
                  put("files", fArr)
                },
              )
            }
          }
          dlArr.put(obj)
        }
        root.put("downloads", dlArr)
        stateFile.writeText(root.toString())
      } catch (_: Exception) {
      }
    }
  }

  private fun loadState() {
    if (!stateFile.exists()) return
    try {
      val root = JSONObject(stateFile.readText())
      val sObj = root.optJSONObject("settings")
      if (sObj != null) {
        val ccObj = sObj.optJSONObject("customColors")
        val loadedSettings = AppSettings(
          defaultDownloadDir = sObj.optString("defaultDownloadDir", defaultDownloadsDir).ifBlank { defaultDownloadsDir },
          folderRoutingMode = runCatching { FolderRoutingMode.valueOf(sObj.optString("folderRoutingMode")) }.getOrDefault(FolderRoutingMode.SINGLE),
          showConfirmationDialog = sObj.optBoolean("showConfirmationDialog", true),
          showProgressPopupOnStart = sObj.optBoolean("showProgressPopupOnStart", true),
          downloadSpeedLimitEnabled = sObj.optBoolean("downloadSpeedLimitEnabled", false),
          downloadSpeedLimitValue = sObj.optInt("downloadSpeedLimitValue", 4).coerceAtLeast(1),
          downloadSpeedLimitUnit = runCatching { SpeedUnit.valueOf(sObj.optString("downloadSpeedLimitUnit")) }.getOrDefault(SpeedUnit.MB_S),
          uploadSpeedLimitEnabled = sObj.optBoolean("uploadSpeedLimitEnabled", false),
          uploadSpeedLimitValue = sObj.optInt("uploadSpeedLimitValue", 512).coerceAtLeast(1),
          uploadSpeedLimitUnit = runCatching { SpeedUnit.valueOf(sObj.optString("uploadSpeedLimitUnit")) }.getOrDefault(SpeedUnit.KB_S),
          maxConcurrentDownloads = sObj.optInt("maxConcurrentDownloads", 3).coerceIn(1, 10),
          httpConnections = sObj.optInt("httpConnections", 16).coerceIn(1, 32),
          maxRetries = sObj.optInt("maxRetries", 3).coerceIn(0, 10),
          duplicatePolicy = runCatching { DuplicatePolicy.valueOf(sObj.optString("duplicatePolicy")) }.getOrDefault(DuplicatePolicy.AUTO_RENAME),
          queueMode = runCatching { QueueMode.valueOf(sObj.optString("queueMode")) }.getOrDefault(QueueMode.PARALLEL),
          gamingModeEnabled = sObj.optBoolean("gamingModeEnabled", false),
          gamingModeProfile = runCatching { GamingModeProfile.valueOf(sObj.optString("gamingModeProfile")) }.getOrDefault(GamingModeProfile.SURFING),
          detectMultiPartEnabled = sObj.optBoolean("detectMultiPartEnabled", true),
          wifiOnlyDownloads = sObj.optBoolean("wifiOnlyDownloads", false),
          keepAwakeDuringDownload = sObj.optBoolean("keepAwakeDuringDownload", true),
          autoPowerAction = PowerAction.OFF,
          keepSeedingAfterComplete = sObj.optBoolean("keepSeedingAfterComplete", false),
          autoResumeOnStart = sObj.optBoolean("autoResumeOnStart", true),
          completionNotifications = sObj.optBoolean("completionNotifications", true),
          completionSound = sObj.optBoolean("completionSound", true),
          watchClipboard = sObj.optBoolean("watchClipboard", true),
          autoCheckUpdates = sObj.optBoolean("autoCheckUpdates", true),
          hideUpdatePrompt = sObj.optBoolean("hideUpdatePrompt", false),
          themeMode = runCatching { ThemeMode.valueOf(sObj.optString("themeMode")) }.getOrDefault(ThemeMode.DARK),
          fontScale = runCatching { FontScale.valueOf(sObj.optString("fontScale")) }.getOrDefault(FontScale.DEFAULT),
          language = runCatching { AppLanguage.valueOf(sObj.optString("language")) }.getOrDefault(AppLanguage.EN),
          customColors = if (ccObj != null) {
            CustomThemeColors(
              bgCanvasHex = ccObj.optString("bgCanvasHex", "#121215"),
              bgSurfaceHex = ccObj.optString("bgSurfaceHex", "#1A1A1F"),
              bgElevatedHex = ccObj.optString("bgElevatedHex", "#23232A"),
              accentHex = ccObj.optString("accentHex", "#C81E3D"),
              textPrimaryHex = ccObj.optString("textPrimaryHex", "#F5F5F9"),
              textSecondaryHex = ccObj.optString("textSecondaryHex", "#B4B4C2"),
            )
          } else {
            CustomThemeColors()
          },
        )
        _settings.value = loadedSettings
      }

      val dlArr = root.optJSONArray("downloads")
      if (dlArr != null) {
        val loadedList = mutableListOf<DownloadItem>()
        val autoResume = _settings.value.autoResumeOnStart
        for (i in 0 until dlArr.length()) {
          val obj = dlArr.optJSONObject(i) ?: continue
          val rawStatus = runCatching { DownloadStatus.valueOf(obj.optString("status")) }.getOrDefault(DownloadStatus.PAUSED)
          val normalizedStatus = when (rawStatus) {
            DownloadStatus.DOWNLOADING, DownloadStatus.PROBING, DownloadStatus.QUEUED ->
              if (autoResume) DownloadStatus.QUEUED else DownloadStatus.PAUSED
            DownloadStatus.SEEDING ->
              if (_settings.value.keepSeedingAfterComplete && autoResume) DownloadStatus.SEEDING else DownloadStatus.COMPLETED
            else -> rawStatus
          }

          val segs = mutableListOf<SegmentInfo>()
          val segArr = obj.optJSONArray("segments")
          if (segArr != null) {
            for (j in 0 until segArr.length()) {
              val sObj2 = segArr.optJSONObject(j) ?: continue
              val st = runCatching { SegmentStatus.valueOf(sObj2.optString("status")) }.getOrDefault(SegmentStatus.PENDING)
              segs.add(
                SegmentInfo(
                  index = sObj2.optInt("index", j),
                  start = sObj2.optLong("start", 0L),
                  end = sObj2.optLong("end", -1L),
                  downloaded = sObj2.optLong("downloaded", 0L),
                  speed = 0L,
                  status = if (st == SegmentStatus.DONE) SegmentStatus.DONE else SegmentStatus.PENDING,
                )
              )
            }
          }

          val tObj = obj.optJSONObject("torrent")
          val torrentMeta = if (tObj != null) {
            val trList = mutableListOf<String>()
            val trArr = tObj.optJSONArray("trackers")
            if (trArr != null) {
              for (k in 0 until trArr.length()) trList.add(trArr.optString(k))
            }
            val wsList = mutableListOf<String>()
            val wsArr = tObj.optJSONArray("webSeeds")
            if (wsArr != null) {
              for (k in 0 until wsArr.length()) wsList.add(wsArr.optString(k))
            }
            val fList = mutableListOf<TorrentFileInfo>()
            val fArr = tObj.optJSONArray("files")
            if (fArr != null) {
              for (k in 0 until fArr.length()) {
                val fo = fArr.optJSONObject(k) ?: continue
                fList.add(
                  TorrentFileInfo(
                    index = fo.optInt("index", k),
                    name = fo.optString("name", "file_$k"),
                    path = fo.optString("path", "file_$k"),
                    length = fo.optLong("length", 0L),
                    downloaded = fo.optLong("downloaded", 0L),
                    selected = fo.optBoolean("selected", true),
                  )
                )
              }
            }
            TorrentMeta(
              infoHash = tObj.optString("infoHash", ""),
              peers = 0,
              seeds = 0,
              ratio = tObj.optDouble("ratio", 0.0).toFloat(),
              trackers = trList,
              webSeeds = wsList,
              magnetUri = tObj.optString("magnetUri", "").ifBlank { null },
              files = fList,
            )
          } else {
            null
          }

          val schedObj = obj.optJSONObject("schedule")
          val schedule = if (schedObj != null) {
            DownloadSchedule(
              startAt = if (schedObj.has("startAt")) schedObj.optLong("startAt") else null,
              stopAt = if (schedObj.has("stopAt")) schedObj.optLong("stopAt") else null,
              wifiOnly = schedObj.optBoolean("wifiOnly", false),
            )
          } else {
            null
          }

          val kind = runCatching { DownloadKind.valueOf(obj.optString("kind")) }.getOrDefault(DownloadKind.HTTP)
          val name = obj.optString("name", "download.bin")
          loadedList.add(
            DownloadItem(
              id = obj.optString("id", UUID.randomUUID().toString()),
              kind = kind,
              source = obj.optString("source", ""),
              name = name,
              saveDir = obj.optString("saveDir", defaultDownloadsDir),
              filePath = obj.optString("filePath", File(defaultDownloadsDir, name).absolutePath),
              category = runCatching { FileCategory.valueOf(obj.optString("category")) }.getOrDefault(FormatUtils.classifyFileName(name, kind)),
              status = normalizedStatus,
              totalBytes = if (obj.has("totalBytes")) obj.optLong("totalBytes") else null,
              downloadedBytes = obj.optLong("downloadedBytes", 0L),
              uploadedBytes = obj.optLong("uploadedBytes", 0L),
              resumeSupported = obj.optBoolean("resumeSupported", false),
              segments = segs,
              torrent = torrentMeta,
              errorMessage = obj.optString("errorMessage", "").ifBlank { null },
              addedAt = obj.optLong("addedAt", System.currentTimeMillis()),
              completedAt = if (obj.has("completedAt")) obj.optLong("completedAt") else null,
              retryCount = obj.optInt("retryCount", 0),
              schedule = schedule,
              mediaFormat = obj.optString("mediaFormat", "").ifBlank { null },
              mediaQuality = obj.optString("mediaQuality", "").ifBlank { null },
            )
          )
        }
        _downloads.value = loadedList
      }
    } catch (_: Exception) {
    }
  }
}
