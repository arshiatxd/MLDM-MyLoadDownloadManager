import fs from 'node:fs';
import path from 'node:path';
import {
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  shell,
} from 'electron';
import { extractMultipleSources } from '../shared/constants';
import type {
  AddDownloadRequest,
  AppSettings,
  PopupSessionData,
  QueueMode,
} from '../shared/types';
import type { DownloadManager } from './download-manager';

const REPOSITORY_URL = 'https://github.com/arshiatxd/MLDM-MyLoadDownloadManager';

export function registerIpcHandlers(params: {
  manager: DownloadManager;
  getWindow: () => BrowserWindow | null;
  getExtensionDir: () => string;
  getPopupSession: (sessionId: string) => PopupSessionData | null;
  onOpenMainWindow: () => void;
  onRequestQuit: () => void;
}): void {
  const {
    manager,
    getWindow,
    getExtensionDir,
    getPopupSession,
    onOpenMainWindow,
    onRequestQuit,
  } = params;

  ipcMain.handle('myload:get-initial-state', () => manager.getSnapshot());
  ipcMain.handle(
    'myload:probe-source',
    (_e, source: string, requestHeaders?: Record<string, string>) =>
      manager.probeSource(source, requestHeaders)
  );
  ipcMain.handle('myload:get-bridge-status', () => manager.getBridgeStatus());
  ipcMain.handle('myload:open-extension-folder', async () => {
    const dir = getExtensionDir();
    if (fs.existsSync(dir)) {
      await shell.openPath(dir);
    }
    return dir;
  });
  ipcMain.handle('myload:check-file-exists', (_e, saveDir: string, fileName: string) =>
    manager.checkFileExists(saveDir, fileName)
  );
  ipcMain.handle('myload:get-disk-space', (_e, dirPath: string) =>
    manager.getDiskSpace(dirPath)
  );
  ipcMain.handle(
    'myload:validate-directory',
    (_e, dirPath: string, requiredBytes?: number | null) =>
      manager.validateDirectory(dirPath, requiredBytes)
  );
  ipcMain.handle('myload:add-download', (_e, req: AddDownloadRequest) =>
    manager.addDownload(req)
  );
  ipcMain.handle(
    'myload:add-batch-downloads',
    (_e, reqs: AddDownloadRequest[], queueModeOverride?: QueueMode) =>
      manager.addBatchDownloads(reqs, queueModeOverride)
  );
  ipcMain.handle(
    'myload:scan-multiparts',
    (
      _e,
      url: string,
      requestHeaders?: Record<string, string>,
      pageCandidates?: Array<{ url: string; fileName?: string }>
    ) => manager.scanMultiParts(url, requestHeaders, pageCandidates)
  );
  ipcMain.handle('myload:get-popup-session', (_e, sessionId: string) =>
    getPopupSession(sessionId)
  );
  ipcMain.handle('myload:open-main-window', () => {
    onOpenMainWindow();
  });
  ipcMain.handle('myload:win-resize', (e, width: number, height: number) => {
    const senderWin = BrowserWindow.fromWebContents(e.sender);
    if (senderWin && !senderWin.isDestroyed()) {
      const w = Math.max(420, Math.min(1200, Math.round(width)));
      const h = Math.max(240, Math.min(900, Math.round(height)));
      senderWin.setSize(w, h, true);
    }
  });
  ipcMain.handle('myload:pause', (_e, id: string) => manager.pauseDownload(id));
  ipcMain.handle('myload:resume', (_e, id: string) => manager.resumeDownload(id));
  ipcMain.handle('myload:retry', (_e, id: string) => manager.retryDownload(id));
  ipcMain.handle('myload:remove', (_e, ids: string[], deleteFiles: boolean) =>
    manager.removeDownloads(ids, deleteFiles)
  );
  ipcMain.handle('myload:pause-all', () => manager.pauseAll());
  ipcMain.handle('myload:resume-all', () => manager.resumeAll());
  ipcMain.handle('myload:update-torrent-files', (_e, id: string, selectedIndices: number[]) =>
    manager.updateTorrentFiles(id, selectedIndices)
  );
  ipcMain.handle('myload:update-settings', (_e, patch: Partial<AppSettings>) =>
    manager.updateSettings(patch)
  );
  ipcMain.handle('myload:reset-settings', () => manager.resetSettings());
  ipcMain.handle('myload:clear-logs', () => manager.clearLogs());

  ipcMain.handle('myload:export-logs', async () => {
    const win = getWindow();
    const opts: Electron.SaveDialogOptions = {
      title: 'Export MyLoad Logs',
      defaultPath: `myload-logs-${new Date().toISOString().slice(0, 10)}.log`,
      filters: [{ name: 'Log Files', extensions: ['log', 'txt'] }],
    };
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (res.canceled || !res.filePath) return null;
    await fs.promises.writeFile(res.filePath, manager.formatLogsForExport(), 'utf-8');
    return res.filePath;
  });

  ipcMain.handle('myload:import-urls-file', async () => {
    const win = getWindow();
    const opts: Electron.OpenDialogOptions = {
      title: 'Import URLs from File',
      properties: ['openFile'],
      filters: [{ name: 'Text / URL List', extensions: ['txt', 'lst', 'urls'] }],
    };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || res.filePaths.length === 0) return [];
    const content = await fs.promises.readFile(res.filePaths[0], 'utf-8');
    return extractMultipleSources(content);
  });

  ipcMain.handle('myload:export-downloads', async (_e, ids?: string[]) => {
    const win = getWindow();
    const opts: Electron.SaveDialogOptions = {
      title: 'Export Download Links',
      defaultPath: `myload-links-${new Date().toISOString().slice(0, 10)}.txt`,
      filters: [{ name: 'Text Files', extensions: ['txt'] }],
    };
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (res.canceled || !res.filePath) return null;
    await fs.promises.writeFile(res.filePath, manager.formatDownloadsForExport(ids), 'utf-8');
    return res.filePath;
  });

  ipcMain.handle('myload:read-clipboard', () => clipboard.readText());
  ipcMain.handle('myload:get-clipboard-link', () => manager.getLastCopiedDownloadableLink());
  ipcMain.handle('myload:open-repo-url', async () => {
    await shell.openExternal(REPOSITORY_URL);
  });

  ipcMain.handle('myload:select-folder', async (e, defaultPath?: string) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? getWindow();
    const opts: Electron.OpenDialogOptions = {
      title: 'Select Download Folder',
      defaultPath: defaultPath || manager.getSettings().defaultDownloadDir,
      properties: ['openDirectory', 'createDirectory'],
    };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('myload:select-torrent-file', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? getWindow();
    const opts: Electron.OpenDialogOptions = {
      title: 'Select Torrent File',
      properties: ['openFile'],
      filters: [{ name: 'Torrent Files', extensions: ['torrent'] }],
    };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('myload:open-file', async (_e, filePath: string) => {
    if (!filePath) return 'File path is missing';
    const resolvedTarget = path.resolve(filePath);
    const isKnown = manager.getDownloads().some((d) => {
      if (!d.filePath) return false;
      const known = path.resolve(d.filePath);
      return process.platform === 'win32'
        ? known.toLowerCase() === resolvedTarget.toLowerCase()
        : known === resolvedTarget;
    });
    if (!isKnown) {
      return 'Blocked opening path that is not a managed download';
    }
    if (!fs.existsSync(resolvedTarget)) {
      return 'File or folder no longer exists on disk (it may have been moved or deleted)';
    }
    return shell.openPath(resolvedTarget);
  });

  ipcMain.handle('myload:show-in-folder', (_e, filePath: string) => {
    if (!filePath) return;
    const resolvedTarget = path.resolve(filePath);
    const isKnown = manager.getDownloads().some((d) => {
      if (!d.filePath) return false;
      const known = path.resolve(d.filePath);
      const cmpKnown = process.platform === 'win32' ? known.toLowerCase() : known;
      const cmpTarget =
        process.platform === 'win32' ? resolvedTarget.toLowerCase() : resolvedTarget;
      return cmpTarget === cmpKnown || cmpTarget === `${cmpKnown}.myload.part`;
    });
    if (!isKnown) return;
    if (fs.existsSync(resolvedTarget)) {
      shell.showItemInFolder(resolvedTarget);
    } else if (fs.existsSync(`${resolvedTarget}.myload.part`)) {
      shell.showItemInFolder(`${resolvedTarget}.myload.part`);
    }
  });

  ipcMain.handle('myload:power-cancel', () => manager.cancelPowerCountdown());
  ipcMain.handle('myload:power-execute-now', () => manager.executePowerNow());

  ipcMain.handle('myload:win-minimize', (e) => {
    const senderWin = BrowserWindow.fromWebContents(e.sender) ?? getWindow();
    senderWin?.minimize();
  });

  ipcMain.handle('myload:win-maximize', (e) => {
    const senderWin = BrowserWindow.fromWebContents(e.sender) ?? getWindow();
    if (!senderWin) return;
    if (senderWin.isMaximized()) senderWin.unmaximize();
    else senderWin.maximize();
  });

  ipcMain.handle('myload:win-close', (e) => {
    const main = getWindow();
    const senderWin = BrowserWindow.fromWebContents(e.sender) ?? main;
    if (!senderWin) return;
    if (main && senderWin.id !== main.id) {
      senderWin.close();
      return;
    }
    if (manager.getSettings().minimizeToTray) {
      senderWin.hide();
    } else {
      onRequestQuit();
    }
  });

  ipcMain.handle('myload:win-is-maximized', (e) => {
    const senderWin = BrowserWindow.fromWebContents(e.sender) ?? getWindow();
    return senderWin?.isMaximized() ?? false;
  });

  ipcMain.handle('myload:app-quit', () => {
    onRequestQuit();
  });
}

