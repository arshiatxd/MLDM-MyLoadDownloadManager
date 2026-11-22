import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ExternalLink,
  FolderOpen,
  LayoutGrid,
  Loader2,
  Minus,
  Pause,
  Play,
  RotateCw,
  X,
} from 'lucide-react';
import { classifyFileName, getItemProgress } from '../../shared/categories';
import {
  FILE_CATEGORY_META,
  createDefaultSettings,
  deriveNameFromSource,
  formatBytes,
  formatEta,
  formatSocialRequestSummary,
  formatSpeed,
  hasUnsafeFileNameWarning,
  isHttpUrl,
  isMagnetUri,
  isTorrentFilePath,
  resolveSaveDirForCategory,
} from '../../shared/constants';
import { t } from '../../shared/i18n';
import type {
  AppSettings,
  DirectoryValidationResult,
  DownloadItem,
  DownloadKind,
  FileCategory,
  MultiPartScanResult,
  PopupSessionData,
  ProbeResult,
  QueueMode,
  SocialDownloadRequest,
} from '../../shared/types';
import { applyDocumentAppearance } from '../utils/theme';
import { DirectoryStatusBanner } from './DirectoryStatusBanner';
import { MultiPartPromptCard } from './MultiPartPromptCard';
import { MyLoadLogo } from './MyLoadLogo';

interface CompactDownloadFrameProps {
  sessionId: string;
}

