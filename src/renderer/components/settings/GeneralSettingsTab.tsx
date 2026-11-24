import { useEffect, useState } from 'react';
import { FolderOpen, Globe, RotateCcw, Trash2 } from 'lucide-react';
import { FILE_CATEGORIES, formatBytes } from '../../../shared/constants';
import { LANGUAGES, t } from '../../../shared/i18n';
import type {
  AppLanguage,
  AppSettings,
  BridgeStatus,
  DirectoryValidationResult,
  DuplicatePolicy,
  FileCategory,
  MultiPartDefaultAction,
} from '../../../shared/types';
import { CustomSelect } from '../CustomSelect';
import { DirectoryStatusBanner } from '../DirectoryStatusBanner';
import { CategoryDirectoryRow } from './CategoryDirectoryRow';

const DUPLICATE_POLICY_OPTIONS: Array<{ value: DuplicatePolicy; label: string }> = [
  { value: 'auto-rename', label: 'Auto-rename (e.g. file (1).zip)' },
  { value: 'overwrite', label: 'Overwrite existing file' },
  { value: 'ask', label: 'Ask in confirmation dialog' },
];

const MULTIPART_DEFAULT_OPTIONS: Array<{ value: MultiPartDefaultAction; label: string }> = [
  { value: 'all', label: 'Download all detected parts automatically' },
  { value: 'single', label: 'Download only the clicked part' },
];

const LANGUAGE_OPTIONS: Array<{ value: AppLanguage; label: string }> = LANGUAGES.map((l) => ({
  value: l.code,
  label: l.label,
}));

interface GeneralSettingsTabProps {
  settings: AppSettings;
  bridgeStatus: BridgeStatus | null;
  onUpdate: (patch: Partial<AppSettings>) => void;
}

