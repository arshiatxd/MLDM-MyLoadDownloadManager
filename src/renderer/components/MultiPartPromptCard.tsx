import { Layers, Loader2 } from 'lucide-react';
import { formatBytes } from '../../shared/constants';
import { tQueueMode } from '../../shared/i18n';
import type { AppLanguage, MultiPartScanResult, QueueMode } from '../../shared/types';
import { CustomSelect, type CustomSelectOption } from './CustomSelect';

export function buildQueueModeOptions(lang: AppLanguage): CustomSelectOption<QueueMode>[] {
  return [
    { value: 'parallel', label: tQueueMode(lang, 'parallel') },
    { value: 'sequential', label: tQueueMode(lang, 'sequential') },
    { value: 'parallel-equal', label: tQueueMode(lang, 'parallel-equal') },
  ];
}

interface MultiPartPromptCardProps {
  lang: AppLanguage;
  scanning: boolean;
  scanResult: MultiPartScanResult | null;
  selectedPartUrls: string[];
  onSelectedPartUrlsChange: (urls: string[]) => void;
  downloadAllParts: boolean;
  onDownloadAllPartsChange: (all: boolean) => void;
  queueMode: QueueMode;
  onQueueModeChange: (mode: QueueMode) => void;
  dontAskAgain: boolean;
  onDontAskAgainChange: (val: boolean) => void;
  autoModeNotice: boolean;
}

export function MultiPartPromptCard({
  lang,
  scanning,
  scanResult,
  selectedPartUrls,
  onSelectedPartUrlsChange,
  downloadAllParts,
  onDownloadAllPartsChange,
  queueMode,
  onQueueModeChange,
  dontAskAgain,
  onDontAskAgainChange,
  autoModeNotice,
}: MultiPartPromptCardProps) {
  if (scanning) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/70 px-3 py-2 text-xs text-[var(--text-secondary)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent-text)]" />
        <span>Scanning for related file parts...</span>
      </div>
    );
  }

  if (!scanResult || !scanResult.matched || scanResult.parts.length <= 1) {
    return null;
  }

  if (autoModeNotice) {
    return (
      <div className="animate-tab-content rounded-xl border border-[var(--accent)]/40 bg-[var(--accent-soft)]/35 px-3 py-2 text-xs text-[var(--text-primary)]">
        Auto-adding <strong>{scanResult.parts.length}</strong> detected parts for{' '}
        <span className="font-semibold">{scanResult.baseName}</span> (Settings → Multi-Part)
      </div>
    );
  }

  const knownSizes = scanResult.parts
    .filter((p) => selectedPartUrls.includes(p.url) && p.totalBytes && p.totalBytes > 0)
    .reduce((sum, p) => sum + (p.totalBytes ?? 0), 0);

  return (
    <div className="animate-tab-content space-y-2.5 rounded-xl border border-[var(--accent)]/50 bg-[var(--accent-soft)]/35 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
          <Layers className="h-4 w-4 text-[var(--accent-text)]" aria-hidden="true" />
          <span>
            Found {scanResult.parts.length} parts for &ldquo;{scanResult.baseName}&rdquo;
          </span>
        </div>
        {knownSizes > 0 && (
          <span className="text-[11px] font-medium text-[var(--text-secondary)]">
            Selected: {formatBytes(knownSizes)}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4 text-[var(--text-primary)]">
        <label className="inline-flex cursor-pointer items-center gap-1.5 font-medium">
          <input
            type="radio"
            name="multipart-mode"
            checked={downloadAllParts}
            onChange={() => onDownloadAllPartsChange(true)}
            className="accent-[var(--accent)]"
          />
          <span>Download all selected parts ({selectedPartUrls.length})</span>
        </label>
        <label className="inline-flex cursor-pointer items-center gap-1.5">
          <input
            type="radio"
            name="multipart-mode"
            checked={!downloadAllParts}
            onChange={() => onDownloadAllPartsChange(false)}
            className="accent-[var(--accent)]"
          />
          <span>Only download this part</span>
        </label>
      </div>

      {downloadAllParts && (
        <>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[var(--text-secondary)]">Detected parts list</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onSelectedPartUrlsChange(scanResult.parts.map((p) => p.url))}
                className="text-[var(--accent-text)] hover:underline cursor-pointer"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={() => onSelectedPartUrlsChange([])}
                className="text-[var(--text-secondary)] hover:underline cursor-pointer"
              >
                None
              </button>
            </div>
          </div>

          <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/70 p-1.5">
            {scanResult.parts.map((part) => {
              const checked = selectedPartUrls.includes(part.url);
              return (
                <label
                  key={part.url}
                  className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1 hover:bg-[var(--bg-hover)]/50"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        onSelectedPartUrlsChange(
                          checked
                            ? selectedPartUrls.filter((u) => u !== part.url)
                            : [...selectedPartUrls, part.url]
                        );
                      }}
                      className="h-3.5 w-3.5 accent-[var(--accent)]"
                    />
                    <span className="truncate text-[var(--text-primary)]" title={part.url}>
                      {part.fileName}
                    </span>
                  </span>
                  {part.totalBytes ? (
                    <span className="shrink-0 text-[11px] text-[var(--text-secondary)]">
                      {formatBytes(part.totalBytes)}
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--text-secondary)]">Queue mode</span>
            <CustomSelect
              size="sm"
              value={queueMode}
              options={buildQueueModeOptions(lang)}
              onChange={onQueueModeChange}
              ariaLabel="Multi-part queue mode"
              className="w-48"
              buttonClassName="bg-[var(--bg-surface)]"
            />
          </div>
        </>
      )}

      <label className="flex cursor-pointer items-center gap-2 pt-0.5 text-[11.5px] text-[var(--text-secondary)]">
        <input
          type="checkbox"
          checked={dontAskAgain}
          onChange={(e) => onDontAskAgainChange(e.target.checked)}
          className="h-3.5 w-3.5 accent-[var(--accent)]"
        />
        <span>Don&apos;t ask me again (can be re-enabled in Settings)</span>
      </label>
    </div>
  );
}

