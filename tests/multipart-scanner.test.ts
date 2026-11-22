import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { detectPartPattern, scanMultiParts } from '../src/main/multipart-scanner';

describe('Multi-part download scanner', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    for (const s of servers.splice(0, servers.length)) {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });

  it('detects numbered archive patterns and ignores non-multipart names', () => {
    const p1 = detectPartPattern('https://files.example.com/game.part01.rar');
    expect(p1).not.toBeNull();
    expect(p1?.partNumber).toBe(1);
    expect(p1?.buildFileName(12)).toBe('game.part12.rar');

    const p2 = detectPartPattern('https://files.example.com/archive.7z.003');
    expect(p2).not.toBeNull();
    expect(p2?.partNumber).toBe(3);
    expect(p2?.buildFileName(1)).toBe('archive.7z.001');

    const p3 = detectPartPattern('https://files.example.com/bundle.zip.001');
    expect(p3).not.toBeNull();
    expect(p3?.buildFileName(2)).toBe('bundle.zip.002');

    const p4 = detectPartPattern('https://files.example.com/release.r00');
    expect(p4).not.toBeNull();
    expect(p4?.partNumber).toBe(0);
    expect(p4?.buildFileName(4)).toBe('release.r04');

    const p5 = detectPartPattern('https://files.example.com/movie-part2.zip');
    expect(p5).not.toBeNull();
    expect(p5?.partNumber).toBe(2);
    expect(p5?.buildFileName(5)).toBe('movie-part5.zip');

    expect(detectPartPattern('https://files.example.com/app-v1.0.0.exe')).toBeNull();
    expect(detectPartPattern('https://files.example.com/Setup-win64.exe')).toBeNull();
    expect(detectPartPattern('https://files.example.com/photo.jpg')).toBeNull();
  });

  it('discovers all parts backwards and forwards via HEAD probes', async () => {
    const validParts = new Map<string, number>([
      ['/archive.part01.rar', 1024],
      ['/archive.part02.rar', 1024],
      ['/archive.part03.rar', 1024],
      ['/archive.part04.rar', 1024],
      ['/archive.part05.rar', 512],
    ]);

    const server = http.createServer((req, res) => {
      const reqPath = (req.url || '').split('?')[0];
      const len = validParts.get(reqPath);
      if (len === undefined) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Length', String(len));
      res.end();
    });
    servers.push(server);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as AddressInfo;

    const result = await scanMultiParts(
      `http://127.0.0.1:${port}/archive.part03.rar`
    );

    expect(result.matched).toBe(true);
    expect(result.parts.map((p) => p.partNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(result.parts.map((p) => p.fileName)).toEqual([
      'archive.part01.rar',
      'archive.part02.rar',
      'archive.part03.rar',
      'archive.part04.rar',
      'archive.part05.rar',
    ]);
    expect(result.parts[2].isOriginal).toBe(true);
    expect(result.parts[4].totalBytes).toBe(512);
  });

  it('merges webpage anchor candidates with tokenized URLs', async () => {
    const server = http.createServer((_req, res) => {
      res.statusCode = 404;
      res.end();
    });
    servers.push(server);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as AddressInfo;

    const result = await scanMultiParts(
      `http://127.0.0.1:${port}/dl/disk_01.bin?token=a`,
      {
        pageCandidates: [
          {
            url: `http://127.0.0.1:${port}/dl/disk_02.bin?token=b`,
            fileName: 'disk_02.bin',
          },
          {
            url: `http://127.0.0.1:${port}/dl/disk_03.bin?token=c`,
            fileName: 'disk_03.bin',
          },
          {
            url: `http://127.0.0.1:${port}/about.html`,
            fileName: 'About Us',
          },
        ],
      }
    );

    expect(result.matched).toBe(true);
    expect(result.parts).toHaveLength(3);
    expect(result.parts.map((p) => p.partNumber)).toEqual([1, 2, 3]);
  });
});

