import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, DownloadCloud, X } from 'lucide-react';
import { matchesCategory, sortDownloads } from '../shared/categories';
import {
  DEFAULT_FILTER_TAB_ORDER,
  extractMultipleSources,
} from '../shared/constants';
import {
  computeArrowSelection,
  computeCheckboxSelection,
  computeRowClickSelection,
  moveItemByDelta,
  reorderByIndex,
  type RowClickModifiers,
} from '../shared/selection';
import type {
  AddDownloadRequest,
  AppSettings,
  CategoryId,
  CustomThemeColors,
  DownloadItem,
  DownloadPriority,
  DownloadSchedule,
  PowerAction,
  QueueMode,
  SocialDownloadRequest,
  SortBy,
} from '../shared/types';
import { AboutModal } from './components/AboutModal';
import { ActionToolbar } from './components/ActionToolbar';
import {
  AddDownloadModal,
  type AddDownloadInitialRequest,
} from './components/AddDownloadModal';
import { CopyrightModal } from './components/CopyrightModal';
import { DownloadTable } from './components/DownloadTable';
import { FilterTabsBar } from './components/FilterTabsBar';
import { InspectorPanel } from './components/InspectorPanel';
import { LogsDrawer } from './components/LogsDrawer';
import { PrivacyPolicyModal } from './components/PrivacyPolicyModal';
import { RemoveConfirmModal } from './components/RemoveConfirmModal';
import { ScheduleDownloadModal } from './components/ScheduleDownloadModal';
import { SettingsModal } from './components/SettingsModal';
import { ShutdownCountdownModal } from './components/ShutdownCountdownModal';
import { StatusBar } from './components/StatusBar';
import { TitleBar } from './components/TitleBar';
import { UpdateBanner } from './components/UpdateBanner';
import { useDownloadsState } from './hooks/useDownloads';
import { useCompletionSound } from './hooks/useSound';
import { applyDocumentAppearance } from './utils/theme';

