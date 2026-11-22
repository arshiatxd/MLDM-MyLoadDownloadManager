import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { classifyFileName } from '../shared/categories';
import { sanitizeFileName } from '../shared/constants';
import type { DownloadItem, ProbeResult, SegmentInfo } from '../shared/types';
import {
  formatDownloadError,
  isNonRetryableSystemError,
  validateSaveDirectory,
} from './fs-validation';
import type { LogManager } from './logger';
import {
  isPathInsideDir,
  sanitizeOutgoingHeaders,
  stripUnsafeRedirectHeaders,
  validateHttpOrHttpsUrl,
} from './security';
import type { TokenBucket } from './throttle';

const MAX_REDIRECTS = 10;
const REQUEST_TIMEOUT_MS = 20000;
const WRITE_BUFFER_BYTES = 128 * 1024;
const WRITE_FLUSH_INTERVAL_MS = 120;
const MAX_HTTP_CONNECTIONS = 32;
const USER_AGENT = 'MyLoad/1.0 (Windows NT; Download Manager)';

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
  'application/zip': '.zip',
  'application/x-7z-compressed': '.7z',
  'application/x-rar-compressed': '.rar',
  'application/gzip': '.gz',
  'application/x-bittorrent': '.torrent',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/x-matroska': '.mkv',
  'text/plain': '.txt',
  'application/json': '.json',
};

export interface HttpRunOptions {
  connections: number;
  maxRetries: number;
  duplicateOverride?: 'auto-rename' | 'overwrite';
  duplicatePolicy: 'auto-rename' | 'overwrite' | 'ask';
  throttleOverride?: TokenBucket;
  onProgress: (patch: Partial<DownloadItem>) => void;
  onComplete: (finalPath: string, totalBytes: number) => void;
  onError: (message: string) => void;
}

interface ActiveTask {
  controller: AbortController;
  requests: Set<http.ClientRequest>;
  stoppedByUser: boolean;
}

export class HttpDownloadEngine {
  private readonly throttle: TokenBucket;
  private readonly logger: LogManager;
  private readonly activeTasks = new Map<string, ActiveTask>();
  private readonly httpAgent = new http.Agent({ keepAlive: false, maxSockets: 128 });
  private readonly httpsAgent = new https.Agent({ keepAlive: false, maxSockets: 128 });

  constructor(throttle: TokenBucket, logger: LogManager) {
    this.throttle = throttle;
    this.logger = logger;
  }

  async probeUrl(
    rawUrl: string,
    requestHeaders?: Record<string, string>
  ): Promise<ProbeResult> {
    const parsed = validateHttpOrHttpsUrl(rawUrl);
    const probeBaseHeaders = sanitizeOutgoingHeaders(requestHeaders);
    let headResult: {
      finalUrl: string;
      statusCode: number;
      headers: http.IncomingHttpHeaders;
    } | null = null;

    try {
      headResult = await this.performProbeRequest(parsed.toString(), 'HEAD', probeBaseHeaders);
    } catch {
      headResult = null;
    }

    const headLength = headResult ? parseContentLength(headResult.headers['content-length']) : null;
    const needsGetProbe =
      !headResult ||
      headResult.statusCode === 405 ||
      headResult.statusCode === 501 ||
      headResult.statusCode === 400 ||
      headResult.statusCode === 403 ||
      headLength === null;

    let finalInfo = headResult;
    if (needsGetProbe) {
      try {
        finalInfo = await this.performProbeRequest(parsed.toString(), 'GET', {
          ...probeBaseHeaders,
          Range: 'bytes=0-0',
        });
      } catch (err) {
        if (!headResult) {
          throw err;
        }
      }
    }

    if (!finalInfo) {
      throw new Error('Unable to connect to remote server');
    }

    if (finalInfo.statusCode >= 400) {
      throw new Error(`Server responded with HTTP ${finalInfo.statusCode}`);
    }

    const headers = finalInfo.headers;
    const contentRange = parseContentRangeTotal(headers['content-range']);
    const contentLength = parseContentLength(headers['content-length']);
    const totalBytes =
      finalInfo.statusCode === 206
        ? contentRange
        : contentLength;

    const acceptRanges = String(headers['accept-ranges'] ?? '').toLowerCase();
    const resumeSupported =
      finalInfo.statusCode === 206 || acceptRanges.includes('bytes');

    const fileName = extractFileName(
      headers['content-disposition'],
      finalInfo.finalUrl,
      headers['content-type']
    );

    return {
      kind: 'http',
      source: rawUrl,
      finalUrl: finalInfo.finalUrl,
      fileName,
      totalBytes,
      resumeSupported,
      category: classifyFileName(fileName, 'http'),
    };
  }

