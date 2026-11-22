import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { classifyFileName, isDownloadingStatus } from '../shared/categories';
import {
  createDefaultSettings,
  deriveNameFromSource,
  extractDownloadableSources,
  formatScheduleSummary,
  isHttpUrl,
  isMagnetUri,
  isTorrentFilePath,
  normalizeDownloadSchedule,
  resolveSaveDirForFile,
  sanitizeFileName,
  speedToBytesPerSec,
} from '../shared/constants';
import type {
  AddDownloadRequest,
  AppSettings,
  AppStateSnapshot,
  BridgeStatus,
  BrowserInterceptPayload,
  DirectoryValidationResult,
  DiskSpaceInfo,
  DownloadItem,
  DownloadKind,
  DownloadSchedule,
  GlobalStats,
  LogEntry,
  MultiPartScanResult,
  PopupSessionData,
  PowerAction,
  ProbeResult,
  QueueMode,
  ShutdownCountdownState,
  SocialDownloadRequest,
  TorrentFileInfo,
} from '../shared/types';
import { BrowserBridgeServer } from './bridge';
import { validateSaveDirectory } from './fs-validation';
import { HttpDownloadEngine } from './http-engine';
import { LogManager } from './logger';
import { scanMultiParts } from './multipart-scanner';
import { NetworkBalancer } from './network-balancer';
import { PowerManager, type PowerPlatformAdapter } from './power';
import { isPathInsideDir, redactSensitiveUrl } from './security';
import {
  SocialMediaDownloader,
  deriveSocialPrimaryItemName,
  isDirectHttpSlide,
} from './social-downloader';
import { StateStore, normalizeFilterTabOrder } from './store';
import { TokenBucket } from './throttle';
import {
  TorrentDownloadEngine,
  normalizeTorrentSource,
  probeTorrentSource,
} from './torrent-engine';

function prepareScheduleForAdd(
  rawSchedule: DownloadSchedule | undefined,
  startPaused: boolean,
  now = Date.now()
): { schedule?: DownloadSchedule; initialPaused: boolean } {
  const norm = normalizeDownloadSchedule(rawSchedule);
  if (!norm) {
    return { schedule: undefined, initialPaused: startPaused };
  }
  const startAt = norm.startAt && norm.startAt > now ? norm.startAt : null;
  const stopAt = norm.stopAt && norm.stopAt > now ? norm.stopAt : null;
  const cleaned =
    startAt || stopAt
      ? {
          ...(startAt ? { startAt } : {}),
          ...(stopAt ? { stopAt } : {}),
        }
      : undefined;
  return {
    schedule: cleaned,
    initialPaused: startPaused || Boolean(cleaned?.startAt && cleaned.startAt > now),
  };
}

export interface ManagerCallbacks {
  onDownloadsUpdated?: (downloads: DownloadItem[]) => void;
  onStatsUpdated?: (stats: GlobalStats) => void;
  onSettingsUpdated?: (settings: AppSettings) => void;
  onLogAppended?: (entry: LogEntry) => void;
  onLogsCleared?: () => void;
  onDownloadCompleted?: (item: DownloadItem) => void;
  onPowerCountdown?: (state: ShutdownCountdownState | null) => void;
  onBrowserIntercept?: (payload: BrowserInterceptPayload) => void;
  onOpenCompactPopup?: (session: Omit<PopupSessionData, 'sessionId'>) => void;
  onFocusRequested?: () => void;
  onTaskbarProgress?: (progress: number, mode: 'none' | 'normal' | 'indeterminate') => void;
  readClipboard?: () => Promise<string> | string;
  showNotification?: (title: string, body: string) => void;
}

export class DownloadManager {
  private readonly store: StateStore;
  private readonly logger: LogManager;
  private readonly dlThrottle: TokenBucket;
  private readonly httpEngine: HttpDownloadEngine;
  private readonly torrentEngine: TorrentDownloadEngine;
  private readonly socialDownloader: SocialMediaDownloader;
  private readonly powerManager: PowerManager;
  private readonly networkBalancer: NetworkBalancer;
  private readonly bridge: BrowserBridgeServer;
  private readonly callbacks: ManagerCallbacks;
  private readonly defaultDownloadDir: string;
  private readonly enableBridge: boolean;
  private readonly appVersion: string;

  private downloads: DownloadItem[] = [];
  private settings: AppSettings;

  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private clipboardTimer: ReturnType<typeof setInterval> | null = null;
  private scheduleTimer: ReturnType<typeof setInterval> | null = null;
  private lastClipboardValue = '';
  private lastCopiedDownloadable: string | null = null;
  private lastConsumedDownloadable: string | null = null;
  private lastStatsSignature = '';
  private observedAggregatePeak = 0;
  private shuttingDown = false;
  private readonly pendingDuplicateChoices = new Map<string, 'auto-rename' | 'overwrite'>();
  private readonly equalBuckets = new Map<string, TokenBucket>();
  private readonly pendingMediaJobs = new Map<string, SocialDownloadRequest>();

  constructor(opts: {
    stateFilePath: string;
    logFilePath: string | null;
    defaultDownloadDir: string;
    powerAdapter: PowerPlatformAdapter;
    callbacks?: ManagerCallbacks;
    enableBridge?: boolean;
    appVersion?: string;
  }) {
    this.defaultDownloadDir = opts.defaultDownloadDir;
    this.callbacks = opts.callbacks ?? {};
    this.enableBridge = opts.enableBridge !== false;
    this.appVersion = opts.appVersion ?? '1.0.1';
    this.store = new StateStore(opts.stateFilePath, opts.defaultDownloadDir);
    this.logger = new LogManager(opts.logFilePath, (entry) => {
      this.callbacks.onLogAppended?.(entry);
    });
    this.dlThrottle = new TokenBucket(null);
    this.httpEngine = new HttpDownloadEngine(this.dlThrottle, this.logger);
    this.torrentEngine = new TorrentDownloadEngine(this.logger);
    this.socialDownloader = new SocialMediaDownloader(
      path.join(path.dirname(opts.stateFilePath), 'bin'),
      this.logger
    );
    this.powerManager = new PowerManager(opts.powerAdapter, {
      onCountdownUpdate: (state) => {
        this.callbacks.onPowerCountdown?.(state);
      },
      onActionComplete: (action) => {
        this.logger.info('Power', `Executed scheduled power action: ${action}`);
      },
    });
    this.networkBalancer = new NetworkBalancer({
      logger: this.logger,
      onLimitChange: (dl, ul) => {
        this.syncBalancedLimits(dl, ul);
      },
    });
    this.bridge = new BrowserBridgeServer(this.logger, {
      getHealth: () => {
        const stats = this.computeStats();
        return {
          activeCount: stats.activeCount,
          totalDownloadSpeed: stats.totalDownloadSpeed,
          showConfirmationDialog: this.settings.showConfirmationDialog,
        };
      },
      onFocusWindow: () => {
        this.callbacks.onFocusRequested?.();
      },
      onIntercept: (payload) => this.handleBrowserIntercept(payload),
      onMediaScan: (platform, url) => this.socialDownloader.scan(platform, url),
      onMediaDownload: (req) => this.handleBridgeMediaDownload(req),
    });

    const loaded = this.store.load();
    this.downloads = loaded.downloads;
    this.settings = loaded.settings;
    this.applyThrottleSettings();
  }

