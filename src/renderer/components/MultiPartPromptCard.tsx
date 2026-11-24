import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Layers,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import { formatBytes } from '../../shared/constants';
import { tQueueMode } from '../../shared/i18n';
import {
  cycleDownloadPriority,
  getPriorityRank,
  moveItemByDelta,
  reorderByIndex,
} from '../../shared/selection';
import type {
  AppLanguage,
  DownloadPriority,
  MultiPartCandidate,
  MultiPartScanResult,
  QueueMode,
} from '../../shared/types';
import { CustomSelect, type CustomSelectOption } from './CustomSelect';

export function buildQueueModeOptions(lang: AppLanguage): CustomSelectOption<QueueMode>[] {
  return [
    { value: 'parallel', label: tQueueMode(lang, 'parallel') },
    { value: 'sequential', label: tQueueMode(lang, 'sequential') },
    { value: 'parallel-equal', label: tQueueMode(lang, 'parallel-equal') },
  ];
}

export function SimultaneousDownloadsSlider({
  id,
  queueMode,
  value,
  onChange,
}: {
  id: string;
  queueMode: QueueMode;
  value: number;
  onChange: (val: number) => void;
}) {
  const isSequential = queueMode === 'sequential';
  return (
    <div className="space-y-1 pt-0.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-[var(--text-secondary)]">
          Simultaneous downloads
        </label>
        <span className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-0.5 font-mono text-[11px] font-semibold text-[var(--text-primary)]">
          {isSequential ? '1 (Sequential)' : value}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={1}
        max={10}
        step={1}
        disabled={isSequential}
        value={isSequential ? 1 : value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Simultaneous downloads"
        className="w-full cursor-pointer accent-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-45"
      />
      <div className="flex justify-between font-mono text-[10px] text-[var(--text-muted)]">
        <span>1</span>
        <span>5</span>
        <span>10</span>
      </div>
    </div>
  );
}

function priorityButtonClass(priority: DownloadPriority): string {
  if (priority === 'high') {
    return 'border-[var(--accent)]/60 bg-[var(--accent-soft)] text-[var(--accent-text)] font-semibold';
  }
  if (priority === 'low') {
    return 'border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-muted)]';
  }
  return 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)]';
}

function priorityLabel(priority: DownloadPriority): string {
  if (priority === 'high') return 'High';
  if (priority === 'low') return 'Low';
  return 'Normal';
}

interface MultiPartPromptCardProps {
  lang: AppLanguage;
  scanning: boolean;
  scanResult: MultiPartScanResult | null;
  orderedParts: MultiPartCandidate[];
  onReorderParts: (next: MultiPartCandidate[]) => void;
  partPriorities: Record<string, DownloadPriority>;
  onPartPriorityChange: (url: string, priority: DownloadPriority) => void;
  onResetOrder?: () => void;
  selectedPartUrls: string[];
  onSelectedPartUrlsChange: (urls: string[]) => void;
  downloadAllParts: boolean;
  onDownloadAllPartsChange: (all: boolean) => void;
  queueMode: QueueMode;
  onQueueModeChange: (mode: QueueMode) => void;
  maxConcurrentDownloads: number;
  onMaxConcurrentDownloadsChange: (val: number) => void;
  dontAskAgain: boolean;
  onDontAskAgainChange: (val: boolean) => void;
  autoModeNotice: boolean;
}

