import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DownloadManager } from '../src/main/download-manager';
import type { GlobalStats } from '../src/shared/types';

async function startThrottledServer(
  payloads: Record<string, Buffer>,
  chunkDelayMs: number,
  chunkSize: number
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

    const range = req.headers.range;
    let start = 0;
    let end = buf.length - 1;
    if (range) {
      const m = range.match(/bytes=(\d+)-(\d*)/);
      if (m) {
        start = Number(m[1]);
        end = m[2] ? Math.min(buf.length - 1, Number(m[2])) : buf.length - 1;
        res.statusCode = 206;
        res.setHeader('Content-Length', String(end - start + 1));
        res.setHeader('Content-Range', `bytes ${start}-${end}/${buf.length}`);
      }
    }

    const slice = buf.subarray(start, end + 1);
    let offset = 0;
    let closed = false;
    req.on('close', () => {
      closed = true;
    });

    const pump = () => {
      if (closed || res.writableEnded) return;
      if (offset >= slice.length) {
        res.end();
        return;
      }
      const next = slice.subarray(offset, Math.min(slice.length, offset + chunkSize));
      offset += next.length;
      res.write(next);
      setTimeout(pump, chunkDelayMs);
    };
    pump();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return { urlBase: `http://127.0.0.1:${port}`, server };
}

async function waitForAllCompleted(
  manager: DownloadManager,
  timeoutMs = 15000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const items = manager.getDownloads();
    if (items.length > 0 && items.every((i) => i.status === 'completed')) {
      return;
    }
    const errored = items.find((i) => i.status === 'error');
    if (errored) {
      throw new Error(`Download failed unexpectedly: ${errored.errorMessage}`);
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error('Timed out waiting for downloads to complete');
}

describe('Multi-download queue modes', () => {
  let tmpDir: string;
  let servers: http.Server[] = [];
  let managers: DownloadManager[] = [];

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'myload-queue-test-'));
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

  it('sequential mode downloads strictly one file at a time then starts the next', async () => {
    const fileA = Buffer.alloc(64 * 1024, 0x61);
    const fileB = Buffer.alloc(64 * 1024, 0x62);
    const fileC = Buffer.alloc(64 * 1024, 0x63);

    const { urlBase, server } = await startThrottledServer(
      { '/a.bin': fileA, '/b.bin': fileB, '/c.bin': fileC },
      25,
      16 * 1024
    );
    servers.push(server);

    const observedActiveCounts: number[] = [];
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
          const active = items.filter(
            (d) => d.status === 'downloading' || d.status === 'probing'
          ).length;
          observedActiveCounts.push(active);
        },
        onStatsUpdated: (stats: GlobalStats) => {
          observedActiveCounts.push(stats.activeCount);
        },
      },
    });
    managers.push(manager);
    manager.start();

    await manager.updateSettings({
      maxConcurrentDownloads: 3,
      httpConnections: 1,
      queueMode: 'sequential',
    });

    const created = await manager.addBatchDownloads(
      [
        { source: `${urlBase}/a.bin`, saveDir: tmpDir },
        { source: `${urlBase}/b.bin`, saveDir: tmpDir },
        { source: `${urlBase}/c.bin`, saveDir: tmpDir },
      ],
      'sequential'
    );

    expect(created).toHaveLength(3);
    await waitForAllCompleted(manager);

    const maxObservedActive = Math.max(0, ...observedActiveCounts);
    expect(maxObservedActive).toBe(1);

    expect(await fs.promises.readFile(path.join(tmpDir, 'a.bin'))).toEqual(fileA);
    expect(await fs.promises.readFile(path.join(tmpDir, 'b.bin'))).toEqual(fileB);
    expect(await fs.promises.readFile(path.join(tmpDir, 'c.bin'))).toEqual(fileC);
  });

  it('parallel-equal mode completes multiple concurrent downloads evenly with intact bytes', async () => {
    const fileOne = Buffer.alloc(128 * 1024, 0x31);
    const fileTwo = Buffer.alloc(128 * 1024, 0x32);

    const { urlBase, server } = await startThrottledServer(
      { '/one.bin': fileOne, '/two.bin': fileTwo },
      15,
      16 * 1024
    );
    servers.push(server);

    let maxObservedActive = 0;
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
          const active = items.filter(
            (d) => d.status === 'downloading' || d.status === 'probing'
          ).length;
          if (active > maxObservedActive) maxObservedActive = active;
        },
      },
    });
    managers.push(manager);
    manager.start();

    await manager.updateSettings({
      maxConcurrentDownloads: 4,
      httpConnections: 2,
      queueMode: 'parallel-equal',
      downloadSpeedLimitEnabled: true,
      downloadSpeedLimitValue: 300,
      downloadSpeedLimitUnit: 'KB/s',
    });

    const created = await manager.addBatchDownloads(
      [
        { source: `${urlBase}/one.bin`, saveDir: tmpDir },
        { source: `${urlBase}/two.bin`, saveDir: tmpDir },
      ],
      'parallel-equal'
    );

    expect(created).toHaveLength(2);
    await waitForAllCompleted(manager);

    expect(maxObservedActive).toBeGreaterThanOrEqual(2);
    expect(await fs.promises.readFile(path.join(tmpDir, 'one.bin'))).toEqual(fileOne);
    expect(await fs.promises.readFile(path.join(tmpDir, 'two.bin'))).toEqual(fileTwo);
  });
});