  start(): void {
    this.logger.info('App', 'MyLoad download manager started');
    this.statsTimer = setInterval(() => this.broadcastStats(), 750);
    this.scheduleTimer = setInterval(() => {
      void this.processSchedules();
    }, 1000);
    this.syncClipboardWatcher();
    void this.syncBridge();
    void this.processSchedules();
    this.scheduleQueue();
    this.broadcastStats();
  }

  getBridgeStatus(): BridgeStatus {
    return this.bridge.getStatus();
  }

  getSnapshot(): AppStateSnapshot {
    return {
      appVersion: this.appVersion,
      downloads: this.cloneDownloads(),
      settings: { ...this.settings },
      stats: this.computeStats(),
      logs: this.logger.getEntries(),
      countdown: this.powerManager.getCountdownState(),
    };
  }

  getDownloads(): DownloadItem[] {
    return this.cloneDownloads();
  }

  getSettings(): AppSettings {
    return { ...this.settings };
  }

  async probeSource(
    rawSource: string,
    requestHeaders?: Record<string, string>
  ): Promise<ProbeResult> {
    const trimmed = rawSource.trim();
    if (!trimmed) {
      throw new Error('Please enter a URL, magnet link, or choose a .torrent file');
    }

    if (isMagnetUri(trimmed) || isTorrentFilePath(trimmed) || trimmed.startsWith('file://')) {
      return probeTorrentSource(trimmed);
    }

    return this.httpEngine.probeUrl(trimmed, requestHeaders);
  }

  checkFileExists(saveDir: string, fileName: string): boolean {
    const safe = sanitizeFileName(fileName);
    return fs.existsSync(path.join(saveDir, safe));
  }

  async getDiskSpace(dirPath: string): Promise<DiskSpaceInfo | null> {
    const res = await validateSaveDirectory(dirPath || this.settings.defaultDownloadDir);
    return res.diskSpace;
  }

  async validateDirectory(
    dirPath: string,
    requiredBytes?: number | null
  ): Promise<DirectoryValidationResult> {
    return validateSaveDirectory(dirPath, requiredBytes);
  }

  async addDownload(req: AddDownloadRequest): Promise<DownloadItem> {
    const rawSource = req.source.trim();
    if (
      !rawSource ||
      (!isHttpUrl(rawSource) &&
        !isMagnetUri(rawSource) &&
        !isTorrentFilePath(rawSource) &&
        !rawSource.startsWith('file://'))
    ) {
      throw new Error(
        'Unsupported URL or file path. Enter an http(s):// URL, magnet link, or .torrent file.'
      );
    }

    const kind: DownloadKind =
      req.kind ??
      (isMagnetUri(rawSource) || isTorrentFilePath(rawSource) || rawSource.startsWith('file://')
        ? 'torrent'
        : 'http');

    const source = kind === 'torrent' ? normalizeTorrentSource(rawSource) : rawSource;

    let probe: ProbeResult | null = null;
    if (kind === 'torrent' && !isMagnetUri(source)) {
      probe = await probeTorrentSource(source);
    }

    const baseName = req.fileName?.trim()
      ? sanitizeFileName(req.fileName)
      : probe?.fileName || deriveNameFromSource(source, kind);

    const requestedSaveDir =
      req.saveDir?.trim() || resolveSaveDirForFile(this.settings, baseName, kind);

    let torrentMeta: DownloadItem['torrent'];
    let totalBytes: number | null = probe?.totalBytes ?? null;

    if (kind === 'torrent') {
      const files: TorrentFileInfo[] = (probe?.files ?? []).map((f) => ({
        ...f,
        selected:
          !req.selectedFileIndices || req.selectedFileIndices.length === 0
            ? true
            : req.selectedFileIndices.includes(f.index),
      }));

      if (files.length > 0) {
        totalBytes = files
          .filter((f) => f.selected)
          .reduce((sum, f) => sum + f.length, 0);
      }

      torrentMeta = {
        infoHash: probe?.infoHash ?? '',
        peers: 0,
        seeds: 0,
        ratio: 0,
        trackers: probe?.trackers ?? [],
        magnetUri: isMagnetUri(source) ? source : undefined,
        torrentFilePath: isMagnetUri(source) ? undefined : source,
        files,
      };
    }

    const { schedule, initialPaused } = prepareScheduleForAdd(
      req.schedule,
      Boolean(req.startPaused)
    );

    const dirCheck = await validateSaveDirectory(
      requestedSaveDir,
      initialPaused ? null : totalBytes
    );
    if (!dirCheck.valid) {
      throw new Error(dirCheck.error || 'Invalid download folder');
    }
    const saveDir = dirCheck.normalizedPath;

    if (req.alwaysUseThisFolder) {
      if (this.settings.folderRoutingMode === 'per-category') {
        const cat = classifyFileName(baseName, kind);
        this.settings.categoryDownloadDirs = {
          ...this.settings.categoryDownloadDirs,
          [cat]: saveDir,
        };
      } else {
        this.settings.defaultDownloadDir = saveDir;
        this.settings.alwaysUseDefaultDir = true;
      }
    }
    this.recordRecentDir(saveDir);

    const item: DownloadItem = {
      id: crypto.randomUUID(),
      kind,
      source,
      name: baseName,
      saveDir,
      filePath: path.join(saveDir, baseName),
      category: classifyFileName(baseName, kind),
      status: initialPaused ? 'paused' : 'queued',
      totalBytes,
      downloadedBytes: 0,
      uploadedBytes: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      etaSeconds: null,
      resumeSupported: kind === 'torrent',
      segments: [],
      torrent: torrentMeta,
      requestHeaders: req.requestHeaders,
      addedAt: Date.now(),
      retryCount: 0,
      schedule,
    };

    if (req.duplicateOverride) {
      this.pendingDuplicateChoices.set(item.id, req.duplicateOverride);
    }

    this.downloads.unshift(item);
    const schedNote = formatScheduleSummary(schedule);
    this.logger.info(
      'Queue',
      `Added ${item.name} (${kind.toUpperCase()})${schedNote ? ` (${schedNote})` : ''}`,
      item.id
    );
    this.emitAndSaveImmediate();

    if (!initialPaused) {
      this.scheduleQueue();
    }

    this.markClipboardSourcesConsumed([rawSource]);
    return { ...item, requestHeaders: undefined };
  }

