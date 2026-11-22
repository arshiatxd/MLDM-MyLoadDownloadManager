export type DownloadKind = 'http' | 'torrent' | 'media';

export type SocialPlatform = 'youtube' | 'instagram' | 'tiktok' | 'spotify';
export type MediaOutputFormat =
  | 'mp4'
  | 'mkv'
  | 'webm'
  | 'mp3'
  | 'wav'
  | 'm4a'
  | 'flac'
  | 'opus';
export type MediaQuality =
  | 'best'
  | '1080p'
  | '720p'
  | '480p'
  | '360p'
  | '320k'
  | '192k'
  | '128k';
export type PlaylistBundleMode = 'individual' | 'zip';

export interface SocialMediaItem {
  id: string;
  index: number;
  kind: 'video' | 'image' | 'audio';
  title: string;
  artist?: string;
  album?: string;
  releaseYear?: string;
  durationSeconds?: number | null;
  thumbnailUrl?: string;
  mediaUrl?: string;
  sourceUrl: string;
  ext?: string;
  trackNumber?: number;
  totalTracks?: number;
}

export interface SocialScanResult {
  ok: boolean;
  platform: SocialPlatform;
  contentType:
    | 'video'
    | 'music'
    | 'reel'
    | 'post'
    | 'carousel'
    | 'track'
    | 'album'
    | 'playlist';
  url: string;
  title: string;
  author?: string;
  album?: string;
  thumbnailUrl?: string;
  durationSeconds?: number | null;
  items: SocialMediaItem[];
  isPrivate?: boolean;
  error?: string;
}

export interface SocialDownloadRequest {
  platform: SocialPlatform;
  url: string;
  title: string;
  format?: MediaOutputFormat;
  quality?: MediaQuality;
  bundleMode?: PlaylistBundleMode;
  items: SocialMediaItem[];
  saveDir?: string;
  fileName?: string;
  startPaused?: boolean;
  alwaysUseThisFolder?: boolean;
}

export type DownloadStatus =
  | 'queued'
  | 'probing'
  | 'downloading'
  | 'seeding'
  | 'paused'
  | 'completed'
  | 'error';

export type FileCategory =
  | 'torrents'
  | 'images'
  | 'docs'
  | 'archives'
  | 'videos'
  | 'other';

export type CategoryId = 'all' | 'active' | 'completed' | FileCategory;

export type SortBy = 'newest' | 'oldest' | 'name' | 'size' | 'progress' | 'status';

export interface SegmentInfo {
  index: number;
  start: number;
  end: number;
  downloaded: number;
  speed: number;
  status: 'pending' | 'active' | 'done' | 'error';
}

export interface TorrentFileInfo {
  index: number;
  name: string;
  path: string;
  length: number;
  downloaded: number;
  selected: boolean;
}

export interface TorrentMeta {
  infoHash: string;
  peers: number;
  seeds: number;
  ratio: number;
  trackers: string[];
  magnetUri?: string;
  torrentFilePath?: string;
  files: TorrentFileInfo[];
}

export interface DownloadItem {
  id: string;
  kind: DownloadKind;
  source: string;
  name: string;
  saveDir: string;
  filePath: string;
  category: FileCategory;
  status: DownloadStatus;
  totalBytes: number | null;
  downloadedBytes: number;
  uploadedBytes: number;
  downloadSpeed: number;
  uploadSpeed: number;
  etaSeconds: number | null;
  resumeSupported: boolean;
  segments: SegmentInfo[];
  torrent?: TorrentMeta;
  requestHeaders?: Record<string, string>;
  errorMessage?: string;
  addedAt: number;
  completedAt?: number;
  retryCount: number;
}

export type SpeedUnit = 'KB/s' | 'MB/s';
export type PowerAction = 'off' | 'shutdown' | 'sleep' | 'hibernate' | 'exit';
export type ThemeMode = 'dark' | 'light' | 'system' | 'high-contrast' | 'custom';
export type FontScale = 'compact' | 'default' | 'large';
export type DuplicatePolicy = 'auto-rename' | 'overwrite' | 'ask';
export type GamingModeProfile = 'surfing' | 'gaming';
export type AppLanguage = 'en' | 'fa' | 'es' | 'fr' | 'de' | 'ru' | 'zh' | 'ar' | 'tr';
export type QueueMode = 'parallel' | 'sequential' | 'parallel-equal';
export type MultiPartDefaultAction = 'single' | 'all';
export type FolderRoutingMode = 'single' | 'per-category';
export type CategoryDownloadDirs = Record<FileCategory, string>;

export interface MultiPartCandidate {
  url: string;
  fileName: string;
  partNumber: number;
  totalBytes: number | null;
  isOriginal: boolean;
}

export interface MultiPartScanResult {
  matched: boolean;
  baseName: string;
  parts: MultiPartCandidate[];
}

