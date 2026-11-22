package com.myload.app.model

import androidx.compose.runtime.Immutable
import java.io.File
import java.net.URI
import java.net.URLDecoder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToLong

enum class DownloadKind(val label: String) {
  HTTP("HTTP"),
  TORRENT("Torrent"),
  MEDIA("Media"),
}

enum class DownloadStatus(val label: String) {
  QUEUED("Queued"),
  PROBING("Connecting..."),
  DOWNLOADING("Downloading"),
  SEEDING("Seeding"),
  PAUSED("Paused"),
  COMPLETED("Completed"),
  ERROR("Error"),
}

enum class FileCategory(val id: String, val label: String, val extensionsHint: String) {
  TORRENTS("torrents", "Torrents", "magnet links & .torrent files"),
  VIDEOS("videos", "Videos", "mp4, mkv, avi, mov, webm..."),
  IMAGES("images", "Images", "jpg, png, gif, webp, svg..."),
  DOCS("docs", "Documents", "pdf, docx, xlsx, txt, epub..."),
  ARCHIVES("archives", "Archives", "zip, rar, 7z, tar, iso, .001..."),
  OTHER("other", "Other", "apk, exe, mp3, flac, bin..."),
}

enum class CategoryFilter(val id: String, val label: String) {
  ALL("all", "All"),
  ACTIVE("active", "Active"),
  COMPLETED("completed", "Completed"),
  TORRENTS("torrents", "Torrents"),
  VIDEOS("videos", "Videos"),
  IMAGES("images", "Images"),
  DOCS("docs", "Docs"),
  ARCHIVES("archives", "Archives"),
  OTHER("other", "Other"),
}

enum class SortBy(val label: String) {
  NEWEST("Newest"),
  OLDEST("Oldest"),
  NAME("Name (A-Z)"),
  SIZE("Size"),
  PROGRESS("Progress"),
  STATUS("Status"),
}

enum class QueueMode(val title: String, val description: String) {
  PARALLEL("Parallel (Default)", "Run up to max concurrent downloads simultaneously at full speed."),
  SEQUENTIAL("Finish → Download Next", "Download one file at a time; start the next queued file when finished."),
  PARALLEL_EQUAL("Equal Speed Split", "Divide available bandwidth evenly across active downloads."),
}

enum class DuplicatePolicy(val label: String) {
  AUTO_RENAME("Auto-rename (file (1).ext)"),
  OVERWRITE("Overwrite existing file"),
  ASK("Ask before downloading"),
}

enum class SpeedUnit(val label: String, val multiplierBytes: Long) {
  KB_S("KB/s", 1024L),
  MB_S("MB/s", 1024L * 1024L),
}

enum class GamingModeProfile(val title: String, val description: String, val maxSegments: Int) {
  SURFING("Surfing & Streaming (Balanced)", "Keeps speeds high (up to 4 segments) while protecting streams & browsing.", 4),
  GAMING("Gaming (Low Latency)", "Strict ping & jitter guard (max 2 segments) for zero lag spikes.", 2),
}

enum class ThemeMode(val label: String) {
  DARK("Dark (MyLoad Crimson)"),
  LIGHT("Light"),
  SYSTEM("Follow Android System"),
  HIGH_CONTRAST("High Contrast"),
  CUSTOM("Custom Hex Theme"),
}

enum class FontScale(val label: String, val factor: Float) {
  COMPACT("Compact", 0.92f),
  DEFAULT("Default", 1.0f),
  LARGE("Large", 1.1f),
}

enum class PowerAction(val label: String) {
  OFF("Off"),
  NOTIFICATION_SOUND("Alert & Completion Chime"),
  RELEASE_WAKELOCK("Release WakeLock & Idle"),
  EXIT_APP("Close MyLoad Background Service"),
}

enum class FolderRoutingMode(val label: String) {
  SINGLE("Single Default Folder"),
  PER_CATEGORY("Per-Category Subfolders"),
}

enum class SegmentStatus {
  PENDING,
  ACTIVE,
  DONE,
  ERROR,
}

