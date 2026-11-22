import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PowerManager } from '../src/main/power';
import { StateStore, normalizeFilterTabOrder } from '../src/main/store';
import { createDefaultSettings } from '../src/shared/constants';
import type { DownloadItem } from '../src/shared/types';

describe('StateStore and PowerManager', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'myload-store-test-'));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it('persists downloads, custom filter order, and resets autoPowerAction on startup', async () => {
    const stateFile = path.join(tmpDir, 'state.json');
    const store = new StateStore(stateFile, 'C:/Downloads');

    const settings = createDefaultSettings('C:/Downloads');
    settings.autoPowerAction = 'shutdown';
    settings.theme = 'light';
    settings.filterTabOrder = ['torrents', 'all', 'images', 'docs', 'archives', 'videos', 'active', 'completed', 'other'];

    const item: DownloadItem = {
      id: 'item-1',
      kind: 'http',
      source: 'https://example.com/a.zip',
      name: 'a.zip',
      saveDir: 'C:/Downloads',
      filePath: 'C:/Downloads/a.zip',
      category: 'archives',
      status: 'downloading',
      totalBytes: 1000,
      downloadedBytes: 400,
      uploadedBytes: 0,
      downloadSpeed: 500,
      uploadSpeed: 0,
      etaSeconds: 2,
      resumeSupported: true,
      segments: [{ index: 0, start: 0, end: 999, downloaded: 400, speed: 500, status: 'active' }],
      addedAt: 12345,
      retryCount: 0,
    };

    await store.save([item], settings);

    const store2 = new StateStore(stateFile, 'C:/Downloads');
    const loaded = store2.load();
    expect(loaded.settings.autoPowerAction).toBe('off');
    expect(loaded.settings.theme).toBe('light');
    expect(loaded.settings.filterTabOrder[0]).toBe('torrents');
    expect(loaded.downloads[0].status).toBe('queued');
    expect(loaded.downloads[0].downloadSpeed).toBe(0);
    expect(loaded.downloads[0].segments[0].status).toBe('pending');
  });

  it('normalizes corrupted filterTabOrder back to full category set', () => {
    const normalized = normalizeFilterTabOrder(['videos', 'videos', 'bogus']);
    expect(normalized[0]).toBe('videos');
    expect(normalized).toHaveLength(9);
    expect(new Set(normalized).size).toBe(9);
  });

  it('manages sleep blocker and cancelable 60s countdown safely', async () => {
    vi.useFakeTimers();

    const startSleepBlocker = vi.fn(() => 42);
    const stopSleepBlocker = vi.fn();
    const executeSystemAction = vi.fn(async () => {});

    const updates: Array<number | null> = [];
    const pm = new PowerManager(
      {
        startSleepBlocker,
        stopSleepBlocker,
        executeSystemAction,
      },
      {
        onCountdownUpdate: (s) => updates.push(s ? s.remainingSeconds : null),
      }
    );

    expect(pm.setPreventSleep(true)).toBe(true);
    expect(pm.setPreventSleep(true)).toBe(true);
    expect(startSleepBlocker).toHaveBeenCalledTimes(1);

    expect(pm.setPreventSleep(false)).toBe(false);
    expect(stopSleepBlocker).toHaveBeenCalledWith(42);

    pm.startCountdown('shutdown', 5);
    expect(pm.getCountdownState()?.remainingSeconds).toBe(5);
    await vi.advanceTimersByTimeAsync(2000);
    expect(pm.getCountdownState()?.remainingSeconds).toBe(3);

    pm.cancelCountdown();
    expect(pm.getCountdownState()).toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    expect(executeSystemAction).not.toHaveBeenCalled();

    pm.startCountdown('exit', 2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(executeSystemAction).toHaveBeenCalledWith('exit');
    pm.dispose();
  });
});

