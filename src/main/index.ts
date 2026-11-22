import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BrowserWindow,
  Notification,
  app,
  clipboard,
  powerSaveBlocker,
  session,
  shell,
} from 'electron';
import { isHttpUrl, isMagnetUri, isTorrentFilePath } from '../shared/constants';
import type { PopupSessionData } from '../shared/types';
import { DownloadManager } from './download-manager';
import { registerIpcHandlers } from './ipc';
import { ensureNativeMessagingHostRegistered } from './native-host';
import { createElectronPowerAdapter } from './power';
import { createAppTray, type AppTrayController } from './tray';
import { UpdateService } from './updater';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.setAppUserModelId('com.myload.app');
app.commandLine.appendSwitch(
  'disable-features',
  'MediaRouter,SpareRendererForSitePerProcess'
);
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;
let tray: AppTrayController | null = null;
let manager: DownloadManager | null = null;
let isQuitting = false;
let shutdownPromise: Promise<void> | null = null;
let startupUpdateTimer: ReturnType<typeof setTimeout> | null = null;
const popupWindows = new Map<string, { win: BrowserWindow; data: PopupSessionData }>();
const isStartupLaunch = process.argv.includes('--startup');
const isBackgroundLaunch = isStartupLaunch || process.argv.includes('--background-launch');

function syncStartupLoginItem(enabled: boolean): void {
  if (!app.isPackaged || process.env.MYLOAD_SMOKE_TEST === '1') return;
  try {
    app.setLoginItemSettings({
      openAtLogin: false,
      name: 'MyLoad',
      enabled: false,
    });
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: process.execPath,
      args: ['--startup'],
      name: 'MyLoad Download Manager',
      enabled,
    });
  } catch {
  }
}

function resolveAppAsset(relativePath: string): string {
  if (app.isPackaged) {
    const unpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked', relativePath);
    if (fs.existsSync(unpackedPath)) {
      return unpackedPath;
    }
  }
  return path.join(app.getAppPath(), relativePath);
}

function resolveExtensionDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'extension');
  }
  return path.join(app.getAppPath(), 'extension');
}

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function sendToRenderer(channel: string, ...args: unknown[]): void {
  const isRealtimeFeed =
    channel === 'myload:downloads-updated' || channel === 'myload:stats-updated';

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!isRealtimeFeed || mainWindow.isVisible()) {
      mainWindow.webContents.send(channel, ...args);
    }
  }

  for (const entry of popupWindows.values()) {
    if (!entry.win.isDestroyed() && (!isRealtimeFeed || entry.win.isVisible())) {
      entry.win.webContents.send(channel, ...args);
    }
  }
}

function isAllowedNavigationTarget(targetUrl: string): boolean {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  try {
    const parsed = new URL(targetUrl);
    if (devServerUrl) {
      return parsed.origin === new URL(devServerUrl).origin;
    }
    const allowedHtml = path.resolve(path.join(__dirname, '../renderer/index.html'));
    if (parsed.protocol !== 'file:') return false;
    const candidate = path.resolve(decodeURIComponent(parsed.pathname.replace(/^\/([A-Za-z]:)/, '$1')));
    return process.platform === 'win32'
      ? candidate.toLowerCase() === allowedHtml.toLowerCase()
      : candidate === allowedHtml;
  } catch {
    return false;
  }
}

function hardenWindowWebContents(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  win.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isAllowedNavigationTarget(targetUrl)) {
      event.preventDefault();
    }
  });
}

