import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import parseTorrent from 'parse-torrent';
import type WebTorrent from 'webtorrent';
import type { WebTorrentTorrent } from 'webtorrent';
import { isMagnetUri, sanitizeFileName } from '../shared/constants';
import type {
  DownloadItem,
  ProbeResult,
  TorrentFileInfo,
  TorrentMeta,
} from '../shared/types';
import { formatDownloadError, validateSaveDirectory } from './fs-validation';
import type { LogManager } from './logger';
import { isPathInsideDir } from './security';

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
  completionFired: boolean;
  stopping: boolean;
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
      trackers: parsed.announce ?? [],
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

export class TorrentDownloadEngine {
  private client: WebTorrent | null = null;
  private readonly logger: LogManager;
  private readonly active = new Map<string, ActiveTorrentEntry>();
  private dlLimit: number | null = null;
  private ulLimit: number | null = null;
  private maxConns = 35;
  private idleDestroyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(logger: LogManager) {
    this.logger = logger;
  }

  setLimits(dlBytesPerSec: number | null, ulBytesPerSec: number | null): void {
    this.dlLimit = dlBytesPerSec;
    this.ulLimit = ulBytesPerSec;
    if (this.client && !this.client.destroyed) {
      this.client.throttleDownload(dlBytesPerSec ?? -1);
      this.client.throttleUpload(ulBytesPerSec ?? -1);
    }
  }

  setMaxConns(maxConns: number): void {
    this.maxConns = maxConns;
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
      const client = await this.ensureClient();

      const cachedTorrentPath =
        item.torrent?.torrentFilePath && fs.existsSync(item.torrent.torrentFilePath)
          ? item.torrent.torrentFilePath
          : null;
      const sourceNorm = normalizeTorrentSource(item.source);
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

      let expectedInfoHash = (item.torrent?.infoHash || '').trim().toLowerCase();
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

      this.logger.info('Torrent', `Starting ${item.name}`, item.id);
      opts.onProgress({
        status: item.status === 'seeding' ? 'seeding' : 'downloading',
        errorMessage: undefined,
      });

      const torrent = client.add(torrentInput, {
        path: item.saveDir,
        deselect: hasPartialSelection,
      });

      const entry: ActiveTorrentEntry = {
        torrent,
        pollTimer: setInterval(() => this.emitSnapshot(item, entry, opts), 450),
        selectedIndices,
        completionFired: item.status === 'seeding',
        stopping: false,
      };

      this.active.set(item.id, entry);

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

        torrent.files.forEach((file, idx) => {
          const wanted = entry.selectedIndices === null || entry.selectedIndices.has(idx);
          if (wanted) {
            file.select();
          } else {
            file.deselect();
          }
        });

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
    entry.torrent.files.forEach((file, idx) => {
      if (wantedSet.has(idx)) {
        file.select();
      } else {
        file.deselect();
      }
    });
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
    timeoutMs = 15000
  ): Promise<ProbeResult> {
    const basic = await probeTorrentSource(magnetUri);
    const infoHash = (basic.infoHash || '').trim().toLowerCase();
    if (!infoHash) return basic;

    if (cacheDir) {
      const cachedPath = path.join(cacheDir, `${infoHash}.torrent`);
      if (fs.existsSync(cachedPath)) {
        try {
          const buf = await fs.promises.readFile(cachedPath);
          const parsedCached = await parseTorrentBuffer(buf, magnetUri);
          if (parsedCached.files && parsedCached.files.length > 0) {
            return parsedCached;
          }
        } catch {
        }
      }
    }

    const metaTmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'myload-meta-'));
    const { default: WebTorrentCtor } = await import('webtorrent');
    const tempClient = new WebTorrentCtor({
      downloadLimit: 0,
      uploadLimit: 0,
      maxConns: 25,
    });
    tempClient.on('error', () => {});

    try {
      const result = await new Promise<ProbeResult>((resolve) => {
        let settled = false;
        const finish = (probe: ProbeResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(probe);
        };

        const timer = setTimeout(() => {
          finish({
            ...basic,
            warning: 'Peer metadata timed out — files and folders will appear once peers connect.',
          });
        }, timeoutMs);

        const torrent = tempClient.add(magnetUri, {
          path: metaTmpDir,
          deselect: true,
        });

        torrent.on('error', () => {
          finish(basic);
        });

        const extractFromTorrent = async () => {
          if (settled || torrent.destroyed) return;
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
            trackers: torrent.announce?.length ? torrent.announce : basic.trackers,
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
    const ids = [...this.active.keys()];
    await Promise.all(ids.map((id) => this.stopTorrent(id, false)));
    if (this.client && !this.client.destroyed) {
      await new Promise<void>((resolve) => {
        this.client!.destroy(() => resolve());
      });
      this.client = null;
    }
  }

  private async ensureClient(): Promise<WebTorrent> {
    if (!this.client || this.client.destroyed) {
      const { default: WebTorrentCtor } = await import('webtorrent');
      this.client = new WebTorrentCtor({
        downloadLimit: this.dlLimit ?? -1,
        uploadLimit: this.ulLimit ?? -1,
        maxConns: this.maxConns,
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
    if (this.active.size > 0 || !this.client || this.idleDestroyTimer) return;
    this.idleDestroyTimer = setTimeout(() => {
      this.idleDestroyTimer = null;
      if (this.active.size === 0 && this.client && !this.client.destroyed) {
        const client = this.client;
        this.client = null;
        client.destroy(() => {});
      }
    }, 10000);
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
        return live ? live.done || live.downloaded >= live.length : false;
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

    if (opts.keepSeedingAfterComplete) {
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
  const totalPieces = t.pieces?.length ?? 0;
  if (totalPieces === 0) return 0;

  let seeds = 0;
  for (const wire of t.wires ?? []) {
    if (!wire?.peerPieces) continue;
    let hasAll = true;
    for (let i = 0; i < totalPieces; i++) {
      if (!wire.peerPieces.get(i)) {
        hasAll = false;
        break;
      }
    }
    if (hasAll) seeds += 1;
  }
  return seeds;
}

