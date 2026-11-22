import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HttpDownloadEngine } from '../src/main/http-engine';
import { LogManager } from '../src/main/logger';
import { TokenBucket } from '../src/main/throttle';
import type { DownloadItem } from '../src/shared/types';

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

describe('HttpDownloadEngine', () => {
  let tmpDir: string;
  let server: http.Server;
  let baseUrl: string;
  let payload: Buffer;
  let payloadHash: string;
  let chunkDelayMs = 0;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'myload-http-test-'));
    payload = crypto.randomBytes(640 * 1024);
    payloadHash = sha256(payload);
    chunkDelayMs = 0;

    server = http.createServer(async (req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(302, { Location: '/artifact' });
        res.end();
        return;
      }

      if (req.url === '/artifact') {
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Disposition', 'attachment; filename="test-bundle.bin"');
        res.setHeader('Content-Type', 'application/octet-stream');

        const rangeHeader = req.headers.range;
        let start = 0;
        let end = payload.length - 1;
        let status = 200;

        if (rangeHeader) {
          const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
          if (match) {
            start = Number(match[1]);
            end = match[2] ? Math.min(payload.length - 1, Number(match[2])) : payload.length - 1;
            status = 206;
            res.setHeader('Content-Range', `bytes ${start}-${end}/${payload.length}`);
          }
        }

        const slice = payload.subarray(start, end + 1);
        res.setHeader('Content-Length', String(slice.length));
        res.writeHead(status);

        if (req.method === 'HEAD') {
          res.end();
          return;
        }

        if (chunkDelayMs <= 0) {
          res.end(slice);
          return;
        }

        const step = 32 * 1024;
        for (let off = 0; off < slice.length; off += step) {
          if (res.destroyed) return;
          res.write(slice.subarray(off, Math.min(slice.length, off + step)));
          await new Promise((r) => setTimeout(r, chunkDelayMs));
        }
        if (!res.destroyed) res.end();
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('probes redirects, Content-Disposition filenames, size, and range support', async () => {
    const throttle = new TokenBucket(null);
    const logger = new LogManager(null);
    const engine = new HttpDownloadEngine(throttle, logger);

    const probe = await engine.probeUrl(`${baseUrl}/redirect`);
    expect(probe.fileName).toBe('test-bundle.bin');
    expect(probe.totalBytes).toBe(payload.length);
    expect(probe.resumeSupported).toBe(true);
    expect(probe.finalUrl).toBe(`${baseUrl}/artifact`);
  });

  it('downloads via multiple segments with exact SHA-256 integrity', async () => {
    const throttle = new TokenBucket(null);
    const logger = new LogManager(null);
    const engine = new HttpDownloadEngine(throttle, logger);

    const item: DownloadItem = {
      id: 'dl-1',
      kind: 'http',
      source: `${baseUrl}/redirect`,
      name: 'test-bundle.bin',
      saveDir: tmpDir,
      filePath: path.join(tmpDir, 'test-bundle.bin'),
      category: 'other',
      status: 'queued',
      totalBytes: null,
      downloadedBytes: 0,
      uploadedBytes: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      etaSeconds: null,
      resumeSupported: false,
      segments: [],
      addedAt: Date.now(),
      retryCount: 0,
    };

    let completedPath = '';
    let completedBytes = 0;

    await new Promise<void>((resolve, reject) => {
      void engine.start(item, {
        connections: 4,
        maxRetries: 1,
        duplicatePolicy: 'auto-rename',
        onProgress: (patch) => Object.assign(item, patch),
        onComplete: (finalPath, totalBytes) => {
          completedPath = finalPath;
          completedBytes = totalBytes;
          resolve();
        },
        onError: (msg) => reject(new Error(msg)),
      });
    });

    expect(item.segments.length).toBe(4);
    expect(completedBytes).toBe(payload.length);
    expect(fs.existsSync(completedPath)).toBe(true);
    expect(fs.existsSync(`${completedPath}.myload.part`)).toBe(false);

    const diskHash = sha256(await fs.promises.readFile(completedPath));
    expect(diskHash).toBe(payloadHash);
  });

  it('pauses mid-download and resumes cleanly without corrupting bytes', async () => {
    chunkDelayMs = 25;
    const throttle = new TokenBucket(null);
    const logger = new LogManager(null);
    const engine = new HttpDownloadEngine(throttle, logger);

    const item: DownloadItem = {
      id: 'dl-resume',
      kind: 'http',
      source: `${baseUrl}/artifact`,
      name: 'resumable.bin',
      saveDir: tmpDir,
      filePath: path.join(tmpDir, 'resumable.bin'),
      category: 'other',
      status: 'queued',
      totalBytes: null,
      downloadedBytes: 0,
      uploadedBytes: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      etaSeconds: null,
      resumeSupported: false,
      segments: [],
      addedAt: Date.now(),
      retryCount: 0,
    };

    await new Promise<void>((resolve, reject) => {
      let paused = false;
      void engine.start(item, {
        connections: 2,
        maxRetries: 1,
        duplicatePolicy: 'overwrite',
        onProgress: (patch) => {
          Object.assign(item, patch);
          if (!paused && item.downloadedBytes >= 64 * 1024) {
            paused = true;
            engine.pause(item.id);
            setTimeout(resolve, 60);
          }
        },
        onComplete: () => resolve(),
        onError: (m) => reject(new Error(m)),
      });
    });

    const bytesAfterPause = item.downloadedBytes;
    expect(bytesAfterPause).toBeGreaterThan(0);
    expect(bytesAfterPause).toBeLessThan(payload.length);
    expect(fs.existsSync(`${item.filePath}.myload.part`)).toBe(true);

    chunkDelayMs = 0;
    const finalPath = await new Promise<string>((resolve, reject) => {
      void engine.start(item, {
        connections: 2,
        maxRetries: 1,
        duplicatePolicy: 'overwrite',
        onProgress: (patch) => Object.assign(item, patch),
        onComplete: (p) => resolve(p),
        onError: (m) => reject(new Error(m)),
      });
    });

    const diskHash = sha256(await fs.promises.readFile(finalPath));
    expect(diskHash).toBe(payloadHash);
  });

  it('auto-renames duplicate files when auto-rename policy is enabled', async () => {
    const throttle = new TokenBucket(null);
    const logger = new LogManager(null);
    const engine = new HttpDownloadEngine(throttle, logger);

    const existing = path.join(tmpDir, 'test-bundle.bin');
    await fs.promises.writeFile(existing, Buffer.from('already-here'));

    const item: DownloadItem = {
      id: 'dl-dup',
      kind: 'http',
      source: `${baseUrl}/artifact`,
      name: 'test-bundle.bin',
      saveDir: tmpDir,
      filePath: existing,
      category: 'other',
      status: 'queued',
      totalBytes: null,
      downloadedBytes: 0,
      uploadedBytes: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      etaSeconds: null,
      resumeSupported: false,
      segments: [],
      addedAt: Date.now(),
      retryCount: 0,
    };

    const finalPath = await new Promise<string>((resolve, reject) => {
      void engine.start(item, {
        connections: 2,
        maxRetries: 0,
        duplicatePolicy: 'auto-rename',
        onProgress: (patch) => Object.assign(item, patch),
        onComplete: (p) => resolve(p),
        onError: (m) => reject(new Error(m)),
      });
    });

    expect(path.basename(finalPath)).toBe('test-bundle (1).bin');
    expect((await fs.promises.readFile(existing)).toString()).toBe('already-here');
    expect(sha256(await fs.promises.readFile(finalPath))).toBe(payloadHash);
  });

  it('forwards Cookie/Referer on same-host downloads and strips Cookie on cross-host redirects', async () => {
    const throttle = new TokenBucket(null);
    const logger = new LogManager(null);
    const engine = new HttpDownloadEngine(throttle, logger);

    const seenBySameHost: Array<{ cookie?: string; referer?: string }> = [];
    const seenByOtherHost: Array<{ cookie?: string; referer?: string }> = [];

    const sameServer = http.createServer((req, res) => {
      if (req.url === '/protected') {
        seenBySameHost.push({
          cookie: req.headers.cookie,
          referer: req.headers.referer,
        });
        if (req.headers.cookie !== 'auth=token123') {
          res.writeHead(403);
          res.end();
          return;
        }
        const body = Buffer.from('secret-bytes');
        res.writeHead(200, {
          'Content-Length': String(body.length),
          'Accept-Ranges': 'none',
        });
        if (req.method === 'HEAD') res.end();
        else res.end(body);
        return;
      }

      if (req.url === '/hop-to-other') {
        res.writeHead(302, { Location: `http://localhost:${otherPort}/cdn-file` });
        res.end();
        return;
      }
      res.writeHead(404).end();
    });

    const otherServer = http.createServer((req, res) => {
      seenByOtherHost.push({
        cookie: req.headers.cookie,
        referer: req.headers.referer,
      });
      const body = Buffer.from('cdn-bytes');
      res.writeHead(200, { 'Content-Length': String(body.length) });
      if (req.method === 'HEAD') res.end();
      else res.end(body);
    });

    await new Promise<void>((r) => sameServer.listen(0, '127.0.0.1', r));
    await new Promise<void>((r) => otherServer.listen(0, 'localhost', r));
    const samePort = (sameServer.address() as { port: number }).port;
    const otherPort = (otherServer.address() as { port: number }).port;

    try {
      const sameItem: DownloadItem = {
        id: 'dl-auth',
        kind: 'http',
        source: `http://127.0.0.1:${samePort}/protected`,
        name: 'secret.txt',
        saveDir: tmpDir,
        filePath: path.join(tmpDir, 'secret.txt'),
        category: 'docs',
        status: 'queued',
        totalBytes: null,
        downloadedBytes: 0,
        uploadedBytes: 0,
        downloadSpeed: 0,
        uploadSpeed: 0,
        etaSeconds: null,
        resumeSupported: false,
        segments: [],
        requestHeaders: {
          Cookie: 'auth=token123',
          Referer: 'https://portal.example/',
        },
        addedAt: Date.now(),
        retryCount: 0,
      };

      const savedSecret = await new Promise<string>((resolve, reject) => {
        void engine.start(sameItem, {
          connections: 1,
          maxRetries: 0,
          duplicatePolicy: 'overwrite',
          onProgress: (p) => Object.assign(sameItem, p),
          onComplete: (finalPath) => resolve(finalPath),
          onError: (m) => reject(new Error(m)),
        });
      });

      expect((await fs.promises.readFile(savedSecret)).toString()).toBe('secret-bytes');
      expect(seenBySameHost.every((s) => s.cookie === 'auth=token123')).toBe(true);
      expect(seenBySameHost.every((s) => s.referer === 'https://portal.example/')).toBe(true);

      const crossItem: DownloadItem = {
        ...sameItem,
        id: 'dl-cross',
        source: `http://127.0.0.1:${samePort}/hop-to-other`,
        name: 'cdn.txt',
        filePath: path.join(tmpDir, 'cdn.txt'),
        totalBytes: null,
        downloadedBytes: 0,
        segments: [],
      };

      await new Promise<void>((resolve, reject) => {
        void engine.start(crossItem, {
          connections: 1,
          maxRetries: 0,
          duplicatePolicy: 'overwrite',
          onProgress: (p) => Object.assign(crossItem, p),
          onComplete: () => resolve(),
          onError: (m) => reject(new Error(m)),
        });
      });

      expect(seenByOtherHost.length).toBeGreaterThan(0);
      expect(seenByOtherHost.every((s) => s.cookie === undefined)).toBe(true);
    } finally {
      await new Promise<void>((r) => sameServer.close(() => r()));
      await new Promise<void>((r) => otherServer.close(() => r()));
    }
  });

  it('falls back from 403 HEAD/Range probes to plain GET and to electronNet adapter', async () => {
    const bodyBuf = Buffer.from('protected-download-payload-12345');
    const cdnServer = http.createServer((req, res) => {
      if (req.url === '/no-range') {
        if (req.method === 'HEAD' || req.headers.range) {
          res.writeHead(403).end('Forbidden');
          return;
        }
        res.writeHead(200, {
          'Content-Length': String(bodyBuf.length),
          'Content-Type': 'application/octet-stream',
        });
        res.end(bodyBuf);
        return;
      }

      res.writeHead(403).end('TLS blocked');
    });

    await new Promise<void>((r) => cdnServer.listen(0, '127.0.0.1', r));
    const port = (cdnServer.address() as { port: number }).port;

    try {
      const throttle = new TokenBucket(null);
      const logger = new LogManager(null);
      const engineNoFallback = new HttpDownloadEngine(throttle, logger);

      const noRangeProbe = await engineNoFallback.probeUrl(`http://127.0.0.1:${port}/no-range`);
      expect(noRangeProbe.totalBytes).toBe(bodyBuf.length);
      expect(noRangeProbe.resumeSupported).toBe(false);

      const noRangeItem: DownloadItem = {
        id: 'dl-no-range',
        kind: 'http',
        source: `http://127.0.0.1:${port}/no-range`,
        name: 'payload.bin',
        saveDir: tmpDir,
        filePath: path.join(tmpDir, 'payload.bin'),
        category: 'other',
        status: 'queued',
        totalBytes: null,
        downloadedBytes: 0,
        uploadedBytes: 0,
        downloadSpeed: 0,
        uploadSpeed: 0,
        etaSeconds: null,
        resumeSupported: false,
        segments: [],
        addedAt: Date.now(),
        retryCount: 0,
      };

      await new Promise<void>((resolve, reject) => {
        void engineNoFallback.start(noRangeItem, {
          connections: 4,
          maxRetries: 0,
          duplicatePolicy: 'overwrite',
          onProgress: (p) => Object.assign(noRangeItem, p),
          onComplete: () => resolve(),
          onError: (m) => reject(new Error(m)),
        });
      });
      expect(await fs.promises.readFile(path.join(tmpDir, 'payload.bin'))).toEqual(bodyBuf);

      const engineWithAdapter = new HttpDownloadEngine(throttle, logger, {
        electronNet: {
          probe: async (url) => ({
            finalUrl: url,
            statusCode: 200,
            headers: {
              'content-length': String(bodyBuf.length),
              'content-disposition': 'attachment; filename="net-file.bin"',
            },
          }),
          openStream: async () => ({
            statusCode: 200,
            headers: { 'content-length': String(bodyBuf.length) },
            stream: {
              async *[Symbol.asyncIterator]() {
                yield bodyBuf;
              },
            },
            destroy: () => {},
          }),
          fetchBuffer: async (url) => ({
            buffer: bodyBuf,
            finalUrl: url,
            headers: { 'content-length': String(bodyBuf.length) },
          }),
        },
      });

      const blockedUrl = `http://127.0.0.1:${port}/blocked-tls`;
      const adapterProbe = await engineWithAdapter.probeUrl(blockedUrl);
      expect(adapterProbe.fileName).toBe('net-file.bin');
      expect(adapterProbe.totalBytes).toBe(bodyBuf.length);

      const fetched = await engineWithAdapter.fetchBuffer(blockedUrl);
      expect(fetched.buffer).toEqual(bodyBuf);

      const adapterItem: DownloadItem = {
        ...noRangeItem,
        id: 'dl-adapter',
        source: blockedUrl,
        name: 'net-file.bin',
        filePath: path.join(tmpDir, 'net-file.bin'),
        totalBytes: null,
        downloadedBytes: 0,
        segments: [],
      };
      await new Promise<void>((resolve, reject) => {
        void engineWithAdapter.start(adapterItem, {
          connections: 1,
          maxRetries: 0,
          duplicatePolicy: 'overwrite',
          onProgress: (p) => Object.assign(adapterItem, p),
          onComplete: () => resolve(),
          onError: (m) => reject(new Error(m)),
        });
      });
      expect(await fs.promises.readFile(path.join(tmpDir, 'net-file.bin'))).toEqual(bodyBuf);
    } finally {
      await new Promise<void>((r) => cdnServer.close(() => r()));
    }
  });
});

