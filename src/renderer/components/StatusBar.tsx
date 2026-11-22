import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Gauge,
  Layers,
  Power,
  ShieldCheck,
} from 'lucide-react';
import { POWER_ACTION_LABELS, formatSpeed } from '../../shared/constants';
import { t, tQueueMode } from '../../shared/i18n';
import type { AppSettings, GlobalStats, QueueMode, SpeedUnit } from '../../shared/types';
import { CustomSelect } from './CustomSelect';

const SPEED_UNIT_OPTIONS: Array<{ value: SpeedUnit; label: string }> = [
  { value: 'KB/s', label: 'KB/s' },
  { value: 'MB/s', label: 'MB/s' },
];

const QUEUE_CYCLE: QueueMode[] = ['parallel', 'sequential', 'parallel-equal'];

interface StatusBarProps {
  stats: GlobalStats;
  settings: AppSettings;
  hasFocusedItem: boolean;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
}

export function StatusBar({
  stats,
  settings,
  hasFocusedItem,
  inspectorOpen,
  onToggleInspector,
  onUpdateSettings,
}: StatusBarProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!popoverOpen) return;
    const handleOutside = (e: MouseEvent) => {
      const target = e.target;
      if (target instanceof Element && target.closest('[data-myload-select-menu="true"]')) {
        return;
      }
      if (popRef.current && !popRef.current.contains(target as Node)) {
        setPopoverOpen(false);
      }
    };
    window.addEventListener('mousedown', handleOutside);
    return () => window.removeEventListener('mousedown', handleOutside);
  }, [popoverOpen]);

  const limitSummary =
    !settings.downloadSpeedLimitEnabled && !settings.uploadSpeedLimitEnabled
      ? t(settings.language, 'noLimit')
      : [
          settings.downloadSpeedLimitEnabled
            ? `↓ ${settings.downloadSpeedLimitValue} ${settings.downloadSpeedLimitUnit}`
            : null,
          settings.uploadSpeedLimitEnabled
            ? `↑ ${settings.uploadSpeedLimitValue} ${settings.uploadSpeedLimitUnit}`
            : null,
        ]
          .filter(Boolean)
          .join(' · ');

  const nextQueueMode =
    QUEUE_CYCLE[(QUEUE_CYCLE.indexOf(settings.queueMode) + 1) % QUEUE_CYCLE.length];

  const nb = stats.networkBalance;
  const gamingLabel = !settings.gamingModeEnabled
    ? 'Gaming / Surfing: Off'
    : nb.active
      ? `${settings.gamingModeProfile === 'gaming' ? 'Gaming' : 'Surfing'}${nb.rttMs !== null ? ` · ${nb.rttMs}ms` : ''}${nb.effectiveDownloadLimit ? ` · ${formatSpeed(nb.effectiveDownloadLimit)}` : ''}`
      : `${settings.gamingModeProfile === 'gaming' ? 'Gaming' : 'Surfing'} Mode Ready`;

  return (
    <footer
      className="relative flex h-10 shrink-0 items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-[12.5px] text-[var(--text-secondary)]"
      aria-label="Download status bar"
    >
      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-3 font-mono text-[12.5px]">
          <span className="inline-flex items-center gap-1 text-[var(--text-primary)]" title="Global download speed">
            <ArrowDown className="h-3.5 w-3.5 text-[var(--accent-text)]" aria-hidden="true" />
            <span>{formatSpeed(stats.totalDownloadSpeed)}</span>
          </span>
          <span className="inline-flex items-center gap-1 text-[var(--text-secondary)]" title="Global upload speed">
            <ArrowUp className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
            <span>{formatSpeed(stats.totalUploadSpeed)}</span>
          </span>
        </div>

        <div className="relative" ref={popRef}>
          <button
            type="button"
            onClick={() => setPopoverOpen((o) => !o)}
            aria-expanded={popoverOpen}
            title="Configure global speed limits"
            className={`inline-flex h-7 items-center gap-1.5 rounded border px-2.5 text-[12px] font-medium transition-colors ${
              settings.downloadSpeedLimitEnabled || settings.uploadSpeedLimitEnabled
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-text)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{limitSummary}</span>
          </button>

          {popoverOpen && (
            <div
              role="dialog"
              aria-label="Quick speed limit settings"
              style={{ transformOrigin: 'bottom left' }}
              className="animate-menu-open absolute bottom-9 left-0 z-40 w-80 rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-surface)] p-3.5 shadow-2xl"
            >
              <div className="mb-2.5 flex items-center justify-between">
                <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                  Speed Limits
                </span>
                {(settings.downloadSpeedLimitEnabled || settings.uploadSpeedLimitEnabled) && (
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateSettings({
                        downloadSpeedLimitEnabled: false,
                        uploadSpeedLimitEnabled: false,
                      })
                    }
                    className="text-[12px] font-medium text-[var(--accent-text)] hover:underline"
                  >
                    Set No Limit
                  </button>
                )}
              </div>

              <div className="space-y-3 text-[13px]">
                <div>
                  <label className="mb-1.5 flex cursor-pointer items-center gap-2 text-[var(--text-primary)]">
                    <input
                      type="checkbox"
                      checked={settings.downloadSpeedLimitEnabled}
                      onChange={(e) =>
                        onUpdateSettings({ downloadSpeedLimitEnabled: e.target.checked })
                      }
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                    <span>Limit Download Speed</span>
                  </label>
                  <div className="flex items-center gap-2 pl-6">
                    <input
                      type="number"
                      min={1}
                      max={1000000}
                      disabled={!settings.downloadSpeedLimitEnabled}
                      value={settings.downloadSpeedLimitValue}
                      onChange={(e) =>
                        onUpdateSettings({
                          downloadSpeedLimitValue: Math.max(1, Number(e.target.value) || 1),
                        })
                      }
                      aria-label="Download speed limit value"
                      className="ml-input h-8 !w-24"
                    />
                    <CustomSelect
                      size="sm"
                      disabled={!settings.downloadSpeedLimitEnabled}
                      value={settings.downloadSpeedLimitUnit}
                      options={SPEED_UNIT_OPTIONS}
                      onChange={(v) =>
                        onUpdateSettings({ downloadSpeedLimitUnit: v })
                      }
                      ariaLabel="Download speed limit unit"
                      className="w-24 shrink-0"
                      buttonClassName="h-8 bg-[var(--bg-elevated)]"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 flex cursor-pointer items-center gap-2 text-[var(--text-primary)]">
                    <input
                      type="checkbox"
                      checked={settings.uploadSpeedLimitEnabled}
                      onChange={(e) =>
                        onUpdateSettings({ uploadSpeedLimitEnabled: e.target.checked })
                      }
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                    <span>Limit Upload Speed (Torrents)</span>
                  </label>
                  <div className="flex items-center gap-2 pl-6">
                    <input
                      type="number"
                      min={1}
                      max={1000000}
                      disabled={!settings.uploadSpeedLimitEnabled}
                      value={settings.uploadSpeedLimitValue}
                      onChange={(e) =>
                        onUpdateSettings({
                          uploadSpeedLimitValue: Math.max(1, Number(e.target.value) || 1),
                        })
                      }
                      aria-label="Upload speed limit value"
                      className="ml-input h-8 !w-24"
                    />
                    <CustomSelect
                      size="sm"
                      disabled={!settings.uploadSpeedLimitEnabled}
                      value={settings.uploadSpeedLimitUnit}
                      options={SPEED_UNIT_OPTIONS}
                      onChange={(v) =>
                        onUpdateSettings({ uploadSpeedLimitUnit: v })
                      }
                      ariaLabel="Upload speed limit unit"
                      className="w-24 shrink-0"
                      buttonClassName="h-8 bg-[var(--bg-elevated)]"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => onUpdateSettings({ gamingModeEnabled: !settings.gamingModeEnabled })}
          title="Balances download bandwidth against live latency & jitter to prevent lag during gaming, streaming, or browsing"
          className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium transition-colors cursor-pointer ${
            settings.gamingModeEnabled
              ? nb.state === 'throttling'
                ? 'border-[var(--warning)] bg-[var(--warning-soft)] text-[var(--warning)]'
                : 'border-[var(--success)] bg-[var(--success-soft)] text-[var(--success)]'
              : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
          }`}
        >
          <Activity className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{gamingLabel}</span>
        </button>

        <button
          type="button"
          onClick={() => onUpdateSettings({ queueMode: nextQueueMode })}
          title="Queue Mode (click to cycle): Parallel = download up to limit at once | Finish → Next = sequential one by one | Equal Speed Split = share bandwidth evenly across active downloads"
          className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium transition-colors cursor-pointer ${
            settings.queueMode !== 'parallel'
              ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-text)]'
              : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
          }`}
        >
          <Layers className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{tQueueMode(settings.language, settings.queueMode)}</span>
        </button>

        {(stats.activeCount > 0 || stats.queuedCount > 0) && (
          <span className="hidden text-[12px] lg:inline">
            {stats.activeCount} active
            {stats.queuedCount > 0 ? ` · ${stats.queuedCount} queued` : ''}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {settings.preventSleepDuringDownload && (
          <span
            className={`inline-flex h-7 items-center gap-1 rounded px-2 text-[12px] ${
              stats.preventSleepActive
                ? 'bg-[var(--success-soft)] font-medium text-[var(--success)]'
                : 'text-[var(--text-muted)]'
            }`}
            title={
              stats.preventSleepActive
                ? 'Sleep prevention is currently blocking system sleep during downloads'
                : 'Sleep prevention enabled (activates automatically during downloads)'
            }
          >
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden md:inline">
              {stats.preventSleepActive ? 'Awake lock active' : 'Sleep guard on'}
            </span>
          </span>
        )}

        {settings.autoPowerAction !== 'off' && (
          <button
            type="button"
            onClick={() => onUpdateSettings({ autoPowerAction: 'off' })}
            title="Click to disarm auto power action"
            className="inline-flex h-7 items-center gap-1 rounded bg-[var(--accent-soft)] px-2.5 text-[12px] font-medium text-[var(--accent-text)] hover:bg-[var(--accent)] hover:text-[var(--accent-contrast)]"
          >
            <Power className="h-3.5 w-3.5" aria-hidden="true" />
            <span>After finish: {POWER_ACTION_LABELS[settings.autoPowerAction]} ✕</span>
          </button>
        )}

        <button
          type="button"
          disabled={!hasFocusedItem}
          onClick={onToggleInspector}
          title={inspectorOpen ? 'Hide Inspector' : 'Show Inspector'}
          className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 text-[12px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
        >
          {inspectorOpen ? (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          <span>{t(settings.language, 'inspector')}</span>
        </button>
      </div>
    </footer>
  );
}