  async start(item: DownloadItem, opts: HttpRunOptions): Promise<void> {
    if (this.activeTasks.has(item.id)) return;

    const task: ActiveTask = {
      controller: new AbortController(),
      requests: new Set(),
      stoppedByUser: false,
    };
    this.activeTasks.set(item.id, task);

    let handle: fs.promises.FileHandle | null = null;

    try {
      const initialDirCheck = await validateSaveDirectory(item.saveDir, item.totalBytes);
      if (!initialDirCheck.valid) {
        throw new Error(initialDirCheck.error || 'Invalid download folder');
      }

      await fs.promises.mkdir(item.saveDir, { recursive: true });

      let targetUrl = item.source;
      let totalBytes = item.totalBytes;
      let resumeSupported = item.resumeSupported;
      let resolvedName = item.name;

      if (totalBytes === null || item.segments.length === 0) {
        opts.onProgress({ status: 'probing', errorMessage: undefined });
        const probe = await this.probeUrl(item.source, item.requestHeaders);
        if (task.stoppedByUser || task.controller.signal.aborted) return;

        targetUrl = probe.finalUrl || item.source;
        totalBytes = probe.totalBytes;
        resumeSupported = probe.resumeSupported;
        if (!resolvedName) resolvedName = probe.fileName;
      }

      const effectiveHeaders = stripUnsafeRedirectHeaders(
        sanitizeOutgoingHeaders(item.requestHeaders),
        item.source,
        targetUrl
      );

      const policy = opts.duplicateOverride ?? (opts.duplicatePolicy === 'ask' ? 'auto-rename' : opts.duplicatePolicy);
      const isFresh = item.downloadedBytes === 0 && item.segments.length === 0;
      const finalPath = isFresh
        ? await resolveTargetFilePath(item.saveDir, resolvedName, policy)
        : item.filePath;
      if (!isPathInsideDir(item.saveDir, finalPath)) {
        throw new Error('Blocked unsafe destination file path outside download folder');
      }
      const finalName = path.basename(finalPath);
      const partPath = `${finalPath}.myload.part`;

      let segments = cloneSegments(item.segments);
      let partExists = fs.existsSync(partPath);

      if (segments.length === 0 || !partExists || !resumeSupported) {
        if (!resumeSupported && partExists) {
          await fs.promises.rm(partPath, { force: true });
          partExists = false;
        }
        segments = buildInitialSegments(totalBytes, resumeSupported, opts.connections);
      }

      if (segments.length === 1 && segments[0].end === -1 && partExists && resumeSupported) {
        const stat = await fs.promises.stat(partPath);
        segments[0].downloaded = stat.size;
      }

      const initialDownloaded = segments.reduce((acc, s) => acc + s.downloaded, 0);
      const remainingRequired =
        totalBytes !== null ? Math.max(0, totalBytes - initialDownloaded) : null;
      const spaceCheck = await validateSaveDirectory(item.saveDir, remainingRequired);
      if (!spaceCheck.valid) {
        throw new Error(spaceCheck.error || 'Insufficient disk space or folder is not writable');
      }
      opts.onProgress({
        name: finalName,
        filePath: finalPath,
        category: classifyFileName(finalName, 'http'),
        status: 'downloading',
        totalBytes,
        downloadedBytes: initialDownloaded,
        resumeSupported,
        segments: cloneSegments(segments),
        errorMessage: undefined,
      });

      this.logger.info(
        'HTTP',
        `Starting ${finalName} (${segments.length} connection${segments.length > 1 ? 's' : ''}, resume=${resumeSupported ? 'yes' : 'no'})`,
        item.id
      );

      handle = await fs.promises.open(partPath, partExists ? 'r+' : 'w');

      let lastTickTime = Date.now();
      let lastTickBytes = initialDownloaded;
      const segLastBytes = segments.map((s) => s.downloaded);
      let smoothedSpeed = 0;

      const emitProgress = (force = false) => {
        const now = Date.now();
        const elapsedMs = now - lastTickTime;
        if (!force && elapsedMs < 220) return;

        const totalDownloaded = segments.reduce((acc, s) => acc + s.downloaded, 0);
        if (elapsedMs > 0) {
          const deltaBytes = Math.max(0, totalDownloaded - lastTickBytes);
          const instantSpeed = (deltaBytes / elapsedMs) * 1000;
          smoothedSpeed = smoothedSpeed === 0 ? instantSpeed : smoothedSpeed * 0.55 + instantSpeed * 0.45;

          for (let i = 0; i < segments.length; i++) {
            const segDelta = Math.max(0, segments[i].downloaded - segLastBytes[i]);
            segments[i].speed = Math.round((segDelta / elapsedMs) * 1000);
            segLastBytes[i] = segments[i].downloaded;
          }
          lastTickTime = now;
          lastTickBytes = totalDownloaded;
        }

        const speed = Math.round(smoothedSpeed);
        const remaining = totalBytes !== null ? Math.max(0, totalBytes - totalDownloaded) : null;
        const etaSeconds =
          remaining !== null && speed > 0 ? Math.ceil(remaining / speed) : null;

        opts.onProgress({
          status: 'downloading',
          totalBytes,
          downloadedBytes: totalDownloaded,
          downloadSpeed: speed,
          etaSeconds,
          segments: cloneSegments(segments),
        });
      };

      const progressTimer = setInterval(() => emitProgress(true), 250);

      const effectiveThrottle = opts.throttleOverride ?? this.throttle;

      try {
        const workers = segments.map((seg) =>
          this.downloadSegment({
            downloadId: item.id,
            url: targetUrl,
            requestHeaders: effectiveHeaders,
            throttleBucket: effectiveThrottle,
            seg,
            allSegments: segments,
            totalBytes,
            resumeSupported,
            handle: handle!,
            task,
            maxRetries: opts.maxRetries,
            onBytes: () => emitProgress(false),
            onTotalBytesDiscovered: (discoveredTotal) => {
              if (totalBytes === null && discoveredTotal !== null) {
                totalBytes = discoveredTotal;
                seg.end = discoveredTotal - 1;
              }
            },
          })
        );

        await Promise.all(workers);
      } finally {
        clearInterval(progressTimer);
      }

      if (task.stoppedByUser || task.controller.signal.aborted) {
        return;
      }

      await handle.close();
      handle = null;

      await replaceFileWithRetries(partPath, finalPath);

      const finalTotal =
        totalBytes ?? segments.reduce((acc, s) => acc + s.downloaded, 0);
      for (const s of segments) {
        s.speed = 0;
        s.status = 'done';
      }

      this.logger.info('HTTP', `Completed ${finalName} (${finalTotal} bytes)`, item.id);
      opts.onComplete(finalPath, finalTotal);
    } catch (err) {
      if (handle) {
        await handle.close().catch(() => {});
        handle = null;
      }
      if (task.stoppedByUser || isAbortError(err)) {
        return;
      }
      const message = formatDownloadError(err, { saveDir: item.saveDir });
      this.logger.error('HTTP', `Failed ${item.name}: ${message}`, item.id);
      opts.onError(message);
    } finally {
      if (handle) {
        await handle.close().catch(() => {});
      }
      this.activeTasks.delete(item.id);
    }
  }

