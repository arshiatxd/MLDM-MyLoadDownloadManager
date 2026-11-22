import { memo, useEffect, useRef, useState } from 'react';
import {
  Archive,
  Clock,
  Copy,
  DownloadCloud,
  ExternalLink,
  File,
  FileText,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Info,
  Magnet,
  MoreVertical,
  Pause,
  Play,
  RotateCw,
  Trash2,
} from 'lucide-react';
import { getItemProgress } from '../../shared/categories';
import {
  formatBytes,
  formatDateShort,
  formatEta,
  formatScheduleSummary,
  formatSpeed,
} from '../../shared/constants';
import { t } from '../../shared/i18n';
import type { AppLanguage, CategoryId, DownloadItem, FileCategory } from '../../shared/types';

interface DownloadTableProps {
  lang: AppLanguage;
  items: DownloadItem[];
  totalItemsCount: number;
  activeCategory: CategoryId;
  selectedIds: Set<string>;
  focusedId: string | null;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onFocusItem: (id: string) => void;
  onInspectItem: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRetry: (id: string) => void;
  onOpenFile: (item: DownloadItem) => void;
  onShowInFolder: (item: DownloadItem) => void;
  onRequestRemove: (ids: string[], deleteFilesDefault?: boolean) => void;
  onCopySource: (source: string) => void;
  onOpenSchedule: (item: DownloadItem) => void;
  onOpenAddModal: () => void;
}

function CategoryGlyph({ category, kind }: { category: FileCategory; kind: DownloadItem['kind'] }) {
  if (kind === 'torrent' || category === 'torrents') {
    return <Magnet className="h-4 w-4 shrink-0 text-[var(--accent-text)]" aria-hidden="true" />;
  }
  switch (category) {
    case 'images':
      return <ImageIcon className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />;
    case 'docs':
      return <FileText className="h-4 w-4 shrink-0 text-sky-400" aria-hidden="true" />;
    case 'archives':
      return <Archive className="h-4 w-4 shrink-0 text-purple-400" aria-hidden="true" />;
    case 'videos':
      return <Film className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />;
    default:
      return <File className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />;
  }
}

function getStatusBadge(item: DownloadItem): { label: string; colorVar: string } {
  const pct = Math.round(getItemProgress(item) * 100);
  switch (item.status) {
    case 'downloading':
      return {
        label: item.totalBytes ? `Downloading ${pct}%` : 'Downloading...',
        colorVar: 'var(--accent)',
      };
    case 'probing':
      return { label: 'Connecting...', colorVar: 'var(--accent)' };
    case 'queued':
      return { label: 'Queued', colorVar: 'var(--warning)' };
    case 'seeding':
      return { label: 'Seeding', colorVar: 'var(--success)' };
    case 'paused':
      if (item.schedule?.startAt && item.schedule.startAt > Date.now()) {
        return { label: 'Scheduled', colorVar: 'var(--accent)' };
      }
      return { label: pct > 0 ? `Paused ${pct}%` : 'Paused', colorVar: 'var(--warning)' };
    case 'completed':
      return { label: 'Completed', colorVar: 'var(--success)' };
    case 'error':
      return { label: 'Error', colorVar: 'var(--danger)' };
  }
}

interface DownloadRowProps {
  item: DownloadItem;
  index: number;
  isSelected: boolean;
  isFocused: boolean;
  onToggleSelect: (id: string) => void;
  onFocusItem: (id: string) => void;
  onInspectItem: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRetry: (id: string) => void;
  onOpenFile: (item: DownloadItem) => void;
  onShowInFolder: (item: DownloadItem) => void;
  onOpenContextMenu: (item: DownloadItem, x: number, y: number) => void;
}

