package com.myload.app.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ListAlt
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PauseCircle
import androidx.compose.material.icons.filled.PictureInPictureAlt
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.myload.app.engine.MyLoadController
import com.myload.app.model.CategoryFilter
import com.myload.app.model.DownloadItem
import com.myload.app.model.DownloadKind
import com.myload.app.model.DownloadStatus
import com.myload.app.model.FileCategory
import com.myload.app.model.FormatUtils
import com.myload.app.model.I18n
import com.myload.app.model.PowerAction
import com.myload.app.model.QueueMode
import com.myload.app.model.SegmentStatus
import com.myload.app.model.SortBy
import com.myload.app.ui.components.AddDownloadSheet
import com.myload.app.ui.components.CompactProgressPopupDialog
import com.myload.app.ui.components.InAppBrowserSheet
import com.myload.app.ui.components.InspectorBottomSheet
import com.myload.app.ui.components.LogsBottomSheet
import com.myload.app.ui.components.MediaGrabberSheet
import com.myload.app.ui.components.RemoveConfirmDialog
import com.myload.app.ui.components.ScheduleDownloadDialog
import com.myload.app.ui.components.SettingsBottomSheet
import com.myload.app.ui.components.UpdatePromptDialog
import com.myload.app.ui.theme.LocalMyLoadPalette
import com.myload.app.ui.theme.MyLoadTheme

