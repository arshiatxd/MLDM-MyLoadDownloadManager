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

function parseSemverParts(raw: string): { core: [number, number, number]; pre: string } {
  const cleaned = raw.trim().replace(/^v/i, '');
  const hyphenIdx = cleaned.indexOf('-');
  const coreStr = hyphenIdx >= 0 ? cleaned.slice(0, hyphenIdx) : cleaned;
  const pre = hyphenIdx >= 0 ? cleaned.slice(hyphenIdx + 1) : '';
  const nums = coreStr.split('.').map((part) => {
    const m = part.match(/^(\d+)/);
    return m ? Number(m[1]) : 0;
  });
  return {
    core: [nums[0] || 0, nums[1] || 0, nums[2] || 0],
    pre,
  };
}

export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemverParts(a);
  const pb = parseSemverParts(b);

  for (let i = 0; i < 3; i += 1) {
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

  constructor(opts: {
    currentVersion: string;
    downloadDir?: string;
    apiUrl?: string;
    fallbackReleaseUrl?: string;
    allowInsecureTestUrls?: boolean;
    onStatusChanged?: (status: UpdateStatus) => void;
    onLaunchInstaller?: (filePath: string) => Promise<void> | void;
  }) {
    this.currentVersion = opts.currentVersion || '1.0.14';
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

      const latestVersion = rawTag.replace(/^v/i, '');
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

    const safeName = sanitizeFileName(
      this.status.installerName || `MyLoad-Installer-${this.status.latestVersion || 'latest'}.exe`
    );
    await fs.promises.mkdir(this.downloadDir, { recursive: true });
    const finalPath = path.join(this.downloadDir, safeName);
    const partPath = `${finalPath}.part`;

    this.setStatus({
      ...this.status,
      state: 'downloading',
      downloadedBytes: 0,
      totalBytes: this.status.installerSize ?? null,
      progress: 0,
      error: undefined,
    });

    try {
      await this.downloadToFile(installerUrl, partPath, 6, (downloaded, total) => {
        const pct = total && total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : undefined;
        this.setStatus({
          ...this.status,
          state: 'downloading',
          downloadedBytes: downloaded,
          totalBytes: total,
          progress: pct,
        });
      });

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
      await fs.promises.rm(partPath, { force: true }).catch(() => {});
      return this.setStatus({
        ...this.status,
        state: 'error',
        error: err instanceof Error ? err.message : 'Failed to download update installer',
      });
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
    onProgress: (downloaded: number, total: number | null) => void
  ): Promise<void> {
    if (!this.isAllowedUrl(targetUrl)) {
      return Promise.reject(new Error('Disallowed update asset URL'));
    }

    return new Promise((resolve, reject) => {
      const parsed = new URL(targetUrl);
      const client = parsed.protocol === 'https:' ? https : http;
      const req = client.request(
        parsed,
        {
          method: 'GET',
          headers: {
            Accept: 'application/octet-stream',
            'User-Agent': `MyLoad/${this.currentVersion}`,
          },
          timeout: 30000,
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
            void this.downloadToFile(nextUrl, destPath, redirectsLeft - 1, onProgress).then(
              resolve,
              reject
            );
            return;
          }

          if (code < 200 || code >= 300) {
            res.resume();
            reject(new Error(`Installer download failed (HTTP ${code})`));
            return;
          }

          const rawLen = res.headers['content-length'];
          const totalBytes = rawLen && /^\d+$/.test(rawLen) ? Number(rawLen) : this.status.installerSize ?? null;
          let downloaded = 0;
          let lastEmit = 0;
          let settled = false;

          const out = fs.createWriteStream(destPath);
          const fail = async (err: Error) => {
            if (settled) return;
            settled = true;
            res.destroy();
            await new Promise<void>((r) => out.close(() => r()));
            reject(err);
          };

          res.on('data', (chunk: Buffer) => {
            downloaded += chunk.length;
            const okWrite = out.write(chunk);
            if (!okWrite) {
              res.pause();
              out.once('drain', () => res.resume());
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

          out.on('error', (err) => {
            void fail(err instanceof Error ? err : new Error('Disk write error during update download'));
          });

          res.on('end', () => {
            out.end(() => {
              if (settled) return;
              settled = true;
              onProgress(downloaded, totalBytes);
              if (downloaded <= 0) {
                reject(new Error('Downloaded installer file is empty'));
                return;
              }
              if (totalBytes && totalBytes > 0 && downloaded !== totalBytes) {
                reject(
                  new Error(`Incomplete installer download (${downloaded}/${totalBytes} bytes)`)
                );
                return;
              }
              resolve();
            });
          });
        }
      );

      req.on('timeout', () => {
        req.destroy(new Error('Installer download timed out'));
      });
      req.on('error', reject);
      req.end();
    });
  }
}

