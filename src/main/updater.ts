import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { sanitizeFileName } from '../shared/constants';
import type { UpdateStatus } from '../shared/types';

export interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
  size?: number;
}

interface GitHubReleasePayload {
  tag_name?: string;
  name?: string;
  body?: string;
  html_url?: string;
  published_at?: string;
  assets?: GitHubReleaseAsset[];
}

const DEFAULT_API_URL =
  'https://api.github.com/repos/arshiatxd/MLDM-MyLoadDownloadManager/releases/latest';
const DEFAULT_RELEASE_URL =
  'https://github.com/arshiatxd/MLDM-MyLoadDownloadManager/releases/latest';

const ALLOWED_GITHUB_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com',
  'uploads.github.com',
]);

function normalizeVersionTag(raw: string): string {
  return raw.trim().replace(/^v\.?\s*/i, '');
}

function parseSemverParts(raw: string): { core: [number, number, number, number]; pre: string } {
  const cleaned = normalizeVersionTag(raw);
  const hyphenIdx = cleaned.indexOf('-');
  const coreStr = hyphenIdx >= 0 ? cleaned.slice(0, hyphenIdx) : cleaned;
  const pre = hyphenIdx >= 0 ? cleaned.slice(hyphenIdx + 1) : '';
  const nums = coreStr.split('.').map((part) => {
    const m = part.match(/^(\d+)/);
    return m ? Number(m[1]) : 0;
  });
  let patch = nums[2] || 0;
  let hotfix = nums[3] || 0;
  if (nums.length === 3 && patch >= 100 && patch < 1000) {
    hotfix = patch % 10;
    patch = Math.floor(patch / 10);
  }
  return {
    core: [nums[0] || 0, nums[1] || 0, patch, hotfix],
    pre,
  };
}

export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemverParts(a);
  const pb = parseSemverParts(b);

  for (let i = 0; i < 4; i += 1) {
    if (pa.core[i] > pb.core[i]) return 1;
    if (pa.core[i] < pb.core[i]) return -1;
  }

  if (!pa.pre && pb.pre) return 1;
  if (pa.pre && !pb.pre) return -1;
  if (!pa.pre && !pb.pre) return 0;

  const ta = pa.pre.split('.');
  const tb = pb.pre.split('.');
  const len = Math.max(ta.length, tb.length);
  for (let i = 0; i < len; i += 1) {
    const sa = ta[i];
    const sb = tb[i];
    if (sa === undefined) return -1;
    if (sb === undefined) return 1;
    const na = /^\d+$/.test(sa) ? Number(sa) : null;
    const nb = /^\d+$/.test(sb) ? Number(sb) : null;
    if (na !== null && nb !== null) {
      if (na > nb) return 1;
      if (na < nb) return -1;
    } else {
      const cmp = sa.localeCompare(sb);
      if (cmp > 0) return 1;
      if (cmp < 0) return -1;
    }
  }
  return 0;
}

export function selectWindowsInstallerAsset(
  assets: GitHubReleaseAsset[] | undefined
): GitHubReleaseAsset | null {
  if (!Array.isArray(assets)) return null;
  const exeAssets = assets.filter(
    (a) =>
      Boolean(a) &&
      typeof a.name === 'string' &&
      typeof a.browser_download_url === 'string' &&
      /\.exe$/i.test(a.name) &&
      !/__uninstaller/i.test(a.name)
  );
  if (exeAssets.length === 0) return null;
  return exeAssets.find((a) => /installer/i.test(a.name)) ?? exeAssets[0];
}

class UpdateControlError extends Error {
  constructor(public readonly action: 'pause' | 'cancel') {
    super(`Update download ${action}`);
    this.name = 'UpdateControlError';
  }
}

export class UpdateService {
  private readonly currentVersion: string;
  private readonly downloadDir: string;
  private readonly apiUrl: string;
  private readonly fallbackReleaseUrl: string;
  private readonly allowInsecureTestUrls: boolean;
  private readonly onStatusChanged?: (status: UpdateStatus) => void;
  private readonly onLaunchInstaller?: (filePath: string) => Promise<void> | void;

