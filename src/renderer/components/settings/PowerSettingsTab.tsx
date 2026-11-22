import { POWER_ACTION_LABELS } from '../../../shared/constants';
import type { AppSettings, PowerAction } from '../../../shared/types';
import { CustomSelect } from '../CustomSelect';

const POWER_ACTION_OPTIONS: Array<{ value: PowerAction; label: string }> = (
  Object.keys(POWER_ACTION_LABELS) as PowerAction[]
).map((k) => ({ value: k, label: POWER_ACTION_LABELS[k] }));

interface PowerSettingsTabProps {
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
}

export function PowerSettingsTab({ settings, onUpdate }: PowerSettingsTabProps) {
  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">
          Sleep &amp; Auto-Shutdown
        </h3>
        <div className="space-y-3">
          <label className="flex cursor-pointer items-center gap-2 text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={settings.preventSleepDuringDownload}
              onChange={(e) => onUpdate({ preventSleepDuringDownload: e.target.checked })}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            <span>Prevent computer sleep while downloads are active</span>
          </label>

          <div>
            <label className="mb-1 block text-[var(--text-secondary)]">
              When all downloads finish (60s cancelable countdown; auto-resets to Off)
            </label>
            <CustomSelect
              value={settings.autoPowerAction}
              options={POWER_ACTION_OPTIONS}
              onChange={(v) => onUpdate({ autoPowerAction: v })}
              ariaLabel="Auto power action when downloads finish"
              className="w-full max-w-xs"
            />
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border-subtle)] pt-4">
        <h3 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">
          App Lifecycle &amp; BitTorrent Seeding
        </h3>
        <div className="space-y-2.5">
          <label className="flex cursor-pointer items-center gap-2 text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={settings.minimizeToTray}
              onChange={(e) => onUpdate({ minimizeToTray: e.target.checked })}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            <span>Minimize to Windows system tray on close</span>
          </label>

          <label className="flex cursor-pointer items-center gap-2 text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={settings.autoResumeOnStart}
              onChange={(e) => onUpdate({ autoResumeOnStart: e.target.checked })}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            <span>Auto-resume incomplete downloads when MyLoad launches</span>
          </label>

          <label className="flex cursor-pointer items-center gap-2 text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={settings.keepSeedingAfterComplete}
              onChange={(e) => onUpdate({ keepSeedingAfterComplete: e.target.checked })}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            <span>Keep seeding torrents after reaching 100%</span>
          </label>
        </div>
      </section>
    </div>
  );
}

