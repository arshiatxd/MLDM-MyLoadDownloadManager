import { classifyFileName } from './categories';
import type {
  AppSettings,
  CategoryDownloadDirs,
  CategoryId,
  CustomThemeColors,
  DownloadKind,
  DownloadSchedule,
  FileCategory,
  NetworkBalanceStats,
  PowerAction,
  SocialDownloadRequest,
  SpeedUnit,
} from './types';

export const FILE_CATEGORIES: FileCategory[] = [
  'videos',
  'images',
  'docs',
  'archives',
  'torrents',
  'other',
];

export const FILE_CATEGORY_META: Record<FileCategory, { label: string; extensionsHint: string }> = {
  videos: { label: 'Videos', extensionsHint: 'mp4, mkv, avi, mov, webm...' },
  images: { label: 'Images', extensionsHint: 'jpg, png, gif, webp, svg...' },
  docs: { label: 'Documents', extensionsHint: 'pdf, docx, xlsx, txt, epub...' },
  archives: { label: 'Archives', extensionsHint: 'zip, rar, 7z, tar, iso, .001...' },
  torrents: { label: 'Torrents', extensionsHint: 'magnet links & .torrent files' },
  other: { label: 'Other Files', extensionsHint: 'exe, msi, mp3, bin, misc...' },
};

export function createDefaultCategoryDirs(): CategoryDownloadDirs {
  return {
    videos: '',
    images: '',
    docs: '',
    archives: '',
    torrents: '',
    other: '',
  };
}

export const DEFAULT_BRIDGE_PORT = 49173;

export const DEFAULT_DARK_CUSTOM_COLORS: CustomThemeColors = {
  bgCanvas: '#121215',
  bgSurface: '#1a1a1f',
  bgElevated: '#23232a',
  accent: '#c81e3d',
  textPrimary: '#f5f5f9',
  textSecondary: '#b4b4c2',
  borderSubtle: '#2e2e38',
};

export const DEFAULT_LIGHT_CUSTOM_COLORS: CustomThemeColors = {
  bgCanvas: '#f4f4f7',
  bgSurface: '#ffffff',
  bgElevated: '#ececf1',
  accent: '#a91532',
  textPrimary: '#17171c',
  textSecondary: '#4b4b58',
  borderSubtle: '#d6d6e0',
};

export const INITIAL_NETWORK_BALANCE: NetworkBalanceStats = {
  enabled: false,
  active: false,
  rttMs: null,
  baselineRttMs: null,
  jitterMs: null,
  effectiveDownloadLimit: null,
  effectiveUploadLimit: null,
  state: 'idle',
};

export const DEFAULT_FILTER_TAB_ORDER: CategoryId[] = [
  'all',
  'active',
  'completed',
  'torrents',
  'images',
  'docs',
  'archives',
  'videos',
  'other',
];

export const CATEGORY_LABELS: Record<CategoryId, string> = {
  all: 'All',
  active: 'Active',
  completed: 'Completed',
  torrents: 'Torrents',
  images: 'Images',
  docs: 'Docs',
  archives: 'Archives',
  videos: 'Videos',
  other: 'Other',
};

export const POWER_ACTION_LABELS: Record<PowerAction, string> = {
  off: 'Off',
  shutdown: 'Shut down PC',
  sleep: 'Sleep PC',
  hibernate: 'Hibernate PC',
  exit: 'Exit MyLoad',
};

