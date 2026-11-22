import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { isHttpUrl, sanitizeFileName } from '../shared/constants';
import type {
  DownloadItem,
  MediaOutputFormat,
  SocialDownloadRequest,
  SocialMediaItem,
  SocialPlatform,
  SocialScanResult,
} from '../shared/types';
import type { LogManager } from './logger';
import { ensureYtDlp, findFfmpeg, runProcess } from './media-tools';
import {
  describeCustomHttpError,
  detectPrivateError,
  isPrivateIpAddress,
  isPrivateOrLocalHost,
  normalizeYtDlpMetadata,
  parseCustomPageHtml,
  parseInstagramEmbedHtml,
  parseSpotifyEmbedHtml,
  parseTikTokRehydrationHtml,
  validatePlatformUrl,
} from './social-parsers';
import { createZipArchive } from './zip-builder';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

const AUDIO_FORMATS = new Set<MediaOutputFormat>(['mp3', 'wav', 'm4a', 'flac', 'opus']);

function parseSizeToBytes(numStr: string, unit: string): number | null {
  const val = parseFloat(numStr);
  if (!Number.isFinite(val) || val < 0) return null;
  const u = unit.toLowerCase();
  if (u === 'b') return Math.round(val);
  if (u === 'kib' || u === 'kb') return Math.round(val * 1024);
  if (u === 'mib' || u === 'mb') return Math.round(val * 1024 * 1024);
  if (u === 'gib' || u === 'gb') return Math.round(val * 1024 * 1024 * 1024);
  return null;
}