export interface PopupSessionData {
  sessionId: string;
  mode: 'confirm' | 'progress';
  initialPayload?: BrowserInterceptPayload;
  socialRequest?: SocialDownloadRequest;
  downloadId?: string;
  downloadIds?: string[];
}

export interface CustomThemeColors {
  bgCanvas: string;
  bgSurface: string;
  bgElevated: string;
  accent: string;
  textPrimary: string;
  textSecondary: string;
  borderSubtle: string;
}

export interface CustomTheme {
  id: string;
  name: string;
  colors: CustomThemeColors;
}

export interface NetworkBalanceStats {
  enabled: boolean;
  active: boolean;
  rttMs: number | null;
  baselineRttMs: number | null;
  jitterMs: number | null;
  effectiveDownloadLimit: number | null;
  effectiveUploadLimit: number | null;
  state: 'idle' | 'probing' | 'steady' | 'throttling';
}

export interface AppSettings {
  defaultDownloadDir: string;
  alwaysUseDefaultDir: boolean;
  folderRoutingMode: FolderRoutingMode;
  categoryDownloadDirs: CategoryDownloadDirs;
  showConfirmationDialog: boolean;
  recentDirs: string[];

  downloadSpeedLimitEnabled: boolean;
  downloadSpeedLimitValue: number;
  downloadSpeedLimitUnit: SpeedUnit;
  uploadSpeedLimitEnabled: boolean;
  uploadSpeedLimitValue: number;
  uploadSpeedLimitUnit: SpeedUnit;

  maxConcurrentDownloads: number;
  httpConnections: number;
  maxRetries: number;
  duplicatePolicy: DuplicatePolicy;

  preventSleepDuringDownload: boolean;
  autoPowerAction: PowerAction;

  keepSeedingAfterComplete: boolean;
  minimizeToTray: boolean;
  autoResumeOnStart: boolean;
  desktopNotifications: boolean;
  completionSound: boolean;
  watchClipboard: boolean;
  browserBridgeEnabled: boolean;
  browserBridgePort: number;

  theme: ThemeMode;
  fontScale: FontScale;
  reducedMotion: boolean;
  filterTabOrder: CategoryId[];
  customThemes: CustomTheme[];
  activeCustomThemeId: string | null;
  gamingModeEnabled: boolean;
  gamingModeProfile: GamingModeProfile;
  useCompactDownloadPopup: boolean;
  autoDownloadOnClick: boolean;
  queueMode: QueueMode;
  detectMultiPartEnabled: boolean;
  multiPartDontAskAgain: boolean;
  multiPartDefaultAction: MultiPartDefaultAction;
  startOnStartup: boolean;
  autoCheckUpdates: boolean;
  language: AppLanguage;
}

export interface ProbeResult {
  kind: DownloadKind;
  source: string;
  finalUrl?: string;
  fileName: string;
  totalBytes: number | null;
  resumeSupported: boolean;
  category: FileCategory;
  infoHash?: string;
  trackers?: string[];
  files?: TorrentFileInfo[];
  warning?: string;
}

export interface AddDownloadRequest {
  source: string;
  kind?: DownloadKind;
  saveDir?: string;
  fileName?: string;
  startPaused?: boolean;
  alwaysUseThisFolder?: boolean;
  selectedFileIndices?: number[];
  duplicateOverride?: 'auto-rename' | 'overwrite';
  requestHeaders?: Record<string, string>;
}

export interface BrowserInterceptPayload {
  url: string;
  fileName?: string;
  referrer?: string;
  cookie?: string;
  userAgent?: string;
  fileSize?: number | null;
  mime?: string;
  relatedParts?: Array<{ url: string; fileName?: string }>;
  socialRequest?: SocialDownloadRequest;
}

export interface BridgeStatus {
  running: boolean;
  port: number;
  error?: string;
}

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  source: string;
  downloadId?: string;
  message: string;
}

export interface ShutdownCountdownState {
  active: boolean;
  action: Exclude<PowerAction, 'off'>;
  remainingSeconds: number;
  totalSeconds: number;
}

export interface GlobalStats {
  totalDownloadSpeed: number;
  totalUploadSpeed: number;
  activeCount: number;
  queuedCount: number;
  completedCount: number;
  preventSleepActive: boolean;
  taskbarProgress: number;
  networkBalance: NetworkBalanceStats;
}

export interface AppStateSnapshot {
  appVersion: string;
  downloads: DownloadItem[];
  settings: AppSettings;
  stats: GlobalStats;
  logs: LogEntry[];
  countdown: ShutdownCountdownState | null;
}

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateStatus {
  state: UpdateState;
  currentVersion: string;
  latestVersion?: string;
  releaseName?: string;
  releaseNotes?: string;
  releaseUrl?: string;
  publishedAt?: string;
  installerName?: string;
  installerUrl?: string;
  installerSize?: number | null;
  downloadedBytes?: number;
  totalBytes?: number | null;
  progress?: number;
  downloadedFilePath?: string;
  error?: string;
  checkedAt?: number;
}

