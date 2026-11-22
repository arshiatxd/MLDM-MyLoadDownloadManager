import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DownloadManager } from '../src/main/download-manager';
import { normalizeDownloadsOnLoad } from '../src/main/store';
import {
  computeArrowSelection,
  computeCheckboxSelection,
  computeRowClickSelection,
  cycleDownloadPriority,
  moveItemByDelta,
  normalizeDownloadPriority,
  reorderByIndex,
  sortItemsByPriority,
  type SelectionState,
} from '../src/shared/selection';
import type { DownloadItem } from '../src/shared/types';

function makeEmptySelection(): SelectionState {
  return { selectedIds: new Set<string>(), focusedId: null, anchorId: null };
}

function makeBaseItem(overrides: Partial<DownloadItem>): DownloadItem {
  return {
    id: 'item-1',
    kind: 'http',
    source: 'https://example.com/file.bin',
    name: 'file.bin',
    saveDir: os.tmpdir(),
    filePath: path.join(os.tmpdir(), 'file.bin'),
    category: 'other',
    status: 'paused',
    totalBytes: 1024,
    downloadedBytes: 0,
    uploadedBytes: 0,
    downloadSpeed: 0,
    uploadSpeed: 0,
    etaSeconds: null,
    resumeSupported: true,
    segments: [],
    addedAt: 1,
    retryCount: 0,
    ...overrides,
  };
}