enum class SocialPlatform(val label: String) {
  YOUTUBE("YouTube"),
  INSTAGRAM("Instagram"),
  TIKTOK("TikTok"),
  SPOTIFY("Spotify"),
  CUSTOM("Custom URL"),
}

enum class ScannableMediaKind(val label: String) {
  VIDEO("Video"),
  AUDIO("Audio"),
  IMAGE("Image"),
}

enum class AppLanguage(val code: String, val nativeName: String, val isRtl: Boolean) {
  EN("en", "English", false),
  FA("fa", "فارسی (Persian)", true),
  AR("ar", "العربية (Arabic)", true),
  ES("es", "Español", false),
  FR("fr", "Français", false),
  DE("de", "Deutsch", false),
  RU("ru", "Русский", false),
  ZH("zh", "中文 (简体)", false),
  TR("tr", "Türkçe", false),
}

@Immutable
data class SegmentInfo(
  val index: Int,
  val start: Long,
  val end: Long,
  val downloaded: Long = 0L,
  val speed: Long = 0L,
  val status: SegmentStatus = SegmentStatus.PENDING,
) {
  val totalLength: Long?
    get() = if (end >= start) (end - start + 1L) else null

  val progressFraction: Float
    get() {
      val len = totalLength ?: return 0f
      if (len <= 0L) return 0f
      return (downloaded.toDouble() / len.toDouble()).toFloat().coerceIn(0f, 1f)
    }
}

@Immutable
data class TorrentFileInfo(
  val index: Int,
  val name: String,
  val path: String,
  val length: Long,
  val downloaded: Long = 0L,
  val selected: Boolean = true,
)

@Immutable
data class TorrentMeta(
  val infoHash: String,
  val peers: Int = 0,
  val seeds: Int = 0,
  val ratio: Float = 0f,
  val trackers: List<String> = emptyList(),
  val magnetUri: String? = null,
  val webSeeds: List<String> = emptyList(),
  val pieceLength: Long = 262144L,
  val files: List<TorrentFileInfo> = emptyList(),
)

@Immutable
data class DownloadSchedule(
  val startAt: Long? = null,
  val stopAt: Long? = null,
  val wifiOnly: Boolean = false,
)

@Immutable
data class DownloadItem(
  val id: String,
  val kind: DownloadKind,
  val source: String,
  val name: String,
  val saveDir: String,
  val filePath: String,
  val category: FileCategory,
  val status: DownloadStatus,
  val totalBytes: Long?,
  val downloadedBytes: Long = 0L,
  val uploadedBytes: Long = 0L,
  val downloadSpeed: Long = 0L,
  val uploadSpeed: Long = 0L,
  val etaSeconds: Long? = null,
  val resumeSupported: Boolean = false,
  val segments: List<SegmentInfo> = emptyList(),
  val torrent: TorrentMeta? = null,
  val requestHeaders: Map<String, String> = emptyMap(),
  val errorMessage: String? = null,
  val addedAt: Long = System.currentTimeMillis(),
  val completedAt: Long? = null,
  val retryCount: Int = 0,
  val schedule: DownloadSchedule? = null,
  val mediaFormat: String? = null,
  val mediaQuality: String? = null,
) {
  val progressFraction: Float
    get() {
      if (status == DownloadStatus.COMPLETED) return 1f
      val tot = totalBytes ?: return 0f
      if (tot <= 0L) return 0f
      return (downloadedBytes.toDouble() / tot.toDouble()).toFloat().coerceIn(0f, 1f)
    }

  val progressPercent: Int
    get() = (progressFraction * 100f).toInt().coerceIn(0, 100)

  val isRunning: Boolean
    get() =
      status == DownloadStatus.DOWNLOADING ||
        status == DownloadStatus.PROBING ||
        status == DownloadStatus.QUEUED ||
        status == DownloadStatus.SEEDING
}

@Immutable
data class ProbeResult(
  val kind: DownloadKind,
  val source: String,
  val finalUrl: String,
  val fileName: String,
  val totalBytes: Long?,
  val resumeSupported: Boolean,
  val category: FileCategory,
  val infoHash: String? = null,
  val trackers: List<String> = emptyList(),
  val webSeeds: List<String> = emptyList(),
  val files: List<TorrentFileInfo> = emptyList(),
  val warning: String? = null,
)

