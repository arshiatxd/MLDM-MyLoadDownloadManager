@file:Suppress("DEPRECATION")

package com.myload.app.ui.components

import android.annotation.SuppressLint
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.myload.app.engine.MyLoadController
import com.myload.app.model.AppLanguage
import com.myload.app.model.AppSettings
import com.myload.app.model.DownloadItem
import com.myload.app.model.DownloadKind
import com.myload.app.model.DownloadSchedule
import com.myload.app.model.DownloadStatus
import com.myload.app.model.DuplicatePolicy
import com.myload.app.model.FolderRoutingMode
import com.myload.app.model.FontScale
import com.myload.app.model.FormatUtils
import com.myload.app.model.GamingModeProfile
import com.myload.app.model.LogEntry
import com.myload.app.model.MultiPartScanResult
import com.myload.app.model.PowerAction
import com.myload.app.model.ProbeResult
import com.myload.app.model.QueueMode
import com.myload.app.model.ScannableMediaKind
import com.myload.app.model.SegmentStatus
import com.myload.app.model.SocialMediaItem
import com.myload.app.model.SocialPlatform
import com.myload.app.model.SocialScanResult
import com.myload.app.model.SpeedUnit
import com.myload.app.model.ThemeMode
import com.myload.app.model.UpdateStatus
import com.myload.app.ui.theme.LocalMyLoadPalette
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun AddDownloadSheet(
  controller: MyLoadController,
  settings: AppSettings,
  initialSource: String,
  onDismiss: () -> Unit,
) {
  val palette = LocalMyLoadPalette.current
  val scope = rememberCoroutineScope()
  val clipboard = LocalClipboardManager.current
  var isBatchTab by remember { mutableStateOf(false) }
  var source by remember { mutableStateOf(initialSource) }
  var batchText by remember { mutableStateOf("") }
  var fileName by remember { mutableStateOf("") }
  var saveDir by remember { mutableStateOf(settings.defaultDownloadDir) }
  var startPaused by remember { mutableStateOf(false) }
  var showAdvancedHeaders by remember { mutableStateOf(false) }
  var refererHeader by remember { mutableStateOf("") }
  var cookieHeader by remember { mutableStateOf("") }
  var userAgentHeader by remember { mutableStateOf("") }
  var startDelayMinutes by remember { mutableStateOf("") }
  var stopAfterMinutes by remember { mutableStateOf("") }
  var wifiOnly by remember { mutableStateOf(settings.wifiOnlyDownloads) }

  var probing by remember { mutableStateOf(false) }
  var probeResult by remember { mutableStateOf<ProbeResult?>(null) }
  var probeError by remember { mutableStateOf<String?>(null) }
  var multiPartScan by remember { mutableStateOf<MultiPartScanResult?>(null) }
  var downloadAllParts by remember { mutableStateOf(true) }
  val selectedTorrentIndices = remember { mutableStateListOf<Int>() }
  var batchQueueMode by remember { mutableStateOf(settings.queueMode) }

  val torrentPickerLauncher = rememberLauncherForActivityResult(
    contract = ActivityResultContracts.OpenDocument(),
  ) { uri ->
    if (uri != null) {
      probing = true
      probeError = null
      scope.launch {
        val res = controller.parseTorrentUri(uri)
        probing = false
        if (res != null) {
          source = res.first.absolutePath
          probeResult = res.second
          fileName = res.second.fileName
          selectedTorrentIndices.clear()
          selectedTorrentIndices.addAll(res.second.files.map { it.index })
        } else {
          probeError = "Unable to parse selected .torrent file"
        }
      }
    }
  }

  LaunchedEffect(source) {
    val trimmed = source.trim()
    if (trimmed.isEmpty() || (!FormatUtils.isHttpUrl(trimmed) && !FormatUtils.isMagnetUri(trimmed))) {
      return@LaunchedEffect
    }
    delay(400L)
    probing = true
    probeError = null
    try {
      val headers = buildMap {
        if (refererHeader.isNotBlank()) put("Referer", refererHeader.trim())
        if (cookieHeader.isNotBlank()) put("Cookie", cookieHeader.trim())
        if (userAgentHeader.isNotBlank()) put("User-Agent", userAgentHeader.trim())
      }
      val pr = controller.probeSource(trimmed, headers)
      probeResult = pr
      if (fileName.isBlank() || fileName == "download.bin") {
        fileName = pr.fileName
      }
      selectedTorrentIndices.clear()
      selectedTorrentIndices.addAll(pr.files.map { it.index })

      if (FormatUtils.isHttpUrl(trimmed) && settings.detectMultiPartEnabled) {
        val mp = controller.scanMultiParts(trimmed, headers)
        multiPartScan = if (mp.matched && mp.parts.size > 1) mp else null
      } else {
        multiPartScan = null
      }
    } catch (e: Exception) {
      probeError = e.message ?: "Unable to probe URL"
    } finally {
      probing = false
    }
  }

  ModalBottomSheet(
    onDismissRequest = onDismiss,
    sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    containerColor = palette.bgSurface,
    contentColor = palette.textPrimary,
  ) {
    Column(
      modifier = Modifier
        .fillMaxWidth()
        .verticalScroll(rememberScrollState())
        .padding(horizontal = 16.dp, vertical = 8.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Text("Add Download", fontWeight = FontWeight.Bold, fontSize = 18.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
          FilterChip(
            selected = !isBatchTab,
            onClick = { isBatchTab = false },
            label = { Text("Single / Torrent") },
          )
          FilterChip(
            selected = isBatchTab,
            onClick = { isBatchTab = true },
            label = { Text("Batch List") },
          )
        }
      }

      if (!isBatchTab) {
        OutlinedTextField(
          value = source,
          onValueChange = { source = it },
          label = { Text("HTTP/HTTPS URL, Magnet Link, or .torrent") },
          placeholder = { Text("https://example.com/archive.zip or magnet:?xt=...") },
          modifier = Modifier.fillMaxWidth(),
          singleLine = true,
          trailingIcon = {
            IconButton(
              onClick = {
                val clip = clipboard.getText()?.text?.trim().orEmpty()
                if (clip.isNotEmpty()) source = clip
              }
            ) {
              Icon(Icons.Default.ContentPaste, contentDescription = "Paste from clipboard")
            }
          },
        )

        Row(
          modifier = Modifier.fillMaxWidth(),
          horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
          OutlinedButton(
            onClick = { torrentPickerLauncher.launch(arrayOf("application/x-bittorrent", "*/*")) },
            modifier = Modifier.weight(1f),
          ) {
            Icon(Icons.Default.FolderOpen, contentDescription = null, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(6.dp))
            Text("Pick .torrent File")
          }
          if (probing) {
            Row(
              verticalAlignment = Alignment.CenterVertically,
              modifier = Modifier.padding(horizontal = 8.dp, vertical = 10.dp),
            ) {
              CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
              Spacer(Modifier.width(6.dp))
              Text("Probing...", fontSize = 12.sp, color = palette.textSecondary)
            }
          }
        }

        probeResult?.let { pr ->
          Surface(
            color = palette.bgElevated,
            shape = RoundedCornerShape(12.dp),
            border = BorderStroke(1.dp, palette.borderSubtle),
            modifier = Modifier.fillMaxWidth(),
          ) {
            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
              Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
              ) {
                Text(
                  text = "${pr.kind.label} · ${pr.category.label}",
                  fontSize = 12.sp,
                  fontWeight = FontWeight.SemiBold,
                  color = palette.accent,
                )
                Text(
                  text = "${FormatUtils.formatBytes(pr.totalBytes)} · ${if (pr.resumeSupported) "Resumable (${settings.httpConnections} seg)" else "Single stream"}",
                  fontSize = 12.sp,
                  color = palette.textSecondary,
                )
              }
              if (pr.infoHash != null) {
                Text(
                  text = "InfoHash: ${pr.infoHash} · Trackers: ${pr.trackers.size}",
                  fontSize = 11.sp,
                  color = palette.textMuted,
                  maxLines = 1,
                  overflow = TextOverflow.Ellipsis,
                )
              }
              if (pr.files.isNotEmpty()) {
                Spacer(Modifier.height(4.dp))
                Row(
                  modifier = Modifier.fillMaxWidth(),
                  horizontalArrangement = Arrangement.SpaceBetween,
                  verticalAlignment = Alignment.CenterVertically,
                ) {
                  Text(
                    "Torrent Files (${selectedTorrentIndices.size}/${pr.files.size} selected)",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                  )
                  TextButton(
                    onClick = {
                      if (selectedTorrentIndices.size == pr.files.size) {
                        selectedTorrentIndices.clear()
                      } else {
                        selectedTorrentIndices.clear()
                        selectedTorrentIndices.addAll(pr.files.map { it.index })
                      }
                    }
                  ) {
                    Text(if (selectedTorrentIndices.size == pr.files.size) "Deselect All" else "Select All", fontSize = 11.sp)
                  }
                }
                Column(
                  modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 140.dp)
                    .verticalScroll(rememberScrollState()),
                ) {
                  pr.files.forEach { tf ->
                    val checked = selectedTorrentIndices.contains(tf.index)
                    Row(
                      verticalAlignment = Alignment.CenterVertically,
                      modifier = Modifier
                        .fillMaxWidth()
                        .clickable {
                          if (checked) selectedTorrentIndices.remove(tf.index)
                          else selectedTorrentIndices.add(tf.index)
                        }
                        .padding(vertical = 2.dp),
                    ) {
                      Checkbox(
                        checked = checked,
                        onCheckedChange = {
                          if (it) {
                            if (!selectedTorrentIndices.contains(tf.index)) selectedTorrentIndices.add(tf.index)
                          } else {
                            selectedTorrentIndices.remove(tf.index)
                          }
                        },
                      )
                      Text(
                        tf.path,
                        fontSize = 12.sp,
                        modifier = Modifier.weight(1f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                      )
                      Text(FormatUtils.formatBytes(tf.length), fontSize = 11.sp, color = palette.textSecondary)
                    }
                  }
                }
              }
            }
          }
        }

        if (probeError != null) {
          Text(probeError!!, color = palette.danger, fontSize = 12.sp)
        }

        multiPartScan?.let { mp ->
          Surface(
            color = palette.accentSoft,
            shape = RoundedCornerShape(12.dp),
            border = BorderStroke(1.dp, palette.accent),
            modifier = Modifier.fillMaxWidth(),
          ) {
            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
              Text(
                "Multi-Part Archive Detected (${mp.parts.size} parts found)",
                fontWeight = FontWeight.SemiBold,
                fontSize = 13.sp,
              )
              Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = downloadAllParts, onCheckedChange = { downloadAllParts = it })
                Text("Queue all ${mp.parts.size} numbered parts together", fontSize = 12.sp)
              }
            }
          }
        }

        OutlinedTextField(
          value = fileName,
          onValueChange = { fileName = it },
          label = { Text("Save as Filename") },
          modifier = Modifier.fillMaxWidth(),
          singleLine = true,
        )
      } else {
        OutlinedTextField(
          value = batchText,
          onValueChange = { batchText = it },
          label = { Text("Paste multiple URLs or Magnet links (one per line)") },
          modifier = Modifier
            .fillMaxWidth()
            .height(130.dp),
        )
        Text("Batch Queue Mode", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
          QueueMode.entries.forEach { mode ->
            FilterChip(
              selected = batchQueueMode == mode,
              onClick = { batchQueueMode = mode },
              label = { Text(mode.title, fontSize = 11.sp) },
            )
          }
        }
      }

      OutlinedTextField(
        value = saveDir,
        onValueChange = { saveDir = it },
        label = { Text("Destination Folder") },
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
      )

      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
      ) {
        OutlinedTextField(
          value = startDelayMinutes,
          onValueChange = { startDelayMinutes = it.filter { c -> c.isDigit() } },
          label = { Text("Start in (min)") },
          modifier = Modifier.weight(1f),
          singleLine = true,
        )
        OutlinedTextField(
          value = stopAfterMinutes,
          onValueChange = { stopAfterMinutes = it.filter { c -> c.isDigit() } },
          label = { Text("Stop after (min)") },
          modifier = Modifier.weight(1f),
          singleLine = true,
        )
      }

      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Checkbox(checked = startPaused, onCheckedChange = { startPaused = it })
          Text("Add paused", fontSize = 12.sp)
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
          Checkbox(checked = wifiOnly, onCheckedChange = { wifiOnly = it })
          Text("Wi-Fi only", fontSize = 12.sp)
        }
        TextButton(onClick = { showAdvancedHeaders = !showAdvancedHeaders }) {
          Text(if (showAdvancedHeaders) "Hide Headers" else "Custom Headers", fontSize = 12.sp)
        }
      }

      if (showAdvancedHeaders && !isBatchTab) {
        OutlinedTextField(
          value = refererHeader,
          onValueChange = { refererHeader = it },
          label = { Text("Referer URL (optional)") },
          modifier = Modifier.fillMaxWidth(),
          singleLine = true,
        )
        OutlinedTextField(
          value = cookieHeader,
          onValueChange = { cookieHeader = it },
          label = { Text("Cookie Header (optional)") },
          modifier = Modifier.fillMaxWidth(),
          singleLine = true,
        )
        OutlinedTextField(
          value = userAgentHeader,
          onValueChange = { userAgentHeader = it },
          label = { Text("Custom User-Agent (optional)") },
          modifier = Modifier.fillMaxWidth(),
          singleLine = true,
        )
      }

      Row(
        modifier = Modifier
          .fillMaxWidth()
          .padding(top = 4.dp, bottom = 16.dp),
        horizontalArrangement = Arrangement.End,
      ) {
        TextButton(onClick = onDismiss) {
          Text("Cancel")
        }
        Spacer(Modifier.width(8.dp))
        Button(
          onClick = {
            val now = System.currentTimeMillis()
            val startAt = startDelayMinutes.toLongOrNull()?.takeIf { it > 0L }?.let { now + it * 60_000L }
            val stopAt = stopAfterMinutes.toLongOrNull()?.takeIf { it > 0L }?.let { (startAt ?: now) + it * 60_000L }
            val schedule = if (startAt != null || stopAt != null || wifiOnly) {
              DownloadSchedule(startAt = startAt, stopAt = stopAt, wifiOnly = wifiOnly)
            } else {
              null
            }

            if (isBatchTab) {
              val urls = FormatUtils.extractMultipleSources(batchText)
              if (urls.isNotEmpty()) {
                controller.addBatchDownloads(
                  sources = urls,
                  saveDir = saveDir,
                  queueModeOverride = batchQueueMode,
                  startPaused = startPaused,
                )
                onDismiss()
              }
            } else {
              val trimmed = source.trim()
              if (trimmed.isNotEmpty()) {
                val mp = multiPartScan
                if (mp != null && mp.matched && downloadAllParts && mp.parts.size > 1) {
                  controller.addBatchDownloads(
                    sources = mp.parts.map { it.url },
                    saveDir = saveDir,
                    startPaused = startPaused,
                  )
                } else {
                  val headers = buildMap {
                    if (refererHeader.isNotBlank()) put("Referer", refererHeader.trim())
                    if (cookieHeader.isNotBlank()) put("Cookie", cookieHeader.trim())
                    if (userAgentHeader.isNotBlank()) put("User-Agent", userAgentHeader.trim())
                  }
                  controller.addDownload(
                    source = trimmed,
                    fileName = fileName.ifBlank { null },
                    saveDir = saveDir,
                    startPaused = startPaused,
                    requestHeaders = headers,
                    schedule = schedule,
                    probeResult = probeResult,
                    selectedFileIndices = if (probeResult?.files?.isNotEmpty() == true) {
                      selectedTorrentIndices.toSet()
                    } else {
                      null
                    },
                  )
                }
                onDismiss()
              }
            }
          },
          colors = ButtonDefaults.buttonColors(containerColor = palette.accent),
        ) {
          Icon(Icons.Default.Download, contentDescription = null, modifier = Modifier.size(16.dp))
          Spacer(Modifier.width(6.dp))
          Text(if (startPaused) "Add to Queue" else "Download Now", color = Color.White)
        }
      }
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun MediaGrabberSheet(
  controller: MyLoadController,
  onDismiss: () -> Unit,
) {
  val palette = LocalMyLoadPalette.current
  val scope = rememberCoroutineScope()
  val clipboard = LocalClipboardManager.current
  var selectedPlatform by remember { mutableStateOf(SocialPlatform.CUSTOM) }
  var urlInput by remember { mutableStateOf("") }
  var scanning by remember { mutableStateOf(false) }
  var scanResult by remember { mutableStateOf<SocialScanResult?>(null) }
  var activeKindFilter by remember { mutableStateOf<ScannableMediaKind?>(null) }
  val selectedItemIds = remember { mutableStateListOf<String>() }
  var selectedFormat by remember { mutableStateOf("mp4") }
  var selectedQuality by remember { mutableStateOf("1080p") }

  ModalBottomSheet(
    onDismissRequest = onDismiss,
    sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    containerColor = palette.bgSurface,
    contentColor = palette.textPrimary,
  ) {
    Column(
      modifier = Modifier
        .fillMaxWidth()
        .padding(horizontal = 16.dp, vertical = 8.dp),
      verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      Text(
        "Media Grabber & Custom URL Scanner",
        fontWeight = FontWeight.Bold,
        fontSize = 18.sp,
      )
      Text(
        "Scan YouTube, Instagram, TikTok, Spotify, or paste any Custom URL webpage to extract embedded videos, audio streams, and images.",
        fontSize = 12.sp,
        color = palette.textSecondary,
      )

      Row(
        modifier = Modifier
          .fillMaxWidth()
          .horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
      ) {
        SocialPlatform.entries.forEach { platform ->
          FilterChip(
            selected = selectedPlatform == platform,
            onClick = { selectedPlatform = platform },
            label = { Text(platform.label, fontSize = 12.sp) },
          )
        }
      }

      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        OutlinedTextField(
          value = urlInput,
          onValueChange = { urlInput = it },
          label = { Text("${selectedPlatform.label} link") },
          placeholder = { Text("https://...") },
          modifier = Modifier.weight(1f),
          singleLine = true,
          trailingIcon = {
            IconButton(
              onClick = {
                val clip = clipboard.getText()?.text?.trim().orEmpty()
                if (clip.isNotEmpty()) urlInput = clip
              }
            ) {
              Icon(Icons.Default.ContentPaste, contentDescription = "Paste")
            }
          },
        )
        Button(
          onClick = {
            if (urlInput.isBlank()) return@Button
            scanning = true
            scope.launch {
              val res = controller.scanMediaPage(urlInput, selectedPlatform)
              scanning = false
              scanResult = res
              selectedItemIds.clear()
              selectedItemIds.addAll(res.items.map { it.id })
            }
          },
          enabled = !scanning && urlInput.isNotBlank(),
          colors = ButtonDefaults.buttonColors(containerColor = palette.accent),
        ) {
          if (scanning) {
            CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = Color.White)
          } else {
            Text("Scan", color = Color.White)
          }
        }
      }

      scanResult?.let { res ->
        if (!res.ok) {
          Surface(
            color = palette.danger.copy(alpha = 0.14f),
            shape = RoundedCornerShape(10.dp),
            border = BorderStroke(1.dp, palette.danger.copy(alpha = 0.5f)),
            modifier = Modifier.fillMaxWidth(),
          ) {
            Text(
              text = res.error ?: "Unable to scan media on this page.",
              color = palette.danger,
              fontSize = 12.sp,
              modifier = Modifier.padding(12.dp),
            )
          }
        } else {
          val filteredItems = res.items.filter { activeKindFilter == null || it.kind == activeKindFilter }
          Row(
            modifier = Modifier
              .fillMaxWidth()
              .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
          ) {
            FilterChip(
              selected = activeKindFilter == null,
              onClick = { activeKindFilter = null },
              label = { Text("All (${res.items.size})", fontSize = 11.sp) },
            )
            ScannableMediaKind.entries.forEach { k ->
              val count = res.items.count { it.kind == k }
              if (count > 0) {
                FilterChip(
                  selected = activeKindFilter == k,
                  onClick = { activeKindFilter = k },
                  label = { Text("${k.label} ($count)", fontSize = 11.sp) },
                )
              }
            }
          }

          FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf("mp4", "mkv", "webm", "mp3", "m4a", "wav").forEach { fmt ->
              FilterChip(
                selected = selectedFormat == fmt,
                onClick = { selectedFormat = fmt },
                label = { Text(fmt.uppercase(), fontSize = 11.sp) },
              )
            }
            listOf("1080p", "720p", "480p", "320k").forEach { q ->
              FilterChip(
                selected = selectedQuality == q,
                onClick = { selectedQuality = q },
                label = { Text(q, fontSize = 11.sp) },
              )
            }
          }

          LazyColumn(
            modifier = Modifier
              .fillMaxWidth()
              .heightIn(max = 220.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
          ) {
            items(filteredItems, key = { it.id }) { item ->
              val checked = selectedItemIds.contains(item.id)
              Surface(
                color = palette.bgElevated,
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier
                  .fillMaxWidth()
                  .clickable {
                    if (checked) selectedItemIds.remove(item.id) else selectedItemIds.add(item.id)
                  },
              ) {
                Row(
                  modifier = Modifier.padding(8.dp),
                  verticalAlignment = Alignment.CenterVertically,
                ) {
                  Checkbox(
                    checked = checked,
                    onCheckedChange = {
                      if (it) {
                        if (!selectedItemIds.contains(item.id)) selectedItemIds.add(item.id)
                      } else {
                        selectedItemIds.remove(item.id)
                      }
                    },
                  )
                  Column(modifier = Modifier.weight(1f)) {
                    Text(item.title, fontSize = 12.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("${item.kind.label} · ${item.qualityLabel}", fontSize = 11.sp, color = palette.textSecondary)
                  }
                }
              }
            }
          }

          Row(
            modifier = Modifier
              .fillMaxWidth()
              .padding(bottom = 16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
          ) {
            TextButton(
              onClick = {
                val visibleIds = filteredItems.map { it.id }
                if (visibleIds.all { selectedItemIds.contains(it) }) {
                  selectedItemIds.removeAll(visibleIds)
                } else {
                  visibleIds.forEach { if (!selectedItemIds.contains(it)) selectedItemIds.add(it) }
                }
              }
            ) {
              Text("Toggle All (${selectedItemIds.size})")
            }
            Button(
              onClick = {
                val chosen = res.items.filter { selectedItemIds.contains(it.id) }
                if (chosen.isNotEmpty()) {
                  controller.addSocialMediaItems(
                    platform = res.platform,
                    items = chosen,
                    outputFormat = selectedFormat,
                    quality = selectedQuality,
                  )
                  onDismiss()
                }
              },
              enabled = selectedItemIds.isNotEmpty(),
              colors = ButtonDefaults.buttonColors(containerColor = palette.accent),
            ) {
              Icon(Icons.Default.Download, contentDescription = null, modifier = Modifier.size(16.dp))
              Spacer(Modifier.width(6.dp))
              Text("Download (${selectedItemIds.size})", color = Color.White)
            }
          }
        }
      }
    }
  }
}

