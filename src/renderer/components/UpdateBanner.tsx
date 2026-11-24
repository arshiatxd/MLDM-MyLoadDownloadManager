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

interface UpdateBannerProps {
  status: UpdateStatus;
  onUpdateNow: () => void;
  onOpenRelease: () => void;
  onDismiss: (dontShowAgain: boolean) => void;
}

export function UpdateBanner({
  status,
  onUpdateNow,
  onOpenRelease,
  onDismiss,
}: UpdateBannerProps) {
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    setDontShowAgain(false);
  }, [status.latestVersion]);

  if (
    status.state !== 'available' &&
    status.state !== 'downloading' &&
    status.state !== 'downloaded'
  ) {
    return null;
  }

  const isDownloading = status.state === 'downloading';
  const isDownloaded = status.state === 'downloaded';

  const pct =
    typeof status.progress === 'number'
      ? Math.max(0, Math.min(100, status.progress))
      : status.totalBytes && status.downloadedBytes
        ? Math.min(100, Math.round((status.downloadedBytes / status.totalBytes) * 100))
        : 0;

  return (
    <div
      role="status"
      aria-live="polite"
      className="animate-menu-open mx-3 mt-1.5 mb-0.5 flex shrink-0 flex-wrap items-center justify-between gap-2.5 rounded-lg border border-white/15 bg-[#c81e3d] px-3.5 py-2 text-xs text-white shadow-md"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {isDownloading ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white" aria-hidden="true" />
        ) : isDownloaded ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-white" aria-hidden="true" />
        ) : (
          <Sparkles className="h-4 w-4 shrink-0 text-white" aria-hidden="true" />
        )}

        <div className="min-w-0 flex-1">
          {status.state === 'available' && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-white">New Version Available</span>
              <span className="inline-flex items-center rounded bg-black/25 px-2 py-0.5 font-mono text-[11px] font-semibold text-white">
                v{status.currentVersion} → v{status.latestVersion || 'latest'}
              </span>
              {status.installerSize ? (
                <span className="text-[11.5px] text-white/85">
                  {formatBytes(status.installerSize)}
                </span>
              ) : null}
            </div>
          )}

          {isDownloading && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-semibold text-white">
                  Downloading {status.installerName || `MyLoad v${status.latestVersion}`}...
                </span>
                <span className="shrink-0 font-mono text-[11px] text-white/90">
                  {formatBytes(status.downloadedBytes ?? 0)}
                  {status.totalBytes ? ` / ${formatBytes(status.totalBytes)}` : ''} ({pct}%)
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/30">
                <div
                  className="h-full rounded-full bg-white transition-all duration-150"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}

          {isDownloaded && (
            <div className="truncate font-semibold text-white">
              MyLoad v{status.latestVersion} downloaded and launching installer...
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {!isDownloading && (
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11.5px] text-white/90 select-none hover:text-white">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="h-3.5 w-3.5 cursor-pointer accent-white"
            />
            <span>Don&apos;t show again</span>
          </label>
        )}

        <button
          type="button"
          onClick={onOpenRelease}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-white/25 bg-black/20 px-2.5 text-[11.5px] font-medium text-white hover:bg-black/30 cursor-pointer"
        >
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
          <span>View on GitHub</span>
        </button>

        <button
          type="button"
          disabled={isDownloading}
          onClick={onUpdateNow}
          className="inline-flex h-7 items-center gap-1 rounded-md bg-white px-3 text-[11.5px] font-semibold text-[#b01633] hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
        >
          <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden="true" />
          <span>
            {isDownloaded
              ? 'Install & Restart'
              : status.installerUrl
                ? 'Download & Install Now'
                : 'Download on GitHub'}
          </span>
        </button>

        {!isDownloading && (
          <button
            type="button"
            onClick={() => onDismiss(dontShowAgain)}
            aria-label="Close update bar"
            title="Dismiss"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-white/90 hover:bg-black/20 hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
