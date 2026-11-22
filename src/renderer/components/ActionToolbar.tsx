import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownUp,
  ChevronRight,
  ClipboardPaste,
  Download,
  FileUp,
  Info,
  LogOut,
  Menu,
  Pause,
  PauseCircle,
  Play,
  Power,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { POWER_ACTION_LABELS } from '../../shared/constants';
import { t } from '../../shared/i18n';
import type { AppLanguage, PowerAction, SortBy } from '../../shared/types';
import { CustomSelect } from './CustomSelect';

interface ActionToolbarProps {
  lang: AppLanguage;
  sortBy: SortBy;
  onSortChange: (sort: SortBy) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  selectedCount: number;
  canResumeSelected: boolean;
  canPauseSelected: boolean;
  hasActiveOrQueued: boolean;
  errorLogCount: number;
  autoPowerAction: PowerAction;
  updateAvailable?: boolean;
  onAddClick: () => void;
  onResumeSelected: () => void;
  onPauseSelected: () => void;
  onPauseAll: () => void;
  onRemoveSelected: () => void;
  onOpenLogs: () => void;
  onOpenSettings: () => void;
  onPasteClipboard: () => void;
  onImportUrlsFile: () => void;
  onExportDownloads: () => void;
  onPowerActionChange: (action: PowerAction) => void;
  onResetFilterOrder: () => void;
  onCheckUpdates: () => void;
  onOpenPrivacy: () => void;
  onOpenAbout: () => void;
  onQuitApp: () => void;
}

const SORT_OPTIONS: Array<{ value: SortBy; label: string }> = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'size', label: 'Size' },
  { value: 'progress', label: 'Progress' },
  { value: 'status', label: 'Status' },
];

const POWER_OPTIONS: PowerAction[] = ['off', 'shutdown', 'sleep', 'hibernate', 'exit'];