@SuppressLint("SetJavaScriptEnabled")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InAppBrowserSheet(
  controller: MyLoadController,
  onQueueUrl: (String) -> Unit,
  onDismiss: () -> Unit,
) {
  val palette = LocalMyLoadPalette.current
  val scope = rememberCoroutineScope()
  var addressInput by remember { mutableStateOf("https://archive.org") }
  var currentUrl by remember { mutableStateOf("https://archive.org") }
  var sniffedItems by remember { mutableStateOf<List<SocialMediaItem>>(emptyList()) }
  var sniffing by remember { mutableStateOf(false) }

  ModalBottomSheet(
    onDismissRequest = onDismiss,
    sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    containerColor = palette.bgSurface,
    contentColor = palette.textPrimary,
  ) {
    Column(
      modifier = Modifier
        .fillMaxWidth()
        .fillMaxHeight(0.92f)
        .padding(horizontal = 12.dp),
      verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
      Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
      ) {
        OutlinedTextField(
          value = addressInput,
          onValueChange = { addressInput = it },
          placeholder = { Text("Enter URL...") },
          singleLine = true,
          modifier = Modifier.weight(1f),
        )
        Button(
          onClick = {
            val u = if (addressInput.startsWith("http://", true) || addressInput.startsWith("https://", true)) {
              addressInput.trim()
            } else {
              "https://${addressInput.trim()}"
            }
            currentUrl = u
          },
          colors = ButtonDefaults.buttonColors(containerColor = palette.accent),
        ) {
          Text("Go", color = Color.White)
        }
        OutlinedButton(
          onClick = {
            sniffing = true
            scope.launch {
              val res = controller.scanMediaPage(currentUrl)
              sniffing = false
              sniffedItems = res.items
              if (res.items.isEmpty()) {
                controller.showToast(res.error ?: "No downloadable media detected on page")
              }
            }
          }
        ) {
          Icon(Icons.Default.VideoLibrary, contentDescription = null, modifier = Modifier.size(16.dp))
          Spacer(Modifier.width(4.dp))
          Text(if (sniffing) "Sniffing..." else "Sniff (${sniffedItems.size})", fontSize = 12.sp)
        }
      }

      if (sniffedItems.isNotEmpty()) {
        Surface(
          color = palette.accentSoft,
          shape = RoundedCornerShape(10.dp),
          border = BorderStroke(1.dp, palette.accent),
          modifier = Modifier.fillMaxWidth(),
        ) {
          Column(modifier = Modifier.padding(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(
              modifier = Modifier.fillMaxWidth(),
              horizontalArrangement = Arrangement.SpaceBetween,
              verticalAlignment = Alignment.CenterVertically,
            ) {
              Text("Sniffed Media (${sniffedItems.size})", fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
              Button(
                onClick = {
                  controller.addBatchDownloads(sniffedItems.map { it.sourceUrl })
                  sniffedItems = emptyList()
                },
                colors = ButtonDefaults.buttonColors(containerColor = palette.accent),
              ) {
                Text("Download All", fontSize = 11.sp, color = Color.White)
              }
            }
            Row(
              modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
              horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
              sniffedItems.take(12).forEach { media ->
                FilterChip(
                  selected = false,
                  onClick = { onQueueUrl(media.sourceUrl) },
                  label = { Text("${media.kind.label}: ${media.title.take(24)}", fontSize = 11.sp) },
                )
              }
            }
          }
        }
      }

      AndroidView(
        factory = { ctx ->
          WebView(ctx).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            webViewClient = object : WebViewClient() {
              override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val target = request?.url?.toString() ?: return false
                if (FormatUtils.isMagnetUri(target) ||
                  Regex("\\.(zip|rar|7z|apk|iso|torrent|mp4|mkv|mp3)(\\?.*)?$", RegexOption.IGNORE_CASE).containsMatchIn(target)
                ) {
                  onQueueUrl(target)
                  return true
                }
                addressInput = target
                return false
              }
            }
            setDownloadListener { url, _, _, _, _ ->
              if (!url.isNullOrBlank()) {
                onQueueUrl(url)
              }
            }
            loadUrl(currentUrl)
          }
        },
        update = { webView ->
          if (webView.url != currentUrl) {
            webView.loadUrl(currentUrl)
          }
        },
        modifier = Modifier
          .fillMaxWidth()
          .weight(1f)
          .clip(RoundedCornerShape(12.dp)),
      )
    }
  }
}