export interface DiskSpaceInfo {
  freeBytes: number;
  totalBytes: number;
}

export type DirectoryValidationErrorCode =
  | 'EMPTY_PATH'
  | 'INVALID_PATH'
  | 'DRIVE_NOT_FOUND'
  | 'NOT_A_DIRECTORY'
  | 'PATH_TOO_LONG'
  | 'NOT_WRITABLE'
  | 'DISK_FULL';

export interface DirectoryValidationResult {
  valid: boolean;
  normalizedPath: string;
  errorCode?: DirectoryValidationErrorCode;
  error?: string;
  warning?: string;
  diskSpace: DiskSpaceInfo | null;
  willCreate: boolean;
}

export interface MyLoadApi {
  getInitialState: () => Promise<AppStateSnapshot>;
  probeSource: (source: string, requestHeaders?: Record<string, string>) => Promise<ProbeResult>;
  getBridgeStatus: () => Promise<BridgeStatus>;
  openExtensionFolder: () => Promise<string>;
  checkFileExists: (saveDir: string, fileName: string) => Promise<boolean>;
  getDiskSpace: (dirPath: string) => Promise<DiskSpaceInfo | null>;
  validateDirectory: (dirPath: string, requiredBytes?: number | null) => Promise<DirectoryValidationResult>;
  addDownload: (req: AddDownloadRequest) => Promise<DownloadItem>;
  addBatchDownloads: (reqs: AddDownloadRequest[], queueModeOverride?: QueueMode) => Promise<DownloadItem[]>;
  addSocialDownload: (req: SocialDownloadRequest) => Promise<DownloadItem[]>;
  scanMultiParts: (
    url: string,
    requestHeaders?: Record<string, string>,
    pageCandidates?: Array<{ url: string; fileName?: string }>
  ) => Promise<MultiPartScanResult>;
  getPopupSession: (sessionId: string) => Promise<PopupSessionData | null>;
  openMainWindow: () => Promise<void>;
  resizeCurrentWindow: (width: number, height: number) => Promise<void>;
  pauseDownload: (id: string) => Promise<void>;
  resumeDownload: (id: string) => Promise<void>;
  retryDownload: (id: string) => Promise<void>;
  removeDownloads: (ids: string[], deleteFiles: boolean) => Promise<void>;
  pauseAll: () => Promise<void>;
  resumeAll: () => Promise<void>;
  updateTorrentFiles: (id: string, selectedIndices: number[]) => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;
  resetSettings: () => Promise<AppSettings>;
  clearLogs: () => Promise<void>;
  exportLogs: () => Promise<string | null>;
  importUrlsFromFile: () => Promise<string[]>;
  exportDownloads: (ids?: string[]) => Promise<string | null>;
  readClipboardText: () => Promise<string>;
  getLastCopiedDownloadableLink: () => Promise<string | null>;
  openRepositoryUrl: () => Promise<void>;
  getUpdateStatus: () => Promise<UpdateStatus>;
  checkForUpdates: () => Promise<UpdateStatus>;
  downloadAndInstallUpdate: () => Promise<UpdateStatus>;
  openUpdateReleasePage: () => Promise<void>;
  selectFolder: (defaultPath?: string) => Promise<string | null>;
  selectTorrentFile: () => Promise<string | null>;
  openFile: (filePath: string) => Promise<string>;
  showInFolder: (filePath: string) => Promise<void>;
  cancelPowerCountdown: () => Promise<void>;
  executePowerNow: () => Promise<void>;
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  isWindowMaximized: () => Promise<boolean>;
  quitApp: () => Promise<void>;
  getPathForFile: (file: File) => string;
  onDownloadsUpdated: (cb: (downloads: DownloadItem[]) => void) => () => void;
  onStatsUpdated: (cb: (stats: GlobalStats) => void) => () => void;
  onSettingsUpdated: (cb: (settings: AppSettings) => void) => () => void;
  onLogAppended: (cb: (entry: LogEntry) => void) => () => void;
  onLogsCleared: (cb: () => void) => () => void;
  onDownloadCompleted: (cb: (item: DownloadItem) => void) => () => void;
  onPowerCountdown: (cb: (state: ShutdownCountdownState | null) => void) => () => void;
  onBrowserIntercept: (cb: (payload: BrowserInterceptPayload) => void) => () => void;
  onWindowMaximizedChange: (cb: (maximized: boolean) => void) => () => void;
  onOpenAddModal: (cb: (source?: string) => void) => () => void;
  onUpdateStatus: (cb: (status: UpdateStatus) => void) => () => void;
}

