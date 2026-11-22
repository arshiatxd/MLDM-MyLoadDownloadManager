package com.myload.app.engine

import com.myload.app.model.FormatUtils
import com.myload.app.model.GamingModeProfile
import com.myload.app.model.MultiPartCandidate
import com.myload.app.model.MultiPartScanResult
import com.myload.app.model.NetworkBalanceStats
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URL
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToLong

class TokenBucket(initialLimitBytesPerSec: Long? = null) {
  private val mutex = Mutex()
  @Volatile private var limitBytesPerSec: Long? = null
  private var tokens: Double = Double.POSITIVE_INFINITY
  private var lastRefillMs: Long = System.currentTimeMillis()

  init {
    setLimit(initialLimitBytesPerSec)
  }

  fun setLimit(limit: Long?) {
    if (limit == null || limit <= 0L) {
      limitBytesPerSec = null
      tokens = Double.POSITIVE_INFINITY
    } else {
      val normalized = max(1024L, limit)
      val cap = getCapacity(normalized)
      limitBytesPerSec = normalized
      tokens = if (tokens.isInfinite()) cap else min(tokens, cap)
      lastRefillMs = System.currentTimeMillis()
    }
  }

  fun getLimit(): Long? = limitBytesPerSec

  suspend fun consume(bytes: Int) {
    if (bytes <= 0 || limitBytesPerSec == null) return
    var remaining = bytes
    while (remaining > 0) {
      val currentLimit = limitBytesPerSec ?: return
      var waitMs = 0L
      mutex.withLock {
        val lim = limitBytesPerSec ?: return
        refill(lim)
        val chunkCap = max(512, min(32 * 1024, (lim / 4L).toInt()))
        val want = min(remaining, chunkCap)
        if (tokens >= want) {
          tokens -= want
          remaining -= want
        } else if (tokens >= min(1024, chunkCap)) {
          val take = min(remaining, tokens.toInt())
          tokens -= take
          remaining -= take
        } else {
          val deficit = min(want.toDouble(), getCapacity(lim)) - tokens
          waitMs = max(10L, ceil((deficit / lim.toDouble()) * 1000.0).toLong())
        }
      }
      if (waitMs > 0L) {
        delay(waitMs)
      }
    }
  }

  private fun getCapacity(limit: Long): Double {
    return max(1024.0, min(128.0 * 1024.0, limit * 0.25))
  }

  private fun refill(limit: Long) {
    val now = System.currentTimeMillis()
    val elapsed = max(0L, now - lastRefillMs)
    if (elapsed == 0L) return
    lastRefillMs = now
    val added = (elapsed.toDouble() / 1000.0) * limit.toDouble()
    tokens = min(getCapacity(limit), tokens + added)
  }
}

class NetworkBalancer {
  private val rttSamples = ArrayDeque<Int>()
  private var baselineRtt: Int? = null
  private var dynamicDlCap: Long? = null
  private var dynamicUlCap: Long? = null
  private var observedPeakSpeed: Long = 2L * 1024L * 1024L

  suspend fun probeLatencySample(): Int? = withContext(Dispatchers.IO) {
    val targets = listOf(
      InetSocketAddress("1.1.1.1", 443),
      InetSocketAddress("8.8.8.8", 53),
    )
    for (addr in targets) {
      try {
        val start = System.nanoTime()
        Socket().use { socket ->
          socket.tcpNoDelay = true
          socket.connect(addr, 1200)
        }
        val elapsedMs = ((System.nanoTime() - start) / 1_000_000L).toInt().coerceAtLeast(1)
        return@withContext elapsedMs
      } catch (_: Exception) {
      }
    }
    null
  }

  fun evaluate(
    enabled: Boolean,
    activeDownloads: Boolean,
    profile: GamingModeProfile,
    userDownloadCap: Long?,
    userUploadCap: Long?,
    currentDownloadSpeed: Long,
    latestRttMs: Int?,
  ): NetworkBalanceStats {
    if (currentDownloadSpeed > observedPeakSpeed) {
      observedPeakSpeed = currentDownloadSpeed
    }
    if (!enabled) {
      rttSamples.clear()
      baselineRtt = null
      dynamicDlCap = null
      dynamicUlCap = null
      return NetworkBalanceStats(
        enabled = false,
        active = false,
        effectiveDownloadLimit = userDownloadCap,
        effectiveUploadLimit = userUploadCap,
        state = "idle",
      )
    }

    if (latestRttMs != null) {
      if (rttSamples.size >= 8) rttSamples.removeFirst()
      rttSamples.addLast(latestRttMs)
      val curBase = baselineRtt
      baselineRtt = if (curBase == null) {
        latestRttMs
      } else {
        min(curBase, ((curBase * 0.85) + (latestRttMs * 0.15)).toInt().coerceAtLeast(1))
      }
    }

    val avgRtt = if (rttSamples.isNotEmpty()) rttSamples.average().toInt() else latestRttMs
    val jitter = if (rttSamples.size >= 2) {
      var sumDiff = 0
      val list = rttSamples.toList()
      for (i in 1 until list.size) {
        sumDiff += abs(list[i] - list[i - 1])
      }
      sumDiff / (list.size - 1)
    } else {
      0
    }

    val base = baselineRtt
    val deltaThreshold = if (profile == GamingModeProfile.GAMING) 18 else 38
    val jitterThreshold = if (profile == GamingModeProfile.GAMING) 12 else 26

    var state = if (activeDownloads) "steady" else "probing"
    if (activeDownloads && avgRtt != null && base != null) {
      val congested = (avgRtt - base) > deltaThreshold || jitter > jitterThreshold
      val referenceBand = max(512L * 1024L, max(currentDownloadSpeed, observedPeakSpeed))
      if (congested) {
        state = "throttling"
        val factor = if (profile == GamingModeProfile.GAMING) 0.62 else 0.78
        val currentCap = dynamicDlCap ?: referenceBand
        dynamicDlCap = max(256L * 1024L, (currentCap * factor).roundToLong())
        dynamicUlCap = if (profile == GamingModeProfile.GAMING) 128L * 1024L else 320L * 1024L
      } else {
        val currentCap = dynamicDlCap
        if (currentCap != null) {
          val recovered = (currentCap * 1.15).roundToLong()
          dynamicDlCap = if (recovered >= referenceBand) null else recovered
        }
        dynamicUlCap = if (profile == GamingModeProfile.GAMING) 256L * 1024L else null
      }
    }

    val effectiveDl = when {
      userDownloadCap != null && dynamicDlCap != null -> min(userDownloadCap, dynamicDlCap!!)
      dynamicDlCap != null -> dynamicDlCap
      else -> userDownloadCap
    }
    val effectiveUl = when {
      userUploadCap != null && dynamicUlCap != null -> min(userUploadCap, dynamicUlCap!!)
      dynamicUlCap != null -> dynamicUlCap
      else -> userUploadCap
    }

    return NetworkBalanceStats(
      enabled = true,
      active = activeDownloads,
      rttMs = avgRtt,
      baselineRttMs = base,
      jitterMs = jitter,
      effectiveDownloadLimit = effectiveDl,
      effectiveUploadLimit = effectiveUl,
      state = state,
    )
  }
}