const DownloadRow = memo(function DownloadRow({
  item,
  index,
  isSelected,
  isFocused,
  onToggleSelect,
  onFocusItem,
  onInspectItem,
  onPause,
  onResume,
  onRetry,
  onOpenFile,
  onShowInFolder,
  onOpenContextMenu,
}: DownloadRowProps) {
  const progress = getItemProgress(item);
  const pct = Math.round(progress * 100);
  const badge = getStatusBadge(item);
  const isRunning =
    item.status === 'downloading' ||
    item.status === 'probing' ||
    item.status === 'queued' ||
    item.status === 'seeding';
  const scheduleLabel =
    item.status !== 'completed' ? formatScheduleSummary(item.schedule) : null;

  return (
    <tr
      onClick={() => onFocusItem(item.id)}
      onDoubleClick={() => {
        if (item.status === 'completed') onOpenFile(item);
        else onInspectItem(item.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onFocusItem(item.id);
        onOpenContextMenu(item, e.clientX, e.clientY);
      }}
      className={`animate-row-enter group border-b border-[var(--border-subtle)]/70 transition-colors last:border-b-0 ${
        isFocused || isSelected
          ? 'bg-[var(--bg-selected)]'
          : 'hover:bg-[var(--bg-hover)]/65'
      }`}
    >
      <td
        className="px-3 py-2.5"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(item.id)}
          aria-label={`Select ${item.name}`}
          className="h-4 w-4 cursor-pointer accent-[var(--accent)]"
        />
      </td>

      <td className="py-2.5 text-center text-[12px] text-[var(--text-muted)]">
        {index + 1}
      </td>

      <td className="max-w-[270px] py-2.5 pr-3">
        <div className="flex items-center gap-2.5">
          <CategoryGlyph category={item.category} kind={item.kind} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-[var(--text-primary)]" title={item.name}>
              {item.name}
            </div>
            {item.status === 'error' && item.errorMessage ? (
              <div className="truncate text-[12px] text-[var(--danger)]" title={item.errorMessage}>
                {item.errorMessage}
              </div>
            ) : scheduleLabel ? (
              <div
                className="flex items-center gap-1 truncate text-[11.5px] text-[var(--accent-text)]"
                title={scheduleLabel}
              >
                <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{scheduleLabel}</span>
              </div>
            ) : item.kind === 'torrent' && (item.status === 'downloading' || item.status === 'seeding') ? (
              <div className="truncate text-[12px] text-[var(--text-secondary)]">
                Torrent · {item.torrent?.peers ?? 0} peers · Ratio {item.torrent?.ratio ?? 0}
              </div>
            ) : item.kind === 'http' && item.status === 'downloading' && item.segments.length > 1 ? (
              <div className="truncate text-[12px] text-[var(--text-secondary)]">
                {item.segments.filter((s) => s.status === 'active').length} active / {item.segments.length} connections
              </div>
            ) : null}
          </div>
        </div>
      </td>

      <td className="py-2.5 pr-3 whitespace-nowrap text-[var(--text-secondary)]">
        {item.status === 'completed'
          ? formatBytes(item.totalBytes ?? item.downloadedBytes)
          : item.totalBytes
            ? `${formatBytes(item.downloadedBytes)} / ${formatBytes(item.totalBytes)}`
            : formatBytes(item.downloadedBytes)}
      </td>

      <td className="py-2.5 pr-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[12px]">
            <span
              className="font-medium"
              style={{
                color:
                  item.status === 'completed'
                    ? 'var(--text-secondary)'
                    : badge.colorVar,
              }}
            >
              {badge.label}
            </span>
          </div>
          {item.status !== 'completed' && (
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-elevated)]"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${item.name} progress`}
            >
              <div
                className="h-full rounded-full transition-all duration-150"
                style={{
                  width: `${item.totalBytes ? pct : item.status === 'downloading' ? 35 : 0}%`,
                  backgroundColor: badge.colorVar,
                }}
              />
            </div>
          )}
        </div>
      </td>

      <td className="py-2.5 pr-3 whitespace-nowrap text-[var(--text-secondary)]">
        {item.status === 'downloading' ? formatEta(item.etaSeconds) : '—'}
      </td>

      <td className="py-2.5 pr-3 whitespace-nowrap font-mono text-[12.5px] text-[var(--text-primary)]">
        {formatSpeed(item.downloadSpeed)}
      </td>

      <td className="py-2.5 pr-3 whitespace-nowrap font-mono text-[12.5px] text-[var(--text-secondary)]">
        {formatSpeed(item.uploadSpeed)}
      </td>

      <td className="py-2.5 pr-3 whitespace-nowrap text-[var(--text-secondary)]">
        {formatDateShort(item.addedAt)}
      </td>

      <td
        className="py-2.5 pr-3 text-right"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="inline-flex items-center justify-end gap-1">
          {item.status === 'error' ? (
            <button
              type="button"
              onClick={() => onRetry(item.id)}
              title="Retry download"
              aria-label={`Retry ${item.name}`}
              className="rounded p-1.5 text-[var(--accent-text)] hover:bg-[var(--bg-hover)]"
            >
              <RotateCw className="h-4 w-4" />
            </button>
          ) : item.status !== 'completed' ? (
            isRunning ? (
              <button
                type="button"
                onClick={() => onPause(item.id)}
                title="Pause download"
                aria-label={`Pause ${item.name}`}
                className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                <Pause className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onResume(item.id)}
                title="Resume download"
                aria-label={`Resume ${item.name}`}
                className="rounded p-1.5 text-[var(--accent-text)] hover:bg-[var(--bg-hover)]"
              >
                <Play className="h-4 w-4" />
              </button>
            )
          ) : (
            <button
              type="button"
              onClick={() => onOpenFile(item)}
              title="Open file"
              aria-label={`Open ${item.name}`}
              className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              <ExternalLink className="h-4 w-4" />
            </button>
          )}

          <button
            type="button"
            onClick={() => onShowInFolder(item)}
            title="Show in folder"
            aria-label={`Show ${item.name} in folder`}
            className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <FolderOpen className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              onOpenContextMenu(item, rect.right - 200, rect.bottom + 4);
            }}
            title="More actions"
            aria-label={`More actions for ${item.name}`}
            className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
});