@Immutable
data class MultiPartCandidate(
  val url: String,
  val fileName: String,
  val partNumber: Int,
  val totalBytes: Long?,
  val isOriginal: Boolean,
)

@Immutable
data class MultiPartScanResult(
  val matched: Boolean,
  val baseName: String,
  val parts: List<MultiPartCandidate> = emptyList(),
)

@Immutable
data class SocialMediaItem(
  val id: String,
  val index: Int,
  val kind: ScannableMediaKind,
  val title: String,
  val sourceUrl: String,
  val ext: String,
  val qualityLabel: String = "Best",
  val sizeBytes: Long? = null,
  val durationSeconds: Int? = null,
  val artist: String? = null,
)

@Immutable
data class SocialScanResult(
  val ok: Boolean,
  val platform: SocialPlatform,
  val url: String,
  val title: String,
  val author: String? = null,
  val items: List<SocialMediaItem> = emptyList(),
  val error: String? = null,
)

@Immutable
data class NetworkBalanceStats(
  val enabled: Boolean = false,
  val active: Boolean = false,
  val rttMs: Int? = null,
  val baselineRttMs: Int? = null,
  val jitterMs: Int? = null,
  val effectiveDownloadLimit: Long? = null,
  val effectiveUploadLimit: Long? = null,
  val state: String = "idle",
)

@Immutable
data class LogEntry(
  val id: String,
  val timestamp: Long,
  val level: String,
  val scope: String,
  val message: String,
  val downloadId: String? = null,
)

@Immutable
data class UpdateStatus(
  val state: String = "idle",
  val currentVersion: String = "1.0.12",
  val latestVersion: String? = null,
  val releaseName: String? = null,
  val releaseNotes: String? = null,
  val releaseUrl: String = "https://github.com/arshiatxd/MLDM-MyLoadDownloadManager/releases/latest",
  val assetName: String? = null,
  val assetUrl: String? = null,
  val assetSize: Long? = null,
  val error: String? = null,
)

@Immutable
data class CustomThemeColors(
  val bgCanvasHex: String = "#121215",
  val bgSurfaceHex: String = "#1A1A1F",
  val bgElevatedHex: String = "#23232A",
  val accentHex: String = "#C81E3D",
  val textPrimaryHex: String = "#F5F5F9",
  val textSecondaryHex: String = "#B4B4C2",
)

@Immutable
data class AppSettings(
  val defaultDownloadDir: String,
  val folderRoutingMode: FolderRoutingMode = FolderRoutingMode.SINGLE,
  val showConfirmationDialog: Boolean = true,
  val showProgressPopupOnStart: Boolean = true,
  val downloadSpeedLimitEnabled: Boolean = false,
  val downloadSpeedLimitValue: Int = 4,
  val downloadSpeedLimitUnit: SpeedUnit = SpeedUnit.MB_S,
  val uploadSpeedLimitEnabled: Boolean = false,
  val uploadSpeedLimitValue: Int = 512,
  val uploadSpeedLimitUnit: SpeedUnit = SpeedUnit.KB_S,
  val maxConcurrentDownloads: Int = 3,
  val httpConnections: Int = 16,
  val maxRetries: Int = 3,
  val duplicatePolicy: DuplicatePolicy = DuplicatePolicy.AUTO_RENAME,
  val queueMode: QueueMode = QueueMode.PARALLEL,
  val gamingModeEnabled: Boolean = false,
  val gamingModeProfile: GamingModeProfile = GamingModeProfile.SURFING,
  val detectMultiPartEnabled: Boolean = true,
  val wifiOnlyDownloads: Boolean = false,
  val keepAwakeDuringDownload: Boolean = true,
  val autoPowerAction: PowerAction = PowerAction.OFF,
  val keepSeedingAfterComplete: Boolean = false,
  val autoResumeOnStart: Boolean = true,
  val completionNotifications: Boolean = true,
  val completionSound: Boolean = true,
  val watchClipboard: Boolean = true,
  val autoCheckUpdates: Boolean = true,
  val hideUpdatePrompt: Boolean = false,
  val themeMode: ThemeMode = ThemeMode.DARK,
  val fontScale: FontScale = FontScale.DEFAULT,
  val customColors: CustomThemeColors = CustomThemeColors(),
  val language: AppLanguage = AppLanguage.EN,
) {
  val configuredDownloadLimitBytesPerSec: Long?
    get() =
      if (downloadSpeedLimitEnabled && downloadSpeedLimitValue > 0) {
        downloadSpeedLimitValue.toLong() * downloadSpeedLimitUnit.multiplierBytes
      } else {
        null
      }

  val configuredUploadLimitBytesPerSec: Long?
    get() =
      if (uploadSpeedLimitEnabled && uploadSpeedLimitValue > 0) {
        uploadSpeedLimitValue.toLong() * uploadSpeedLimitUnit.multiplierBytes
      } else {
        null
      }
}

