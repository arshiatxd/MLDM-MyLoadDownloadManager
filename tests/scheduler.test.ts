import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DownloadManager } from '../src/main/download-manager';
import { StateStore } from '../src/main/store';
import {
  createDefaultSettings,
  formatTimestampToTimeInput,
  resolveScheduledTimestamp,
} from '../src/shared/constants';

function startHoldHttpServer(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const sockets = new Set<import('node:net').Socket>();
    const server = http.createServer((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(10 * 1024 * 1024),
        'Accept-Ranges': 'none',
      });
      res.write(Buffer.alloc(1024, 65));
    });
    server.on('connection', (sock) => {
      sockets.add(sock);
      sock.on('close', () => sockets.delete(sock));
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/payload.bin`,
        close: () =>
          new Promise<void>((resClose) => {
            for (const s of sockets) s.destroy();
            server.close(() => resClose());
          }),
      });
    });
  });
}

describe('Download scheduling', () => {
  const managers: DownloadManager[] = [];
  const tempDirs: string[] = [];
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(managers.splice(0).map((m) => m.shutdown()));
    await Promise.all(closers.splice(0).map((fn) => fn()));
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
    );
  });

  it('resolves local HH:MM strings to future start and post-start stop timestamps', () => {
    const ref = new Date(2026, 10, 22, 14, 30, 0, 0).getTime();

    const laterToday = resolveScheduledTimestamp('16:45', ref);
    expect(laterToday).not.toBeNull();
    expect(formatTimestampToTimeInput(laterToday)).toBe('16:45');
    expect(new Date(laterToday!).getDate()).toBe(22);

    const passedToday = resolveScheduledTimestamp('10:15', ref);
    expect(passedToday).not.toBeNull();
    expect(formatTimestampToTimeInput(passedToday)).toBe('10:15');
    expect(new Date(passedToday!).getDate()).toBe(23);

    const stopAfterStart = resolveScheduledTimestamp('02:00', ref, laterToday!);
    expect(stopAfterStart).not.toBeNull();
    expect(stopAfterStart!).toBeGreaterThan(laterToday!);
    expect(new Date(stopAfterStart!).getDate()).toBe(23);
  });

  it('defers scheduled download until startAt and pauses it at stopAt', async () => {
    const srv = await startHoldHttpServer();
    closers.push(srv.close);

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'myload-sched-mgr-'));
    tempDirs.push(tmpDir);
    const saveDir = path.join(tmpDir, 'Downloads');
    await fs.mkdir(saveDir, { recursive: true });

    const manager = new DownloadManager({
      stateFilePath: path.join(tmpDir, 'state.json'),
      logFilePath: null,
      defaultDownloadDir: saveDir,
      appVersion: '1.0.1',
      enableBridge: false,
      powerAdapter: {
        startSleepBlocker: () => 1,
        stopSleepBlocker: () => undefined,
        executeSystemAction: async () => undefined,
      },
    });
    managers.push(manager);
    manager.start();

    const now = Date.now();
    const startAt = now + 60_000;
    const stopAt = now + 120_000;

    const created = await manager.addDownload({
      source: srv.url,
      saveDir,
      fileName: 'scheduled.bin',
      schedule: { startAt, stopAt },
    });

    expect(created.status).toBe('paused');
    expect(created.schedule).toEqual({ startAt, stopAt });

    await manager.processSchedules(now + 10_000);
    expect(manager.getSnapshot().downloads[0].status).toBe('paused');

    await manager.processSchedules(startAt + 50);
    const afterStart = manager.getSnapshot().downloads[0];
    expect(['queued', 'probing', 'downloading']).toContain(afterStart.status);
    expect(afterStart.schedule).toEqual({ stopAt });

    await manager.processSchedules(stopAt + 50);
    const afterStop = manager.getSnapshot().downloads[0];
    expect(afterStop.status).toBe('paused');
    expect(afterStop.schedule).toBeUndefined();
  });

  it('updates and clears schedules via updateDownloadSchedule including pausing active items', async () => {
    const srv = await startHoldHttpServer();
    closers.push(srv.close);

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'myload-sched-edit-'));
    tempDirs.push(tmpDir);
    const saveDir = path.join(tmpDir, 'Downloads');
    await fs.mkdir(saveDir, { recursive: true });

    const manager = new DownloadManager({
      stateFilePath: path.join(tmpDir, 'state.json'),
      logFilePath: null,
      defaultDownloadDir: saveDir,
      appVersion: '1.0.1',
      enableBridge: false,
      powerAdapter: {
        startSleepBlocker: () => 1,
        stopSleepBlocker: () => undefined,
        executeSystemAction: async () => undefined,
      },
    });
    managers.push(manager);
    manager.start();

    const immediate = await manager.addDownload({
      source: srv.url,
      saveDir,
      fileName: 'live.bin',
    });
    expect(['queued', 'probing', 'downloading']).toContain(immediate.status);

    const futureStart = Date.now() + 90_000;
    const rescheduled = await manager.updateDownloadSchedule(immediate.id, {
      startAt: futureStart,
    });
    expect(rescheduled?.status).toBe('paused');
    expect(rescheduled?.schedule).toEqual({ startAt: futureStart });

    const cleared = await manager.updateDownloadSchedule(immediate.id, null);
    expect(cleared?.schedule).toBeUndefined();
  });

  it('persists showScheduleInPopup setting and item schedule across StateStore reload', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'myload-sched-store-'));
    tempDirs.push(tmpDir);
    const defaultDir = path.join(tmpDir, 'Downloads');
    const stateFile = path.join(tmpDir, 'state.json');

    const store = new StateStore(stateFile, defaultDir);
    const initial = store.load();
    expect(initial.settings.showScheduleInPopup).toBe(true);

    const futureStart = Date.now() + 180_000;
    const futureStop = Date.now() + 360_000;
    const settings = {
      ...createDefaultSettings(defaultDir),
      showScheduleInPopup: false,
    };

    await store.save(
      [
        {
          id: 'dl-1',
          kind: 'http',
          source: 'https://example.com/archive.zip',
          name: 'archive.zip',
          saveDir: defaultDir,
          filePath: path.join(defaultDir, 'archive.zip'),
          category: 'archives',
          status: 'queued',
          totalBytes: 1024,
          downloadedBytes: 0,
          uploadedBytes: 0,
          downloadSpeed: 0,
          uploadSpeed: 0,
          etaSeconds: null,
          resumeSupported: true,
          segments: [],
          addedAt: Date.now(),
          retryCount: 0,
          schedule: { startAt: futureStart, stopAt: futureStop },
        },
      ],
      settings
    );

    const reloaded = store.load();
    expect(reloaded.settings.showScheduleInPopup).toBe(false);
    expect(reloaded.downloads[0].status).toBe('paused');
    expect(reloaded.downloads[0].schedule).toEqual({
      startAt: futureStart,
      stopAt: futureStop,
    });
  });
});

