import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserBridgeServer } from '../src/main/bridge';
import {
  formatDownloadError,
  isNonRetryableSystemError,
  validateSaveDirectory,
} from '../src/main/fs-validation';
import { LogManager } from '../src/main/logger';
import { scanMultiParts } from '../src/main/multipart-scanner';
import {
  isPathInsideDir,
  redactSensitiveUrl,
  sanitizeOutgoingHeaders,
  stripUnsafeRedirectHeaders,
} from '../src/main/security';
import { hasUnsafeFileNameWarning, sanitizeFileName } from '../src/shared/constants';

describe('Security, privacy, directory & storage validation', () => {
  let tmpDir: string;
  let bridge: BrowserBridgeServer | null = null;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'myload-sec-test-'));
  });

  afterEach(async () => {
    if (bridge) {
      await bridge.stop();
      bridge = null;
    }
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('sanitizes unsafe filenames, reserved Windows device names, and overlong names', () => {
    expect(sanitizeFileName('CON')).toBe('_CON');
    expect(sanitizeFileName('nul.txt')).toBe('_nul.txt');
    expect(sanitizeFileName('COM1.zip')).toBe('_COM1.zip');
    expect(sanitizeFileName('..')).toBe('download');
    expect(sanitizeFileName('bad<file>:name?.iso')).toBe('bad_file__name_.iso');

    expect(hasUnsafeFileNameWarning('CON.txt')).toContain('reserved Windows device name');
    expect(hasUnsafeFileNameWarning('a<b>c.zip')).toContain('Special characters');
    expect(hasUnsafeFileNameWarning('normal-file.zip')).toBeNull();

    const longName = `${'a'.repeat(210)}.tar.gz`;
    const shortened = sanitizeFileName(longName);
    expect(shortened.length).toBeLessThanOrEqual(180);
    expect(shortened.endsWith('.gz')).toBe(true);
    expect(hasUnsafeFileNameWarning(longName)).toContain('exceeds 180');
  });

  it('enforces directory containment and blocks path traversal', () => {
    const base = path.join(tmpDir, 'downloads');
    expect(isPathInsideDir(base, path.join(base, 'movie.mp4'))).toBe(true);
    expect(isPathInsideDir(base, path.join(base, 'sub', 'part.bin'))).toBe(true);
    expect(isPathInsideDir(base, base)).toBe(false);
    expect(isPathInsideDir(base, path.join(base, '..', 'secret.txt'))).toBe(false);
  });

  it('sanitizes CRLF header injection and strips cookies/referer on unsafe redirects', () => {
    const safe = sanitizeOutgoingHeaders({
      Cookie: 'session=abc',
      Referer: 'https://origin.example/page',
      'User-Agent': 'Evil\r\nX-Injected: 1',
      Authorization: 'Bearer secret',
    });
    expect(safe).toEqual({
      Cookie: 'session=abc',
      Referer: 'https://origin.example/page',
    });

    const crossHost = stripUnsafeRedirectHeaders(
      safe,
      'https://a.example.com/file.zip',
      'https://cdn.other.com/file.zip'
    );
    expect(crossHost.Cookie).toBeUndefined();
    expect(crossHost.Referer).toBe('https://origin.example/page');

    const downgrade = stripUnsafeRedirectHeaders(
      safe,
      'https://a.example.com/file.zip',
      'http://a.example.com/file.zip'
    );
    expect(downgrade.Cookie).toBeUndefined();
    expect(downgrade.Referer).toBeUndefined();
  });

  it('redacts embedded credentials and query tokens in logged URLs', () => {
    const redacted = redactSensitiveUrl(
      'https://alice:hunter2@dl.example.com/archive.zip?token=topsecret&id=42#frag'
    );
    expect(redacted).not.toContain('alice');
    expect(redacted).not.toContain('hunter2');
    expect(redacted).not.toContain('topsecret');
    expect(redacted).not.toContain('#frag');
    expect(redacted).toContain('token=***');
  });

  it('validates save directories for empty, relative, illegal, missing drive, file target, creatable subfolder, and full disk', async () => {
    const emptyRes = await validateSaveDirectory('');
    expect(emptyRes.valid).toBe(false);
    expect(emptyRes.errorCode).toBe('EMPTY_PATH');

    const relRes = await validateSaveDirectory('Downloads\\Sub');
    expect(relRes.valid).toBe(false);
    expect(relRes.errorCode).toBe('INVALID_PATH');

    const illegalRes = await validateSaveDirectory(path.join(tmpDir, 'bad<folder>'));
    expect(illegalRes.valid).toBe(false);
    expect(illegalRes.errorCode).toBe('INVALID_PATH');

    const existingFile = path.join(tmpDir, 'not-a-dir.txt');
    await fs.promises.writeFile(existingFile, 'hello', 'utf-8');
    const fileRes = await validateSaveDirectory(existingFile);
    expect(fileRes.valid).toBe(false);
    expect(fileRes.errorCode).toBe('NOT_A_DIRECTORY');

    if (process.platform === 'win32') {
      let unusedLetter: string | null = null;
      for (const ch of 'ZYXWVUTSRQPONMLKJIHGFED') {
        if (!fs.existsSync(`${ch}:\\`)) {
          unusedLetter = ch;
          break;
        }
      }
      if (unusedLetter) {
        const missingDrive = await validateSaveDirectory(`${unusedLetter}:\\MyLoadMissing`);
        expect(missingDrive.valid).toBe(false);
        expect(missingDrive.errorCode).toBe('DRIVE_NOT_FOUND');
      }
    }

    const newSubfolder = path.join(tmpDir, 'brand-new-subfolder');
    const okNew = await validateSaveDirectory(newSubfolder, 1024);
    expect(okNew.valid).toBe(true);
    expect(okNew.willCreate).toBe(true);
    expect(okNew.warning).toContain('will be created automatically');

    const fullRes = await validateSaveDirectory(tmpDir, Number.MAX_SAFE_INTEGER);
    expect(fullRes.valid).toBe(false);
    expect(fullRes.errorCode).toBe('DISK_FULL');
    expect(fullRes.error).toContain('Not enough storage space');
  });

  it('maps system/network/HTTP errors cleanly and marks storage & permission errors non-retryable', () => {
    const enospc = Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
    const eacces = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    const enoent = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    const dns = Object.assign(new Error('getaddrinfo ENOTFOUND example.invalid'), {
      code: 'ENOTFOUND',
    });
    const tls = Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' });

    expect(isNonRetryableSystemError(enospc)).toBe(true);
    expect(isNonRetryableSystemError(eacces)).toBe(true);
    expect(isNonRetryableSystemError(tls)).toBe(true);
    expect(isNonRetryableSystemError(dns)).toBe(false);

    expect(formatDownloadError(enospc, { saveDir: 'D:\\Down' })).toContain('Storage full');
    expect(formatDownloadError(eacces, { saveDir: 'D:\\Down' })).toContain('Permission denied');
    expect(formatDownloadError(enoent, { saveDir: 'D:\\Down' })).toContain('Folder or drive not found');
    expect(formatDownloadError(dns)).toContain('DNS lookup failed');
    expect(formatDownloadError(tls)).toContain('SSL/TLS certificate');
    expect(formatDownloadError(new Error('HTTP 403'))).toContain('Access denied');
    expect(formatDownloadError(new Error('HTTP 404'))).toContain('File not found on server');
    expect(formatDownloadError(new Error('HTTP 429'))).toContain('Too many requests');
  });

  it('rejects null and file:// origins on BrowserBridgeServer', async () => {
    const logger = new LogManager(null);
    bridge = new BrowserBridgeServer(logger, {
      getHealth: () => ({
        activeCount: 0,
        totalDownloadSpeed: 0,
        showConfirmationDialog: true,
      }),
      onFocusWindow: vi.fn(),
      onIntercept: vi.fn(async () => 'confirm' as const),
    });

    const status = await bridge.start(0);

    const nullOrigin = await fetch(`http://127.0.0.1:${status.port}/api/v1/health`, {
      headers: {
        Origin: 'null',
        'X-MyLoad-Client': 'myload-extension',
      },
    });
    expect(nullOrigin.status).toBe(403);

    const fileOrigin = await fetch(`http://127.0.0.1:${status.port}/api/v1/health`, {
      headers: {
        Origin: 'file://',
        'X-MyLoad-Client': 'myload-extension',
      },
    });
    expect(fileOrigin.status).toBe(403);
  });

  it('ignores cross-origin and localhost SSRF pageCandidates during multi-part scan', async () => {
    const probedUrls: string[] = [];
    const res = await scanMultiParts('https://files.example.com/archive.part01.rar', {
      probeFn: async (url) => {
        probedUrls.push(url);
        return { ok: false, totalBytes: null };
      },
      pageCandidates: [
        { url: 'http://127.0.0.1:49173/archive.part02.rar', fileName: 'archive.part02.rar' },
        { url: 'http://files.example.com/archive.part03.rar', fileName: 'archive.part03.rar' },
        { url: 'https://evil.other.com/archive.part04.rar', fileName: 'archive.part04.rar' },
      ],
    });

    expect(res.matched).toBe(false);
    expect(res.parts).toHaveLength(1);
    expect(probedUrls.some((u) => u.includes('127.0.0.1'))).toBe(false);
    expect(probedUrls.some((u) => u.includes('evil.other.com'))).toBe(false);
  });
});