export function GeneralSettingsTab({
  settings,
  bridgeStatus,
  onUpdate,
}: GeneralSettingsTabProps) {
  const [dirValidation, setDirValidation] = useState<DirectoryValidationResult | null>(null);
  const [checkingDir, setCheckingDir] = useState(false);
  const [cacheDirValidation, setCacheDirValidation] = useState<DirectoryValidationResult | null>(null);
  const [checkingCacheDir, setCheckingCacheDir] = useState(false);
  const [cacheClearStatus, setCacheClearStatus] = useState<string | null>(null);
  const [clearingCache, setClearingCache] = useState(false);

  useEffect(() => {
    let canceled = false;
    setCheckingDir(true);
    const timer = setTimeout(() => {
      void window.myload
        .validateDirectory(settings.defaultDownloadDir)
        .then((res) => {
          if (!canceled) setDirValidation(res);
        })
        .catch(() => {
          if (!canceled) setDirValidation(null);
        })
        .finally(() => {
          if (!canceled) setCheckingDir(false);
        });
    }, 200);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [settings.defaultDownloadDir]);

  useEffect(() => {
    if (!settings.useDownloadCacheDir) {
      setCacheDirValidation(null);
      setCheckingCacheDir(false);
      return;
    }
    let canceled = false;
    setCheckingCacheDir(true);
    const timer = setTimeout(() => {
      void window.myload
        .validateDirectory(settings.downloadCacheDir)
        .then((res) => {
          if (!canceled) setCacheDirValidation(res);
        })
        .catch(() => {
          if (!canceled) setCacheDirValidation(null);
        })
        .finally(() => {
          if (!canceled) setCheckingCacheDir(false);
        });
    }, 200);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [settings.useDownloadCacheDir, settings.downloadCacheDir]);

  const browseDefaultDir = async () => {
    const picked = await window.myload.selectFolder(settings.defaultDownloadDir);
    if (picked) {
      onUpdate({ defaultDownloadDir: picked });
    }
  };

  const browseCacheDir = async () => {
    const picked = await window.myload.selectFolder(
      settings.downloadCacheDir || settings.defaultDownloadDir
    );
    if (picked) {
      onUpdate({ downloadCacheDir: picked });
    }
  };

  const resetCacheDir = async () => {
    const defaultDir = await window.myload.getDefaultDownloadCacheDir();
    if (defaultDir) {
      onUpdate({ downloadCacheDir: defaultDir });
    }
  };

  const handleClearCache = async () => {
    if (clearingCache) return;
    setClearingCache(true);
    setCacheClearStatus(null);
    try {
      const res = await window.myload.clearDownloadCache();
      setCacheClearStatus(
        res.removedFiles === 0
          ? 'Cache is already clean.'
          : `Removed ${res.removedFiles} unused file${res.removedFiles === 1 ? '' : 's'} (${formatBytes(res.freedBytes)} freed).`
      );
    } catch {
      setCacheClearStatus('Unable to clear cache folder.');
    } finally {
      setClearingCache(false);
    }
  };

  const updateCategoryDir = (cat: FileCategory, nextPath: string) => {
    onUpdate({
      categoryDownloadDirs: {
        ...settings.categoryDownloadDirs,
        [cat]: nextPath,
      },
    });
  };

  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">
          {t(settings.language, 'languageLabel')}
        </h3>
        <CustomSelect
          value={settings.language}
          options={LANGUAGE_OPTIONS}
          onChange={(v) => onUpdate({ language: v })}
          ariaLabel={t(settings.language, 'languageLabel')}
          className="w-full max-w-xs"
        />
      </section>

      <section className="border-t border-[var(--border-subtle)] pt-4">
        <h3 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">
          Download Folder
        </h3>

        <div
          role="radiogroup"
          aria-label="Download folder routing mode"
          className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2"
        >
          <button
            type="button"
            role="radio"
            aria-checked={settings.folderRoutingMode === 'single'}
            onClick={() => onUpdate({ folderRoutingMode: 'single' })}
            className={`rounded-xl border p-3 text-left transition-colors cursor-pointer ${
              settings.folderRoutingMode === 'single'
                ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-canvas)]/60 hover:bg-[var(--bg-hover)]'
            }`}
          >
            <div className="text-[13px] font-semibold text-[var(--text-primary)]">
              All downloads in the same folder
            </div>
            <div className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
              Save every file type to one default folder.
            </div>
          </button>

          <button
            type="button"
            role="radio"
            aria-checked={settings.folderRoutingMode === 'per-category'}
            onClick={() => onUpdate({ folderRoutingMode: 'per-category' })}
            className={`rounded-xl border p-3 text-left transition-colors cursor-pointer ${
              settings.folderRoutingMode === 'per-category'
                ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-canvas)]/60 hover:bg-[var(--bg-hover)]'
            }`}
          >
            <div className="text-[13px] font-semibold text-[var(--text-primary)]">
              Specific folder per file type
            </div>
            <div className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
              Set custom folders for Videos, Images, Docs, Archives, Torrents &amp; Other.
            </div>
          </button>
        </div>

        {settings.folderRoutingMode === 'per-category' && (
          <div className="mb-1 text-[12px] font-medium text-[var(--text-secondary)]">
            Default / fallback folder (used for any file type left blank below)
          </div>
        )}

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={settings.defaultDownloadDir}
            onChange={(e) => onUpdate({ defaultDownloadDir: e.target.value })}
            aria-label="Default download folder"
            className="ml-input h-9 flex-1"
          />
          <button
            type="button"
            onClick={() => void browseDefaultDir()}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
          >
            <FolderOpen className="h-4 w-4" />
            <span>Browse</span>
          </button>
        </div>
        <DirectoryStatusBanner validation={dirValidation} checking={checkingDir} />

        {settings.folderRoutingMode === 'per-category' && (
          <div className="animate-menu-open mt-3 space-y-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/60 p-3">
            <div className="text-[12px] font-semibold text-[var(--text-primary)]">
              Download Folder by File Type
            </div>
            {FILE_CATEGORIES.map((cat) => (
              <CategoryDirectoryRow
                key={cat}
                category={cat}
                value={settings.categoryDownloadDirs?.[cat] ?? ''}
                defaultDownloadDir={settings.defaultDownloadDir}
                onChange={(nextPath) => updateCategoryDir(cat, nextPath)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="border-t border-[var(--border-subtle)] pt-4">
        <div className="mb-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Download Cache Folder
          </h3>
          <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
            Store temporary download parts here so incomplete threads do not appear in your download folder until finished.
          </p>
        </div>

        <div className="space-y-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/60 p-3.5">
          <label className="flex cursor-pointer items-center gap-2.5 text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={settings.useDownloadCacheDir}
              onChange={(e) => onUpdate({ useDownloadCacheDir: e.target.checked })}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            <span>Use temporary cache folder during downloads</span>
          </label>

          <div className="flex items-center gap-2">
            <input
              type="text"
              disabled={!settings.useDownloadCacheDir}
              value={settings.downloadCacheDir}
              onChange={(e) => onUpdate({ downloadCacheDir: e.target.value })}
              aria-label="Download cache folder"
              className="ml-input h-9 flex-1 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <button
              type="button"
              disabled={!settings.useDownloadCacheDir}
              onClick={() => void browseCacheDir()}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              <FolderOpen className="h-4 w-4" />
              <span>Browse</span>
            </button>
            <button
              type="button"
              disabled={!settings.useDownloadCacheDir}
              onClick={() => void resetCacheDir()}
              title="Reset to default MyLoad cache folder"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reset</span>
            </button>
          </div>

          {settings.useDownloadCacheDir && (
            <DirectoryStatusBanner validation={cacheDirValidation} checking={checkingCacheDir} />
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
            <button
              type="button"
              disabled={clearingCache}
              onClick={() => void handleClearCache()}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-[12px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>{clearingCache ? 'Clearing…' : 'Clear unused cache'}</span>
            </button>
            {cacheClearStatus && (
              <span className="text-[12px] text-[var(--text-secondary)]">{cacheClearStatus}</span>
            )}
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border-subtle)] pt-4">
        <h3 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">
          Download Behavior
        </h3>
        <div className="space-y-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/60 p-3.5">
          <label className="flex cursor-pointer items-center gap-2.5 text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={settings.alwaysUseDefaultDir}
              onChange={(e) => onUpdate({ alwaysUseDefaultDir: e.target.checked })}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            <span>Always download to default folder</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2.5 text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={settings.useCompactDownloadPopup}
              onChange={(e) => onUpdate({ useCompactDownloadPopup: e.target.checked })}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            <span>
              Show compact download frame on browser download (keeps full app closed)
            </span>
          </label>
          <label className="flex cursor-pointer items-center gap-2.5 text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={settings.autoDownloadOnClick}
              onChange={(e) => onUpdate({ autoDownloadOnClick: e.target.checked })}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            <span>Auto-download immediately on click (skip confirmation box)</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2.5 text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={settings.showConfirmationDialog}
              onChange={(e) => onUpdate({ showConfirmationDialog: e.target.checked })}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            <span>Show download confirmation box for manual &amp; dropped links</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2.5 text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={settings.showScheduleInPopup}
              onChange={(e) => onUpdate({ showScheduleInPopup: e.target.checked })}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            <span>Show schedule options (start &amp; stop time) in download popup</span>
          </label>
        </div>
      </section>

      <section className="border-t border-[var(--border-subtle)] pt-4">
        <h3 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">
          Multi-Part File Detection
        </h3>
        <div className="space-y-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/60 p-3.5">
          <label className="flex cursor-pointer items-center gap-2.5 text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={settings.detectMultiPartEnabled}
              onChange={(e) => onUpdate({ detectMultiPartEnabled: e.target.checked })}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            <span>
              Scan websites &amp; URLs for multi-part archives (.part01.rar, .001, .r00, etc.)
            </span>
          </label>
          <label
            className={`flex items-center gap-2.5 ${
              settings.detectMultiPartEnabled
                ? 'cursor-pointer text-[var(--text-primary)]'
                : 'cursor-not-allowed text-[var(--text-muted)]'
            }`}
          >
            <input
              type="checkbox"
              disabled={!settings.detectMultiPartEnabled}
              checked={!settings.multiPartDontAskAgain}
              onChange={(e) => onUpdate({ multiPartDontAskAgain: !e.target.checked })}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            <span>Ask whether to download all detected parts together</span>
          </label>
          {settings.detectMultiPartEnabled && settings.multiPartDontAskAgain && (
            <div className="pt-1 pl-6">
              <div className="mb-1 text-[12px] text-[var(--text-secondary)]">
                Default action when not asking
              </div>
              <CustomSelect
                value={settings.multiPartDefaultAction}
                options={MULTIPART_DEFAULT_OPTIONS}
                onChange={(v) => onUpdate({ multiPartDefaultAction: v })}
                ariaLabel="Default multi-part action"
                className="w-full max-w-sm"
              />
            </div>
          )}
        </div>
      </section>

      <section className="border-t border-[var(--border-subtle)] pt-4">
        <h3 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">
          Duplicate File Handling
        </h3>
        <CustomSelect
          value={settings.duplicatePolicy}
          options={DUPLICATE_POLICY_OPTIONS}
          onChange={(v) => onUpdate({ duplicatePolicy: v })}
          ariaLabel="Duplicate file handling rule"
          className="w-full max-w-xs"
        />
      </section>

      <section className="border-t border-[var(--border-subtle)] pt-4">
        <h3 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">
          Clipboard &amp; Notifications
        </h3>
        <div className="space-y-2">
          <div>
            <label className="flex cursor-pointer items-center gap-2 text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={settings.watchClipboard}
                onChange={(e) => onUpdate({ watchClipboard: e.target.checked })}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              <span>Auto-fill last copied downloadable link when opening Add Download</span>
            </label>
            <p className="mt-0.5 pl-6 text-[12px] text-[var(--text-secondary)]">
              Silently remembers the last copied download link in memory — never opens popups automatically.
            </p>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={settings.desktopNotifications}
              onChange={(e) => onUpdate({ desktopNotifications: e.target.checked })}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            <span>Show desktop notification when download finishes</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={settings.completionSound}
              onChange={(e) => onUpdate({ completionSound: e.target.checked })}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            <span>Play subtle chime when download completes</span>
          </label>
        </div>
      </section>

      <section className="border-t border-[var(--border-subtle)] pt-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
            <Globe className="h-4 w-4 text-[var(--accent-text)]" aria-hidden="true" />
            <span>Browser Integration (Chrome / Edge / Brave)</span>
          </h3>
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${
              bridgeStatus?.running
                ? 'bg-[var(--success-soft)] text-[var(--success)]'
                : bridgeStatus?.error
                  ? 'bg-[var(--danger-soft)] text-[var(--danger)]'
                  : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'
            }`}
          >
            {bridgeStatus?.running
              ? `Listening on 127.0.0.1:${bridgeStatus.port}`
              : bridgeStatus?.error
                ? 'Bridge error'
                : 'Stopped'}
          </span>
        </div>

        <div className="space-y-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/60 p-3.5">
          <label className="flex cursor-pointer items-center gap-2 text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={settings.browserBridgeEnabled}
              onChange={(e) => onUpdate({ browserBridgeEnabled: e.target.checked })}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            <span>Enable local browser extension bridge</span>
          </label>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-[var(--text-secondary)]">
              <span>Bridge port:</span>
              <input
                type="number"
                min={1024}
                max={65535}
                disabled={!settings.browserBridgeEnabled}
                value={settings.browserBridgePort}
                onChange={(e) =>
                  onUpdate({
                    browserBridgePort: Math.min(
                      65535,
                      Math.max(1024, Number(e.target.value) || 49173)
                    ),
                  })
                }
                className="ml-input h-8 !w-24 bg-[var(--bg-surface)]"
              />
            </label>

            <button
              type="button"
              onClick={() => void window.myload.openExtensionFolder()}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3 text-[12.5px] font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] cursor-pointer"
            >
              <FolderOpen className="h-4 w-4" aria-hidden="true" />
              <span>Open Extension Folder</span>
            </button>
          </div>

          {bridgeStatus?.error && (
            <div className="text-[12px] text-[var(--danger)]">{bridgeStatus.error}</div>
          )}

          <ol className="list-decimal space-y-0.5 pl-4 text-[12px] text-[var(--text-secondary)]">
            <li>
              Open <code className="text-[var(--text-primary)]">chrome://extensions</code> or{' '}
              <code className="text-[var(--text-primary)]">edge://extensions</code> in your browser.
            </li>
            <li>
              Enable <strong>Developer mode</strong> in the top-right corner.
            </li>
            <li>
              Click <strong>Load unpacked</strong> and select the folder opened by{' '}
              <strong>Open Extension Folder</strong>.
            </li>
          </ol>
        </div>
      </section>
    </div>
  );
}

