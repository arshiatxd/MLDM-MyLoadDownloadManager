import { useEffect, useState } from 'react';
import { Copy, Minus, Square, X } from 'lucide-react';
import { formatSpeed } from '../../shared/constants';
import type { GlobalStats } from '../../shared/types';

interface TitleBarProps {
  stats: GlobalStats;
}

export function TitleBar({ stats }: TitleBarProps) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    void window.myload.isWindowMaximized().then(setMaximized);
    return window.myload.onWindowMaximizedChange(setMaximized);
  }, []);

  return (
    <header
      className="app-drag flex h-10 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 select-none"
      aria-label="Application title bar"
    >
      <div className="flex items-center gap-2.5">
        <div
          className="flex h-6 w-6 items-center justify-center rounded-md shadow-sm"
          style={{
            background: 'linear-gradient(135deg, #e12d4f 0%, #c81e3d 55%, #8d1028 100%)',
          }}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-white" fill="none">
            <path
              d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19h14"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <h1 className="m-0 text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">
          MyLoad
        </h1>

        {stats.activeCount > 0 && (
          <span className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 text-[12px] font-medium text-[var(--accent-text)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" aria-hidden="true" />
            {stats.activeCount} active · ↓ {formatSpeed(stats.totalDownloadSpeed)}
          </span>
        )}
      </div>

      <div className="app-no-drag flex items-center">
        <button
          type="button"
          onClick={() => void window.myload.minimizeWindow()}
          className="flex h-8 w-10 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          aria-label="Minimize window"
          title="Minimize"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => void window.myload.maximizeWindow()}
          className="flex h-8 w-10 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          aria-label={maximized ? 'Restore window' : 'Maximize window'}
          title={maximized ? 'Restore' : 'Maximize'}
        >
          {maximized ? <Copy className="h-3 w-3" /> : <Square className="h-3 w-3" />}
        </button>
        <button
          type="button"
          onClick={() => void window.myload.closeWindow()}
          className="flex h-8 w-10 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--accent)] hover:text-white"
          aria-label="Close window"
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

