import { useRef, useState } from 'react';
import { ChevronDown, FileCheck2, Layers, ScrollText } from 'lucide-react';
import { formatBytes, formatEta, formatSpeed } from '../../shared/constants';
import type { DownloadItem, LogEntry } from '../../shared/types';

interface InspectorPanelProps {
  item: DownloadItem;
  logs: LogEntry[];
  onClose: () => void;
  onUpdateTorrentFiles: (id: string, selectedIndices: number[]) => void;
}

type InspectorTab = 'overview' | 'files' | 'log';

export function InspectorPanel({
  item,
  logs,
  onClose,
  onUpdateTorrentFiles,
}: InspectorPanelProps) {
  const [tab, setTab] = useState<InspectorTab>('overview');
  const [height, setHeight] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('myload:inspectorHeight'));
      if (Number.isFinite(saved) && saved >= 150 && saved <= 520) return saved;
    } catch {
      return 240;
    }
    return 240;
  });
  const [isResizing, setIsResizing] = useState(false);
  const dragRef = useRef<{ startY: number; startHeight: number; latestHeight: number } | null>(null);

  const itemLogs = logs.filter((l) => l.downloadId === item.id);
  const torrentFiles = item.torrent?.files ?? [];

  const activeTab: InspectorTab =
    tab === 'files' && item.kind !== 'torrent' ? 'overview' : tab;

  const toggleTorrentFile = (idx: number) => {
    const next = torrentFiles
      .map((f) => (f.index === idx ? { ...f, selected: !f.selected } : f))
      .filter((f) => f.selected)
      .map((f) => f.index);
    onUpdateTorrentFiles(item.id, next);
  };

  return (
    <section
      aria-label={`Inspector for ${item.name}`}
      style={{ height }}
      className="animate-inspector-in flex shrink-0 flex-col border-t border-[var(--border-strong)] bg-[var(--bg-surface)]"
    >
      <div
        role="separator"
        tabIndex={0}
        aria-orientation="horizontal"
        aria-label="Resize inspector panel"
        aria-valuemin={150}
        aria-valuemax={520}
        aria-valuenow={height}
        data-dragging={isResizing ? 'true' : 'false'}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          dragRef.current = {
            startY: e.clientY,
            startHeight: height,
            latestHeight: height,
          };
          setIsResizing(true);
        }}
        onPointerMove={(e) => {
          if (!dragRef.current) return;
          const delta = dragRef.current.startY - e.clientY;
          const next = Math.max(150, Math.min(520, Math.round(dragRef.current.startHeight + delta)));
          dragRef.current.latestHeight = next;
          setHeight(next);
        }}
        onPointerUp={() => {
          if (!dragRef.current) return;
          const saved = dragRef.current.latestHeight;
          dragRef.current = null;
          setIsResizing(false);
          try {
            localStorage.setItem('myload:inspectorHeight', String(saved));
          } catch {
            return;
          }
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          setIsResizing(false);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          const delta = e.key === 'ArrowUp' ? 16 : -16;
          const next = Math.max(150, Math.min(520, height + delta));
          setHeight(next);
          try {
            localStorage.setItem('myload:inspectorHeight', String(next));
          } catch {
            return;
          }
        }}
        title="Drag to resize inspector panel"
        className="ml-resize-handle shrink-0 border-b border-[var(--border-subtle)]/50 bg-[var(--bg-elevated)]/40"
      />
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/65 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex items-center gap-1" role="tablist" aria-label="Inspector tabs">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'overview'}
              onClick={() => setTab('overview')}
              className={`inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-[12.5px] font-medium transition-colors ${
                activeTab === 'overview'
                  ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Layers className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{item.kind === 'http' ? 'Overview & Segments' : 'Torrent Overview'}</span>
            </button>

            {item.kind === 'torrent' && (
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'files'}
                onClick={() => setTab('files')}
                className={`inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-[12.5px] font-medium transition-colors ${
                  activeTab === 'files'
                    ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                }`}
              >
                <FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Files ({torrentFiles.length})</span>
              </button>
            )}

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'log'}
              onClick={() => setTab('log')}
              className={`inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-[12.5px] font-medium transition-colors ${
                activeTab === 'log'
                  ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
              }`}
            >
              <ScrollText className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Log ({itemLogs.length})</span>
            </button>
          </div>

          <span className="truncate text-[12.5px] font-medium text-[var(--text-secondary)]" title={item.name}>
            {item.name}
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          title="Collapse Inspector"
          aria-label="Close inspector"
          className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      <div
        key={activeTab}
        className="animate-tab-content min-h-0 flex-1 overflow-auto p-3 text-[13px]"
      >
        {activeTab === 'overview' && item.kind === 'http' && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/70 p-2.5 sm:grid-cols-4">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                  Save path
                </div>
                <div className="truncate font-medium text-[var(--text-primary)]" title={item.filePath}>
                  {item.filePath}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                  Source URL
                </div>
                <div className="truncate text-[var(--text-secondary)]" title={item.source}>
                  {item.source}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                  Resume capability
                </div>
                <div className="font-medium text-[var(--text-primary)]">
                  {item.resumeSupported ? 'Yes (Range supported)' : 'No'}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                  Speed &amp; ETA
                </div>
                <div className="font-medium text-[var(--text-primary)]">
                  {formatSpeed(item.downloadSpeed)} · {formatEta(item.etaSeconds)}
                </div>
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between text-[12px] font-semibold text-[var(--text-secondary)]">
                <span>
                  Multi-Segment Connections ({item.segments.length || 1})
                </span>
                <span className="font-normal text-[var(--text-muted)]">
                  {formatBytes(item.downloadedBytes)} / {formatBytes(item.totalBytes)}
                </span>
              </div>

              {item.segments.length === 0 ? (
                <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 px-3 py-2 text-[var(--text-secondary)]">
                  Segments will appear once connection starts.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {item.segments.map((seg) => {
                    const segLen = seg.end >= seg.start ? seg.end - seg.start + 1 : null;
                    const segPct =
                      seg.status === 'done'
                        ? 100
                        : segLen && segLen > 0
                          ? Math.min(100, Math.round((seg.downloaded / segLen) * 100))
                          : 0;
                    const barColor =
                      seg.status === 'done'
                        ? 'var(--success)'
                        : seg.status === 'error'
                          ? 'var(--danger)'
                          : seg.status === 'active'
                            ? 'var(--accent)'
                            : 'var(--warning)';

                    return (
                      <div
                        key={seg.index}
                        className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/70 p-2"
                      >
                        <div className="mb-1 flex items-center justify-between text-[12px]">
                          <span className="font-semibold text-[var(--text-primary)]">
                            Conn #{seg.index + 1}
                          </span>
                          <span className="font-mono text-[11px] text-[var(--text-secondary)]">
                            {seg.status === 'active'
                              ? formatSpeed(seg.speed)
                              : seg.status.toUpperCase()}
                          </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded bg-[var(--bg-elevated)]">
                          <div
                            className="h-full rounded transition-all duration-150"
                            style={{
                              width: `${segPct}%`,
                              backgroundColor: barColor,
                            }}
                          />
                        </div>
                        <div className="mt-1 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                          <span>
                            {formatBytes(seg.downloaded)}
                            {segLen ? ` / ${formatBytes(segLen)}` : ''}
                          </span>
                          <span>{segPct}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'overview' && item.kind === 'torrent' && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
              <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/70 p-2.5">
                <div className="text-[11px] uppercase text-[var(--text-muted)]">Peers</div>
                <div className="text-sm font-semibold text-[var(--text-primary)]">
                  {item.torrent?.peers ?? 0}
                </div>
              </div>
              <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/70 p-2.5">
                <div className="text-[11px] uppercase text-[var(--text-muted)]">Seeds</div>
                <div className="text-sm font-semibold text-[var(--text-primary)]">
                  {item.torrent?.seeds ?? 0}
                </div>
              </div>
              <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/70 p-2.5">
                <div className="text-[11px] uppercase text-[var(--text-muted)]">Uploaded</div>
                <div className="text-sm font-semibold text-[var(--text-primary)]">
                  {formatBytes(item.uploadedBytes)}
                </div>
              </div>
              <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/70 p-2.5">
                <div className="text-[11px] uppercase text-[var(--text-muted)]">Ratio</div>
                <div className="text-sm font-semibold text-[var(--text-primary)]">
                  {item.torrent?.ratio ?? 0}
                </div>
              </div>
              <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/70 p-2.5">
                <div className="text-[11px] uppercase text-[var(--text-muted)]">InfoHash</div>
                <div
                  className="truncate font-mono text-[12px] text-[var(--text-secondary)]"
                  title={item.torrent?.infoHash}
                >
                  {item.torrent?.infoHash || 'Pending'}
                </div>
              </div>
            </div>

            <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/70 p-2.5">
              <div className="mb-1 text-[11px] font-semibold uppercase text-[var(--text-muted)]">
                Trackers ({item.torrent?.trackers.length ?? 0})
              </div>
              {item.torrent?.trackers.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {item.torrent.trackers.slice(0, 12).map((tr) => (
                    <span
                      key={tr}
                      className="rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-0.5 font-mono text-[11px] text-[var(--text-secondary)]"
                    >
                      {tr}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-[var(--text-muted)]">Using DHT / PEX peer discovery</span>
              )}
            </div>
          </div>
        )}

        {activeTab === 'files' && item.kind === 'torrent' && (
          <div className="space-y-1.5">
            {torrentFiles.length === 0 ? (
              <div className="py-4 text-center text-[var(--text-secondary)]">
                Waiting for torrent metadata from peers...
              </div>
            ) : (
              torrentFiles.map((file) => {
                const filePct =
                  file.length > 0
                    ? Math.min(100, Math.round((file.downloaded / file.length) * 100))
                    : 100;
                return (
                  <div
                    key={file.index}
                    className="flex items-center justify-between gap-3 rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/60 px-3 py-2"
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={file.selected}
                        onChange={() => toggleTorrentFile(file.index)}
                        className="h-4 w-4 accent-[var(--accent)]"
                      />
                      <span className="truncate text-[var(--text-primary)]" title={file.path}>
                        {file.path}
                      </span>
                    </label>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-[12px] text-[var(--text-secondary)]">
                        {formatBytes(file.length)}
                      </span>
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
                        <div
                          className="h-full rounded-full bg-[var(--accent)]"
                          style={{ width: `${filePct}%` }}
                        />
                      </div>
                      <span className="w-9 text-right font-mono text-[11px] text-[var(--text-secondary)]">
                        {filePct}%
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {activeTab === 'log' && (
          <div className="space-y-1 font-mono text-[12px]">
            {itemLogs.length === 0 ? (
              <div className="py-4 text-center font-sans text-[13px] text-[var(--text-muted)]">
                No log entries recorded for this download yet.
              </div>
            ) : (
              itemLogs.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-2 rounded bg-[var(--bg-canvas)]/60 px-2.5 py-1.5"
                >
                  <span className="shrink-0 text-[var(--text-muted)]">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                  <span
                    className={`shrink-0 rounded px-1.5 text-[11px] font-semibold uppercase ${
                      entry.level === 'error'
                        ? 'bg-[var(--danger-soft)] text-[var(--danger)]'
                        : entry.level === 'warn'
                          ? 'bg-[var(--warning-soft)] text-[var(--warning)]'
                          : 'bg-[var(--accent-soft)] text-[var(--accent-text)]'
                    }`}
                  >
                    {entry.level}
                  </span>
                  <span className="text-[var(--text-primary)]">{entry.message}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </section>
  );
}

