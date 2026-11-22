import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DownloadManager } from '../src/main/download-manager';
import { StateStore } from '../src/main/store';
import {
  createDefaultCategoryDirs,
  createDefaultSettings,
  resolveSaveDirForCategory,
  resolveSaveDirForFile,
} from '../src/shared/constants';

describe('Per-file-type directory routing, appVersion, and startup setting', () => {
  let tmpDir: string;
  let managers: DownloadManager[] = [];

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'myload-routing-test-'));
  });

  afterEach(async () => {
    for (const m of managers.splice(0, managers.length)) {
      await m.shutdown();
    }
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('defaults to single folder mode and routes categories only when per-category is enabled', () => {
    const defaultDir = path.join(tmpDir, 'Downloads');
    const videosDir = path.join(tmpDir, 'Videos');
    const imagesDir = path.join(tmpDir, 'Pictures');
    const docsDir = path.join(tmpDir, 'Documents');
    const archivesDir = path.join(tmpDir, 'Archives');
    const torrentsDir = path.join(tmpDir, 'Torrents');

    const settings = createDefaultSettings(defaultDir);
    expect(settings.folderRoutingMode).toBe('single');
    expect(settings.startOnStartup).toBe(true);

    settings.categoryDownloadDirs = {
      ...createDefaultCategoryDirs(),
      videos: videosDir,
      images: imagesDir,
      docs: docsDir,
      archives: archivesDir,
      torrents: torrentsDir,
    };

    expect(resolveSaveDirForFile(settings, 'movie.mp4', 'http')).toBe(defaultDir);
    expect(resolveSaveDirForCategory(settings, 'videos')).toBe(defaultDir);

    settings.folderRoutingMode = 'per-category';
    expect(resolveSaveDirForFile(settings, 'movie.mp4', 'http')).toBe(videosDir);
    expect(resolveSaveDirForFile(settings, 'photo.PNG', 'http')).toBe(imagesDir);
    expect(resolveSaveDirForFile(settings, 'manual.pdf', 'http')).toBe(docsDir);
    expect(resolveSaveDirForFile(settings, 'backup.zip', 'http')).toBe(archivesDir);
    expect(resolveSaveDirForFile(settings, 'release.001', 'http')).toBe(archivesDir);
    expect(resolveSaveDirForFile(settings, 'split.r00', 'http')).toBe(archivesDir);
    expect(resolveSaveDirForFile(settings, 'ubuntu.iso', 'torrent')).toBe(torrentsDir);
    expect(resolveSaveDirForFile(settings, 'linux.torrent', 'http')).toBe(torrentsDir);
    expect(resolveSaveDirForFile(settings, 'installer.exe', 'http')).toBe(defaultDir);
  });

  it('persists folder routing mode, custom category directories, and startOnStartup preference', async () => {
    const stateFile = path.join(tmpDir, 'state.json');
    const store = new StateStore(stateFile, path.join(tmpDir, 'Downloads'));
    const settings = createDefaultSettings(path.join(tmpDir, 'Downloads'));
    settings.folderRoutingMode = 'per-category';
    settings.categoryDownloadDirs.videos = `  ${path.join(tmpDir, 'Movies')}  `;
    settings.startOnStartup = false;

    await store.save([], settings);

    const store2 = new StateStore(stateFile, path.join(tmpDir, 'Downloads'));
    const loaded = store2.load();
    expect(loaded.settings.folderRoutingMode).toBe('per-category');
    expect(loaded.settings.categoryDownloadDirs.videos).toBe(path.join(tmpDir, 'Movies'));
    expect(loaded.settings.categoryDownloadDirs.images).toBe('');
    expect(loaded.settings.startOnStartup).toBe(false);
  });

  it('exposes appVersion in snapshot and saves downloads into the matching category folder', async () => {
    const defaultDir = path.join(tmpDir, 'Downloads');
    const videosDir = path.join(tmpDir, 'Videos');
    const customVideosDir = path.join(tmpDir, 'CustomVideos');

    const manager = new DownloadManager({
      stateFilePath: path.join(tmpDir, 'state.json'),
      logFilePath: null,
      defaultDownloadDir: defaultDir,
      appVersion: '1.2.3',
      enableBridge: false,
      powerAdapter: {
        startSleepBlocker: () => 1,
        stopSleepBlocker: () => {},
        executeSystemAction: async () => {},
      },
    });
    managers.push(manager);
    manager.start();

    expect(manager.getSnapshot().appVersion).toBe('1.2.3');

    manager.updateSettings({
      folderRoutingMode: 'per-category',
      categoryDownloadDirs: {
        ...createDefaultCategoryDirs(),
        videos: videosDir,
      },
    });

    const videoItem = await manager.addDownload({
      source: 'https://example.com/clip.mp4',
      startPaused: true,
    });
    expect(videoItem.saveDir).toBe(videosDir);
    expect(videoItem.filePath).toBe(path.join(videosDir, 'clip.mp4'));

    const otherItem = await manager.addDownload({
      source: 'https://example.com/setup.exe',
      startPaused: true,
    });
    expect(otherItem.saveDir).toBe(defaultDir);

    await manager.addDownload({
      source: 'https://example.com/trailer.mkv',
      saveDir: customVideosDir,
      alwaysUseThisFolder: true,
      startPaused: true,
    });
    const updated = manager.getSettings();
    expect(updated.categoryDownloadDirs.videos).toBe(customVideosDir);
    expect(updated.defaultDownloadDir).toBe(defaultDir);
  });
});

