import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ClipboardPaste,
  FileUp,
  FolderOpen,
  Loader2,
  X,
} from 'lucide-react';
import {
  extractMultipleSources,
  formatBytes,
  hasUnsafeFileNameWarning,
  isHttpUrl,
  isMagnetUri,
  isTorrentFilePath,
} from '../../shared/constants';
import { t } from '../../shared/i18n';
import type {
  AddDownloadRequest,
  AppSettings,
  DirectoryValidationResult,
  MultiPartScanResult,
  ProbeResult,
  QueueMode,
} from '../../shared/types';
import { CustomSelect } from './CustomSelect';
import { DirectoryStatusBanner } from './DirectoryStatusBanner';
import { MultiPartPromptCard, buildQueueModeOptions } from './MultiPartPromptCard';

export interface AddDownloadInitialRequest {
  source?: string;
  fileName?: string;
  fileSize?: number | null;
  requestHeaders?: Record<string, string>;
  relatedParts?: Array<{ url: string; fileName?: string }>;
}

interface AddDownloadModalProps {
  open: boolean;
  initialRequest?: AddDownloadInitialRequest;
  settings: AppSettings;
  onClose: () => void;
  onConfirm: (req: AddDownloadRequest) => Promise<void>;
  onConfirmBatch: (reqs: AddDownloadRequest[], queueModeOverride?: QueueMode) => Promise<void>;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
}