@Suppress("DEPRECATION")
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MyLoadScreen(
  controller: MyLoadController,
  incomingIntentSource: String?,
  onConsumeIntentSource: () -> Unit,
) {
  val downloads by controller.downloads.collectAsState()
  val settings by controller.settings.collectAsState()
  val networkBalance by controller.networkBalance.collectAsState()
  val logs by controller.logs.collectAsState()
  val updateStatus by controller.updateStatus.collectAsState()
  val activePopupId by controller.activePopupDownloadId.collectAsState()
  val wakeLockActive by controller.wakeLockActive.collectAsState()
  val lastToast by controller.lastToast.collectAsState()

  val context = LocalContext.current
  val clipboard = LocalClipboardManager.current
  val snackbarHostState = remember { SnackbarHostState() }

  var activeCategory by remember { mutableStateOf(CategoryFilter.ALL) }
  var sortBy by remember { mutableStateOf(SortBy.NEWEST) }
  var searchQuery by remember { mutableStateOf("") }
  var searchVisible by remember { mutableStateOf(false) }
  var selectedIds by remember { mutableStateOf<Set<String>>(emptySet()) }
  var focusedId by remember { mutableStateOf<String?>(null) }

  var addSheetOpen by remember { mutableStateOf(false) }
  var addSheetInitialUrl by remember { mutableStateOf("") }
  var mediaGrabberOpen by remember { mutableStateOf(false) }
  var browserOpen by remember { mutableStateOf(false) }
  var settingsOpen by remember { mutableStateOf(false) }
  var logsOpen by remember { mutableStateOf(false) }
  var inspectorItem by remember { mutableStateOf<DownloadItem?>(null) }
  var scheduleModalItem by remember { mutableStateOf<DownloadItem?>(null) }
  var removeConfirmState by remember { mutableStateOf<Pair<List<String>, Boolean>?>(null) }
  var updatePromptDismissed by remember { mutableStateOf(false) }
  var forceUpdatePrompt by remember { mutableStateOf(false) }
  var sortMenuOpen by remember { mutableStateOf(false) }
  var overflowMenuOpen by remember { mutableStateOf(false) }

  LaunchedEffect(incomingIntentSource) {
    if (!incomingIntentSource.isNullOrBlank()) {
      addSheetInitialUrl = incomingIntentSource
      addSheetOpen = true
      onConsumeIntentSource()
    }
  }

  LaunchedEffect(lastToast) {
    val msg = lastToast
    if (!msg.isNullOrBlank()) {
      controller.clearToast()
      snackbarHostState.showSnackbar(msg)
    }
  }

  LaunchedEffect(downloads) {
    val validIds = downloads.map { it.id }.toSet()
    if (selectedIds.any { it !in validIds }) {
      selectedIds = selectedIds.intersect(validIds)
    }
  }

  val visibleDownloads = remember(downloads, activeCategory, searchQuery, sortBy) {
    val q = searchQuery.trim()
    val filtered = downloads.filter { item ->
      FormatUtils.matchesCategory(item, activeCategory) &&
        (q.isEmpty() ||
          item.name.contains(q, ignoreCase = true) ||
          item.source.contains(q, ignoreCase = true) ||
          item.category.label.contains(q, ignoreCase = true))
    }
    FormatUtils.sortDownloads(filtered, sortBy)
  }

  val allVisibleSelected =
    visibleDownloads.isNotEmpty() && visibleDownloads.all { selectedIds.contains(it.id) }

  val effectiveSelectedItems = remember(downloads, selectedIds, focusedId) {
    if (selectedIds.isNotEmpty()) {
      downloads.filter { selectedIds.contains(it.id) }
    } else {
      downloads.filter { it.id == focusedId }
    }
  }

  val activeRunningItems = remember(downloads) {
    downloads.filter {
      it.status == DownloadStatus.DOWNLOADING ||
        it.status == DownloadStatus.PROBING ||
        it.status == DownloadStatus.SEEDING
    }
  }
  val totalDownloadSpeed = remember(activeRunningItems) { activeRunningItems.sumOf { it.downloadSpeed } }
  val totalUploadSpeed = remember(activeRunningItems) { activeRunningItems.sumOf { it.uploadSpeed } }
  val errorLogCount = remember(logs) { logs.count { it.level == "error" } }

  MyLoadTheme(settings = settings) {
    val palette = LocalMyLoadPalette.current

    Scaffold(
      containerColor = palette.bgCanvas,
      contentColor = palette.textPrimary,
      snackbarHost = { SnackbarHost(snackbarHostState) },
      topBar = {
        Column(
          modifier = Modifier
            .fillMaxWidth()
            .background(palette.bgSurface)
            .statusBarsPadding(),
        ) {
          Row(
            modifier = Modifier
              .fillMaxWidth()
              .padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
          ) {
            Row(
              verticalAlignment = Alignment.CenterVertically,
              horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
              Box(
                modifier = Modifier
                  .size(28.dp)
                  .clip(RoundedCornerShape(8.dp))
                  .background(palette.accent),
                contentAlignment = Alignment.Center,
              ) {
                Text("ml", color = Color.White, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp)
              }
              Text(
                text = I18n.t(settings.language, "appTitle"),
                fontWeight = FontWeight.Bold,
                fontSize = 15.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
              )
              if (activeRunningItems.isNotEmpty()) {
                Surface(
                  color = palette.accentSoft,
                  shape = CircleShape,
                  border = BorderStroke(1.dp, palette.accent.copy(alpha = 0.5f)),
                ) {
                  Text(
                    text = "${activeRunningItems.size} active · ↓ ${FormatUtils.formatSpeed(totalDownloadSpeed)}",
                    color = palette.accent,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                  )
                }
              }
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
              IconButton(onClick = { searchVisible = !searchVisible }) {
                Icon(Icons.Default.Search, contentDescription = "Search", tint = palette.textSecondary)
              }
              IconButton(onClick = { browserOpen = true }) {
                Icon(Icons.Default.Language, contentDescription = "Built-in Browser", tint = palette.textSecondary)
              }
              IconButton(onClick = { mediaGrabberOpen = true }) {
                Icon(Icons.Default.VideoLibrary, contentDescription = "Media Grabber", tint = palette.accent)
              }
              IconButton(onClick = { settingsOpen = true }) {
                Icon(Icons.Default.Settings, contentDescription = "Settings", tint = palette.textSecondary)
              }
              Box {
                IconButton(onClick = { overflowMenuOpen = true }) {
                  Icon(Icons.Default.MoreVert, contentDescription = "More options", tint = palette.textSecondary)
                }
                DropdownMenu(
                  expanded = overflowMenuOpen,
                  onDismissRequest = { overflowMenuOpen = false },
                ) {
                  DropdownMenuItem(
                    text = { Text("Paste link from clipboard") },
                    leadingIcon = { Icon(Icons.Default.ContentPaste, contentDescription = null) },
                    onClick = {
                      overflowMenuOpen = false
                      val clip = clipboard.getText()?.text?.trim().orEmpty()
                      val urls = FormatUtils.extractMultipleSources(clip)
                      when {
                        urls.size == 1 -> {
                          addSheetInitialUrl = urls.first()
                          addSheetOpen = true
                        }
                        urls.size > 1 -> controller.addBatchDownloads(urls)
                        else -> controller.showToast("No valid URL or magnet link found in clipboard")
                      }
                    },
                  )
                  DropdownMenuItem(
                    text = { Text("Resume all downloads") },
                    leadingIcon = { Icon(Icons.Default.PlayArrow, contentDescription = null) },
                    onClick = {
                      overflowMenuOpen = false
                      controller.resumeAll()
                    },
                  )
                  DropdownMenuItem(
                    text = { Text("Pause all downloads") },
                    leadingIcon = { Icon(Icons.Default.PauseCircle, contentDescription = null) },
                    onClick = {
                      overflowMenuOpen = false
                      controller.pauseAll()
                    },
                  )
                  DropdownMenuItem(
                    text = {
                      Text(
                        if (errorLogCount > 0) "Activity Logs ($errorLogCount error)"
                        else "Activity Logs"
                      )
                    },
                    leadingIcon = { Icon(Icons.AutoMirrored.Filled.ListAlt, contentDescription = null) },
                    onClick = {
                      overflowMenuOpen = false
                      logsOpen = true
                    },
                  )
                  DropdownMenuItem(
                    text = { Text("Check GitHub for updates") },
                    leadingIcon = { Icon(Icons.Default.Refresh, contentDescription = null) },
                    onClick = {
                      overflowMenuOpen = false
                      updatePromptDismissed = false
                      forceUpdatePrompt = true
                      controller.checkForUpdates(manual = true)
                    },
                  )
                }
              }
            }
          }

          if (searchVisible) {
            OutlinedTextField(
              value = searchQuery,
              onValueChange = { searchQuery = it },
              placeholder = { Text(I18n.t(settings.language, "searchPlaceholder")) },
              singleLine = true,
              trailingIcon = {
                if (searchQuery.isNotEmpty()) {
                  IconButton(onClick = { searchQuery = "" }) {
                    Icon(Icons.Default.Close, contentDescription = "Clear search")
                  }
                }
              },
              modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 4.dp),
            )
          }

          Row(
            modifier = Modifier
              .fillMaxWidth()
              .horizontalScroll(rememberScrollState())
              .padding(horizontal = 12.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
          ) {
            Button(
              onClick = {
                addSheetInitialUrl = ""
                addSheetOpen = true
              },
              colors = ButtonDefaults.buttonColors(containerColor = palette.accent),
              contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
              shape = RoundedCornerShape(10.dp),
            ) {
              Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(16.dp), tint = Color.White)
              Spacer(Modifier.width(4.dp))
              Text(I18n.t(settings.language, "addDownload"), fontSize = 12.5.sp, color = Color.White)
            }

            Surface(
              color = palette.bgElevated,
              shape = RoundedCornerShape(10.dp),
              border = BorderStroke(1.dp, palette.borderSubtle),
            ) {
              Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp),
              ) {
                TextButton(
                  onClick = {
                    effectiveSelectedItems.forEach { controller.resumeDownload(it.id) }
                  },
                  enabled = effectiveSelectedItems.any { it.status == DownloadStatus.PAUSED || it.status == DownloadStatus.ERROR },
                ) {
                  Icon(Icons.Default.PlayArrow, contentDescription = null, modifier = Modifier.size(16.dp))
                  Spacer(Modifier.width(3.dp))
                  Text(I18n.t(settings.language, "resume"), fontSize = 12.sp)
                }
                TextButton(
                  onClick = {
                    effectiveSelectedItems.forEach { controller.pauseDownload(it.id) }
                  },
                  enabled = effectiveSelectedItems.any { it.isRunning },
                ) {
                  Icon(Icons.Default.Pause, contentDescription = null, modifier = Modifier.size(16.dp))
                  Spacer(Modifier.width(3.dp))
                  Text(I18n.t(settings.language, "pause"), fontSize = 12.sp)
                }
                TextButton(
                  onClick = { controller.pauseAll() },
                  enabled = downloads.any { it.isRunning },
                ) {
                  Icon(Icons.Default.PauseCircle, contentDescription = null, modifier = Modifier.size(16.dp))
                  Spacer(Modifier.width(3.dp))
                  Text(I18n.t(settings.language, "pauseAll"), fontSize = 12.sp)
                }
                TextButton(
                  onClick = {
                    val targetIds = effectiveSelectedItems.map { it.id }
                    if (targetIds.isNotEmpty()) {
                      removeConfirmState = Pair(targetIds, false)
                    }
                  },
                  enabled = effectiveSelectedItems.isNotEmpty(),
                ) {
                  Icon(
                    Icons.Default.Delete,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                    tint = if (effectiveSelectedItems.isNotEmpty()) palette.danger else palette.textMuted,
                  )
                  Spacer(Modifier.width(3.dp))
                  val count = effectiveSelectedItems.size
                  Text(
                    text = when {
                      allVisibleSelected && count > 1 -> "Delete all ($count)"
                      count > 1 -> "Delete ($count)"
                      else -> I18n.t(settings.language, "remove")
                    },
                    fontSize = 12.sp,
                    color = if (count > 0) palette.danger else palette.textMuted,
                    fontWeight = if (count > 1) FontWeight.SemiBold else FontWeight.Normal,
                  )
                }
              }
            }

            Box {
              Surface(
                color = palette.bgElevated,
                shape = RoundedCornerShape(10.dp),
                border = if (sortMenuOpen) BorderStroke(1.dp, palette.accent) else null,
                modifier = Modifier.clickable { sortMenuOpen = true },
              ) {
                Row(
                  verticalAlignment = Alignment.CenterVertically,
                  modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
                ) {
                  Icon(Icons.AutoMirrored.Filled.Sort, contentDescription = null, modifier = Modifier.size(15.dp), tint = palette.textSecondary)
                  Spacer(Modifier.width(5.dp))
                  Text(sortBy.label, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                }
              }
              DropdownMenu(
                expanded = sortMenuOpen,
                onDismissRequest = { sortMenuOpen = false },
              ) {
                SortBy.entries.forEach { option ->
                  DropdownMenuItem(
                    text = {
                      Text(
                        option.label,
                        fontWeight = if (sortBy == option) FontWeight.Bold else FontWeight.Normal,
                        color = if (sortBy == option) palette.accent else palette.textPrimary,
                      )
                    },
                    onClick = {
                      sortBy = option
                      sortMenuOpen = false
                    },
                  )
                }
              }
            }
          }

          Row(
            modifier = Modifier
              .fillMaxWidth()
              .horizontalScroll(rememberScrollState())
              .padding(horizontal = 12.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
          ) {
            CategoryFilter.entries.forEach { cat ->
              val count = downloads.count { FormatUtils.matchesCategory(it, cat) }
              val selected = activeCategory == cat
              Surface(
                color = if (selected) palette.accentSoft else palette.bgElevated,
                shape = RoundedCornerShape(10.dp),
                border = BorderStroke(1.dp, if (selected) palette.accent else palette.borderSubtle),
                modifier = Modifier.clickable { activeCategory = cat },
              ) {
                Row(
                  verticalAlignment = Alignment.CenterVertically,
                  horizontalArrangement = Arrangement.spacedBy(5.dp),
                  modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                ) {
                  Text(
                    cat.label,
                    fontSize = 12.sp,
                    fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                    color = if (selected) palette.textPrimary else palette.textSecondary,
                  )
                  Surface(
                    color = if (selected) palette.accent else palette.bgCanvas,
                    shape = CircleShape,
                  ) {
                    Text(
                      "$count",
                      fontSize = 10.sp,
                      fontWeight = FontWeight.Bold,
                      color = if (selected) Color.White else palette.textMuted,
                      modifier = Modifier.padding(horizontal = 6.dp, vertical = 1.dp),
                    )
                  }
                }
              }
            }
          }
          HorizontalDivider(color = palette.borderSubtle)
        }
      },
      bottomBar = {
        Surface(
          color = palette.bgSurface,
          border = BorderStroke(1.dp, palette.borderSubtle),
          modifier = Modifier
            .fillMaxWidth()
            .navigationBarsPadding(),
        ) {
          Row(
            modifier = Modifier
              .fillMaxWidth()
              .horizontalScroll(rememberScrollState())
              .padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
          ) {
            Text(
              "↓ ${FormatUtils.formatSpeed(totalDownloadSpeed)}  ↑ ${FormatUtils.formatSpeed(totalUploadSpeed)}",
              fontSize = 11.5.sp,
              fontFamily = FontFamily.Monospace,
              fontWeight = FontWeight.SemiBold,
            )

            StatusPill(
              text = if (settings.downloadSpeedLimitEnabled) {
                "Limit: ${settings.downloadSpeedLimitValue} ${settings.downloadSpeedLimitUnit.label}"
              } else {
                "Speed: Unlimited"
              },
              active = settings.downloadSpeedLimitEnabled,
              onClick = {
                controller.updateSettings { copy(downloadSpeedLimitEnabled = !downloadSpeedLimitEnabled) }
              },
            )

            StatusPill(
              text = if (settings.gamingModeEnabled) {
                val rtt = networkBalance.rttMs?.let { " (${it}ms)" } ?: ""
                "Gaming/Surfing: On$rtt"
              } else {
                "Gaming/Surfing: Off"
              },
              active = settings.gamingModeEnabled,
              onClick = {
                controller.updateSettings { copy(gamingModeEnabled = !gamingModeEnabled) }
              },
            )

            StatusPill(
              text = when (settings.queueMode) {
                QueueMode.PARALLEL -> "Queue: Parallel"
                QueueMode.SEQUENTIAL -> "Queue: Sequential"
                QueueMode.PARALLEL_EQUAL -> "Queue: Equal Split"
              },
              active = settings.queueMode != QueueMode.PARALLEL,
              onClick = {
                val next = when (settings.queueMode) {
                  QueueMode.PARALLEL -> QueueMode.SEQUENTIAL
                  QueueMode.SEQUENTIAL -> QueueMode.PARALLEL_EQUAL
                  QueueMode.PARALLEL_EQUAL -> QueueMode.PARALLEL
                }
                controller.updateSettings { copy(queueMode = next) }
              },
            )

            if (wakeLockActive) {
              Surface(
                color = palette.success.copy(alpha = 0.16f),
                shape = RoundedCornerShape(8.dp),
                border = BorderStroke(1.dp, palette.success.copy(alpha = 0.45f)),
              ) {
                Text(
                  "Awake lock active",
                  color = palette.success,
                  fontSize = 11.sp,
                  fontWeight = FontWeight.SemiBold,
                  modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                )
              }
            }
          }
        }
      },
    ) { innerPadding ->
      Column(
        modifier = Modifier
          .fillMaxSize()
          .padding(innerPadding)
          .padding(horizontal = 10.dp, vertical = 6.dp),
      ) {
        if (visibleDownloads.isNotEmpty()) {
          Surface(
            color = palette.bgElevated,
            shape = RoundedCornerShape(10.dp),
            border = BorderStroke(1.dp, palette.borderSubtle),
            modifier = Modifier
              .fillMaxWidth()
              .padding(bottom = 6.dp),
          ) {
            Row(
              modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 10.dp, vertical = 4.dp),
              horizontalArrangement = Arrangement.SpaceBetween,
              verticalAlignment = Alignment.CenterVertically,
            ) {
              Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.clickable {
                  selectedIds = if (allVisibleSelected) {
                    emptySet()
                  } else {
                    visibleDownloads.map { it.id }.toSet()
                  }
                },
              ) {
                Checkbox(
                  checked = allVisibleSelected,
                  onCheckedChange = {
                    selectedIds = if (allVisibleSelected) {
                      emptySet()
                    } else {
                      visibleDownloads.map { it.id }.toSet()
                    }
                  },
                  colors = CheckboxDefaults.colors(checkedColor = palette.accent),
                )
                Text(
                  text = if (selectedIds.isNotEmpty()) {
                    "${selectedIds.size} of ${visibleDownloads.size} selected"
                  } else {
                    "Select all (${visibleDownloads.size})"
                  },
                  fontSize = 12.5.sp,
                  fontWeight = FontWeight.Medium,
                )
              }

              if (selectedIds.isNotEmpty()) {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                  TextButton(
                    onClick = {
                      val ids = visibleDownloads.filter { selectedIds.contains(it.id) }.map { it.id }
                      if (ids.isNotEmpty()) {
                        removeConfirmState = Pair(ids, false)
                      }
                    }
                  ) {
                    Icon(Icons.Default.Delete, contentDescription = null, tint = palette.danger, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(
                      if (allVisibleSelected && selectedIds.size > 1) "Delete all (${selectedIds.size})"
                      else "Delete (${selectedIds.size})",
                      color = palette.danger,
                      fontSize = 12.sp,
                      fontWeight = FontWeight.Bold,
                    )
                  }
                }
              }
            }
          }
        }

        if (visibleDownloads.isEmpty()) {
          Box(
            modifier = Modifier
              .fillMaxWidth()
              .weight(1f)
              .clip(RoundedCornerShape(14.dp))
              .border(BorderStroke(1.dp, palette.borderSubtle), RoundedCornerShape(14.dp))
              .background(palette.bgSurface)
              .clickable {
                addSheetInitialUrl = ""
                addSheetOpen = true
              },
            contentAlignment = Alignment.Center,
          ) {
            Column(
              horizontalAlignment = Alignment.CenterHorizontally,
              verticalArrangement = Arrangement.spacedBy(8.dp),
              modifier = Modifier.padding(24.dp),
            ) {
              Text(
                text = if (downloads.isEmpty()) I18n.t(settings.language, "emptyList")
                else I18n.t(settings.language, "noMatch"),
                color = palette.textSecondary,
                fontSize = 13.5.sp,
              )
              Text(
                "Supports multi-segment HTTP/HTTPS (up to 32 threads), BitTorrent Magnets & .torrent folders, Social & Custom URL Media Grabber, and ADM-style In-App Browser Sniffer",
                color = palette.textMuted,
                fontSize = 11.5.sp,
              )
            }
          }
        } else {
          LazyColumn(
            modifier = Modifier
              .fillMaxWidth()
              .weight(1f),
            verticalArrangement = Arrangement.spacedBy(8.dp),
          ) {
            items(visibleDownloads, key = { it.id }) { item ->
              val isSelected = selectedIds.contains(item.id)
              val isFocused = focusedId == item.id
              val visibleSelectedIds = visibleDownloads.filter { selectedIds.contains(it.id) }.map { it.id }
              val bulkIds = if (visibleSelectedIds.size > 1 && isSelected) visibleSelectedIds else listOf(item.id)

              DownloadRowCard(
                item = item,
                isSelected = isSelected,
                isFocused = isFocused,
                allSelected = allVisibleSelected,
                bulkIds = bulkIds,
                onToggleSelect = {
                  selectedIds = if (isSelected) selectedIds - item.id else selectedIds + item.id
                },
                onFocus = { focusedId = item.id },
                onInspect = {
                  focusedId = item.id
                  inspectorItem = item
                },
                onShowPopup = { controller.openProgressPopup(item.id) },
                onPause = { controller.pauseDownload(item.id) },
                onResume = { controller.resumeDownload(item.id) },
                onRetry = { controller.retryDownload(item.id) },
                onCopySource = {
                  clipboard.setText(AnnotatedString(item.source))
                  controller.showToast("Source link copied to clipboard")
                },
                onSchedule = { scheduleModalItem = item },
                onRequestRemove = { ids, deleteDefault ->
                  removeConfirmState = Pair(ids, deleteDefault)
                },
              )
            }
          }
        }
      }
    }

    if (addSheetOpen) {
      AddDownloadSheet(
        controller = controller,
        settings = settings,
        initialSource = addSheetInitialUrl,
        onDismiss = { addSheetOpen = false },
      )
    }

    if (mediaGrabberOpen) {
      MediaGrabberSheet(
        controller = controller,
        onDismiss = { mediaGrabberOpen = false },
      )
    }

    if (browserOpen) {
      InAppBrowserSheet(
        controller = controller,
        onQueueUrl = { url ->
          browserOpen = false
          addSheetInitialUrl = url
          addSheetOpen = true
        },
        onDismiss = { browserOpen = false },
      )
    }

    if (settingsOpen) {
      SettingsBottomSheet(
        settings = settings,
        updateStatus = updateStatus,
        onUpdate = { patch -> controller.updateSettings(patch) },
        onReset = { controller.resetSettings() },
        onCheckUpdates = {
          updatePromptDismissed = false
          forceUpdatePrompt = true
          controller.checkForUpdates(manual = true)
        },
        onOpenRepo = {
          runCatching {
            context.startActivity(
              Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/arshiatxd/MLDM-MyLoadDownloadManager"))
            )
          }
        },
        onDismiss = { settingsOpen = false },
      )
    }

    if (logsOpen) {
      LogsBottomSheet(
        logs = logs,
        onClear = { controller.clearLogs() },
        onDismiss = { logsOpen = false },
      )
    }

    inspectorItem?.let { current ->
      val liveItem = downloads.find { it.id == current.id } ?: current
      InspectorBottomSheet(
        item = liveItem,
        logs = logs,
        onUpdateTorrentFiles = { indices -> controller.updateTorrentFileSelection(liveItem.id, indices) },
        onDismiss = { inspectorItem = null },
      )
    }

    scheduleModalItem?.let { item ->
      ScheduleDownloadDialog(
        item = item,
        onSave = { sched -> controller.updateDownloadSchedule(item.id, sched) },
        onDismiss = { scheduleModalItem = null },
      )
    }

    removeConfirmState?.let { (ids, deleteDefault) ->
      RemoveConfirmDialog(
        count = ids.size,
        defaultDeleteFiles = deleteDefault,
        onConfirm = { deleteFiles ->
          controller.removeDownloads(ids, deleteFiles)
          selectedIds = selectedIds - ids.toSet()
          if (focusedId in ids) focusedId = null
          removeConfirmState = null
        },
        onDismiss = { removeConfirmState = null },
      )
    }

    activePopupId?.let { pid ->
      val popupItem = downloads.find { it.id == pid }
      if (popupItem != null) {
        CompactProgressPopupDialog(
          item = popupItem,
          onPause = { controller.pauseDownload(popupItem.id) },
          onResume = { controller.resumeDownload(popupItem.id) },
          onRetry = { controller.retryDownload(popupItem.id) },
          onInspect = { inspectorItem = popupItem },
          onDismiss = { controller.closeProgressPopup() },
        )
      }
    }

    val showUpdateModal =
      updateStatus.state == "available" &&
        !updatePromptDismissed &&
        (!settings.hideUpdatePrompt || forceUpdatePrompt)

    if (showUpdateModal) {
      UpdatePromptDialog(
        status = updateStatus,
        onOpenReleaseUrl = { url ->
          runCatching {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
          }
        },
        onQueueAssetDownload = { assetUrl, assetName ->
          controller.addDownload(source = assetUrl, fileName = assetName)
        },
        onDismiss = { dontShowAgain ->
          updatePromptDismissed = true
          forceUpdatePrompt = false
          if (dontShowAgain) {
            controller.updateSettings { copy(hideUpdatePrompt = true) }
          }
        },
      )
    }
  }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun DownloadRowCard(
  item: DownloadItem,
  isSelected: Boolean,
  isFocused: Boolean,
  allSelected: Boolean,
  bulkIds: List<String>,
  onToggleSelect: () -> Unit,
  onFocus: () -> Unit,
  onInspect: () -> Unit,
  onShowPopup: () -> Unit,
  onPause: () -> Unit,
  onResume: () -> Unit,
  onRetry: () -> Unit,
  onCopySource: () -> Unit,
  onSchedule: () -> Unit,
  onRequestRemove: (List<String>, Boolean) -> Unit,
) {
  val palette = LocalMyLoadPalette.current
  var menuOpen by remember { mutableStateOf(false) }
  val isBulk = bulkIds.size > 1
  val scheduleSummary = remember(item.schedule) { FormatUtils.formatScheduleSummary(item.schedule) }

  Surface(
    color = if (isSelected || isFocused) palette.accentSoft else palette.bgSurface,
    shape = RoundedCornerShape(12.dp),
    border = BorderStroke(
      1.dp,
      if (isSelected) palette.accent else palette.borderSubtle,
    ),
    modifier = Modifier
      .fillMaxWidth()
      .combinedClickable(
        onClick = onFocus,
        onLongClick = {
          onFocus()
          menuOpen = true
        },
      ),
  ) {
    Column(
      modifier = Modifier.padding(horizontal = 10.dp, vertical = 10.dp),
      verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
      Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
      ) {
        Checkbox(
          checked = isSelected,
          onCheckedChange = { onToggleSelect() },
          colors = CheckboxDefaults.colors(checkedColor = palette.accent),
        )

        Icon(
          imageVector = when (item.category) {
            FileCategory.VIDEOS -> Icons.Default.Movie
            FileCategory.IMAGES -> Icons.Default.Image
            FileCategory.DOCS -> Icons.Default.Description
            FileCategory.ARCHIVES -> Icons.Default.Archive
            FileCategory.TORRENTS -> Icons.Default.Share
            FileCategory.OTHER -> Icons.Default.Description
          },
          contentDescription = null,
          tint = palette.accent,
          modifier = Modifier.size(20.dp),
        )

        Column(modifier = Modifier.weight(1f)) {
          Text(
            text = item.name,
            fontWeight = FontWeight.SemiBold,
            fontSize = 13.5.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
          )
          val subtitle = when {
            item.status == DownloadStatus.ERROR && !item.errorMessage.isNullOrBlank() -> item.errorMessage
            scheduleSummary != null && item.status != DownloadStatus.COMPLETED -> "Scheduled: $scheduleSummary"
            item.kind == DownloadKind.TORRENT && item.torrent != null ->
              "Torrent · ${item.torrent.peers} peers · ${item.torrent.seeds} seeds · Ratio ${item.torrent.ratio}"
            item.segments.size > 1 && item.status == DownloadStatus.DOWNLOADING ->
              "${item.segments.count { it.status == SegmentStatus.ACTIVE }} active / ${item.segments.size} connections"
            item.kind == DownloadKind.MEDIA ->
              "Media${item.mediaFormat?.let { " · $it" } ?: ""}${item.mediaQuality?.let { " · $it" } ?: ""}"
            else -> "${FormatUtils.formatBytes(item.downloadedBytes)} / ${FormatUtils.formatBytes(item.totalBytes)}"
          }
          Text(
            text = subtitle,
            fontSize = 11.5.sp,
            color = if (item.status == DownloadStatus.ERROR) palette.danger else palette.textSecondary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
          )
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
          when {
            item.status == DownloadStatus.ERROR -> {
              IconButton(onClick = onRetry, modifier = Modifier.size(32.dp)) {
                Icon(Icons.Default.Refresh, contentDescription = "Retry", tint = palette.accent)
              }
            }
            item.status != DownloadStatus.COMPLETED -> {
              if (item.isRunning) {
                IconButton(onClick = onPause, modifier = Modifier.size(32.dp)) {
                  Icon(Icons.Default.Pause, contentDescription = "Pause", tint = palette.textSecondary)
                }
              } else {
                IconButton(onClick = onResume, modifier = Modifier.size(32.dp)) {
                  Icon(Icons.Default.PlayArrow, contentDescription = "Resume", tint = palette.accent)
                }
              }
            }
          }

          Box {
            IconButton(onClick = { menuOpen = true }, modifier = Modifier.size(32.dp)) {
              Icon(Icons.Default.MoreVert, contentDescription = "Actions", tint = palette.textSecondary)
            }
            DropdownMenu(
              expanded = menuOpen,
              onDismissRequest = { menuOpen = false },
            ) {
              DropdownMenuItem(
                text = { Text("Inspect details") },
                leadingIcon = { Icon(Icons.Default.Info, contentDescription = null) },
                onClick = {
                  menuOpen = false
                  onInspect()
                },
              )
              if (item.status != DownloadStatus.COMPLETED) {
                DropdownMenuItem(
                  text = { Text("Show popup") },
                  leadingIcon = { Icon(Icons.Default.PictureInPictureAlt, contentDescription = null, tint = palette.accent) },
                  onClick = {
                    menuOpen = false
                    onShowPopup()
                  },
                )
              }
              if (item.status == DownloadStatus.ERROR) {
                DropdownMenuItem(
                  text = { Text("Retry download") },
                  leadingIcon = { Icon(Icons.Default.Refresh, contentDescription = null) },
                  onClick = {
                    menuOpen = false
                    onRetry()
                  },
                )
              } else if (item.status != DownloadStatus.COMPLETED) {
                DropdownMenuItem(
                  text = { Text(if (item.isRunning) "Pause download" else "Resume download") },
                  leadingIcon = {
                    Icon(
                      if (item.isRunning) Icons.Default.Pause else Icons.Default.PlayArrow,
                      contentDescription = null,
                    )
                  },
                  onClick = {
                    menuOpen = false
                    if (item.isRunning) onPause() else onResume()
                  },
                )
              }
              DropdownMenuItem(
                text = { Text("Copy source link") },
                leadingIcon = { Icon(Icons.Default.ContentCopy, contentDescription = null) },
                onClick = {
                  menuOpen = false
                  onCopySource()
                },
              )
              if (item.status != DownloadStatus.COMPLETED) {
                DropdownMenuItem(
                  text = {
                    Text(
                      if (item.schedule != null) "Edit schedule..." else "Schedule download..."
                    )
                  },
                  leadingIcon = { Icon(Icons.Default.Schedule, contentDescription = null) },
                  onClick = {
                    menuOpen = false
                    onSchedule()
                  },
                )
              }
              HorizontalDivider()
              DropdownMenuItem(
                text = {
                  Text(
                    if (isBulk) {
                      if (allSelected) "Remove all (${bulkIds.size})"
                      else "Remove selected (${bulkIds.size})"
                    } else {
                      "Remove from list"
                    }
                  )
                },
                leadingIcon = { Icon(Icons.Default.Delete, contentDescription = null) },
                onClick = {
                  menuOpen = false
                  onRequestRemove(bulkIds, false)
                },
              )
              DropdownMenuItem(
                text = {
                  Text(
                    if (isBulk) {
                      if (allSelected) "Delete all & files (${bulkIds.size})"
                      else "Remove & delete files (${bulkIds.size})"
                    } else {
                      "Remove & delete files"
                    },
                    color = palette.danger,
                  )
                },
                leadingIcon = { Icon(Icons.Default.Delete, contentDescription = null, tint = palette.danger) },
                onClick = {
                  menuOpen = false
                  onRequestRemove(bulkIds, true)
                },
              )
            }
          }
        }
      }

      if (item.status != DownloadStatus.COMPLETED) {
        LinearProgressIndicator(
          progress = { item.progressFraction },
          modifier = Modifier
            .fillMaxWidth()
            .height(6.dp)
            .clip(RoundedCornerShape(3.dp)),
          color = when (item.status) {
            DownloadStatus.ERROR -> palette.danger
            DownloadStatus.PAUSED -> palette.warning
            else -> palette.accent
          },
          trackColor = palette.bgElevated,
        )
      }

      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
      ) {
        Text(
          "${FormatUtils.formatBytes(item.downloadedBytes)} / ${FormatUtils.formatBytes(item.totalBytes)}",
          fontSize = 11.5.sp,
          color = palette.textSecondary,
        )
        Text(
          text = when (item.status) {
            DownloadStatus.DOWNLOADING ->
              "${item.progressPercent}% · ↓ ${FormatUtils.formatSpeed(item.downloadSpeed)} · ETA ${FormatUtils.formatEta(item.etaSeconds)}"
            DownloadStatus.COMPLETED -> "Completed · ${FormatUtils.formatDateShort(item.completedAt ?: item.addedAt)}"
            else -> "${item.status.label} · ${item.progressPercent}%"
          },
          fontSize = 11.5.sp,
          fontFamily = FontFamily.Monospace,
          color = when (item.status) {
            DownloadStatus.COMPLETED -> palette.success
            DownloadStatus.ERROR -> palette.danger
            DownloadStatus.PAUSED -> palette.warning
            else -> palette.accent
          },
        )
      }
    }
  }
}

@Composable
private fun StatusPill(
  text: String,
  active: Boolean,
  onClick: () -> Unit,
) {
  val palette = LocalMyLoadPalette.current
  Surface(
    color = if (active) palette.accentSoft else palette.bgElevated,
    shape = RoundedCornerShape(8.dp),
    border = BorderStroke(1.dp, if (active) palette.accent else palette.borderSubtle),
    modifier = Modifier.clickable(onClick = onClick),
  ) {
    Text(
      text = text,
      fontSize = 11.sp,
      fontWeight = FontWeight.Medium,
      color = if (active) palette.accent else palette.textSecondary,
      modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
    )
  }
}