export function MultiPartPromptCard({
  lang,
  scanning,
  scanResult,
  orderedParts,
  onReorderParts,
  partPriorities,
  onPartPriorityChange,
  onResetOrder,
  selectedPartUrls,
  onSelectedPartUrlsChange,
  downloadAllParts,
  onDownloadAllPartsChange,
  queueMode,
  onQueueModeChange,
  maxConcurrentDownloads,
  onMaxConcurrentDownloadsChange,
  dontAskAgain,
  onDontAskAgainChange,
  autoModeNotice,
}: MultiPartPromptCardProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

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

  const partsList = orderedParts.length > 0 ? orderedParts : scanResult.parts;

  if (autoModeNotice) {
    return (
      <div className="animate-tab-content rounded-xl border border-[var(--accent)]/40 bg-[var(--accent-soft)]/35 px-3 py-2 text-xs text-[var(--text-primary)]">
        Auto-adding <strong>{scanResult.parts.length}</strong> detected parts for{' '}
        <span className="font-semibold">{scanResult.baseName}</span> (Settings → Multi-Part)
      </div>
    );
  }

  const knownSizes = partsList
    .filter((p) => selectedPartUrls.includes(p.url) && p.totalBytes && p.totalBytes > 0)
    .reduce((sum, p) => sum + (p.totalBytes ?? 0), 0);

  const hasCustomOrder = scanResult.parts.some((p, i) => partsList[i]?.url !== p.url);
  const hasCustomPriority = partsList.some(
    (p) => (partPriorities[p.url] ?? 'normal') !== 'normal'
  );

  return (
    <div className="animate-tab-content space-y-2.5 rounded-xl border border-[var(--accent)]/50 bg-[var(--accent-soft)]/35 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
          <Layers className="h-4 w-4 text-[var(--accent-text)]" aria-hidden="true" />
          <span>
            Found {partsList.length} parts for &ldquo;{scanResult.baseName}&rdquo;
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
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="text-[var(--text-secondary)]">
              Order &amp; priority (drag or use arrows)
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {hasCustomPriority && (
                <button
                  type="button"
                  onClick={() =>
                    onReorderParts(
                      [...partsList].sort(
                        (a, b) =>
                          getPriorityRank(partPriorities[b.url]) -
                          getPriorityRank(partPriorities[a.url])
                      )
                    )
                  }
                  className="text-[var(--accent-text)] hover:underline cursor-pointer"
                >
                  Sort by priority
                </button>
              )}
              {onResetOrder && (hasCustomOrder || hasCustomPriority) && (
                <button
                  type="button"
                  onClick={onResetOrder}
                  className="inline-flex items-center gap-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline cursor-pointer"
                >
                  <RotateCcw className="h-3 w-3" aria-hidden="true" />
                  <span>Reset</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onSelectedPartUrlsChange(partsList.map((p) => p.url))}
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

          <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/70 p-1.5">
            {partsList.map((part, idx) => {
              const checked = selectedPartUrls.includes(part.url);
              const priority = partPriorities[part.url] ?? 'normal';
              const isDragging = dragIndex === idx;
              const isDropTarget = dragOverIndex === idx && dragIndex !== null && dragIndex !== idx;

              return (
                <div
                  key={part.url}
                  draggable
                  onDragStart={(e) => {
                    setDragIndex(idx);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('application/x-myload-multipart', String(idx));
                    e.dataTransfer.setData('text/plain', part.fileName);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'move';
                    if (dragOverIndex !== idx) setDragOverIndex(idx);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null) && dragOverIndex === idx) {
                      setDragOverIndex(null);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (dragIndex !== null && dragIndex !== idx) {
                      onReorderParts(reorderByIndex(partsList, dragIndex, idx));
                    }
                    setDragIndex(null);
                    setDragOverIndex(null);
                  }}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setDragOverIndex(null);
                  }}
                  className={`flex items-center gap-1.5 rounded-lg border px-1.5 py-1 transition-colors ${
                    isDropTarget
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)]/50'
                      : 'border-transparent hover:bg-[var(--bg-hover)]/50'
                  } ${isDragging ? 'opacity-50' : ''}`}
                >
                  <span
                    title="Drag to reorder"
                    className="shrink-0 cursor-grab text-[var(--text-muted)] hover:text-[var(--text-secondary)] active:cursor-grabbing"
                  >
                    <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>

                  <span className="w-5 shrink-0 text-center font-mono text-[10.5px] text-[var(--text-muted)]">
                    #{idx + 1}
                  </span>

                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
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
                      className="h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
                    />
                    <span className="truncate text-[var(--text-primary)]" title={part.url}>
                      {part.fileName}
                    </span>
                  </label>

                  {part.totalBytes ? (
                    <span className="shrink-0 text-[11px] text-[var(--text-secondary)]">
                      {formatBytes(part.totalBytes)}
                    </span>
                  ) : null}

                  <button
                    type="button"
                    onClick={() =>
                      onPartPriorityChange(part.url, cycleDownloadPriority(priority))
                    }
                    title={`Priority: ${priorityLabel(priority)} (click to change)`}
                    aria-label={`Priority for ${part.fileName}: ${priorityLabel(priority)}`}
                    className={`shrink-0 cursor-pointer rounded-md border px-1.5 py-0.5 text-[10.5px] transition-colors ${priorityButtonClass(priority)}`}
                  >
                    {priorityLabel(priority)}
                  </button>

                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => onReorderParts(moveItemByDelta(partsList, idx, -1))}
                      aria-label={`Move ${part.fileName} up`}
                      title="Move up"
                      className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <ArrowUp className="h-3 w-3" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === partsList.length - 1}
                      onClick={() => onReorderParts(moveItemByDelta(partsList, idx, 1))}
                      aria-label={`Move ${part.fileName} down`}
                      title="Move down"
                      className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <ArrowDown className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </div>
                </div>
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

          <SimultaneousDownloadsSlider
            id="multipart-max-concurrent"
            queueMode={queueMode}
            value={maxConcurrentDownloads}
            onChange={onMaxConcurrentDownloadsChange}
          />
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