  async addBatchDownloads(
    reqs: AddDownloadRequest[],
    queueModeOverride?: QueueMode
  ): Promise<DownloadItem[]> {
    if (queueModeOverride && queueModeOverride !== this.settings.queueMode) {
      this.settings.queueMode = queueModeOverride;
      this.callbacks.onSettingsUpdated?.({ ...this.settings });
    }
    const created: DownloadItem[] = [];
    for (let i = 0; i < reqs.length; i += 1) {
      const req = reqs[i];
      const item = await this.addDownload({
        ...req,
        alwaysUseThisFolder: i === 0 ? req.alwaysUseThisFolder : false,
      });
      created.push(item);
    }
    this.markClipboardSourcesConsumed(reqs.map((r) => r.source));
    return created;
  }

  async scanMultiParts(
    url: string,
    requestHeaders?: Record<string, string>,
    pageCandidates?: Array<{ url: string; fileName?: string }>
  ): Promise<MultiPartScanResult> {
    return scanMultiParts(url, { requestHeaders, pageCandidates });
  }

  async pauseDownload(id: string): Promise<void> {
    const item = this.findItem(id);
    if (!item) return;

    if (item.kind === 'http') {
      this.httpEngine.pause(id);
      this.releaseEqualBucket(id);
    } else if (item.kind === 'media') {
      this.socialDownloader.cancel(id);
    } else {
      await this.torrentEngine.pause(id);
    }

    if (item.status !== 'completed') {
      item.status = 'paused';
      item.downloadSpeed = 0;
      item.uploadSpeed = 0;
      item.etaSeconds = null;
      for (const seg of item.segments) {
        seg.speed = 0;
        if (seg.status === 'active') seg.status = 'pending';
      }
      this.logger.info('Queue', `Paused ${item.name}`, item.id);
      this.emitAndSaveImmediate();
      this.scheduleQueue();
      this.broadcastStats();
    }
  }

  async resumeDownload(id: string): Promise<void> {
    const item = this.findItem(id);
    if (!item || item.status === 'completed') return;
    if (item.status === 'downloading' || item.status === 'probing' || item.status === 'queued') {
      return;
    }

    if (item.schedule?.startAt) {
      item.schedule = item.schedule.stopAt ? { stopAt: item.schedule.stopAt } : undefined;
    }

    item.status = 'queued';
    item.errorMessage = undefined;
    this.logger.info('Queue', `Queued ${item.name} for resume`, item.id);
    this.emitAndSaveImmediate();
    this.scheduleQueue();
    this.broadcastStats();
  }

  async updateDownloadSchedule(
    id: string,
    rawSchedule: DownloadSchedule | null
  ): Promise<DownloadItem | null> {
    const item = this.findItem(id);
    if (!item || item.status === 'completed') return null;

    const nextSchedule = normalizeDownloadSchedule(rawSchedule);
    if (nextSchedule?.startAt && nextSchedule.startAt > Date.now()) {
      if (
        item.status === 'downloading' ||
        item.status === 'probing' ||
        item.status === 'queued' ||
        item.status === 'seeding'
      ) {
        await this.pauseDownload(item.id);
      }
    }

    item.schedule = nextSchedule;
    const summary = formatScheduleSummary(nextSchedule);
    this.logger.info(
      'Schedule',
      summary
        ? `Updated schedule for ${item.name}: ${summary}`
        : `Cleared schedule for ${item.name}`,
      item.id
    );
    this.emitAndSaveImmediate();
    await this.processSchedules();
    const updated = this.findItem(id);
    return updated ? { ...updated, requestHeaders: undefined } : null;
  }

  async processSchedules(now = Date.now()): Promise<void> {
    if (this.shuttingDown) return;

    let changed = false;
    let shouldQueue = false;

    for (const item of [...this.downloads]) {
      if (item.status === 'completed' || !item.schedule) continue;

      if (item.schedule.startAt && now >= item.schedule.startAt) {
        const remainingStop = item.schedule.stopAt ?? null;
        if (remainingStop && now >= remainingStop) {
          item.schedule = undefined;
          changed = true;
          this.logger.info(
            'Schedule',
            `Schedule window elapsed without starting for ${item.name}`,
            item.id
          );
          continue;
        }

        item.schedule = remainingStop ? { stopAt: remainingStop } : undefined;
        changed = true;
        if (item.status === 'paused' || item.status === 'error') {
          item.status = 'queued';
          item.errorMessage = undefined;
          shouldQueue = true;
          this.logger.info('Schedule', `Scheduled start reached for ${item.name}`, item.id);
        }
      }

      if (item.schedule?.stopAt && now >= item.schedule.stopAt) {
        const remainingStart = item.schedule.startAt ?? null;
        item.schedule = remainingStart ? { startAt: remainingStart } : undefined;
        changed = true;
        if (
          item.status === 'downloading' ||
          item.status === 'probing' ||
          item.status === 'queued' ||
          item.status === 'seeding'
        ) {
          this.logger.info(
            'Schedule',
            `Scheduled stop reached — pausing ${item.name}`,
            item.id
          );
          await this.pauseDownload(item.id);
        }
      }
    }

    if (changed) {
      this.emitAndSaveImmediate();
    }
    if (shouldQueue) {
      this.scheduleQueue();
    }
  }

  async retryDownload(id: string): Promise<void> {
    const item = this.findItem(id);
    if (!item) return;
    item.errorMessage = undefined;
    item.retryCount = 0;
    item.status = 'queued';
    this.logger.info('Queue', `Retrying ${item.name}`, item.id);
    this.emitAndSaveImmediate();
    this.scheduleQueue();
  }

  async pauseAll(): Promise<void> {
    const targets = this.downloads.filter(
      (d) =>
        d.status === 'downloading' ||
        d.status === 'probing' ||
        d.status === 'queued' ||
        d.status === 'seeding'
    );
    await Promise.all(targets.map((d) => this.pauseDownload(d.id)));
  }

