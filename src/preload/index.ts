import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  AddDownloadRequest,
  AppSettings,
  BrowserInterceptPayload,
  DownloadItem,
  DownloadPriority,
  DownloadSchedule,
  GlobalStats,
  LogEntry,
  MyLoadApi,
  QueueMode,
  ShutdownCountdownState,
  SocialDownloadRequest,
  UpdateStatus,
} from '../shared/types';

function onChannel<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => {
    cb(payload);
  };
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: MyLoadApi = {
  getInitialState: () => ipcRenderer.invoke('myload:get-initial-state'),
  probeSource: (source: string, requestHeaders?: Record<string, string>) =>
    ipcRenderer.invoke('myload:probe-source', source, requestHeaders),
  getBridgeStatus: () => ipcRenderer.invoke('myload:get-bridge-status'),
  openExtensionFolder: () => ipcRenderer.invoke('myload:open-extension-folder'),
  checkFileExists: (saveDir: string, fileName: string) =>
    ipcRenderer.invoke('myload:check-file-exists', saveDir, fileName),
  getDiskSpace: (dirPath: string) => ipcRenderer.invoke('myload:get-disk-space', dirPath),
  validateDirectory: (dirPath: string, requiredBytes?: number | null) =>
    ipcRenderer.invoke('myload:validate-directory', dirPath, requiredBytes),
  addDownload: (req: AddDownloadRequest) => ipcRenderer.invoke('myload:add-download', req),
  addBatchDownloads: (reqs: AddDownloadRequest[], queueModeOverride?: QueueMode) =>
    ipcRenderer.invoke('myload:add-batch-downloads', reqs, queueModeOverride),
  addSocialDownload: (req: SocialDownloadRequest) =>
    ipcRenderer.invoke('myload:add-social-download', req),
  scanMultiParts: (
    url: string,
    requestHeaders?: Record<string, string>,
    pageCandidates?: Array<{ url: string; fileName?: string }>
  ) => ipcRenderer.invoke('myload:scan-multiparts', url, requestHeaders, pageCandidates),
  getPopupSession: (sessionId: string) =>
    ipcRenderer.invoke('myload:get-popup-session', sessionId),
  openDownloadPopup: (id: string) =>
    ipcRenderer.invoke('myload:open-download-popup', id),
  openMainWindow: () => ipcRenderer.invoke('myload:open-main-window'),
  resizeCurrentWindow: (width: number, height: number) =>
    ipcRenderer.invoke('myload:win-resize', width, height),
  pauseDownload: (id: string) => ipcRenderer.invoke('myload:pause', id),
  resumeDownload: (id: string) => ipcRenderer.invoke('myload:resume', id),
  retryDownload: (id: string) => ipcRenderer.invoke('myload:retry', id),
  removeDownloads: (ids: string[], deleteFiles: boolean) =>
    ipcRenderer.invoke('myload:remove', ids, deleteFiles),
  pauseAll: () => ipcRenderer.invoke('myload:pause-all'),
  resumeAll: () => ipcRenderer.invoke('myload:resume-all'),
  updateTorrentFiles: (id: string, selectedIndices: number[]) =>
    ipcRenderer.invoke('myload:update-torrent-files', id, selectedIndices),
  updateDownloadSchedule: (id: string, schedule: DownloadSchedule | null) =>
    ipcRenderer.invoke('myload:update-download-schedule', id, schedule),
  setDownloadPriority: (id: string, priority: DownloadPriority) =>
    ipcRenderer.invoke('myload:set-priority', id, priority),
  reorderDownloads: (orderedIds: string[]) =>
    ipcRenderer.invoke('myload:reorder-downloads', orderedIds),
  updateSettings: (patch: Partial<AppSettings>) =>
    ipcRenderer.invoke('myload:update-settings', patch),
  resetSettings: () => ipcRenderer.invoke('myload:reset-settings'),
  clearLogs: () => ipcRenderer.invoke('myload:clear-logs'),
  exportLogs: () => ipcRenderer.invoke('myload:export-logs'),
  importUrlsFromFile: () => ipcRenderer.invoke('myload:import-urls-file'),
  exportDownloads: (ids?: string[]) => ipcRenderer.invoke('myload:export-downloads', ids),
  readClipboardText: () => ipcRenderer.invoke('myload:read-clipboard'),
  getLastCopiedDownloadableLink: () => ipcRenderer.invoke('myload:get-clipboard-link'),
  openRepositoryUrl: () => ipcRenderer.invoke('myload:open-repo-url'),
  openExternalLink: (target: 'repo' | 'profile' | 'email') =>
    ipcRenderer.invoke('myload:open-external-link', target),
  getUpdateStatus: () => ipcRenderer.invoke('myload:get-update-status'),
  checkForUpdates: () => ipcRenderer.invoke('myload:check-updates'),
  downloadAndInstallUpdate: () => ipcRenderer.invoke('myload:download-update'),
  openUpdateReleasePage: () => ipcRenderer.invoke('myload:open-update-page'),
  selectFolder: (defaultPath?: string) =>
    ipcRenderer.invoke('myload:select-folder', defaultPath),
  selectTorrentFile: () => ipcRenderer.invoke('myload:select-torrent-file'),
  openFile: (filePath: string) => ipcRenderer.invoke('myload:open-file', filePath),
  showInFolder: (filePath: string) => ipcRenderer.invoke('myload:show-in-folder', filePath),
  cancelPowerCountdown: () => ipcRenderer.invoke('myload:power-cancel'),
  executePowerNow: () => ipcRenderer.invoke('myload:power-execute-now'),
  minimizeWindow: () => ipcRenderer.invoke('myload:win-minimize'),
  maximizeWindow: () => ipcRenderer.invoke('myload:win-maximize'),
  closeWindow: () => ipcRenderer.invoke('myload:win-close'),
  setWindowAlwaysOnTop: (flag: boolean) =>
    ipcRenderer.invoke('myload:win-set-always-on-top', flag),
  isWindowMaximized: () => ipcRenderer.invoke('myload:win-is-maximized'),
  quitApp: () => ipcRenderer.invoke('myload:app-quit'),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  onDownloadsUpdated: (cb) => onChannel<DownloadItem[]>('myload:downloads-updated', cb),
  onStatsUpdated: (cb) => onChannel<GlobalStats>('myload:stats-updated', cb),
  onSettingsUpdated: (cb) => onChannel<AppSettings>('myload:settings-updated', cb),
  onLogAppended: (cb) => onChannel<LogEntry>('myload:log-appended', cb),
  onLogsCleared: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('myload:logs-cleared', listener);
    return () => ipcRenderer.removeListener('myload:logs-cleared', listener);
  },
  onDownloadCompleted: (cb) => onChannel<DownloadItem>('myload:download-completed', cb),
  onPowerCountdown: (cb) =>
    onChannel<ShutdownCountdownState | null>('myload:power-countdown', cb),
  onBrowserIntercept: (cb) =>
    onChannel<BrowserInterceptPayload>('myload:browser-intercept', cb),
  onWindowMaximizedChange: (cb) => onChannel<boolean>('myload:win-maximized', cb),
  onOpenAddModal: (cb) => onChannel<string | undefined>('myload:open-add-modal', cb),
  onUpdateStatus: (cb) => onChannel<UpdateStatus>('myload:update-status', cb),
};

contextBridge.exposeInMainWorld('myload', api);

