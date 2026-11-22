import { useState, type ReactNode } from 'react';
import {
  Activity,
  Archive,
  CheckCircle2,
  File,
  FileText,
  Film,
  GripVertical,
  Image as ImageIcon,
  Layers,
  Magnet,
} from 'lucide-react';
import { tCategory } from '../../shared/i18n';
import type { AppLanguage, CategoryId } from '../../shared/types';

interface FilterTabsBarProps {
  lang: AppLanguage;
  order: CategoryId[];
  activeCategory: CategoryId;
  counts: Record<CategoryId, number>;
  onSelect: (category: CategoryId) => void;
  onReorder: (nextOrder: CategoryId[], announcement: string) => void;
}

const CATEGORY_ICONS: Record<CategoryId, ReactNode> = {
  all: <Layers className="h-4 w-4" aria-hidden="true" />,
  active: <Activity className="h-4 w-4" aria-hidden="true" />,
  completed: <CheckCircle2 className="h-4 w-4" aria-hidden="true" />,
  torrents: <Magnet className="h-4 w-4" aria-hidden="true" />,
  images: <ImageIcon className="h-4 w-4" aria-hidden="true" />,
  docs: <FileText className="h-4 w-4" aria-hidden="true" />,
  archives: <Archive className="h-4 w-4" aria-hidden="true" />,
  videos: <Film className="h-4 w-4" aria-hidden="true" />,
  other: <File className="h-4 w-4" aria-hidden="true" />,
};

export function FilterTabsBar({
  lang,
  order,
  activeCategory,
  counts,
  onSelect,
  onReorder,
}: FilterTabsBarProps) {
  const [draggedId, setDraggedId] = useState<CategoryId | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: CategoryId; side: 'before' | 'after' } | null>(
    null
  );

  const moveTab = (fromId: CategoryId, targetId: CategoryId, side: 'before' | 'after') => {
    if (fromId === targetId) return;
    const without = order.filter((id) => id !== fromId);
    const targetIdx = without.indexOf(targetId);
    if (targetIdx === -1) return;
    const insertIdx = side === 'before' ? targetIdx : targetIdx + 1;
    const next = [...without];
    next.splice(insertIdx, 0, fromId);
    onReorder(next, `Moved ${tCategory(lang, fromId)} filter tab`);
  };

  const handleKeyDown = (e: React.KeyboardEvent, id: CategoryId) => {
    if (!e.altKey) return;
    const idx = order.indexOf(id);
    if (idx === -1) return;

    if (e.key === 'ArrowLeft' && idx > 0) {
      e.preventDefault();
      const next = [...order];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      onReorder(next, `Moved ${tCategory(lang, id)} left to position ${idx}`);
    } else if (e.key === 'ArrowRight' && idx < order.length - 1) {
      e.preventDefault();
      const next = [...order];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      onReorder(next, `Moved ${tCategory(lang, id)} right to position ${idx + 2}`);
    }
  };

  return (
    <nav
      aria-label="Category filters (drag or press Alt + Left/Right to reorder)"
      className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2"
    >
      <div className="flex items-center gap-1" role="tablist" aria-label="Download categories">
        {order.map((id) => {
          const isSelected = activeCategory === id;
          const isDragging = draggedId === id;
          const showBefore = dropTarget?.id === id && dropTarget.side === 'before';
          const showAfter = dropTarget?.id === id && dropTarget.side === 'after';

          return (
            <div
              key={id}
              draggable
              onDragStart={(e) => {
                setDraggedId(id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('application/x-myload-tab', id);
              }}
              onDragOver={(e) => {
                if (!draggedId || draggedId === id) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const rect = e.currentTarget.getBoundingClientRect();
                const side = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
                setDropTarget({ id, side });
              }}
              onDragLeave={() => {
                if (dropTarget?.id === id) setDropTarget(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (draggedId && draggedId !== id) {
                  moveTab(draggedId, id, dropTarget?.side ?? 'before');
                }
                setDraggedId(null);
                setDropTarget(null);
              }}
              onDragEnd={() => {
                setDraggedId(null);
                setDropTarget(null);
              }}
              className="relative flex items-center"
            >
              {showBefore && (
                <span
                  className="absolute -left-0.5 top-1 bottom-1 w-0.5 rounded-full bg-[var(--accent)]"
                  aria-hidden="true"
                />
              )}
              <button
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => onSelect(id)}
                onKeyDown={(e) => handleKeyDown(e, id)}
                title={`${tCategory(lang, id)} (${counts[id] ?? 0}) — drag or Alt+Arrow to reorder`}
                className={`group inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-medium whitespace-nowrap transition-colors ${
                  isSelected
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-text)]'
                    : 'border-transparent bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
                } ${isDragging ? 'opacity-45' : 'opacity-100'}`}
              >
                <GripVertical
                  className="h-3.5 w-3.5 shrink-0 cursor-grab text-[var(--text-muted)] opacity-55 transition-opacity group-hover:opacity-100"
                  aria-hidden="true"
                />
                {CATEGORY_ICONS[id]}
                <span>{tCategory(lang, id)}</span>
                <span
                  className={`rounded-full px-1.5 py-0 text-[11px] font-semibold ${
                    isSelected
                      ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
                      : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
                  }`}
                >
                  {counts[id] ?? 0}
                </span>
              </button>
              {showAfter && (
                <span
                  className="absolute -right-0.5 top-1 bottom-1 w-0.5 rounded-full bg-[var(--accent)]"
                  aria-hidden="true"
                />
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}