  private status: UpdateStatus;
  private checkingPromise: Promise<UpdateStatus> | null = null;
  private downloadingPromise: Promise<UpdateStatus> | null = null;
  private activeAbort: ((action: 'pause' | 'cancel') => void) | null = null;
  private activePartPath: string | null = null;
  private pendingControlAction: 'pause' | 'cancel' | null = null;

  constructor(opts: {
    currentVersion: string;
    downloadDir?: string;
    apiUrl?: string;
    fallbackReleaseUrl?: string;
    allowInsecureTestUrls?: boolean;
    onStatusChanged?: (status: UpdateStatus) => void;
    onLaunchInstaller?: (filePath: string) => Promise<void> | void;
  }) {
    this.currentVersion = opts.currentVersion || '1.1.1';
    this.downloadDir = opts.downloadDir || path.join(os.tmpdir(), 'MyLoad-Updates');
    this.apiUrl = opts.apiUrl || DEFAULT_API_URL;
    this.fallbackReleaseUrl = opts.fallbackReleaseUrl || DEFAULT_RELEASE_URL;
    this.allowInsecureTestUrls = Boolean(opts.allowInsecureTestUrls);
    this.onStatusChanged = opts.onStatusChanged;
    this.onLaunchInstaller = opts.onLaunchInstaller;
    this.status = {
      state: 'idle',
      currentVersion: this.currentVersion,
    };
  }

  getStatus(): UpdateStatus {
    return { ...this.status };
  }

  getReleasePageUrl(): string {
    if (this.status.releaseUrl && this.isAllowedUrl(this.status.releaseUrl)) {
      return this.status.releaseUrl;
    }
    return this.fallbackReleaseUrl;
  }

