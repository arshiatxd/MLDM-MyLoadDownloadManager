import crypto from 'node:crypto';
import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import {
  BrowserWindow,
  Notification,
  app,
  clipboard,
  net,
  powerSaveBlocker,
  session,
  shell,
} from 'electron';
import { isHttpUrl, isMagnetUri, isTorrentFilePath } from '../shared/constants';
import type { PopupSessionData } from '../shared/types';
import { DownloadManager } from './download-manager';
import type { ElectronNetAdapter, HttpProbeResponse, HttpStreamResponse } from './http-engine';
import { registerIpcHandlers } from './ipc';
import { ensureNativeMessagingHostRegistered } from './native-host';
import { createElectronPowerAdapter } from './power';
import { stripUnsafeRedirectHeaders, validateHttpOrHttpsUrl } from './security';
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
const isProtocolBackground = process.argv.some((a) => /^myload:\/\/background/i.test(a));
const isBackgroundLaunch =
  isStartupLaunch ||
  process.argv.includes('--background-launch') ||
  isProtocolBackground;

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

function resolveBundledExtensionDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'extension');
  }
  return path.join(app.getAppPath(), 'extension');
}

function readManifestVersion(dir: string): string | null {
  try {
    const raw = fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

function resolveExtensionDir(): string {
  const bundled = resolveBundledExtensionDir();
  const stable = path.join(app.getPath('userData'), 'browser-extension');
  try {
    const bundledVersion = readManifestVersion(bundled);
    if (!bundledVersion) return fs.existsSync(stable) ? stable : bundled;
    if (readManifestVersion(stable) !== bundledVersion) {
      fs.mkdirSync(stable, { recursive: true });
      fs.cpSync(bundled, stable, { recursive: true, force: true });
    }
    return stable;
  } catch {
    return bundled;
  }
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
    if (arg.startsWith('-') || /^myload:\/\//i.test(arg)) continue;
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
        if (!process.argv.includes('--background-launch') && !isProtocolBackground) {
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
  if (argv.some((a) => /^myload:\/\/background/i.test(a))) {
    return;
  }
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

function createElectronNetAdapter(): ElectronNetAdapter {
  const openRaw = (
    urlStr: string,
    method: 'GET' | 'HEAD',
    headers: Record<string, string>,
    redirects = 0,
    signal?: AbortSignal
  ): Promise<{
    req: Electron.ClientRequest;
    res: Electron.IncomingMessage;
    finalUrl: string;
  }> =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        const aborted = new Error('Aborted');
        aborted.name = 'AbortError';
        reject(aborted);
        return;
      }
      const req = net.request({ url: urlStr, method, redirect: 'manual' });
      for (const [k, v] of Object.entries(headers)) {
        if (!v) continue;
        try {
          req.setHeader(k, v);
        } catch {
        }
      }
      const onPreAbort = () => {
        clearTimeout(timer);
        try {
          req.abort();
        } catch {
        }
        const aborted = new Error('Aborted');
        aborted.name = 'AbortError';
        reject(aborted);
      };
      signal?.addEventListener('abort', onPreAbort, { once: true });

      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onPreAbort);
        try {
          req.abort();
        } catch {
        }
        reject(new Error('Request timed out'));
      }, 20000);

      req.on('response', (res) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onPreAbort);
        const statusCode = res.statusCode ?? 0;
        const locHeader = res.headers.location;
        const location = Array.isArray(locHeader) ? locHeader[0] : locHeader;
        if (
          location &&
          [301, 302, 303, 307, 308].includes(statusCode) &&
          redirects < 10
        ) {
          try {
            req.abort();
          } catch {
          }
          let nextUrl: string;
          try {
            nextUrl = validateHttpOrHttpsUrl(new URL(location, urlStr).toString()).toString();
          } catch (err) {
            reject(err);
            return;
          }
          const nextHeaders = stripUnsafeRedirectHeaders(headers, urlStr, nextUrl);
          openRaw(nextUrl, method, nextHeaders, redirects + 1, signal)
            .then(resolve)
            .catch(reject);
          return;
        }
        resolve({ req, res, finalUrl: urlStr });
      });

      req.on('error', (err) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onPreAbort);
        reject(err instanceof Error ? err : new Error(String(err)));
      });

      req.end();
    });

  return {
    probe: async (url, headers): Promise<HttpProbeResponse> => {
      const rangeHeaders = { ...headers, Range: 'bytes=0-0' };
      const attempt = await openRaw(url, 'GET', rangeHeaders);
      const status = attempt.res.statusCode ?? 0;
      const hdrs = attempt.res.headers as http.IncomingHttpHeaders;
      try {
        attempt.req.abort();
      } catch {
      }
      if (status === 403 || status === 416) {
        const plainHeaders = { ...headers };
        delete plainHeaders.Range;
        const plain = await openRaw(url, 'GET', plainHeaders);
        const plainStatus = plain.res.statusCode ?? 0;
        const plainHdrs = plain.res.headers as http.IncomingHttpHeaders;
        try {
          plain.req.abort();
        } catch {
        }
        return { finalUrl: plain.finalUrl, statusCode: plainStatus, headers: plainHdrs };
      }
      return { finalUrl: attempt.finalUrl, statusCode: status, headers: hdrs };
    },

    openStream: async (url, headers, signal): Promise<HttpStreamResponse> => {
      if (signal.aborted) {
        const aborted = new Error('Aborted');
        aborted.name = 'AbortError';
        throw aborted;
      }
      const { req, res } = await openRaw(url, 'GET', headers, 0, signal);
      const pass = new PassThrough({ highWaterMark: 256 * 1024 });
      let destroyed = false;
      const cleanup = () => {
        if (destroyed) return;
        destroyed = true;
        signal.removeEventListener('abort', onSignalAbort);
        try {
          req.abort();
        } catch {
        }
        pass.destroy();
      };
      const onSignalAbort = () => cleanup();
      signal.addEventListener('abort', onSignalAbort, { once: true });
      const flowRes = res as unknown as { pause?: () => void; resume?: () => void };
      const onDrain = () => {
        if (!destroyed) {
          try {
            flowRes.resume?.();
          } catch {
          }
        }
      };
      pass.on('drain', onDrain);
      res.on('data', (chunk) => {
        if (destroyed) return;
        if (!pass.write(chunk)) {
          try {
            flowRes.pause?.();
          } catch {
          }
        }
      });
      res.on('end', () => {
        signal.removeEventListener('abort', onSignalAbort);
        pass.removeListener('drain', onDrain);
        pass.end();
      });
      res.on('aborted', () => {
        signal.removeEventListener('abort', onSignalAbort);
        pass.removeListener('drain', onDrain);
        pass.destroy();
      });
      res.on('error', (err) => {
        signal.removeEventListener('abort', onSignalAbort);
        pass.removeListener('drain', onDrain);
        pass.destroy(err instanceof Error ? err : new Error(String(err)));
      });
      return {
        statusCode: res.statusCode ?? 0,
        headers: res.headers as http.IncomingHttpHeaders,
        stream: pass,
        destroy: cleanup,
      };
    },

    fetchBuffer: async (url, headers, maxBytes) => {
      const { req, res, finalUrl } = await openRaw(url, 'GET', headers);
      const status = res.statusCode ?? 0;
      const hdrs = res.headers as http.IncomingHttpHeaders;
      if (status >= 400) {
        try {
          req.abort();
        } catch {
        }
        throw new Error(`HTTP ${status}`);
      }
      const buf = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let total = 0;
        let done = false;
        res.on('data', (chunk) => {
          if (done) return;
          const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += b.length;
          if (total > maxBytes) {
            done = true;
            try {
              req.abort();
            } catch {
            }
            reject(new Error('Remote file exceeds maximum allowed size'));
            return;
          }
          chunks.push(b);
        });
        res.on('end', () => {
          if (done) return;
          done = true;
          resolve(Buffer.concat(chunks, total));
        });
        res.on('error', (err) => {
          if (done) return;
          done = true;
          reject(err instanceof Error ? err : new Error(String(err)));
        });
      });
      return { buffer: buf, finalUrl, headers: hdrs };
    },
  };
}

  manager = new DownloadManager({
    stateFilePath: path.join(userDataDir, 'state.json'),
    logFilePath: path.join(userDataDir, 'logs', 'myload.log'),
    defaultDownloadDir: defaultDownloadsDir,
    appVersion: app.getVersion(),
    electronNet: createElectronNetAdapter(),
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

