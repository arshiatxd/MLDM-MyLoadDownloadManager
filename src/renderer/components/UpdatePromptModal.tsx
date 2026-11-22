import { useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react';
import { formatBytes } from '../../shared/constants';
import type { UpdateStatus } from '../../shared/types';

interface UpdatePromptModalProps {
  open: boolean;
  status: UpdateStatus;
  onDownloadAndInstall: () => void;
  onOpenRelease: () => void;
  onDismiss: (dontShowAgain: boolean) => void;
}

export function UpdatePromptModal({
  open,
  status,
  onDownloadAndInstall,
  onOpenRelease,
  onDismiss,
}: UpdatePromptModalProps) {
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    if (open) {
      setDontShowAgain(false);
    }
  }, [open]);

  const isDownloading = status.state === 'downloading';

  useEffect(() => {
    if (!open || isDownloading) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onDismiss(dontShowAgain);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, isDownloading, dontShowAgain, onDismiss]);

  if (!open) return null;

  const pct =
    typeof status.progress === 'number'
      ? Math.max(0, Math.min(100, status.progress))
      : status.totalBytes && status.downloadedBytes
        ? Math.min(100, Math.round((status.downloadedBytes / status.totalBytes) * 100))
        : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-prompt-title"
    >
      <div className="animate-modal-in w-full max-w-md rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            {isDownloading ? (
              <Loader2 className="h-5 w-5 animate-spin text-[var(--accent-text)]" aria-hidden="true" />
            ) : status.state === 'downloaded' ? (
              <CheckCircle2 className="h-5 w-5 text-[var(--success)]" aria-hidden="true" />
            ) : (
              <Sparkles className="h-5 w-5 text-[var(--accent-text)]" aria-hidden="true" />
            )}
            <h2 id="update-prompt-title" className="text-base font-semibold text-[var(--text-primary)]">
              New Version Available
            </h2>
          </div>
          {!isDownloading && (
            <button
              type="button"
              onClick={() => onDismiss(dontShowAgain)}
              aria-label="Close update reminder"
              className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-lg border border-[var(--accent)]/40 bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-text)]">
            v{status.currentVersion} → v{status.latestVersion || 'latest'}
          </span>
          {status.installerSize ? (
            <span className="text-xs text-[var(--text-secondary)]">
              {formatBytes(status.installerSize)}
            </span>
          ) : null}
        </div>

        {status.releaseName && (
          <p className="mb-1.5 text-[13px] font-medium text-[var(--text-primary)]">
            {status.releaseName}
          </p>
        )}

        <p className="mb-4 text-[13px] text-[var(--text-secondary)]">
          A newer release of MyLoad Download Manager is available on GitHub. Would you like to
          download and install it now, or update manually later from the options menu or GitHub?
        </p>

        {isDownloading && (
          <div className="mb-4 space-y-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/70 p-3">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate font-medium text-[var(--text-primary)]">
                Downloading {status.installerName || `MyLoad v${status.latestVersion}`}...
              </span>
              <span className="shrink-0 font-mono text-[11px] text-[var(--text-secondary)]">
                {formatBytes(status.downloadedBytes ?? 0)}
                {status.totalBytes ? ` / ${formatBytes(status.totalBytes)}` : ''} ({pct}%)
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-black/25">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-all duration-150"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {status.state === 'downloaded' && (
          <div className="mb-4 rounded-lg border border-[var(--success)]/40 bg-[var(--success)]/10 p-3 text-xs font-medium text-[var(--success)]">
            Update downloaded and launching installer...
          </div>
        )}

        {!isDownloading && (
          <label className="mb-5 flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/70 p-3 text-[12.5px] text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            <span>Do not show again (I will update manually from the options menu or GitHub)</span>
          </label>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onOpenRelease}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-[12.5px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            <span>View on GitHub</span>
          </button>

          <button
            type="button"
            disabled={isDownloading}
            onClick={() => onDismiss(dontShowAgain)}
            className="h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 text-[12.5px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            Not now
          </button>

          <button
            type="button"
            disabled={isDownloading}
            onClick={onDownloadAndInstall}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 text-[12.5px] font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden="true" />
            <span>
              {status.state === 'downloaded'
                ? 'Install & Restart'
                : status.installerUrl
                  ? 'Download & Install Now'
                  : 'Download on GitHub'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

