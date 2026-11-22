import type { DownloadPriority } from './types';

export interface RowClickModifiers {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export interface SelectionState {
  selectedIds: Set<string>;
  focusedId: string | null;
  anchorId: string | null;
}

function resolveAnchorId(
  orderedIds: readonly string[],
  state: SelectionState,
  fallbackId: string
): string {
  if (state.anchorId && orderedIds.includes(state.anchorId)) {
    return state.anchorId;
  }
  if (state.focusedId && orderedIds.includes(state.focusedId)) {
    return state.focusedId;
  }
  return fallbackId;
}

export function computeRowClickSelection(
  orderedIds: readonly string[],
  targetId: string,
  state: SelectionState,
  modifiers: RowClickModifiers
): SelectionState {
  const targetIdx = orderedIds.indexOf(targetId);
  if (targetIdx === -1) return state;

  if (modifiers.shiftKey) {
    const effectiveAnchor = resolveAnchorId(orderedIds, state, targetId);
    const anchorIdx = orderedIds.indexOf(effectiveAnchor);
    const start = Math.min(anchorIdx, targetIdx);
    const end = Math.max(anchorIdx, targetIdx);
    const nextSelected =
      modifiers.ctrlKey || modifiers.metaKey
        ? new Set(state.selectedIds)
        : new Set<string>();
    for (let i = start; i <= end; i += 1) {
      nextSelected.add(orderedIds[i]);
    }
    return {
      selectedIds: nextSelected,
      focusedId: targetId,
      anchorId: effectiveAnchor,
    };
  }

  if (modifiers.ctrlKey || modifiers.metaKey) {
    const nextSelected = new Set(state.selectedIds);
    if (nextSelected.has(targetId)) {
      nextSelected.delete(targetId);
    } else {
      nextSelected.add(targetId);
    }
    return {
      selectedIds: nextSelected,
      focusedId: targetId,
      anchorId: targetId,
    };
  }

  return {
    selectedIds: new Set([targetId]),
    focusedId: targetId,
    anchorId: targetId,
  };
}

export function computeCheckboxSelection(
  orderedIds: readonly string[],
  targetId: string,
  state: SelectionState,
  shiftKey: boolean
): SelectionState {
  const targetIdx = orderedIds.indexOf(targetId);
  if (targetIdx === -1) return state;

  if (shiftKey) {
    const effectiveAnchor = resolveAnchorId(orderedIds, state, targetId);
    const anchorIdx = orderedIds.indexOf(effectiveAnchor);
    const start = Math.min(anchorIdx, targetIdx);
    const end = Math.max(anchorIdx, targetIdx);
    const nextSelected = new Set(state.selectedIds);
    for (let i = start; i <= end; i += 1) {
      nextSelected.add(orderedIds[i]);
    }
    return {
      selectedIds: nextSelected,
      focusedId: targetId,
      anchorId: effectiveAnchor,
    };
  }

  const nextSelected = new Set(state.selectedIds);
  if (nextSelected.has(targetId)) {
    nextSelected.delete(targetId);
  } else {
    nextSelected.add(targetId);
  }
  return {
    selectedIds: nextSelected,
    focusedId: targetId,
    anchorId: targetId,
  };
}

export function computeArrowSelection(
  orderedIds: readonly string[],
  direction: 'up' | 'down',
  state: SelectionState,
  shiftKey: boolean
): SelectionState {
  if (orderedIds.length === 0) return state;

  const curIdx = state.focusedId ? orderedIds.indexOf(state.focusedId) : -1;
  const nextIdx =
    curIdx === -1
      ? direction === 'down'
        ? 0
        : orderedIds.length - 1
      : direction === 'down'
        ? Math.min(orderedIds.length - 1, curIdx + 1)
        : Math.max(0, curIdx - 1);

  const nextId = orderedIds[nextIdx];

  if (shiftKey) {
    const effectiveAnchor =
      state.anchorId && orderedIds.includes(state.anchorId)
        ? state.anchorId
        : curIdx !== -1
          ? orderedIds[curIdx]
          : nextId;
    const anchorIdx = orderedIds.indexOf(effectiveAnchor);
    const start = Math.min(anchorIdx, nextIdx);
    const end = Math.max(anchorIdx, nextIdx);
    const nextSelected = new Set<string>();
    for (let i = start; i <= end; i += 1) {
      nextSelected.add(orderedIds[i]);
    }
    return {
      selectedIds: nextSelected,
      focusedId: nextId,
      anchorId: effectiveAnchor,
    };
  }

  return {
    selectedIds: new Set([nextId]),
    focusedId: nextId,
    anchorId: nextId,
  };
}

export function reorderByIndex<T>(
  list: readonly T[],
  fromIndex: number,
  toIndex: number
): T[] {
  if (
    fromIndex < 0 ||
    fromIndex >= list.length ||
    toIndex < 0 ||
    toIndex >= list.length ||
    fromIndex === toIndex
  ) {
    return [...list];
  }
  const next = [...list];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function moveItemByDelta<T>(
  list: readonly T[],
  index: number,
  delta: -1 | 1
): T[] {
  const target = index + delta;
  if (
    index < 0 ||
    index >= list.length ||
    target < 0 ||
    target >= list.length
  ) {
    return [...list];
  }
  return reorderByIndex(list, index, target);
}

export function normalizeDownloadPriority(priority?: unknown): DownloadPriority {
  if (priority === 'high' || priority === 'low') return priority;
  return 'normal';
}

export function getPriorityRank(priority?: DownloadPriority): number {
  if (priority === 'high') return 3;
  if (priority === 'low') return 1;
  return 2;
}

export function cycleDownloadPriority(priority?: DownloadPriority): DownloadPriority {
  if (priority === 'high') return 'low';
  if (priority === 'low') return 'normal';
  return 'high';
}

export function sortItemsByPriority<T extends { priority?: DownloadPriority }>(
  items: readonly T[]
): T[] {
  return [...items].sort(
    (a, b) => getPriorityRank(b.priority) - getPriorityRank(a.priority)
  );
}