  async resumeAll(): Promise<void> {
    const targets = this.downloads.filter(
      (d) => d.status === 'paused' || d.status === 'error'
    );
    for (const item of targets) {
      item.status = 'queued';
      item.errorMessage = undefined;
    }
    if (targets.length > 0) {
      this.logger.info('Queue', `Resumed ${targets.length} download(s)`);
      this.emitAndSaveImmediate();
      this.scheduleQueue();
    }
  }

  async removeDownloads(ids: string[], deleteFiles: boolean): Promise<void> {
    const idSet = new Set(ids);
    const removed: DownloadItem[] = [];

    for (const id of ids) {
      const item = this.findItem(id);
      if (!item) continue;
      removed.push(item);

      if (item.kind === 'http') {
        this.httpEngine.cancel(id);
        this.releaseEqualBucket(id);
      } else if (item.kind === 'media') {
        this.socialDownloader.cancel(id);
        this.pendingMediaJobs.delete(id);
      } else {
        await this.torrentEngine.remove(id, deleteFiles);
      }

      if (deleteFiles) {
        await deleteDownloadFiles(item);
      }
    }

    this.downloads = this.downloads.filter((d) => !idSet.has(d.id));
    if (removed.length > 0) {
      this.logger.info(
        'Queue',
        `Removed ${removed.length} item(s)${deleteFiles ? ' (with files deleted)' : ''}`
      );
      this.emitAndSaveImmediate();
      this.scheduleQueue();
      this.broadcastStats();
    }
  }

  updateTorrentFiles(id: string, selectedIndices: number[]): void {
    const item = this.findItem(id);
    if (!item || item.kind !== 'torrent' || !item.torrent) return;

    const wanted = new Set(selectedIndices);
    item.torrent.files = item.torrent.files.map((f) => ({
      ...f,
      selected: wanted.has(f.index),
    }));
    const total = item.torrent.files
      .filter((f) => f.selected)
      .reduce((sum, f) => sum + f.length, 0);
    if (total > 0) {
      item.totalBytes = total;
    }

    this.torrentEngine.updateFileSelection(id, selectedIndices);
    this.emitAndSaveImmediate();
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    const next: AppSettings = {
      ...this.settings,
      ...patch,
      filterTabOrder: patch.filterTabOrder
        ? normalizeFilterTabOrder(patch.filterTabOrder)
        : this.settings.filterTabOrder,
    };

    const prevWatch = this.settings.watchClipboard;
    const prevBridgeEnabled = this.settings.browserBridgeEnabled;
    const prevBridgePort = this.settings.browserBridgePort;
    this.settings = next;

    this.applyThrottleSettings();
    if (prevWatch !== next.watchClipboard) {
      this.syncClipboardWatcher();
    }
    if (
      prevBridgeEnabled !== next.browserBridgeEnabled ||
      prevBridgePort !== next.browserBridgePort
    ) {
      void this.syncBridge();
    }

    if (!next.keepSeedingAfterComplete) {
      for (const item of this.downloads) {
        if (item.kind === 'torrent' && item.status === 'seeding') {
          void this.torrentEngine.pause(item.id).then(() => {
            item.status = 'completed';
            item.uploadSpeed = 0;
            this.emitAndSaveImmediate();
          });
        }
      }
    }

    this.callbacks.onSettingsUpdated?.({ ...this.settings });
    this.scheduleQueue();
    this.broadcastStats();
    void this.store.save(this.downloads, this.settings);
    return { ...this.settings };
  }

  resetSettings(): AppSettings {
    const fresh = createDefaultSettings(this.defaultDownloadDir);
    return this.updateSettings(fresh);
  }

  getLogs(): LogEntry[] {
    return this.logger.getEntries();
  }

  clearLogs(): void {
    this.logger.clear();
    this.callbacks.onLogsCleared?.();
  }

  formatLogsForExport(): string {
    return this.logger.formatForExport();
  }

  formatDownloadsForExport(ids?: string[]): string {
    const target =
      ids && ids.length > 0
        ? this.downloads.filter((d) => ids.includes(d.id))
        : this.downloads;
    return target.map((d) => d.source).join('\n');
  }

  cancelPowerCountdown(): void {
    this.powerManager.cancelCountdown();
    this.logger.info('Power', 'Scheduled power action canceled by user');
  }

  async executePowerNow(): Promise<void> {
    await this.powerManager.executeNow();
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    if (this.statsTimer) clearInterval(this.statsTimer);
    if (this.clipboardTimer) clearInterval(this.clipboardTimer);
    if (this.scheduleTimer) clearInterval(this.scheduleTimer);
    if (this.emitTimer) clearTimeout(this.emitTimer);
    if (this.saveTimer) clearTimeout(this.saveTimer);

    for (const item of this.downloads) {
      if (item.kind === 'http' && this.httpEngine.isRunning(item.id)) {
        this.httpEngine.pause(item.id);
      }
    }
    this.socialDownloader.cancelAll();

    this.dlThrottle.dispose();
    for (const bucket of this.equalBuckets.values()) {
      bucket.dispose();
    }
    this.equalBuckets.clear();
    this.networkBalancer.dispose();
    this.powerManager.dispose();
    await this.bridge.stop();
    await this.torrentEngine.destroyAll();
    await this.store.save(this.downloads, this.settings);
    await this.store.flush();
    await this.logger.flush();
  }

  private scheduleQueue(): void {
    if (this.shuttingDown) return;

    const runningCount = this.downloads.filter(
      (d) => d.status === 'downloading' || d.status === 'probing'
    ).length;

    let maxConcurrent =
      this.settings.queueMode === 'sequential'
        ? 1
        : this.settings.maxConcurrentDownloads;

    if (this.settings.gamingModeEnabled) {
      maxConcurrent =
        this.settings.gamingModeProfile === 'gaming'
          ? Math.min(1, maxConcurrent)
          : Math.min(2, maxConcurrent);
    }

    const slots = Math.max(0, maxConcurrent - runningCount);
    if (slots === 0) {
      this.syncPreventSleep();
      this.applyThrottleSettings();
      return;
    }

    const queued = [...this.downloads]
      .reverse()
      .filter((d) => d.status === 'queued');

    for (const item of queued.slice(0, slots)) {
      const override = this.pendingDuplicateChoices.get(item.id);
      this.pendingDuplicateChoices.delete(item.id);
      this.startItem(item, override);
    }

    this.syncPreventSleep();
    this.applyThrottleSettings();
  }