@Composable
fun CompactProgressPopupDialog(
  item: DownloadItem,
  onPause: () -> Unit,
  onResume: () -> Unit,
  onRetry: () -> Unit,
  onInspect: () -> Unit,
  onDismiss: () -> Unit,
) {
  val palette = LocalMyLoadPalette.current
  var autoCloseWhenDone by remember { mutableStateOf(false) }

  LaunchedEffect(item.status, autoCloseWhenDone) {
    if (autoCloseWhenDone && item.status == DownloadStatus.COMPLETED) {
      delay(600L)
      onDismiss()
    }
  }

  Dialog(
    onDismissRequest = onDismiss,
    properties = DialogProperties(dismissOnBackPress = true, dismissOnClickOutside = true),
  ) {
    Surface(
      color = palette.bgSurface,
      contentColor = palette.textPrimary,
      shape = RoundedCornerShape(16.dp),
      border = BorderStroke(1.dp, palette.accent),
      modifier = Modifier.fillMaxWidth(),
    ) {
      Column(
        modifier = Modifier.padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
      ) {
        Row(
          modifier = Modifier.fillMaxWidth(),
          horizontalArrangement = Arrangement.SpaceBetween,
          verticalAlignment = Alignment.CenterVertically,
        ) {
          Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.weight(1f),
          ) {
            Box(
              modifier = Modifier
                .size(26.dp)
                .clip(RoundedCornerShape(7.dp))
                .background(palette.accent),
              contentAlignment = Alignment.Center,
            ) {
              Text("ml", color = Color.White, fontWeight = FontWeight.ExtraBold, fontSize = 12.sp)
            }
            Text(
              item.name,
              fontWeight = FontWeight.SemiBold,
              fontSize = 14.sp,
              maxLines = 1,
              overflow = TextOverflow.Ellipsis,
            )
          }
          IconButton(onClick = onDismiss, modifier = Modifier.size(28.dp)) {
            Icon(Icons.Default.Close, contentDescription = "Hide popup", modifier = Modifier.size(18.dp))
          }
        }

        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
          Text(
            item.saveDir,
            fontSize = 11.sp,
            color = palette.textMuted,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
          )
          Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
          ) {
            Text(
              "${FormatUtils.formatBytes(item.downloadedBytes)} / ${FormatUtils.formatBytes(item.totalBytes)}",
              fontSize = 12.sp,
              color = palette.textSecondary,
            )
            Text(
              "${item.progressPercent}% · ${item.status.label}",
              fontSize = 12.sp,
              fontWeight = FontWeight.Bold,
              color = when (item.status) {
                DownloadStatus.COMPLETED -> palette.success
                DownloadStatus.ERROR -> palette.danger
                else -> palette.accent
              },
            )
          }
          LinearProgressIndicator(
            progress = { item.progressFraction },
            modifier = Modifier
              .fillMaxWidth()
              .height(7.dp)
              .clip(RoundedCornerShape(4.dp)),
            color = palette.accent,
            trackColor = palette.bgElevated,
          )
          Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
          ) {
            Text(
              "Speed: ${FormatUtils.formatSpeed(item.downloadSpeed)}",
              fontSize = 12.sp,
              fontFamily = FontFamily.Monospace,
            )
            Text(
              "ETA: ${FormatUtils.formatEta(item.etaSeconds)}",
              fontSize = 12.sp,
              color = palette.textSecondary,
            )
          }
        }

        if (item.status == DownloadStatus.ERROR && !item.errorMessage.isNullOrBlank()) {
          Surface(
            color = palette.danger.copy(alpha = 0.14f),
            shape = RoundedCornerShape(8.dp),
            border = BorderStroke(1.dp, palette.danger.copy(alpha = 0.45f)),
            modifier = Modifier.fillMaxWidth(),
          ) {
            Text(
              item.errorMessage,
              color = palette.danger,
              fontSize = 11.5.sp,
              modifier = Modifier.padding(8.dp),
            )
          }
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
          Checkbox(
            checked = autoCloseWhenDone,
            onCheckedChange = { autoCloseWhenDone = it },
          )
          Text("Auto-close when completed", fontSize = 12.sp, color = palette.textSecondary)
        }

        Row(
          modifier = Modifier.fillMaxWidth(),
          horizontalArrangement = Arrangement.SpaceBetween,
        ) {
          OutlinedButton(onClick = { onDismiss(); onInspect() }) {
            Text("Inspect", fontSize = 12.sp)
          }
          Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            when {
              item.status == DownloadStatus.ERROR -> {
                Button(
                  onClick = onRetry,
                  colors = ButtonDefaults.buttonColors(containerColor = palette.accent),
                ) {
                  Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(16.dp))
                  Spacer(Modifier.width(4.dp))
                  Text("Retry", color = Color.White, fontSize = 12.sp)
                }
              }
              item.isRunning -> {
                Button(
                  onClick = onPause,
                  colors = ButtonDefaults.buttonColors(containerColor = palette.bgElevated),
                ) {
                  Icon(Icons.Default.Pause, contentDescription = null, modifier = Modifier.size(16.dp))
                  Spacer(Modifier.width(4.dp))
                  Text("Pause", fontSize = 12.sp)
                }
              }
              item.status != DownloadStatus.COMPLETED -> {
                Button(
                  onClick = onResume,
                  colors = ButtonDefaults.buttonColors(containerColor = palette.accent),
                ) {
                  Icon(Icons.Default.PlayArrow, contentDescription = null, modifier = Modifier.size(16.dp))
                  Spacer(Modifier.width(4.dp))
                  Text("Resume", color = Color.White, fontSize = 12.sp)
                }
              }
            }
            OutlinedButton(onClick = onDismiss) {
              Text("Hide", fontSize = 12.sp)
            }
          }
        }
      }
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InspectorBottomSheet(
  item: DownloadItem,
  logs: List<LogEntry>,
  onUpdateTorrentFiles: (Set<Int>) -> Unit,
  onDismiss: () -> Unit,
) {
  val palette = LocalMyLoadPalette.current
  var activeTab by remember { mutableIntStateOf(0) }
  val itemLogs = remember(logs, item.id) { logs.filter { it.downloadId == item.id } }

  ModalBottomSheet(
    onDismissRequest = onDismiss,
    sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    containerColor = palette.bgSurface,
    contentColor = palette.textPrimary,
  ) {
    Column(
      modifier = Modifier
        .fillMaxWidth()
        .padding(horizontal = 16.dp, vertical = 8.dp),
      verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      Text(item.name, fontWeight = FontWeight.Bold, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
      Row(
        modifier = Modifier
          .fillMaxWidth()
          .horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
      ) {
        val firstTabTitle = if (item.kind == DownloadKind.TORRENT) "Torrent Overview" else "Segments (${item.segments.size})"
        listOf(
          firstTabTitle,
          "Files (${item.torrent?.files?.size ?: 1})",
          "Transfer Info",
          "Log (${itemLogs.size})",
        ).forEachIndexed { idx, label ->
          FilterChip(
            selected = activeTab == idx,
            onClick = { activeTab = idx },
            label = { Text(label, fontSize = 12.sp) },
          )
        }
      }

      when (activeTab) {
        0 -> {
          if (item.kind == DownloadKind.TORRENT && item.torrent != null) {
            val tm = item.torrent
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
              StatCard("PEERS", "${tm.peers}", Modifier.weight(1f))
              StatCard("SEEDS", "${tm.seeds}", Modifier.weight(1f))
              StatCard("UPLOADED", FormatUtils.formatBytes(item.uploadedBytes), Modifier.weight(1f))
              StatCard("RATIO", "${tm.ratio}", Modifier.weight(1f))
            }
            Text("InfoHash: ${tm.infoHash.ifBlank { "Pending" }}", fontSize = 12.sp, fontFamily = FontFamily.Monospace)
            Text(
              "Trackers (${tm.trackers.size}): ${if (tm.trackers.isEmpty()) "Using DHT / PEX peer discovery" else tm.trackers.joinToString(", ")}",
              fontSize = 12.sp,
              color = palette.textSecondary,
            )
          } else {
            LazyColumn(
              modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = 240.dp),
              verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
              items(item.segments, key = { it.index }) { seg ->
                Surface(
                  color = palette.bgElevated,
                  shape = RoundedCornerShape(8.dp),
                  modifier = Modifier.fillMaxWidth(),
                ) {
                  Column(modifier = Modifier.padding(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(
                      modifier = Modifier.fillMaxWidth(),
                      horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                      Text("Segment #${seg.index + 1}", fontSize = 12.sp, fontWeight = FontWeight.Medium)
                      Text(
                        "${FormatUtils.formatBytes(seg.downloaded)} · ${FormatUtils.formatSpeed(seg.speed)} · ${seg.status.name}",
                        fontSize = 11.sp,
                        color = palette.textSecondary,
                      )
                    }
                    LinearProgressIndicator(
                      progress = { seg.progressFraction },
                      modifier = Modifier
                        .fillMaxWidth()
                        .height(5.dp)
                        .clip(RoundedCornerShape(3.dp)),
                      color = if (seg.status == SegmentStatus.DONE) palette.success else palette.accent,
                      trackColor = palette.bgCanvas,
                    )
                  }
                }
              }
            }
          }
        }
        1 -> {
          val files = item.torrent?.files
          if (!files.isNullOrEmpty()) {
            LazyColumn(
              modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = 240.dp),
              verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
              items(files, key = { it.index }) { tf ->
                Row(
                  verticalAlignment = Alignment.CenterVertically,
                  modifier = Modifier
                    .fillMaxWidth()
                    .clickable {
                      val current = files.filter { it.selected }.map { it.index }.toMutableSet()
                      if (tf.selected) current.remove(tf.index) else current.add(tf.index)
                      if (current.isNotEmpty()) onUpdateTorrentFiles(current)
                    }
                    .padding(vertical = 4.dp),
                ) {
                  Checkbox(
                    checked = tf.selected,
                    onCheckedChange = { want ->
                      val current = files.filter { it.selected }.map { it.index }.toMutableSet()
                      if (want) current.add(tf.index) else current.remove(tf.index)
                      if (current.isNotEmpty()) onUpdateTorrentFiles(current)
                    },
                  )
                  Column(modifier = Modifier.weight(1f)) {
                    Text(tf.path, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("${FormatUtils.formatBytes(tf.downloaded)} / ${FormatUtils.formatBytes(tf.length)}", fontSize = 11.sp, color = palette.textSecondary)
                  }
                }
              }
            }
          } else {
            Text("Destination: ${item.filePath}", fontSize = 12.sp)
            Text("Size: ${FormatUtils.formatBytes(item.totalBytes)}", fontSize = 12.sp, color = palette.textSecondary)
          }
        }
        2 -> {
          Column(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(bottom = 16.dp)) {
            Text("Source: ${item.source}", fontSize = 12.sp)
            Text("Save Folder: ${item.saveDir}", fontSize = 12.sp)
            Text("File Path: ${item.filePath}", fontSize = 12.sp)
            Text("Resume Support: ${if (item.resumeSupported) "Yes (Byte-Range / Chunk Verified)" else "No"}", fontSize = 12.sp)
            Text("Added: ${FormatUtils.formatDateShort(item.addedAt)}", fontSize = 12.sp)
          }
        }
        3 -> {
          LazyColumn(
            modifier = Modifier
              .fillMaxWidth()
              .heightIn(max = 240.dp)
              .padding(bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
          ) {
            if (itemLogs.isEmpty()) {
              item {
                Text("No logs recorded for this item yet.", fontSize = 12.sp, color = palette.textSecondary)
              }
            }
            items(itemLogs, key = { it.id }) { log ->
              Text(
                "[${FormatUtils.formatDateShort(log.timestamp)}] [${log.level.uppercase()}] ${log.message}",
                fontSize = 11.5.sp,
                fontFamily = FontFamily.Monospace,
                color = if (log.level == "error") palette.danger else palette.textSecondary,
              )
            }
          }
        }
      }
      Spacer(Modifier.height(12.dp))
    }
  }
}

@Composable
private fun StatCard(title: String, value: String, modifier: Modifier = Modifier) {
  val palette = LocalMyLoadPalette.current
  Surface(
    color = palette.bgElevated,
    shape = RoundedCornerShape(10.dp),
    border = BorderStroke(1.dp, palette.borderSubtle),
    modifier = modifier,
  ) {
    Column(modifier = Modifier.padding(10.dp)) {
      Text(title, fontSize = 10.sp, color = palette.textMuted, fontWeight = FontWeight.SemiBold)
      Text(value, fontSize = 13.sp, fontWeight = FontWeight.Bold)
    }
  }
}

@Composable
fun RemoveConfirmDialog(
  count: Int,
  defaultDeleteFiles: Boolean,
  onConfirm: (Boolean) -> Unit,
  onDismiss: () -> Unit,
) {
  val palette = LocalMyLoadPalette.current
  var deleteFiles by remember(defaultDeleteFiles) { mutableStateOf(defaultDeleteFiles) }

  Dialog(onDismissRequest = onDismiss) {
    Surface(
      color = palette.bgSurface,
      contentColor = palette.textPrimary,
      shape = RoundedCornerShape(16.dp),
      border = BorderStroke(1.dp, palette.borderStrong),
    ) {
      Column(modifier = Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          Icon(Icons.Default.Delete, contentDescription = null, tint = palette.danger)
          Text(
            text = if (count > 1) "Remove all $count downloads?" else "Remove 1 download?",
            fontWeight = FontWeight.Bold,
            fontSize = 16.sp,
          )
        }
        Text(
          "Selected items will be stopped and removed from the MyLoad queue.",
          fontSize = 13.sp,
          color = palette.textSecondary,
        )
        Surface(
          color = palette.bgElevated,
          shape = RoundedCornerShape(10.dp),
          modifier = Modifier
            .fillMaxWidth()
            .clickable { deleteFiles = !deleteFiles },
        ) {
          Row(
            modifier = Modifier.padding(10.dp),
            verticalAlignment = Alignment.CenterVertically,
          ) {
            Checkbox(
              checked = deleteFiles,
              onCheckedChange = { deleteFiles = it },
              colors = CheckboxDefaults.colors(checkedColor = palette.accent),
            )
            Text("Also delete downloaded / partial files from device storage", fontSize = 12.5.sp)
          }
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
          TextButton(onClick = onDismiss) {
            Text("Cancel")
          }
          Spacer(Modifier.width(8.dp))
          Button(
            onClick = { onConfirm(deleteFiles) },
            colors = ButtonDefaults.buttonColors(containerColor = palette.accent),
          ) {
            Text(
              if (count > 1) "Remove all ($count)" else "Remove",
              color = Color.White,
            )
          }
        }
      }
    }
  }
}

