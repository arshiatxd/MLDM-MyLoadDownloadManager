import { Clock } from 'lucide-react';
import {
  formatScheduleSummary,
  getDefaultScheduleTimeString,
  resolveScheduledTimestamp,
} from '../../shared/constants';
import type { DownloadSchedule } from '../../shared/types';

export interface ScheduleControlsValue {
  startMode: 'now' | 'specific';
  startTime: string;
  stopEnabled: boolean;
  stopTime: string;
}

export function createInitialScheduleControls(now = Date.now()): ScheduleControlsValue {
  return {
    startMode: 'now',
    startTime: getDefaultScheduleTimeString(1, now),
    stopEnabled: false,
    stopTime: getDefaultScheduleTimeString(2, now),
  };
}

export function buildScheduleFromControls(
  val: ScheduleControlsValue,
  now = Date.now()
): DownloadSchedule | undefined {
  const startAt =
    val.startMode === 'specific'
      ? resolveScheduledTimestamp(val.startTime, now)
      : null;
  const stopAt = val.stopEnabled
    ? resolveScheduledTimestamp(val.stopTime, now, startAt ?? now)
    : null;
  if (!startAt && !stopAt) return undefined;
  return {
    ...(startAt ? { startAt } : {}),
    ...(stopAt ? { stopAt } : {}),
  };
}

interface ScheduleControlsCardProps {
  value: ScheduleControlsValue;
  onChange: (next: ScheduleControlsValue) => void;
  compact?: boolean;
}

export function ScheduleControlsCard({
  value,
  onChange,
  compact = false,
}: ScheduleControlsCardProps) {
  const built = buildScheduleFromControls(value);
  const summary = formatScheduleSummary(built);

  return (
    <div
      className={`rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/65 ${
        compact ? 'p-2.5 text-xs' : 'p-3 text-[12.5px]'
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-medium text-[var(--text-primary)]">
          <Clock className="h-3.5 w-3.5 text-[var(--accent-text)]" aria-hidden="true" />
          <span>Schedule</span>
        </div>
        {summary && (
          <span className="truncate text-[11px] font-medium text-[var(--accent-text)]">
            {summary}
          </span>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[var(--text-secondary)]">Start time</span>
          <div className="flex items-center gap-1.5">
            <div className="inline-flex rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-0.5">
              <button
                type="button"
                onClick={() => onChange({ ...value, startMode: 'now' })}
                className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors cursor-pointer ${
                  value.startMode === 'now'
                    ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                Now
              </button>
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...value,
                    startMode: 'specific',
                    startTime: value.startTime || getDefaultScheduleTimeString(1),
                  })
                }
                className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors cursor-pointer ${
                  value.startMode === 'specific'
                    ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                Specific time
              </button>
            </div>

            {value.startMode === 'specific' && (
              <input
                type="time"
                value={value.startTime}
                onChange={(e) => onChange({ ...value, startTime: e.target.value })}
                aria-label="Start download time"
                className="ml-input h-7 w-auto px-2 text-xs"
              />
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={value.stopEnabled}
              onChange={(e) =>
                onChange({
                  ...value,
                  stopEnabled: e.target.checked,
                  stopTime: value.stopTime || getDefaultScheduleTimeString(2),
                })
              }
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            <span>Stop downloading at</span>
          </label>

          {value.stopEnabled && (
            <input
              type="time"
              value={value.stopTime}
              onChange={(e) => onChange({ ...value, stopTime: e.target.value })}
              aria-label="Stop download time"
              className="ml-input h-7 w-auto px-2 text-xs"
            />
          )}
        </div>
      </div>
    </div>
  );
}