  private startItem(
    item: DownloadItem,
    duplicateOverride?: 'auto-rename' | 'overwrite'
  ): void {
    if (item.kind === 'http') {
      if (this.httpEngine.isRunning(item.id)) return;
      const effectiveConnections = this.settings.gamingModeEnabled
        ? this.settings.gamingModeProfile === 'gaming'
          ? Math.min(2, this.settings.httpConnections)
          : Math.min(4, this.settings.httpConnections)
        : this.settings.httpConnections;
      const itemBucket = this.getOrCreateEqualBucket(item.id);
      item.status = 'probing';
      void this.httpEngine.start(item, {
        connections: effectiveConnections,
        maxRetries: this.settings.maxRetries,
        duplicatePolicy: this.settings.duplicatePolicy,
        duplicateOverride,
        throttleOverride: itemBucket,
        onProgress: (patch) => {
          Object.assign(item, patch);
          this.scheduleEmit();
          this.scheduleSave();
          this.syncPreventSleep();
        },
        onComplete: (finalPath, totalBytes) => {
          this.releaseEqualBucket(item.id);
          item.filePath = finalPath;
          item.name = path.basename(finalPath);
          item.category = classifyFileName(item.name, 'http');
          item.totalBytes = totalBytes;
          item.downloadedBytes = totalBytes;
          item.downloadSpeed = 0;
          item.etaSeconds = 0;
          item.status = 'completed';
          item.completedAt = Date.now();
          item.requestHeaders = undefined;
          this.onItemFinished(item);
        },
        onError: (message) => {
          this.releaseEqualBucket(item.id);
          item.status = 'error';
          item.downloadSpeed = 0;
          item.etaSeconds = null;
          item.errorMessage = message;
          this.handleCriticalStorageError(item, message);
          this.emitAndSaveImmediate();
          this.scheduleQueue();
          this.applyThrottleSettings();
          this.broadcastStats();
        },
      });
      return;
    }

    if (item.kind === 'media') {
      const jobReq = this.pendingMediaJobs.get(item.id);
      if (!jobReq) {
        item.status = 'error';
        item.errorMessage = 'Media job data unavailable — please re-add from extension';
        this.emitAndSaveImmediate();
        this.scheduleQueue();
        return;
      }
      item.status = 'probing';
      void this.socialDownloader.executeJob(item.id, jobReq, {
        saveDir: item.saveDir,
        onProgress: (patch) => {
          Object.assign(item, patch);
          this.scheduleEmit();
          this.scheduleSave();
          this.syncPreventSleep();
        },
        onComplete: (finalPath, totalBytes, displayName) => {
          this.pendingMediaJobs.delete(item.id);
          item.filePath = finalPath;
          item.name = displayName || path.basename(finalPath);
          item.category = classifyFileName(item.name, 'http');
          item.totalBytes = totalBytes;
          item.downloadedBytes = totalBytes;
          item.downloadSpeed = 0;
          item.etaSeconds = 0;
          item.status = 'completed';
          item.completedAt = Date.now();
          this.onItemFinished(item);
        },
        onError: (message) => {
          item.status = 'error';
          item.downloadSpeed = 0;
          item.etaSeconds = null;
          item.errorMessage = message;
          this.handleCriticalStorageError(item, message);
          this.emitAndSaveImmediate();
          this.scheduleQueue();
          this.applyThrottleSettings();
          this.broadcastStats();
        },
      });
      return;
    }

    if (this.torrentEngine.isRunning(item.id)) return;
    item.status = 'downloading';
    void this.torrentEngine.start(item, {
      keepSeedingAfterComplete: this.settings.keepSeedingAfterComplete,
      onProgress: (patch) => {
        Object.assign(item, patch);
        this.scheduleEmit();
        this.scheduleSave();
        this.syncPreventSleep();
      },
      onDownloadComplete: (finalPath, totalBytes, keepSeeding) => {
        item.filePath = finalPath;
        item.totalBytes = totalBytes;
        item.downloadedBytes = totalBytes;
        item.downloadSpeed = 0;
        item.etaSeconds = keepSeeding ? null : 0;
        item.status = keepSeeding ? 'seeding' : 'completed';
        if (!keepSeeding) {
          item.uploadSpeed = 0;
        }
        item.completedAt = Date.now();
        this.onItemFinished(item);
      },
      onError: (message) => {
        item.status = 'error';
        item.downloadSpeed = 0;
        item.uploadSpeed = 0;
        item.etaSeconds = null;
        item.errorMessage = message;
        this.handleCriticalStorageError(item, message);
        this.emitAndSaveImmediate();
        this.scheduleQueue();
        this.broadcastStats();
      },
    });
  }

  private onItemFinished(item: DownloadItem): void {
    this.emitAndSaveImmediate();
    this.callbacks.onDownloadCompleted?.({ ...item });

    if (this.settings.desktopNotifications) {
      this.callbacks.showNotification?.('Download completed', item.name);
    }

    this.scheduleQueue();
    this.applyThrottleSettings();
    this.broadcastStats();
    this.checkAutoPowerTrigger();
  }

  private checkAutoPowerTrigger(): void {
    const action = this.settings.autoPowerAction;
    if (action === 'off') return;

    const stillDownloading = this.downloads.some(
      (d) =>
        d.status === 'downloading' ||
        d.status === 'probing' ||
        d.status === 'queued'
    );
    if (stillDownloading) return;

    this.logger.info('Power', `All downloads finished; starting 60s countdown for "${action}"`);
    this.settings.autoPowerAction = 'off';
    this.callbacks.onSettingsUpdated?.({ ...this.settings });
    void this.store.save(this.downloads, this.settings);
    this.powerManager.startCountdown(action as Exclude<PowerAction, 'off'>, 60);
  }

  private applyThrottleSettings(): void {
    const userDl = speedToBytesPerSec(
      this.settings.downloadSpeedLimitEnabled,
      this.settings.downloadSpeedLimitValue,
      this.settings.downloadSpeedLimitUnit
    );
    const userUl = speedToBytesPerSec(
      this.settings.uploadSpeedLimitEnabled,
      this.settings.uploadSpeedLimitValue,
      this.settings.uploadSpeedLimitUnit
    );

    const activeItems = this.downloads.filter(
      (d) => d.status === 'downloading' || d.status === 'probing'
    );
    const currentDlSpeed = activeItems.reduce((sum, d) => sum + d.downloadSpeed, 0);
    if (currentDlSpeed > this.observedAggregatePeak) {
      this.observedAggregatePeak = currentDlSpeed;
    }

    this.torrentEngine.setMaxConns(this.settings.gamingModeEnabled ? 18 : 35);
    this.networkBalancer.configure({
      enabled: this.settings.gamingModeEnabled,
      active: activeItems.length > 0,
      profile: this.settings.gamingModeProfile,
      userDownloadCap: userDl,
      userUploadCap: userUl,
      currentDownloadSpeed: currentDlSpeed,
    });

    const effective = this.networkBalancer.getEffectiveLimits();
    this.syncBalancedLimits(effective.downloadLimit, effective.uploadLimit);
  }

