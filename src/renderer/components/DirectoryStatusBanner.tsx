import { AlertCircle, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { formatBytes } from '../../shared/constants';
import type { DirectoryValidationResult } from '../../shared/types';

interface DirectoryStatusBannerProps {
  validation: DirectoryValidationResult | null;
  checking?: boolean;
  compact?: boolean;
  hideOk?: boolean;
}

export function DirectoryStatusBanner({
  validation,
  checking = false,
  compact = false,
  hideOk = false,
}: DirectoryStatusBannerProps) {
  if (checking && !validation) {
    return (
      <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-[var(--text-muted)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent-text)]" aria-hidden="true" />
        <span>Checking folder permissions &amp; storage space...</span>
      </div>
    );
  }

  if (!validation) return null;

  if (!validation.valid) {
    return (
      <div
        role="alert"
        className={`mt-1.5 flex items-start gap-2 rounded-xl border border-[var(--danger)]/50 bg-[var(--danger-soft)] text-[var(--danger)] ${
          compact ? 'px-2.5 py-1.5 text-[11.5px]' : 'px-3 py-2 text-xs'
        }`}
      >
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="leading-snug font-medium">
          {validation.error || 'Selected folder is not valid or writable.'}
        </span>
      </div>
    );
  }

  if (validation.warning) {
    return (
      <div
        role="status"
        className={`mt-1.5 flex items-start gap-2 rounded-xl border border-[var(--warning)]/45 bg-[var(--warning-soft)] text-[var(--warning)] ${
          compact ? 'px-2.5 py-1.5 text-[11.5px]' : 'px-3 py-2 text-xs'
        }`}
      >
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="leading-snug">{validation.warning}</span>
      </div>
    );
  }

  if (hideOk) return null;

  if (validation.diskSpace) {
    return (
      <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-[var(--text-muted)]">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--success)]" aria-hidden="true" />
        <span>
          Folder writable · Free space:{' '}
          <strong className="text-[var(--text-secondary)]">
            {formatBytes(validation.diskSpace.freeBytes)}
          </strong>
        </span>
      </div>
    );
  }

  return null;
}

