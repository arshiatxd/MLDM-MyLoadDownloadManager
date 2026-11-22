import { Power } from 'lucide-react';
import { POWER_ACTION_LABELS } from '../../shared/constants';
import type { ShutdownCountdownState } from '../../shared/types';

interface ShutdownCountdownModalProps {
  state: ShutdownCountdownState | null;
  onCancel: () => void;
  onExecuteNow: () => void;
}

export function ShutdownCountdownModal({
  state,
  onCancel,
  onExecuteNow,
}: ShutdownCountdownModalProps) {
  if (!state || !state.active) return null;

  const pct = Math.max(0, Math.min(100, (state.remainingSeconds / state.totalSeconds) * 100));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="power-countdown-title"
    >
      <div className="animate-modal-in w-full max-w-md rounded-xl border border-[var(--accent)] bg-[var(--bg-surface)] p-6 shadow-2xl">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-text)]">
            <Power className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 id="power-countdown-title" className="text-base font-semibold text-[var(--text-primary)]">
              All downloads finished
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              Scheduled action: <strong className="text-[var(--accent-text)]">{POWER_ACTION_LABELS[state.action]}</strong>
            </p>
          </div>
        </div>

        <p className="mb-3 text-sm text-[var(--text-primary)]">
          Executing in <strong className="font-mono text-[var(--accent-text)]">{state.remainingSeconds}s</strong>...
        </p>

        <div className="mb-5 h-2 w-full overflow-hidden rounded-full bg-[var(--bg-elevated)]">
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onExecuteNow}
            className="h-9 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            Run Now
          </button>
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className="h-9 rounded-md bg-[var(--accent)] px-5 text-xs font-semibold text-white hover:bg-[var(--accent-hover)]"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