export function CompactDownloadFrame({ sessionId }: CompactDownloadFrameProps) {
  const [settings, setSettings] = useState<AppSettings>(() => createDefaultSettings(''));
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [session, setSession] = useState<PopupSessionData | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [mode, setMode] = useState<'confirm' | 'progress'>('confirm');
  const [trackedIds, setTrackedIds] = useState<string[]>([]);
  const [autoCloseDone, setAutoCloseDone] = useState(false);

  const [source, setSource] = useState('');
  const [saveDir, setSaveDir] = useState('');
  const [fileName, setFileName] = useState('');
  const [requestHeaders, setRequestHeaders] = useState<Record<string, string> | undefined>(
    undefined
  );
  const [suggestedSize, setSuggestedSize] = useState<number | null>(null);
  const [alwaysUseDir, setAlwaysUseDir] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [selectedFileIndices, setSelectedFileIndices] = useState<number[]>([]);
  const [dirValidation, setDirValidation] = useState<DirectoryValidationResult | null>(null);
  const [checkingDir, setCheckingDir] = useState(false);

  const [scanningParts, setScanningParts] = useState(false);
  const [scanResult, setScanResult] = useState<MultiPartScanResult | null>(null);
  const [selectedPartUrls, setSelectedPartUrls] = useState<string[]>([]);
  const [downloadAllParts, setDownloadAllParts] = useState(true);
  const [batchQueueMode, setBatchQueueMode] = useState<QueueMode>('parallel');
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const [socialRequest, setSocialRequest] = useState<SocialDownloadRequest | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saveDirTouched, setSaveDirTouched] = useState(false);

  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return applyDocumentAppearance(settings);
  }, [settings]);

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      window.myload.getInitialState(),
      window.myload.getPopupSession(sessionId),
    ]).then(([snap, ses]) => {
      if (!mounted) return;
      setSettings(snap.settings);
      setDownloads(snap.downloads);
      setBatchQueueMode(snap.settings.queueMode);

      if (!ses) {
        setLoadingSession(false);
        return;
      }

      setSession(ses);
      setMode(ses.mode);

      if (ses.mode === 'progress') {
        const ids =
          ses.downloadIds && ses.downloadIds.length > 0
            ? ses.downloadIds
            : ses.downloadId
              ? [ses.downloadId]
              : [];
        setTrackedIds(ids);
        void window.myload.resizeCurrentWindow(520, 320);
      } else if (ses.initialPayload) {
        const p = ses.initialPayload;
        const headers: Record<string, string> = {};
        if (p.cookie) headers.Cookie = p.cookie;
        if (p.referrer) headers.Referer = p.referrer;
        if (p.userAgent) headers['User-Agent'] = p.userAgent;

        setSource(p.url);
        setSaveDir(snap.settings.defaultDownloadDir);
        setSaveDirTouched(false);
        setFileName(p.fileName?.trim() ?? '');
        setRequestHeaders(Object.keys(headers).length > 0 ? headers : undefined);
        setSuggestedSize(p.fileSize ?? null);
        setAlwaysUseDir(snap.settings.alwaysUseDefaultDir);
      } else if (ses.socialRequest) {
        const sr = ses.socialRequest;
        setSocialRequest(sr);
        setSource(sr.url);
        setSaveDir(snap.settings.defaultDownloadDir);
        setSaveDirTouched(false);
        setFileName(sr.fileName?.trim() || sr.title);
        setRequestHeaders(undefined);
        setSuggestedSize(null);
        setAlwaysUseDir(snap.settings.alwaysUseDefaultDir);
      }

      setLoadingSession(false);
    });

    const unsubs = [
      window.myload.onDownloadsUpdated((items) => setDownloads(items)),
      window.myload.onSettingsUpdated((nextSettings) => setSettings(nextSettings)),
    ];

    return () => {
      mounted = false;
      for (const unsub of unsubs) unsub();
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, [sessionId]);

  useEffect(() => {
    if (mode !== 'confirm' || !source.trim() || socialRequest) return;
    let canceled = false;
    setProbing(true);
    void window.myload
      .probeSource(source.trim(), requestHeaders)
      .then((res) => {
        if (canceled) return;
        setProbe(res);
        setFileName((cur) => {
          if (cur.trim() && res.fileName === 'download') return cur;
          return cur.trim() && session?.initialPayload?.fileName ? cur : res.fileName;
        });
        if (res.files && res.files.length > 0) {
          setSelectedFileIndices(res.files.map((f) => f.index));
        } else {
          setSelectedFileIndices([]);
        }
      })
      .catch(() => {
        if (!canceled) setProbe(null);
      })
      .finally(() => {
        if (!canceled) setProbing(false);
      });

    const shouldScanMultiPart =
      isHttpUrl(source.trim()) &&
      settings.detectMultiPartEnabled &&
      (!settings.multiPartDontAskAgain || settings.multiPartDefaultAction === 'all');

    if (shouldScanMultiPart) {
      setScanningParts(true);
      void window.myload
        .scanMultiParts(
          source.trim(),
          requestHeaders,
          session?.initialPayload?.relatedParts
        )
        .then((scan) => {
          if (canceled) return;
          if (scan.matched && scan.parts.length > 1) {
            setScanResult(scan);
            setSelectedPartUrls(scan.parts.map((p) => p.url));
            setDownloadAllParts(true);
          } else {
            setScanResult(null);
            setSelectedPartUrls([]);
          }
        })
        .catch(() => {
          if (!canceled) {
            setScanResult(null);
            setSelectedPartUrls([]);
          }
        })
        .finally(() => {
          if (!canceled) setScanningParts(false);
        });
    }

    return () => {
      canceled = true;
    };
  }, [
    mode,
    source,
    socialRequest,
    requestHeaders,
    session?.initialPayload?.fileName,
    session?.initialPayload?.relatedParts,
    settings.detectMultiPartEnabled,
    settings.multiPartDontAskAgain,
    settings.multiPartDefaultAction,
  ]);

  const multiPartActive = Boolean(scanResult?.matched && (scanResult.parts.length ?? 0) > 1);
  const torrentFiles = probe?.files ?? [];
  const isMultiSlideSocial = Boolean(
    socialRequest &&
      (socialRequest.platform === 'instagram' || socialRequest.platform === 'tiktok') &&
      socialRequest.items.length > 1
  );

  const detectedKind: DownloadKind =
    probe?.kind ??
    (isMagnetUri(source.trim()) ||
    isTorrentFilePath(source.trim()) ||
    source.trim().startsWith('file://')
      ? 'torrent'
      : 'http');
  const detectedName =
    fileName.trim() || probe?.fileName || deriveNameFromSource(source, detectedKind);
  const detectedCategory: FileCategory = classifyFileName(detectedName, detectedKind);
  const hasCustomCategoryDir = Boolean(
    settings.folderRoutingMode === 'per-category' &&
      settings.categoryDownloadDirs?.[detectedCategory]?.trim()
  );

  useEffect(() => {
    if (mode !== 'confirm' || saveDirTouched) return;
    setSaveDir(resolveSaveDirForCategory(settings, detectedCategory));
  }, [
    mode,
    saveDirTouched,
    detectedCategory,
    settings.defaultDownloadDir,
    settings.folderRoutingMode,
    settings.categoryDownloadDirs,
  ]);

  const selectedParts = multiPartActive
    ? scanResult!.parts.filter((p) => selectedPartUrls.includes(p.url))
    : [];

  const totalDisplayBytes =
    torrentFiles.length > 0
      ? torrentFiles
          .filter((f) => selectedFileIndices.includes(f.index))
          .reduce((sum, f) => sum + f.length, 0)
      : multiPartActive && downloadAllParts
        ? selectedParts.reduce((sum, p) => sum + (p.totalBytes ?? 0), 0) ||
          probe?.totalBytes ||
          suggestedSize ||
          null
        : probe?.totalBytes ?? suggestedSize ?? null;

  useEffect(() => {
    if (mode !== 'confirm') return;
    let canceled = false;
    setCheckingDir(true);
    const timer = setTimeout(() => {
      void window.myload
        .validateDirectory(saveDir, totalDisplayBytes)
        .then((res) => {
          if (!canceled) setDirValidation(res);
        })
        .catch(() => {
          if (!canceled) setDirValidation(null);
        })
        .finally(() => {
          if (!canceled) setCheckingDir(false);
        });
    }, 180);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [mode, saveDir, totalDisplayBytes]);

  useEffect(() => {
    if (mode !== 'confirm') return;
    const hasTallSection =
      multiPartActive || torrentFiles.length > 0 || Boolean(dirValidation && (!dirValidation.valid || dirValidation.warning));
    void window.myload.resizeCurrentWindow(560, hasTallSection ? 620 : 440);
  }, [mode, multiPartActive, torrentFiles.length, dirValidation]);

  const trackedItems = useMemo(
    () =>
      trackedIds
        .map((id) => downloads.find((d) => d.id === id))
        .filter((item): item is DownloadItem => Boolean(item)),
    [downloads, trackedIds]
  );

  const primaryItem =
    trackedItems.find((d) => d.status === 'downloading' || d.status === 'probing') ??
    trackedItems.find((d) => d.status === 'paused' || d.status === 'queued') ??
    trackedItems[0] ??
    null;

  const allCompleted =
    trackedItems.length > 0 &&
    trackedItems.every((d) => d.status === 'completed' || d.status === 'seeding');

  useEffect(() => {
    if (mode !== 'progress' || !autoCloseDone || !allCompleted) return;
    closeTimerRef.current = setTimeout(() => {
      void window.myload.closeWindow();
    }, 1500);
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, [mode, autoCloseDone, allCompleted]);

  const fileNameWarning = hasUnsafeFileNameWarning(fileName);
  const hasDirError = Boolean(dirValidation && !dirValidation.valid);
  const hasHardPathError = Boolean(
    dirValidation && !dirValidation.valid && dirValidation.errorCode !== 'DISK_FULL'
  );
  const baseConfirm =
    source.trim().length > 0 &&
    saveDir.trim().length > 0 &&
    !submitting &&
    (multiPartActive && downloadAllParts
      ? selectedParts.length > 0
      : torrentFiles.length === 0 || selectedFileIndices.length > 0);
  const canConfirm = baseConfirm && !hasDirError;
  const canPauseConfirm = baseConfirm && !hasHardPathError;

  const handleBrowseFolder = async () => {
    const picked = await window.myload.selectFolder(saveDir);
    if (picked) {
      setSaveDir(picked);
      setSaveDirTouched(true);
    }
  };

  const handleConfirmDownload = async (startPaused: boolean) => {
    if (startPaused ? !canPauseConfirm : !canConfirm) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      if (multiPartActive && !settings.multiPartDontAskAgain && dontAskAgain) {
        await window.myload.updateSettings({
          multiPartDontAskAgain: true,
          multiPartDefaultAction: downloadAllParts ? 'all' : 'single',
        });
      }

      if (socialRequest) {
        const created = await window.myload.addSocialDownload({
          ...socialRequest,
          saveDir: saveDir.trim(),
          fileName: isMultiSlideSocial ? undefined : fileName.trim() || undefined,
          startPaused,
          alwaysUseThisFolder: alwaysUseDir,
        });
        if (startPaused) {
          await window.myload.closeWindow();
          return;
        }
        setTrackedIds(created.map((d) => d.id));
        setMode('progress');
        await window.myload.resizeCurrentWindow(520, 320);
        return;
      }

      if (multiPartActive && downloadAllParts && selectedParts.length > 1) {
        const created = await window.myload.addBatchDownloads(
          selectedParts.map((part) => ({
            source: part.url,
            saveDir: saveDir.trim(),
            fileName: part.fileName,
            startPaused,
            alwaysUseThisFolder: alwaysUseDir,
            requestHeaders,
          })),
          batchQueueMode
        );
        if (startPaused) {
          await window.myload.closeWindow();
          return;
        }
        setTrackedIds(created.map((d) => d.id));
        setMode('progress');
        await window.myload.resizeCurrentWindow(520, 320);
        return;
      }

      const item = await window.myload.addDownload({
        source: source.trim(),
        kind: probe?.kind,
        saveDir: saveDir.trim(),
        fileName: fileName.trim() || undefined,
        startPaused,
        alwaysUseThisFolder: alwaysUseDir,
        selectedFileIndices: torrentFiles.length > 0 ? selectedFileIndices : undefined,
        requestHeaders,
      });

      if (startPaused) {
        await window.myload.closeWindow();
        return;
      }

      setTrackedIds([item.id]);
      setMode('progress');
      await window.myload.resizeCurrentWindow(520, 320);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to start download');
    } finally {
      setSubmitting(false);
    }
  };

  const batchSummary = useMemo(() => {
    if (trackedItems.length === 0) {
      return { totalBytes: 0, downloadedBytes: 0, pct: 0, speed: 0, completed: 0 };
    }
    let totalBytes = 0;
    let downloadedBytes = 0;
    let speed = 0;
    let completed = 0;
    for (const item of trackedItems) {
      if (item.status === 'completed' || item.status === 'seeding') {
        completed += 1;
      }
      if (item.status === 'downloading') {
        speed += item.downloadSpeed;
      }
      if (item.totalBytes && item.totalBytes > 0) {
        totalBytes += item.totalBytes;
        downloadedBytes += Math.min(item.totalBytes, item.downloadedBytes);
      }
    }
    const pct =
      totalBytes > 0
        ? Math.round((downloadedBytes / totalBytes) * 100)
        : primaryItem
          ? Math.round(getItemProgress(primaryItem) * 100)
          : 0;
    return { totalBytes, downloadedBytes, pct, speed, completed };
  }, [trackedItems, primaryItem]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)]">
      <header className="app-drag flex h-10 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3">
        <div className="flex min-w-0 items-center gap-2">
          <MyLoadLogo className="h-6 w-6 shrink-0" />
          <span className="truncate text-[13px] font-semibold">
            {mode === 'confirm'
              ? t(settings.language, 'newDownload')
              : primaryItem?.name ?? 'MyLoad Download Manager'}
          </span>
        </div>

        <div className="app-no-drag flex items-center gap-1">
          <button
            type="button"
            onClick={() => void window.myload.openMainWindow()}
            title={t(settings.language, 'openMyLoad')}
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-[11.5px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{t(settings.language, 'openMyLoad')}</span>
          </button>
          <button
            type="button"
            onClick={() => void window.myload.minimizeWindow()}
            aria-label="Minimize window"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void window.myload.closeWindow()}
            aria-label="Close popup"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {loadingSession ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-[var(--text-secondary)]">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--accent-text)]" />
          <span>Loading...</span>
        </div>
      ) : mode === 'confirm' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleConfirmDownload(false);
          }}
          className="animate-modal-in flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 text-[13px]"
        >
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/70 px-3 py-2">
            <div className="truncate font-mono text-[11.5px] text-[var(--text-secondary)]" title={source}>
              {source}
            </div>
            {socialRequest && (
              <div className="mt-1 text-[11px] font-medium text-[var(--accent-text)]">
                {formatSocialRequestSummary(socialRequest)}
              </div>
            )}
            {probing && (
              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--accent-text)]">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Checking server metadata...</span>
              </div>
            )}
          </div>

          <MultiPartPromptCard
            lang={settings.language}
            scanning={scanningParts}
            scanResult={scanResult}
            selectedPartUrls={selectedPartUrls}
            onSelectedPartUrlsChange={setSelectedPartUrls}
            downloadAllParts={downloadAllParts}
            onDownloadAllPartsChange={setDownloadAllParts}
            queueMode={batchQueueMode}
            onQueueModeChange={setBatchQueueMode}
            dontAskAgain={dontAskAgain}
            onDontAskAgainChange={setDontAskAgain}
            autoModeNotice={
              settings.multiPartDontAskAgain && settings.multiPartDefaultAction === 'all'
            }
          />

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-[var(--text-secondary)]">
                {t(settings.language, 'saveTo')}
              </label>
              {hasCustomCategoryDir && !saveDirTouched && (
                <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--accent-text)]">
                  Auto-routed: {FILE_CATEGORY_META[detectedCategory].label}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={saveDir}
                onChange={(e) => {
                  setSaveDir(e.target.value);
                  setSaveDirTouched(true);
                }}
                className="ml-input h-8 flex-1 text-xs"
              />
              <button
                type="button"
                onClick={() => void handleBrowseFolder()}
                aria-label="Browse folder"
                className="inline-flex h-8 w-9 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
              >
                <FolderOpen className="h-4 w-4" />
              </button>
            </div>
            <label className="mt-1.5 inline-flex cursor-pointer items-center gap-2 text-xs text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={alwaysUseDir}
                onChange={(e) => setAlwaysUseDir(e.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--accent)]"
              />
              <span>
                {settings.folderRoutingMode === 'per-category'
                  ? `Always use this folder for ${FILE_CATEGORY_META[detectedCategory].label}`
                  : t(settings.language, 'alwaysFolder')}
              </span>
            </label>
            <DirectoryStatusBanner validation={dirValidation} checking={checkingDir} compact />
          </div>

          {!(multiPartActive && downloadAllParts) && !isMultiSlideSocial && (
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                {t(settings.language, 'fileName')}
              </label>
              <input
                type="text"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                className="ml-input h-8 text-xs"
              />
              {fileNameWarning && (
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--warning)]">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{fileNameWarning}</span>
                </div>
              )}
            </div>
          )}

          {torrentFiles.length > 0 && (
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/70 p-2.5 text-xs">
              <div className="mb-1.5 font-medium text-[var(--text-primary)]">
                Files ({selectedFileIndices.length}/{torrentFiles.length})
              </div>
              <div className="max-h-28 space-y-1 overflow-y-auto">
                {torrentFiles.map((file) => {
                  const checked = selectedFileIndices.includes(file.index);
                  return (
                    <label
                      key={file.index}
                      className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-1.5 py-1 hover:bg-[var(--bg-hover)]/50"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedFileIndices((prev) =>
                              prev.includes(file.index)
                                ? prev.filter((i) => i !== file.index)
                                : [...prev, file.index]
                            )
                          }
                          className="h-3.5 w-3.5 accent-[var(--accent)]"
                        />
                        <span className="truncate">{file.path}</span>
                      </span>
                      <span className="shrink-0 text-[11px] text-[var(--text-secondary)]">
                        {formatBytes(file.length)}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between text-[11.5px] text-[var(--text-secondary)]">
            <span>
              Size: <strong className="text-[var(--text-primary)]">{formatBytes(totalDisplayBytes)}</strong>
            </span>
            <span>
              Free disk:{' '}
              <strong
                className={
                  dirValidation?.errorCode === 'DISK_FULL'
                    ? 'text-[var(--danger)]'
                    : 'text-[var(--text-primary)]'
                }
              >
                {dirValidation?.diskSpace
                  ? formatBytes(dirValidation.diskSpace.freeBytes)
                  : 'Unknown'}
              </strong>
            </span>
          </div>

          {errorMsg && (
            <div className="flex items-center gap-1.5 text-xs text-[var(--danger)]">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="mt-auto flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] pt-2.5">
            <button
              type="button"
              onClick={() => void window.myload.closeWindow()}
              className="h-8 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
            >
              {t(settings.language, 'cancel')}
            </button>
            <button
              type="button"
              disabled={!canPauseConfirm}
              onClick={() => void handleConfirmDownload(true)}
              className="h-8 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-45 cursor-pointer"
            >
              {t(settings.language, 'addPaused')}
            </button>
            <button
              type="submit"
              disabled={!canConfirm}
              className="h-8 rounded-xl bg-[var(--accent)] px-4 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-45 cursor-pointer"
            >
              {submitting ? 'STARTING...' : t(settings.language, 'downloadBtn')}
            </button>
          </div>
        </form>
      ) : (
        <div className="animate-modal-in flex min-h-0 flex-1 flex-col justify-between px-4 py-3 text-[13px]">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
                  {primaryItem?.name ?? 'Starting download...'}
                </div>
                <div className="truncate text-[11.5px] text-[var(--text-secondary)]">
                  {trackedItems.length > 1
                    ? `${batchSummary.completed}/${trackedItems.length} parts completed`
                    : primaryItem?.saveDir ?? ''}
                </div>
              </div>
              <span
                className="shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase"
                style={{
                  backgroundColor: allCompleted ? 'var(--success-soft)' : 'var(--accent-soft)',
                  color: allCompleted ? 'var(--success)' : 'var(--accent-text)',
                }}
              >
                {primaryItem?.status ?? 'probing'}
              </span>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-[var(--text-secondary)]">
                <span>
                  {primaryItem
                    ? `${formatBytes(primaryItem.downloadedBytes)} / ${formatBytes(primaryItem.totalBytes)}`
                    : 'Connecting...'}
                </span>
                <span className="font-mono font-semibold text-[var(--text-primary)]">
                  {batchSummary.pct}%
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--bg-canvas)] border border-[var(--border-subtle)]">
                <div
                  className="h-full rounded-full transition-all duration-200"
                  style={{
                    width: `${Math.max(2, Math.min(100, batchSummary.pct))}%`,
                    backgroundColor: allCompleted ? 'var(--success)' : 'var(--accent)',
                  }}
                />
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
              <span className="font-mono">
                Speed:{' '}
                <strong className="text-[var(--text-primary)]">
                  {formatSpeed(batchSummary.speed)}
                </strong>
              </span>
              <span className="font-mono">
                ETA:{' '}
                <strong className="text-[var(--text-primary)]">
                  {primaryItem ? formatEta(primaryItem.etaSeconds) : '—'}
                </strong>
              </span>
            </div>

            {primaryItem && primaryItem.kind === 'http' && primaryItem.segments.length > 1 && (
              <div className="grid grid-cols-4 gap-1 sm:grid-cols-8">
                {primaryItem.segments.map((seg) => {
                  const total = Math.max(1, seg.end - seg.start + 1);
                  const segPct =
                    seg.status === 'done'
                      ? 100
                      : Math.min(100, Math.round((seg.downloaded / total) * 100));
                  return (
                    <div
                      key={seg.index}
                      title={`Part #${seg.index + 1}: ${segPct}%`}
                      className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-canvas)]"
                    >
                      <div
                        className="h-full bg-[var(--accent)] transition-all duration-200"
                        style={{ width: `${segPct}%` }}
                      />
                    </div>
                  );
                })}
              </div>
            )}

            {primaryItem?.errorMessage && (
              <div className="rounded-xl border border-[var(--danger)]/40 bg-[var(--danger-soft)] px-2.5 py-1.5 text-xs text-[var(--danger)]">
                {primaryItem.errorMessage}
              </div>
            )}
          </div>

          <div className="space-y-2.5 border-t border-[var(--border-subtle)] pt-2.5">
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={autoCloseDone}
                onChange={(e) => setAutoCloseDone(e.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--accent)]"
              />
              <span>{t(settings.language, 'autoCloseDone')}</span>
            </label>

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {allCompleted && primaryItem ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void window.myload.openFile(primaryItem.filePath)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3.5 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] cursor-pointer"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      <span>Open File</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void window.myload.showInFolder(primaryItem.filePath)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      <span>Open Folder</span>
                    </button>
                  </>
                ) : primaryItem?.status === 'error' ? (
                  <button
                    type="button"
                    onClick={() => void window.myload.retryDownload(primaryItem.id)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3.5 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] cursor-pointer"
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                    <span>Retry</span>
                  </button>
                ) : primaryItem &&
                  (primaryItem.status === 'paused' || primaryItem.status === 'queued') ? (
                  <button
                    type="button"
                    onClick={() => void window.myload.resumeDownload(primaryItem.id)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3.5 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] cursor-pointer"
                  >
                    <Play className="h-3.5 w-3.5" />
                    <span>{t(settings.language, 'resume')}</span>
                  </button>
                ) : primaryItem ? (
                  <button
                    type="button"
                    onClick={() => void window.myload.pauseDownload(primaryItem.id)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
                  >
                    <Pause className="h-3.5 w-3.5" />
                    <span>{t(settings.language, 'pause')}</span>
                  </button>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => void window.myload.closeWindow()}
                className="h-8 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
              >
                {allCompleted ? 'Close' : t(settings.language, 'hideBackground')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