export function AddDownloadModal({
  open,
  initialRequest,
  settings,
  onClose,
  onConfirm,
  onConfirmBatch,
  onUpdateSettings,
}: AddDownloadModalProps) {
  const [source, setSource] = useState('');
  const [saveDir, setSaveDir] = useState('');
  const [fileName, setFileName] = useState('');
  const [requestHeaders, setRequestHeaders] = useState<Record<string, string> | undefined>(
    undefined
  );
  const [suggestedSize, setSuggestedSize] = useState<number | null>(null);
  const [alwaysUseDir, setAlwaysUseDir] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [dirValidation, setDirValidation] = useState<DirectoryValidationResult | null>(null);
  const [checkingDir, setCheckingDir] = useState(false);
  const [selectedFileIndices, setSelectedFileIndices] = useState<number[]>([]);
  const [fileExistsOnDisk, setFileExistsOnDisk] = useState(false);
  const [duplicateChoice, setDuplicateChoice] = useState<'auto-rename' | 'overwrite'>(
    'auto-rename'
  );
  const [batchQueueMode, setBatchQueueMode] = useState<QueueMode>(settings.queueMode);
  const [scanningParts, setScanningParts] = useState(false);
  const [scanResult, setScanResult] = useState<MultiPartScanResult | null>(null);
  const [selectedPartUrls, setSelectedPartUrls] = useState<string[]>([]);
  const [downloadAllParts, setDownloadAllParts] = useState(true);
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [autoFilledFromClipboard, setAutoFilledFromClipboard] = useState(false);

  useEffect(() => {
    if (!open) return;
    const initialSource = initialRequest?.source?.trim() ?? '';
    setSource(initialSource);
    setSaveDir(settings.defaultDownloadDir);
    setFileName(initialRequest?.fileName?.trim() ?? '');
    setRequestHeaders(initialRequest?.requestHeaders);
    setSuggestedSize(initialRequest?.fileSize ?? null);
    setAlwaysUseDir(settings.alwaysUseDefaultDir);
    setProbe(null);
    setProbeError(null);
    setDirValidation(null);
    setCheckingDir(false);
    setSelectedFileIndices([]);
    setFileExistsOnDisk(false);
    setDuplicateChoice('auto-rename');
    setBatchQueueMode(settings.queueMode);
    setScanningParts(false);
    setScanResult(null);
    setSelectedPartUrls([]);
    setDownloadAllParts(true);
    setDontAskAgain(false);
    setSubmitting(false);
    setSubmitError(null);
    setAutoFilledFromClipboard(false);

    if (initialSource) return;

    let canceled = false;
    void window.myload
      .getLastCopiedDownloadableLink()
      .then((detected) => {
        if (canceled || !detected) return;
        setSource((cur) => {
          if (cur.trim()) return cur;
          setAutoFilledFromClipboard(true);
          return detected;
        });
      })
      .catch(() => {
      });

    return () => {
      canceled = true;
    };
  }, [
    open,
    initialRequest,
    settings.defaultDownloadDir,
    settings.alwaysUseDefaultDir,
    settings.queueMode,
  ]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const extractedSources = extractMultipleSources(source);
  const isBatchMode = extractedSources.length > 1;

  useEffect(() => {
    if (!open) return;
    if (isBatchMode) {
      setProbing(false);
      setProbe(null);
      setProbeError(null);
      setScanningParts(false);
      setScanResult(null);
      return;
    }

    const trimmed = extractedSources[0] ?? source.trim();
    if (!trimmed) {
      setProbe(null);
      setProbeError(null);
      setFileName('');
      setScanResult(null);
      setSelectedPartUrls([]);
      return;
    }

    const looksValid =
      isHttpUrl(trimmed) ||
      isMagnetUri(trimmed) ||
      isTorrentFilePath(trimmed) ||
      trimmed.startsWith('file://');

    if (!looksValid) {
      setProbe(null);
      setProbeError('Enter an http(s):// URL, magnet:? link, or .torrent file path.');
      setScanResult(null);
      return;
    }

    let canceled = false;
    const timer = setTimeout(() => {
      setProbing(true);
      setProbeError(null);
      void window.myload
        .probeSource(trimmed, requestHeaders)
        .then((res) => {
          if (canceled) return;
          setProbe(res);
          setFileName((cur) => {
            if (cur.trim() && res.fileName === 'download') return cur;
            return cur.trim() && initialRequest?.fileName ? cur : res.fileName;
          });
          if (res.files && res.files.length > 0) {
            setSelectedFileIndices(res.files.map((f) => f.index));
          } else {
            setSelectedFileIndices([]);
          }
        })
        .catch((err) => {
          if (canceled) return;
          setProbe(null);
          setProbeError(err instanceof Error ? err.message : 'Unable to probe source');
        })
        .finally(() => {
          if (!canceled) setProbing(false);
        });

      const shouldScanMultiPart =
        isHttpUrl(trimmed) &&
        settings.detectMultiPartEnabled &&
        (!settings.multiPartDontAskAgain || settings.multiPartDefaultAction === 'all');

      if (shouldScanMultiPart) {
        setScanningParts(true);
        void window.myload
          .scanMultiParts(trimmed, requestHeaders, initialRequest?.relatedParts)
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
      } else {
        setScanningParts(false);
        setScanResult(null);
        setSelectedPartUrls([]);
      }
    }, 320);

    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [
    open,
    source,
    isBatchMode,
    requestHeaders,
    initialRequest?.fileName,
    initialRequest?.relatedParts,
    settings.detectMultiPartEnabled,
    settings.multiPartDontAskAgain,
    settings.multiPartDefaultAction,
  ]);

  const multiPartActive = Boolean(scanResult?.matched && (scanResult.parts.length ?? 0) > 1);
  const selectedParts = multiPartActive
    ? scanResult!.parts.filter((p) => selectedPartUrls.includes(p.url))
    : [];

  const torrentFiles = probe?.files ?? [];
  const selectedTotalBytes =
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
    if (!open) return;
    let canceled = false;
    setCheckingDir(true);
    const timer = setTimeout(() => {
      void window.myload
        .validateDirectory(saveDir, selectedTotalBytes)
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
  }, [open, saveDir, selectedTotalBytes]);

  useEffect(() => {
    if (!open || settings.duplicatePolicy !== 'ask' || !saveDir.trim() || !fileName.trim()) {
      setFileExistsOnDisk(false);
      return;
    }
    let canceled = false;
    void window.myload
      .checkFileExists(saveDir.trim(), fileName.trim())
      .then((exists) => {
        if (!canceled) setFileExistsOnDisk(exists);
      });
    return () => {
      canceled = true;
    };
  }, [open, settings.duplicatePolicy, saveDir, fileName]);

  if (!open) return null;

  const trimmedSource = extractedSources[0] ?? source.trim();
  const isSourceValid =
    isBatchMode ||
    isHttpUrl(trimmedSource) ||
    isMagnetUri(trimmedSource) ||
    isTorrentFilePath(trimmedSource) ||
    trimmedSource.startsWith('file://');

  const fileNameWarning = hasUnsafeFileNameWarning(fileName);
  const hasDirError = Boolean(dirValidation && !dirValidation.valid);
  const hasHardPathError = Boolean(
    dirValidation && !dirValidation.valid && dirValidation.errorCode !== 'DISK_FULL'
  );
  const baseValid =
    isSourceValid &&
    saveDir.trim().length > 0 &&
    !submitting &&
    (isBatchMode
      ? true
      : multiPartActive && downloadAllParts
        ? selectedParts.length > 0
        : torrentFiles.length === 0 || selectedFileIndices.length > 0);
  const canSubmit = baseValid && !hasDirError;
  const canPauseSubmit = baseValid && !hasHardPathError;

  const handleBrowseFolder = async () => {
    const picked = await window.myload.selectFolder(saveDir);
    if (picked) setSaveDir(picked);
  };

  const handleBrowseTorrent = async () => {
    const picked = await window.myload.selectTorrentFile();
    if (picked) {
      setSource(picked);
      setAutoFilledFromClipboard(false);
    }
  };

  const handlePaste = async () => {
    const text = await window.myload.readClipboardText();
    if (text?.trim()) {
      setSource(text.trim());
      setAutoFilledFromClipboard(false);
    }
  };

  const handleSubmit = async (startPaused: boolean) => {
    if (startPaused ? !canPauseSubmit : !canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (isBatchMode) {
        await onConfirmBatch(
          extractedSources.map((src) => ({
            source: src,
            saveDir: saveDir.trim(),
            startPaused,
            alwaysUseThisFolder: alwaysUseDir,
          })),
          batchQueueMode
        );
        onClose();
        return;
      }

      if (multiPartActive && !settings.multiPartDontAskAgain && dontAskAgain) {
        onUpdateSettings({
          multiPartDontAskAgain: true,
          multiPartDefaultAction: downloadAllParts ? 'all' : 'single',
        });
      }

      if (multiPartActive && downloadAllParts && selectedParts.length > 1) {
        await onConfirmBatch(
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
        onClose();
        return;
      }

      await onConfirm({
        source: trimmedSource,
        kind: probe?.kind,
        saveDir: saveDir.trim(),
        fileName: fileName.trim() || undefined,
        startPaused,
        alwaysUseThisFolder: alwaysUseDir,
        selectedFileIndices: torrentFiles.length > 0 ? selectedFileIndices : undefined,
        duplicateOverride:
          settings.duplicatePolicy === 'ask' && fileExistsOnDisk
            ? duplicateChoice
            : undefined,
        requestHeaders,
      });
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unable to start download');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-download-title"
    >
      <div className="animate-modal-in flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-3.5">
          <h2 id="add-download-title" className="text-base font-semibold text-[var(--text-primary)]">
            {t(settings.language, 'newDownload')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close new download dialog"
            className="rounded-lg p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit(false);
          }}
          className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-4 text-[13px]"
        >
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label
                htmlFor="download-source-input"
                className="font-medium text-[var(--text-secondary)]"
              >
                URLs (one per line), magnet link, or .torrent file
              </label>
              {autoFilledFromClipboard && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent-text)]">
                  <span>Auto-filled from last copied link</span>
                  <button
                    type="button"
                    onClick={() => {
                      setSource('');
                      setAutoFilledFromClipboard(false);
                    }}
                    className="underline hover:opacity-80 cursor-pointer"
                  >
                    Clear
                  </button>
                </span>
              )}
            </div>
            <div className="flex items-start gap-1.5">
              <textarea
                id="download-source-input"
                rows={2}
                autoFocus
                value={source}
                onChange={(e) => {
                  setSource(e.target.value);
                  setAutoFilledFromClipboard(false);
                }}
                placeholder="https://example.com/file.zip (paste multiple lines for batch queue) or magnet:?xt=..."
                className="ml-input flex-1 resize-y text-[13px]"
              />
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => void handlePaste()}
                  title="Paste from clipboard"
                  className="inline-flex h-8 items-center justify-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
                >
                  <ClipboardPaste className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Paste</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleBrowseTorrent()}
                  title="Choose local .torrent file"
                  className="inline-flex h-8 items-center justify-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
                >
                  <FileUp className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>.torrent</span>
                </button>
              </div>
            </div>

            {isBatchMode && (
              <div className="mt-2 space-y-2 rounded-xl border border-[var(--accent)]/45 bg-[var(--accent-soft)]/30 p-2.5 text-xs">
                <div className="font-semibold text-[var(--text-primary)]">
                  Detected {extractedSources.length} URLs — will queue as a batch
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[var(--text-secondary)]">Queue mode</span>
                  <CustomSelect
                    size="sm"
                    value={batchQueueMode}
                    options={buildQueueModeOptions(settings.language)}
                    onChange={setBatchQueueMode}
                    ariaLabel="Batch download queue mode"
                    className="w-48"
                    buttonClassName="bg-[var(--bg-surface)]"
                  />
                </div>
              </div>
            )}

            {probing && (
              <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent-text)]" />
                <span>Checking file metadata...</span>
              </div>
            )}

            {probeError && (
              <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--warning)]">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>{probeError}</span>
              </div>
            )}

            {probe?.warning && !probeError && (
              <div className="mt-1.5 text-[11px] text-[var(--text-secondary)]">
                {probe.warning}
              </div>
            )}
          </div>

          {!isBatchMode && (
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
          )}

          <div>
            <label
              htmlFor="save-to-input"
              className="mb-1.5 block font-medium text-[var(--text-secondary)]"
            >
              {t(settings.language, 'saveTo')}
            </label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  id="save-to-input"
                  type="text"
                  list="recent-download-dirs"
                  value={saveDir}
                  onChange={(e) => setSaveDir(e.target.value)}
                  className="ml-input h-9 border-[var(--accent)]/60 text-xs"
                />
                <datalist id="recent-download-dirs">
                  {settings.recentDirs.map((dir) => (
                    <option key={dir} value={dir} />
                  ))}
                </datalist>
              </div>
              <button
                type="button"
                onClick={() => void handleBrowseFolder()}
                title="Browse folder"
                aria-label="Browse download folder"
                className="inline-flex h-9 w-10 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
              >
                <FolderOpen className="h-4 w-4" />
              </button>
            </div>

            <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-xs text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={alwaysUseDir}
                onChange={(e) => setAlwaysUseDir(e.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--accent)]"
              />
              <span>{t(settings.language, 'alwaysFolder')}</span>
            </label>

            <DirectoryStatusBanner validation={dirValidation} checking={checkingDir} />
          </div>

          {!isBatchMode && !(multiPartActive && downloadAllParts) && (
            <div>
              <label
                htmlFor="download-filename-input"
                className="mb-1.5 block font-medium text-[var(--text-secondary)]"
              >
                {t(settings.language, 'fileName')}
              </label>
              <input
                id="download-filename-input"
                type="text"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                placeholder="Auto-detected from URL or torrent"
                className="ml-input h-9 text-xs"
              />
              {fileNameWarning && (
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--warning)]">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{fileNameWarning}</span>
                </div>
              )}
            </div>
          )}

          {fileExistsOnDisk && settings.duplicatePolicy === 'ask' && (
            <div className="rounded-lg border border-[var(--warning)]/50 bg-[var(--warning-soft)] p-2.5 text-xs">
              <div className="mb-1.5 font-medium text-[var(--warning)]">
                A file with this name already exists in the destination folder:
              </div>
              <div className="flex items-center gap-4 text-[var(--text-primary)]">
                <label className="inline-flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    name="duplicateChoice"
                    checked={duplicateChoice === 'auto-rename'}
                    onChange={() => setDuplicateChoice('auto-rename')}
                    className="accent-[var(--accent)]"
                  />
                  <span>Auto-rename</span>
                </label>
                <label className="inline-flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    name="duplicateChoice"
                    checked={duplicateChoice === 'overwrite'}
                    onChange={() => setDuplicateChoice('overwrite')}
                    className="accent-[var(--accent)]"
                  />
                  <span>Overwrite existing</span>
                </label>
              </div>
            </div>
          )}

          {torrentFiles.length > 0 && (
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/70 p-2.5">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-medium text-[var(--text-primary)]">
                  Files in torrent ({selectedFileIndices.length}/{torrentFiles.length} selected)
                </span>
                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setSelectedFileIndices(torrentFiles.map((f) => f.index))}
                    className="text-[var(--accent-text)] hover:underline"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedFileIndices([])}
                    className="text-[var(--text-secondary)] hover:underline"
                  >
                    None
                  </button>
                </div>
              </div>
              <div className="max-h-36 space-y-1 overflow-y-auto pr-1">
                {torrentFiles.map((file) => {
                  const checked = selectedFileIndices.includes(file.index);
                  return (
                    <label
                      key={file.index}
                      className="flex cursor-pointer items-center justify-between gap-2 rounded px-1.5 py-1 hover:bg-[var(--bg-hover)]/50"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setSelectedFileIndices((prev) =>
                              prev.includes(file.index)
                                ? prev.filter((i) => i !== file.index)
                                : [...prev, file.index]
                            );
                          }}
                          className="h-3.5 w-3.5 accent-[var(--accent)]"
                        />
                        <span className="truncate text-[var(--text-primary)]" title={file.path}>
                          {file.path}
                        </span>
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

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px]">
            <div className="flex items-center gap-2 text-[var(--text-secondary)]">
              <span>
                Size: <strong className="text-[var(--text-primary)]">{formatBytes(selectedTotalBytes)}</strong>
              </span>
              <span>
                (Disk space:{' '}
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
                )
              </span>
            </div>
            {probe && probe.kind === 'http' && (
              <span className="text-[var(--text-muted)]">
                Resume: {probe.resumeSupported ? 'Supported' : 'Not supported'}
              </span>
            )}
          </div>

          {submitError && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-xl border border-[var(--danger)]/50 bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{submitError}</span>
            </div>
          )}

          <div className="mt-1 flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] pt-3">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
            >
              {t(settings.language, 'cancel')}
            </button>
            <button
              type="button"
              disabled={!canPauseSubmit}
              onClick={() => void handleSubmit(true)}
              className="h-9 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer"
            >
              {t(settings.language, 'addPaused')}
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="h-9 rounded-xl bg-[var(--accent)] px-5 text-xs font-semibold tracking-wide text-white shadow-sm hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer"
            >
              {submitting ? 'ADDING...' : t(settings.language, 'downloadBtn')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