object I18n {
  private val strings: Map<AppLanguage, Map<String, String>> = mapOf(
    AppLanguage.EN to mapOf(
      "appTitle" to "MyLoad Download Manager",
      "addDownload" to "Add download",
      "resume" to "Resume",
      "pause" to "Pause",
      "pauseAll" to "Pause all",
      "remove" to "Remove",
      "deleteAll" to "Delete all",
      "searchPlaceholder" to "Search in downloads...",
      "emptyList" to "No downloads yet. Tap \"+ Add\" or use the built-in Browser / Media Grabber.",
      "noMatch" to "No downloads match the current filter or search.",
      "settings" to "Settings",
      "logs" to "Logs",
      "mediaGrabber" to "Media Grabber",
      "browser" to "Browser",
      "inspector" to "Inspector",
    ),
    AppLanguage.FA to mapOf(
      "appTitle" to "مدیریت دانلود MyLoad",
      "addDownload" to "افزودن دانلود",
      "resume" to "ادامه",
      "pause" to "توقف",
      "pauseAll" to "توقف همه",
      "remove" to "حذف",
      "deleteAll" to "حذف همه",
      "searchPlaceholder" to "جستجو در دانلودها...",
      "emptyList" to "هنوز دانلودی وجود ندارد. روی «+ افزودن» یا مرورگر و اسکنر رسانه بزنید.",
      "noMatch" to "موردی با فیلتر یا جستجوی فعلی مطابقت ندارد.",
      "settings" to "تنظیمات",
      "logs" to "گزارش‌ها",
      "mediaGrabber" to "دریافت رسانه",
      "browser" to "مرورگر",
      "inspector" to "جزئیات",
    ),
    AppLanguage.AR to mapOf(
      "appTitle" to "مدير التحميل MyLoad",
      "addDownload" to "إضافة تحميل",
      "resume" to "استئناف",
      "pause" to "إيقاف مؤقت",
      "pauseAll" to "إيقاف الكل",
      "remove" to "حذف",
      "deleteAll" to "حذف الكل",
      "searchPlaceholder" to "البحث في التنزيلات...",
      "emptyList" to "لا توجد تنزيلات بعد. اضغط على + إضافة أو المتصفح المدمج.",
      "noMatch" to "لا توجد تنزيلات تطابق الفلتر الحالي.",
      "settings" to "الإعدادات",
      "logs" to "السجلات",
      "mediaGrabber" to "ملتقط الوسائط",
      "browser" to "المتصفح",
      "inspector" to "الفاحص",
    ),
    AppLanguage.ES to mapOf(
      "appTitle" to "MyLoad Gestor de Descargas",
      "addDownload" to "Añadir descarga",
      "resume" to "Reanudar",
      "pause" to "Pausar",
      "pauseAll" to "Pausar todo",
      "remove" to "Eliminar",
      "deleteAll" to "Eliminar todo",
      "searchPlaceholder" to "Buscar en descargas...",
      "emptyList" to "Aún no hay descargas. Toca \"+ Añadir\" o usa el navegador integrado.",
      "noMatch" to "Ninguna descarga coincide con el filtro actual.",
      "settings" to "Ajustes",
      "logs" to "Registros",
      "mediaGrabber" to "Extractor Multimedia",
      "browser" to "Navegador",
      "inspector" to "Inspector",
    ),
    AppLanguage.FR to mapOf(
      "appTitle" to "MyLoad Gestionnaire",
      "addDownload" to "Ajouter",
      "resume" to "Reprendre",
      "pause" to "Pause",
      "pauseAll" to "Tout suspendre",
      "remove" to "Supprimer",
      "deleteAll" to "Tout supprimer",
      "searchPlaceholder" to "Rechercher...",
      "emptyList" to "Aucun téléchargement. Appuyez sur \"+ Ajouter\".",
      "noMatch" to "Aucun téléchargement correspondant.",
      "settings" to "Paramètres",
      "logs" to "Journaux",
      "mediaGrabber" to "Médias",
      "browser" to "Navigateur",
      "inspector" to "Inspecteur",
    ),
    AppLanguage.DE to mapOf(
      "appTitle" to "MyLoad Download-Manager",
      "addDownload" to "Hinzufügen",
      "resume" to "Fortsetzen",
      "pause" to "Pause",
      "pauseAll" to "Alle pausieren",
      "remove" to "Entfernen",
      "deleteAll" to "Alle löschen",
      "searchPlaceholder" to "Downloads durchsuchen...",
      "emptyList" to "Noch keine Downloads vorhanden.",
      "noMatch" to "Keine passenden Downloads gefunden.",
      "settings" to "Einstellungen",
      "logs" to "Protokolle",
      "mediaGrabber" to "Medien-Scanner",
      "browser" to "Browser",
      "inspector" to "Inspektor",
    ),
    AppLanguage.RU to mapOf(
      "appTitle" to "MyLoad Менеджер загрузок",
      "addDownload" to "Добавить",
      "resume" to "Возобновить",
      "pause" to "Пауза",
      "pauseAll" to "Пауза всех",
      "remove" to "Удалить",
      "deleteAll" to "Удалить все",
      "searchPlaceholder" to "Поиск загрузок...",
      "emptyList" to "Загрузок пока нет. Нажмите «+ Добавить».",
      "noMatch" to "Нет загрузок по текущему фильтру.",
      "settings" to "Настройки",
      "logs" to "Журнал",
      "mediaGrabber" to "Медиа-сканер",
      "browser" to "Браузер",
      "inspector" to "Инспектор",
    ),
    AppLanguage.ZH to mapOf(
      "appTitle" to "MyLoad 下载管理器",
      "addDownload" to "添加下载",
      "resume" to "继续",
      "pause" to "暂停",
      "pauseAll" to "全部暂停",
      "remove" to "移除",
      "deleteAll" to "全部删除",
      "searchPlaceholder" to "搜索下载任务...",
      "emptyList" to "暂无下载任务，点击“+ 添加”或使用内置浏览器与媒体嗅探器。",
      "noMatch" to "没有符合当前筛选条件的任务。",
      "settings" to "设置",
      "logs" to "日志",
      "mediaGrabber" to "媒体嗅探",
      "browser" to "浏览器",
      "inspector" to "详情",
    ),
    AppLanguage.TR to mapOf(
      "appTitle" to "MyLoad İndirme Yöneticisi",
      "addDownload" to "İndirme ekle",
      "resume" to "Devam et",
      "pause" to "Duraklat",
      "pauseAll" to "Tümünü duraklat",
      "remove" to "Kaldır",
      "deleteAll" to "Tümünü sil",
      "searchPlaceholder" to "İndirmelerde ara...",
      "emptyList" to "Henüz indirme yok. \"+ Ekle\" düğmesine dokunun.",
      "noMatch" to "Filtreyle eşleşen indirme bulunamadı.",
      "settings" to "Ayarlar",
      "logs" to "Günlükler",
      "mediaGrabber" to "Medya Yakalayıcı",
      "browser" to "Tarayıcı",
      "inspector" to "Denetçi",
    ),
  )

