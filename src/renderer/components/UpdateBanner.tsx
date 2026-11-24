import { useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Pause,
  Play,
  Sparkles,
  X,
} from 'lucide-react';
import { formatBytes } from '../../shared/constants';
import type { UpdateStatus } from '../../shared/types';

interface UpdateBannerProps {
  status: UpdateStatus;
  onUpdateNow: () => void;
  onPauseUpdate: () => void;
  onResumeUpdate: () => void;
  onCancelUpdate: () => void;
  onOpenRelease: () => void;
  onDismiss: (dontShowAgain: boolean) => void;
}

export function UpdateBanner({
  status,
  onUpdateNow,
  onPauseUpdate,
  onResumeUpdate,
  onCancelUpdate,
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
    status.state !== 'paused' &&
    status.state !== 'downloaded'
  ) {
    return null;
  }

  const isDownloading = status.state === 'downloading';
  const isPaused = status.state === 'paused';
  const isTransferring = isDownloading || isPaused;
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
      className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2"
    >
      <div className="flex min-h-[42px] w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-white/15 bg-[#c81e3d] px-3.5 py-1.5 text-[12.5px] text-white shadow-sm">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {isDownloading ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white" aria-hidden="true" />
          ) : isPaused ? (
            <Pause className="h-4 w-4 shrink-0 text-white/90" aria-hidden="true" />
          ) : isDownloaded ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-white" aria-hidden="true" />
          ) : (
            <Sparkles className="h-4 w-4 shrink-0 text-white" aria-hidden="true" />
          )}

          <div className="min-w-0 flex-1">
            {status.state === 'available' && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-white">New Version Available</span>
                <span className="inline-flex items-center rounded-md bg-black/25 px-2 py-0.5 font-mono text-[11px] font-semibold text-white">
                  v{status.currentVersion} → v{status.latestVersion || 'latest'}
                </span>
                {status.installerSize ? (
                  <span className="text-[11.5px] text-white/85">
                    {formatBytes(status.installerSize)}
                  </span>
                ) : null}
              </div>
            )}

            {isTransferring && (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate leading-tight font-semibold text-white">
                    {isPaused ? 'Paused — ' : 'Downloading '}
                    {status.installerName || `MyLoad v${status.latestVersion || 'latest'}`}
                    {isDownloading ? '...' : ''}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] leading-tight font-medium text-white/90">
                    {formatBytes(status.downloadedBytes ?? 0)}
                    {status.totalBytes ? ` / ${formatBytes(status.totalBytes)}` : ''} ({pct}%)
                  </span>
                </div>
                <div
                  className="h-1.5 w-full overflow-hidden rounded-full bg-black/30"
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Update download progress"
                >
                  <div
                    className={`h-full rounded-full transition-all duration-150 ${
                      isPaused ? 'bg-white/70' : 'bg-white'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )}

            {isDownloaded && (
              <div className="truncate font-semibold text-white">
                MyLoad v{status.latestVersion} downloaded and ready to install
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {!isTransferring && (
            <>
              {status.state === 'available' && (
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
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/25 bg-black/20 px-2.5 text-[12px] font-medium text-white hover:bg-black/30 cursor-pointer"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                <span>View on GitHub</span>
              </button>

              <button
                type="button"
                onClick={onUpdateNow}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[12px] font-semibold text-[#b01633] hover:bg-white/90 cursor-pointer"
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

              <button
                type="button"
                onClick={() => onDismiss(dontShowAgain)}
                aria-label="Close update bar"
                title="Dismiss"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/90 hover:bg-black/20 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </>
          )}

          {isTransferring && (
            <>
              <button
                type="button"
                onClick={onOpenRelease}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/25 bg-black/20 px-2.5 text-[12px] font-medium text-white hover:bg-black/30 cursor-pointer"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                <span>View on GitHub</span>
              </button>

              <div
                className="inline-flex h-8 items-center gap-0.5 rounded-lg border border-white/25 bg-black/20 p-0.5"
                role="group"
                aria-label="Update transfer controls"
              >
                <button
                  type="button"
                  disabled={!isPaused}
                  onClick={onResumeUpdate}
                  aria-label="Resume update download"
                  title="Resume update download"
                  className={`inline-flex h-[26px] w-7 items-center justify-center rounded-md ${
                    isPaused
                      ? 'bg-white text-[#b01633] hover:bg-white/90 cursor-pointer'
                      : 'text-white/40 cursor-not-allowed'
                  }`}
                >
                  <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  disabled={!isDownloading}
                  onClick={onPauseUpdate}
                  aria-label="Pause update download"
                  title="Pause update download"
                  className={`inline-flex h-[26px] w-7 items-center justify-center rounded-md ${
                    isDownloading
                      ? 'text-white hover:bg-white/20 cursor-pointer'
                      : 'text-white/40 cursor-not-allowed'
                  }`}
                >
                  <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <span className="mx-0.5 h-4 w-px bg-white/20" aria-hidden="true" />
                <button
                  type="button"
                  onClick={onCancelUpdate}
                  aria-label="Cancel update download"
                  title="Cancel update download"
                  className="inline-flex h-[26px] w-7 items-center justify-center rounded-md text-white/90 hover:bg-white/20 hover:text-white cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