object MultiPartScanner {
  private val PART_PATTERNS = listOf(
    Regex("^(.*\\.part)(\\d+)(\\.rar)$", RegexOption.IGNORE_CASE),
    Regex("^(.*_[pP]art)(\\d+)(\\.[a-zA-Z0-9]+)$"),
    Regex("^(.*-part)(\\d+)(\\.[a-zA-Z0-9]+)$", RegexOption.IGNORE_CASE),
    Regex("^(.*\\.)(\\d{3})$"),
  )

  suspend fun scanNumberedParts(
    rawUrl: String,
    headers: Map<String, String> = emptyMap(),
    maxParts: Int = 20,
  ): MultiPartScanResult = withContext(Dispatchers.IO) {
    if (!FormatUtils.isHttpUrl(rawUrl)) {
      return@withContext MultiPartScanResult(matched = false, baseName = "")
    }
    val qIndex = rawUrl.indexOf('?')
    val basePathUrl = if (qIndex >= 0) rawUrl.substring(0, qIndex) else rawUrl
    val querySuffix = if (qIndex >= 0) rawUrl.substring(qIndex) else ""
    val slashIdx = basePathUrl.lastIndexOf('/')
    if (slashIdx < 0) return@withContext MultiPartScanResult(matched = false, baseName = "")
    val dirPrefix = basePathUrl.substring(0, slashIdx + 1)
    val fileName = basePathUrl.substring(slashIdx + 1)

    var prefix = ""
    var digits = ""
    var suffix = ""
    for (pat in PART_PATTERNS) {
      val m = pat.matchEntire(fileName)
      if (m != null) {
        prefix = m.groupValues[1]
        digits = m.groupValues[2]
        suffix = m.groupValues[3]
        break
      }
    }
    if (digits.isEmpty()) {
      return@withContext MultiPartScanResult(matched = false, baseName = fileName)
    }

    val width = digits.length
    val originalNum = digits.toIntOrNull() ?: return@withContext MultiPartScanResult(false, fileName)
    val candidates = mutableListOf<MultiPartCandidate>()

    for (num in 1..maxParts) {
      val padded = num.toString().padStart(width, '0')
      val candidateName = "$prefix$padded$suffix"
      val candidateUrl = "$dirPrefix$candidateName$querySuffix"
      if (num == originalNum) {
        val len = quickProbeSize(candidateUrl, headers)
        candidates.add(
          MultiPartCandidate(
            url = candidateUrl,
            fileName = FormatUtils.sanitizeFileName(candidateName),
            partNumber = num,
            totalBytes = len,
            isOriginal = true,
          )
        )
        continue
      }
      val probe = quickProbeExists(candidateUrl, headers)
      if (probe.first) {
        candidates.add(
          MultiPartCandidate(
            url = candidateUrl,
            fileName = FormatUtils.sanitizeFileName(candidateName),
            partNumber = num,
            totalBytes = probe.second,
            isOriginal = false,
          )
        )
      } else if (num > originalNum && candidates.size >= 1) {
        break
      }
    }

    val sorted = candidates.sortedBy { it.partNumber }
    MultiPartScanResult(
      matched = sorted.size > 1,
      baseName = prefix.trimEnd('.', '_', '-'),
      parts = sorted,
    )
  }

  private fun quickProbeSize(url: String, headers: Map<String, String>): Long? {
    return quickProbeExists(url, headers).second
  }

  private fun quickProbeExists(url: String, headers: Map<String, String>): Pair<Boolean, Long?> {
    var conn: HttpURLConnection? = null
    return try {
      conn = (URL(url).openConnection() as HttpURLConnection).apply {
        requestMethod = "HEAD"
        connectTimeout = 4500
        readTimeout = 4500
        instanceFollowRedirects = true
        setRequestProperty("User-Agent", "MyLoad/1.0.12 (Android; Download Manager)")
        for ((k, v) in headers) setRequestProperty(k, v)
      }
      val code = conn.responseCode
      if (code in 200..299) {
        val len = conn.getHeaderField("Content-Length")?.toLongOrNull()
        Pair(true, len)
      } else {
        Pair(false, null)
      }
    } catch (e: CancellationException) {
      throw e
    } catch (_: Exception) {
      Pair(false, null)
    } finally {
      conn?.disconnect()
    }
  }
}