  pause(id: string): void {
    const task = this.activeTasks.get(id);
    if (!task) return;
    task.stoppedByUser = true;
    task.controller.abort();
    for (const req of task.requests) {
      req.destroy();
    }
    task.requests.clear();
  }

  cancel(id: string): void {
    this.pause(id);
  }

  isRunning(id: string): boolean {
    return this.activeTasks.has(id);
  }

  private async downloadSegment(params: {
    downloadId: string;
    url: string;
    requestHeaders?: Record<string, string>;
    throttleBucket: TokenBucket;
    seg: SegmentInfo;
    allSegments: SegmentInfo[];
    totalBytes: number | null;
    resumeSupported: boolean;
    handle: fs.promises.FileHandle;
    task: ActiveTask;
    maxRetries: number;
    onBytes: () => void;
    onTotalBytesDiscovered: (total: number | null) => void;
  }): Promise<void> {
    const {
      downloadId,
      url,
      requestHeaders,
      throttleBucket,
      seg,
      totalBytes,
      resumeSupported,
      handle,
      task,
      maxRetries,
      onBytes,
      onTotalBytesDiscovered,
    } = params;

    const targetLength = seg.end >= seg.start ? seg.end - seg.start + 1 : null;
    if (targetLength !== null && seg.downloaded >= targetLength) {
      seg.status = 'done';
      seg.speed = 0;
      return;
    }

    let attempt = 0;
    while (true) {
      if (task.stoppedByUser || task.controller.signal.aborted) {
        throw createAbortError();
      }

      seg.status = 'active';
      try {
        await this.runSegmentAttempt({
          url,
          requestHeaders,
          throttleBucket,
          seg,
          totalBytes,
          resumeSupported,
          handle,
          task,
          onBytes,
          onTotalBytesDiscovered,
        });
        seg.status = 'done';
        seg.speed = 0;
        return;
      } catch (err) {
        if (task.stoppedByUser || task.controller.signal.aborted || isAbortError(err)) {
          seg.speed = 0;
          throw createAbortError();
        }
        attempt += 1;
        if (attempt > maxRetries || !isRetryableError(err)) {
          seg.status = 'error';
          seg.speed = 0;
          throw err;
        }
        const delayMs = 1000 * Math.pow(2, attempt - 1);
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          'HTTP',
          `Segment ${seg.index + 1} dropped (${msg}); retrying (${attempt}/${maxRetries}) in ${delayMs}ms`,
          downloadId
        );
        await sleepWithAbort(delayMs, task.controller.signal);
      }
    }
  }

  private async runSegmentAttempt(params: {
    url: string;
    requestHeaders?: Record<string, string>;
    throttleBucket: TokenBucket;
    seg: SegmentInfo;
    totalBytes: number | null;
    resumeSupported: boolean;
    handle: fs.promises.FileHandle;
    task: ActiveTask;
    onBytes: () => void;
    onTotalBytesDiscovered: (total: number | null) => void;
  }): Promise<void> {
    const {
      url,
      requestHeaders,
      throttleBucket,
      seg,
      totalBytes,
      resumeSupported,
      handle,
      task,
      onBytes,
      onTotalBytesDiscovered,
    } = params;

    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      ...requestHeaders,
    };

    const hasKnownEnd = seg.end >= seg.start;
    if (resumeSupported && (hasKnownEnd || seg.downloaded > 0)) {
      const startByte = seg.start + seg.downloaded;
      headers.Range = hasKnownEnd ? `bytes=${startByte}-${seg.end}` : `bytes=${startByte}-`;
    }

      const { res, statusCode } = await this.openFollowStream(url, headers, task);
      res.socket?.setNoDelay(true);
      const cleanupOnAbort = () => {
        res.destroy();
      };
      task.controller.signal.addEventListener('abort', cleanupOnAbort, { once: true });

      try {
        if (statusCode >= 400) {
          res.resume();
          throw new HttpStatusError(statusCode, `HTTP ${statusCode}`);
        }

        if (statusCode === 200 && seg.downloaded > 0) {
          if (seg.index === 0 && !hasKnownEnd) {
            seg.downloaded = 0;
            await handle.truncate(0);
          } else if (seg.start + seg.downloaded > 0) {
            res.resume();
            throw new Error('Server refused byte-range resume (returned HTTP 200)');
          }
        }

        if (totalBytes === null) {
          const len = parseContentLength(res.headers['content-length']);
          if (len !== null) {
            onTotalBytesDiscovered(len);
          }
        }

        const expectedSegmentLen = seg.end >= seg.start ? seg.end - seg.start + 1 : null;
        let pendingChunks: Buffer[] = [];
        let pendingBytes = 0;
        let lastFlushAt = Date.now();

        const flushPending = async (): Promise<void> => {
          if (pendingBytes <= 0) return;
          if (task.stoppedByUser || task.controller.signal.aborted) {
            throw createAbortError();
          }
          const combined =
            pendingChunks.length === 1 ? pendingChunks[0] : Buffer.concat(pendingChunks, pendingBytes);
          pendingChunks = [];
          pendingBytes = 0;
          lastFlushAt = Date.now();
          const position = seg.start + seg.downloaded;
          await handle.write(combined, 0, combined.length, position);
          seg.downloaded += combined.length;
          onBytes();
        };

        for await (const rawChunk of res) {
          if (task.stoppedByUser || task.controller.signal.aborted) {
            throw createAbortError();
          }
          const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
          let toWrite = chunk;
          if (expectedSegmentLen !== null) {
            const remaining = expectedSegmentLen - (seg.downloaded + pendingBytes);
            if (remaining <= 0) break;
            if (toWrite.length > remaining) {
              toWrite = toWrite.subarray(0, remaining);
            }
          }
          if (toWrite.length === 0) continue;

          await throttleBucket.consume(toWrite.length, task.controller.signal);

          if (task.stoppedByUser || task.controller.signal.aborted) {
            throw createAbortError();
          }

          pendingChunks.push(toWrite);
          pendingBytes += toWrite.length;

          const throttled = throttleBucket.getLimit() !== null;
          const reachedSegmentEnd =
            expectedSegmentLen !== null && seg.downloaded + pendingBytes >= expectedSegmentLen;
          const flushWindowElapsed = Date.now() - lastFlushAt >= WRITE_FLUSH_INTERVAL_MS;

          if (throttled || pendingBytes >= WRITE_BUFFER_BYTES || flushWindowElapsed || reachedSegmentEnd) {
            await flushPending();
          }

          if (reachedSegmentEnd) {
            res.destroy();
            break;
          }
        }

        await flushPending();

        if (expectedSegmentLen !== null && seg.downloaded < expectedSegmentLen) {
          throw new Error(`Incomplete segment ${seg.index + 1} (${seg.downloaded}/${expectedSegmentLen})`);
        }
      } finally {
        task.controller.signal.removeEventListener('abort', cleanupOnAbort);
        res.destroy();
      }
  }

  private async performProbeRequest(
    urlStr: string,
    method: 'HEAD' | 'GET',
    extraHeaders: Record<string, string> = {},
    redirects = 0
  ): Promise<{ finalUrl: string; statusCode: number; headers: http.IncomingHttpHeaders }> {
    const url = new URL(urlStr);
    const client = url.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
      const req = client.request(
        url,
        {
          method,
          agent: url.protocol === 'https:' ? this.httpsAgent : this.httpAgent,
          headers: {
            'User-Agent': USER_AGENT,
            ...extraHeaders,
          },
        },
        (res) => {
          const statusCode = res.statusCode ?? 0;
          const location = res.headers.location;
          if (
            location &&
            [301, 302, 303, 307, 308].includes(statusCode) &&
            redirects < MAX_REDIRECTS
          ) {
            res.resume();
            let nextUrl: string;
            try {
              nextUrl = validateHttpOrHttpsUrl(new URL(location, url).toString()).toString();
            } catch (err) {
              reject(err);
              return;
            }
            const nextHeaders = stripUnsafeRedirectHeaders(extraHeaders, url.toString(), nextUrl);
            this.performProbeRequest(nextUrl, method, nextHeaders, redirects + 1)
              .then(resolve)
              .catch(reject);
            return;
          }

          res.destroy();
          resolve({
            finalUrl: url.toString(),
            statusCode,
            headers: res.headers,
          });
        }
      );

      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        req.destroy(new Error('Connection timed out while probing URL'));
      });
      req.on('error', reject);
      req.end();
    });
  }

  private async openFollowStream(
    urlStr: string,
    headers: Record<string, string>,
    task: ActiveTask,
    redirects = 0
  ): Promise<{ res: http.IncomingMessage; statusCode: number }> {
    if (task.stoppedByUser || task.controller.signal.aborted) {
      throw createAbortError();
    }

    const url = new URL(urlStr);
    const client = url.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
      const req = client.request(
        url,
        {
          method: 'GET',
          agent: url.protocol === 'https:' ? this.httpsAgent : this.httpAgent,
          headers,
        },
        (res) => {
          task.requests.delete(req);
          const statusCode = res.statusCode ?? 0;
          const location = res.headers.location;
          if (
            location &&
            [301, 302, 303, 307, 308].includes(statusCode) &&
            redirects < MAX_REDIRECTS
          ) {
            res.resume();
            let nextUrl: string;
            try {
              nextUrl = validateHttpOrHttpsUrl(new URL(location, url).toString()).toString();
            } catch (err) {
              reject(err);
              return;
            }
            const nextHeaders = stripUnsafeRedirectHeaders(headers, url.toString(), nextUrl);
            this.openFollowStream(nextUrl, nextHeaders, task, redirects + 1)
              .then(resolve)
              .catch(reject);
            return;
          }
          resolve({ res, statusCode });
        }
      );

      req.setNoDelay(true);
      task.requests.add(req);
      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        req.destroy(new Error('Request timed out'));
      });
      req.on('error', (err) => {
        task.requests.delete(req);
        reject(err);
      });
      req.end();
    });
  }
}

