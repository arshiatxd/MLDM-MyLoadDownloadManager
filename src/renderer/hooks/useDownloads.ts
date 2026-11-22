import { useEffect, useRef, useState } from 'react';
import { INITIAL_NETWORK_BALANCE, createDefaultSettings } from '../../shared/constants';
import type {
  AppSettings,
  BrowserInterceptPayload,
  DownloadItem,
  GlobalStats,
  LogEntry,
  ShutdownCountdownState,
  UpdateStatus,
} from '../../shared/types';

const INITIAL_STATS: GlobalStats = {
  totalDownloadSpeed: 0,
  totalUploadSpeed: 0,
  activeCount: 0,
  queuedCount: 0,
  completedCount: 0,
  preventSleepActive: false,
  taskbarProgress: -1,
  networkBalance: INITIAL_NETWORK_BALANCE,
};

export function useDownloadsState(handlers: {
  onDownloadCompleted?: (item: DownloadItem) => void;
  onBrowserIntercept?: (payload: BrowserInterceptPayload) => void;
  onOpenAddModal?: (source?: string) => void;
}) {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [settings, setSettings] = useState<AppSettings>(() => createDefaultSettings(''));
  const [stats, setStats] = useState<GlobalStats>(INITIAL_STATS);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [countdown, setCountdown] = useState<ShutdownCountdownState | null>(null);
  const [appVersion, setAppVersion] = useState('1.0.0');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    state: 'idle',
    currentVersion: '1.0.0',
  });
  const [ready, setReady] = useState(false);

  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    let mounted = true;

    void window.myload.getInitialState().then((snapshot) => {
      if (!mounted) return;
      const ver = snapshot.appVersion || '1.0.0';
      setAppVersion(ver);
      setUpdateStatus((prev) => ({ ...prev, currentVersion: ver }));
      setDownloads(snapshot.downloads);
      setSettings(snapshot.settings);
      setStats(snapshot.stats);
      setLogs(snapshot.logs);
      setCountdown(snapshot.countdown);
      setReady(true);
    });

    void window.myload.getUpdateStatus().then((st) => {
      if (mounted) setUpdateStatus(st);
    });

    const unsubs = [
      window.myload.onDownloadsUpdated((items) => setDownloads(items)),
      window.myload.onStatsUpdated((nextStats) => setStats(nextStats)),
      window.myload.onSettingsUpdated((nextSettings) => setSettings(nextSettings)),
      window.myload.onLogAppended((entry) => {
        setLogs((prev) => {
          const next = [...prev, entry];
          return next.length > 2000 ? next.slice(next.length - 2000) : next;
        });
      }),
      window.myload.onLogsCleared(() => setLogs([])),
      window.myload.onPowerCountdown((state) => setCountdown(state)),
      window.myload.onUpdateStatus((st) => setUpdateStatus(st)),
      window.myload.onDownloadCompleted((item) => {
        handlersRef.current.onDownloadCompleted?.(item);
      }),
      window.myload.onBrowserIntercept((payload) => {
        handlersRef.current.onBrowserIntercept?.(payload);
      }),
      window.myload.onOpenAddModal((source) => {
        handlersRef.current.onOpenAddModal?.(source);
      }),
    ];

    return () => {
      mounted = false;
      for (const unsub of unsubs) unsub();
    };
  }, []);

  return {
    ready,
    appVersion,
    updateStatus,
    downloads,
    settings,
    stats,
    logs,
    countdown,
  };
}

