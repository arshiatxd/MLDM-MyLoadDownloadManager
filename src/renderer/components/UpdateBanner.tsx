import { ArrowDownToLine, ExternalLink, Loader2, Sparkles, X } from 'lucide-react';
import { formatBytes } from '../../shared/constants';
import type { UpdateStatus } from '../../shared/types';

interface UpdateBannerProps {
  status: UpdateStatus;
  onUpdateNow: () => void;
  onOpenRelease: () => void;
  onDismiss: () => void;
}

export function UpdateBanner({
  status,
  onUpdateNow,
  onOpenRelease,
  onDismiss,
}: UpdateBannerProps) {
  if (
    status.state !== 'available' &&
    status.state !== 'downloading' &&
    status.state !== 'downloaded'
  ) {
    return null;
  }

  const pct =
    typeof status.progress === 'number'
      ? Math.max(0, Math.min(100, status.progress))
      : status.totalBytes && status.downloadedBytes
        ? Math.min(100, Math.round((status.downloadedBytes / status.totalBytes) * 100))
        : 0;

  return (
    <div
      role="status"
      className="animate-menu-open mx-3 mt-2 flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--accent)]/45 bg-[var(--accent-soft)]/50 px-3.5 py-2 text-xs text-[var(--text-primary)]"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {status.state === 'downloading' ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--accent-text)]" aria-hidden="true" />
        ) : (
          <Sparkles className="h-4 w-4 shrink-0 text-[var(--accent-text)]" aria-hidden="true" />
        )}

        <div className="min-w-0 flex-1">
          {status.state === 'available' && (
            <div className="truncate">
              <span className="font-semibold">
                MyLoad v{status.latestVersion} is available on GitHub
              </span>
              {status.installerSize ? (
                <span className="ml-2 text-[var(--text-secondary)]">
                  ({formatBytes(status.installerSize)})
                </span>
              ) : null}
            </div>
          )}

          {status.state === 'downloading' && (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-semibold">
                  Downloading {status.installerName || `MyLoad v${status.latestVersion}`}...
                </span>
                <span className="shrink-0 font-mono text-[11px] text-[var(--text-secondary)]">
                  {formatBytes(status.downloadedBytes ?? 0)}
                  {status.totalBytes ? ` / ${formatBytes(status.totalBytes)}` : ''} ({pct}%)
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/25">
                <div
                  className="h-full rounded-full bg-[var(--accent)] transition-all duration-150"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}

          {status.state === 'downloaded' && (
            <div className="truncate font-semibold">
              MyLoad v{status.latestVersion} downloaded and ready to install
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onOpenRelease}
          className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 text-[11.5px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
        >
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
          <span>View Release</span>
        </button>

        {status.state !== 'downloading' && (
          <button
            type="button"
            onClick={onUpdateNow}
            className="inline-flex h-7 items-center gap-1 rounded-lg bg-[var(--accent)] px-3 text-[11.5px] font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] cursor-pointer"
          >
            <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden="true" />
            <span>
              {status.state === 'downloaded'
                ? 'Install & Restart'
                : status.installerUrl
                  ? 'Update Now'
                  : 'Download on GitHub'}
            </span>
          </button>
        )}

        {status.state === 'available' && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss update notification"
            className="rounded-lg p-1 text-[var(--text-secondary)] hover:bg-black/15 hover:text-[var(--text-primary)] cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

