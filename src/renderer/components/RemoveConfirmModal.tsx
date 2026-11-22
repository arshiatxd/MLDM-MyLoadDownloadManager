import { useEffect, useState } from 'react';
import { Trash2, X } from 'lucide-react';

interface RemoveConfirmModalProps {
  open: boolean;
  count: number;
  defaultDeleteFiles: boolean;
  onClose: () => void;
  onConfirm: (deleteFiles: boolean) => void;
}

export function RemoveConfirmModal({
  open,
  count,
  defaultDeleteFiles,
  onClose,
  onConfirm,
}: RemoveConfirmModalProps) {
  const [deleteFiles, setDeleteFiles] = useState(defaultDeleteFiles);

  useEffect(() => {
    if (open) setDeleteFiles(defaultDeleteFiles);
  }, [open, defaultDeleteFiles]);

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
      aria-labelledby="remove-modal-title"
    >
      <div className="animate-modal-in w-full max-w-sm rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[var(--danger)]">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            <h2 id="remove-modal-title" className="text-base font-semibold text-[var(--text-primary)]">
              Remove {count} download{count === 1 ? '' : 's'}?
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cancel removal"
            className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-3 text-[13px] text-[var(--text-secondary)]">
          Selected items will be stopped and removed from the MyLoad queue.
        </p>

        <label className="mb-5 flex cursor-pointer items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/70 p-3 text-[13px] text-[var(--text-primary)]">
          <input
            type="checkbox"
            checked={deleteFiles}
            onChange={(e) => setDeleteFiles(e.target.checked)}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          <span>Also delete downloaded / partial files from disk</span>
        </label>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(deleteFiles)}
            className="h-9 rounded-md bg-[var(--accent)] px-4 text-[13px] font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

