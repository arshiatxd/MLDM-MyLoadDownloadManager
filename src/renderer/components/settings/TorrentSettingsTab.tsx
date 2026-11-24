import { Magnet, Shield } from 'lucide-react';
import type { AppSettings } from '../../../shared/types';

interface TorrentSettingsTabProps {
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
}

export function TorrentSettingsTab({ settings, onUpdate }: TorrentSettingsTabProps) {
  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
          <Magnet className="h-4 w-4 text-[var(--accent-text)]" aria-hidden="true" />
          <span>BitTorrent Settings</span>
        </h3>
        <div className="space-y-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/60 p-3.5">
          <div>
            <label className="flex cursor-pointer items-center gap-2 font-medium text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={settings.torrentAnonymousMode}
                onChange={(e) => onUpdate({ torrentAnonymousMode: e.target.checked })}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              <Shield
                className={`h-4 w-4 shrink-0 ${
                  settings.torrentAnonymousMode
                    ? 'text-[var(--success)]'
                    : 'text-[var(--text-secondary)]'
                }`}
                aria-hidden="true"
              />
              <span>Enable Anonymous Download Mode by default</span>
            </label>
            <p className="mt-0.5 pl-6 text-[12px] text-[var(--text-secondary)]">
              Uses an isolated torrent session with randomized Peer ID &amp; DHT node ID,
              hidden client version &amp; User-Agent, PE/MSE encryption, disabled LAN/UPnP/WebSeed
              leaks, and automatic stop at 100%.
            </p>
          </div>

          <div className="border-t border-[var(--border-subtle)] pt-3">
            <label className="flex cursor-pointer items-center gap-2 font-medium text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={settings.keepSeedingAfterComplete}
                onChange={(e) => onUpdate({ keepSeedingAfterComplete: e.target.checked })}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              <span>Keep seeding torrents after download completes</span>
            </label>
            <p className="mt-0.5 pl-6 text-[12px] text-[var(--text-secondary)]">
              Continues uploading to peers after reaching 100% (automatically disabled whenever
              Anonymous Download Mode is active for a torrent).
            </p>
          </div>

          <div className="border-t border-[var(--border-subtle)] pt-3">
            <label className="flex cursor-pointer items-center gap-2 font-medium text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={settings.torrentSequentialDownload}
                onChange={(e) => onUpdate({ torrentSequentialDownload: e.target.checked })}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              <span>Sequential download (download pieces in order)</span>
            </label>
            <p className="mt-0.5 pl-6 text-[12px] text-[var(--text-secondary)]">
              Downloads torrent pieces sequentially from start to finish instead of rarest-first,
              making media files playable sooner while downloading.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