export function App() {
  const playChime = useCompletionSound();

  const [activeCategory, setActiveCategory] = useState<CategoryId>('all');
  const [sortBy, setSortBy] = useState<SortBy>('newest');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const selectionAnchorIdRef = useRef<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addModalRequest, setAddModalRequest] = useState<
    AddDownloadInitialRequest | undefined
  >(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [copyrightOpen, setCopyrightOpen] = useState(false);
  const [previewCustomColors, setPreviewCustomColors] =
    useState<CustomThemeColors | null>(null);
  const [removeModal, setRemoveModal] = useState<{
    ids: string[];
    deleteFilesDefault: boolean;
  } | null>(null);
  const [scheduleModalItem, setScheduleModalItem] = useState<DownloadItem | null>(null);

  const [dragOverlayVisible, setDragOverlayVisible] = useState(false);
  const dragDepthRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [toast, setToast] = useState<string | null>(null);
  const [liveAnnouncement, setLiveAnnouncement] = useState('');
  const [dismissedAlertSig, setDismissedAlertSig] = useState<string | null>(null);
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<string | null>(null);
  const [updatePromptDismissed, setUpdatePromptDismissed] = useState(false);
  const [forceUpdatePrompt, setForceUpdatePrompt] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = useCallback((msg: string, showToast = true) => {
    setLiveAnnouncement(msg);
    if (showToast) {
      setToast(msg);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setToast(null), 2600);
    }
  }, []);

  const settingsRef = useRef<AppSettings | null>(null);

  const handleEnqueueSource = useCallback(
    async (source: string) => {
      const currentSettings = settingsRef.current;
      if (
        currentSettings &&
        (currentSettings.autoDownloadOnClick || !currentSettings.showConfirmationDialog)
      ) {
        try {
          await window.myload.addDownload({
            source,
            saveDir: '',
          });
          announce('Started download');
          return;
        } catch (err) {
          announce(err instanceof Error ? err.message : 'Unable to auto-start download');
        }
      }
      setAddModalRequest({ source });
      setAddModalOpen(true);
    },
    [announce]
  );

  const { appVersion, updateStatus, downloads, settings, stats, logs, countdown } = useDownloadsState({
    onDownloadCompleted: (item) => {
      if (settingsRef.current?.completionSound) {
        playChime();
      }
      announce(`Completed: ${item.name}`);
    },
    onBrowserIntercept: (payload) => {
      const headers: Record<string, string> = {};
      if (payload.cookie) headers.Cookie = payload.cookie;
      if (payload.referrer) headers.Referer = payload.referrer;
      if (payload.userAgent) headers['User-Agent'] = payload.userAgent;

      setAddModalRequest({
        source: payload.url,
        fileName: payload.fileName,
        fileSize: payload.fileSize ?? null,
        requestHeaders: Object.keys(headers).length > 0 ? headers : undefined,
        relatedParts: payload.relatedParts,
        socialRequest: payload.socialRequest,
      });
      setAddModalOpen(true);
    },
    onOpenAddModal: (source) => {
      setAddModalRequest(source ? { source } : undefined);
      setAddModalOpen(true);
    },
  });

  settingsRef.current = settings;

  useEffect(() => {
    return applyDocumentAppearance(settings, previewCustomColors);
  }, [settings, previewCustomColors]);

  useEffect(() => {
    const existing = new Set(downloads.map((d) => d.id));
    setSelectedIds((prev) => {
      const filtered = new Set([...prev].filter((id) => existing.has(id)));
      return filtered.size === prev.size ? prev : filtered;
    });
    setFocusedId((prev) => (prev && existing.has(prev) ? prev : null));
    if (selectionAnchorIdRef.current && !existing.has(selectionAnchorIdRef.current)) {
      selectionAnchorIdRef.current = null;
    }
  }, [downloads]);

  const counts = useMemo(() => {
    const map = {} as Record<CategoryId, number>;
    for (const cat of DEFAULT_FILTER_TAB_ORDER) {
      map[cat] = downloads.filter((d) => matchesCategory(d, cat)).length;
    }
    return map;
  }, [downloads]);

  const visibleDownloads = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = downloads.filter((item) => {
      if (!matchesCategory(item, activeCategory)) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.source.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    });
    return sortDownloads(filtered, sortBy);
  }, [downloads, activeCategory, searchQuery, sortBy]);

  const focusedItem: DownloadItem | null = useMemo(() => {
    if (!focusedId) return null;
    return downloads.find((d) => d.id === focusedId) ?? null;
  }, [downloads, focusedId]);

  const handleRowSelect = useCallback(
    (id: string, modifiers: RowClickModifiers) => {
      const orderedIds = visibleDownloads.map((d) => d.id);
      const next = computeRowClickSelection(
        orderedIds,
        id,
        {
          selectedIds,
          focusedId,
          anchorId: selectionAnchorIdRef.current,
        },
        modifiers
      );
      selectionAnchorIdRef.current = next.anchorId;
      setSelectedIds(next.selectedIds);
      setFocusedId(next.focusedId);
    },
    [visibleDownloads, selectedIds, focusedId]
  );

  const handleToggleSelect = useCallback(
    (id: string, shiftKey = false) => {
      const orderedIds = visibleDownloads.map((d) => d.id);
      const next = computeCheckboxSelection(
        orderedIds,
        id,
        {
          selectedIds,
          focusedId,
          anchorId: selectionAnchorIdRef.current,
        },
        shiftKey
      );
      selectionAnchorIdRef.current = next.anchorId;
      setSelectedIds(next.selectedIds);
      setFocusedId(next.focusedId);
    },
    [visibleDownloads, selectedIds, focusedId]
  );

  useEffect(() => {
    const present = new Set(downloads.map((d) => d.id));
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (present.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [downloads]);

  const allVisibleSelected =
    visibleDownloads.length > 0 && visibleDownloads.every((d) => selectedIds.has(d.id));

  const selectedItems = useMemo(() => {
    if (selectedIds.size > 0) {
      return downloads.filter((d) => selectedIds.has(d.id));
    }
    return focusedItem ? [focusedItem] : [];
  }, [downloads, selectedIds, focusedItem]);

  const canResumeSelected = selectedItems.some(
    (d) => d.status === 'paused' || d.status === 'error'
  );
  const canPauseSelected = selectedItems.some(
    (d) =>
      d.status === 'downloading' ||
      d.status === 'probing' ||
      d.status === 'queued' ||
      d.status === 'seeding'
  );
  const hasActiveOrQueued = downloads.some(
    (d) =>
      d.status === 'downloading' ||
      d.status === 'probing' ||
      d.status === 'queued' ||
      d.status === 'seeding'
  );
  const errorLogCount = useMemo(
    () => logs.filter((l) => l.level === 'error').length,
    [logs]
  );

  const handleUpdateSettings = useCallback((patch: Partial<AppSettings>) => {
    void window.myload.updateSettings(patch);
  }, []);

  const enqueueBatchList = useCallback(
    async (sources: string[], successMessage: string) => {
      try {
        await window.myload.addBatchDownloads(
          sources.map((src) => ({
            source: src,
            saveDir:
              settings.folderRoutingMode === 'per-category'
                ? ''
                : settings.defaultDownloadDir,
          }))
        );
        announce(successMessage);
      } catch (err) {
        announce(err instanceof Error ? err.message : 'Unable to add batch downloads');
      }
    },
    [announce, settings.defaultDownloadDir, settings.folderRoutingMode]
  );

  const handlePasteFromClipboard = useCallback(async () => {
    const text = await window.myload.readClipboardText();
    const sources = extractMultipleSources(text || '');
    if (sources.length === 0) {
      announce('No valid URL, magnet link, or .torrent path found in clipboard');
      return;
    }
    if (sources.length === 1) {
      await handleEnqueueSource(sources[0]);
      return;
    }
    await enqueueBatchList(sources, `Added ${sources.length} downloads from clipboard`);
  }, [announce, enqueueBatchList, handleEnqueueSource]);

  const handleImportUrlsFile = useCallback(async () => {
    const sources = await window.myload.importUrlsFromFile();
    if (sources.length === 0) return;
    if (sources.length === 1) {
      await handleEnqueueSource(sources[0]);
      return;
    }
    await enqueueBatchList(sources, `Imported ${sources.length} downloads from file`);
  }, [enqueueBatchList, handleEnqueueSource]);

  const handleExportDownloads = useCallback(async () => {
    const ids = selectedIds.size > 0 ? [...selectedIds] : undefined;
    const savedPath = await window.myload.exportDownloads(ids);
    if (savedPath) {
      announce(`Exported links to ${savedPath}`);
    }
  }, [announce, selectedIds]);

  const handleExportLogs = useCallback(async () => {
    const savedPath = await window.myload.exportLogs();
    if (savedPath) {
      announce(`Exported logs to ${savedPath}`);
    }
  }, [announce]);

  const showUpdateBanner =
    updateStatus.state === 'downloading' ||
    updateStatus.state === 'downloaded' ||
    (updateStatus.state === 'available' &&
      !updatePromptDismissed &&
      updateStatus.latestVersion !== dismissedUpdateVersion &&
      (!settings.hideUpdatePrompt || forceUpdatePrompt));

  const handleCheckForUpdates = useCallback(async () => {
    setDismissedUpdateVersion(null);
    setUpdatePromptDismissed(false);
    const st = await window.myload.checkForUpdates();
    if (st.state === 'available' && st.latestVersion) {
      setForceUpdatePrompt(true);
      announce(`MyLoad v${st.latestVersion} is available on GitHub`);
    } else if (st.state === 'up-to-date') {
      setForceUpdatePrompt(false);
      announce(`MyLoad v${st.currentVersion} is up to date`);
    } else if (st.state === 'error') {
      setForceUpdatePrompt(false);
      announce(st.error || 'Unable to check for updates');
    }
  }, [announce]);

  useEffect(() => {
    const isTextInputFocused = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      if (el.isContentEditable) return true;
      const tag = el.tagName.toLowerCase();
      if (tag === 'textarea' || tag === 'select') return true;
      if (tag === 'input') {
        const inputType = ((el as HTMLInputElement).type || '').toLowerCase();
        return (
          inputType !== 'checkbox' &&
          inputType !== 'radio' &&
          inputType !== 'button' &&
          inputType !== 'submit' &&
          inputType !== 'reset'
        );
      }
      return false;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setAddModalRequest(undefined);
        setAddModalOpen(true);
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setLogsOpen((o) => !o);
        return;
      }
      if (e.ctrlKey && e.key === ',') {
        e.preventDefault();
        setSettingsOpen(true);
        return;
      }

      if (
        addModalOpen ||
        settingsOpen ||
        logsOpen ||
        aboutOpen ||
        privacyOpen ||
        copyrightOpen ||
        removeModal ||
        scheduleModalItem
      ) {
        return;
      }

      if (e.ctrlKey && e.key.toLowerCase() === 'v' && !isTextInputFocused()) {
        e.preventDefault();
        void handlePasteFromClipboard();
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'a' && !isTextInputFocused()) {
        e.preventDefault();
        const orderedIds = visibleDownloads.map((d) => d.id);
        selectionAnchorIdRef.current = orderedIds[0] ?? null;
        setSelectedIds(new Set(orderedIds));
        return;
      }
      if (
        (e.key === 'ArrowDown' || e.key === 'ArrowUp') &&
        !e.defaultPrevented &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !isTextInputFocused() &&
        document.activeElement?.getAttribute('role') !== 'separator' &&
        visibleDownloads.length > 0
      ) {
        e.preventDefault();
        const orderedIds = visibleDownloads.map((d) => d.id);
        const next = computeArrowSelection(
          orderedIds,
          e.key === 'ArrowDown' ? 'down' : 'up',
          {
            selectedIds,
            focusedId,
            anchorId: selectionAnchorIdRef.current,
          },
          e.shiftKey
        );
        selectionAnchorIdRef.current = next.anchorId;
        setSelectedIds(next.selectedIds);
        setFocusedId(next.focusedId);
        return;
      }
      if (e.key === 'Delete' && !isTextInputFocused() && selectedItems.length > 0) {
        e.preventDefault();
        setRemoveModal({
          ids: selectedItems.map((i) => i.id),
          deleteFilesDefault: false,
        });
        return;
      }
      if (e.key === ' ' && !isTextInputFocused() && document.activeElement?.tagName.toLowerCase() !== 'button') {
        if (focusedItem) {
          e.preventDefault();
          if (
            focusedItem.status === 'downloading' ||
            focusedItem.status === 'probing' ||
            focusedItem.status === 'queued' ||
            focusedItem.status === 'seeding'
          ) {
            void window.myload.pauseDownload(focusedItem.id);
          } else if (focusedItem.status === 'paused' || focusedItem.status === 'error') {
            void window.myload.resumeDownload(focusedItem.id);
          }
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    addModalOpen,
    settingsOpen,
    logsOpen,
    aboutOpen,
    privacyOpen,
    copyrightOpen,
    removeModal,
    scheduleModalItem,
    visibleDownloads,
    selectedIds,
    focusedId,
    selectedItems,
    focusedItem,
    handlePasteFromClipboard,
  ]);

  const isExternalDrop = (e: React.DragEvent) =>
    !e.dataTransfer.types.includes('application/x-myload-tab') &&
    !e.dataTransfer.types.includes('application/x-myload-multipart') &&
    !e.dataTransfer.types.includes('application/x-myload-row');

  const handleDragEnter = (e: React.DragEvent) => {
    if (!isExternalDrop(e)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDragOverlayVisible(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!isExternalDrop(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!isExternalDrop(e)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setDragOverlayVisible(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    if (!isExternalDrop(e)) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setDragOverlayVisible(false);

    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) {
      for (const file of files) {
        const filePath = window.myload.getPathForFile(file);
        if (filePath && /\.torrent$/i.test(filePath)) {
          await handleEnqueueSource(filePath);
        } else if (/\.txt$|\.urls$/i.test(file.name)) {
          const text = await file.text();
          const urls = extractMultipleSources(text);
          if (urls.length === 1) {
            await handleEnqueueSource(urls[0]);
          } else if (urls.length > 1) {
            await enqueueBatchList(urls, `Added ${urls.length} downloads from ${file.name}`);
          }
        }
      }
      return;
    }

    const droppedText =
      e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    const sources = extractMultipleSources(droppedText || '');
    if (sources.length === 1) {
      await handleEnqueueSource(sources[0]);
    } else if (sources.length > 1) {
      await enqueueBatchList(sources, `Added ${sources.length} dropped downloads`);
    }
  };

  const handleAddConfirm = async (req: AddDownloadRequest) => {
    const item = await window.myload.addDownload(req);
    setFocusedId(item.id);
    announce(`Added ${item.name}`);
  };

  const handleAddBatchConfirm = async (
    reqs: AddDownloadRequest[],
    queueModeOverride?: QueueMode
  ) => {
    const created = await window.myload.addBatchDownloads(reqs, queueModeOverride);
    if (created[0]) {
      setFocusedId(created[0].id);
    }
    announce(`Added ${created.length} downloads to queue`);
  };

  const handleAddSocialConfirm = async (req: SocialDownloadRequest) => {
    const created = await window.myload.addSocialDownload(req);
    if (created[0]) {
      setFocusedId(created[0].id);
    }
    announce(`Added ${created[0]?.name || req.title}`);
  };

  const handleResumeSelected = () => {
    for (const item of selectedItems) {
      if (item.status === 'paused' || item.status === 'error') {
        void window.myload.resumeDownload(item.id);
      }
    }
  };

  const handlePauseSelected = () => {
    for (const item of selectedItems) {
      if (
        item.status === 'downloading' ||
        item.status === 'probing' ||
        item.status === 'queued' ||
        item.status === 'seeding'
      ) {
        void window.myload.pauseDownload(item.id);
      }
    }
  };

  const handleSetPriority = useCallback(
    (id: string, priority: DownloadPriority) => {
      void window.myload.setDownloadPriority(id, priority);
      announce(`Priority set to ${priority}`);
    },
    [announce]
  );

  const commitReorderedVisible = useCallback(
    (reorderedVisible: DownloadItem[]) => {
      const visibleSet = new Set(reorderedVisible.map((d) => d.id));
      const restIds = downloads.filter((d) => !visibleSet.has(d.id)).map((d) => d.id);
      const nextIds = [...reorderedVisible.map((d) => d.id), ...restIds];
      setSortBy('queue');
      void window.myload.reorderDownloads(nextIds);
    },
    [downloads]
  );

  const handleReorderRows = useCallback(
    (fromIndex: number, toIndex: number) => {
      const nextVisible = reorderByIndex(visibleDownloads, fromIndex, toIndex);
      commitReorderedVisible(nextVisible);
    },
    [visibleDownloads, commitReorderedVisible]
  );

  const handleMoveRow = useCallback(
    (id: string, delta: -1 | 1) => {
      const idx = visibleDownloads.findIndex((d) => d.id === id);
      if (idx === -1) return;
      const nextVisible = moveItemByDelta(visibleDownloads, idx, delta);
      if (nextVisible === visibleDownloads) return;
      commitReorderedVisible(nextVisible);
    },
    [visibleDownloads, commitReorderedVisible]
  );

  return (
    <div
      className="relative flex h-screen w-screen flex-col overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)]"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => void handleDrop(e)}
    >
      <TitleBar stats={stats} />

      <ActionToolbar
        lang={settings.language}
        sortBy={sortBy}
        onSortChange={setSortBy}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchInputRef={searchInputRef}
        selectedCount={selectedItems.length}
        allSelected={allVisibleSelected}
        canResumeSelected={canResumeSelected}
        canPauseSelected={canPauseSelected}
        hasActiveOrQueued={hasActiveOrQueued}
        errorLogCount={errorLogCount}
        autoPowerAction={settings.autoPowerAction}
        updateAvailable={updateStatus.state === 'available'}
        onAddClick={() => {
          setAddModalRequest(undefined);
          setAddModalOpen(true);
        }}
        onResumeSelected={handleResumeSelected}
        onPauseSelected={handlePauseSelected}
        onPauseAll={() => void window.myload.pauseAll()}
        onRemoveSelected={() => {
          if (selectedItems.length > 0) {
            setRemoveModal({
              ids: selectedItems.map((i) => i.id),
              deleteFilesDefault: false,
            });
          }
        }}
        onOpenLogs={() => setLogsOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onPasteClipboard={() => void handlePasteFromClipboard()}
        onImportUrlsFile={() => void handleImportUrlsFile()}
        onExportDownloads={() => void handleExportDownloads()}
        onPowerActionChange={(action: PowerAction) => {
          handleUpdateSettings({ autoPowerAction: action });
          announce(
            action === 'off'
              ? 'Auto power action disabled'
              : `Armed auto action after finish: ${action}`
          );
        }}
        onResetFilterOrder={() => {
          handleUpdateSettings({ filterTabOrder: [...DEFAULT_FILTER_TAB_ORDER] });
          announce('Filter tab order reset to default');
        }}
        onCheckUpdates={() => void handleCheckForUpdates()}
        onOpenPrivacy={() => setPrivacyOpen(true)}
        onOpenAbout={() => setAboutOpen(true)}
        onQuitApp={() => void window.myload.quitApp()}
      />

      {showUpdateBanner && (
        <UpdateBanner
          status={updateStatus}
          onUpdateNow={() => void window.myload.downloadAndInstallUpdate()}
          onOpenRelease={() => void window.myload.openUpdateReleasePage()}
          onDismiss={(dontShowAgain) => {
            setUpdatePromptDismissed(true);
            setForceUpdatePrompt(false);
            setDismissedUpdateVersion(updateStatus.latestVersion ?? null);
            if (dontShowAgain) {
              handleUpdateSettings({ hideUpdatePrompt: true });
            }
          }}
        />
      )}

      <FilterTabsBar
        lang={settings.language}
        order={settings.filterTabOrder}
        activeCategory={activeCategory}
        counts={counts}
        onSelect={setActiveCategory}
        onReorder={(nextOrder, announcement) => {
          handleUpdateSettings({ filterTabOrder: nextOrder });
          announce(announcement, false);
        }}
      />

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">

        {(() => {
          const criticalItem = downloads.find(
            (d) =>
              (d.status === 'error' || d.status === 'paused') &&
              Boolean(d.errorMessage) &&
              /Storage full|Not enough storage space|Permission denied|missing or disconnected|Drive or location|Folder or drive not found|too long/i.test(
                d.errorMessage || ''
              )
          );
          if (!criticalItem) return null;
          const sig = `${criticalItem.id}:${criticalItem.errorMessage}`;
          if (sig === dismissedAlertSig) return null;
          return (
            <div
              role="alert"
              className="mx-3 mt-2 flex shrink-0 items-center justify-between gap-3 rounded-xl border border-[var(--danger)]/50 bg-[var(--danger-soft)] px-3.5 py-2 text-xs text-[var(--danger)]"
            >
              <div className="flex min-w-0 items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                  <span className="font-semibold">{criticalItem.name}: </span>
                  <span>{criticalItem.errorMessage}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setFocusedId(criticalItem.id);
                    setInspectorOpen(true);
                  }}
                  className="rounded-lg border border-[var(--danger)]/40 bg-[var(--bg-surface)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
                >
                  Inspect
                </button>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="rounded-lg bg-[var(--accent)] px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-[var(--accent-hover)] cursor-pointer"
                >
                  Open Settings
                </button>
                <button
                  type="button"
                  onClick={() => setDismissedAlertSig(sig)}
                  aria-label="Dismiss storage alert"
                  className="rounded-lg p-1 text-[var(--danger)] hover:bg-black/15 cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })()}

        <DownloadTable
          lang={settings.language}
          items={visibleDownloads}
          totalItemsCount={downloads.length}
          activeCategory={activeCategory}
          selectedIds={selectedIds}
          focusedId={focusedId}
          onToggleSelect={handleToggleSelect}
          onToggleSelectAll={() => {
            const allSelected =
              visibleDownloads.length > 0 &&
              visibleDownloads.every((d) => selectedIds.has(d.id));
            if (allSelected) {
              selectionAnchorIdRef.current = null;
              setSelectedIds(new Set());
            } else {
              const orderedIds = visibleDownloads.map((d) => d.id);
              selectionAnchorIdRef.current = orderedIds[0] ?? null;
              setSelectedIds(new Set(orderedIds));
            }
          }}
          onRowClick={handleRowSelect}
          onFocusItem={(id) => {
            setFocusedId(id);
            selectionAnchorIdRef.current = id;
          }}
          onInspectItem={(id) => {
            setFocusedId(id);
            setInspectorOpen(true);
          }}
          onShowPopup={(id) => void window.myload.openDownloadPopup(id)}
          onPause={(id) => void window.myload.pauseDownload(id)}
          onResume={(id) => void window.myload.resumeDownload(id)}
          onRetry={(id) => void window.myload.retryDownload(id)}
          onOpenFile={(item) => {
            void window.myload.openFile(item.filePath).then((err) => {
              if (err) announce(err);
            });
          }}
          onShowInFolder={(item) => void window.myload.showInFolder(item.filePath)}
          onRequestRemove={(ids, deleteFilesDefault = false) =>
            setRemoveModal({ ids, deleteFilesDefault })
          }
          onCopySource={(src) => {
            void navigator.clipboard.writeText(src);
            announce('Source link copied to clipboard');
          }}
          onOpenSchedule={(item) => setScheduleModalItem(item)}
          onSetPriority={handleSetPriority}
          onReorderRows={handleReorderRows}
          onMoveRow={handleMoveRow}
          onOpenAddModal={() => {
            setAddModalRequest(undefined);
            setAddModalOpen(true);
          }}
        />

        {inspectorOpen && focusedItem && (
          <InspectorPanel
            item={focusedItem}
            logs={logs}
            onClose={() => setInspectorOpen(false)}
            onUpdateTorrentFiles={(id, indices) =>
              void window.myload.updateTorrentFiles(id, indices)
            }
          />
        )}
      </main>

      <StatusBar
        stats={stats}
        settings={settings}
        hasFocusedItem={Boolean(focusedItem)}
        inspectorOpen={inspectorOpen && Boolean(focusedItem)}
        onToggleInspector={() => setInspectorOpen((o) => !o)}
        onOpenCopyright={() => setCopyrightOpen(true)}
        onUpdateSettings={handleUpdateSettings}
      />

      {dragOverlayVisible && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-black/60"
        >
          <div className="animate-modal-in flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-[var(--accent)] bg-[var(--bg-surface)] px-10 py-8 shadow-2xl">
            <DownloadCloud className="h-10 w-10 text-[var(--accent-text)]" />
            <div className="text-base font-semibold text-[var(--text-primary)]">
              Drop URL, magnet link, .torrent, or URL list
            </div>
          </div>
        </div>
      )}

      <AddDownloadModal
        open={addModalOpen}
        initialRequest={addModalRequest}
        settings={settings}
        onClose={() => {
          setAddModalOpen(false);
          setAddModalRequest(undefined);
        }}
        onConfirm={handleAddConfirm}
        onConfirmBatch={handleAddBatchConfirm}
        onConfirmSocial={handleAddSocialConfirm}
        onUpdateSettings={handleUpdateSettings}
      />

      <SettingsModal
        open={settingsOpen}
        appVersion={appVersion}
        updateStatus={updateStatus}
        settings={settings}
        onClose={() => {
          setPreviewCustomColors(null);
          setSettingsOpen(false);
        }}
        onUpdate={handleUpdateSettings}
        onReset={() => {
          setPreviewCustomColors(null);
          void window.myload.resetSettings();
          announce('Preferences reset to defaults');
        }}
        onPreviewCustomColors={setPreviewCustomColors}
        onOpenPrivacy={() => setPrivacyOpen(true)}
        onUpdateNow={() => {
          setSettingsOpen(false);
          void window.myload.downloadAndInstallUpdate();
        }}
      />

      <LogsDrawer
        open={logsOpen}
        logs={logs}
        onClose={() => setLogsOpen(false)}
        onClear={() => {
          void window.myload.clearLogs();
          announce('Logs cleared');
        }}
        onExport={() => void handleExportLogs()}
      />

      <RemoveConfirmModal
        open={Boolean(removeModal)}
        count={removeModal?.ids.length ?? 0}
        defaultDeleteFiles={removeModal?.deleteFilesDefault ?? false}
        onClose={() => setRemoveModal(null)}
        onConfirm={(deleteFiles) => {
          if (removeModal) {
            const removedSet = new Set(removeModal.ids);
            void window.myload.removeDownloads(removeModal.ids, deleteFiles);
            setSelectedIds((prev) => {
              const next = new Set(prev);
              for (const id of removedSet) next.delete(id);
              return next;
            });
            if (focusedId && removedSet.has(focusedId)) {
              setFocusedId(null);
            }
            setRemoveModal(null);
          }
        }}
      />

      <ScheduleDownloadModal
        item={scheduleModalItem}
        onClose={() => setScheduleModalItem(null)}
        onSave={async (id, schedule: DownloadSchedule | null) => {
          await window.myload.updateDownloadSchedule(id, schedule);
          announce(schedule ? 'Download schedule updated' : 'Download schedule cleared');
        }}
      />

      <ShutdownCountdownModal
        state={countdown}
        onCancel={() => void window.myload.cancelPowerCountdown()}
        onExecuteNow={() => void window.myload.executePowerNow()}
      />

      <AboutModal
        open={aboutOpen}
        appVersion={appVersion}
        updateStatus={updateStatus}
        onClose={() => setAboutOpen(false)}
        onOpenPrivacy={() => setPrivacyOpen(true)}
        onCheckUpdates={() => void handleCheckForUpdates()}
        onUpdateNow={() => void window.myload.downloadAndInstallUpdate()}
        onOpenRelease={() => void window.myload.openUpdateReleasePage()}
      />

      <PrivacyPolicyModal open={privacyOpen} onClose={() => setPrivacyOpen(false)} />

      <CopyrightModal
        open={copyrightOpen}
        appVersion={appVersion}
        onClose={() => setCopyrightOpen(false)}
      />

      {toast && (
        <div className="animate-menu-open pointer-events-none fixed bottom-12 right-4 z-50 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-3.5 py-2 text-[13px] font-medium text-[var(--text-primary)] shadow-xl">
          {toast}
        </div>
      )}

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </div>
    </div>
  );
}

