import { useEffect } from 'react';
import { ShieldCheck, X } from 'lucide-react';

interface PrivacyPolicyModalProps {
  open: boolean;
  onClose: () => void;
}

export function PrivacyPolicyModal({ open, onClose }: PrivacyPolicyModalProps) {
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
      aria-labelledby="privacy-modal-title"
    >
      <div className="animate-modal-in flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-3.5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[var(--accent-text)]" aria-hidden="true" />
            <h2 id="privacy-modal-title" className="text-base font-semibold text-[var(--text-primary)]">
              MyLoad Privacy Policy
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close privacy policy"
            className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-[13.5px] leading-relaxed text-[var(--text-secondary)]">
          <section>
            <h3 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">
              1. Local-First &amp; Zero Telemetry
            </h3>
            <p>
              MyLoad operates strictly on your computer. It does not collect analytics, crash telemetry,
              advertising identifiers, or usage statistics, and it never uploads your download history or
              preferences to any external server. Optional GitHub Release update checks query only the
              public <code className="text-[var(--text-primary)]">arshiatxd/MLDM-MyLoadDownloadManager</code>{' '}
              releases endpoint without sending any personal data and can be disabled in Preferences.
            </p>
          </section>

          <section>
            <h3 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">
              2. Data Stored Locally
            </h3>
            <p>
              Download queue metadata, custom themes, application settings, and diagnostic logs are saved
              locally inside your Windows user data folder (<code className="text-[var(--text-primary)]">%APPDATA%\MyLoad</code>).
              You can clear logs or remove downloaded records at any time directly inside the app.
            </p>
          </section>

          <section>
            <h3 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">
              3. Browser Extension &amp; Session Cookies
            </h3>
            <p>
              When you enable the optional browser extension, it communicates exclusively with MyLoad over
              your machine&apos;s local loopback address (<code className="text-[var(--text-primary)]">127.0.0.1</code>)
              using extension-origin verification. For authenticated downloads, site cookies and referrer
              headers are held strictly in memory for the active transfer, automatically stripped on
              cross-host redirects, never logged, and never written to disk.
            </p>
          </section>

          <section>
            <h3 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">
              4. Clipboard &amp; Network Probes
            </h3>
            <p>
              Clipboard Link Recognition inspects clipboard text strictly locally in memory (when enabled
              in Settings) solely to pre-fill the URL box when you manually open Add Download. It never
              opens popups automatically, never logs clipboard contents to disk, and never transmits
              clipboard data over the network. When Gaming / Surfing Mode is enabled while downloads are
              active, MyLoad performs lightweight TCP connect latency checks to public DNS endpoints (
              <code className="text-[var(--text-primary)]">1.1.1.1</code> and{' '}
              <code className="text-[var(--text-primary)]">8.8.8.8</code>) without transmitting any user
              data.
            </p>
          </section>

          <section>
            <h3 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">
              5. BitTorrent Peer Connections
            </h3>
            <p>
              BitTorrent downloads communicate directly with public trackers, DHT nodes, and swarm peers as
              required by the BitTorrent protocol, which makes your IP address visible to peers in the
              same torrent swarm.
            </p>
          </section>

          <section>
            <h3 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">
              6. Multi-Part Scanning &amp; Log Redaction
            </h3>
            <p>
              When Multi-Part File Detection is enabled in Settings, MyLoad only scans sequential
              numbered archive links on the same host and safe scheme as the clicked download. The
              optional browser extension filters candidate links inside your active tab by same-origin
              hostname and archive filename patterns without reading unrelated page content or history.
              URL query tokens and credentials are automatically redacted before diagnostic logs are
              written to disk.
            </p>
          </section>
        </div>

        <div className="flex justify-end border-t border-[var(--border-subtle)] px-5 py-3">
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