  private syncBalancedLimits(dlLimit: number | null, ulLimit: number | null): void {
    const activeItems = this.downloads.filter(
      (d) => d.status === 'downloading' || d.status === 'probing'
    );
    const currentDlSpeed = activeItems.reduce((sum, d) => sum + d.downloadSpeed, 0);

    if (this.settings.queueMode === 'parallel-equal' && activeItems.length >= 2) {
      const aggregateCap =
        dlLimit !== null
          ? dlLimit
          : Math.max(
              512 * 1024,
              Math.round(Math.max(this.observedAggregatePeak, currentDlSpeed) * 1.12)
            );
      const perItemShare = Math.max(
        32 * 1024,
        Math.floor(aggregateCap / activeItems.length)
      );
      this.dlThrottle.setLimit(dlLimit);
      for (const item of activeItems) {
        if (item.kind === 'http') {
          this.getOrCreateEqualBucket(item.id).setLimit(perItemShare);
        }
      }
      const activeTorrentCount = activeItems.filter((d) => d.kind === 'torrent').length;
      const torrentLimit =
        activeTorrentCount > 0 ? perItemShare * activeTorrentCount : dlLimit;
      this.torrentEngine.setLimits(torrentLimit, ulLimit);
      return;
    }

    this.dlThrottle.setLimit(dlLimit);
    for (const bucket of this.equalBuckets.values()) {
      bucket.setLimit(dlLimit);
    }
    this.torrentEngine.setLimits(dlLimit, ulLimit);
  }

  private handleCriticalStorageError(failedItem: DownloadItem, message: string): void {
    if (!/^Storage full\b|^Not enough storage space\b/i.test(message)) {
      return;
    }
    const failedRoot = path.parse(path.resolve(failedItem.saveDir)).root.toLowerCase();
    let pausedOthers = 0;
    for (const other of this.downloads) {
      if (other.id === failedItem.id) continue;
      if (
        other.status !== 'downloading' &&
        other.status !== 'probing' &&
        other.status !== 'queued'
      ) {
        continue;
      }
      const otherRoot = path.parse(path.resolve(other.saveDir)).root.toLowerCase();
      if (otherRoot === failedRoot) {
        if (other.kind === 'http') {
          this.httpEngine.pause(other.id);
          this.releaseEqualBucket(other.id);
        } else if (other.kind === 'media') {
          this.socialDownloader.cancel(other.id);
        } else {
          void this.torrentEngine.pause(other.id);
        }
        other.status = 'paused';
        other.downloadSpeed = 0;
        other.uploadSpeed = 0;
        other.etaSeconds = null;
        other.errorMessage = message;
        pausedOthers += 1;
      }
    }
    if (pausedOthers > 0) {
      this.logger.warn(
        'Storage',
        `Storage full on ${failedRoot || failedItem.saveDir}; paused ${pausedOthers} other queued/active download(s).`
      );
    }
    this.callbacks.showNotification?.('Storage full', message);
  }

  private getOrCreateEqualBucket(id: string): TokenBucket {
    let bucket = this.equalBuckets.get(id);
    if (!bucket) {
      bucket = new TokenBucket(this.dlThrottle.getLimit());
      this.equalBuckets.set(id, bucket);
    }
    return bucket;
  }

  private releaseEqualBucket(id: string): void {
    const bucket = this.equalBuckets.get(id);
    if (!bucket) return;
    this.equalBuckets.delete(id);
    bucket.dispose();
  }

  private async handleBridgeMediaDownload(
    req: SocialDownloadRequest
  ): Promise<{ ok: boolean; count: number; mode?: 'confirm' | 'started'; error?: string }> {
    if (!req.items || req.items.length === 0) {
      return { ok: false, count: 0, error: 'Select at least one media item to download.' };
    }

    const suggestedFileName = deriveSocialPrimaryItemName(req);
    const promptReq: SocialDownloadRequest = {
      ...req,
      fileName: req.fileName?.trim() || suggestedFileName,
    };

    if (this.settings.useCompactDownloadPopup) {
      this.callbacks.onOpenCompactPopup?.({
        mode: 'confirm',
        socialRequest: promptReq,
      });
    } else {
      this.callbacks.onFocusRequested?.();
      this.callbacks.onBrowserIntercept?.({
        url: promptReq.url,
        fileName: suggestedFileName,
        socialRequest: promptReq,
      });
    }

    this.logger.info(
      'Media',
      `Opened confirmation dialog for ${req.platform} media: ${suggestedFileName}`
    );
    return { ok: true, count: req.items.length, mode: 'confirm' };
  }

  async addSocialDownload(req: SocialDownloadRequest): Promise<DownloadItem[]> {
    const created: DownloadItem[] = [];
    const customSaveDir = req.saveDir?.trim() || '';
    const startPaused = Boolean(req.startPaused);
    let appliedFolderDefault = false;

    if (req.platform === 'instagram' || req.platform === 'tiktok') {
      const directSlides = req.items.filter((item) => isDirectHttpSlide(req, item));
      const toolItems = req.items.filter((item) => !isDirectHttpSlide(req, item));
      const referer =
        req.platform === 'instagram'
          ? 'https://www.instagram.com/'
          : 'https://www.tiktok.com/';

      for (const slide of directSlides) {
        const ext = slide.ext || (slide.kind === 'image' ? 'jpg' : 'mp4');
        const singleCustomName =
          req.items.length === 1 && req.fileName?.trim()
            ? sanitizeFileName(req.fileName.trim())
            : undefined;
        const baseName =
          singleCustomName ||
          sanitizeFileName(`${slide.title || req.title || 'slide'}.${ext}`);
        const item = await this.addDownload({
          source: slide.mediaUrl!,
          kind: 'http',
          saveDir: customSaveDir,
          fileName: baseName,
          startPaused,
          alwaysUseThisFolder: !appliedFolderDefault ? Boolean(req.alwaysUseThisFolder) : false,
          requestHeaders: { Referer: referer },
          schedule: req.schedule,
        });
        appliedFolderDefault = true;
        created.push(item);
      }

      for (const toolItem of toolItems) {
        const item = await this.enqueueSingleMediaJob(
          {
            ...req,
            title: toolItem.title || req.title,
            fileName: req.items.length === 1 ? req.fileName : undefined,
            items: [toolItem],
          },
          !appliedFolderDefault
        );
        appliedFolderDefault = true;
        created.push(item);
      }

      return created;
    }

    const single = await this.enqueueSingleMediaJob(req, true);
    created.push(single);
    return created;
  }

