import { useEffect, useState } from 'react';
import {
  Archive,
  File,
  FileText,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Magnet,
  X,
} from 'lucide-react';
import { FILE_CATEGORY_META } from '../../../shared/constants';
import type { DirectoryValidationResult, FileCategory } from '../../../shared/types';

function CategoryIcon({ category }: { category: FileCategory }) {
  const cls = 'h-4 w-4 shrink-0 text-[var(--accent-text)]';
  switch (category) {
    case 'videos':
      return <Film className={cls} aria-hidden="true" />;
    case 'images':
      return <ImageIcon className={cls} aria-hidden="true" />;
    case 'docs':
      return <FileText className={cls} aria-hidden="true" />;
    case 'archives':
      return <Archive className={cls} aria-hidden="true" />;
    case 'torrents':
      return <Magnet className={cls} aria-hidden="true" />;
    default:
      return <File className={cls} aria-hidden="true" />;
  }
}

interface CategoryDirectoryRowProps {
  category: FileCategory;
  value: string;
  defaultDownloadDir: string;
  onChange: (nextPath: string) => void;
}

export function CategoryDirectoryRow({
  category,
  value,
  defaultDownloadDir,
  onChange,
}: CategoryDirectoryRowProps) {
  const meta = FILE_CATEGORY_META[category];
  const [validation, setValidation] = useState<DirectoryValidationResult | null>(null);

  useEffect(() => {
    const trimmed = value.trim();
    if (!trimmed) {
      setValidation(null);
      return;
    }
    let canceled = false;
    const timer = setTimeout(() => {
      void window.myload
        .validateDirectory(trimmed)
        .then((res) => {
          if (!canceled) setValidation(res);
        })
        .catch(() => {
          if (!canceled) setValidation(null);
        });
    }, 200);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [value]);

  const browse = async () => {
    const picked = await window.myload.selectFolder(value.trim() || defaultDownloadDir);
    if (picked) onChange(picked);
  };

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]/70 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <CategoryIcon category={category} />
          <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">
            {meta.label}
          </span>
          <span className="truncate text-[11.5px] text-[var(--text-muted)]">
            ({meta.extensionsHint})
          </span>
        </div>

        <div className="flex w-full items-center gap-1.5 sm:mt-0">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={`Default (${defaultDownloadDir})`}
            aria-label={`${meta.label} download folder`}
            className="ml-input h-8 flex-1 text-[12px]"
          />
          {value.trim().length > 0 && (
            <button
              type="button"
              onClick={() => onChange('')}
              title="Reset to default folder"
              aria-label={`Reset ${meta.label} folder`}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => void browse()}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 text-[12px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
          >
            <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Browse</span>
          </button>
        </div>
      </div>

      {validation && !validation.valid && validation.error && (
        <div className="mt-1.5 text-[11.5px] text-[var(--danger)]">{validation.error}</div>
      )}
      {validation && validation.valid && validation.warning && (
        <div className="mt-1.5 text-[11.5px] text-[var(--warning)]">{validation.warning}</div>
      )}
    </div>
  );
}