export function createDefaultSettings(defaultDownloadDir: string): AppSettings {
  return {
    defaultDownloadDir,
    alwaysUseDefaultDir: false,
    folderRoutingMode: 'single',
    categoryDownloadDirs: createDefaultCategoryDirs(),
    showConfirmationDialog: true,
    recentDirs: defaultDownloadDir ? [defaultDownloadDir] : [],

    downloadSpeedLimitEnabled: false,
    downloadSpeedLimitValue: 2,
    downloadSpeedLimitUnit: 'MB/s',
    uploadSpeedLimitEnabled: false,
    uploadSpeedLimitValue: 512,
    uploadSpeedLimitUnit: 'KB/s',

    maxConcurrentDownloads: 3,
    httpConnections: 16,
    maxRetries: 3,
    duplicatePolicy: 'auto-rename',

    preventSleepDuringDownload: true,
    autoPowerAction: 'off',

    keepSeedingAfterComplete: false,
    torrentAnonymousMode: false,
    torrentSequentialDownload: false,
    minimizeToTray: true,
    autoResumeOnStart: true,
    desktopNotifications: true,
    completionSound: true,
    watchClipboard: true,
    browserBridgeEnabled: true,
    browserBridgePort: DEFAULT_BRIDGE_PORT,

    theme: 'dark',
    fontScale: 'default',
    reducedMotion: false,
    filterTabOrder: [...DEFAULT_FILTER_TAB_ORDER],
    customThemes: [],
    activeCustomThemeId: null,
    gamingModeEnabled: false,
    gamingModeProfile: 'surfing',
    useCompactDownloadPopup: true,
    autoDownloadOnClick: false,
    showScheduleInPopup: true,
    queueMode: 'parallel',
    detectMultiPartEnabled: true,
    multiPartDontAskAgain: false,
    multiPartDefaultAction: 'single',
    startOnStartup: true,
    autoCheckUpdates: true,
    hideUpdatePrompt: false,
    language: 'en',
  };
}

export function normalizeHexColor(input: string, fallback = '#c81e3d'): string {
  const trimmed = input.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const r = trimmed[1];
    const g = trimmed[2];
    const b = trimmed[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return fallback;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const norm = normalizeHexColor(hex, '#000000');
  return {
    r: parseInt(norm.slice(1, 3), 16),
    g: parseInt(norm.slice(3, 5), 16),
    b: parseInt(norm.slice(5, 7), 16),
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clampByte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (
    '#' +
    [clampByte(r), clampByte(g), clampByte(b)]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  );
}

export function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(1, s));
  const val = Math.max(0, Math.min(1, v));
  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (hue < 60) {
    rp = c;
    gp = x;
  } else if (hue < 120) {
    rp = x;
    gp = c;
  } else if (hue < 180) {
    gp = c;
    bp = x;
  } else if (hue < 240) {
    gp = x;
    bp = c;
  } else if (hue < 300) {
    rp = x;
    bp = c;
  } else {
    rp = c;
    bp = x;
  }
  return {
    r: Math.round((rp + m) * 255),
    g: Math.round((gp + m) * 255),
    b: Math.round((bp + m) * 255),
  };
}

export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function adjustChannel(c: number, amount: number): number {
  return Math.max(0, Math.min(255, Math.round(c + amount)));
}

export function deriveAccentTokens(accentHex: string, surfaceHex: string): {
  hover: string;
  active: string;
  soft: string;
  text: string;
  contrast: string;
  hoverBg: string;
} {
  const { r, g, b } = hexToRgb(accentHex);
  const surf = hexToRgb(surfaceHex);
  const surfaceLuma = (0.299 * surf.r + 0.587 * surf.g + 0.114 * surf.b) / 255;
  const accentLuma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  const hover = rgbToHex(adjustChannel(r, 18), adjustChannel(g, 18), adjustChannel(b, 18));
  const active = rgbToHex(adjustChannel(r, -24), adjustChannel(g, -24), adjustChannel(b, -24));
  const soft = `rgba(${r}, ${g}, ${b}, ${surfaceLuma < 0.45 ? 0.22 : 0.14})`;
  const text =
    surfaceLuma < 0.45 && accentLuma < 0.48
      ? rgbToHex(adjustChannel(r, 55), adjustChannel(g, 70), adjustChannel(b, 70))
      : surfaceLuma >= 0.45 && accentLuma > 0.7
        ? rgbToHex(adjustChannel(r, -55), adjustChannel(g, -55), adjustChannel(b, -55))
        : normalizeHexColor(accentHex);
  const contrast = accentLuma > 0.62 ? '#121215' : '#ffffff';
  const hoverBg =
    surfaceLuma < 0.45
      ? rgbToHex(adjustChannel(surf.r, 16), adjustChannel(surf.g, 16), adjustChannel(surf.b, 18))
      : rgbToHex(adjustChannel(surf.r, -16), adjustChannel(surf.g, -16), adjustChannel(surf.b, -18));

  return { hover, active, soft, text, contrast, hoverBg };
}