function parseEtaText(eta: string): number | null {
  const parts = eta.trim().split(':').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

async function assertPublicUrl(rawUrl: string): Promise<void> {
  if (!isHttpUrl(rawUrl)) {
    throw new Error('Invalid HTTP URL');
  }
  const parsed = new URL(rawUrl);
  if (isPrivateOrLocalHost(parsed.hostname)) {
    throw new Error('Local and private network URLs cannot be scanned.');
  }
  let records: Array<{ address: string }>;
  try {
    records = await dns.lookup(parsed.hostname, { all: true });
  } catch {
    throw new Error(`Unable to resolve host ${parsed.hostname}`);
  }
  if (!records || records.length === 0) {
    throw new Error(`Unable to resolve host ${parsed.hostname}`);
  }
  for (const rec of records) {
    if (isPrivateIpAddress(rec.address)) {
      throw new Error('Local and private network URLs cannot be scanned.');
    }
  }
}

async function fetchHttpText(
  rawUrl: string,
  redirectsLeft = 5,
  enforcePublic = false
): Promise<{ statusCode: number; finalUrl: string; body: string }> {
  if (!isHttpUrl(rawUrl)) {
    return Promise.reject(new Error('Invalid HTTP URL'));
  }
  if (enforcePublic) {
    await assertPublicUrl(rawUrl);
  }

  return new Promise((resolve, reject) => {
    const parsed = new URL(rawUrl);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(
      parsed,
      {
        method: 'GET',
        headers: {
          'User-Agent': BROWSER_UA,
          Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: 12000,
      },
      (res) => {
        const code = res.statusCode ?? 0;
        if (code >= 300 && code < 400 && res.headers.location && redirectsLeft > 0) {
          res.resume();
          const next = new URL(res.headers.location, parsed).toString();
          void fetchHttpText(next, redirectsLeft - 1, enforcePublic).then(resolve, reject);
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > 5 * 1024 * 1024) {
            req.destroy(new Error('Page response too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          resolve({
            statusCode: code,
            finalUrl: parsed.toString(),
            body: Buffer.concat(chunks).toString('utf-8'),
          });
        });
        res.on('error', reject);
      }
    );
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    req.end();
  });
}

function downloadAssetToFile(
  rawUrl: string,
  destPath: string,
  redirectsLeft = 5
): Promise<boolean> {
  if (!isHttpUrl(rawUrl)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const parsed = new URL(rawUrl);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(
      parsed,
      {
        method: 'GET',
        headers: { 'User-Agent': BROWSER_UA },
        timeout: 12000,
      },
      (res) => {
        const code = res.statusCode ?? 0;
        if (code >= 300 && code < 400 && res.headers.location && redirectsLeft > 0) {
          res.resume();
          const next = new URL(res.headers.location, parsed).toString();
          void downloadAssetToFile(next, destPath, redirectsLeft - 1).then(resolve);
          return;
        }
        if (code < 200 || code >= 300) {
          res.resume();
          resolve(false);
          return;
        }
        const out = fs.createWriteStream(destPath);
        res.pipe(out);
        out.on('finish', () => out.close(() => resolve(true)));
        out.on('error', () => {
          out.close(() => resolve(false));
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

async function allocateUniqueFilePath(dir: string, fileName: string): Promise<string> {
  const safe = sanitizeFileName(fileName);
  const dot = safe.lastIndexOf('.');
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : '';
  let candidate = path.join(dir, safe);
  let idx = 1;
  while (fs.existsSync(candidate) && idx < 1000) {
    candidate = path.join(dir, `${stem} (${idx})${ext}`);
    idx += 1;
  }
  return candidate;
}

async function allocateUniqueDirPath(parentDir: string, folderName: string): Promise<string> {
  const safe = sanitizeFileName(folderName) || 'Playlist';
  let candidate = path.join(parentDir, safe);
  let idx = 1;
  while (fs.existsSync(candidate) && idx < 1000) {
    candidate = path.join(parentDir, `${safe} (${idx})`);
    idx += 1;
  }
  await fs.promises.mkdir(candidate, { recursive: true });
  return candidate;
}

export function buildYtDlpArgs(params: {
  req: SocialDownloadRequest;
  outputTemplate: string;
  ffmpegPath: string | null;
  limitRateBytesPerSec?: number | null;
  sourceUrl: string;
}): string[] {
  const { req, outputTemplate, ffmpegPath, limitRateBytesPerSec, sourceUrl } = params;
  const format: MediaOutputFormat = req.format || 'mp4';
  const isAudio = AUDIO_FORMATS.has(format);

  const args: string[] = [
    '--newline',
    '--progress',
    '--no-warnings',
    '--no-playlist',
    '--continue',
    '--print',
    'after_move:MYLOAD_FINAL:%(filepath)s',
    '-o',
    outputTemplate,
  ];

  if (
    typeof limitRateBytesPerSec === 'number' &&
    Number.isFinite(limitRateBytesPerSec) &&
    limitRateBytesPerSec > 0
  ) {
    args.push('--limit-rate', String(Math.max(1024, Math.floor(limitRateBytesPerSec))));
  }

  if (ffmpegPath) {
    args.push('--ffmpeg-location', path.dirname(ffmpegPath));
  }

  if (isAudio) {
    args.push('-f', 'bestaudio/best', '-x', '--audio-format', format, '--add-metadata');
    const aq =
      req.quality === '320k'
        ? '320K'
        : req.quality === '192k'
          ? '192K'
          : req.quality === '128k'
            ? '128K'
            : '0';
    args.push('--audio-quality', aq);
    if (format !== 'wav' && ffmpegPath) {
      args.push('--embed-thumbnail');
    }
  } else {
    const h =
      req.quality === '1080p'
        ? 1080
        : req.quality === '720p'
          ? 720
          : req.quality === '480p'
            ? 480
            : req.quality === '360p'
              ? 360
              : null;
    const selector = h
      ? `bestvideo[height<=${h}]+bestaudio/best[height<=${h}]/best`
      : 'bestvideo+bestaudio/best';
    args.push('-f', selector, '--merge-output-format', format);
  }

  args.push('--', sourceUrl);
  return args;
}

export class SocialMediaDownloader {
  private readonly binDir: string;
  private readonly logger: LogManager;
  private readonly controllers = new Map<string, AbortController>();
  private readonly activeTargets = new Map<string, string>();

  constructor(binDir: string, logger: LogManager) {
    this.binDir = binDir;
    this.logger = logger;
  }

  isRunning(id: string): boolean {
    return this.controllers.has(id);
  }

  clearTarget(id: string): void {
    this.activeTargets.delete(id);
  }

  cancel(id: string): void {
    const controller = this.controllers.get(id);
    if (controller) {
      controller.abort();
      this.controllers.delete(id);
    }
  }

  cancelAll(): void {
    for (const c of this.controllers.values()) {
      c.abort();
    }
    this.controllers.clear();
  }

  async scan(platform: SocialPlatform, rawUrl: string): Promise<SocialScanResult> {
    const check = validatePlatformUrl(platform, rawUrl);
    if (!check.valid || !check.normalizedUrl) {
      return {
        ok: false,
        platform,
        contentType: 'post',
        url: rawUrl,
        title: platform,
        items: [],
        error: check.error || 'Invalid URL',
      };
    }

    const url = check.normalizedUrl;
    if (platform === 'spotify') return this.scanSpotify(url);
    if (platform === 'instagram') return this.scanInstagram(url);
    if (platform === 'tiktok') return this.scanTikTok(url);
    if (platform === 'custom') return this.scanCustomUrl(url);
    return this.scanYouTube(url);
  }

  private async scanSpotify(rawUrl: string): Promise<SocialScanResult> {
    try {
      let canonicalUrl = rawUrl;
      let fallbackHtml: string | undefined;

      if (!/open\.spotify\.com/i.test(rawUrl) || /open\.spotify\.com\/(intl-[^/]+\/)?track\//i.test(rawUrl)) {
        const pageRes = await fetchHttpText(rawUrl);
        canonicalUrl = pageRes.finalUrl || rawUrl;
        if (pageRes.statusCode === 404 || pageRes.statusCode === 403) {
          return {
            ok: false,
            platform: 'spotify',
            contentType: 'track',
            url: canonicalUrl,
            title: 'Spotify',
            items: [],
            isPrivate: true,
            error: 'This Spotify track, album, or playlist is private or unavailable.',
          };
        }
        fallbackHtml = pageRes.body;
      }

      const entityMatch = canonicalUrl.match(
        /open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|album|playlist)\/([a-zA-Z0-9]+)/i
      );
      if (!entityMatch) {
        return {
          ok: false,
          platform: 'spotify',
          contentType: 'track',
          url: canonicalUrl,
          title: 'Spotify',
          items: [],
          error: 'Please enter a valid Spotify track, album, or playlist link.',
        };
      }

      const entityKind = entityMatch[1].toLowerCase();
      const entityId = entityMatch[2];
      const embedUrl = `https://open.spotify.com/embed/${entityKind}/${entityId}`;
      const embedRes = await fetchHttpText(embedUrl);

      if (embedRes.statusCode === 404 || embedRes.statusCode === 403) {
        return {
          ok: false,
          platform: 'spotify',
          contentType: entityKind as 'track' | 'album' | 'playlist',
          url: canonicalUrl,
          title: 'Spotify',
          items: [],
          isPrivate: true,
          error: 'This Spotify track, album, or playlist is private or unavailable.',
        };
      }

      if (!fallbackHtml && entityKind === 'track') {
        try {
          const trackRes = await fetchHttpText(`https://open.spotify.com/track/${entityId}`);
          if (trackRes.statusCode >= 200 && trackRes.statusCode < 300) {
            fallbackHtml = trackRes.body;
          }
        } catch {
        }
      }

      return parseSpotifyEmbedHtml(embedRes.body, canonicalUrl, fallbackHtml);
    } catch (err) {
      return {
        ok: false,
        platform: 'spotify',
        contentType: 'track',
        url: rawUrl,
        title: 'Spotify',
        items: [],
        error: err instanceof Error ? err.message : 'Unable to scan Spotify link',
      };
    }
  }

  private async scanInstagram(rawUrl: string): Promise<SocialScanResult> {
    let embedResult: SocialScanResult | null = null;
    const scMatch = rawUrl.match(/instagram\.com\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);

    if (scMatch) {
      const kindSeg = scMatch[1].toLowerCase() === 'reels' ? 'reel' : scMatch[1].toLowerCase();
      const embedUrl = `https://www.instagram.com/${kindSeg}/${scMatch[2]}/embed/captioned/`;
      try {
        const res = await fetchHttpText(embedUrl);
        embedResult = parseInstagramEmbedHtml(res.body, rawUrl);
        if (embedResult?.isPrivate) {
          return embedResult;
        }
      } catch {
      }
    }

    let ytDlpResult: SocialScanResult | null = null;
    try {
      ytDlpResult = await this.runYtDlpScan('instagram', rawUrl);
      if (ytDlpResult.isPrivate) {
        return ytDlpResult;
      }
    } catch {
    }

    if (embedResult?.ok && (!ytDlpResult?.ok || embedResult.items.length > ytDlpResult.items.length)) {
      return embedResult;
    }
    if (ytDlpResult?.ok) {
      return ytDlpResult;
    }
    if (embedResult) return embedResult;
    if (ytDlpResult) return ytDlpResult;

    return {
      ok: false,
      platform: 'instagram',
      contentType: 'post',
      url: rawUrl,
      title: 'Instagram',
      items: [],
      isPrivate: true,
      error: 'Unable to access this Instagram post. It may be private or require login.',
    };
  }

  private async scanTikTok(rawUrl: string): Promise<SocialScanResult> {
    let targetUrl = rawUrl;
    let htmlResult: SocialScanResult | null = null;

    try {
      const pageRes = await fetchHttpText(rawUrl);
      targetUrl = pageRes.finalUrl || rawUrl;
      htmlResult = parseTikTokRehydrationHtml(pageRes.body, targetUrl);
      if (htmlResult?.isPrivate) {
        return htmlResult;
      }
      if (htmlResult?.ok && htmlResult.contentType === 'carousel' && htmlResult.items.length > 0) {
        return htmlResult;
      }
    } catch {
    }

    const ytRes = await this.runYtDlpScan('tiktok', targetUrl);
    if (ytRes.ok) {
      return ytRes;
    }
    if (ytRes.isPrivate) {
      return ytRes;
    }
    if (htmlResult?.ok) {
      return htmlResult;
    }
    return ytRes;
  }

  private async scanYouTube(rawUrl: string): Promise<SocialScanResult> {
    return this.runYtDlpScan('youtube', rawUrl);
  }

  private async scanCustomUrl(rawUrl: string): Promise<SocialScanResult> {
    try {
      await assertPublicUrl(rawUrl);
    } catch (err) {
      return {
        ok: false,
        platform: 'custom',
        contentType: 'post',
        url: rawUrl,
        title: 'Custom URL',
        items: [],
        error: err instanceof Error ? err.message : 'Local and private network URLs cannot be scanned.',
      };
    }

    const directExtMatch = new URL(rawUrl).pathname
      .toLowerCase()
      .match(/\.(mp4|webm|mkv|mov|m4v|mp3|wav|m4a|flac|ogg|opus|jpg|jpeg|png|webp|gif|avif)$/);
    if (directExtMatch) {
      const ext = directExtMatch[1];
      const isAudio = ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'opus'].includes(ext);
      const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'].includes(ext);
      const leaf = decodeURIComponent(new URL(rawUrl).pathname.split('/').pop() || 'media').replace(
        /\.[^.]+$/,
        ''
      );
      const kind: SocialMediaItem['kind'] = isAudio ? 'audio' : isImage ? 'image' : 'video';
      return {
        ok: true,
        platform: 'custom',
        contentType: isAudio ? 'music' : isImage ? 'post' : 'video',
        url: rawUrl,
        title: leaf || 'Direct Media',
        thumbnailUrl: isImage ? rawUrl : undefined,
        items: [
          {
            id: 'custom-1',
            index: 0,
            kind,
            title: leaf || 'Direct Media',
            thumbnailUrl: isImage ? rawUrl : undefined,
            mediaUrl: rawUrl,
            sourceUrl: rawUrl,
            ext,
          },
        ],
      };
    }

    const ytRes = await this.runYtDlpScan('custom', rawUrl);
    if (ytRes.isPrivate || (ytRes.ok && ytRes.items.length > 0)) {
      return ytRes;
    }

    try {
      const pageRes = await fetchHttpText(rawUrl, 5, true);
      const finalUrl = pageRes.finalUrl || rawUrl;
      const httpErr = describeCustomHttpError(pageRes.statusCode);
      if (httpErr) {
        return {
          ok: false,
          platform: 'custom',
          contentType: 'post',
          url: finalUrl,
          title: 'Custom URL',
          items: [],
          isPrivate: httpErr.isPrivate,
          error: httpErr.error,
        };
      }
      return parseCustomPageHtml(pageRes.body, finalUrl);
    } catch (err) {
      return {
        ok: false,
        platform: 'custom',
        contentType: 'post',
        url: rawUrl,
        title: 'Custom URL',
        items: [],
        error: err instanceof Error ? err.message : 'Unable to scan page URL.',
      };
    }
  }

  private async runYtDlpScan(
    platform: 'youtube' | 'instagram' | 'tiktok' | 'custom',
    url: string
  ): Promise<SocialScanResult> {
    try {
      const ytDlpPath = await ensureYtDlp(this.binDir);
      const res = await runProcess(
        ytDlpPath,
        [
          '--dump-single-json',
          '--no-warnings',
          '--no-playlist',
          '--skip-download',
          '--',
          url,
        ],
        { timeoutMs: 35000 }
      );

      if (res.code !== 0) {
        const privErr = detectPrivateError(platform, `${res.stderr}\n${res.stdout}`);
        if (privErr) {
          return {
            ok: false,
            platform,
            contentType: 'video',
            url,
            title: platform,
            items: [],
            isPrivate: true,
            error: privErr,
          };
        }
        return {
          ok: false,
          platform,
          contentType: 'video',
          url,
          title: platform,
          items: [],
          error: (res.stderr || 'Failed to extract media information').split('\n')[0].trim(),
        };
      }

      const parsed = JSON.parse(res.stdout) as Record<string, unknown>;
      return normalizeYtDlpMetadata(platform, parsed, url);
    } catch (err) {
      return {
        ok: false,
        platform,
        contentType: 'video',
        url,
        title: platform,
        items: [],
        error: err instanceof Error ? err.message : 'Unable to scan link',
      };
    }
  }

  async executeJob(
    id: string,
    req: SocialDownloadRequest,
    opts: {
      saveDir: string;
      limitRateBytesPerSec?: number | null;
      onProgress: (patch: Partial<DownloadItem>) => void;
      onComplete: (finalPath: string, totalBytes: number, displayName?: string) => void;
      onError: (message: string) => void;
    }
  ): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(id, controller);

    try {
      await fs.promises.mkdir(opts.saveDir, { recursive: true });
      if (req.platform === 'spotify') {
        await this.executeSpotifyJob(id, req, opts, controller.signal);
      } else {
        await this.executeYtDlpJob(id, req, opts, controller.signal);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      const msg = err instanceof Error ? err.message : 'Media download failed';
      this.logger.error('Media', msg, id);
      opts.onError(msg);
    } finally {
      if (this.controllers.get(id) === controller) {
        this.controllers.delete(id);
      }
    }
  }

  private async executeYtDlpJob(
    id: string,
    req: SocialDownloadRequest,
    opts: {
      saveDir: string;
      limitRateBytesPerSec?: number | null;
      onProgress: (patch: Partial<DownloadItem>) => void;
      onComplete: (finalPath: string, totalBytes: number, displayName?: string) => void;
    },
    signal: AbortSignal
  ): Promise<void> {
    const format: MediaOutputFormat = req.format || 'mp4';
    const isAudio = AUDIO_FORMATS.has(format);
    const ytDlp = await ensureYtDlp(this.binDir, () => {
      if (!signal.aborted) {
        opts.onProgress({ status: 'probing' });
      }
    });
    if (signal.aborted) throw new Error('Download canceled');
    const ffmpeg = findFfmpeg(this.binDir);

    if (isAudio && !ffmpeg) {
      throw new Error('ffmpeg is required for audio format conversion.');
    }

    const selected = req.items[0];
    const customName = req.fileName?.trim();
    const desiredName = customName
      ? sanitizeFileName(
          customName.toLowerCase().endsWith(`.${format}`) ? customName : `${customName}.${format}`
        )
      : `${sanitizeFileName(selected?.title || req.title || 'media')}.${format}`;
    const existingTarget = this.activeTargets.get(id);
    const uniqueTarget =
      existingTarget || (await allocateUniqueFilePath(opts.saveDir, desiredName));
    this.activeTargets.set(id, uniqueTarget);

    const outDir = path.dirname(uniqueTarget);
    const outStem = path.basename(uniqueTarget, path.extname(uniqueTarget));
    const outputTemplate = path.join(outDir, `${outStem}.%(ext)s`);

    const args = buildYtDlpArgs({
      req,
      outputTemplate,
      ffmpegPath: ffmpeg,
      limitRateBytesPerSec: opts.limitRateBytesPerSec,
      sourceUrl: selected?.sourceUrl || req.url,
    });

    let printedFilePath = '';
    const onLine = (line: string) => {
      if (signal.aborted) return;
      if (line.startsWith('MYLOAD_FINAL:')) {
        printedFilePath = line.slice('MYLOAD_FINAL:'.length).trim();
        return;
      }
      const prog = line.match(
        /\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?\s*(\d+(?:\.\d+)?)\s*([KMG]?i?B)(?:\s+at\s+(\d+(?:\.\d+)?)\s*([KMG]?i?B)\/s)?(?:\s+ETA\s+(\S+))?/i
      );
      if (prog) {
        const pct = Math.max(0, Math.min(100, parseFloat(prog[1])));
        const total = parseSizeToBytes(prog[2], prog[3]);
        const speed = prog[4] && prog[5] ? parseSizeToBytes(prog[4], prog[5]) ?? 0 : 0;
        const eta = prog[6] ? parseEtaText(prog[6]) : null;
        const downloaded = total ? Math.round((pct / 100) * total) : 0;
        opts.onProgress({
          status: 'downloading',
          totalBytes: total,
          downloadedBytes: downloaded,
          downloadSpeed: speed,
          etaSeconds: eta,
        });
      }
    };

    if (signal.aborted) throw new Error('Download canceled');
    opts.onProgress({ status: 'downloading' });
    const res = await runProcess(ytDlp, args, {
      signal,
      timeoutMs: 30 * 60 * 1000,
      onStdoutLine: onLine,
      onStderrLine: onLine,
    });

    if (signal.aborted) throw new Error('Download canceled');

    if (res.code !== 0) {
      const priv = detectPrivateError(req.platform, `${res.stderr}\n${res.stdout}`);
      throw new Error(priv || res.stderr.split('\n')[0] || 'Media download failed');
    }

    let finalPath = printedFilePath;
    if (!finalPath || !fs.existsSync(finalPath)) {
      if (fs.existsSync(uniqueTarget)) {
        finalPath = uniqueTarget;
      } else {
        const dirEntries = await fs.promises.readdir(outDir);
        const match = dirEntries.find((f) => f.startsWith(`${outStem}.`) && !f.endsWith('.part'));
        if (match) finalPath = path.join(outDir, match);
      }
    }

    if (!finalPath || !fs.existsSync(finalPath)) {
      throw new Error('Completed file not found on disk after media conversion');
    }

    const st = await fs.promises.stat(finalPath);
    this.activeTargets.delete(id);
    opts.onComplete(finalPath, st.size, path.basename(finalPath));
  }

  private async executeSpotifyJob(
    id: string,
    req: SocialDownloadRequest,
    opts: {
      saveDir: string;
      limitRateBytesPerSec?: number | null;
      onProgress: (patch: Partial<DownloadItem>) => void;
      onComplete: (finalPath: string, totalBytes: number, displayName?: string) => void;
    },
    signal: AbortSignal
  ): Promise<void> {
    const format: MediaOutputFormat =
      req.format && AUDIO_FORMATS.has(req.format) ? req.format : 'mp3';
    const ffmpeg = findFfmpeg(this.binDir);
    if (!ffmpeg) {
      throw new Error('ffmpeg is required to save Spotify audio tracks with tags & cover art.');
    }
    const ytDlp = await ensureYtDlp(this.binDir);

    const tracks = req.items.filter((it) => it.kind === 'audio' || req.platform === 'spotify');
    if (tracks.length === 0) {
      throw new Error('No tracks selected.');
    }

    const isSingle = tracks.length === 1 && req.bundleMode !== 'zip';
    const bundleMode = req.bundleMode === 'zip' ? 'zip' : 'individual';
    const stageDir = path.join(opts.saveDir, `.myload-sp-${id.slice(0, 8)}-${crypto.randomBytes(2).toString('hex')}`);
    await fs.promises.mkdir(stageDir, { recursive: true });

    let destFolder = opts.saveDir;
    if (!isSingle && bundleMode === 'individual') {
      const customFolder = req.fileName?.trim().replace(/\s*\(\d+\s+tracks?\)$/i, '').trim();
      destFolder = await allocateUniqueDirPath(
        opts.saveDir,
        customFolder || req.title || 'Spotify Playlist'
      );
    }

    const builtTracks: Array<{ name: string; filePath: string; bytes: number }> = [];
    const totalCount = tracks.length;
    const totalEstimated = totalCount * 5 * 1024 * 1024;
    opts.onProgress({ status: 'downloading', totalBytes: totalEstimated, downloadedBytes: 0 });

    try {
      for (let i = 0; i < totalCount; i += 1) {
        if (signal.aborted) throw new Error('Download canceled');
        const track = tracks[i];
        const artist = track.artist || 'Unknown Artist';
        const title = track.title || `Track ${i + 1}`;
        const album = track.album || req.title || title;

        const trackPrefix =
          totalCount > 1 ? `${String(i + 1).padStart(2, '0')} - ` : '';
        const customSingle = isSingle ? req.fileName?.trim() : undefined;
        const targetFileName = sanitizeFileName(
          customSingle
            ? customSingle.toLowerCase().endsWith(`.${format}`)
              ? customSingle
              : `${customSingle}.${format}`
            : `${trackPrefix}${artist} - ${title}.${format}`
        );
        const finalTrackPath =
          bundleMode === 'zip' || !isSingle
            ? path.join(bundleMode === 'zip' ? stageDir : destFolder, targetFileName)
            : await allocateUniqueFilePath(opts.saveDir, targetFileName);

        const rawStem = `raw-${i}`;
        const rawPattern = path.join(stageDir, `${rawStem}.%(ext)s`);

        const queries = [
          `ytsearch1:${artist} - ${title} official audio`,
          `ytsearch1:${artist} - ${title}`,
        ];
        let downloadedRawPath = '';
        for (const query of queries) {
          const spArgs = [
            '-f',
            'bestaudio/best',
            '--no-warnings',
            '--no-playlist',
            '--continue',
            ...(typeof opts.limitRateBytesPerSec === 'number' &&
            Number.isFinite(opts.limitRateBytesPerSec) &&
            opts.limitRateBytesPerSec > 0
              ? ['--limit-rate', String(Math.max(1024, Math.floor(opts.limitRateBytesPerSec)))]
              : []),
            '-o',
            rawPattern,
            '--',
            query,
          ];
          const dlRes = await runProcess(ytDlp, spArgs, { signal, timeoutMs: 120000 });
          if (dlRes.code === 0) {
            const stageFiles = await fs.promises.readdir(stageDir);
            const found = stageFiles.find(
              (f) => f.startsWith(`${rawStem}.`) && !f.endsWith('.part')
            );
            if (found) {
              downloadedRawPath = path.join(stageDir, found);
              break;
            }
          }
        }

        if (!downloadedRawPath || !fs.existsSync(downloadedRawPath)) {
          throw new Error(`Unable to find audio stream for "${artist} - ${title}"`);
        }

        const coverPath = path.join(stageDir, `cover-${i}.jpg`);
        const coverUrl = track.thumbnailUrl || req.items[0]?.thumbnailUrl;
        const hasCover = coverUrl ? await downloadAssetToFile(coverUrl, coverPath) : false;

        const ffArgs: string[] = ['-y', '-i', downloadedRawPath];
        const supportsCover = hasCover && ['mp3', 'm4a', 'flac'].includes(format);
        if (supportsCover) {
          ffArgs.push('-i', coverPath, '-map', '0:a', '-map', '1:v', '-c:v', 'mjpeg');
          if (format === 'mp3') {
            ffArgs.push('-id3v2_version', '3');
          }
          ffArgs.push(
            '-metadata:s:v',
            'title=Album cover',
            '-metadata:s:v',
            'comment=Cover (front)',
            '-disposition:v:0',
            'attached_pic'
          );
        } else {
          ffArgs.push('-map', '0:a');
        }

        if (format === 'mp3') {
          const br = req.quality === '192k' ? '192k' : req.quality === '128k' ? '128k' : '320k';
          ffArgs.push('-c:a', 'libmp3lame', '-b:a', br);
        } else if (format === 'm4a') {
          const br = req.quality === '192k' ? '192k' : req.quality === '128k' ? '128k' : '256k';
          ffArgs.push('-c:a', 'aac', '-b:a', br);
        } else if (format === 'flac') {
          ffArgs.push('-c:a', 'flac');
        } else if (format === 'wav') {
          ffArgs.push('-c:a', 'pcm_s16le');
        } else if (format === 'opus') {
          ffArgs.push('-c:a', 'libopus');
        }

        ffArgs.push(
          '-metadata',
          `title=${title}`,
          '-metadata',
          `artist=${artist}`,
          '-metadata',
          `album=${album}`
        );
        if (track.trackNumber) {
          ffArgs.push(
            '-metadata',
            `track=${track.trackNumber}${track.totalTracks ? `/${track.totalTracks}` : ''}`
          );
        }
        if (track.releaseYear) {
          ffArgs.push('-metadata', `date=${track.releaseYear}`);
        }
        ffArgs.push(finalTrackPath);

        const ffRes = await runProcess(ffmpeg, ffArgs, { signal, timeoutMs: 180000 });
        if (ffRes.code !== 0 || !fs.existsSync(finalTrackPath)) {
          throw new Error(`Audio encoding failed for "${artist} - ${title}"`);
        }

        await fs.promises.rm(downloadedRawPath, { force: true }).catch(() => {});
        if (hasCover) {
          await fs.promises.rm(coverPath, { force: true }).catch(() => {});
        }

        const st = await fs.promises.stat(finalTrackPath);
        builtTracks.push({
          name: path.basename(finalTrackPath),
          filePath: finalTrackPath,
          bytes: st.size,
        });

        const accumulated = builtTracks.reduce((sum, b) => sum + b.bytes, 0);
        const estimatedRemaining = Math.max(0, totalCount - (i + 1)) * Math.max(st.size, 4 * 1024 * 1024);
        opts.onProgress({
          status: 'downloading',
          downloadedBytes: accumulated,
          totalBytes: accumulated + estimatedRemaining,
        });
      }

      if (isSingle) {
        opts.onComplete(
          builtTracks[0].filePath,
          builtTracks[0].bytes,
          path.basename(builtTracks[0].filePath)
        );
        return;
      }

      if (bundleMode === 'zip') {
        const customZip = req.fileName?.trim();
        const zipFileName = customZip
          ? sanitizeFileName(customZip.toLowerCase().endsWith('.zip') ? customZip : `${customZip}.zip`)
          : `${sanitizeFileName(req.title || 'Spotify Playlist')}.zip`;
        const zipTarget = await allocateUniqueFilePath(opts.saveDir, zipFileName);
        const zipBytes = await createZipArchive(
          builtTracks.map((t) => ({ name: t.name, filePath: t.filePath })),
          zipTarget
        );
        opts.onComplete(zipTarget, zipBytes, path.basename(zipTarget));
        return;
      }

      const folderBytes = builtTracks.reduce((sum, t) => sum + t.bytes, 0);
      opts.onComplete(
        destFolder,
        folderBytes,
        `${path.basename(destFolder)} (${builtTracks.length} tracks)`
      );
    } finally {
      await fs.promises.rm(stageDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export function deriveSocialPrimaryItemName(req: SocialDownloadRequest): string {
  const custom = req.fileName?.trim();
  if (custom) {
    return sanitizeFileName(custom);
  }
  const format: MediaOutputFormat = req.format || (req.platform === 'spotify' ? 'mp3' : 'mp4');
  if (req.platform === 'spotify') {
    if (req.items.length > 1) {
      return req.bundleMode === 'zip'
        ? `${sanitizeFileName(req.title || 'Spotify Playlist')}.zip`
        : `${sanitizeFileName(req.title || 'Spotify Playlist')} (${req.items.length} tracks)`;
    }
    const first = req.items[0];
    const artist = first?.artist ? `${first.artist} - ` : '';
    return sanitizeFileName(`${artist}${first?.title || req.title || 'Track'}.${format}`);
  }
  const first = req.items[0];
  if (first?.kind === 'image') {
    const imgExt = first.ext || 'jpg';
    return sanitizeFileName(`${first.title || req.title || 'image'}.${imgExt}`);
  }
  if (first?.kind === 'audio' && !req.format) {
    const audExt = first.ext || 'mp3';
    return sanitizeFileName(`${first.title || req.title || 'audio'}.${audExt}`);
  }
  const vidExt = req.format || first?.ext || 'mp4';
  return sanitizeFileName(`${first?.title || req.title || 'media'}.${vidExt}`);
}

export function isDirectHttpSlide(
  req: SocialDownloadRequest,
  item: SocialMediaItem
): boolean {
  if (!item.mediaUrl || !isHttpUrl(item.mediaUrl)) return false;
  if (req.platform === 'instagram' || req.platform === 'tiktok') {
    if (item.kind === 'image') return true;
    if (req.platform === 'instagram' && item.kind === 'video' && (!req.format || req.format === 'mp4')) {
      return true;
    }
  }
  if (req.platform === 'custom') {
    if (item.kind === 'image') return true;
    if (item.kind === 'audio' && (!req.format || req.format === (item.ext || 'mp3'))) {
      return true;
    }
    if (
      item.kind === 'video' &&
      (req.items.length > 1 || !req.format || req.format === (item.ext || 'mp4'))
    ) {
      return true;
    }
  }
  return false;
}