export function ActionToolbar(props: ActionToolbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [powerSubOpen, setPowerSubOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setPowerSubOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        setPowerSubOpen(false);
      }
    };
    window.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleKey);
    };
  }, [menuOpen]);

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2"
      role="toolbar"
      aria-label="Download actions"
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={props.onAddClick}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3.5 text-[13px] font-semibold text-[var(--accent-contrast)] shadow-sm transition-colors hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] cursor-pointer"
          title={`${t(props.lang, 'addDownload')} (Ctrl+N)`}
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          <span>{t(props.lang, 'addDownload')}</span>
        </button>

        <div
          className="flex items-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-0.5"
          role="group"
          aria-label="Queue controls"
        >
          <button
            type="button"
            onClick={props.onResumeSelected}
            disabled={!props.canResumeSelected}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
            title={t(props.lang, 'resume')}
          >
            <Play className="h-3.5 w-3.5 text-[var(--accent-text)]" aria-hidden="true" />
            <span className="hidden xl:inline">{t(props.lang, 'resume')}</span>
          </button>

          <button
            type="button"
            onClick={props.onPauseSelected}
            disabled={!props.canPauseSelected}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
            title={t(props.lang, 'pause')}
          >
            <Pause className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden xl:inline">{t(props.lang, 'pause')}</span>
          </button>

          <button
            type="button"
            onClick={props.onPauseAll}
            disabled={!props.hasActiveOrQueued}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
            title={t(props.lang, 'pauseAll')}
          >
            <PauseCircle className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden lg:inline">{t(props.lang, 'pauseAll')}</span>
          </button>

          <div className="mx-0.5 h-4 w-px bg-[var(--border-subtle)]" aria-hidden="true" />

          <button
            type="button"
            onClick={props.onRemoveSelected}
            disabled={props.selectedCount === 0}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
            title={`${t(props.lang, 'remove')} (Delete)`}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden xl:inline">{t(props.lang, 'remove')}</span>
          </button>
        </div>

        <CustomSelect
          value={props.sortBy}
          options={SORT_OPTIONS}
          onChange={props.onSortChange}
          ariaLabel="Sort downloads"
          className="w-40"
          hoverOnlyBorder
          buttonClassName="h-9 bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)]"
          leadingIcon={<ArrowDownUp className="h-3.5 w-3.5" aria-hidden="true" />}
        />
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex items-center">
          <Search
            className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          <input
            ref={props.searchInputRef}
            type="text"
            value={props.searchQuery}
            onChange={(e) => props.onSearchChange(e.target.value)}
            placeholder={t(props.lang, 'searchPlaceholder')}
            aria-label={t(props.lang, 'searchPlaceholder')}
            className="h-9 w-48 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] pl-8 pr-7 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] focus:border-[var(--accent)] focus:outline-none sm:w-60"
          />
          {props.searchQuery && (
            <button
              type="button"
              onClick={() => props.onSearchChange('')}
              aria-label="Clear search"
              className="absolute right-2 rounded-md p-0.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={props.onOpenLogs}
          className="relative inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-[12.5px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] cursor-pointer"
          title={`${t(props.lang, 'logs')} (Ctrl+L)`}
          aria-label={t(props.lang, 'logs')}
        >
          <ScrollText className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
          <span className="hidden md:inline">{t(props.lang, 'logs')}</span>
          {props.errorLogCount > 0 && (
            <span
              className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[11px] font-semibold text-[var(--accent-contrast)]"
              title={`${props.errorLogCount} error log(s)`}
            >
              {props.errorLogCount > 99 ? '99+' : props.errorLogCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={props.onOpenSettings}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-[12.5px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] cursor-pointer"
          title={`${t(props.lang, 'preferences')} (Ctrl+,)`}
          aria-label={t(props.lang, 'settings')}
        >
          <Settings className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
          <span className="hidden md:inline">{t(props.lang, 'settings')}</span>
        </button>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label="More options menu"
            title="Menu"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] cursor-pointer"
          >
            <Menu className="h-4 w-4" />
          </button>

          {menuOpen && (
            <div
              role="menu"
              aria-label="Main menu"
              className="animate-menu-open absolute right-0 top-10 z-40 w-64 rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-surface)] p-1.5 shadow-2xl"
              style={{ transformOrigin: 'top right' }}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  props.onPasteClipboard();
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              >
                <ClipboardPaste className="h-4 w-4 text-[var(--text-secondary)]" />
                <span>Paste URLs from clipboard</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  props.onImportUrlsFile();
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              >
                <FileUp className="h-4 w-4 text-[var(--text-secondary)]" />
                <span>Import URLs from file...</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  props.onExportDownloads();
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              >
                <Upload className="h-4 w-4 text-[var(--text-secondary)]" />
                <span>Export download links...</span>
              </button>

              <div className="my-1 h-px bg-[var(--border-subtle)]" />

              <div className="relative">
                <button
                  type="button"
                  role="menuitem"
                  aria-expanded={powerSubOpen}
                  onClick={() => setPowerSubOpen((s) => !s)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                >
                  <span className="flex items-center gap-2.5">
                    <Power
                      className={`h-4 w-4 ${
                        props.autoPowerAction !== 'off'
                          ? 'text-[var(--accent-text)]'
                          : 'text-[var(--text-secondary)]'
                      }`}
                    />
                    <span>Auto shutdown</span>
                  </span>
                  <span className="flex items-center gap-1 text-[12px] text-[var(--text-secondary)]">
                    {props.autoPowerAction !== 'off' && (
                      <span className="text-[var(--accent-text)]">
                        {POWER_ACTION_LABELS[props.autoPowerAction]}
                      </span>
                    )}
                    <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                </button>

                {powerSubOpen && (
                  <div className="mx-1.5 my-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1 animate-menu-open">
                    {POWER_OPTIONS.map((act) => {
                      const active = props.autoPowerAction === act;
                      return (
                        <button
                          key={act}
                          type="button"
                          role="menuitemradio"
                          aria-checked={active}
                          onClick={() => {
                            props.onPowerActionChange(act);
                            setMenuOpen(false);
                            setPowerSubOpen(false);
                          }}
                          className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[12.5px] ${
                            active
                              ? 'bg-[var(--accent-soft)] font-semibold text-[var(--accent-text)]'
                              : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                          }`}
                        >
                          <span>{POWER_ACTION_LABELS[act]}</span>
                          {active && <span>✓</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  props.onOpenLogs();
                }}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              >
                <ScrollText className="h-4 w-4 text-[var(--text-secondary)]" />
                <span>{t(props.lang, 'logs')}</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  props.onOpenSettings();
                }}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              >
                <Settings className="h-4 w-4 text-[var(--text-secondary)]" />
                <span>{t(props.lang, 'preferences')}</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  props.onResetFilterOrder();
                }}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              >
                <RotateCcw className="h-4 w-4 text-[var(--text-secondary)]" />
                <span>Reset filter tabs order</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  props.onOpenPrivacy();
                }}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              >
                <ShieldCheck className="h-4 w-4 text-[var(--text-secondary)]" />
                <span>{t(props.lang, 'privacyPolicy')}</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  props.onCheckUpdates();
                }}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              >
                <span className="flex items-center gap-2.5">
                  <RefreshCw className="h-4 w-4 text-[var(--text-secondary)]" />
                  <span>Check for updates</span>
                </span>
                {props.updateAvailable && (
                  <span
                    className="h-2 w-2 rounded-full bg-[var(--accent)]"
                    aria-label="New version available"
                  />
                )}
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  props.onOpenAbout();
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              >
                <Info className="h-4 w-4 text-[var(--text-secondary)]" />
                <span>About MyLoad Download Manager</span>
              </button>

              <div className="my-1 h-px bg-[var(--border-subtle)]" />

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  props.onQuitApp();
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-[var(--danger)] hover:bg-[var(--danger-soft)]"
              >
                <LogOut className="h-4 w-4" />
                <span>Quit MyLoad Download Manager</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

