import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Download, Search, Trash2, X } from 'lucide-react';
import type { LogEntry, LogLevel } from '../../shared/types';

interface LogsDrawerProps {
  open: boolean;
  logs: LogEntry[];
  onClose: () => void;
  onClear: () => void;
  onExport: () => void;
}

export function LogsDrawer({
  open,
  logs,
  onClose,
  onClear,
  onExport,
}: LogsDrawerProps) {
  const [levelFilter, setLevelFilter] = useState<'all' | LogLevel>('all');
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((entry) => {
      if (levelFilter !== 'all' && entry.level !== levelFilter) return false;
      if (!q) return true;
      return (
        entry.message.toLowerCase().includes(q) ||
        entry.source.toLowerCase().includes(q)
      );
    });
  }, [logs, levelFilter, query]);

  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [open, filtered.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleCopy = async () => {
    const text = filtered
      .map(
        (e) =>
          `[${new Date(e.timestamp).toISOString()}] [${e.level.toUpperCase()}] [${e.source}] ${e.message}`
      )
      .join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/55"
      role="dialog"
      aria-modal="true"
      aria-labelledby="logs-drawer-title"
      onClick={onClose}
    >
      <div
        className="animate-drawer-in flex h-full w-full max-w-2xl flex-col border-l border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 id="logs-drawer-title" className="text-base font-semibold text-[var(--text-primary)]">
              Activity &amp; Diagnostic Logs
            </h2>
            <span className="rounded-full bg-[var(--bg-elevated)] px-2.5 py-0.5 text-[12px] text-[var(--text-secondary)]">
              {filtered.length}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close logs drawer"
            className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)]/70 px-4 py-2.5">
          <div className="flex items-center gap-1">
            {(['all', 'info', 'warn', 'error'] as const).map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => setLevelFilter(lvl)}
                className={`h-8 rounded px-3 text-[12.5px] font-medium capitalize transition-colors ${
                  levelFilter === lvl
                    ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
                    : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {lvl === 'warn' ? 'Warning' : lvl}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2 top-2.5 h-3.5 w-3.5 text-[var(--text-muted)]"
                aria-hidden="true"
              />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter logs..."
                aria-label="Filter log messages"
                className="h-8 w-44 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] pl-7 pr-2 text-[12.5px] text-[var(--text-primary)]"
              />
            </div>

            <button
              type="button"
              onClick={() => void handleCopy()}
              className="inline-flex h-7 items-center gap-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              title="Copy visible logs"
            >
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>

            <button
              type="button"
              onClick={onExport}
              className="inline-flex h-7 items-center gap-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              title="Export logs to .log file"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Export</span>
            </button>

            <button
              type="button"
              onClick={onClear}
              className="inline-flex h-7 items-center gap-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-xs text-[var(--danger)] hover:bg-[var(--danger-soft)]"
              title="Clear all logs"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Clear</span>
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[11px]">
          {filtered.length === 0 ? (
            <div className="py-12 text-center font-sans text-xs text-[var(--text-muted)]">
              No matching log entries.
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-2 rounded border border-[var(--border-subtle)]/40 bg-[var(--bg-canvas)]/60 px-2.5 py-1.5"
                >
                  <span className="shrink-0 text-[var(--text-muted)]">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0 text-[10px] font-semibold uppercase ${
                      entry.level === 'error'
                        ? 'bg-[var(--danger-soft)] text-[var(--danger)]'
                        : entry.level === 'warn'
                          ? 'bg-[var(--warning-soft)] text-[var(--warning)]'
                          : 'bg-[var(--accent-soft)] text-[var(--accent-text)]'
                    }`}
                  >
                    {entry.level}
                  </span>
                  <span className="shrink-0 font-semibold text-[var(--text-secondary)]">
                    [{entry.source}]
                  </span>
                  <span className="min-w-0 flex-1 break-words text-[var(--text-primary)]">
                    {entry.message}
                  </span>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