  private async enqueueSingleMediaJob(
    req: SocialDownloadRequest,
    applyFolderDefault: boolean
  ): Promise<DownloadItem> {
    const displayName = deriveSocialPrimaryItemName(req);
    const requestedSaveDir =
      req.saveDir?.trim() || resolveSaveDirForFile(this.settings, displayName, 'http');
    const dirCheck = await validateSaveDirectory(requestedSaveDir, null);
    if (!dirCheck.valid) {
      throw new Error(dirCheck.error || 'Invalid download folder');
    }

    if (applyFolderDefault && req.alwaysUseThisFolder) {
      if (this.settings.folderRoutingMode === 'per-category') {
        const cat = classifyFileName(displayName, 'http');
        this.settings.categoryDownloadDirs = {
          ...this.settings.categoryDownloadDirs,
          [cat]: dirCheck.normalizedPath,
        };
      } else {
        this.settings.defaultDownloadDir = dirCheck.normalizedPath;
        this.settings.alwaysUseDefaultDir = true;
      }
      this.callbacks.onSettingsUpdated?.({ ...this.settings });
    }
    this.recordRecentDir(dirCheck.normalizedPath);

    const { schedule, initialPaused } = prepareScheduleForAdd(
      req.schedule,
      Boolean(req.startPaused)
    );
    const item: DownloadItem = {
      id: crypto.randomUUID(),
      kind: 'media',
      source: req.url,
      name: displayName,
      saveDir: dirCheck.normalizedPath,
      filePath: path.join(dirCheck.normalizedPath, sanitizeFileName(displayName)),
      category: classifyFileName(displayName, 'http'),
      status: initialPaused ? 'paused' : 'queued',
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
      schedule,
    };

    this.pendingMediaJobs.set(item.id, req);
    this.downloads.unshift(item);
    const schedNote = formatScheduleSummary(schedule);
    this.logger.info(
      'Media',
      `${initialPaused ? 'Added paused' : 'Queued'} ${req.platform} media: ${item.name}${schedNote ? ` (${schedNote})` : ''}`,
      item.id
    );
    this.emitAndSaveImmediate();
    if (!initialPaused) {
      this.scheduleQueue();
    }
    return item;
  }

  private async syncBridge(): Promise<void> {
    if (!this.enableBridge || !this.settings.browserBridgeEnabled) {
      await this.bridge.stop();
      return;
    }
    const port = Math.min(65535, Math.max(1024, Math.floor(this.settings.browserBridgePort || 49173)));
    await this.bridge.start(port);
  }

  private async handleBrowserIntercept(
    payload: BrowserInterceptPayload
  ): Promise<'confirm' | 'started'> {
    const requestHeaders: Record<string, string> = {};
    if (payload.cookie) requestHeaders.Cookie = payload.cookie;
    if (payload.referrer) requestHeaders.Referer = payload.referrer;
    if (payload.userAgent) requestHeaders['User-Agent'] = payload.userAgent;

    const headersOpt = Object.keys(requestHeaders).length > 0 ? requestHeaders : undefined;
    const label = payload.fileName || redactSensitiveUrl(payload.url);
    this.logger.info('Bridge', `Intercepted browser download: ${label}`);

    const shouldAutoStart =
      this.settings.autoDownloadOnClick || !this.settings.showConfirmationDialog;

    if (shouldAutoStart) {
      try {
        if (this.settings.detectMultiPartEnabled) {
          const scan = await this.scanMultiParts(
            payload.url,
            headersOpt,
            payload.relatedParts
          ).catch(() => ({ matched: false, baseName: '', parts: [] }));

          if (scan.matched && !this.settings.multiPartDontAskAgain) {
            if (this.settings.useCompactDownloadPopup) {
              this.callbacks.onOpenCompactPopup?.({
                mode: 'confirm',
                initialPayload: payload,
              });
            } else {
              this.callbacks.onFocusRequested?.();
              this.callbacks.onBrowserIntercept?.(payload);
            }
            return 'confirm';
          }

          if (
            scan.matched &&
            this.settings.multiPartDontAskAgain &&
            this.settings.multiPartDefaultAction === 'all'
          ) {
            const created = await this.addBatchDownloads(
              scan.parts.map((p) => ({
                source: p.url,
                saveDir: resolveSaveDirForFile(
                  this.settings,
                  p.fileName || deriveNameFromSource(p.url, 'http'),
                  'http'
                ),
                fileName: p.fileName,
                requestHeaders: headersOpt,
              }))
            );
            if (this.settings.useCompactDownloadPopup && created[0]) {
              this.callbacks.onOpenCompactPopup?.({
                mode: 'progress',
                downloadId: created[0].id,
                downloadIds: created.map((d) => d.id),
              });
            }
            return 'started';
          }
        }

        const interceptKind: DownloadKind =
          isMagnetUri(payload.url) || isTorrentFilePath(payload.url) ? 'torrent' : 'http';
        const item = await this.addDownload({
          source: payload.url,
          saveDir: resolveSaveDirForFile(
            this.settings,
            payload.fileName || deriveNameFromSource(payload.url, interceptKind),
            interceptKind
          ),
          fileName: payload.fileName,
          requestHeaders: headersOpt,
        });
        if (this.settings.useCompactDownloadPopup) {
          this.callbacks.onOpenCompactPopup?.({
            mode: 'progress',
            downloadId: item.id,
          });
        }
        return 'started';
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Cannot start download';
        this.logger.error('Bridge', `Auto-download blocked for ${label}: ${msg}`);
        this.callbacks.showNotification?.('Download requires attention', msg);
      }
    }

    if (this.settings.useCompactDownloadPopup) {
      this.callbacks.onOpenCompactPopup?.({
        mode: 'confirm',
        initialPayload: payload,
      });
      return 'confirm';
    }

    this.callbacks.onFocusRequested?.();
    this.callbacks.onBrowserIntercept?.(payload);
    return 'confirm';
  }

  private syncPreventSleep(): void {
    const anyDownloading = this.downloads.some((d) => isDownloadingStatus(d.status));
    this.powerManager.setPreventSleep(this.settings.preventSleepDuringDownload && anyDownloading);
  }