export function DownloadTable({
  lang,
  items,
  totalItemsCount,
  activeCategory,
  selectedIds,
  focusedId,
  onToggleSelect,
  onToggleSelectAll,
  onFocusItem,
  onInspectItem,
  onPause,
  onResume,
  onRetry,
  onOpenFile,
  onShowInFolder,
  onRequestRemove,
  onCopySource,
  onOpenSchedule,
  onOpenAddModal,
}: DownloadTableProps) {
  const [contextMenu, setContextMenu] = useState<{
    item: DownloadItem;
    x: number;
    y: number;
  } | null>(null);

  const [dropzoneHeight, setDropzoneHeight] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('myload:dropzoneHeight'));
      if (Number.isFinite(saved) && saved >= 76 && saved <= 340) return saved;
    } catch {
      return 148;
    }
    return 148;
  });
  const [isResizingDropzone, setIsResizingDropzone] = useState(false);
  const dropzoneDragRef = useRef<{ startY: number; startHeight: number; latestHeight: number } | null>(
    null
  );

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  const openContextMenuAt = (item: DownloadItem, clientX: number, clientY: number) => {
    const menuWidth = 216;
    const menuHeight = 330;
    const x = Math.max(8, Math.min(clientX, window.innerWidth - menuWidth - 8));
    const y = Math.max(8, Math.min(clientY, window.innerHeight - menuHeight - 8));
    setContextMenu({ item, x, y });
  };

  const allSelected = items.length > 0 && items.every((it) => selectedIds.has(it.id));
  const someSelected = items.some((it) => selectedIds.has(it.id)) && !allSelected;

  const menuItem = contextMenu?.item ?? null;
  const menuIsRunning =
    menuItem !== null &&
    (menuItem.status === 'downloading' ||
      menuItem.status === 'probing' ||
      menuItem.status === 'queued' ||
      menuItem.status === 'seeding');

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--bg-canvas)] px-3 py-2">
      <div
        key={activeCategory}
        onScroll={() => {
          if (contextMenu) setContextMenu(null);
        }}
        className="animate-tab-content min-h-[120px] flex-1 overflow-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
      >
        <table className="w-full border-collapse text-left text-[13px]" aria-label="Downloads list">
          <thead className="sticky top-0 z-10 bg-[var(--bg-elevated)]">
            <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/95 text-[12px] font-medium text-[var(--text-secondary)]">
              <th className="w-10 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={onToggleSelectAll}
                  aria-label="Select all visible downloads"
                  className="h-4 w-4 cursor-pointer accent-[var(--accent)]"
                />
              </th>
              <th className="w-8 py-2.5 text-center">#</th>
              <th className="py-2.5 pr-3">{t(lang, 'colName')}</th>
              <th className="w-32 py-2.5 pr-3">{t(lang, 'colSize')}</th>
              <th className="w-44 py-2.5 pr-3">{t(lang, 'colStatus')}</th>
              <th className="w-20 py-2.5 pr-3">{t(lang, 'colEta')}</th>
              <th className="w-24 py-2.5 pr-3">{t(lang, 'colDownload')}</th>
              <th className="w-24 py-2.5 pr-3">{t(lang, 'colUpload')}</th>
              <th className="w-20 py-2.5 pr-3">{t(lang, 'colAdded')}</th>
              <th className="w-32 py-2.5 pr-3 text-right">{t(lang, 'colActions')}</th>
            </tr>
          </thead>

          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-[13px] text-[var(--text-secondary)]">
                  {totalItemsCount === 0 ? t(lang, 'emptyList') : t(lang, 'noMatch')}
                </td>
              </tr>
            )}

            {items.map((item, idx) => (
              <DownloadRow
                key={item.id}
                item={item}
                index={idx}
                isSelected={selectedIds.has(item.id)}
                isFocused={focusedId === item.id}
                onToggleSelect={onToggleSelect}
                onFocusItem={onFocusItem}
                onInspectItem={onInspectItem}
                onPause={onPause}
                onResume={onResume}
                onRetry={onRetry}
                onOpenFile={onOpenFile}
                onShowInFolder={onShowInFolder}
                onOpenContextMenu={openContextMenuAt}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div
        role="separator"
        tabIndex={0}
        aria-orientation="horizontal"
        aria-label="Resize drop zone"
        aria-valuemin={76}
        aria-valuemax={340}
        aria-valuenow={dropzoneHeight}
        data-dragging={isResizingDropzone ? 'true' : 'false'}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          dropzoneDragRef.current = {
            startY: e.clientY,
            startHeight: dropzoneHeight,
            latestHeight: dropzoneHeight,
          };
          setIsResizingDropzone(true);
        }}
        onPointerMove={(e) => {
          if (!dropzoneDragRef.current) return;
          const delta = dropzoneDragRef.current.startY - e.clientY;
          const next = Math.max(
            76,
            Math.min(340, Math.round(dropzoneDragRef.current.startHeight + delta))
          );
          dropzoneDragRef.current.latestHeight = next;
          setDropzoneHeight(next);
        }}
        onPointerUp={() => {
          if (!dropzoneDragRef.current) return;
          const saved = dropzoneDragRef.current.latestHeight;
          dropzoneDragRef.current = null;
          setIsResizingDropzone(false);
          try {
            localStorage.setItem('myload:dropzoneHeight', String(saved));
          } catch {
            return;
          }
        }}
        onPointerCancel={() => {
          dropzoneDragRef.current = null;
          setIsResizingDropzone(false);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          const delta = e.key === 'ArrowUp' ? 16 : -16;
          const next = Math.max(76, Math.min(340, dropzoneHeight + delta));
          setDropzoneHeight(next);
          try {
            localStorage.setItem('myload:dropzoneHeight', String(next));
          } catch {
            return;
          }
        }}
        title="Drag to resize downloads list and drop zone"
        className="ml-resize-handle my-0.5 shrink-0"
      />

      <button
        type="button"
        onClick={onOpenAddModal}
        aria-label="Drag and drop URL, magnet link, or torrent file here, or click to add download"
        style={{ height: dropzoneHeight }}
        className="flex shrink-0 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-[var(--border-strong)]/60 bg-[var(--bg-surface)]/45 px-4 py-3 text-center transition-colors hover:border-[var(--accent)]/70 hover:bg-[var(--accent-soft)]/30"
      >
        <div className="flex items-center gap-2.5 text-[14px] font-medium text-[var(--text-secondary)]">
          <DownloadCloud className="h-5 w-5 text-[var(--accent-text)]" aria-hidden="true" />
          <span>{t(lang, 'dropTitle')}</span>
        </div>
        {dropzoneHeight >= 100 && (
          <span className="text-[12.5px] text-[var(--text-muted)]">
            {t(lang, 'dropSubtitle')}
          </span>
        )}
      </button>

      {contextMenu && menuItem && (
        <div
          role="menu"
          aria-label={`Actions for ${menuItem.name}`}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          className="animate-menu-open fixed z-50 w-52 rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-surface)] p-1.5 text-left shadow-2xl"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const id = menuItem.id;
              setContextMenu(null);
              onInspectItem(id);
            }}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            <Info className="h-4 w-4 text-[var(--text-secondary)]" />
            <span>Inspect details</span>
          </button>

          {menuItem.status === 'error' ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const id = menuItem.id;
                setContextMenu(null);
                onRetry(id);
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              <RotateCw className="h-4 w-4 text-[var(--accent-text)]" />
              <span>Retry download</span>
            </button>
          ) : menuItem.status !== 'completed' ? (
            menuIsRunning ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const id = menuItem.id;
                  setContextMenu(null);
                  onPause(id);
                }}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              >
                <Pause className="h-4 w-4 text-[var(--text-secondary)]" />
                <span>Pause download</span>
              </button>
            ) : (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const id = menuItem.id;
                  setContextMenu(null);
                  onResume(id);
                }}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              >
                <Play className="h-4 w-4 text-[var(--accent-text)]" />
                <span>Resume download</span>
              </button>
            )
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const target = menuItem;
                setContextMenu(null);
                onOpenFile(target);
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              <ExternalLink className="h-4 w-4 text-[var(--text-secondary)]" />
              <span>Open file</span>
            </button>
          )}

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const target = menuItem;
              setContextMenu(null);
              onShowInFolder(target);
            }}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            <FolderOpen className="h-4 w-4 text-[var(--text-secondary)]" />
            <span>Show in folder</span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const src = menuItem.source;
              setContextMenu(null);
              onCopySource(src);
            }}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            <Copy className="h-4 w-4 text-[var(--text-secondary)]" />
            <span>Copy source link</span>
          </button>

          {menuItem.status !== 'completed' && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const target = menuItem;
                setContextMenu(null);
                onOpenSchedule(target);
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              <Clock className="h-4 w-4 text-[var(--accent-text)]" />
              <span>
                {menuItem.schedule?.startAt || menuItem.schedule?.stopAt
                  ? 'Edit schedule...'
                  : 'Schedule download...'}
              </span>
            </button>
          )}

          <div className="my-1 h-px bg-[var(--border-subtle)]" />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const id = menuItem.id;
              setContextMenu(null);
              onRequestRemove([id], false);
            }}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            <Trash2 className="h-4 w-4 text-[var(--text-secondary)]" />
            <span>Remove from list</span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const id = menuItem.id;
              setContextMenu(null);
              onRequestRemove([id], true);
            }}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-[var(--danger)] hover:bg-[var(--danger-soft)]"
          >
            <Trash2 className="h-4 w-4" />
            <span>Remove &amp; delete files</span>
          </button>
        </div>
      )}
    </div>
  );
}

