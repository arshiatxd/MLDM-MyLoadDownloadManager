import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadManager } from '../src/main/download-manager';
import {
  extractDownloadableSources,
  isLikelyDownloadableUrl,
} from '../src/shared/constants';

describe('Clipboard passive recognition & Add Download prefill', () => {
  let tmpDir: string;
  let managers: DownloadManager[] = [];

  beforeEach(async () => {
    vi.useFakeTimers();
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'myload-clip-test-'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    for (const m of managers.splice(0, managers.length)) {
      await m.shutdown();
    }
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('distinguishes downloadable URLs/magnets/torrents from normal web pages', () => {
    expect(isLikelyDownloadableUrl('https://example.com/files/archive.part01.rar')).toBe(true);
    expect(
      isLikelyDownloadableUrl('https://github.com/org/repo/releases/download/v1.0/MyLoad.exe')
    ).toBe(true);
    expect(
      isLikelyDownloadableUrl('https://drive.usercontent.google.com/download?id=abc&export=download')
    ).toBe(true);
    expect(
      isLikelyDownloadableUrl('https://release-assets.githubusercontent.com/asset/123')
    ).toBe(true);
    expect(
      isLikelyDownloadableUrl('magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567')
    ).toBe(true);
    expect(isLikelyDownloadableUrl('C:\\Downloads\\ubuntu.torrent')).toBe(true);

    expect(
      isLikelyDownloadableUrl('https://github.com/arshiatxd/MLDM-MyLoadDownloadManager')
    ).toBe(false);
    expect(isLikelyDownloadableUrl('https://google.com/search?q=test')).toBe(false);
    expect(isLikelyDownloadableUrl('https://example.com/about.html')).toBe(false);
    expect(isLikelyDownloadableUrl('hello world not a link')).toBe(false);

    const multi = extractDownloadableSources(
      [
        '# comment',
        'https://github.com/arshiatxd/MLDM-MyLoadDownloadManager',
        'https://example.com/part1.zip',
        'https://example.com/part2.zip',
        'https://example.com/part1.zip',
      ].join('\n')
    );
    expect(multi).toEqual([
      'https://example.com/part1.zip',
      'https://example.com/part2.zip',
    ]);
  });

  it('never opens popups when copying links, retains last downloadable link, and clears once consumed', async () => {
    let clipboardText = '';
    const onFocusRequested = vi.fn();
    const onOpenCompactPopup = vi.fn();
    const onBrowserIntercept = vi.fn();

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
        readClipboard: () => clipboardText,
        onFocusRequested,
        onOpenCompactPopup,
        onBrowserIntercept,
      },
    });
    managers.push(manager);
    manager.start();

    const dlUrl = 'https://cdn.example.com/builds/MyLoad-Setup-1.0.0.exe';
    clipboardText = dlUrl;
    await vi.advanceTimersByTimeAsync(1600);

    expect(onFocusRequested).not.toHaveBeenCalled();
    expect(onOpenCompactPopup).not.toHaveBeenCalled();
    expect(onBrowserIntercept).not.toHaveBeenCalled();
    expect(manager.getLogs().some((l) => l.source === 'Clipboard')).toBe(false);

    clipboardText = 'https://github.com/arshiatxd/MLDM-MyLoadDownloadManager';
    await vi.advanceTimersByTimeAsync(1600);
    clipboardText = 'unrelated copied notes';
    await vi.advanceTimersByTimeAsync(1600);

    expect(await manager.getLastCopiedDownloadableLink()).toBe(dlUrl);

    clipboardText = dlUrl;
    await manager.addDownload({
      source: dlUrl,
      saveDir: tmpDir,
      startPaused: true,
    });

    expect(await manager.getLastCopiedDownloadableLink()).toBeNull();

    clipboardText = 'temporary note';
    await vi.advanceTimersByTimeAsync(1600);
    clipboardText = dlUrl;
    await vi.advanceTimersByTimeAsync(1600);
    expect(await manager.getLastCopiedDownloadableLink()).toBe(dlUrl);

    const nextUrl = 'https://cdn.example.com/builds/archive.part01.rar';
    clipboardText = nextUrl;
    await vi.advanceTimersByTimeAsync(1600);
    expect(await manager.getLastCopiedDownloadableLink()).toBe(nextUrl);

    manager.updateSettings({ watchClipboard: false });
    expect(await manager.getLastCopiedDownloadableLink()).toBeNull();
  });
});