  fun t(lang: AppLanguage, key: String): String {
    return strings[lang]?.get(key) ?: strings[AppLanguage.EN]?.get(key) ?: key
  }
}

object FormatUtils {
  private val VIDEO_EXT = setOf("mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "m4v", "ts", "3gp")
  private val IMAGE_EXT = setOf("jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico", "avif", "heic")
  private val DOC_EXT = setOf("pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "epub", "md", "rtf")
  private val ARCHIVE_EXT = setOf("zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso", "tgz", "z01", "001")
  private val TORRENT_EXT = setOf("torrent")

  fun formatBytes(bytes: Long?): String {
    val b = bytes ?: return "Unknown"
    if (b < 0L) return "Unknown"
    if (b < 1024L) return "$b B"
    val kb = b / 1024.0
    if (kb < 1024.0) return String.format(Locale.US, "%.1f KB", kb)
    val mb = kb / 1024.0
    if (mb < 1024.0) return String.format(Locale.US, "%.2f MB", mb)
    val gb = mb / 1024.0
    return String.format(Locale.US, "%.2f GB", gb)
  }

  fun formatSpeed(bytesPerSec: Long): String {
    if (bytesPerSec <= 0L) return "0 B/s"
    if (bytesPerSec < 1024L) return "$bytesPerSec B/s"
    val kb = bytesPerSec / 1024.0
    if (kb < 1024.0) return String.format(Locale.US, "%.1f KB/s", kb)
    val mb = kb / 1024.0
    return String.format(Locale.US, "%.2f MB/s", mb)
  }

  fun formatEta(seconds: Long?): String {
    val s = seconds ?: return "—"
    if (s <= 0L || s > 86400L * 30L) return "—"
    if (s < 60L) return "${s}s"
    val m = s / 60L
    val remS = s % 60L
    if (m < 60L) return "${m}m ${remS}s"
    val h = m / 60L
    val remM = m % 60L
    return "${h}h ${remM}m"
  }

  fun formatDateShort(epochMs: Long): String {
    return try {
      SimpleDateFormat("MMM d, HH:mm", Locale.US).format(Date(epochMs))
    } catch (_: Exception) {
      ""
    }
  }

  fun sanitizeFileName(raw: String): String {
    val cleaned = raw
      .replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001F]"), "_")
      .trim()
      .trimEnd('.')
    if (cleaned.isEmpty()) return "download.bin"
    return if (cleaned.length > 180) cleaned.take(180) else cleaned
  }

  fun classifyFileName(fileName: String, kind: DownloadKind): FileCategory {
    if (kind == DownloadKind.TORRENT) return FileCategory.TORRENTS
    if (kind == DownloadKind.MEDIA) {
      val ext = fileName.substringAfterLast('.', "").lowercase(Locale.US)
      return when {
        ext in IMAGE_EXT -> FileCategory.IMAGES
        ext in VIDEO_EXT || ext in setOf("mp3", "m4a", "wav", "flac", "opus", "aac") -> FileCategory.VIDEOS
        else -> FileCategory.VIDEOS
      }
    }
    val lower = fileName.lowercase(Locale.US)
    if (Regex("\\.(part\\d+\\.rar|r\\d{2}|z\\d{2}|\\d{3})$").containsMatchIn(lower)) {
      return FileCategory.ARCHIVES
    }
    val ext = lower.substringAfterLast('.', "")
    return when {
      ext in TORRENT_EXT -> FileCategory.TORRENTS
      ext in VIDEO_EXT -> FileCategory.VIDEOS
      ext in IMAGE_EXT -> FileCategory.IMAGES
      ext in DOC_EXT -> FileCategory.DOCS
      ext in ARCHIVE_EXT -> FileCategory.ARCHIVES
      else -> FileCategory.OTHER
    }
  }

  fun isMagnetUri(source: String): Boolean {
    return source.trim().startsWith("magnet:?xt=urn:btih:", ignoreCase = true)
  }

  fun isHttpUrl(source: String): Boolean {
    val s = source.trim()
    return s.startsWith("http://", ignoreCase = true) || s.startsWith("https://", ignoreCase = true)
  }

  fun deriveNameFromSource(source: String): String {
    val trimmed = source.trim()
    if (isMagnetUri(trimmed)) {
      val dnMatch = Regex("[?&]dn=([^&]+)", RegexOption.IGNORE_CASE).find(trimmed)
      if (dnMatch != null) {
        return try {
          sanitizeFileName(URLDecoder.decode(dnMatch.groupValues[1], "UTF-8"))
        } catch (_: Exception) {
          sanitizeFileName(dnMatch.groupValues[1])
        }
      }
      val hashMatch = Regex("btih:([a-fA-F0-9]{8,40})").find(trimmed)
      val shortHash = hashMatch?.groupValues?.get(1)?.take(8) ?: "magnet"
      return "Torrent-$shortHash"
    }
    return try {
      val uri = URI(trimmed)
      val path = uri.path ?: ""
      val last = path.split('/').lastOrNull { it.isNotBlank() } ?: "download.bin"
      sanitizeFileName(URLDecoder.decode(last, "UTF-8"))
    } catch (_: Exception) {
      sanitizeFileName(trimmed.substringAfterLast('/').substringBefore('?').ifBlank { "download.bin" })
    }
  }

  fun extractMultipleSources(rawText: String): List<String> {
    return rawText
      .lineSequence()
      .map { it.trim() }
      .filter { it.isNotEmpty() && (isHttpUrl(it) || isMagnetUri(it)) }
      .distinct()
      .toList()
  }

  fun matchesCategory(item: DownloadItem, filter: CategoryFilter): Boolean {
    return when (filter) {
      CategoryFilter.ALL -> true
      CategoryFilter.ACTIVE ->
        item.status == DownloadStatus.DOWNLOADING ||
          item.status == DownloadStatus.PROBING ||
          item.status == DownloadStatus.QUEUED ||
          item.status == DownloadStatus.SEEDING
      CategoryFilter.COMPLETED -> item.status == DownloadStatus.COMPLETED
      CategoryFilter.TORRENTS -> item.category == FileCategory.TORRENTS || item.kind == DownloadKind.TORRENT
      CategoryFilter.VIDEOS -> item.category == FileCategory.VIDEOS
      CategoryFilter.IMAGES -> item.category == FileCategory.IMAGES
      CategoryFilter.DOCS -> item.category == FileCategory.DOCS
      CategoryFilter.ARCHIVES -> item.category == FileCategory.ARCHIVES
      CategoryFilter.OTHER -> item.category == FileCategory.OTHER
    }
  }

  fun sortDownloads(items: List<DownloadItem>, sortBy: SortBy): List<DownloadItem> {
    return when (sortBy) {
      SortBy.NEWEST -> items.sortedByDescending { it.addedAt }
      SortBy.OLDEST -> items.sortedBy { it.addedAt }
      SortBy.NAME -> items.sortedBy { it.name.lowercase(Locale.US) }
      SortBy.SIZE -> items.sortedByDescending { it.totalBytes ?: it.downloadedBytes }
      SortBy.PROGRESS -> items.sortedByDescending { it.progressFraction }
      SortBy.STATUS -> items.sortedBy { it.status.ordinal }
    }
  }

  fun resolveCategoryFolder(baseDir: String, routingMode: FolderRoutingMode, category: FileCategory): String {
    if (routingMode == FolderRoutingMode.SINGLE) return baseDir
    val subName = when (category) {
      FileCategory.VIDEOS -> "Videos"
      FileCategory.IMAGES -> "Images"
      FileCategory.DOCS -> "Documents"
      FileCategory.ARCHIVES -> "Archives"
      FileCategory.TORRENTS -> "Torrents"
      FileCategory.OTHER -> "Other"
    }
    return File(baseDir, subName).absolutePath
  }

  fun formatScheduleSummary(schedule: DownloadSchedule?): String? {
    if (schedule == null) return null
    val parts = mutableListOf<String>()
    val fmt = SimpleDateFormat("HH:mm", Locale.US)
    if (schedule.startAt != null) {
      parts.add("Start ${fmt.format(Date(schedule.startAt))}")
    }
    if (schedule.stopAt != null) {
      parts.add("Stop ${fmt.format(Date(schedule.stopAt))}")
    }
    if (schedule.wifiOnly) {
      parts.add("Wi-Fi Only")
    }
    return if (parts.isEmpty()) null else parts.joinToString(" · ")
  }
}