  async cleanupDownloadedInstallers(): Promise<number> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(this.downloadDir, { withFileTypes: true });
    } catch {
      return 0;
    }

    let removed = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !/\.(exe|part)$/i.test(entry.name)) {
        continue;
      }
      try {
        await fs.promises.rm(path.join(this.downloadDir, entry.name), { force: true });
        removed += 1;
      } catch {
      }
    }
    return removed;
  }

  private setStatus(next: UpdateStatus): UpdateStatus {
    this.status = next;
    this.onStatusChanged?.({ ...this.status });
    return this.getStatus();
  }

  private isAllowedUrl(rawUrl: string): boolean {
    try {
      const parsed = new URL(rawUrl);
      if (this.allowInsecureTestUrls) {
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      }
      if (parsed.protocol !== 'https:') return false;
      const host = parsed.hostname.toLowerCase();
      if (ALLOWED_GITHUB_HOSTS.has(host)) return true;
      for (const allowed of ALLOWED_GITHUB_HOSTS) {
        if (host.endsWith(`.${allowed}`)) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async checkForUpdates(): Promise<UpdateStatus> {
    if (this.checkingPromise) return this.checkingPromise;
    if (this.downloadingPromise) return this.getStatus();

    this.checkingPromise = this.runCheck().finally(() => {
      this.checkingPromise = null;
    });
    return this.checkingPromise;
  }

  private async runCheck(): Promise<UpdateStatus> {
    this.setStatus({
      ...this.status,
      state: 'checking',
      error: undefined,
    });

    try {
      const res = await this.fetchJson(this.apiUrl, 4);
      if (res.statusCode === 404) {
        return this.setStatus({
          state: 'up-to-date',
          currentVersion: this.currentVersion,
          latestVersion: this.currentVersion,
          releaseUrl: this.fallbackReleaseUrl,
          checkedAt: Date.now(),
        });
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw new Error(`GitHub returned HTTP ${res.statusCode}`);
      }

      const payload = JSON.parse(res.body) as GitHubReleasePayload;
      const rawTag = (payload.tag_name || '').trim();
      if (!rawTag) {
        return this.setStatus({
          state: 'up-to-date',
          currentVersion: this.currentVersion,
          latestVersion: this.currentVersion,
          releaseUrl: this.fallbackReleaseUrl,
          checkedAt: Date.now(),
        });
      }

      const latestVersion = normalizeVersionTag(rawTag);
      const releaseUrl =
        payload.html_url && this.isAllowedUrl(payload.html_url)
          ? payload.html_url
          : this.fallbackReleaseUrl;

      if (compareSemver(latestVersion, this.currentVersion) > 0) {
        const asset = selectWindowsInstallerAsset(payload.assets);
        const installerUrl =
          asset && this.isAllowedUrl(asset.browser_download_url)
            ? asset.browser_download_url
            : undefined;
        return this.setStatus({
          state: 'available',
          currentVersion: this.currentVersion,
          latestVersion,
          releaseName: payload.name || `MyLoad v${latestVersion}`,
          releaseNotes: payload.body ? payload.body.slice(0, 2000) : undefined,
          releaseUrl,
          publishedAt: payload.published_at,
          installerName: asset && installerUrl ? asset.name : undefined,
          installerUrl,
          installerSize: asset && typeof asset.size === 'number' ? asset.size : null,
          checkedAt: Date.now(),
        });
      }

      return this.setStatus({
        state: 'up-to-date',
        currentVersion: this.currentVersion,
        latestVersion,
        releaseUrl,
        checkedAt: Date.now(),
      });
    } catch (err) {
      return this.setStatus({
        ...this.status,
        state: 'error',
        error: err instanceof Error ? err.message : 'Unable to check for updates',
        checkedAt: Date.now(),
      });
    }
  }

  private getInstallerPaths(): { finalPath: string; partPath: string } {
    const safeName = sanitizeFileName(
      this.status.installerName || `MyLoad-Installer-${this.status.latestVersion || 'latest'}.exe`
    );
    const finalPath = path.join(this.downloadDir, safeName);
    return { finalPath, partPath: `${finalPath}.part` };
  }

  private buildAvailableStatus(): UpdateStatus {
    return {
      state: 'available',
      currentVersion: this.currentVersion,
      latestVersion: this.status.latestVersion,
      releaseName: this.status.releaseName,
      releaseNotes: this.status.releaseNotes,
      releaseUrl: this.status.releaseUrl,
      publishedAt: this.status.publishedAt,
      installerName: this.status.installerName,
      installerUrl: this.status.installerUrl,
      installerSize: this.status.installerSize,
      checkedAt: this.status.checkedAt,
    };
  }

  private computeProgress(downloaded: number, total: number | null): number | undefined {
    return total && total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : undefined;
  }

  async pauseUpdateDownload(): Promise<UpdateStatus> {
    if (this.status.state !== 'downloading' || !this.downloadingPromise) {
      return this.getStatus();
    }
    if (this.pendingControlAction !== 'cancel') {
      this.pendingControlAction = 'pause';
      this.activeAbort?.('pause');
    }
    await this.downloadingPromise.catch(() => {});
    return this.getStatus();
  }

  async resumeUpdateDownload(): Promise<UpdateStatus> {
    if (this.downloadingPromise) {
      return this.downloadingPromise;
    }
    if (this.status.state === 'paused' || this.status.state === 'available') {
      return this.downloadAndInstallUpdate();
    }
    return this.getStatus();
  }

  async cancelUpdateDownload(): Promise<UpdateStatus> {
    if (this.status.state !== 'downloading' && this.status.state !== 'paused') {
      return this.getStatus();
    }
    if (this.downloadingPromise) {
      this.pendingControlAction = 'cancel';
      this.activeAbort?.('cancel');
      await this.downloadingPromise.catch(() => {});
    }
    const { partPath } = this.getInstallerPaths();
    const toDelete = this.activePartPath || partPath;
    this.activePartPath = null;
    await fs.promises.rm(toDelete, { force: true }).catch(() => {});
    if (this.getStatus().state !== 'available') {
      return this.setStatus(this.buildAvailableStatus());
    }
    return this.getStatus();
  }

  async downloadAndInstallUpdate(): Promise<UpdateStatus> {
    if (this.downloadingPromise) return this.downloadingPromise;

    if (
      this.status.state === 'downloaded' &&
      this.status.downloadedFilePath &&
      fs.existsSync(this.status.downloadedFilePath)
    ) {
      try {
        await this.onLaunchInstaller?.(this.status.downloadedFilePath);
        return this.getStatus();
      } catch (err) {
        return this.setStatus({
          ...this.status,
          state: 'error',
          error: err instanceof Error ? err.message : 'Failed to launch update installer',
        });
      }
    }

    if (!this.status.installerUrl) {
      return this.getStatus();
    }

    this.downloadingPromise = this.runDownload().finally(() => {
      this.downloadingPromise = null;
    });
    return this.downloadingPromise;
  }

  private async runDownload(): Promise<UpdateStatus> {
    const installerUrl = this.status.installerUrl;
    if (!installerUrl || !this.isAllowedUrl(installerUrl)) {
      return this.setStatus({
        ...this.status,
        state: 'error',
        error: 'Update download URL is invalid or untrusted',
      });
    }

    const isResuming = this.status.state === 'paused';
    const { finalPath, partPath } = this.getInstallerPaths();
    await fs.promises.mkdir(this.downloadDir, { recursive: true });
    this.activePartPath = partPath;
    this.pendingControlAction = null;

    let resumeOffset = 0;
    if (isResuming) {
      try {
        const st = await fs.promises.stat(partPath);
        if (st.isFile() && st.size > 0) {
          resumeOffset = st.size;
        }
      } catch {
        resumeOffset = 0;
      }
    } else {
      await fs.promises.rm(partPath, { force: true }).catch(() => {});
    }

    const initialTotal = this.status.totalBytes ?? this.status.installerSize ?? null;
    this.setStatus({
      ...this.status,
      state: 'downloading',
      downloadedBytes: resumeOffset,
      totalBytes: initialTotal,
      progress: this.computeProgress(resumeOffset, initialTotal) ?? 0,
      error: undefined,
    });

    try {
      if (this.pendingControlAction) {
        throw new UpdateControlError(this.pendingControlAction);
      }
      await this.downloadToFile(installerUrl, partPath, 6, resumeOffset, (downloaded, total) => {
        this.setStatus({
          ...this.status,
          state: 'downloading',
          downloadedBytes: downloaded,
          totalBytes: total,
          progress: this.computeProgress(downloaded, total),
        });
      });

      this.activePartPath = null;
      await fs.promises.rm(finalPath, { force: true }).catch(() => {});
      await fs.promises.rename(partPath, finalPath);

      const readyStatus = this.setStatus({
        ...this.status,
        state: 'downloaded',
        progress: 100,
        downloadedFilePath: finalPath,
      });

      await this.onLaunchInstaller?.(finalPath);
      return readyStatus;
    } catch (err) {
      const controlAction =
        err instanceof UpdateControlError ? err.action : this.pendingControlAction;
      this.pendingControlAction = null;

      if (controlAction === 'pause') {
        let diskBytes = this.status.downloadedBytes ?? resumeOffset;
        try {
          const st = await fs.promises.stat(partPath);
          if (st.isFile()) {
            diskBytes = st.size;
          }
        } catch {
        }
        const total = this.status.totalBytes ?? this.status.installerSize ?? null;
        return this.setStatus({
          ...this.status,
          state: 'paused',
          downloadedBytes: diskBytes,
          totalBytes: total,
          progress: this.computeProgress(diskBytes, total),
          error: undefined,
        });
      }

      this.activePartPath = null;
      await fs.promises.rm(partPath, { force: true }).catch(() => {});

      if (controlAction === 'cancel') {
        return this.setStatus(this.buildAvailableStatus());
      }

      return this.setStatus({
        ...this.status,
        state: 'error',
        error: err instanceof Error ? err.message : 'Failed to download update installer',
      });
    } finally {
      this.pendingControlAction = null;
      this.activeAbort = null;
    }
  }

  private fetchJson(
    targetUrl: string,
    redirectsLeft: number
  ): Promise<{ statusCode: number; body: string }> {
    if (!this.isAllowedUrl(targetUrl)) {
      return Promise.reject(new Error('Disallowed update endpoint URL'));
    }

    return new Promise((resolve, reject) => {
      const parsed = new URL(targetUrl);
      const client = parsed.protocol === 'https:' ? https : http;
      const req = client.request(
        parsed,
        {
          method: 'GET',
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': `MyLoad/${this.currentVersion}`,
          },
          timeout: 12000,
        },
        (res) => {
          const code = res.statusCode ?? 0;
          if (
            code >= 300 &&
            code < 400 &&
            res.headers.location &&
            redirectsLeft > 0
          ) {
            res.resume();
            const nextUrl = new URL(res.headers.location, parsed).toString();
            void this.fetchJson(nextUrl, redirectsLeft - 1).then(resolve, reject);
            return;
          }

          const chunks: Buffer[] = [];
          let totalLen = 0;
          res.on('data', (chunk: Buffer) => {
            totalLen += chunk.length;
            if (totalLen > 2 * 1024 * 1024) {
              req.destroy(new Error('Update metadata response too large'));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => {
            resolve({
              statusCode: code,
              body: Buffer.concat(chunks).toString('utf-8'),
            });
          });
          res.on('error', reject);
        }
      );

      req.on('timeout', () => {
        req.destroy(new Error('Update check timed out'));
      });
      req.on('error', reject);
      req.end();
    });
  }

  private downloadToFile(
    targetUrl: string,
    destPath: string,
    redirectsLeft: number,
    resumeOffset: number,
    onProgress: (downloaded: number, total: number | null) => void
  ): Promise<void> {
    if (!this.isAllowedUrl(targetUrl)) {
      return Promise.reject(new Error('Disallowed update asset URL'));
    }

    if (this.pendingControlAction) {
      return Promise.reject(new UpdateControlError(this.pendingControlAction));
    }

    return new Promise((resolve, reject) => {
      const parsed = new URL(targetUrl);
      const client = parsed.protocol === 'https:' ? https : http;
      const headers: Record<string, string> = {
        Accept: 'application/octet-stream',
        'User-Agent': `MyLoad/${this.currentVersion}`,
      };
      if (resumeOffset > 0) {
        headers.Range = `bytes=${resumeOffset}-`;
      }

      let settled = false;
      let activeRes: http.IncomingMessage | null = null;
      let out: fs.WriteStream | null = null;
      let outClosed = true;

      const closeOutStream = (mode: 'end' | 'destroy'): Promise<void> =>
        new Promise((done) => {
          if (!out || outClosed) {
            done();
            return;
          }
          out.once('close', () => done());
          if (mode === 'end') {
            out.end();
          } else {
            out.destroy();
          }
        });

      const settleReject = (err: Error) => {
        if (settled) return;
        settled = true;
        this.activeAbort = null;
        reject(err);
      };

      const settleResolve = () => {
        if (settled) return;
        settled = true;
        this.activeAbort = null;
        resolve();
      };

      const abortHandler = (action: 'pause' | 'cancel') => {
        if (settled) return;
        settled = true;
        this.activeAbort = null;
        try {
          activeRes?.destroy();
        } catch {
        }
        try {
          req.destroy();
        } catch {
        }
        void closeOutStream(action === 'pause' ? 'end' : 'destroy').then(() => {
          reject(new UpdateControlError(action));
        });
      };

      this.activeAbort = abortHandler;

      const req = client.request(
        parsed,
        {
          method: 'GET',
          headers,
          timeout: 30000,
        },
        (res) => {
          if (settled) {
            res.resume();
            return;
          }
          activeRes = res;
          const code = res.statusCode ?? 0;

          if (
            code >= 300 &&
            code < 400 &&
            res.headers.location &&
            redirectsLeft > 0
          ) {
            res.resume();
            const nextUrl = new URL(res.headers.location, parsed).toString();
            this.activeAbort = null;
            if (settled) return;
            settled = true;
            void this.downloadToFile(nextUrl, destPath, redirectsLeft - 1, resumeOffset, onProgress).then(
              resolve,
              reject
            );
            return;
          }

          if (code === 416 && resumeOffset > 0) {
            res.resume();
            const knownTotal = this.status.totalBytes ?? this.status.installerSize ?? null;
            const rangeMatch =
              typeof res.headers['content-range'] === 'string'
                ? res.headers['content-range'].match(/^bytes\s+\*\/(\d+)$/i)
                : null;
            const serverTotal = rangeMatch ? Number(rangeMatch[1]) : knownTotal;
            if (serverTotal && serverTotal > 0 && resumeOffset >= serverTotal) {
              settleResolve();
              return;
            }
            this.activeAbort = null;
            if (settled) return;
            settled = true;
            void fs.promises
              .rm(destPath, { force: true })
              .catch(() => {})
              .then(() => this.downloadToFile(targetUrl, destPath, redirectsLeft, 0, onProgress))
              .then(resolve, reject);
            return;
          }

          if (code < 200 || code >= 300) {
            res.resume();
            settleReject(new Error(`Installer download failed (HTTP ${code})`));
            return;
          }

          const rawLen = res.headers['content-length'];
          const contentLength = rawLen && /^\d+$/.test(rawLen) ? Number(rawLen) : null;
          let isPartialAppend = false;
          let startOffset = 0;
          let totalBytes: number | null = this.status.installerSize ?? null;

          if (code === 206 && resumeOffset > 0) {
            const contentRange =
              typeof res.headers['content-range'] === 'string' ? res.headers['content-range'] : '';
            const rangeMatch = contentRange.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
            const parsedStart = rangeMatch ? Number(rangeMatch[1]) : resumeOffset;
            if (parsedStart === resumeOffset) {
              isPartialAppend = true;
              startOffset = resumeOffset;
              if (rangeMatch && rangeMatch[3] !== '*') {
                totalBytes = Number(rangeMatch[3]);
              } else if (contentLength !== null) {
                totalBytes = resumeOffset + contentLength;
              }
            }
          }

          if (!isPartialAppend) {
            startOffset = 0;
            if (contentLength !== null) {
              totalBytes = contentLength;
            }
          }

          let downloaded = startOffset;
          let lastEmit = 0;

          const stream = fs.createWriteStream(destPath, {
            flags: isPartialAppend ? 'a' : 'w',
          });
          out = stream;
          outClosed = false;
          stream.on('close', () => {
            outClosed = true;
          });

          const fail = async (err: Error) => {
            if (settled) return;
            settled = true;
            this.activeAbort = null;
            try {
              res.destroy();
            } catch {
            }
            await closeOutStream('destroy');
            reject(err);
          };

          res.on('data', (chunk: Buffer) => {
            if (settled) return;
            downloaded += chunk.length;
            const okWrite = stream.write(chunk);
            if (!okWrite) {
              res.pause();
              stream.once('drain', () => {
                if (!settled) res.resume();
              });
            }
            const now = Date.now();
            if (now - lastEmit >= 150) {
              lastEmit = now;
              onProgress(downloaded, totalBytes);
            }
          });

          res.on('error', (err) => {
            void fail(err instanceof Error ? err : new Error('Network error during update download'));
          });

          stream.on('error', (err) => {
            void fail(err instanceof Error ? err : new Error('Disk write error during update download'));
          });

          res.on('end', () => {
            if (settled) return;
            stream.once('close', () => {
              if (settled) return;
              onProgress(downloaded, totalBytes);
              if (downloaded <= 0) {
                settleReject(new Error('Downloaded installer file is empty'));
                return;
              }
              if (totalBytes && totalBytes > 0 && downloaded !== totalBytes) {
                settleReject(
                  new Error(`Incomplete installer download (${downloaded}/${totalBytes} bytes)`)
                );
                return;
              }
              settleResolve();
            });
            stream.end();
          });
        }
      );

      req.on('timeout', () => {
        if (settled) return;
        req.destroy(new Error('Installer download timed out'));
      });
      req.on('error', (err) => {
        void (async () => {
          if (settled) return;
          settled = true;
          this.activeAbort = null;
          await closeOutStream('destroy');
          reject(err instanceof Error ? err : new Error('Network error during update download'));
        })();
      });
      req.end();

      if (this.pendingControlAction) {
        abortHandler(this.pendingControlAction);
      }
    });
  }
}