@Composable
fun ScheduleDownloadDialog(
  item: DownloadItem,
  onSave: (DownloadSchedule?) -> Unit,
  onDismiss: () -> Unit,
) {
  val palette = LocalMyLoadPalette.current
  var startMinutes by remember { mutableStateOf("") }
  var stopMinutes by remember { mutableStateOf("") }
  var wifiOnly by remember { mutableStateOf(item.schedule?.wifiOnly ?: false) }

  Dialog(onDismissRequest = onDismiss) {
    Surface(
      color = palette.bgSurface,
      contentColor = palette.textPrimary,
      shape = RoundedCornerShape(16.dp),
      border = BorderStroke(1.dp, palette.borderStrong),
    ) {
      Column(modifier = Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          Icon(Icons.Default.Schedule, contentDescription = null, tint = palette.accent)
          Text("Schedule Download", fontWeight = FontWeight.Bold, fontSize = 16.sp)
        }
        Text(item.name, fontSize = 12.sp, color = palette.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
        OutlinedTextField(
          value = startMinutes,
          onValueChange = { startMinutes = it.filter { c -> c.isDigit() } },
          label = { Text("Start in minutes (leave blank for immediate)") },
          singleLine = true,
          modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
          value = stopMinutes,
          onValueChange = { stopMinutes = it.filter { c -> c.isDigit() } },
          label = { Text("Auto-pause / stop after minutes (optional)") },
          singleLine = true,
          modifier = Modifier.fillMaxWidth(),
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
          Checkbox(checked = wifiOnly, onCheckedChange = { wifiOnly = it })
          Text("Download only when connected to Wi-Fi", fontSize = 12.5.sp)
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
          TextButton(onClick = { onSave(null); onDismiss() }) {
            Text("Clear Schedule", color = palette.danger)
          }
          Row {
            TextButton(onClick = onDismiss) { Text("Cancel") }
            Button(
              onClick = {
                val now = System.currentTimeMillis()
                val startAt = startMinutes.toLongOrNull()?.takeIf { it > 0L }?.let { now + it * 60_000L }
                val stopAt = stopMinutes.toLongOrNull()?.takeIf { it > 0L }?.let { (startAt ?: now) + it * 60_000L }
                if (startAt == null && stopAt == null && !wifiOnly) {
                  onSave(null)
                } else {
                  onSave(DownloadSchedule(startAt = startAt, stopAt = stopAt, wifiOnly = wifiOnly))
                }
                onDismiss()
              },
              colors = ButtonDefaults.buttonColors(containerColor = palette.accent),
            ) {
              Text("Save", color = Color.White)
            }
          }
        }
      }
    }
  }
}

