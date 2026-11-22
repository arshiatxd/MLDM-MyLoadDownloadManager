import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Disc,
  File,
  FileText,
  Film,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Music,
  Search,
  X,
} from 'lucide-react';
import { formatBytes } from '../../shared/constants';
import { type TorrentTreeNode, buildTorrentTree } from '../../shared/torrent-tree';
import type { TorrentFileInfo } from '../../shared/types';

function FileTypeIcon({ name }: { name: string }) {
  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() ?? '' : '';
  if (['mp4', 'mkv', 'avi', 'mov', 'webm', 'm4v', 'wmv', 'ts'].includes(ext)) {
    return <Film className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden="true" />;
  }
  if (['mp3', 'flac', 'wav', 'aac', 'm4a', 'ogg', 'opus'].includes(ext)) {
    return <Music className="h-3.5 w-3.5 shrink-0 text-pink-400" aria-hidden="true" />;
  }
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) {
    return <ImageIcon className="h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />;
  }
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(ext)) {
    return <Archive className="h-3.5 w-3.5 shrink-0 text-purple-400" aria-hidden="true" />;
  }
  if (['iso', 'img', 'bin', 'mdf'].includes(ext)) {
    return <Disc className="h-3.5 w-3.5 shrink-0 text-cyan-400" aria-hidden="true" />;
  }
  if (['txt', 'md', 'pdf', 'nfo', 'srt', 'ass', 'sub', 'json', 'xml'].includes(ext)) {
    return <FileText className="h-3.5 w-3.5 shrink-0 text-sky-400" aria-hidden="true" />;
  }
  return <File className="h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />;
}

function TriCheckbox({
  checked,
  indeterminate,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={ariaLabel}
      className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-[var(--accent)]"
    />
  );
}

interface TorrentFileTreeProps {
  files: TorrentFileInfo[];
  selectedIndices: number[];
  onChangeSelection: (nextIndices: number[]) => void;
  showProgress?: boolean;
  compact?: boolean;
}