  async getLastCopiedDownloadableLink(): Promise<string | null> {
    if (!this.settings.watchClipboard) return null;
    if (this.callbacks.readClipboard) {
      try {
        const live = await Promise.resolve(this.callbacks.readClipboard());
        if (typeof live === 'string' && live) {
          this.lastClipboardValue = live;
          this.inspectClipboardText(live);
        }
      } catch {
      }
    }
    return this.lastCopiedDownloadable &&
      this.lastCopiedDownloadable !== this.lastConsumedDownloadable
      ? this.lastCopiedDownloadable
      : null;
  }

  private inspectClipboardText(text: string): void {
    if (!text) return;
    const sources = extractDownloadableSources(text);
    if (sources.length === 0) {
      if (this.lastConsumedDownloadable) {
        this.lastConsumedDownloadable = null;
      }
      return;
    }
    const normalized = sources.join('\n');
    if (normalized === this.lastConsumedDownloadable) return;
    this.lastConsumedDownloadable = null;
    this.lastCopiedDownloadable = normalized;
  }

  private markClipboardSourcesConsumed(sources: string[]): void {
    if (!this.lastCopiedDownloadable) return;
    const joined = sources
      .map((s) => s.trim())
      .filter(Boolean)
      .join('\n');
    if (
      joined &&
      (joined === this.lastCopiedDownloadable ||
        (sources.length === 1 && sources[0].trim() === this.lastCopiedDownloadable))
    ) {
      this.lastConsumedDownloadable = this.lastCopiedDownloadable;
      this.lastCopiedDownloadable = null;
    }
  }

  private syncClipboardWatcher(): void {
    if (this.clipboardTimer) {
      clearInterval(this.clipboardTimer);
      this.clipboardTimer = null;
    }

    if (!this.settings.watchClipboard || !this.callbacks.readClipboard) {
      this.lastCopiedDownloadable = null;
      this.lastConsumedDownloadable = null;
      return;
    }

    void Promise.resolve(this.callbacks.readClipboard())
      .then((initial) => {
        this.lastClipboardValue = initial ?? '';
        this.inspectClipboardText(this.lastClipboardValue);
      })
      .catch(() => {
        this.lastClipboardValue = '';
      });

    this.clipboardTimer = setInterval(() => {
      if (!this.settings.watchClipboard || !this.callbacks.readClipboard) return;
      void Promise.resolve(this.callbacks.readClipboard())
        .then((text) => {
          if (!text || text === this.lastClipboardValue) return;
          this.lastClipboardValue = text;
          this.inspectClipboardText(text);
        })
        .catch(() => {
        });
    }, 1500);
  }

  private recordRecentDir(dir: string): void {
    const filtered = this.settings.recentDirs.filter(
      (d) => d.toLowerCase() !== dir.toLowerCase()
    );
    this.settings.recentDirs = [dir, ...filtered].slice(0, 8);
    this.callbacks.onSettingsUpdated?.({ ...this.settings });
  }

  private computeStats(): GlobalStats {
    let totalDownloadSpeed = 0;
    let totalUploadSpeed = 0;
    let activeCount = 0;
    let queuedCount = 0;
    let completedCount = 0;

    let knownTotal = 0;
    let knownDownloaded = 0;
    let hasUnknownActive = false;

    for (const d of this.downloads) {
      if (d.status === 'downloading' || d.status === 'probing') {
        activeCount += 1;
        totalDownloadSpeed += d.downloadSpeed;
        totalUploadSpeed += d.uploadSpeed;
        if (d.totalBytes && d.totalBytes > 0) {
          knownTotal += d.totalBytes;
          knownDownloaded += Math.min(d.totalBytes, d.downloadedBytes);
        } else {
          hasUnknownActive = true;
        }
      } else if (d.status === 'seeding') {
        activeCount += 1;
        totalUploadSpeed += d.uploadSpeed;
        completedCount += 1;
      } else if (d.status === 'queued') {
        queuedCount += 1;
      } else if (d.status === 'completed') {
        completedCount += 1;
      }
    }

    let taskbarProgress = -1;
    const downloadingCount = this.downloads.filter((d) => isDownloadingStatus(d.status)).length;
    if (downloadingCount > 0) {
      if (knownTotal > 0) {
        taskbarProgress = Math.max(0.01, Math.min(1, knownDownloaded / knownTotal));
      } else if (hasUnknownActive) {
        taskbarProgress = 2;
      }
    }

    return {
      totalDownloadSpeed,
      totalUploadSpeed,
      activeCount,
      queuedCount,
      completedCount,
      preventSleepActive: this.powerManager.isPreventSleepActive(),
      taskbarProgress,
      networkBalance: this.networkBalancer.getStats(),
    };
  }

  private broadcastStats(): void {
    if (
      this.settings.gamingModeEnabled ||
      this.settings.queueMode === 'parallel-equal'
    ) {
      this.applyThrottleSettings();
    }

    const stats = this.computeStats();
    const signature = JSON.stringify(stats);
    if (stats.activeCount === 0 && stats.queuedCount === 0 && signature === this.lastStatsSignature) {
      return;
    }
    this.lastStatsSignature = signature;

    this.callbacks.onStatsUpdated?.(stats);

    if (stats.taskbarProgress < 0) {
      this.callbacks.onTaskbarProgress?.(-1, 'none');
    } else if (stats.taskbarProgress > 1) {
      this.callbacks.onTaskbarProgress?.(2, 'indeterminate');
    } else {
      this.callbacks.onTaskbarProgress?.(stats.taskbarProgress, 'normal');
    }
  }

  private scheduleEmit(): void {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.callbacks.onDownloadsUpdated?.(this.cloneDownloads());
    }, 250);
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.store.save(this.downloads, this.settings);
    }, 1500);
  }

  private emitAndSaveImmediate(): void {
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.callbacks.onDownloadsUpdated?.(this.cloneDownloads());
    void this.store.save(this.downloads, this.settings);
  }

  private findItem(id: string): DownloadItem | undefined {
    return this.downloads.find((d) => d.id === id);
  }

  private cloneDownloads(): DownloadItem[] {
    return this.downloads.map((d) => ({
      ...d,
      requestHeaders: undefined,
      segments: d.segments.map((s) => ({ ...s })),
      torrent: d.torrent
        ? {
            ...d.torrent,
            trackers: [...d.torrent.trackers],
            files: d.torrent.files.map((f) => ({ ...f })),
          }
        : undefined,
    }));
  }
}

async function deleteDownloadFiles(item: DownloadItem): Promise<void> {
  const candidates = [item.filePath, `${item.filePath}.myload.part`];
  for (const target of candidates) {
    if (!target || !isPathInsideDir(item.saveDir, target)) continue;
    await fs.promises.rm(target, { recursive: true, force: true }).catch(() => {});
  }
}