@Composable
fun UpdatePromptDialog(
  status: UpdateStatus,
  onOpenReleaseUrl: (String) -> Unit,
  onQueueAssetDownload: (String, String?) -> Unit,
  onDismiss: (dontShowAgain: Boolean) -> Unit,
) {
  val palette = LocalMyLoadPalette.current
  var dontShowAgain by remember { mutableStateOf(false) }

  Dialog(onDismissRequest = { onDismiss(dontShowAgain) }) {
    Surface(
      color = palette.bgSurface,
      contentColor = palette.textPrimary,
      shape = RoundedCornerShape(16.dp),
      border = BorderStroke(1.dp, palette.accent),
    ) {
      Column(modifier = Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("New Version Available", fontWeight = FontWeight.Bold, fontSize = 17.sp)
        Surface(
          color = palette.accentSoft,
          shape = RoundedCornerShape(8.dp),
        ) {
          Text(
            "v${status.currentVersion} → v${status.latestVersion ?: "latest"}",
            color = palette.accent,
            fontWeight = FontWeight.SemiBold,
            fontSize = 12.sp,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
          )
        }
        Text(
          "A newer release of MyLoad Download Manager is available on GitHub. Would you like to download it now or update manually later from the options menu or GitHub?",
          fontSize = 13.sp,
          color = palette.textSecondary,
        )
        Surface(
          color = palette.bgElevated,
          shape = RoundedCornerShape(10.dp),
          modifier = Modifier
            .fillMaxWidth()
            .clickable { dontShowAgain = !dontShowAgain },
        ) {
          Row(modifier = Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = dontShowAgain, onCheckedChange = { dontShowAgain = it })
            Text(
              "Do not show again (I will update manually from the options menu or GitHub)",
              fontSize = 12.sp,
            )
          }
        }
        Row(
          modifier = Modifier.fillMaxWidth(),
          horizontalArrangement = Arrangement.End,
        ) {
          TextButton(onClick = { onOpenReleaseUrl(status.releaseUrl) }) {
            Text("View on GitHub")
          }
          TextButton(onClick = { onDismiss(dontShowAgain) }) {
            Text("Not now")
          }
          Button(
            onClick = {
              val asset = status.assetUrl
              if (!asset.isNullOrBlank()) {
                onQueueAssetDownload(asset, status.assetName)
              } else {
                onOpenReleaseUrl(status.releaseUrl)
              }
              onDismiss(dontShowAgain)
            },
            colors = ButtonDefaults.buttonColors(containerColor = palette.accent),
          ) {
            Text("Download Now", color = Color.White)
          }
        }
      }
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LogsBottomSheet(
  logs: List<LogEntry>,
  onClear: () -> Unit,
  onDismiss: () -> Unit,
) {
  val palette = LocalMyLoadPalette.current
  val clipboard = LocalClipboardManager.current
  var levelFilter by remember { mutableStateOf("all") }
  var query by remember { mutableStateOf("") }

  val filtered = remember(logs, levelFilter, query) {
    logs.filter { entry ->
      val levelOk = levelFilter == "all" || entry.level.equals(levelFilter, ignoreCase = true)
      val qOk = query.isBlank() ||
        entry.message.contains(query, ignoreCase = true) ||
        entry.scope.contains(query, ignoreCase = true)
      levelOk && qOk
    }
  }

  ModalBottomSheet(
    onDismissRequest = onDismiss,
    sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    containerColor = palette.bgSurface,
    contentColor = palette.textPrimary,
  ) {
    Column(
      modifier = Modifier
        .fillMaxWidth()
        .padding(horizontal = 16.dp, vertical = 8.dp),
      verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Text("Activity & Diagnostic Logs (${logs.size})", fontWeight = FontWeight.Bold, fontSize = 17.sp)
        Row {
          TextButton(
            onClick = {
              val text = filtered.joinToString("\n") {
                "${FormatUtils.formatDateShort(it.timestamp)} [${it.level.uppercase()}] [${it.scope}] ${it.message}"
              }
              clipboard.setText(AnnotatedString(text))
            }
          ) {
            Text("Copy")
          }
          TextButton(onClick = onClear) {
            Text("Clear", color = palette.danger)
          }
        }
      }

      Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        listOf("all" to "All", "info" to "Info", "warn" to "Warning", "error" to "Error").forEach { (id, label) ->
          FilterChip(
            selected = levelFilter == id,
            onClick = { levelFilter = id },
            label = { Text(label, fontSize = 12.sp) },
          )
        }
      }

      OutlinedTextField(
        value = query,
        onValueChange = { query = it },
        placeholder = { Text("Filter logs...") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
      )

      LazyColumn(
        modifier = Modifier
          .fillMaxWidth()
          .heightIn(max = 320.dp)
          .padding(bottom = 16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
      ) {
        items(filtered, key = { it.id }) { entry ->
          Surface(
            color = palette.bgElevated,
            shape = RoundedCornerShape(8.dp),
            modifier = Modifier.fillMaxWidth(),
          ) {
            Column(modifier = Modifier.padding(8.dp)) {
              Text(
                "${FormatUtils.formatDateShort(entry.timestamp)} · ${entry.level.uppercase()} · [${entry.scope}]",
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                color = when (entry.level) {
                  "error" -> palette.danger
                  "warn" -> palette.warning
                  else -> palette.accent
                },
              )
              Text(entry.message, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
            }
          }
        }
      }
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun SettingsBottomSheet(
  settings: AppSettings,
  updateStatus: UpdateStatus,
  onUpdate: (AppSettings.() -> AppSettings) -> Unit,
  onReset: () -> Unit,
  onCheckUpdates: () -> Unit,
  onOpenRepo: () -> Unit,
  onDismiss: () -> Unit,
) {
  val palette = LocalMyLoadPalette.current
  var activeTab by remember { mutableIntStateOf(0) }

  ModalBottomSheet(
    onDismissRequest = onDismiss,
    sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    containerColor = palette.bgSurface,
    contentColor = palette.textPrimary,
  ) {
    Column(
      modifier = Modifier
        .fillMaxWidth()
        .verticalScroll(rememberScrollState())
        .padding(horizontal = 16.dp, vertical = 8.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Text("MyLoad Preferences", fontWeight = FontWeight.Bold, fontSize = 18.sp)
        TextButton(onClick = onReset) {
          Text("Reset Defaults", color = palette.danger, fontSize = 12.sp)
        }
      }

      Row(
        modifier = Modifier
          .fillMaxWidth()
          .horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
      ) {
        listOf(
          "General & Folders",
          "Speed & Gaming Mode",
          "Appearance & Language",
          "Power & Updates",
        ).forEachIndexed { idx, title ->
          FilterChip(
            selected = activeTab == idx,
            onClick = { activeTab = idx },
            label = { Text(title, fontSize = 12.sp) },
          )
        }
      }

      when (activeTab) {
        0 -> {
          OutlinedTextField(
            value = settings.defaultDownloadDir,
            onValueChange = { dir -> onUpdate { copy(defaultDownloadDir = dir) } },
            label = { Text("Default Download Folder") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
          )
          Text("Folder Routing Mode", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
          Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FolderRoutingMode.entries.forEach { mode ->
              FilterChip(
                selected = settings.folderRoutingMode == mode,
                onClick = { onUpdate { copy(folderRoutingMode = mode) } },
                label = { Text(mode.label, fontSize = 12.sp) },
              )
            }
          }
          Text("Duplicate File Policy", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
          FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            DuplicatePolicy.entries.forEach { pol ->
              FilterChip(
                selected = settings.duplicatePolicy == pol,
                onClick = { onUpdate { copy(duplicatePolicy = pol) } },
                label = { Text(pol.label, fontSize = 11.5.sp) },
              )
            }
          }
          SettingSwitchRow(
            title = "Show download progress popup automatically on start",
            checked = settings.showProgressPopupOnStart,
            onCheckedChange = { v -> onUpdate { copy(showProgressPopupOnStart = v) } },
          )
          SettingSwitchRow(
            title = "Detect numbered multi-part archives (.part1.rar, .001)",
            checked = settings.detectMultiPartEnabled,
            onCheckedChange = { v -> onUpdate { copy(detectMultiPartEnabled = v) } },
          )
          SettingSwitchRow(
            title = "Monitor clipboard for copied download links",
            checked = settings.watchClipboard,
            onCheckedChange = { v -> onUpdate { copy(watchClipboard = v) } },
          )
        }
        1 -> {
          SettingSwitchRow(
            title = "Gaming / Surfing Mode (Lag & Packet-Loss Protection)",
            checked = settings.gamingModeEnabled,
            onCheckedChange = { v -> onUpdate { copy(gamingModeEnabled = v) } },
          )
          FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            GamingModeProfile.entries.forEach { prof ->
              FilterChip(
                selected = settings.gamingModeProfile == prof,
                onClick = { onUpdate { copy(gamingModeProfile = prof) } },
                label = { Text(prof.title, fontSize = 12.sp) },
              )
            }
          }
          Text("Multi-Download Queue Mode", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
          FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            QueueMode.entries.forEach { qm ->
              FilterChip(
                selected = settings.queueMode == qm,
                onClick = { onUpdate { copy(queueMode = qm) } },
                label = { Text(qm.title, fontSize = 12.sp) },
              )
            }
          }

          SettingSwitchRow(
            title = "Cap global download speed (Unchecked = Max Unlimited Bandwidth)",
            checked = settings.downloadSpeedLimitEnabled,
            onCheckedChange = { v -> onUpdate { copy(downloadSpeedLimitEnabled = v) } },
          )
          if (settings.downloadSpeedLimitEnabled) {
            Row(
              verticalAlignment = Alignment.CenterVertically,
              horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
              OutlinedTextField(
                value = settings.downloadSpeedLimitValue.toString(),
                onValueChange = { v ->
                  val n = v.filter { it.isDigit() }.toIntOrNull()?.coerceAtLeast(1) ?: 1
                  onUpdate { copy(downloadSpeedLimitValue = n) }
                },
                label = { Text("Speed Cap") },
                modifier = Modifier.weight(1f),
                singleLine = true,
              )
              SpeedUnit.entries.forEach { u ->
                FilterChip(
                  selected = settings.downloadSpeedLimitUnit == u,
                  onClick = { onUpdate { copy(downloadSpeedLimitUnit = u) } },
                  label = { Text(u.label) },
                )
              }
            }
          }

          Text("HTTP Segments per Download: ${settings.httpConnections} (Max 32)", fontSize = 12.5.sp, fontWeight = FontWeight.Medium)
          Slider(
            value = settings.httpConnections.toFloat(),
            onValueChange = { v -> onUpdate { copy(httpConnections = v.toInt().coerceIn(1, 32)) } },
            valueRange = 1f..32f,
            steps = 30,
          )

          Text("Max Concurrent Downloads: ${settings.maxConcurrentDownloads}", fontSize = 12.5.sp, fontWeight = FontWeight.Medium)
          Slider(
            value = settings.maxConcurrentDownloads.toFloat(),
            onValueChange = { v -> onUpdate { copy(maxConcurrentDownloads = v.toInt().coerceIn(1, 10)) } },
            valueRange = 1f..10f,
            steps = 8,
          )
        }
        2 -> {
          Text("Theme Mode", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
          FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            ThemeMode.entries.forEach { tm ->
              FilterChip(
                selected = settings.themeMode == tm,
                onClick = { onUpdate { copy(themeMode = tm) } },
                label = { Text(tm.label, fontSize = 12.sp) },
              )
            }
          }
          Text("Font Scale", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
          Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            FontScale.entries.forEach { fs ->
              FilterChip(
                selected = settings.fontScale == fs,
                onClick = { onUpdate { copy(fontScale = fs) } },
                label = { Text(fs.label, fontSize = 12.sp) },
              )
            }
          }
          Text("Interface Language (9 Languages + RTL)", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
          FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            AppLanguage.entries.forEach { lang ->
              FilterChip(
                selected = settings.language == lang,
                onClick = { onUpdate { copy(language = lang) } },
                label = { Text(lang.nativeName, fontSize = 12.sp) },
              )
            }
          }
        }
        3 -> {
          SettingSwitchRow(
            title = "Download only on Wi-Fi networks",
            checked = settings.wifiOnlyDownloads,
            onCheckedChange = { v -> onUpdate { copy(wifiOnlyDownloads = v) } },
          )
          SettingSwitchRow(
            title = "Keep CPU WakeLock active while downloads are running",
            checked = settings.keepAwakeDuringDownload,
            onCheckedChange = { v -> onUpdate { copy(keepAwakeDuringDownload = v) } },
          )
          SettingSwitchRow(
            title = "Auto-resume incomplete downloads on app launch",
            checked = settings.autoResumeOnStart,
            onCheckedChange = { v -> onUpdate { copy(autoResumeOnStart = v) } },
          )
          SettingSwitchRow(
            title = "Keep seeding torrents after reaching 100%",
            checked = settings.keepSeedingAfterComplete,
            onCheckedChange = { v -> onUpdate { copy(keepSeedingAfterComplete = v) } },
          )
          SettingSwitchRow(
            title = "Completion notification & sound chime",
            checked = settings.completionNotifications,
            onCheckedChange = { v -> onUpdate { copy(completionNotifications = v, completionSound = v) } },
          )
          SettingSwitchRow(
            title = "Check GitHub for new MyLoad versions automatically on launch",
            checked = settings.autoCheckUpdates,
            onCheckedChange = { v -> onUpdate { copy(autoCheckUpdates = v) } },
          )
          SettingSwitchRow(
            title = "Show update reminder popup on launch when a newer version is available",
            checked = !settings.hideUpdatePrompt,
            onCheckedChange = { v -> onUpdate { copy(hideUpdatePrompt = !v) } },
          )

          Row(
            modifier = Modifier
              .fillMaxWidth()
              .padding(top = 6.dp, bottom = 16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
          ) {
            OutlinedButton(onClick = onCheckUpdates) {
              Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(16.dp))
              Spacer(Modifier.width(6.dp))
              Text(
                when (updateStatus.state) {
                  "checking" -> "Checking..."
                  "available" -> "v${updateStatus.latestVersion} Available!"
                  else -> "Check for Updates (v1.0.12)"
                },
                fontSize = 12.sp,
              )
            }
            TextButton(onClick = onOpenRepo) {
              Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = null, modifier = Modifier.size(16.dp))
              Spacer(Modifier.width(4.dp))
              Text("GitHub Repo", fontSize = 12.sp)
            }
          }
        }
      }
      Spacer(Modifier.height(16.dp))
    }
  }
}

@Composable
private fun SettingSwitchRow(
  title: String,
  checked: Boolean,
  onCheckedChange: (Boolean) -> Unit,
) {
  Row(
    modifier = Modifier
      .fillMaxWidth()
      .clickable { onCheckedChange(!checked) }
      .padding(vertical = 4.dp),
    horizontalArrangement = Arrangement.SpaceBetween,
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Text(title, fontSize = 13.sp, modifier = Modifier.weight(1f))
    Switch(checked = checked, onCheckedChange = onCheckedChange)
  }
}
