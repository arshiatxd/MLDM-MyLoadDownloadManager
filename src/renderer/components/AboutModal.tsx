import { useEffect } from 'react';
import { ExternalLink, ShieldCheck, X } from 'lucide-react';

interface AboutModalProps {
  open: boolean;
  onClose: () => void;
  onOpenPrivacy: () => void;
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

export function AboutModal({ open, onClose, onOpenPrivacy }: AboutModalProps) {
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
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-lg"
              style={{
                background: 'linear-gradient(135deg, #e12d4f 0%, #c81e3d 55%, #8d1028 100%)',
              }}
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" className="h-4.5 w-4.5 text-white" fill="none">
                <path
                  d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19h14"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div>
              <h2 id="about-modal-title" className="text-base font-semibold text-[var(--text-primary)]">
                MyLoad v1.0.0
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
            className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <X className="h-4 w-4" />
          </button>
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

