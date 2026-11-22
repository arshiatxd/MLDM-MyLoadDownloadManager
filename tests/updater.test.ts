import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  UpdateService,
  compareSemver,
  selectWindowsInstallerAsset,
} from '../src/main/updater';
import type { UpdateStatus } from '../src/shared/types';

describe('GitHub UpdateService & semver utilities', () => {
  let tmpDir: string;
  let servers: http.Server[] = [];

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'myload-updater-test-'));
  });

  afterEach(async () => {
    for (const srv of servers.splice(0, servers.length)) {
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('compares semver strings and selects the preferred Windows installer asset', () => {
    expect(compareSemver('v1.0.1', '1.0.0')).toBe(1);
    expect(compareSemver('1.10.0', '1.2.0')).toBe(1);
    expect(compareSemver('1.0.0', '1.0.0-beta.1')).toBe(1);
    expect(compareSemver('v1.0.0', '1.0.0')).toBe(0);
    expect(compareSemver('0.9.9', '1.0.0')).toBe(-1);

    const picked = selectWindowsInstallerAsset([
      { name: 'MyLoad-Installer-1.1.0-x64.__uninstaller.exe', browser_download_url: 'https://github.com/u.exe' },
      { name: 'MyLoad-Portable-1.1.0-x64.exe', browser_download_url: 'https://github.com/p.exe' },
      { name: 'MyLoad-Installer-1.1.0-x64.exe', browser_download_url: 'https://github.com/i.exe' },
    ]);
    expect(picked?.name).toBe('MyLoad-Installer-1.1.0-x64.exe');

    const fallback = selectWindowsInstallerAsset([
      { name: 'MyLoad-1.1.0.zip', browser_download_url: 'https://github.com/z.zip' },
      { name: 'MyLoad-Portable-1.1.0-x64.exe', browser_download_url: 'https://github.com/p.exe' },
    ]);
    expect(fallback?.name).toBe('MyLoad-Portable-1.1.0-x64.exe');
  });

  it('handles 404 and equal versions cleanly, and downloads & launches newer releases across redirects', async () => {
    const installerPayload = crypto.randomBytes(128 * 1024);
    let mode: '404' | 'equal' | 'newer' = '404';

    const server = http.createServer((req, res) => {
      const urlPath = (req.url || '/').split('?')[0];
      if (urlPath === '/releases/latest') {
        if (mode === '404') {
          res.statusCode = 404;
          res.end(JSON.stringify({ message: 'Not Found' }));
          return;
        }
        const host = req.headers.host;
        const tag = mode === 'equal' ? 'v1.0.0' : 'v1.1.0';
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            tag_name: tag,
            name: `MyLoad ${tag}`,
            body: 'Release notes',
            html_url: `http://${host}/releases/tag/${tag}`,
            assets: [
              {
                name: 'MyLoad-Installer-1.1.0-x64.exe',
                browser_download_url: `http://${host}/download-redirect`,
                size: installerPayload.length,
              },
            ],
          })
        );
        return;
      }

      if (urlPath === '/download-redirect') {
        res.statusCode = 302;
        res.setHeader('Location', '/cdn/MyLoad-Installer-1.1.0-x64.exe');
        res.end();
        return;
      }

      if (urlPath === '/cdn/MyLoad-Installer-1.1.0-x64.exe') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', String(installerPayload.length));
        res.end(installerPayload);
        return;
      }

      res.statusCode = 404;
      res.end();
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    const observedStates: UpdateStatus['state'][] = [];
    const launchedPaths: string[] = [];
    const updater = new UpdateService({
      currentVersion: '1.0.0',
      downloadDir: path.join(tmpDir, 'updates'),
      apiUrl: `${baseUrl}/releases/latest`,
      fallbackReleaseUrl: `${baseUrl}/releases/latest`,
      allowInsecureTestUrls: true,
      onStatusChanged: (st) => observedStates.push(st.state),
      onLaunchInstaller: (fp) => {
        launchedPaths.push(fp);
      },
    });

    const res404 = await updater.checkForUpdates();
    expect(res404.state).toBe('up-to-date');

    mode = 'equal';
    const resEqual = await updater.checkForUpdates();
    expect(resEqual.state).toBe('up-to-date');

    mode = 'newer';
    const resNewer = await updater.checkForUpdates();
    expect(resNewer.state).toBe('available');
    expect(resNewer.latestVersion).toBe('1.1.0');
    expect(resNewer.installerName).toBe('MyLoad-Installer-1.1.0-x64.exe');
    expect(resNewer.installerUrl).toBe(`${baseUrl}/download-redirect`);

    const downloadedStatus = await updater.downloadAndInstallUpdate();
    expect(downloadedStatus.state).toBe('downloaded');
    expect(downloadedStatus.progress).toBe(100);
    expect(launchedPaths).toHaveLength(1);
    expect(fs.existsSync(launchedPaths[0])).toBe(true);
    const saved = await fs.promises.readFile(launchedPaths[0]);
    expect(saved.equals(installerPayload)).toBe(true);
    expect(observedStates).toContain('downloading');
    expect(observedStates).toContain('downloaded');
  });
});

