import fs from 'node:fs';
import http from 'node:http';
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
  saveTorrentBufferToCache,
} from '../src/main/torrent-engine';
import { buildTorrentTree } from '../src/shared/torrent-tree';
import type { BrowserInterceptPayload } from '../src/shared/types';

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

  it('builds hierarchical torrent folder trees, aggregates sizes, and filters cleanly', () => {
    const tree = buildTorrentTree([
      { index: 0, name: 'data1.bin', path: 'GamePack/data/data1.bin', length: 5000, downloaded: 2500, selected: true },
      { index: 1, name: 'data2.bin', path: 'GamePack/data/data2.bin', length: 3000, downloaded: 1500, selected: true },
      { index: 2, name: 'setup.exe', path: 'GamePack/setup.exe', length: 1200, downloaded: 1200, selected: false },
      { index: 3, name: 'readme.txt', path: 'GamePack/docs/readme.txt', length: 400, downloaded: 0, selected: true },
    ]);

    expect(tree).toHaveLength(1);
    const root = tree[0];
    expect(root.isFolder).toBe(true);
    expect(root.name).toBe('GamePack');
    expect(root.totalBytes).toBe(9600);
    expect(root.downloadedBytes).toBe(5200);
    expect(root.fileIndices).toEqual([0, 1, 3, 2]);
    expect(root.children[0].name).toBe('data');
    expect(root.children[0].totalBytes).toBe(8000);
    expect(root.children[1].name).toBe('docs');
    expect(root.children[2].name).toBe('setup.exe');

    const filtered = buildTorrentTree(
      [
        { index: 0, name: 'data1.bin', path: 'GamePack/data/data1.bin', length: 5000, downloaded: 0, selected: true },
        { index: 1, name: 'setup.exe', path: 'GamePack/setup.exe', length: 1200, downloaded: 0, selected: true },
      ],
      'setup'
    );
    expect(filtered[0].children).toHaveLength(1);
    expect(filtered[0].children[0].name).toBe('setup.exe');
    expect(filtered[0].totalBytes).toBe(1200);
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

  it('resolves base64 .torrent browser intercepts and remote .torrent URLs into cached local torrents with full file tree', async () => {
    const contentDir = path.join(tmpDir, 'Distro');
    await fs.promises.mkdir(path.join(contentDir, 'iso'), { recursive: true });
    await fs.promises.writeFile(path.join(contentDir, 'iso', 'linux.iso'), Buffer.alloc(4096, 1));
    await fs.promises.writeFile(path.join(contentDir, 'CHECKSUMS.txt'), 'abc123');

    const torrentBuf = await new Promise<Buffer>((resolve, reject) => {
      createTorrent(
        contentDir,
        { name: 'Distro' },
        (err: Error | null, buf: Buffer) => {
          if (err) reject(err);
          else resolve(buf);
        }
      );
    });

    const cached = await saveTorrentBufferToCache(torrentBuf, path.join(tmpDir, 'cache'));
    expect(fs.existsSync(cached.filePath)).toBe(true);
    expect(cached.probe.files).toHaveLength(2);

    const server = http.createServer((req, res) => {
      if (req.url === '/release.torrent') {
        res.writeHead(200, {
          'Content-Type': 'application/x-bittorrent',
          'Content-Length': String(torrentBuf.length),
        });
        if (req.method === 'HEAD') res.end();
        else res.end(torrentBuf);
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;

    const capturedPayloads: BrowserInterceptPayload[] = [];
    const manager = new DownloadManager({
      stateFilePath: path.join(tmpDir, 'state-intercept.json'),
      logFilePath: null,
      defaultDownloadDir: tmpDir,
      enableBridge: false,
      powerAdapter: {
        startSleepBlocker: () => 1,
        stopSleepBlocker: () => undefined,
        executeSystemAction: async () => undefined,
      },
      callbacks: {
        onOpenCompactPopup: (session) => {
          if (session.initialPayload) capturedPayloads.push(session.initialPayload);
        },
      },
    });
    manager.start();

    try {
      await manager.updateSettings({
        useCompactDownloadPopup: true,
        showConfirmationDialog: true,
        autoDownloadOnClick: false,
      });

      const handleIntercept = (
        manager as unknown as {
          handleBrowserIntercept: (p: BrowserInterceptPayload) => Promise<'confirm' | 'started'>;
        }
      ).handleBrowserIntercept.bind(manager);

      const mode = await handleIntercept({
        url: 'https://tracker.example/Distro.torrent',
        fileName: 'Distro.torrent',
        mime: 'application/x-bittorrent',
        torrentDataBase64: Buffer.from(torrentBuf).toString('base64'),
      });
      expect(mode).toBe('confirm');
      expect(manager.getSnapshot().logs.filter((l) => l.level === 'warn')).toEqual([]);
      expect(capturedPayloads).toHaveLength(1);
      expect(capturedPayloads[0].url).toBe(
        path.join(tmpDir, 'torrents', `${cached.probe.infoHash}.torrent`)
      );
      expect(fs.existsSync(capturedPayloads[0].url)).toBe(true);
      expect(capturedPayloads[0].torrentDataBase64).toBeUndefined();

      const httpProbe = await manager.probeSource(`http://127.0.0.1:${port}/release.torrent`);
      expect(httpProbe.kind).toBe('torrent');
      expect(httpProbe.files).toHaveLength(2);
      expect(httpProbe.totalBytes).toBe(4096 + 6);
    } finally {
      await manager.shutdown();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('discovers magnet ut_metadata from a live peer without timing out and downloads selected files rapidly', async () => {
    const seedContentDir = path.join(tmpDir, 'SeedPack');
    await fs.promises.mkdir(path.join(seedContentDir, 'bin'), { recursive: true });
    const payloadA = Buffer.alloc(32768, 0x5a);
    const payloadB = Buffer.from('readme-contents-for-torrent-test');
    await fs.promises.writeFile(path.join(seedContentDir, 'bin', 'app.bin'), payloadA);
    await fs.promises.writeFile(path.join(seedContentDir, 'notes.txt'), payloadB);

    const torrentBuf = await new Promise<Buffer>((resolve, reject) => {
      createTorrent(
        seedContentDir,
        {
          name: 'SeedPack',
          pieceLength: 16384,
          private: true,
        },
        (err: Error | null, buf: Buffer) => {
          if (err) reject(err);
          else resolve(buf);
        }
      );
    });

    const { default: WebTorrentCtor } = await import('webtorrent');
    const seeder = new WebTorrentCtor({
      dht: false,
      tracker: false,
      lsd: false,
      utp: false,
    });

    const cacheDir = path.join(tmpDir, 'magnet-cache');
    const destDir = path.join(tmpDir, 'magnet-dest');
    const logger = new LogManager(null);
    const engine = new TorrentDownloadEngine(logger, cacheDir);

    try {
      const seededTorrent = await new Promise<{ infoHash: string }>((resolve, reject) => {
        const t = seeder.add(torrentBuf, { path: tmpDir });
        t.once('ready', () => resolve({ infoHash: t.infoHash }));
        t.once('error', reject);
      });

      const seederAddr = (
        seeder as unknown as { address: () => { port: number } | null }
      ).address();
      expect(seederAddr?.port).toBeGreaterThan(0);

      const magnetUri = `magnet:?xt=urn:btih:${seededTorrent.infoHash}&dn=SeedPack&x.pe=127.0.0.1:${seederAddr!.port}`;
      const startMs = Date.now();
      const probed = await engine.probeMagnetMetadata(magnetUri, cacheDir, 8000);
      const elapsedMs = Date.now() - startMs;

      expect(elapsedMs).toBeLessThan(5000);
      expect(probed.warning).toBeUndefined();
      expect(probed.files?.length).toBe(2);
      expect(probed.totalBytes).toBe(payloadA.length + payloadB.length);
      expect(fs.existsSync(path.join(cacheDir, `${seededTorrent.infoHash}.torrent`))).toBe(true);

      await fs.promises.unlink(path.join(cacheDir, `${seededTorrent.infoHash}.torrent`));

      const appFileIndex = probed.files!.find((f) => f.name === 'app.bin')!.index;
      const notesFileIndex = probed.files!.find((f) => f.name === 'notes.txt')!.index;

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Torrent download timed out')), 8000);
        void engine.start(
          {
            id: 'live-swarm-item',
            kind: 'torrent',
            source: magnetUri,
            name: 'SeedPack',
            saveDir: destDir,
            filePath: path.join(destDir, 'SeedPack'),
            category: 'torrents',
            status: 'downloading',
            totalBytes: payloadA.length,
            downloadedBytes: 0,
            uploadedBytes: 0,
            downloadSpeed: 0,
            uploadSpeed: 0,
            etaSeconds: null,
            resumeSupported: true,
            segments: [],
            addedAt: Date.now(),
            retryCount: 0,
            torrent: {
              infoHash: seededTorrent.infoHash,
              peers: 0,
              seeds: 0,
              ratio: 0,
              trackers: [],
              magnetUri,
              files: [
                { ...probed.files![appFileIndex], selected: true },
                { ...probed.files![notesFileIndex], selected: false },
              ],
            },
          },
          {
            keepSeedingAfterComplete: false,
            onProgress: () => {},
            onDownloadComplete: () => {
              clearTimeout(timeout);
              resolve();
            },
            onError: (msg) => {
              clearTimeout(timeout);
              reject(new Error(msg));
            },
          }
        );
      });

      const downloadedApp = await fs.promises.readFile(
        path.join(destDir, 'SeedPack', 'bin', 'app.bin')
      );
      expect(downloadedApp.equals(payloadA)).toBe(true);
    } finally {
      await engine.destroyAll();
      await new Promise<void>((resolve) => {
        try {
          seeder.destroy(() => resolve());
        } catch {
          resolve();
        }
      });
    }
  });
});

