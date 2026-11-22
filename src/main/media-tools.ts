import { spawn } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';

const YTDLP_RELEASE_URL =
  'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';

const ALLOWED_TOOL_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com',
]);

const pendingYtDlpDownloads = new Map<string, Promise<string>>();

function isAllowedToolUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (ALLOWED_TOOL_HOSTS.has(host)) return true;
    for (const allowed of ALLOWED_TOOL_HOSTS) {
      if (host.endsWith(`.${allowed}`)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function findExecutableInPath(names: string[], extraDirs: string[] = []): string | null {
  const dirs = [
    ...extraDirs.filter(Boolean),
    ...(process.env.PATH ? process.env.PATH.split(path.delimiter).filter(Boolean) : []),
  ];

  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {
      }
    }
  }
  return null;
}

export function findFfmpeg(binDir: string): string | null {
  return findExecutableInPath(
    process.platform === 'win32' ? ['ffmpeg.exe', 'ffmpeg'] : ['ffmpeg'],
    [binDir]
  );
}

export async function ensureYtDlp(
  binDir: string,
  onStatus?: (msg: string) => void
): Promise<string> {
  const exeName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const existing = findExecutableInPath(
    process.platform === 'win32' ? ['yt-dlp.exe', 'yt-dlp'] : ['yt-dlp'],
    [binDir]
  );
  if (existing) return existing;

  const targetPath = path.join(binDir, exeName);
  const inflight = pendingYtDlpDownloads.get(targetPath);
  if (inflight) return inflight;

  const job = (async () => {
    onStatus?.('Downloading yt-dlp media engine from GitHub...');
    await fs.promises.mkdir(binDir, { recursive: true });
    const partPath = `${targetPath}.part`;
    try {
      await downloadBinaryHttps(YTDLP_RELEASE_URL, partPath, 6);
      await fs.promises.rm(targetPath, { force: true }).catch(() => {});
      await fs.promises.rename(partPath, targetPath);
      return targetPath;
    } catch (err) {
      await fs.promises.rm(partPath, { force: true }).catch(() => {});
      throw err;
    }
  })().finally(() => {
    pendingYtDlpDownloads.delete(targetPath);
  });

  pendingYtDlpDownloads.set(targetPath, job);
  return job;
}

function downloadBinaryHttps(
  urlStr: string,
  destPath: string,
  redirectsLeft: number
): Promise<void> {
  if (!isAllowedToolUrl(urlStr)) {
    return Promise.reject(new Error('Disallowed yt-dlp download URL'));
  }

  return new Promise((resolve, reject) => {
    const req = https.get(
      urlStr,
      {
        headers: {
          'User-Agent': 'MyLoad-Download-Manager/1.0',
          Accept: 'application/octet-stream',
        },
        timeout: 45000,
      },
      (res) => {
        const code = res.statusCode ?? 0;
        if (code >= 300 && code < 400 && res.headers.location && redirectsLeft > 0) {
          res.resume();
          const nextUrl = new URL(res.headers.location, urlStr).toString();
          void downloadBinaryHttps(nextUrl, destPath, redirectsLeft - 1).then(resolve, reject);
          return;
        }
        if (code < 200 || code >= 300) {
          res.resume();
          reject(new Error(`Failed to download yt-dlp (HTTP ${code})`));
          return;
        }

        const expectedLen =
          res.headers['content-length'] && /^\d+$/.test(res.headers['content-length'])
            ? Number(res.headers['content-length'])
            : null;
        let written = 0;
        let settled = false;
        const out = fs.createWriteStream(destPath);

        const fail = async (err: Error) => {
          if (settled) return;
          settled = true;
          res.destroy();
          await new Promise<void>((r) => out.close(() => r()));
          reject(err);
        };

        res.on('data', (chunk: Buffer) => {
          written += chunk.length;
          if (!out.write(chunk)) {
            res.pause();
            out.once('drain', () => res.resume());
          }
        });
        res.on('error', (err) => {
          void fail(err instanceof Error ? err : new Error('Network error fetching yt-dlp'));
        });
        out.on('error', (err) => {
          void fail(err instanceof Error ? err : new Error('Disk write error saving yt-dlp'));
        });
        res.on('end', () => {
          out.end(() => {
            if (settled) return;
            settled = true;
            if (written <= 0 || (expectedLen !== null && written !== expectedLen)) {
              reject(new Error('Incomplete yt-dlp download'));
              return;
            }
            resolve();
          });
        });
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error('Timed out downloading yt-dlp'));
    });
    req.on('error', reject);
  });
}

export function runProcess(
  exe: string,
  args: string[],
  opts?: {
    signal?: AbortSignal;
    timeoutMs?: number;
    onStdoutLine?: (line: string) => void;
    onStderrLine?: (line: string) => void;
  }
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (opts?.signal?.aborted) {
      reject(new Error('Canceled'));
      return;
    }

    const child = spawn(exe, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let stdoutPending = '';
    let stderrPending = '';
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (opts?.signal) {
        opts.signal.removeEventListener('abort', onAbort);
      }
    };

    const killChild = () => {
      try {
        child.kill('SIGTERM');
      } catch {
      }
    };

    const onAbort = () => {
      killChild();
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error('Download canceled'));
      }
    };

    if (opts?.signal) {
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    if (opts?.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        killChild();
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error('Media operation timed out'));
        }
      }, opts.timeoutMs);
    }

    const flushLines = (
      chunk: string,
      pending: string,
      cb?: (line: string) => void
    ): string => {
      const combined = pending + chunk;
      const parts = combined.split(/\r\n|\n|\r/);
      const tail = parts.pop() ?? '';
      if (cb) {
        for (const p of parts) {
          const t = p.trim();
          if (t) cb(t);
        }
      }
      return tail;
    };

    child.stdout.on('data', (buf: Buffer) => {
      const text = buf.toString('utf-8');
      stdoutChunks.push(text);
      stdoutPending = flushLines(text, stdoutPending, opts?.onStdoutLine);
    });

    child.stderr.on('data', (buf: Buffer) => {
      const text = buf.toString('utf-8');
      stderrChunks.push(text);
      stderrPending = flushLines(text, stderrPending, opts?.onStderrLine);
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    });

    child.on('close', (code) => {
      if (stdoutPending.trim()) opts?.onStdoutLine?.(stdoutPending.trim());
      if (stderrPending.trim()) opts?.onStderrLine?.(stderrPending.trim());
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        code: code ?? -1,
        stdout: stdoutChunks.join(''),
        stderr: stderrChunks.join(''),
      });
    });
  });
}

