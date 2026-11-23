import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import parseTorrent from 'parse-torrent';
import type WebTorrent from 'webtorrent';
import type { WebTorrentTorrent } from 'webtorrent';
import { isHttpUrl, isMagnetUri, sanitizeFileName } from '../shared/constants';
import type {
  DownloadItem,
  ProbeResult,
  TorrentFileInfo,
  TorrentMeta,
} from '../shared/types';
import { formatDownloadError, validateSaveDirectory } from './fs-validation';
import type { LogManager } from './logger';
import { isPathInsideDir } from './security';

export const DEFAULT_PUBLIC_TRACKERS: string[] = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.moeking.me:6969/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://opentracker.io:6969/announce',
  'https://tracker.opentrackr.org:443/announce',
  'https://tracker.tamersunion.org:443/announce',
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
];

export function mergeTrackers(primary?: string[], extra: string[] = DEFAULT_PUBLIC_TRACKERS): string[] {
  const merged = new Set<string>();
  for (const tr of primary ?? []) {
    const trimmed = (tr || '').trim();
    if (trimmed) merged.add(trimmed);
  }
  for (const tr of extra) {
    const trimmed = (tr || '').trim();
    if (trimmed) merged.add(trimmed);
  }
  return [...merged];
}

export function extractMagnetPeerAddresses(rawUri: string): string[] {
  if (!isMagnetUri(rawUri)) return [];
  try {
    const u = new URL(rawUri.trim());
    return u.searchParams
      .getAll('x.pe')
      .map((p) => p.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function extractMagnetXsUrls(rawUri: string): string[] {
  if (!isMagnetUri(rawUri)) return [];
  try {
    const u = new URL(rawUri.trim());
    return u.searchParams
      .getAll('xs')
      .map((x) => x.trim())
      .filter((x) => isHttpUrl(x));
  } catch {
    return [];
  }
}

function fetchRawBufferWithTimeout(
  targetUrl: string,
  timeoutMs: number,
  signal?: AbortSignal,
  redirectsLeft = 3
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted'));
      return;
    }
    if (!isHttpUrl(targetUrl)) {
      reject(new Error('Unsafe URL'));
      return;
    }

    const client = targetUrl.startsWith('https:') ? https : http;
    const req = client.get(
      targetUrl,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
          Accept: 'application/x-bittorrent, application/octet-stream, */*',
        },
        timeout: timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
          res.resume();
          try {
            const nextUrl = new URL(res.headers.location, targetUrl).toString();
            fetchRawBufferWithTimeout(nextUrl, timeoutMs, signal, redirectsLeft - 1)
              .then(resolve)
              .catch(reject);
          } catch (err) {
            reject(err);
          }
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new Error(`HTTP ${status}`));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > 12 * 1024 * 1024) {
            req.destroy(new Error('Response too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }
    );

    const onAbort = () => {
      req.destroy(new Error('Aborted'));
      reject(new Error('Aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    req.on('timeout', () => {
      req.destroy(new Error('Timeout'));
    });
    req.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort);
      reject(err);
    });
    req.on('close', () => {
      signal?.removeEventListener('abort', onAbort);
    });
  });
}

export interface TorrentRunOptions {
  keepSeedingAfterComplete: boolean;
  onProgress: (patch: Partial<DownloadItem>) => void;
  onDownloadComplete: (finalPath: string, totalBytes: number, keepSeeding: boolean) => void;
  onError: (message: string) => void;
}

interface ActiveTorrentEntry {
  torrent: WebTorrentTorrent;
  pollTimer: ReturnType<typeof setInterval>;
  selectedIndices: Set<number> | null;
  anonymousMode: boolean;
  completionFired: boolean;
  stopping: boolean;
  lastTrackerNudgeAt: number;
}

export async function parseTorrentBuffer(
  buf: Buffer,
  sourceLabel: string
): Promise<ProbeResult> {
  const parsed = await parseTorrent(buf);
  const checkRoot = path.resolve(path.sep, 'myload-torrent-root');
  const files: TorrentFileInfo[] = (parsed.files ?? []).map((f, index) => {
    const resolvedEntry = path.resolve(checkRoot, f.path);
    if (!isPathInsideDir(checkRoot, resolvedEntry)) {
      throw new Error(`Torrent contains unsafe file path: ${f.path}`);
    }
    return {
      index,
      name: f.name,
      path: f.path,
      length: f.length,
      downloaded: 0,
      selected: true,
    };
  });

  const fallbackName =
    /^magnet:/i.test(sourceLabel) || !sourceLabel
      ? `Torrent-${(parsed.infoHash || 'unknown').slice(0, 8)}`
      : path.basename(sourceLabel.split('?')[0], '.torrent');
  const name = sanitizeFileName(parsed.name || fallbackName);
  const totalBytes =
    typeof parsed.length === 'number'
      ? parsed.length
      : files.reduce((sum, f) => sum + f.length, 0);

  return {
    kind: 'torrent',
    source: sourceLabel,
    fileName: name,
    totalBytes,
    resumeSupported: true,
    category: 'torrents',
    infoHash: parsed.infoHash,
    trackers: parsed.announce ?? [],
    files,
  };
}

export async function saveTorrentBufferToCache(
  buf: Buffer,
  cacheDir: string
): Promise<{ filePath: string; probe: ProbeResult }> {
  const probe = await parseTorrentBuffer(buf, '');
  const safeHash = (probe.infoHash || '').toLowerCase().replace(/[^a-f0-9]/g, '');
  if (!safeHash) {
    throw new Error('Invalid torrent metadata (missing infoHash)');
  }
  await fs.promises.mkdir(cacheDir, { recursive: true });
  const filePath = path.join(cacheDir, `${safeHash}.torrent`);
  await fs.promises.writeFile(filePath, buf);
  return {
    filePath,
    probe: { ...probe, source: filePath },
  };
}

