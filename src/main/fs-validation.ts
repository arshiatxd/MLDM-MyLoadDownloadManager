import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { formatBytes } from '../shared/constants';
import type { DirectoryValidationResult, DiskSpaceInfo } from '../shared/types';

const MIN_REQUIRED_FREE_BYTES = 1024 * 1024;
const LOW_DISK_WARNING_THRESHOLD_BYTES = 500 * 1024 * 1024;
const POST_DOWNLOAD_HEADROOM_BYTES = 100 * 1024 * 1024;
const MAX_SAFE_DIR_LENGTH = 210;

const ILLEGAL_PATH_CHARS_RE = /[<>"|?*\x00-\x1f]/;

function findNearestExistingDir(targetPath: string): string | null {
  let current = path.resolve(targetPath);
  while (current) {
    if (fs.existsSync(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return fs.existsSync(current) ? current : null;
}

async function testDirectoryWritable(dirPath: string): Promise<boolean> {
  const probeName = `.myload-write-check-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const probeFile = path.join(dirPath, probeName);
  let handle: fs.promises.FileHandle | null = null;
  try {
    handle = await fs.promises.open(probeFile, 'wx');
    await handle.close();
    handle = null;
    await fs.promises.rm(probeFile, { force: true }).catch(() => {});
    return true;
  } catch {
    if (handle) {
      await handle.close().catch(() => {});
    }
    await fs.promises.rm(probeFile, { force: true }).catch(() => {});
    return false;
  }
}

async function readDiskSpace(dirPath: string): Promise<DiskSpaceInfo | null> {
  try {
    const stats = await fs.promises.statfs(dirPath);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    if (!Number.isFinite(freeBytes) || !Number.isFinite(totalBytes)) {
      return null;
    }
    return { freeBytes, totalBytes };
  } catch {
    return null;
  }
}

export async function validateSaveDirectory(
  rawDir: string,
  requiredBytes?: number | null
): Promise<DirectoryValidationResult> {
  const trimmed = (rawDir ?? '').trim();
  if (!trimmed) {
    return {
      valid: false,
      normalizedPath: '',
      errorCode: 'EMPTY_PATH',
      error: 'Download folder path is empty. Choose a destination folder.',
      diskSpace: null,
      willCreate: false,
    };
  }

  if (!path.isAbsolute(trimmed)) {
    return {
      valid: false,
      normalizedPath: trimmed,
      errorCode: 'INVALID_PATH',
      error: 'Enter a full absolute folder path (for example, C:\\Users\\...\\Downloads).',
      diskSpace: null,
      willCreate: false,
    };
  }

  if (ILLEGAL_PATH_CHARS_RE.test(trimmed)) {
    return {
      valid: false,
      normalizedPath: trimmed,
      errorCode: 'INVALID_PATH',
      error: 'Folder path contains invalid characters (< > " | ? *).',
      diskSpace: null,
      willCreate: false,
    };
  }

  const colonIdx = trimmed.indexOf(':');
  if (colonIdx !== -1 && (colonIdx !== 1 || !/^[A-Za-z]:/.test(trimmed))) {
    return {
      valid: false,
      normalizedPath: trimmed,
      errorCode: 'INVALID_PATH',
      error: 'Folder path has an invalid ":" character.',
      diskSpace: null,
      willCreate: false,
    };
  }

  if (process.platform === 'win32' && !trimmed.startsWith('\\\\') && !/^[A-Za-z]:[\\/]/.test(trimmed)) {
    return {
      valid: false,
      normalizedPath: trimmed,
      errorCode: 'INVALID_PATH',
      error: 'Windows folder path must start with a drive letter like C:\\ or D:\\.',
      diskSpace: null,
      willCreate: false,
    };
  }

  const normalizedPath = path.resolve(trimmed);
  if (normalizedPath.length > MAX_SAFE_DIR_LENGTH) {
    return {
      valid: false,
      normalizedPath,
      errorCode: 'PATH_TOO_LONG',
      error: `Folder path is too long (${normalizedPath.length} chars; keep under ${MAX_SAFE_DIR_LENGTH} chars so file names fit Windows limits).`,
      diskSpace: null,
      willCreate: false,
    };
  }

  const root = path.parse(normalizedPath).root;
  if (root && !fs.existsSync(root)) {
    return {
      valid: false,
      normalizedPath,
      errorCode: 'DRIVE_NOT_FOUND',
      error: `Drive or location "${root}" does not exist or is disconnected. Choose an existing drive or folder.`,
      diskSpace: null,
      willCreate: false,
    };
  }

  const targetExists = fs.existsSync(normalizedPath);
  if (targetExists) {
    try {
      const stat = fs.statSync(normalizedPath);
      if (!stat.isDirectory()) {
        return {
          valid: false,
          normalizedPath,
          errorCode: 'NOT_A_DIRECTORY',
          error: `"${normalizedPath}" points to an existing file, not a folder.`,
          diskSpace: null,
          willCreate: false,
        };
      }
    } catch (err) {
      return {
        valid: false,
        normalizedPath,
        errorCode: 'NOT_WRITABLE',
        error: formatDownloadError(err, { saveDir: normalizedPath }),
        diskSpace: null,
        willCreate: false,
      };
    }
  }

  const existingAncestor = findNearestExistingDir(normalizedPath);
  if (!existingAncestor) {
    return {
      valid: false,
      normalizedPath,
      errorCode: 'DRIVE_NOT_FOUND',
      error: `Cannot access drive or parent folder for "${normalizedPath}".`,
      diskSpace: null,
      willCreate: false,
    };
  }

  const writable = await testDirectoryWritable(existingAncestor);
  const diskSpace = await readDiskSpace(existingAncestor);

  if (!writable) {
    return {
      valid: false,
      normalizedPath,
      errorCode: 'NOT_WRITABLE',
      error: `Permission denied writing to "${existingAncestor}". Choose another folder or adjust folder permissions.`,
      diskSpace,
      willCreate: !targetExists,
    };
  }

  const driveLabel = root || existingAncestor;

  if (diskSpace) {
    if (diskSpace.freeBytes < MIN_REQUIRED_FREE_BYTES) {
      return {
        valid: false,
        normalizedPath,
        errorCode: 'DISK_FULL',
        error: `Storage is full on "${driveLabel}" (only ${formatBytes(diskSpace.freeBytes)} free). Free up disk space or choose another drive.`,
        diskSpace,
        willCreate: !targetExists,
      };
    }

    if (
      typeof requiredBytes === 'number' &&
      Number.isFinite(requiredBytes) &&
      requiredBytes > 0 &&
      requiredBytes > diskSpace.freeBytes
    ) {
      return {
        valid: false,
        normalizedPath,
        errorCode: 'DISK_FULL',
        error: `Not enough storage space on "${driveLabel}" — requires ${formatBytes(requiredBytes)}, only ${formatBytes(diskSpace.freeBytes)} available. Free up space or select another drive.`,
        diskSpace,
        willCreate: !targetExists,
      };
    }
  }

  const warnings: string[] = [];
  if (!targetExists) {
    warnings.push('Folder does not exist yet — it will be created automatically.');
  }
  if (diskSpace) {
    const lowFree = diskSpace.freeBytes < LOW_DISK_WARNING_THRESHOLD_BYTES;
    const tightHeadroom =
      typeof requiredBytes === 'number' &&
      requiredBytes > 0 &&
      diskSpace.freeBytes - requiredBytes < POST_DOWNLOAD_HEADROOM_BYTES;
    if (lowFree || tightHeadroom) {
      warnings.push(
        `Low disk space on "${driveLabel}" (${formatBytes(diskSpace.freeBytes)} free).`
      );
    }
  }

  return {
    valid: true,
    normalizedPath,
    warning: warnings.length > 0 ? warnings.join(' ') : undefined,
    diskSpace,
    willCreate: !targetExists,
  };
}

const NON_RETRYABLE_CODES = new Set([
  'ENOSPC',
  'EACCES',
  'EPERM',
  'EROFS',
  'EINVAL',
  'ENAMETOOLONG',
  'ENOTDIR',
  'EISDIR',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);

export function isNonRetryableSystemError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && NON_RETRYABLE_CODES.has(code);
}

export function formatDownloadError(
  err: unknown,
  context?: { saveDir?: string }
): string {
  const code =
    err && typeof err === 'object' && typeof (err as { code?: unknown }).code === 'string'
      ? (err as { code: string }).code
      : undefined;
  const rawMsg = err instanceof Error ? err.message : String(err || 'Unknown error');
  const loc = context?.saveDir ? `"${context.saveDir}"` : 'the destination folder';

  if (code === 'ENOSPC' || /\benospc\b|no space left on device/i.test(rawMsg)) {
    return `Storage full: not enough free space in ${loc}. Free up space or move the download to another drive.`;
  }
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
    return `Permission denied: cannot write files to ${loc}. Choose a writable folder.`;
  }
  if (code === 'ENOENT') {
    return `Folder or drive not found for ${loc}. Verify the destination drive is connected.`;
  }
  if (code === 'ENAMETOOLONG') {
    return `Path too long for Windows in ${loc}. Use a shorter folder path or file name.`;
  }
  if (code === 'ENOTDIR' || code === 'EISDIR') {
    return `Invalid destination path in ${loc}. Verify the save path is a writable folder.`;
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return 'Server not found (DNS lookup failed). Check the URL and your internet connection.';
  }
  if (code === 'ECONNREFUSED') {
    return 'Connection refused by remote server.';
  }
  if (code === 'ECONNRESET' || code === 'EPIPE') {
    return 'Connection interrupted by remote server.';
  }
  if (code === 'ETIMEDOUT' || /timed out/i.test(rawMsg)) {
    return 'Connection timed out while waiting for the server.';
  }
  if (
    code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
    code === 'CERT_HAS_EXPIRED' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
  ) {
    return `Untrusted or expired SSL/TLS certificate from server (${code}). Transfer blocked for security.`;
  }

  const httpMatch = rawMsg.match(/\bHTTP\s+(\d{3})\b/i);
  if (httpMatch) {
    const status = Number(httpMatch[1]);
    if (status === 401 || status === 403) {
      return `Access denied by server (HTTP ${status}). Your download session or link may have expired.`;
    }
    if (status === 404 || status === 410) {
      return `File not found on server (HTTP ${status}). The link may have expired or been moved.`;
    }
    if (status === 416) {
      return 'Server rejected resume range (HTTP 416). Try removing and restarting the download.';
    }
    if (status === 429) {
      return 'Too many requests (HTTP 429). Wait a moment or reduce HTTP connections in Settings.';
    }
    if (status >= 500) {
      return `Remote server error (HTTP ${status}). Try again later.`;
    }
  }

  return rawMsg;
}