export function TorrentFileTree({
  files,
  selectedIndices,
  onChangeSelection,
  showProgress = false,
  compact = false,
}: TorrentFileTreeProps) {
  const [filterQuery, setFilterQuery] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const seenRootIdsRef = useRef<Set<string>>(new Set());

  const tree = useMemo(() => buildTorrentTree(files, filterQuery), [files, filterQuery]);

  useEffect(() => {
    const newRoots: string[] = [];
    for (const node of tree) {
      if (node.isFolder && !seenRootIdsRef.current.has(node.id)) {
        seenRootIdsRef.current.add(node.id);
        newRoots.push(node.id);
      }
    }
    if (newRoots.length > 0) {
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        for (const id of newRoots) next.add(id);
        return next;
      });
    }
  }, [tree]);

  const selectedSet = useMemo(() => new Set(selectedIndices), [selectedIndices]);

  const selectedBytes = useMemo(
    () =>
      files.reduce(
        (sum, f) => sum + (selectedSet.has(f.index) ? f.length : 0),
        0
      ),
    [files, selectedSet]
  );

  const toggleIndices = (indices: number[], targetChecked: boolean) => {
    const next = new Set(selectedSet);
    if (targetChecked) {
      for (const idx of indices) next.add(idx);
    } else {
      for (const idx of indices) next.delete(idx);
    }
    onChangeSelection([...next].sort((a, b) => a - b));
  };

  const toggleFolderExpanded = (id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isFiltering = filterQuery.trim().length > 0;

  const renderNodes = (nodes: TorrentTreeNode[], depth: number): React.ReactNode =>
    nodes.map((node) => {
      const totalInNode = node.fileIndices.length;
      const selectedInNode = node.fileIndices.filter((idx) => selectedSet.has(idx)).length;
      const allChecked = totalInNode > 0 && selectedInNode === totalInNode;
      const someChecked = selectedInNode > 0 && selectedInNode < totalInNode;
      const isExpanded = isFiltering || expandedFolders.has(node.id);
      const pct =
        node.totalBytes > 0
          ? Math.max(0, Math.min(100, Math.round((node.downloadedBytes / node.totalBytes) * 100)))
          : 100;

      return (
        <div key={node.id}>
          <div
            className="flex items-center gap-1.5 overflow-x-hidden border-b border-[var(--border-subtle)]/40 px-2 py-1.5 text-[12px] last:border-b-0 hover:bg-[var(--bg-hover)]/55"
            style={{ paddingLeft: `${8 + depth * 12}px` }}
          >
            {node.isFolder ? (
              <button
                type="button"
                onClick={() => toggleFolderExpanded(node.id)}
                aria-label={isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </button>
            ) : (
              <span className="inline-block w-4 shrink-0" aria-hidden="true" />
            )}

            <TriCheckbox
              checked={allChecked}
              indeterminate={someChecked}
              onChange={() => toggleIndices(node.fileIndices, !allChecked)}
              ariaLabel={`Select ${node.name}`}
            />

            <div
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5"
              onClick={() => {
                if (node.isFolder) {
                  toggleFolderExpanded(node.id);
                } else {
                  toggleIndices(node.fileIndices, !allChecked);
                }
              }}
            >
              {node.isFolder ? (
                isExpanded ? (
                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />
                ) : (
                  <Folder className="h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />
                )
              ) : (
                <FileTypeIcon name={node.name} />
              )}
              <span
                className={`truncate ${
                  node.isFolder
                    ? 'font-medium text-[var(--text-primary)]'
                    : 'text-[var(--text-primary)]'
                }`}
                title={node.path}
              >
                {node.name}
              </span>
            </div>

            <span className="w-16 shrink-0 text-right font-mono text-[11px] text-[var(--text-secondary)]">
              {formatBytes(node.totalBytes)}
            </span>

            {showProgress && (
              <div className="flex w-20 shrink-0 items-center justify-end gap-1.5">
                <div className="h-1.5 w-11 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
                  <div
                    className="h-full rounded-full bg-[var(--accent)]"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-7 text-right font-mono text-[10.5px] text-[var(--text-secondary)]">
                  {pct}%
                </span>
              </div>
            )}
          </div>

          {node.isFolder && isExpanded && renderNodes(node.children, depth + 1)}
        </div>
      );
    });

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/75 p-2 text-xs">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onChangeSelection(files.map((f) => f.index))}
            className="h-6 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
          >
            Select All
          </button>
          <button
            type="button"
            onClick={() => onChangeSelection([])}
            className="h-6 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            Select None
          </button>
          <span className="ml-1 text-[11px] text-[var(--text-secondary)]">
            {selectedIndices.length}/{files.length} · {formatBytes(selectedBytes)}
          </span>
        </div>

        <div className="relative flex items-center">
          <Search
            className="pointer-events-none absolute left-2 h-3 w-3 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Filter files..."
            aria-label="Filter torrent files"
            className="h-6 w-36 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] pl-6 pr-5 text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          />
          {filterQuery && (
            <button
              type="button"
              onClick={() => setFilterQuery('')}
              aria-label="Clear filter"
              className="absolute right-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]/70">
        <div className="flex items-center gap-1.5 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/80 px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)]">
          <span className="flex-1 pl-6">Name</span>
          <span className="w-16 shrink-0 text-right">Size</span>
          {showProgress && <span className="w-20 shrink-0 text-right">Progress</span>}
        </div>
        <div className={`${compact ? 'max-h-40' : 'max-h-56'} overflow-x-hidden overflow-y-auto`}>
          {tree.length === 0 ? (
            <div className="py-4 text-center text-[11.5px] text-[var(--text-muted)]">
              No matching files or folders.
            </div>
          ) : (
            renderNodes(tree, 0)
          )}
        </div>
      </div>
    </div>
  );
}

