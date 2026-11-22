import { Menu, Tray, nativeImage, type BrowserWindow } from 'electron';
import { formatSpeed } from '../shared/constants';
import type { GlobalStats } from '../shared/types';
import type { DownloadManager } from './download-manager';

export interface AppTrayController {
  updateStats: (stats: GlobalStats) => void;
  destroy: () => void;
}

export function createAppTray(params: {
  iconPath: string;
  getWindow: () => BrowserWindow | null;
  manager: DownloadManager;
  onAddDownload: () => void;
  onQuit: () => void;
}): AppTrayController {
  const { iconPath, getWindow, manager, onAddDownload, onQuit } = params;
  const img = nativeImage.createFromPath(iconPath);
  const tray = new Tray(img);
  tray.setToolTip('MyLoad — Download Manager');

  const showWindow = () => {
    const win = getWindow();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  };

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show MyLoad',
      click: showWindow,
    },
    {
      label: 'Add Download...',
      click: () => {
        showWindow();
        onAddDownload();
      },
    },
    { type: 'separator' },
    {
      label: 'Pause All',
      click: () => {
        void manager.pauseAll();
      },
    },
    {
      label: 'Resume All',
      click: () => {
        void manager.resumeAll();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit MyLoad',
      click: onQuit,
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);

  return {
    updateStats: (stats: GlobalStats) => {
      if (tray.isDestroyed()) return;
      if (stats.activeCount > 0) {
        tray.setToolTip(
          `MyLoad — ↓ ${formatSpeed(stats.totalDownloadSpeed)} · ${stats.activeCount} active`
        );
      } else {
        tray.setToolTip('MyLoad — Idle');
      }
    },
    destroy: () => {
      if (!tray.isDestroyed()) {
        tray.destroy();
      }
    },
  };
}