function openCompactPopup(data: Omit<PopupSessionData, 'sessionId'>): void {
  const sessionId = crypto.randomUUID();
  const fullData: PopupSessionData = { ...data, sessionId };

  const iconPath = resolveAppAsset('build/icon.png');
  const preloadPath = path.join(__dirname, '../preload/index.cjs');

  const isProgressOnly = data.mode === 'progress';
  const popup = new BrowserWindow({
    width: isProgressOnly ? 520 : 560,
    height: isProgressOnly ? 330 : 440,
    minWidth: 450,
    minHeight: 260,
    frame: false,
    show: false,
    alwaysOnTop: !isProgressOnly,
    resizable: true,
    minimizable: true,
    maximizable: false,
    backgroundColor: '#121215',
    icon: iconPath,
    title: 'MyLoad Download Manager — Download',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  hardenWindowWebContents(popup);
  popupWindows.set(sessionId, { win: popup, data: fullData });

  popup.once('ready-to-show', () => {
    if (!isProgressOnly) {
      popup.setAlwaysOnTop(true, 'pop-up-menu');
      popup.show();
      popup.moveTop();
      popup.focus();
    } else {
      popup.show();
      popup.focus();
    }
  });

  popup.on('closed', () => {
    popupWindows.delete(sessionId);
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    const url = new URL(devServerUrl);
    url.searchParams.set('view', 'popup');
    url.searchParams.set('session', sessionId);
    void popup.loadURL(url.toString());
  } else {
    void popup.loadFile(path.join(__dirname, '../renderer/index.html'), {
      query: { view: 'popup', session: sessionId },
    });
  }
}

function openDownloadProgressPopup(downloadId: string): void {
  for (const entry of popupWindows.values()) {
    if (entry.win.isDestroyed()) continue;
    const isMatch =
      entry.data.mode === 'progress' &&
      (entry.data.downloadId === downloadId || entry.data.downloadIds?.includes(downloadId));
    if (isMatch) {
      if (entry.win.isMinimized()) entry.win.restore();
      entry.win.show();
      entry.win.focus();
      return;
    }
  }
  openCompactPopup({ mode: 'progress', downloadId });
}

function extractLaunchSource(argv: string[]): string | undefined {
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('-')) continue;
    if (isHttpUrl(arg) || isMagnetUri(arg) || isTorrentFilePath(arg)) {
      return arg;
    }
  }
  return undefined;
}

async function performQuit(): Promise<void> {
  if (isQuitting) return;
  isQuitting = true;
  if (startupUpdateTimer) {
    clearTimeout(startupUpdateTimer);
    startupUpdateTimer = null;
  }
  if (!shutdownPromise && manager) {
    shutdownPromise = manager.shutdown();
  }
  await shutdownPromise;
  tray?.destroy();
  tray = null;
  app.quit();
}

function createMainWindow(): BrowserWindow {
  const iconPath = resolveAppAsset('build/icon.png');
  const preloadPath = path.join(__dirname, '../preload/index.cjs');

  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 940,
    minHeight: 600,
    frame: false,
    show: false,
    backgroundColor: '#121215',
    icon: iconPath,
    title: 'MyLoad Download Manager',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  hardenWindowWebContents(win);

  const isSmokeTest = process.env.MYLOAD_SMOKE_TEST === '1';
  const rendererConsoleErrors: string[] = [];
  if (isSmokeTest) {
    win.webContents.on('console-message', (details) => {
      if (details.level === 'error') {
        rendererConsoleErrors.push(details.message);
      }
    });
    win.webContents.once('did-finish-load', async () => {
      try {
        const wt = await import('webtorrent');
        if (typeof wt.default !== 'function') {
          throw new Error('webtorrent default export missing');
        }
        const wtClient = new wt.default({
          dht: false,
          lsd: false,
          tracker: false,
        });
        if (typeof wtClient.add !== 'function') {
          throw new Error('webtorrent client add method missing');
        }
        await new Promise<void>((resolve) => wtClient.destroy(() => resolve()));
        const result = await win.webContents.executeJavaScript(`
          (async () => {
            if (!window.myload || typeof window.myload.getInitialState !== 'function') {
              return { ok: false, reason: 'window.myload missing' };
            }
            const snap = await window.myload.getInitialState();
            const heading = document.querySelector('h1')?.textContent?.trim() || '';
            return {
              ok: Boolean(snap && snap.settings && heading === 'MyLoad Download Manager'),
              heading,
            };
          })()
        `);
        if (!result?.ok || rendererConsoleErrors.length > 0) {
          console.error('MYLOAD_SMOKE_FAILED', { result, rendererConsoleErrors });
          await performQuit();
          process.exit(1);
        }
        console.log('MYLOAD_SMOKE_OK');
        await performQuit();
        process.exit(0);
      } catch (err) {
        console.error('MYLOAD_SMOKE_ERROR', err);
        await performQuit();
        process.exit(1);
      }
    });
  }

  win.once('ready-to-show', () => {
    if (!isSmokeTest) {
      if (isBackgroundLaunch && manager?.getSettings().minimizeToTray) {
      } else if (isBackgroundLaunch) {
        if (!process.argv.includes('--background-launch')) {
          win.showInactive();
          win.minimize();
        }
      } else {
        win.show();
      }
    }
    const initialSource = extractLaunchSource(process.argv);
    if (initialSource) {
      sendToRenderer('myload:open-add-modal', initialSource);
    }
  });

  win.on('maximize', () => sendToRenderer('myload:win-maximized', true));
  win.on('unmaximize', () => sendToRenderer('myload:win-maximized', false));
  win.on('show', () => {
    if (!manager) return;
    const snap = manager.getSnapshot();
    sendToRenderer('myload:downloads-updated', snap.downloads);
    sendToRenderer('myload:stats-updated', snap.stats);
  });

  win.on('close', (event) => {
    if (!isQuitting && manager?.getSettings().minimizeToTray) {
      event.preventDefault();
      win.hide();
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  return win;
}

app.on('second-instance', (_event, argv) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    const source = extractLaunchSource(argv);
    if (source) {
      sendToRenderer('myload:open-add-modal', source);
    }
  }
});

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });

  if (!process.env.VITE_DEV_SERVER_URL) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
          ],
        },
      });
    });
  }

  const userDataDir = app.getPath('userData');
  const defaultDownloadsDir = app.getPath('downloads');
  let lastStartupEnabled: boolean | null = null;

  manager = new DownloadManager({
    stateFilePath: path.join(userDataDir, 'state.json'),
    logFilePath: path.join(userDataDir, 'logs', 'myload.log'),
    defaultDownloadDir: defaultDownloadsDir,
    appVersion: app.getVersion(),
    powerAdapter: createElectronPowerAdapter(powerSaveBlocker, () => {
      void performQuit();
    }),
    callbacks: {
      onDownloadsUpdated: (downloads) => sendToRenderer('myload:downloads-updated', downloads),
      onStatsUpdated: (stats) => {
        sendToRenderer('myload:stats-updated', stats);
        tray?.updateStats(stats);
      },
      onSettingsUpdated: (settings) => {
        if (lastStartupEnabled !== null && settings.startOnStartup !== lastStartupEnabled) {
          lastStartupEnabled = settings.startOnStartup;
          syncStartupLoginItem(settings.startOnStartup);
        }
        sendToRenderer('myload:settings-updated', settings);
      },
      onLogAppended: (entry) => sendToRenderer('myload:log-appended', entry),
      onLogsCleared: () => sendToRenderer('myload:logs-cleared'),
      onDownloadCompleted: (item) => sendToRenderer('myload:download-completed', item),
      onPowerCountdown: (state) => sendToRenderer('myload:power-countdown', state),
      onBrowserIntercept: (payload) => {
        focusMainWindow();
        sendToRenderer('myload:browser-intercept', payload);
      },
      onOpenCompactPopup: (data) => {
        openCompactPopup(data);
      },
      onFocusRequested: () => {
        focusMainWindow();
      },
      onTaskbarProgress: (progress, mode) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (progress < 0 || mode === 'none') {
            mainWindow.setProgressBar(-1);
          } else if (mode === 'indeterminate') {
            mainWindow.setProgressBar(2, { mode: 'indeterminate' });
          } else {
            mainWindow.setProgressBar(Math.max(0, Math.min(1, progress)), { mode: 'normal' });
          }
        }
      },
      readClipboard: () => clipboard.readText(),
      showNotification: (title, body) => {
        if (Notification.isSupported()) {
          new Notification({
            title,
            body,
            icon: resolveAppAsset('build/icon.png'),
          }).show();
        }
      },
      onExtensionOriginSeen: (extId) => {
        if (app.isPackaged && process.env.MYLOAD_SMOKE_TEST !== '1') {
          void ensureNativeMessagingHostRegistered({
            executablePath: process.execPath,
            launchExecutablePath: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath,
            hostScriptPath: path.join(process.resourcesPath, 'native-host.cjs'),
            userDataDir: app.getPath('userData'),
            extraExtensionIds: [extId],
          });
        }
      },
    },
  });

  const updater = new UpdateService({
    currentVersion: app.getVersion(),
    downloadDir: path.join(app.getPath('temp'), 'MyLoad-Updates'),
    onStatusChanged: (st) => sendToRenderer('myload:update-status', st),
    onLaunchInstaller: async (filePath) => {
      const openErr = await shell.openPath(filePath);
      if (openErr) {
        throw new Error(`Unable to launch update installer: ${openErr}`);
      }
      setTimeout(() => {
        void performQuit();
      }, 250);
    },
  });

  registerIpcHandlers({
    manager,
    updater,
    getWindow: () => mainWindow,
    getExtensionDir: resolveExtensionDir,
    getPopupSession: (sessionId) => popupWindows.get(sessionId)?.data ?? null,
    onOpenDownloadPopup: (downloadId) => openDownloadProgressPopup(downloadId),
    onOpenMainWindow: () => focusMainWindow(),
    onRequestQuit: () => {
      void performQuit();
    },
  });

  mainWindow = createMainWindow();
  tray = createAppTray({
    iconPath: resolveAppAsset('build/tray-icon.png'),
    getWindow: () => mainWindow,
    manager,
    onAddDownload: () => sendToRenderer('myload:open-add-modal'),
    onQuit: () => {
      void performQuit();
    },
  });

  manager.start();
  lastStartupEnabled = manager.getSettings().startOnStartup;
  syncStartupLoginItem(lastStartupEnabled);

  if (process.env.MYLOAD_SMOKE_TEST !== '1') {
    if (app.isPackaged) {
      void ensureNativeMessagingHostRegistered({
        executablePath: process.execPath,
        launchExecutablePath: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath,
        hostScriptPath: path.join(process.resourcesPath, 'native-host.cjs'),
        userDataDir: app.getPath('userData'),
      });
    }
    void updater.cleanupDownloadedInstallers();
    if (manager.getSettings().autoCheckUpdates) {
      startupUpdateTimer = setTimeout(() => {
        startupUpdateTimer = null;
        void updater.checkForUpdates();
      }, 2000);
    }
  }
});

app.on('before-quit', (event) => {
  if (!isQuitting) {
    event.preventDefault();
    void performQuit();
  }
});

app.on('window-all-closed', () => {
  if (!manager?.getSettings().minimizeToTray && process.platform !== 'darwin') {
    void performQuit();
  }
});

