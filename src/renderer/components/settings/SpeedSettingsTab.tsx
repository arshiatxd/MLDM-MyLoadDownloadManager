import { Activity } from 'lucide-react';
import type {
  AppSettings,
  GamingModeProfile,
  QueueMode,
  SpeedUnit,
} from '../../../shared/types';
import { CustomSelect } from '../CustomSelect';

const SPEED_UNIT_OPTIONS: Array<{ value: SpeedUnit; label: string }> = [
  { value: 'KB/s', label: 'KB/s' },
  { value: 'MB/s', label: 'MB/s' },
];

interface SpeedSettingsTabProps {
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
}

export function SpeedSettingsTab({ settings, onUpdate }: SpeedSettingsTabProps) {
  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
          <Activity className="h-4 w-4 text-[var(--accent-text)]" aria-hidden="true" />
          <span>Gaming / Surfing Mode (Lag &amp; Packet-Loss Protection)</span>
        </h3>
        <div className="space-y-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/60 p-3.5">
          <label className="flex cursor-pointer items-center gap-2 font-medium text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={settings.gamingModeEnabled}
              onChange={(e) => onUpdate({ gamingModeEnabled: e.target.checked })}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            <span>
              Automatically balance download bandwidth to prevent lag, jitter, and packet loss
            </span>
          </label>
          <p className="text-[12px] text-[var(--text-secondary)]">
            Continuously measures latency while downloading and dynamically adjusts segment
            concurrency and transfer rate so games, streams, and web browsing stay responsive.
          </p>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {(
              [
                {
                  id: 'surfing' as GamingModeProfile,
                  title: 'Surfing & Streaming (Balanced)',
                  desc: 'Keeps speeds high (up to 4 segments) while protecting video streams & browsing.',
                },
                {
                  id: 'gaming' as GamingModeProfile,
                  title: 'Gaming (Low Latency)',
                  desc: 'Strict ping & jitter guard (max 2 segments, tight upload cap) for zero lag spikes.',
                },
              ]
            ).map((prof) => {
              const active = settings.gamingModeProfile === prof.id;
              return (
                <button
                  key={prof.id}
                  type="button"
                  onClick={() => onUpdate({ gamingModeProfile: prof.id })}
                  className={`rounded-xl border p-3 text-left transition-colors cursor-pointer ${
                    active
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  <div className="font-semibold text-[var(--text-primary)]">{prof.title}</div>
                  <div className="mt-0.5 text-[12px] text-[var(--text-secondary)]">{prof.desc}</div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border-subtle)] pt-4">
        <h3 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">
          Multi-Download Queue Mode
        </h3>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {(
            [
              {
                id: 'parallel' as QueueMode,
                title: 'Parallel (Default)',
                desc: 'Run up to your max concurrent downloads simultaneously at full speed.',
              },
              {
                id: 'sequential' as QueueMode,
                title: 'Finish → Download Next',
                desc: 'Download one file at a time; automatically start the next queued file when finished.',
              },
              {
                id: 'parallel-equal' as QueueMode,
                title: 'Equal Speed Split',
                desc: 'Run multiple downloads concurrently while dividing bandwidth evenly across active files.',
              },
            ]
          ).map((mode) => {
            const active = settings.queueMode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => onUpdate({ queueMode: mode.id })}
                className={`rounded-xl border p-3 text-left transition-colors cursor-pointer ${
                  active
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                <div className="font-semibold text-[var(--text-primary)]">{mode.title}</div>
                <div className="mt-0.5 text-[12px] text-[var(--text-secondary)]">{mode.desc}</div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="border-t border-[var(--border-subtle)] pt-4">
        <h3 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">
          Global Speed Limits
        </h3>
        <div className="space-y-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/60 p-3.5">
          <div>
            <label className="mb-1.5 flex cursor-pointer items-center gap-2 font-medium text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={settings.downloadSpeedLimitEnabled}
                onChange={(e) => onUpdate({ downloadSpeedLimitEnabled: e.target.checked })}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              <span>Cap download speed (unchecked = Unlimited)</span>
            </label>
            <div className="flex items-center gap-2 pl-6">
              <input
                type="number"
                min={1}
                disabled={!settings.downloadSpeedLimitEnabled}
                value={settings.downloadSpeedLimitValue}
                onChange={(e) =>
                  onUpdate({
                    downloadSpeedLimitValue: Math.max(1, Number(e.target.value) || 1),
                  })
                }
                className="ml-input h-8 !w-28 bg-[var(--bg-surface)]"
              />
              <CustomSelect
                size="sm"
                disabled={!settings.downloadSpeedLimitEnabled}
                value={settings.downloadSpeedLimitUnit}
                options={SPEED_UNIT_OPTIONS}
                onChange={(v) => onUpdate({ downloadSpeedLimitUnit: v })}
                ariaLabel="Download speed limit unit"
                className="w-24 shrink-0"
                buttonClassName="h-8 bg-[var(--bg-surface)]"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 flex cursor-pointer items-center gap-2 font-medium text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={settings.uploadSpeedLimitEnabled}
                onChange={(e) => onUpdate({ uploadSpeedLimitEnabled: e.target.checked })}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              <span>Cap upload speed for torrents (unchecked = Unlimited)</span>
            </label>
            <div className="flex items-center gap-2 pl-6">
              <input
                type="number"
                min={1}
                disabled={!settings.uploadSpeedLimitEnabled}
                value={settings.uploadSpeedLimitValue}
                onChange={(e) =>
                  onUpdate({
                    uploadSpeedLimitValue: Math.max(1, Number(e.target.value) || 1),
                  })
                }
                className="ml-input h-8 !w-28 bg-[var(--bg-surface)]"
              />
              <CustomSelect
                size="sm"
                disabled={!settings.uploadSpeedLimitEnabled}
                value={settings.uploadSpeedLimitUnit}
                options={SPEED_UNIT_OPTIONS}
                onChange={(v) => onUpdate({ uploadSpeedLimitUnit: v })}
                ariaLabel="Upload speed limit unit"
                className="w-24 shrink-0"
                buttonClassName="h-8 bg-[var(--bg-surface)]"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border-subtle)] pt-4">
        <h3 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">
          Concurrency &amp; Connections
        </h3>
        <div className="space-y-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/60 p-3.5">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="settings-max-concurrent"
                className="font-medium text-[var(--text-primary)]"
              >
                Simultaneous downloads
              </label>
              <span className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-0.5 font-mono text-[11.5px] font-semibold text-[var(--text-primary)]">
                {settings.queueMode === 'sequential'
                  ? '1 (Sequential)'
                  : settings.maxConcurrentDownloads}
              </span>
            </div>
            <input
              id="settings-max-concurrent"
              type="range"
              min={1}
              max={10}
              step={1}
              disabled={settings.queueMode === 'sequential'}
              value={
                settings.queueMode === 'sequential' ? 1 : settings.maxConcurrentDownloads
              }
              onChange={(e) =>
                onUpdate({
                  maxConcurrentDownloads: Math.min(10, Math.max(1, Number(e.target.value) || 1)),
                })
              }
              aria-label="Simultaneous downloads"
              className="w-full cursor-pointer accent-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-45"
            />
            <div className="flex justify-between font-mono text-[11px] text-[var(--text-muted)]">
              <span>1</span>
              <span>5</span>
              <span>10</span>
            </div>
            {settings.queueMode === 'sequential' && (
              <p className="text-[12px] text-[var(--text-muted)]">
                Sequential mode runs 1 file at a time.
              </p>
            )}
          </div>

          <div className="space-y-1.5 border-t border-[var(--border-subtle)] pt-3.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="settings-http-threads"
                className="font-medium text-[var(--text-primary)]"
              >
                Threads per download
              </label>
              <span className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-0.5 font-mono text-[11.5px] font-semibold text-[var(--text-primary)]">
                {settings.httpConnections}
              </span>
            </div>
            <input
              id="settings-http-threads"
              type="range"
              min={1}
              max={32}
              step={1}
              value={settings.httpConnections}
              onChange={(e) =>
                onUpdate({
                  httpConnections: Math.min(32, Math.max(1, Number(e.target.value) || 1)),
                })
              }
              aria-label="Threads per download"
              className="w-full cursor-pointer accent-[var(--accent)]"
            />
            <div className="flex justify-between font-mono text-[11px] text-[var(--text-muted)]">
              <span>1</span>
              <span>16</span>
              <span>32</span>
            </div>
            <p className="text-[12px] text-[var(--text-secondary)]">
              Parallel HTTP connections per file (configured in Settings only).
              {settings.gamingModeEnabled
                ? ' Gaming / Surfing Mode is active and dynamically caps active threads to protect latency.'
                : ''}
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-3">
            <label
              htmlFor="settings-auto-retries"
              className="text-[var(--text-secondary)]"
            >
              Auto-retries on network error
            </label>
            <input
              id="settings-auto-retries"
              type="number"
              min={0}
              max={10}
              value={settings.maxRetries}
              onChange={(e) =>
                onUpdate({
                  maxRetries: Math.min(10, Math.max(0, Number(e.target.value) || 0)),
                })
              }
              className="ml-input h-8 !w-24 bg-[var(--bg-surface)]"
            />
          </div>
        </div>
      </section>
    </div>
  );
}