async function startPayloadServer(
  payloads: Record<string, Buffer>
): Promise<{ urlBase: string; server: http.Server }> {
  const server = http.createServer((req, res) => {
    const cleanPath = (req.url || '/').split('?')[0];
    const buf = payloads[cleanPath];
    if (!buf) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', String(buf.length));
    res.statusCode = 200;
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(buf);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return { urlBase: `http://127.0.0.1:${port}`, server };
}

describe('Table selection helpers', () => {
  const orderedIds = ['a', 'b', 'c', 'd', 'e'];

  it('supports plain LMB, Shift+LMB ranges, Ctrl+LMB toggle, and Ctrl+Shift+LMB additive range', () => {
    let state = makeEmptySelection();

    state = computeRowClickSelection(orderedIds, 'b', state, {
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
    });
    expect([...state.selectedIds]).toEqual(['b']);
    expect(state.focusedId).toBe('b');
    expect(state.anchorId).toBe('b');

    state = computeRowClickSelection(orderedIds, 'e', state, {
      shiftKey: true,
      ctrlKey: false,
      metaKey: false,
    });
    expect([...state.selectedIds]).toEqual(['b', 'c', 'd', 'e']);
    expect(state.focusedId).toBe('e');
    expect(state.anchorId).toBe('b');

    state = computeRowClickSelection(orderedIds, 'a', state, {
      shiftKey: true,
      ctrlKey: false,
      metaKey: false,
    });
    expect([...state.selectedIds]).toEqual(['a', 'b']);
    expect(state.focusedId).toBe('a');
    expect(state.anchorId).toBe('b');

    state = computeRowClickSelection(orderedIds, 'd', state, {
      shiftKey: false,
      ctrlKey: true,
      metaKey: false,
    });
    expect([...state.selectedIds].sort()).toEqual(['a', 'b', 'd']);
    expect(state.focusedId).toBe('d');
    expect(state.anchorId).toBe('d');

    state = computeRowClickSelection(orderedIds, 'd', state, {
      shiftKey: false,
      ctrlKey: true,
      metaKey: false,
    });
    expect([...state.selectedIds].sort()).toEqual(['a', 'b']);

    state = computeRowClickSelection(orderedIds, 'c', state, {
      shiftKey: false,
      ctrlKey: true,
      metaKey: false,
    });
    state = computeRowClickSelection(orderedIds, 'e', state, {
      shiftKey: true,
      ctrlKey: true,
      metaKey: false,
    });
    expect([...state.selectedIds].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('supports plain and Shift checkbox selection without clearing prior items', () => {
    let state = makeEmptySelection();

    state = computeCheckboxSelection(orderedIds, 'a', state, false);
    expect([...state.selectedIds]).toEqual(['a']);

    state = computeCheckboxSelection(orderedIds, 'c', state, false);
    expect([...state.selectedIds].sort()).toEqual(['a', 'c']);
    expect(state.anchorId).toBe('c');

    state = computeCheckboxSelection(orderedIds, 'e', state, true);
    expect([...state.selectedIds].sort()).toEqual(['a', 'c', 'd', 'e']);
    expect(state.focusedId).toBe('e');
    expect(state.anchorId).toBe('c');
  });

  it('supports ArrowUp, ArrowDown, Shift+ArrowUp, and Shift+ArrowDown navigation and clamping', () => {
    let state = makeEmptySelection();

    state = computeArrowSelection(orderedIds, 'down', state, false);
    expect([...state.selectedIds]).toEqual(['a']);
    expect(state.focusedId).toBe('a');
    expect(state.anchorId).toBe('a');

    state = computeArrowSelection(orderedIds, 'up', makeEmptySelection(), false);
    expect([...state.selectedIds]).toEqual(['e']);
    expect(state.focusedId).toBe('e');

    state = computeArrowSelection(orderedIds, 'down', {
      selectedIds: new Set(['b']),
      focusedId: 'b',
      anchorId: 'b',
    }, false);
    expect([...state.selectedIds]).toEqual(['c']);
    expect(state.anchorId).toBe('c');

    state = computeArrowSelection(orderedIds, 'down', state, true);
    state = computeArrowSelection(orderedIds, 'down', state, true);
    expect([...state.selectedIds]).toEqual(['c', 'd', 'e']);
    expect(state.focusedId).toBe('e');
    expect(state.anchorId).toBe('c');

    state = computeArrowSelection(orderedIds, 'down', state, true);
    expect([...state.selectedIds]).toEqual(['c', 'd', 'e']);
    expect(state.focusedId).toBe('e');

    state = computeArrowSelection(orderedIds, 'up', state, true);
    expect([...state.selectedIds]).toEqual(['c', 'd']);
    expect(state.focusedId).toBe('d');

    state = computeArrowSelection(orderedIds, 'up', state, true);
    state = computeArrowSelection(orderedIds, 'up', state, true);
    expect([...state.selectedIds]).toEqual(['b', 'c']);
    expect(state.focusedId).toBe('b');
    expect(state.anchorId).toBe('c');
  });
});

describe('Multi-part reordering and priority helpers', () => {
  it('reorders items by drag index and delta moves while ignoring out-of-bounds moves', () => {
    const parts = ['p1', 'p2', 'p3', 'p4'];
    expect(reorderByIndex(parts, 0, 2)).toEqual(['p2', 'p3', 'p1', 'p4']);
    expect(reorderByIndex(parts, 3, 1)).toEqual(['p1', 'p4', 'p2', 'p3']);
    expect(reorderByIndex(parts, -1, 2)).toEqual(parts);
    expect(reorderByIndex(parts, 1, 10)).toEqual(parts);

    expect(moveItemByDelta(parts, 1, -1)).toEqual(['p2', 'p1', 'p3', 'p4']);
    expect(moveItemByDelta(parts, 1, 1)).toEqual(['p1', 'p3', 'p2', 'p4']);
    expect(moveItemByDelta(parts, 0, -1)).toEqual(parts);
    expect(moveItemByDelta(parts, 3, 1)).toEqual(parts);
  });

  it('cycles, normalizes, and stably sorts priorities', () => {
    expect(normalizeDownloadPriority(undefined)).toBe('normal');
    expect(normalizeDownloadPriority('high')).toBe('high');
    expect(normalizeDownloadPriority('low')).toBe('low');
    expect(normalizeDownloadPriority('invalid')).toBe('normal');

    expect(cycleDownloadPriority('normal')).toBe('high');
    expect(cycleDownloadPriority('high')).toBe('low');
    expect(cycleDownloadPriority('low')).toBe('normal');

    const sorted = sortItemsByPriority([
      { name: 'low-1', priority: 'low' as const },
      { name: 'norm-1', priority: 'normal' as const },
      { name: 'high-1', priority: 'high' as const },
      { name: 'norm-2', priority: 'normal' as const },
      { name: 'high-2', priority: 'high' as const },
    ]);
    expect(sorted.map((s) => s.name)).toEqual([
      'high-1',
      'high-2',
      'norm-1',
      'norm-2',
      'low-1',
    ]);
  });

  it('preserves and normalizes priority in normalizeDownloadsOnLoad', () => {
    const loaded = normalizeDownloadsOnLoad(
      [
        makeBaseItem({ id: '1', priority: 'high' }),
        makeBaseItem({ id: '2', priority: 'low' }),
        makeBaseItem({ id: '3', priority: undefined }),
      ],
      false,
      false
    );
    expect(loaded.map((d) => d.priority)).toEqual(['high', 'low', 'normal']);
  });
});

describe('DownloadManager priority & custom order batch execution', () => {
  let tmpDir: string;
  const servers: http.Server[] = [];
  const managers: DownloadManager[] = [];

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'myload-priority-test-'));
  });

  afterEach(async () => {
    for (const m of managers.splice(0, managers.length)) {
      await m.shutdown();
    }
    for (const s of servers.splice(0, servers.length)) {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('starts high-priority parts first and preserves custom order within each priority tier', async () => {
    const payloads = {
      '/part3.bin': Buffer.alloc(4096, 0x33),
      '/part1.bin': Buffer.alloc(4096, 0x31),
      '/part2.bin': Buffer.alloc(4096, 0x32),
      '/part4.bin': Buffer.alloc(4096, 0x34),
    };
    const { urlBase, server } = await startPayloadServer(payloads);
    servers.push(server);

    const completedOrder: string[] = [];
    const manager = new DownloadManager({
      stateFilePath: path.join(tmpDir, 'state.json'),
      logFilePath: null,
      defaultDownloadDir: tmpDir,
      enableBridge: false,
      powerAdapter: {
        startSleepBlocker: () => 1,
        stopSleepBlocker: () => {},
        executeSystemAction: async () => {},
      },
      callbacks: {
        onDownloadsUpdated: (items) => {
          for (const item of items) {
            if (item.status === 'completed' && !completedOrder.includes(item.name)) {
              completedOrder.push(item.name);
            }
          }
        },
      },
    });
    managers.push(manager);
    manager.start();

    await manager.updateSettings({
      maxConcurrentDownloads: 1,
      httpConnections: 1,
      queueMode: 'sequential',
    });

    await manager.addBatchDownloads(
      [
        { source: `${urlBase}/part3.bin`, saveDir: tmpDir, fileName: 'part3.bin', priority: 'low' },
        { source: `${urlBase}/part1.bin`, saveDir: tmpDir, fileName: 'part1.bin', priority: 'normal' },
        { source: `${urlBase}/part4.bin`, saveDir: tmpDir, fileName: 'part4.bin', priority: 'high' },
        { source: `${urlBase}/part2.bin`, saveDir: tmpDir, fileName: 'part2.bin', priority: 'normal' },
      ],
      'sequential'
    );

    const deadline = Date.now() + 10000;
    while (completedOrder.length < 4 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }

    expect(completedOrder).toEqual([
      'part4.bin',
      'part1.bin',
      'part2.bin',
      'part3.bin',
    ]);
  });
});

