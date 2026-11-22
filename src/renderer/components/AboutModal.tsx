import { useEffect } from 'react';
import {
  ArrowDownToLine,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { UpdateStatus } from '../../shared/types';
import { MyLoadLogo } from './MyLoadLogo';

interface AboutModalProps {
  open: boolean;
  appVersion: string;
  updateStatus: UpdateStatus;
  onClose: () => void;
  onOpenPrivacy: () => void;
  onCheckUpdates: () => void;
  onUpdateNow: () => void;
  onOpenRelease: () => void;
}

const SHORTCUTS = [
  { keys: 'Ctrl + N', desc: 'Add new download' },
  { keys: 'Ctrl + V', desc: 'Paste URL / magnet link from clipboard' },
  { keys: 'Ctrl + F', desc: 'Focus search box' },
  { keys: 'Ctrl + L', desc: 'Open activity logs' },
  { keys: 'Ctrl + ,', desc: 'Open preferences' },
  { keys: 'Space', desc: 'Pause / resume focused download' },
  { keys: 'Delete', desc: 'Remove selected downloads' },
  { keys: 'Alt + ← / →', desc: 'Reorder focused category filter tab' },
];

export function AboutModal({
  open,
  appVersion,
  updateStatus,
  onClose,
  onOpenPrivacy,
  onCheckUpdates,
  onUpdateNow,
  onOpenRelease,
}: AboutModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-modal-title"
    >
      <div className="animate-modal-in w-full max-w-md rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MyLoadLogo className="h-10 w-10 shrink-0" />
            <div>
              <h2 id="about-modal-title" className="text-base font-semibold text-[var(--text-primary)]">
                MyLoad Download Manager v{appVersion}
              </h2>
              <p className="text-[12px] text-[var(--text-secondary)]">
                Open Source (MIT) &middot; HTTP/HTTPS &amp; BitTorrent Download Manager
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close about dialog"
            className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/70 p-3 text-[12.5px]">
          <div className="flex min-w-0 items-center gap-2 text-[var(--text-secondary)]">
            {updateStatus.state === 'checking' && (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-[var(--accent-text)]" />
                <span>Checking GitHub for updates...</span>
              </>
            )}
            {updateStatus.state === 'up-to-date' && (
              <>
                <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
                <span>You have the latest version</span>
              </>
            )}
            {updateStatus.state === 'available' && (
              <span className="font-semibold text-[var(--accent-text)]">
                v{updateStatus.latestVersion} available on GitHub
              </span>
            )}
            {updateStatus.state === 'downloading' && (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-[var(--accent-text)]" />
                <span>Downloading update ({updateStatus.progress ?? 0}%)...</span>
              </>
            )}
            {updateStatus.state === 'downloaded' && (
              <span className="font-semibold text-[var(--success)]">
                v{updateStatus.latestVersion} ready to install
              </span>
            )}
            {updateStatus.state === 'error' && (
              <span className="text-[var(--danger)]">{updateStatus.error || 'Update check failed'}</span>
            )}
            {updateStatus.state === 'idle' && (
              <span>Updates are published on GitHub Releases</span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {(updateStatus.state === 'available' || updateStatus.state === 'downloaded') && (
              <>
                <button
                  type="button"
                  onClick={onOpenRelease}
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-[11.5px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
                >
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  <span>Release</span>
                </button>
                <button
                  type="button"
                  onClick={onUpdateNow}
                  className="inline-flex h-7 items-center gap-1 rounded-lg bg-[var(--accent)] px-2.5 text-[11.5px] font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] cursor-pointer"
                >
                  <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{updateStatus.state === 'downloaded' ? 'Install' : 'Update Now'}</span>
                </button>
              </>
            )}
            {updateStatus.state !== 'available' &&
              updateStatus.state !== 'downloading' &&
              updateStatus.state !== 'downloaded' && (
                <button
                  type="button"
                  disabled={updateStatus.state === 'checking'}
                  onClick={onCheckUpdates}
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 text-[11.5px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className="h-3 w-3" aria-hidden="true" />
                  <span>Check</span>
                </button>
              )}
          </div>
        </div>

        <h3 className="mb-2 text-[11.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Keyboard Shortcuts
        </h3>
        <div className="mb-4 space-y-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/70 p-3 text-[13px]">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center justify-between py-0.5">
              <span className="text-[var(--text-secondary)]">{s.desc}</span>
              <kbd className="rounded border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-2 py-0.5 font-mono text-[11.5px] text-[var(--text-primary)]">
                {s.keys}
              </kbd>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenPrivacy();
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
            >
              <ShieldCheck className="h-4 w-4 text-[var(--accent-text)]" aria-hidden="true" />
              <span>Privacy Policy</span>
            </button>
            <button
              type="button"
              onClick={() => void window.myload.openRepositoryUrl()}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
            >
              <ExternalLink className="h-4 w-4 text-[var(--accent-text)]" aria-hidden="true" />
              <span>GitHub</span>
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-xl bg-[var(--accent)] px-5 text-[13px] font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

