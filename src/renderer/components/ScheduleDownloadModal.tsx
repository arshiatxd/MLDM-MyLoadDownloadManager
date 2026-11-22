import { useEffect, useState } from 'react';
import { Clock, X } from 'lucide-react';
import {
  formatTimestampToTimeInput,
  getDefaultScheduleTimeString,
} from '../../shared/constants';
import type { DownloadItem, DownloadSchedule } from '../../shared/types';
import {
  ScheduleControlsCard,
  type ScheduleControlsValue,
  buildScheduleFromControls,
  createInitialScheduleControls,
} from './ScheduleControlsCard';

interface ScheduleDownloadModalProps {
  item: DownloadItem | null;
  onClose: () => void;
  onSave: (id: string, schedule: DownloadSchedule | null) => Promise<void>;
}

export function ScheduleDownloadModal({
  item,
  onClose,
  onSave,
}: ScheduleDownloadModalProps) {
  const [value, setValue] = useState<ScheduleControlsValue>(() =>
    createInitialScheduleControls()
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!item) return;
    const now = Date.now();
    const hasFutureStart = Boolean(item.schedule?.startAt && item.schedule.startAt > now);
    const hasFutureStop = Boolean(item.schedule?.stopAt && item.schedule.stopAt > now);
    setValue({
      startMode: hasFutureStart ? 'specific' : 'now',
      startTime: hasFutureStart
        ? formatTimestampToTimeInput(item.schedule?.startAt)
        : getDefaultScheduleTimeString(1, now),
      stopEnabled: hasFutureStop,
      stopTime: hasFutureStop
        ? formatTimestampToTimeInput(item.schedule?.stopAt)
        : getDefaultScheduleTimeString(2, now),
    });
    setSaving(false);
  }, [item]);

  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onClose]);

  if (!item) return null;

  const built = buildScheduleFromControls(value);
  const hasExisting = Boolean(item.schedule?.startAt || item.schedule?.stopAt);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(item.id, built ?? null);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      await onSave(item.id, null);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="schedule-modal-title"
    >
      <div className="animate-modal-in w-full max-w-md overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-[var(--accent-text)]" aria-hidden="true" />
            <h2 id="schedule-modal-title" className="text-base font-semibold text-[var(--text-primary)]">
              Schedule Download
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close schedule dialog"
            className="rounded-lg p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4 text-[13px]">
          <div className="truncate font-medium text-[var(--text-primary)]" title={item.name}>
            {item.name}
          </div>

          <ScheduleControlsCard value={value} onChange={setValue} />
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 px-5 py-3">
          <div>
            {hasExisting && (
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleClear()}
                className="h-9 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 text-xs font-medium text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-45 cursor-pointer"
              >
                Clear schedule
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="h-9 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="h-9 rounded-xl bg-[var(--accent)] px-4 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-45 cursor-pointer"
            >
              {saving ? 'Saving...' : 'Save schedule'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

