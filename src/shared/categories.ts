import type { CategoryId, DownloadItem, DownloadKind, FileCategory, SortBy } from './types';

const IMAGE_EXTS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff', 'tif', 'avif', 'heic', 'raw', 'psd',
]);

const DOC_EXTS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv', 'rtf', 'odt', 'ods', 'odp', 'epub', 'json', 'xml', 'yaml', 'yml',
]);

const ARCHIVE_EXTS = new Set([
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'iso', 'cab', 'zst',
]);

const VIDEO_EXTS = new Set([
  'mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg', '3gp', 'ts',
]);

export function classifyFileName(fileName: string, kind?: DownloadKind): FileCategory {
  if (kind === 'torrent') return 'torrents';
  const dot = fileName.lastIndexOf('.');
  if (dot < 0 || dot === fileName.length - 1) return 'other';
  const ext = fileName.slice(dot + 1).toLowerCase();
  if (ext === 'torrent') return 'torrents';
  if (IMAGE_EXTS.has(ext)) return 'images';
  if (DOC_EXTS.has(ext)) return 'docs';
  if (ARCHIVE_EXTS.has(ext)) return 'archives';
  if (VIDEO_EXTS.has(ext)) return 'videos';
  return 'other';
}

export function isActiveStatus(status: DownloadItem['status']): boolean {
  return status === 'downloading' || status === 'probing' || status === 'queued' || status === 'seeding';
}

export function isDownloadingStatus(status: DownloadItem['status']): boolean {
  return status === 'downloading' || status === 'probing';
}

export function matchesCategory(item: DownloadItem, category: CategoryId): boolean {
  switch (category) {
    case 'all':
      return true;
    case 'active':
      return isActiveStatus(item.status) || item.status === 'paused' || item.status === 'error';
    case 'completed':
      return item.status === 'completed' || item.status === 'seeding';
    case 'torrents':
      return item.kind === 'torrent' || item.category === 'torrents';
    default:
      return item.category === category;
  }
}

export function getItemProgress(item: DownloadItem): number {
  if (item.status === 'completed' || item.status === 'seeding') return 1;
  if (!item.totalBytes || item.totalBytes <= 0) return 0;
  return Math.max(0, Math.min(1, item.downloadedBytes / item.totalBytes));
}

export function sortDownloads(items: DownloadItem[], sortBy: SortBy): DownloadItem[] {
  const copy = [...items];
  switch (sortBy) {
    case 'newest':
      return copy.sort((a, b) => b.addedAt - a.addedAt);
    case 'oldest':
      return copy.sort((a, b) => a.addedAt - b.addedAt);
    case 'name':
      return copy.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    case 'size':
      return copy.sort((a, b) => (b.totalBytes ?? -1) - (a.totalBytes ?? -1));
    case 'progress':
      return copy.sort((a, b) => getItemProgress(b) - getItemProgress(a));
    case 'status': {
      const rank: Record<DownloadItem['status'], number> = {
        downloading: 0,
        probing: 1,
        queued: 2,
        seeding: 3,
        paused: 4,
        error: 5,
        completed: 6,
      };
      return copy.sort((a, b) => rank[a.status] - rank[b.status] || b.addedAt - a.addedAt);
    }
    default:
      return copy;
  }
}