export function buildInitialSegments(
  totalBytes: number | null,
  resumeSupported: boolean,
  requestedConnections: number
): SegmentInfo[] {
  if (!resumeSupported || totalBytes === null || totalBytes < 256 * 1024 || requestedConnections <= 1) {
    return [
      {
        index: 0,
        start: 0,
        end: totalBytes !== null && totalBytes > 0 ? totalBytes - 1 : -1,
        downloaded: 0,
        speed: 0,
        status: 'pending',
      },
    ];
  }

  const count = Math.max(1, Math.min(MAX_HTTP_CONNECTIONS, Math.floor(requestedConnections)));
  const chunkSize = Math.floor(totalBytes / count);
  const segments: SegmentInfo[] = [];

  for (let i = 0; i < count; i++) {
    const start = i * chunkSize;
    const end = i === count - 1 ? totalBytes - 1 : (i + 1) * chunkSize - 1;
    segments.push({
      index: i,
      start,
      end,
      downloaded: 0,
      speed: 0,
      status: 'pending',
    });
  }

  return segments;
}

export async function resolveTargetFilePath(
  saveDir: string,
  fileName: string,
  policy: 'auto-rename' | 'overwrite'
): Promise<string> {
  const safeName = sanitizeFileName(fileName);
  const basePath = path.join(saveDir, safeName);
  if (policy === 'overwrite') return basePath;

  const existsAny = (p: string) => fs.existsSync(p) || fs.existsSync(`${p}.myload.part`);
  if (!existsAny(basePath)) return basePath;

  const ext = path.extname(safeName);
  const stem = ext ? safeName.slice(0, -ext.length) : safeName;
  for (let i = 1; i < 10000; i++) {
    const candidate = path.join(saveDir, `${stem} (${i})${ext}`);
    if (!existsAny(candidate)) {
      return candidate;
    }
  }
  return path.join(saveDir, `${stem} (${Date.now()})${ext}`);
}

