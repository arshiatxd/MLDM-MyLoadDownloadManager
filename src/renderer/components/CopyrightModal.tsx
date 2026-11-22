import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Mail, X } from 'lucide-react';
import { MyLoadLogo } from './MyLoadLogo';

interface CopyrightModalProps {
  open: boolean;
  appVersion: string;
  onClose: () => void;
}

const CONTACT_EMAIL = 'arshiyatxd@gmail.com';
const GITHUB_PROFILE = 'https://github.com/arshiatxd';
const GITHUB_REPO = 'https://github.com/arshiatxd/MLDM-MyLoadDownloadManager';

export function CopyrightModal({
  open,
  appVersion,
  onClose,
}: CopyrightModalProps) {
  const [copiedEmail, setCopiedEmail] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCopiedEmail(false);
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
      aria-labelledby="copyright-modal-title"
    >
      <div className="animate-modal-in w-full max-w-md rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
          <div className="flex items-center gap-3">
            <MyLoadLogo className="h-11 w-11 shrink-0" />
            <div>
              <h2
                id="copyright-modal-title"
                className="text-base font-semibold text-[var(--text-primary)]"
              >
                MyLoad Download Manager
              </h2>
              <p className="text-[12px] text-[var(--text-secondary)]">
                Version {appVersion} · Created by <span className="font-medium text-[var(--text-primary)]">arshiatxd</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close copyright dialog"
            className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/70 p-3 text-[12.5px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--text-secondary)]">Developer Contact:</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void window.myload.openExternalLink('email')}
                className="inline-flex items-center gap-1 font-medium text-[var(--accent-text)] hover:underline cursor-pointer"
              >
                <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{CONTACT_EMAIL}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(CONTACT_EMAIL);
                  setCopiedEmail(true);
                  setTimeout(() => setCopiedEmail(false), 1600);
                }}
                title="Copy email address"
                aria-label="Copy email address"
                className="inline-flex h-6 w-6 items-center justify-center rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                {copiedEmail ? (
                  <Check className="h-3 w-3 text-[var(--success)]" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--text-secondary)]">GitHub Profile:</span>
            <button
              type="button"
              onClick={() => void window.myload.openExternalLink('profile')}
              className="inline-flex items-center gap-1 truncate font-medium text-[var(--accent-text)] hover:underline cursor-pointer"
            >
              <span>{GITHUB_PROFILE}</span>
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
            </button>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--text-secondary)]">GitHub Repository:</span>
            <button
              type="button"
              onClick={() => void window.myload.openExternalLink('repo')}
              className="inline-flex items-center gap-1 truncate font-medium text-[var(--accent-text)] hover:underline cursor-pointer"
            >
              <span className="truncate">{GITHUB_REPO}</span>
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="mb-4 max-h-24 overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/50 p-3 text-[11.5px] leading-relaxed text-[var(--text-secondary)]">
          This software is published as open-source software under the MIT License.
          You may use, modify, and redistribute it in accordance with the repository LICENSE,
          provided this copyright and attribution notice is preserved in all copies or
          substantial portions of the software.
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-[11.5px] text-[var(--text-secondary)]">
            Copyright © 2026 arshiatxd. All rights reserved.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