export async function probeTorrentSource(rawSource: string): Promise<ProbeResult> {
  const source = normalizeTorrentSource(rawSource);

  if (isMagnetUri(source)) {
    const parsed = await parseTorrent(source);
    const dn = Array.isArray(parsed.dn) ? parsed.dn[0] : parsed.dn;
    const name = parsed.name || dn || `Torrent-${parsed.infoHash.slice(0, 8)}`;
    return {
      kind: 'torrent',
      source,
      fileName: name,
      totalBytes: null,
      resumeSupported: true,
      category: 'torrents',
      infoHash: parsed.infoHash,
      trackers: mergeTrackers(parsed.announce),
      files: [],
      warning: 'File list and exact size will load from peers after starting.',
    };
  }

  if (!fs.existsSync(source)) {
    throw new Error(`Torrent file not found: ${source}`);
  }

  const buf = await fs.promises.readFile(source);
  return parseTorrentBuffer(buf, source);
}

export function normalizeTorrentSource(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('file://')) {
    try {
      return fileURLToPath(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

export function resolveTorrentTargetPath(
  saveDir: string,
  torrentName: string | undefined,
  filePaths: string[],
  fallbackName: string
): string {
  if (filePaths.length === 1) {
    const candidate = path.resolve(saveDir, filePaths[0]);
    if (isPathInsideDir(saveDir, candidate)) {
      return candidate;
    }
  } else if (filePaths.length > 1) {
    const rootSegment = filePaths[0].split(/[\\/]/).filter(Boolean)[0] || torrentName;
    if (rootSegment) {
      const candidate = path.resolve(saveDir, rootSegment);
      if (isPathInsideDir(saveDir, candidate)) {
        return candidate;
      }
    }
  }
  return path.join(saveDir, sanitizeFileName(torrentName || fallbackName));
}

async function fetchPublicTorrentMetadataCache(
  magnetUri: string,
  infoHash: string,
  cacheDir?: string,
  signal?: AbortSignal
): Promise<ProbeResult | null> {
  const explicitPeers = extractMagnetPeerAddresses(magnetUri);
  const allLocalPeers =
    explicitPeers.length > 0 &&
    explicitPeers.every((p) => /^(127\.0\.0\.1|localhost|\[::1\]):/i.test(p));
  const xsUrls = extractMagnetXsUrls(magnetUri);
  const upperHash = infoHash.toUpperCase();
  const candidates = allLocalPeers
    ? xsUrls
    : [
        ...xsUrls,
        `https://itorrents.org/torrent/${upperHash}.torrent`,
        `https://btcache.me/torrent/${upperHash}`,
      ];
  if (candidates.length === 0) return null;

  const attempts = candidates.map(async (url): Promise<ProbeResult> => {
    const buf = await fetchRawBufferWithTimeout(url, 6500, signal);
    const parsed = await parseTorrentBuffer(buf, magnetUri);
    if ((parsed.infoHash || '').trim().toLowerCase() !== infoHash) {
      throw new Error('Mismatched infoHash');
    }
    if (!parsed.files || parsed.files.length === 0) {
      throw new Error('No files in torrent buffer');
    }
    if (cacheDir) {
      await saveTorrentBufferToCache(buf, cacheDir).catch(() => {});
    }
    return {
      ...parsed,
      source: magnetUri,
      trackers: mergeTrackers(parsed.trackers),
    };
  });

  try {
    return await Promise.any(attempts);
  } catch {
    return null;
  }
}

export function buildAnonymousClientOptions(opts: {
  downloadLimit: number;
  uploadLimit: number;
  maxConns: number;
}) {
  return {
    peerId: crypto.randomBytes(20).toString('hex'),
    nodeId: crypto.randomBytes(20).toString('hex'),
    userAgent: '',
    secure: 1,
    downloadLimit: opts.downloadLimit,
    uploadLimit: opts.uploadLimit,
    maxConns: opts.maxConns,
    utp: false,
    lsd: false,
    natUpnp: false,
    natPmp: false,
    webSeeds: false,
    tracker: {
      announce: DEFAULT_PUBLIC_TRACKERS,
    },
  };
}

export class TorrentDownloadEngine {
  private client: WebTorrent | null = null;
  private anonClient: WebTorrent | null = null;
  private readonly logger: LogManager;
  private readonly active = new Map<string, ActiveTorrentEntry>();
  private readonly activeProbes = new Map<string, Promise<ProbeResult>>();
  private readonly activeProbeCancels = new Map<string, () => Promise<void>>();
  private readonly warmPeers = new Map<string, Set<string>>();
  private cacheDir: string | null = null;
  private dlLimit: number | null = null;
  private ulLimit: number | null = null;
  private maxConns = 150;
  private idleDestroyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(logger: LogManager, cacheDir?: string) {
    this.logger = logger;
    this.cacheDir = cacheDir ?? null;
  }

  setCacheDir(cacheDir: string): void {
    this.cacheDir = cacheDir;
  }

  setLimits(dlBytesPerSec: number | null, ulBytesPerSec: number | null): void {
    this.dlLimit = dlBytesPerSec;
    this.ulLimit = ulBytesPerSec;
    for (const c of [this.client, this.anonClient]) {
      if (c && !c.destroyed) {
        c.throttleDownload(dlBytesPerSec ?? -1);
        c.throttleUpload(ulBytesPerSec ?? -1);
      }
    }
  }

  setMaxConns(maxConns: number): void {
    this.maxConns = maxConns;
    for (const c of [this.client, this.anonClient]) {
      if (c && !c.destroyed) {
        c.maxConns = maxConns;
      }
    }
  }

  private tunePeerSockets(torrent: WebTorrentTorrent): void {
    const raw = torrent as unknown as {
      _peers?: Map<
        string,
        {
          conn?: {
            _myloadTuned?: boolean;
            setNoDelay?: (noDelay?: boolean) => void;
            setKeepAlive?: (enable?: boolean, initialDelay?: number) => void;
          };
        }
      >;
    };
    if (!raw?._peers || typeof raw._peers.values !== 'function') return;
    for (const peer of raw._peers.values()) {
      const conn = peer?.conn;
      if (!conn || conn._myloadTuned) continue;
      conn._myloadTuned = true;
      try {
        conn.setNoDelay?.(true);
        conn.setKeepAlive?.(true, 30000);
      } catch {
      }
    }
  }

  private enhanceWireThroughput(wireObj: unknown, anonymousMode: boolean): void {
    const wire = wireObj as {
      _myloadEnhanced?: boolean;
      downloaded?: number;
      peerChoking?: boolean;
      extendedHandshake?: Record<string, unknown>;
      downloadSpeed?: () => number;
      on?: (event: string, fn: (bytes: number) => void) => void;
    };
    if (!wire || wire._myloadEnhanced) return;
    wire._myloadEnhanced = true;

    if (wire.extendedHandshake && typeof wire.extendedHandshake === 'object') {
      wire.extendedHandshake.reqq = 250;
      if (anonymousMode) {
        delete wire.extendedHandshake.v;
      }
    }

    if (typeof wire.downloadSpeed === 'function') {
      const origSpeed = wire.downloadSpeed.bind(wire);
      let lastDataAt = 0;
      let peakSpeed = 0;
      let peakAt = 0;

      wire.on?.('download', (bytes: number) => {
        if (bytes > 0) {
          const now = Date.now();
          lastDataAt = now;
          const live = origSpeed();
          if (live > peakSpeed) {
            peakSpeed = live;
            peakAt = now;
          }
        }
      });

      wire.downloadSpeed = () => {
        const live = origSpeed();
        const now = Date.now();
        if (live > peakSpeed) {
          peakSpeed = live;
          peakAt = now;
        }
        if (
          !wire.peerChoking &&
          (wire.downloaded || 0) > 0 &&
          lastDataAt > 0 &&
          now - lastDataAt < 4000
        ) {
          const elapsedSec = Math.max(0, (now - peakAt) / 1000);
          const decayedPeak = peakSpeed * Math.pow(0.88, elapsedSec);
          return Math.max(live, Math.round(decayedPeak * 0.72), 384 * 1024);
        }
        return live;
      };
    }
  }

  private disableUnusedRarityMap(torrent: WebTorrentTorrent): void {
    const raw = torrent as unknown as {
      strategy?: string;
      _rarityMap?: { destroy?: () => void } | null;
    };
    if (raw.strategy !== 'rarest' && raw._rarityMap) {
      try {
        raw._rarityMap.destroy?.();
      } catch {
      }
      raw._rarityMap = null;
    }
  }

  private pumpPeerQueue(
    torrent: WebTorrentTorrent,
    maxConns = this.maxConns,
    anonymousMode = false
  ): void {
    const raw = torrent as unknown as {
      destroyed?: boolean;
      paused?: boolean;
      _queue?: unknown[];
      _numConns?: number;
      _numPending?: number;
      _drain?: () => void;
      infoHash?: string;
    };
    if (!raw || raw.destroyed || raw.paused) return;

    if (typeof raw._drain === 'function' && Array.isArray(raw._queue)) {
      while (
        raw._queue.length > 0 &&
        (raw._numConns || 0) + (raw._numPending || 0) < maxConns
      ) {
        const before = raw._queue.length;
        raw._drain();
        if (raw._queue.length >= before) break;
      }
    }

    this.tunePeerSockets(torrent);

    const hash = (torrent.infoHash || '').trim().toLowerCase();
    if (hash && Array.isArray(torrent.wires) && torrent.wires.length > 0) {
      const key = `${anonymousMode ? 'anon' : 'std'}:${hash}`;
      let set = this.warmPeers.get(key);
      if (!set) {
        set = new Set<string>();
        this.warmPeers.set(key, set);
      }
      for (const wire of torrent.wires) {
        if (wire?.remoteAddress && wire?.remotePort) {
          set.add(`${wire.remoteAddress}:${wire.remotePort}`);
        }
      }
    }
  }

  private injectKnownPeers(
    torrent: WebTorrentTorrent,
    infoHash: string,
    anonymousMode: boolean,
    rawSource?: string
  ): void {
    if (torrent.destroyed) return;
    const peers = new Set<string>();
    const warmKey = infoHash ? `${anonymousMode ? 'anon' : 'std'}:${infoHash}` : '';
    const warm = warmKey ? this.warmPeers.get(warmKey) : undefined;
    if (warm) {
      for (const addr of warm) peers.add(addr);
    }
    if (rawSource) {
      for (const addr of extractMagnetPeerAddresses(rawSource)) {
        peers.add(addr);
      }
    }
    if (peers.size === 0) return;

    const applyPeers = () => {
      if (torrent.destroyed) return;
      for (const addr of peers) {
        try {
          torrent.addPeer(addr);
        } catch {
        }
      }
      this.pumpPeerQueue(torrent, this.maxConns, anonymousMode);
    };

    if (torrent.infoHash) {
      applyPeers();
    } else {
      torrent.once('infoHash', applyPeers);
    }
  }

  private attachFastPieceVerification(torrent: WebTorrentTorrent, saveDir: string): void {
    const raw = torrent as unknown as {
      destroyed?: boolean;
      files?: Array<{ path: string; _startPiece?: number; _endPiece?: number }>;
      pieces?: unknown[];
      _hasStartupBitfield?: boolean;
      _verifyPieces?: (cb: (err: Error | null) => void) => void;
      _verifyPiecesUsingBitfield?: (cb: (err: Error | null) => void) => void;
      _verifyPiecesUsingHash?: (pieces: number[], cb: (err: Error | null) => void) => void;
      _startDiscovery?: () => void;
    };
    if (typeof raw._verifyPieces !== 'function') return;

    raw._verifyPieces = (cb: (err: Error | null) => void) => {
      if (raw.destroyed) {
        cb(new Error('torrent is destroyed'));
        return;
      }
      if (typeof raw._startDiscovery === 'function') {
        try {
          raw._startDiscovery();
        } catch {
        }
      }
      if (raw._hasStartupBitfield && typeof raw._verifyPiecesUsingBitfield === 'function') {
        raw._verifyPiecesUsingBitfield(cb);
        return;
      }

      const files = Array.isArray(raw.files) ? raw.files : [];
      const piecesToVerify = new Set<number>();
      for (const file of files) {
        if (!file?.path) continue;
        const fullPath = path.resolve(saveDir, file.path);
        if (!isPathInsideDir(saveDir, fullPath)) continue;
        try {
          const st = fs.statSync(fullPath);
          if (st.isFile() && st.size > 0) {
            const start = typeof file._startPiece === 'number' ? file._startPiece : 0;
            const end =
              typeof file._endPiece === 'number'
                ? file._endPiece
                : Math.max(0, (raw.pieces?.length ?? 1) - 1);
            for (let p = start; p <= end; p += 1) {
              piecesToVerify.add(p);
            }
          }
        } catch {
        }
      }

      if (piecesToVerify.size === 0 || typeof raw._verifyPiecesUsingHash !== 'function') {
        queueMicrotask(() => cb(null));
        return;
      }
      raw._verifyPiecesUsingHash([...piecesToVerify], cb);
    };
  }

  private applyFileSelections(
    torrent: WebTorrentTorrent,
    selectedIndices: Set<number> | null
  ): void {
    if (torrent.destroyed || !Array.isArray(torrent.files) || torrent.files.length === 0) {
      return;
    }
    const totalPieces = torrent.pieces?.length ?? 0;
    const allSelected =
      selectedIndices === null || selectedIndices.size >= torrent.files.length;

    if (allSelected) {
      if (totalPieces > 0 && typeof torrent.select === 'function') {
        try {
          torrent.select(0, totalPieces - 1, 0);
          return;
        } catch {
        }
      }
      for (const file of torrent.files) {
        file.select();
      }
      return;
    }

    if (totalPieces > 0 && typeof torrent.deselect === 'function') {
      try {
        torrent.deselect(0, totalPieces - 1);
      } catch {
        for (const file of torrent.files) {
          file.deselect();
        }
      }
    } else {
      for (const file of torrent.files) {
        file.deselect();
      }
    }

    const intervals: Array<[number, number]> = [];
    torrent.files.forEach((file, idx) => {
      if (!selectedIndices.has(idx) || file.length <= 0) return;
      const rawFile = file as unknown as { _startPiece?: number; _endPiece?: number };
      if (
        typeof rawFile._startPiece === 'number' &&
        typeof rawFile._endPiece === 'number'
      ) {
        intervals.push([rawFile._startPiece, rawFile._endPiece]);
      } else {
        file.select();
      }
    });

    if (intervals.length > 0 && typeof torrent.select === 'function') {
      intervals.sort((a, b) => a[0] - b[0]);
      const merged: Array<[number, number]> = [intervals[0]];
      for (let i = 1; i < intervals.length; i += 1) {
        const prev = merged[merged.length - 1];
        const cur = intervals[i];
        if (cur[0] <= prev[1] + 1) {
          prev[1] = Math.max(prev[1], cur[1]);
        } else {
          merged.push([cur[0], cur[1]]);
        }
      }
      for (const [start, end] of merged) {
        try {
          torrent.select(start, end, 0);
        } catch {
        }
      }
    }
  }

  async start(item: DownloadItem, opts: TorrentRunOptions): Promise<void> {
    if (this.active.has(item.id)) return;
    this.cancelIdleDestroy();

    try {
      const dirCheck = await validateSaveDirectory(item.saveDir, item.totalBytes);
      if (!dirCheck.valid) {
        opts.onError(dirCheck.error || 'Invalid download folder');
        return;
      }

      await fs.promises.mkdir(item.saveDir, { recursive: true });
      const anonymousMode = Boolean(item.torrent?.anonymousMode);
      const client = await this.ensureClient(anonymousMode);

      const sourceNorm = normalizeTorrentSource(item.source);
      let expectedInfoHash = (item.torrent?.infoHash || '').trim().toLowerCase();
      if (!expectedInfoHash && isMagnetUri(sourceNorm)) {
        try {
          const parsed = await parseTorrent(sourceNorm);
          expectedInfoHash = (parsed.infoHash || '').trim().toLowerCase();
        } catch {
          expectedInfoHash = '';
        }
      }

      if (expectedInfoHash) {
        const probeKey = `${anonymousMode ? 'anon' : 'std'}:${expectedInfoHash}`;
        const cancelProbe = this.activeProbeCancels.get(probeKey);
        if (cancelProbe) {
          await cancelProbe().catch(() => {});
        }
      }

      let cachedTorrentPath =
        item.torrent?.torrentFilePath && fs.existsSync(item.torrent.torrentFilePath)
          ? item.torrent.torrentFilePath
          : null;
      if (!cachedTorrentPath && expectedInfoHash && this.cacheDir) {
        const candidateCache = path.join(this.cacheDir, `${expectedInfoHash}.torrent`);
        if (fs.existsSync(candidateCache)) {
          cachedTorrentPath = candidateCache;
        }
      }

      let torrentInput: string | Buffer = sourceNorm;
      if (cachedTorrentPath) {
        torrentInput = await fs.promises.readFile(cachedTorrentPath);
      } else if (!isMagnetUri(sourceNorm)) {
        if (!fs.existsSync(sourceNorm)) {
          opts.onError(`Torrent file not found: ${sourceNorm}`);
          return;
        }
        torrentInput = await fs.promises.readFile(sourceNorm);
      }

      const savedFiles = item.torrent?.files ?? [];
      const selectedIndices: Set<number> | null =
        savedFiles.length > 0
          ? new Set(savedFiles.filter((f) => f.selected).map((f) => f.index))
          : null;

      if (selectedIndices && selectedIndices.size === 0) {
        opts.onError('No torrent files selected for download');
        return;
      }

      if (!expectedInfoHash) {
        try {
          const parsed = await parseTorrent(torrentInput);
          expectedInfoHash = (parsed.infoHash || '').trim().toLowerCase();
        } catch {
          expectedInfoHash = '';
        }
      }

      if (expectedInfoHash) {
        const existing = client.torrents.find(
          (t) => (t.infoHash || '').trim().toLowerCase() === expectedInfoHash
        );
        if (existing) {
          const ownedByActive = [...this.active.values()].some((e) => e.torrent === existing);
          if (ownedByActive) {
            opts.onError('This torrent is already active in the queue');
            return;
          }
          await new Promise<void>((resolve) => {
            try {
              existing.destroy({ destroyStore: false }, () => resolve());
            } catch {
              resolve();
            }
          });
        }
      }

      const hasPartialSelection = selectedIndices !== null && selectedIndices.size < savedFiles.length;
      const magnetExtraAnnounce =
        isMagnetUri(sourceNorm) && item.torrent?.trackers?.length
          ? item.torrent.trackers
          : undefined;

      this.logger.info(
        'Torrent',
        `Starting ${item.name}${anonymousMode ? ' (Anonymous Mode)' : ''}`,
        item.id
      );
      opts.onProgress({
        status: item.status === 'seeding' ? 'seeding' : 'downloading',
        errorMessage: undefined,
      });

      const torrent = client.add(torrentInput, {
        path: item.saveDir,
        deselect: hasPartialSelection,
        strategy: 'sequential',
        storeCacheSlots: 96,
        uploads: 24,
        maxWebConns: anonymousMode ? 0 : 8,
        ...(magnetExtraAnnounce ? { announce: magnetExtraAnnounce } : {}),
      });

      this.attachFastPieceVerification(torrent, item.saveDir);
      this.injectKnownPeers(
        torrent,
        expectedInfoHash,
        anonymousMode,
        isMagnetUri(sourceNorm) ? sourceNorm : item.torrent?.magnetUri
      );

      const entry: ActiveTorrentEntry = {
        torrent,
        pollTimer: setInterval(() => {
          this.pumpPeerQueue(torrent, this.maxConns, anonymousMode);
          const now = Date.now();
          if (
            !entry.stopping &&
            !entry.completionFired &&
            (torrent.numPeers ?? 0) < 12 &&
            now - entry.lastTrackerNudgeAt >= 15000
          ) {
            entry.lastTrackerNudgeAt = now;
            const rawDiscovery = (
              torrent as unknown as {
                discovery?: { tracker?: { update?: () => void }; dhtAnnounce?: () => void };
              }
            ).discovery;
            try {
              rawDiscovery?.tracker?.update?.();
              rawDiscovery?.dhtAnnounce?.();
            } catch {
            }
          }
          this.emitSnapshot(item, entry, opts);
        }, 350),
        selectedIndices,
        anonymousMode,
        completionFired: item.status === 'seeding',
        stopping: false,
        lastTrackerNudgeAt: Date.now(),
      };

      this.active.set(item.id, entry);

      torrent.on('peer', () => {
        if (!entry.stopping) this.pumpPeerQueue(torrent, this.maxConns, anonymousMode);
      });

      torrent.on('wire', (wire: unknown) => {
        if (entry.stopping) return;
        this.enhanceWireThroughput(wire, anonymousMode);
        this.pumpPeerQueue(torrent, this.maxConns, anonymousMode);
      });

      torrent.on('warning', (err) => {
        if (entry.stopping) return;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn('Torrent', msg, item.id);
      });

      torrent.on('error', (err) => {
        if (entry.stopping) return;
        const msg = formatDownloadError(err, { saveDir: item.saveDir });
        this.logger.error('Torrent', `Error in ${item.name}: ${msg}`, item.id);
        this.cleanupEntry(item.id);
        opts.onError(msg);
      });

      torrent.once('metadata', () => {
        if (entry.stopping || torrent.destroyed) return;
        this.disableUnusedRarityMap(torrent);
        if (!cachedTorrentPath && this.cacheDir && torrent.torrentFile) {
          void saveTorrentBufferToCache(Buffer.from(torrent.torrentFile), this.cacheDir)
            .then((saved) => {
              if (item.torrent) {
                item.torrent.torrentFilePath = saved.filePath;
              }
            })
            .catch(() => {});
        }
        this.emitSnapshot(item, entry, opts);
      });

      torrent.once('ready', () => {
        if (entry.stopping || torrent.destroyed) return;

        const hasUnsafeFile = torrent.files.some(
          (file) => !isPathInsideDir(item.saveDir, path.resolve(item.saveDir, file.path))
        );
        if (hasUnsafeFile) {
          this.logger.error(
            'Torrent',
            `Blocked torrent with unsafe path traversal in ${item.name}`,
            item.id
          );
          void this.stopTorrent(item.id, true).then(() => {
            opts.onError('Torrent contains unsafe relative file path (blocked for security).');
          });
          return;
        }

        const requiredTorrentBytes = entry.selectedIndices
          ? torrent.files.reduce(
              (sum, f, idx) => sum + (entry.selectedIndices!.has(idx) ? f.length : 0),
              0
            )
          : torrent.length;

        if (typeof requiredTorrentBytes === 'number' && requiredTorrentBytes > 0) {
          void validateSaveDirectory(item.saveDir, requiredTorrentBytes).then((spaceRes) => {
            if (!spaceRes.valid && spaceRes.errorCode === 'DISK_FULL' && !entry.stopping) {
              const errMsg = spaceRes.error || 'Storage full for this torrent download.';
              this.logger.error('Torrent', errMsg, item.id);
              void this.stopTorrent(item.id, false).then(() => {
                opts.onError(errMsg);
              });
            }
          });
        }

        this.applyFileSelections(torrent, entry.selectedIndices);

        this.logger.info(
          'Torrent',
          `Metadata ready for ${torrent.name} (${torrent.files.length} file${torrent.files.length === 1 ? '' : 's'})`,
          item.id
        );
        this.emitSnapshot(item, entry, opts);
      });

      torrent.on('done', () => {
        if (entry.stopping || torrent.destroyed) return;
        this.handleCompletion(item, entry, opts);
      });
    } catch (err) {
      this.cleanupEntry(item.id);
      const msg = formatDownloadError(err, { saveDir: item.saveDir });
      this.logger.error('Torrent', `Failed to start ${item.name}: ${msg}`, item.id);
      opts.onError(msg);
    }
  }

  updateFileSelection(id: string, selectedIndices: number[]): void {
    const entry = this.active.get(id);
    if (!entry || entry.torrent.destroyed) return;

    const wantedSet = new Set(selectedIndices);
    entry.selectedIndices = wantedSet;
    this.applyFileSelections(entry.torrent, wantedSet);
  }

  async pause(id: string): Promise<void> {
    await this.stopTorrent(id, false);
  }

  async remove(id: string, deleteFiles: boolean): Promise<void> {
    await this.stopTorrent(id, deleteFiles);
  }

  isRunning(id: string): boolean {
    return this.active.has(id);
  }

  async probeMagnetMetadata(
    magnetUri: string,
    cacheDir?: string,
    timeoutMs = 22000,
    anonymousMode = false
  ): Promise<ProbeResult> {
    const effectiveCacheDir = cacheDir ?? this.cacheDir ?? undefined;
    const basic = await probeTorrentSource(magnetUri);
    const infoHash = (basic.infoHash || '').trim().toLowerCase();
    if (!infoHash) return basic;

    if (effectiveCacheDir) {
      const cachedPath = path.join(effectiveCacheDir, `${infoHash}.torrent`);
      if (fs.existsSync(cachedPath)) {
        try {
          const buf = await fs.promises.readFile(cachedPath);
          const parsedCached = await parseTorrentBuffer(buf, magnetUri);
          if (parsedCached.files && parsedCached.files.length > 0) {
            return {
              ...parsedCached,
              source: magnetUri,
              trackers: mergeTrackers(parsedCached.trackers, basic.trackers),
            };
          }
        } catch {
        }
      }
    }

    const probeKey = `${anonymousMode ? 'anon' : 'std'}:${infoHash}`;
    const existingPromise = this.activeProbes.get(probeKey);
    if (existingPromise) {
      return existingPromise;
    }

    const probePromise = this.runMagnetMetadataProbe(
      magnetUri,
      basic,
      infoHash,
      probeKey,
      effectiveCacheDir,
      timeoutMs,
      anonymousMode
    );
    this.activeProbes.set(probeKey, probePromise);
    try {
      return await probePromise;
    } finally {
      this.activeProbes.delete(probeKey);
      this.activeProbeCancels.delete(probeKey);
    }
  }

  private async runMagnetMetadataProbe(
    magnetUri: string,
    basic: ProbeResult,
    infoHash: string,
    probeKey: string,
    cacheDir: string | undefined,
    timeoutMs: number,
    anonymousMode: boolean
  ): Promise<ProbeResult> {
    const metaTmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'myload-meta-'));
    const { default: WebTorrentCtor } = await import('webtorrent');
    const tempClient = new WebTorrentCtor(
      anonymousMode
        ? buildAnonymousClientOptions({
            downloadLimit: -1,
            uploadLimit: -1,
            maxConns: 60,
          })
        : {
            downloadLimit: -1,
            uploadLimit: -1,
            maxConns: 60,
            secure: 0,
            utp: false,
            tracker: {
              announce: DEFAULT_PUBLIC_TRACKERS,
            },
          }
    );
    tempClient.on('error', () => {});

    const httpAbort = new AbortController();
    let pumpTimer: ReturnType<typeof setInterval> | null = null;

    try {
      const result = await new Promise<ProbeResult>((resolve) => {
        let settled = false;
        const finish = (probe: ProbeResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (pumpTimer) {
            clearInterval(pumpTimer);
            pumpTimer = null;
          }
          httpAbort.abort();
          resolve(probe);
        };

        this.activeProbeCancels.set(probeKey, async () => {
          finish(basic);
        });

        const timer = setTimeout(() => {
          finish({
            ...basic,
            warning: 'Peer metadata timed out — files and folders will appear once peers connect.',
          });
        }, timeoutMs);

        if (!anonymousMode) {
          void fetchPublicTorrentMetadataCache(
            magnetUri,
            infoHash,
            cacheDir,
            httpAbort.signal
          ).then((httpCached) => {
            if (httpCached && httpCached.files && httpCached.files.length > 0) {
              finish(httpCached);
            }
          });
        }

        const mergedTrackers = mergeTrackers(basic.trackers);
        const torrent = tempClient.add(magnetUri, {
          path: metaTmpDir,
          deselect: true,
          skipVerify: true,
          storeCacheSlots: 0,
          announce: mergedTrackers,
        });

        this.attachFastPieceVerification(torrent, metaTmpDir);
        this.injectKnownPeers(torrent, infoHash, anonymousMode, magnetUri);

        pumpTimer = setInterval(() => {
          if (!settled && !torrent.destroyed) {
            this.pumpPeerQueue(torrent, 60, anonymousMode);
          }
        }, 180);

        torrent.on('peer', () => {
          if (!settled) this.pumpPeerQueue(torrent, 60, anonymousMode);
        });

        torrent.on('wire', (wire: unknown) => {
          if (settled) return;
          this.enhanceWireThroughput(wire, anonymousMode);
          this.pumpPeerQueue(torrent, 60, anonymousMode);
        });

        torrent.on('error', () => {
          if (!settled) finish(basic);
        });

        const extractFromTorrent = async () => {
          if (settled || torrent.destroyed) return;
          this.pumpPeerQueue(torrent, 60, anonymousMode);
          const tBuf = torrent.torrentFile ? Buffer.from(torrent.torrentFile) : null;
          if (tBuf && tBuf.length > 0 && cacheDir) {
            try {
              await saveTorrentBufferToCache(tBuf, cacheDir);
            } catch {
            }
          }
          const checkRoot = path.resolve(path.sep, 'myload-torrent-root');
          const files: TorrentFileInfo[] = [];
          for (let index = 0; index < (torrent.files ?? []).length; index += 1) {
            const f = torrent.files[index];
            const resolvedEntry = path.resolve(checkRoot, f.path);
            if (!isPathInsideDir(checkRoot, resolvedEntry)) {
              finish({
                ...basic,
                warning: `Blocked unsafe torrent path: ${f.path}`,
              });
              return;
            }
            files.push({
              index,
              name: f.name,
              path: f.path,
              length: f.length,
              downloaded: 0,
              selected: true,
            });
          }
          const totalBytes = files.reduce((sum, f) => sum + f.length, 0);
          finish({
            kind: 'torrent',
            source: magnetUri,
            fileName: sanitizeFileName(torrent.name || basic.fileName),
            totalBytes: files.length > 0 ? totalBytes : torrent.length || null,
            resumeSupported: true,
            category: 'torrents',
            infoHash: torrent.infoHash || basic.infoHash,
            trackers: mergeTrackers(torrent.announce, basic.trackers),
            files,
          });
        };

        torrent.once('metadata', () => {
          void extractFromTorrent();
        });
        torrent.once('ready', () => {
          void extractFromTorrent();
        });
      });

      return result;
    } finally {
      if (pumpTimer) {
        clearInterval(pumpTimer);
      }
      httpAbort.abort();
      await new Promise<void>((resolve) => {
        try {
          tempClient.destroy(() => resolve());
        } catch {
          resolve();
        }
      });
      await fs.promises.rm(metaTmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async destroyAll(): Promise<void> {
    this.cancelIdleDestroy();
    for (const cancel of this.activeProbeCancels.values()) {
      await cancel().catch(() => {});
    }
    this.activeProbeCancels.clear();
    const ids = [...this.active.keys()];
    await Promise.all(ids.map((id) => this.stopTorrent(id, false)));
    const clients = [this.client, this.anonClient];
    this.client = null;
    this.anonClient = null;
    await Promise.all(
      clients.map((c) =>
        c && !c.destroyed
          ? new Promise<void>((resolve) => {
              try {
                c.destroy(() => resolve());
              } catch {
                resolve();
              }
            })
          : Promise.resolve()
      )
    );
  }

  private async ensureClient(anonymousMode = false): Promise<WebTorrent> {
    if (anonymousMode) {
      if (!this.anonClient || this.anonClient.destroyed) {
        const { default: WebTorrentCtor } = await import('webtorrent');
        this.anonClient = new WebTorrentCtor(
          buildAnonymousClientOptions({
            downloadLimit: this.dlLimit ?? -1,
            uploadLimit: this.ulLimit ?? -1,
            maxConns: this.maxConns,
          })
        );
        this.anonClient.on('error', (err) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error('TorrentClient', msg);
        });
      }
      return this.anonClient;
    }

    if (!this.client || this.client.destroyed) {
      const { default: WebTorrentCtor } = await import('webtorrent');
      this.client = new WebTorrentCtor({
        downloadLimit: this.dlLimit ?? -1,
        uploadLimit: this.ulLimit ?? -1,
        maxConns: this.maxConns,
        secure: 0,
        utp: false,
        tracker: {
          announce: DEFAULT_PUBLIC_TRACKERS,
        },
      });
      this.client.on('error', (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error('TorrentClient', msg);
      });
    }
    return this.client;
  }

  private cancelIdleDestroy(): void {
    if (this.idleDestroyTimer) {
      clearTimeout(this.idleDestroyTimer);
      this.idleDestroyTimer = null;
    }
  }

  private scheduleIdleDestroy(): void {
    if (this.active.size > 0 || (!this.client && !this.anonClient) || this.idleDestroyTimer) {
      return;
    }
    this.idleDestroyTimer = setTimeout(() => {
      this.idleDestroyTimer = null;
      if (this.active.size !== 0) return;
      if (this.client && !this.client.destroyed) {
        const c = this.client;
        this.client = null;
        c.destroy(() => {});
      }
      if (this.anonClient && !this.anonClient.destroyed) {
        const a = this.anonClient;
        this.anonClient = null;
        a.destroy(() => {});
      }
    }, 180000);
    this.idleDestroyTimer.unref?.();
  }

  private emitSnapshot(
    item: DownloadItem,
    entry: ActiveTorrentEntry,
    opts: TorrentRunOptions
  ): void {
    const t = entry.torrent;
    if (entry.stopping || t.destroyed) return;

    const hasMetadata = t.files && t.files.length > 0;
    const files: TorrentFileInfo[] = hasMetadata
      ? t.files.map((file, index) => ({
          index,
          name: file.name,
          path: file.path,
          length: file.length,
          downloaded: Math.max(0, Math.min(file.length, Math.round(file.downloaded || 0))),
          selected: entry.selectedIndices === null || entry.selectedIndices.has(index),
        }))
      : item.torrent?.files ?? [];

    const selectedFiles = files.filter((f) => f.selected);
    const totalBytes = hasMetadata
      ? selectedFiles.reduce((sum, f) => sum + f.length, 0)
      : item.totalBytes;
    const downloadedBytes = hasMetadata
      ? selectedFiles.reduce(
          (sum, f) => sum + Math.max(0, Math.min(f.length, Math.round(f.downloaded || 0))),
          0
        )
      : item.downloadedBytes;

    const allSelectedDone =
      hasMetadata &&
      selectedFiles.length > 0 &&
      selectedFiles.every((f) => {
        const live = t.files[f.index];
        return live ? Boolean(live.done) : false;
      });

    const torrentName = sanitizeFileName(t.name || item.name);
    const targetPath = resolveTorrentTargetPath(
      item.saveDir,
      t.name,
      files.map((f) => f.path),
      item.name
    );

    const torrentMeta: TorrentMeta = {
      infoHash: t.infoHash || item.torrent?.infoHash || '',
      peers: t.numPeers ?? 0,
      seeds: countSeeds(t),
      ratio: Number.isFinite(t.ratio) ? Number(t.ratio.toFixed(2)) : 0,
      trackers: t.announce?.length ? t.announce : item.torrent?.trackers ?? [],
      magnetUri: t.magnetURI || item.torrent?.magnetUri,
      torrentFilePath: item.torrent?.torrentFilePath,
      anonymousMode: entry.anonymousMode,
      files,
    };

    const remaining =
      totalBytes !== null ? Math.max(0, totalBytes - downloadedBytes) : null;
    const dlSpeed = allSelectedDone ? 0 : Math.round(t.downloadSpeed || 0);
    const ulSpeed = Math.round(t.uploadSpeed || 0);
    const etaSeconds =
      allSelectedDone
        ? null
        : remaining !== null && dlSpeed > 0
          ? Math.ceil(remaining / dlSpeed)
          : null;

    opts.onProgress({
      name: torrentName,
      filePath: targetPath,
      status: entry.completionFired ? 'seeding' : 'downloading',
      totalBytes,
      downloadedBytes,
      uploadedBytes: t.uploaded || 0,
      downloadSpeed: dlSpeed,
      uploadSpeed: ulSpeed,
      etaSeconds,
      torrent: torrentMeta,
    });

    if (allSelectedDone && !entry.completionFired) {
      this.handleCompletion(item, entry, opts);
    }
  }

  private handleCompletion(
    item: DownloadItem,
    entry: ActiveTorrentEntry,
    opts: TorrentRunOptions
  ): void {
    if (entry.completionFired || entry.stopping) return;
    entry.completionFired = true;

    const t = entry.torrent;
    const files = t.files.map((file, index) => ({
      index,
      name: file.name,
      path: file.path,
      length: file.length,
      downloaded: Math.max(0, Math.min(file.length, Math.round(file.downloaded || 0))),
      selected: entry.selectedIndices === null || entry.selectedIndices.has(index),
    }));
    const selectedFiles = files.filter((f) => f.selected);
    const finalBytes =
      selectedFiles.length > 0
        ? selectedFiles.reduce((sum, f) => sum + f.length, 0)
        : t.length || item.totalBytes || 0;
    const finalName = sanitizeFileName(t.name || item.name);
    const finalPath = resolveTorrentTargetPath(
      item.saveDir,
      t.name,
      files.map((f) => f.path),
      item.name
    );

    this.logger.info('Torrent', `Download complete for ${finalName}`, item.id);

    const keepSeeding = entry.anonymousMode ? false : opts.keepSeedingAfterComplete;
    if (keepSeeding) {
      opts.onDownloadComplete(finalPath, finalBytes, true);
    } else {
      void this.stopTorrent(item.id, false).then(() => {
        opts.onDownloadComplete(finalPath, finalBytes, false);
      });
    }
  }

  private cleanupEntry(id: string): ActiveTorrentEntry | undefined {
    const entry = this.active.get(id);
    if (!entry) return undefined;
    clearInterval(entry.pollTimer);
    this.active.delete(id);
    this.scheduleIdleDestroy();
    return entry;
  }

  private async stopTorrent(id: string, destroyStore: boolean): Promise<void> {
    const entry = this.cleanupEntry(id);
    if (!entry) return;
    entry.stopping = true;

    if (entry.torrent.destroyed) return;
    await new Promise<void>((resolve) => {
      try {
        entry.torrent.destroy({ destroyStore }, () => resolve());
      } catch {
        resolve();
      }
    });
  }
}

function countSeeds(t: WebTorrentTorrent): number {
  let seeds = 0;
  for (const wire of t.wires ?? []) {
    if (wire?.isSeeder) {
      seeds += 1;
    }
  }
  return seeds;
}