export function speedToBytesPerSec(
  enabled: boolean,
  value: number,
  unit: SpeedUnit
): number | null {
  if (!enabled) return null;
  if (!Number.isFinite(value) || value <= 0) return null;
  const multiplier = unit === 'MB/s' ? 1024 * 1024 : 1024;
  return Math.max(1024, Math.round(value * multiplier));
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return 'Unknown';
  }
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exp);
  const decimals = exp === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[exp]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '0 B/s';
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 1) return '< 1s';
  const s = Math.floor(seconds);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export function formatDateShort(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return '—';
  const d = new Date(timestamp);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const WINDOWS_RESERVED_NAME_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const ILLEGAL_FILENAME_CHARS_RE = /[<>:"/\\|?*\x00-\x1f]/g;
const MAX_FILENAME_LENGTH = 180;

export function hasUnsafeFileNameWarning(rawName: string): string | null {
  const trimmed = rawName.trim();
  if (!trimmed) return null;
  if (trimmed === '.' || trimmed === '..') {
    return 'File name cannot be "." or ".." and will be replaced automatically.';
  }
  if (/[<>:"/\\|?*\x00-\x1f]/.test(trimmed)) {
    return 'Special characters (< > : " / \\ | ? *) are not allowed in file names and will be replaced with "_".';
  }
  const dotIdx = trimmed.lastIndexOf('.');
  const stem = dotIdx > 0 ? trimmed.slice(0, dotIdx) : trimmed;
  if (WINDOWS_RESERVED_NAME_RE.test(stem.trim())) {
    return `"${stem}" is a reserved Windows device name and will be prefixed with "_".`;
  }
  if (trimmed.length > MAX_FILENAME_LENGTH) {
    return `File name exceeds ${MAX_FILENAME_LENGTH} characters and will be shortened to fit Windows limits.`;
  }
  return null;
}

export function sanitizeFileName(rawName: string): string {
  let cleaned = rawName
    .replace(ILLEGAL_FILENAME_CHARS_RE, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');

  if (!cleaned || cleaned === '.' || cleaned === '..') {
    return 'download';
  }

  const lastDot = cleaned.lastIndexOf('.');
  let stem = lastDot > 0 ? cleaned.slice(0, lastDot).trim() : cleaned;
  const ext = lastDot > 0 ? cleaned.slice(lastDot) : '';

  if (WINDOWS_RESERVED_NAME_RE.test(stem)) {
    stem = `_${stem}`;
  }

  cleaned = `${stem}${ext}`;
  if (cleaned.length > MAX_FILENAME_LENGTH) {
    const safeExt = ext.length > 0 && ext.length <= 24 ? ext : '';
    const keepLen = Math.max(1, MAX_FILENAME_LENGTH - safeExt.length);
    const trimmedStem = stem.slice(0, keepLen).replace(/[.\s]+$/g, '') || 'download';
    cleaned = `${trimmedStem}${safeExt}`;
  }

  return cleaned || 'download';
}

export function isMagnetUri(input: string): boolean {
  return /^magnet:\?xt=urn:btih:[a-zA-Z0-9]{32,40}/i.test(input.trim());
}

export function isHttpUrl(input: string): boolean {
  try {
    const u = new URL(input.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isTorrentFilePath(input: string): boolean {
  const trimmed = input.trim();
  return !isHttpUrl(trimmed) && !isMagnetUri(trimmed) && /\.torrent$/i.test(trimmed);
}

export function extractMultipleSources(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  const valid: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if ((isHttpUrl(line) || isMagnetUri(line) || isTorrentFilePath(line)) && !seen.has(line)) {
      seen.add(line);
      valid.push(line);
    }
  }
  return valid;
}

const DOWNLOAD_QUERY_RE =
  /(?:^|[?&])(download|filename|response-content-disposition|attachment|dl=1|export=download|file|x-amz-signature|signature|sig|token)=/i;
const DOWNLOAD_PATH_RE =
  /\/(download|downloads|dl|files|file|release-assets|releases\/download|attachments|export|getfile|media|cdn|archive|raw)(\/|$)/i;
const DOWNLOAD_HOST_RE = /^(dl|download|downloads|release-assets)\./i;
const WEBPAGE_EXT_RE = /\.(html?|xhtml|php|aspx?|jsp|cfm)$/i;
const DOWNLOAD_FILE_EXT_RE =
  /\.(zip|rar|7z|tar|gz|tgz|bz2|xz|zst|cab|iso|img|dmg|exe|msi|msix|appx|apk|deb|rpm|pkg|appimage|bin|run|mp4|mkv|avi|mov|wmv|flv|webm|m4v|mp3|flac|wav|ogg|aac|m4a|opus|png|jpe?g|gif|webp|bmp|svg|ico|tiff?|psd|raw|avif|pdf|docx?|xlsx?|pptx?|csv|epub|mobi|txt|json|xml|sql|db|sqlite|torrent|srt|vtt|ttf|otf|woff2?|obj|fbx|glb|blend|r\d{2}|\d{3}|part\d+)$/i;

export function isLikelyDownloadableUrl(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed || trimmed.includes('\n') || trimmed.includes('\r')) return false;
  if (isMagnetUri(trimmed) || isTorrentFilePath(trimmed)) return true;
  if (!isHttpUrl(trimmed)) return false;

  try {
    const u = new URL(trimmed);
    const pathname = u.pathname.toLowerCase();
    const search = u.search.toLowerCase();
    if (DOWNLOAD_FILE_EXT_RE.test(pathname)) return true;
    if (WEBPAGE_EXT_RE.test(pathname)) return DOWNLOAD_QUERY_RE.test(search);
    return (
      DOWNLOAD_PATH_RE.test(pathname) ||
      DOWNLOAD_QUERY_RE.test(search) ||
      (pathname.length > 1 && DOWNLOAD_HOST_RE.test(u.hostname))
    );
  } catch {
    return false;
  }
}

export function extractDownloadableSources(raw: string): string[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  const valid: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (isLikelyDownloadableUrl(line) && !seen.has(line)) {
      seen.add(line);
      valid.push(line);
    }
  }
  return valid;
}

export function deriveNameFromSource(source: string, kind?: DownloadKind): string {
  const trimmed = source.trim();
  if (!trimmed) return kind === 'torrent' ? 'torrent' : 'download';

  if (kind === 'torrent' || isMagnetUri(trimmed) || isTorrentFilePath(trimmed)) {
    if (isMagnetUri(trimmed)) {
      try {
        const u = new URL(trimmed);
        const dn = u.searchParams.get('dn');
        if (dn) return sanitizeFileName(dn);
      } catch {
      }
      return 'torrent';
    }
    const base = trimmed.split(/[\\/]/).pop();
    return base ? sanitizeFileName(base) : 'torrent';
  }

  if (isHttpUrl(trimmed)) {
    try {
      const u = new URL(trimmed);
      const segments = u.pathname.split('/').filter(Boolean);
      const last = segments[segments.length - 1];
      if (last) {
        return sanitizeFileName(decodeURIComponent(last));
      }
    } catch {
    }
  }

  return 'download';
}

export function resolveSaveDirForCategory(
  settings: Pick<AppSettings, 'defaultDownloadDir' | 'folderRoutingMode' | 'categoryDownloadDirs'>,
  category: FileCategory
): string {
  if (settings.folderRoutingMode === 'per-category') {
    const custom = settings.categoryDownloadDirs?.[category]?.trim();
    if (custom) return custom;
  }
  return settings.defaultDownloadDir;
}

export function resolveSaveDirForFile(
  settings: Pick<AppSettings, 'defaultDownloadDir' | 'folderRoutingMode' | 'categoryDownloadDirs'>,
  fileName: string,
  kind?: DownloadKind
): string {
  return resolveSaveDirForCategory(settings, classifyFileName(fileName, kind));
}

export function formatSocialRequestSummary(req: SocialDownloadRequest): string {
  const names: Record<SocialDownloadRequest['platform'], string> = {
    youtube: 'YouTube',
    instagram: 'Instagram',
    tiktok: 'TikTok',
    spotify: 'Spotify',
    custom: 'Custom URL',
  };
  const parts: string[] = [names[req.platform] || req.platform];
  if (req.format) {
    parts.push(req.format.toUpperCase());
  }
  if (req.quality && req.quality !== 'best') {
    parts.push(req.quality);
  }
  if (req.platform === 'spotify' && req.items.length > 1) {
    parts.push(req.bundleMode === 'zip' ? 'ZIP archive' : 'Individual files');
  }
  if (req.items.length > 1) {
    parts.push(`${req.items.length} items`);
  }
  return parts.join(' · ');
}

export function normalizeDownloadSchedule(
  schedule?: DownloadSchedule | null
): DownloadSchedule | undefined {
  if (!schedule || typeof schedule !== 'object') return undefined;
  const startAt =
    typeof schedule.startAt === 'number' &&
    Number.isFinite(schedule.startAt) &&
    schedule.startAt > 0
      ? Math.round(schedule.startAt)
      : null;
  const stopAt =
    typeof schedule.stopAt === 'number' &&
    Number.isFinite(schedule.stopAt) &&
    schedule.stopAt > 0
      ? Math.round(schedule.stopAt)
      : null;
  if (!startAt && !stopAt) return undefined;
  return {
    ...(startAt ? { startAt } : {}),
    ...(stopAt ? { stopAt } : {}),
  };
}

export function resolveScheduledTimestamp(
  timeHHMM: string,
  referenceNow = Date.now(),
  minAfterMs?: number
): number | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec((timeHHMM || '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const floor = Math.max(referenceNow, minAfterMs ?? referenceNow);
  const d = new Date(referenceNow);
  d.setHours(hours, minutes, 0, 0);
  while (d.getTime() <= floor) {
    d.setDate(d.getDate() + 1);
  }
  return d.getTime();
}

export function formatTimestampToTimeInput(ts: number | null | undefined): string {
  if (!ts || !Number.isFinite(ts) || ts <= 0) return '';
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export function formatScheduleTimeShort(ts: number, now = Date.now()): string {
  const target = new Date(ts);
  const ref = new Date(now);
  const timeStr = formatTimestampToTimeInput(ts);
  const startOfToday = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()).getTime();
  const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const dayDiff = Math.round((startOfTarget - startOfToday) / 86400000);
  if (dayDiff === 0) return timeStr;
  if (dayDiff === 1) return `Tomorrow ${timeStr}`;
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${months[target.getMonth()]} ${target.getDate()} ${timeStr}`;
}

export function formatScheduleSummary(
  schedule?: DownloadSchedule | null,
  now = Date.now()
): string | null {
  const clean = normalizeDownloadSchedule(schedule);
  if (!clean) return null;
  const parts: string[] = [];
  if (clean.startAt) {
    parts.push(`Starts ${formatScheduleTimeShort(clean.startAt, now)}`);
  }
  if (clean.stopAt) {
    parts.push(`Stops ${formatScheduleTimeShort(clean.stopAt, now)}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function getDefaultScheduleTimeString(offsetHours: number, baseMs = Date.now()): string {
  const d = new Date(baseMs);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + Math.max(1, Math.round(offsetHours)));
  return formatTimestampToTimeInput(d.getTime());
}