export function extractFileName(
  contentDisposition: string | string[] | undefined,
  finalUrl: string,
  contentType?: string | string[]
): string {
  const cd = Array.isArray(contentDisposition) ? contentDisposition[0] : contentDisposition;
  if (cd) {
    const starMatch = cd.match(/filename\*\s*=\s*(?:UTF-8''|utf-8'')?([^;\n]+)/i);
    if (starMatch?.[1]) {
      const raw = starMatch[1].trim().replace(/^["']|["']$/g, '');
      try {
        return sanitizeFileName(decodeURIComponent(raw));
      } catch {
        return sanitizeFileName(raw);
      }
    }

    const plainMatch = cd.match(/filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;\n]+)/i);
    const extracted = plainMatch?.[1] || plainMatch?.[2];
    if (extracted) {
      return sanitizeFileName(extracted.trim().replace(/^["']|["']$/g, ''));
    }
  }

  try {
    const parsed = new URL(finalUrl);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length > 0) {
      const last = parts[parts.length - 1];
      let decoded = last;
      try {
        decoded = decodeURIComponent(last);
      } catch {
        decoded = last;
      }
      const clean = sanitizeFileName(decoded);
      if (clean && clean !== 'download') {
        return ensureExtensionFromContentType(clean, contentType);
      }
    }
  } catch {

  }

  return ensureExtensionFromContentType('download', contentType);
}

function ensureExtensionFromContentType(
  fileName: string,
  contentType?: string | string[]
): string {
  if (path.extname(fileName)) return fileName;
  const ctRaw = Array.isArray(contentType) ? contentType[0] : contentType;
  if (!ctRaw) return fileName;
  const mime = ctRaw.split(';')[0].trim().toLowerCase();
  const ext = CONTENT_TYPE_EXTENSIONS[mime];
  return ext ? `${fileName}${ext}` : fileName;
}

function parseContentLength(val: string | string[] | undefined): number | null {
  const str = Array.isArray(val) ? val[0] : val;
  if (!str) return null;
  const n = Number(str.trim());
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseContentRangeTotal(val: string | string[] | undefined): number | null {
  const str = Array.isArray(val) ? val[0] : val;
  if (!str) return null;
  const match = str.match(/\/(\d+)\s*$/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function cloneSegments(segments: SegmentInfo[]): SegmentInfo[] {
  return segments.map((s) => ({ ...s }));
}

async function replaceFileWithRetries(partPath: string, finalPath: string): Promise<void> {
  if (fs.existsSync(finalPath)) {
    await fs.promises.rm(finalPath, { force: true });
  }
  for (let i = 0; i < 4; i++) {
    try {
      await fs.promises.rename(partPath, finalPath);
      return;
    } catch (err) {
      if (i === 3) throw err;
      await new Promise((r) => setTimeout(r, 80 * (i + 1)));
    }
  }
}

class HttpStatusError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function isRetryableError(err: unknown): boolean {
  if (isNonRetryableSystemError(err)) return false;
  if (err instanceof HttpStatusError) {
    return err.statusCode === 408 || err.statusCode === 429 || err.statusCode >= 500;
  }
  return true;
}

function createAbortError(): Error {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortError());
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

