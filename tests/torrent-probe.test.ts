import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import createTorrent from 'create-torrent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DownloadManager } from '../src/main/download-manager';
import { LogManager } from '../src/main/logger';
import {
  TorrentDownloadEngine,
  probeTorrentSource,
  resolveTorrentTargetPath,
} from '../src/main/torrent-engine';

describe('torrent probing', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'myload-torrent-test-'));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('probes a local multi-file .torrent file and extracts files, trackers, and size', async () => {
    const contentDir = path.join(tmpDir, 'sample-release');
    await fs.promises.mkdir(contentDir, { recursive: true });
    await fs.promises.writeFile(path.join(contentDir, 'readme.txt'), 'hello myload');
    await fs.promises.writeFile(path.join(contentDir, 'photo.png'), Buffer.alloc(2048, 7));

    const torrentBuf = await new Promise<Buffer>((resolve, reject) => {
      createTorrent(
        contentDir,
        {
          name: 'sample-release',
          announceList: [['udp://tracker.example.com:80/announce']],
        },
        (err: Error | null, torrent: Buffer) => {
          if (err) reject(err);
          else resolve(torrent);
        }
      );
    });

    const torrentPath = path.join(tmpDir, 'sample-release.torrent');
    await fs.promises.writeFile(torrentPath, torrentBuf);

    const probe = await probeTorrentSource(torrentPath);
    expect(probe.kind).toBe('torrent');
    expect(probe.category).toBe('torrents');
    expect(probe.fileName).toBe('sample-release');
    expect(probe.infoHash).toMatch(/^[a-f0-9]{40}$/i);
    expect(probe.totalBytes).toBe(12 + 2048);
    expect(probe.files?.length).toBe(2);
    expect(probe.trackers).toContain('udp://tracker.example.com:80/announce');
  });

  it('probes magnet URIs cleanly', async () => {
    const magnet =
      'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Ubuntu%20ISO&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337';
    const probe = await probeTorrentSource(magnet);
    expect(probe.kind).toBe('torrent');
    expect(probe.fileName).toBe('Ubuntu ISO');
    expect(probe.infoHash).toBe('0123456789abcdef0123456789abcdef01234567');
    expect(probe.totalBytes).toBeNull();
    expect(probe.trackers?.length).toBeGreaterThanOrEqual(1);
  });

  it('resolves single-file, multi-file folder, and safe fallback torrent paths', () => {
    const saveDir = path.join(tmpDir, 'Downloads');
    expect(
      resolveTorrentTargetPath(saveDir, 'ubuntu.iso', ['ubuntu.iso'], 'fallback')
    ).toBe(path.resolve(saveDir, 'ubuntu.iso'));

    expect(
      resolveTorrentTargetPath(
        saveDir,
        'ReleasePack',
        ['ReleasePack/sub/track1.flac', 'ReleasePack/cover.jpg'],
        'fallback'
      )
    ).toBe(path.resolve(saveDir, 'ReleasePack'));

    expect(
      resolveTorrentTargetPath(saveDir, 'safe-folder', ['../outside.exe'], 'fallback')
    ).toBe(path.join(saveDir, 'safe-folder'));
  });

  it('initializes WebTorrent client cleanly and removes bulk selected downloads and folders together', async () => {
    const logger = new LogManager(null);
    const engine = new TorrentDownloadEngine(logger);
    const client = await (
      engine as unknown as { ensureClient: () => Promise<{ add: unknown; destroy: (cb: () => void) => void }> }
    ).ensureClient();
    expect(typeof client.add).toBe('function');
    await engine.destroyAll();

    const saveDir = path.join(tmpDir, 'BulkSave');
    await fs.promises.mkdir(saveDir, { recursive: true });
    const file1 = path.join(saveDir, 'archive-a.zip');
    const folderTarget = path.join(saveDir, 'MoviePack');
    await fs.promises.writeFile(file1, 'zip-data');
    await fs.promises.mkdir(path.join(folderTarget, 'extras'), { recursive: true });
    await fs.promises.writeFile(path.join(folderTarget, 'movie.mkv'), 'video-data');
    await fs.promises.writeFile(path.join(folderTarget, 'extras', 'sub.srt'), 'subs');

    const torrentFile = path.join(tmpDir, 'pack.torrent');
    const torrentBuf = await new Promise<Buffer>((resolve, reject) => {
      createTorrent(
        folderTarget,
        { name: 'MoviePack' },
        (err: Error | null, buf: Buffer) => {
          if (err) reject(err);
          else resolve(buf);
        }
      );
    });
    await fs.promises.writeFile(torrentFile, torrentBuf);

    const manager = new DownloadManager({
      stateFilePath: path.join(tmpDir, 'state.json'),
      logFilePath: null,
      defaultDownloadDir: saveDir,
      appVersion: '1.0.12',
      enableBridge: false,
      powerAdapter: {
        startSleepBlocker: () => 1,
        stopSleepBlocker: () => undefined,
        executeSystemAction: async () => undefined,
      },
    });
    manager.start();

    try {
      const item1 = await manager.addDownload({
        source: 'https://example.com/archive-a.zip',
        saveDir,
        fileName: 'archive-a.zip',
        startPaused: true,
      });
      const item2 = await manager.addDownload({
        source: torrentFile,
        saveDir,
        fileName: 'MoviePack',
        startPaused: true,
      });

      expect(manager.getSnapshot().downloads).toHaveLength(2);
      await manager.removeDownloads([item1.id, item2.id], true);
      expect(manager.getSnapshot().downloads).toHaveLength(0);
      expect(fs.existsSync(file1)).toBe(false);
      expect(fs.existsSync(folderTarget)).toBe(false);
    } finally {
      await manager.shutdown();
    }
  });
});

