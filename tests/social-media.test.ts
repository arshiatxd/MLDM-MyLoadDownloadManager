import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserBridgeServer } from '../src/main/bridge';
import { DownloadManager } from '../src/main/download-manager';
import { LogManager } from '../src/main/logger';
import {
  detectPrivateError,
  normalizeYtDlpMetadata,
  parseCustomPageHtml,
  parseInstagramEmbedHtml,
  parseSpotifyEmbedHtml,
  parseTikTokRehydrationHtml,
  validatePlatformUrl,
} from '../src/main/social-parsers';
import { StateStore } from '../src/main/store';
import { createZipArchive } from '../src/main/zip-builder';
import { createDefaultSettings } from '../src/shared/constants';
import type {
  BrowserInterceptPayload,
  PopupSessionData,
  SocialDownloadRequest,
  SocialScanResult,
} from '../src/shared/types';

const EXT_HEADERS = {
  'Content-Type': 'application/json',
  Origin: 'chrome-extension://abcdefghijklmnop',
  'X-MyLoad-Client': 'myload-extension',
};

describe('social-parsers', () => {
  it('validates platform URLs and rejects wrong hosts or non-HTTP schemes', () => {
    expect(validatePlatformUrl('youtube', 'https://music.youtube.com/watch?v=dQw4w9WgXcQ').valid).toBe(true);
    expect(validatePlatformUrl('youtube', 'https://youtu.be/dQw4w9WgXcQ').valid).toBe(true);
    expect(validatePlatformUrl('instagram', 'https://www.instagram.com/reel/ABC123/').valid).toBe(true);
    expect(validatePlatformUrl('tiktok', 'https://www.tiktok.com/@creator/video/123456').valid).toBe(true);
    expect(validatePlatformUrl('spotify', 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M').valid).toBe(true);

    expect(validatePlatformUrl('youtube', 'https://www.instagram.com/p/ABC/').valid).toBe(false);
    expect(validatePlatformUrl('spotify', 'https://example.com/track/1').valid).toBe(false);
    expect(validatePlatformUrl('tiktok', 'javascript:alert(1)').valid).toBe(false);
    expect(validatePlatformUrl('instagram', 'file:///C:/Windows/System32').valid).toBe(false);
  });

  it('detects private or restricted content errors for all four platforms', () => {
    expect(detectPrivateError('youtube', 'ERROR: Private video. Sign in if you have been granted access')).toContain('private');
    expect(detectPrivateError('instagram', '{"is_private":true,"message":"login_required"}')).toContain('private');
    expect(detectPrivateError('tiktok', '{"statusCode":10222,"privateAccount":true}')).toContain('private');
    expect(detectPrivateError('spotify', 'Sorry, this playlist is private and not found')).toContain('private');
    expect(detectPrivateError('youtube', 'Normal video title available')).toBeNull();
  });

  it('parses Spotify track metadata including album, artist, cover, and year', () => {
    const embedData = {
      props: {
        pageProps: {
          state: {
            data: {
              entity: {
                type: 'track',
                id: 'track123',
                title: 'Midnight Signal',
                artists: [{ name: 'Neon Pilot' }, { name: 'Echo' }],
                duration: 215000,
                releaseDate: { isoString: '2024-05-01T00:00:00Z' },
                coverArt: {
                  sources: [
                    { url: 'https://i.scdn.co/image/small.jpg', maxWidth: 64 },
                    { url: 'https://i.scdn.co/image/large.jpg', maxWidth: 640 },
                  ],
                },
              },
            },
          },
        },
      },
    };
    const fallbackHtml =
      '<html><head><script type="application/ld+json">' +
      JSON.stringify({ inAlbum: { name: 'Night Drive LP' } }) +
      '</script></head></html>';

    const result = parseSpotifyEmbedHtml(
      `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(embedData)}</script>`,
      'https://open.spotify.com/track/track123',
      fallbackHtml
    );

    expect(result.ok).toBe(true);
    expect(result.contentType).toBe('track');
    expect(result.title).toBe('Midnight Signal');
    expect(result.author).toBe('Neon Pilot, Echo');
    expect(result.album).toBe('Night Drive LP');
    expect(result.thumbnailUrl).toBe('https://i.scdn.co/image/large.jpg');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].artist).toBe('Neon Pilot, Echo');
    expect(result.items[0].album).toBe('Night Drive LP');
    expect(result.items[0].releaseYear).toBe('2024');
    expect(result.items[0].durationSeconds).toBe(215);
  });

  it('parses Spotify playlist track lists and handles missing or private embeds', () => {
    const playlistEmbed = {
      props: {
        pageProps: {
          state: {
            data: {
              entity: {
                type: 'playlist',
                title: 'Road Trip Mix',
                coverArt: {
                  sources: [{ url: 'https://i.scdn.co/image/playlist.jpg', maxWidth: 640 }],
                },
                trackList: [
                  { title: 'First Gear', subtitle: 'Artist One', duration: 180000, uri: 'spotify:track:1' },
                  { title: 'Highway Lights', subtitle: 'Artist Two', duration: 200000, uri: 'spotify:track:2' },
                ],
              },
            },
          },
        },
      },
    };

    const playlistRes = parseSpotifyEmbedHtml(
      `<script id="__NEXT_DATA__">${JSON.stringify(playlistEmbed)}</script>`,
      'https://open.spotify.com/playlist/pl123'
    );
    expect(playlistRes.ok).toBe(true);
    expect(playlistRes.contentType).toBe('playlist');
    expect(playlistRes.items).toHaveLength(2);
    expect(playlistRes.items[0]).toMatchObject({
      title: 'First Gear',
      artist: 'Artist One',
      album: 'Road Trip Mix',
      trackNumber: 1,
      totalTracks: 2,
      thumbnailUrl: 'https://i.scdn.co/image/playlist.jpg',
    });
    expect(playlistRes.items[1].trackNumber).toBe(2);

    const missingRes = parseSpotifyEmbedHtml('<html><body>No data</body></html>', 'https://open.spotify.com/playlist/private');
    expect(missingRes.ok).toBe(false);
    expect(missingRes.isPrivate).toBe(true);
  });

  it('parses Instagram mixed carousel slides and detects private accounts', () => {
    const payload = {
      gql_data: {
        shortcode_media: {
          edge_sidecar_to_children: {
            edges: [
              {
                node: {
                  is_video: false,
                  display_url: 'https://cdn.example.com/slide1.jpg',
                },
              },
              {
                node: {
                  is_video: true,
                  video_url: 'https://cdn.example.com/slide2.mp4',
                  display_url: 'https://cdn.example.com/slide2-thumb.jpg',
                },
              },
            ],
          },
        },
      },
    };
    const html = `<script>"username":"traveler"</script><script>${JSON.stringify(payload)}</script>`;

    const result = parseInstagramEmbedHtml(html, 'https://www.instagram.com/p/Carousel1/');
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(true);
    expect(result?.contentType).toBe('carousel');
    expect(result?.items).toHaveLength(2);
    expect(result?.items[0]).toMatchObject({
      kind: 'image',
      mediaUrl: 'https://cdn.example.com/slide1.jpg',
      ext: 'jpg',
    });
    expect(result?.items[1]).toMatchObject({
      kind: 'video',
      mediaUrl: 'https://cdn.example.com/slide2.mp4',
      thumbnailUrl: 'https://cdn.example.com/slide2-thumb.jpg',
      ext: 'mp4',
    });

    const priv = parseInstagramEmbedHtml('<html><body>This account is private</body></html>', 'https://www.instagram.com/p/Priv1/');
    expect(priv?.ok).toBe(false);
    expect(priv?.isPrivate).toBe(true);
  });

  it('parses TikTok multi-slide photo posts and detects private status codes', () => {
    const rehydration = {
      __DEFAULT_SCOPE__: {
        'webapp.video-detail': {
          statusCode: 0,
          itemInfo: {
            itemStruct: {
              desc: 'Tokyo Walk',
              author: { uniqueId: 'tokyowalker' },
              imagePost: {
                images: [
                  { imageURL: { urlList: ['https://cdn.example.com/tt1.jpg'] } },
                  { imageURL: { urlList: ['https://cdn.example.com/tt2.jpg'] } },
                ],
              },
            },
          },
        },
      },
    };
    const html = `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">${JSON.stringify(rehydration)}</script>`;

    const result = parseTikTokRehydrationHtml(html, 'https://www.tiktok.com/@tokyowalker/photo/999');
    expect(result?.ok).toBe(true);
    expect(result?.contentType).toBe('carousel');
    expect(result?.author).toBe('tokyowalker');
    expect(result?.items).toHaveLength(2);
    expect(result?.items[0].mediaUrl).toBe('https://cdn.example.com/tt1.jpg');
    expect(result?.items[1].mediaUrl).toBe('https://cdn.example.com/tt2.jpg');

    const privateData = {
      __DEFAULT_SCOPE__: {
        'webapp.video-detail': {
          statusCode: 10222,
        },
      },
    };
    const privRes = parseTikTokRehydrationHtml(
      `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">${JSON.stringify(privateData)}</script>`,
      'https://www.tiktok.com/@priv/video/111'
    );
    expect(privRes?.ok).toBe(false);
    expect(privRes?.isPrivate).toBe(true);
  });

  it('normalizes yt-dlp metadata for YouTube Music, YouTube Video, and carousels', () => {
    const musicRes = normalizeYtDlpMetadata(
      'youtube',
      {
        id: 'ytm1',
        track: 'Analog Dreams',
        artist: 'Synth Wave',
        album: 'Retrowave',
        duration: 204.2,
        thumbnail: 'https://i.ytimg.com/vi/ytm1/maxresdefault.jpg',
      },
      'https://music.youtube.com/watch?v=ytm1'
    );
    expect(musicRes.contentType).toBe('music');
    expect(musicRes.items[0]).toMatchObject({
      kind: 'audio',
      ext: 'mp3',
      artist: 'Synth Wave',
      album: 'Retrowave',
      durationSeconds: 204,
    });

    const videoRes = normalizeYtDlpMetadata(
      'youtube',
      {
        id: 'ytv1',
        title: 'Demo Video',
        uploader: 'Channel One',
        duration: 95,
        ext: 'webm',
      },
      'https://www.youtube.com/watch?v=ytv1'
    );
    expect(videoRes.contentType).toBe('video');
    expect(videoRes.items[0].kind).toBe('video');

    const carouselRes = normalizeYtDlpMetadata(
      'instagram',
      {
        title: 'Album Set',
        entries: [
          { id: 's1', ext: 'jpg', url: 'https://cdn.example.com/a.jpg' },
          { id: 's2', ext: 'mp4', url: 'https://cdn.example.com/b.mp4' },
        ],
      },
      'https://www.instagram.com/p/Multi1/'
    );
    expect(carouselRes.contentType).toBe('carousel');
    expect(carouselRes.items).toHaveLength(2);
    expect(carouselRes.items[0].kind).toBe('image');
    expect(carouselRes.items[1].kind).toBe('video');
  });
});

describe('zip-builder', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
    );
  });

  it('writes a valid PKZIP archive and deduplicates colliding entry names', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'myload-zip-test-'));
    tempDirs.push(tmpDir);

    const fileA = path.join(tmpDir, 'a.txt');
    const fileB = path.join(tmpDir, 'b.txt');
    await fs.writeFile(fileA, 'First track audio bytes');
    await fs.writeFile(fileB, 'Second track audio bytes');

    const outZip = path.join(tmpDir, 'playlist.zip');
    const bytesWritten = await createZipArchive(
      [
        { name: '01 - Song.mp3', filePath: fileA },
        { name: '01 - Song.mp3', filePath: fileB },
      ],
      outZip
    );

    const buf = await fs.readFile(outZip);
    expect(bytesWritten).toBe(buf.length);
    expect(buf.readUInt32LE(0)).toBe(0x04034b50);
    expect(buf.includes(Buffer.from('01 - Song.mp3', 'utf8'))).toBe(true);
    expect(buf.includes(Buffer.from('01 - Song (1).mp3', 'utf8'))).toBe(true);
    expect(buf.includes(Buffer.from([0x50, 0x4b, 0x01, 0x02]))).toBe(true);
    expect(buf.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]))).toBe(true);
  });
});

describe('BrowserBridgeServer media endpoints', () => {
  const servers: BrowserBridgeServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.stop()));
  });

  it('handles /api/v1/media/scan and /api/v1/media/download with strict origin guards', async () => {
    const scanMock = vi.fn(
      async (platform: string, url: string): Promise<SocialScanResult> => ({
        ok: true,
        platform: platform as SocialScanResult['platform'],
        contentType: 'video',
        url,
        title: 'Sample Clip',
        items: [
          {
            id: 'item-1',
            index: 0,
            kind: 'video',
            title: 'Sample Clip',
            sourceUrl: url,
            ext: 'mp4',
          },
        ],
      })
    );
    const downloadMock = vi.fn(async (_req: SocialDownloadRequest) => ({
      ok: true,
      count: 1,
    }));

    const server = new BrowserBridgeServer(new LogManager(null), {
      getHealth: () => ({ activeCount: 0, totalDownloadSpeed: 0, showConfirmationDialog: true }),
      onFocusWindow: () => undefined,
      onIntercept: async () => 'started',
      onMediaScan: scanMock,
      onMediaDownload: downloadMock,
    });
    servers.push(server);

    const status = await server.start(19766);
    expect(status.running).toBe(true);
    const port = status.port;

    const badOrigin = await fetch(`http://127.0.0.1:${port}/api/v1/media/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.example.com',
        'X-MyLoad-Client': 'myload-extension',
      },
      body: JSON.stringify({ platform: 'youtube', url: 'https://www.youtube.com/watch?v=123' }),
    });
    expect(badOrigin.status).toBe(403);

    const invalidPlatform = await fetch(`http://127.0.0.1:${port}/api/v1/media/scan`, {
      method: 'POST',
      headers: EXT_HEADERS,
      body: JSON.stringify({ platform: 'vimeo', url: 'https://vimeo.com/123' }),
    });
    expect(invalidPlatform.status).toBe(400);

    const scanOk = await fetch(`http://127.0.0.1:${port}/api/v1/media/scan`, {
      method: 'POST',
      headers: EXT_HEADERS,
      body: JSON.stringify({ platform: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
    });
    expect(scanOk.status).toBe(200);
    const scanJson = (await scanOk.json()) as SocialScanResult;
    expect(scanJson.ok).toBe(true);
    expect(scanMock).toHaveBeenCalledWith('youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    const dlOk = await fetch(`http://127.0.0.1:${port}/api/v1/media/download`, {
      method: 'POST',
      headers: EXT_HEADERS,
      body: JSON.stringify({
        platform: 'youtube',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        title: 'Sample Clip',
        format: 'mp4',
        quality: '1080p',
        items: scanJson.items,
      }),
    });
    expect(dlOk.status).toBe(200);
    const dlJson = (await dlOk.json()) as { ok: boolean; count: number };
    expect(dlJson).toEqual({ ok: true, count: 1 });
    expect(downloadMock).toHaveBeenCalledTimes(1);

    const customScan = await fetch(`http://127.0.0.1:${port}/api/v1/media/scan`, {
      method: 'POST',
      headers: EXT_HEADERS,
      body: JSON.stringify({ platform: 'custom', url: 'https://example.org/showcase' }),
    });
    expect(customScan.status).toBe(200);
    expect(scanMock).toHaveBeenCalledWith('custom', 'https://example.org/showcase');
  });
});

describe('custom URL scanner', () => {
  it('validates custom URLs and blocks loopback or private network hosts', () => {
    expect(validatePlatformUrl('custom', 'https://media.example.org/watch/clip').valid).toBe(true);
    expect(validatePlatformUrl('custom', 'http://localhost:8080/video').valid).toBe(false);
    expect(validatePlatformUrl('custom', 'http://127.0.0.1:49173/health').valid).toBe(false);
    expect(validatePlatformUrl('custom', 'http://192.168.1.5/nas.mp4').valid).toBe(false);
    expect(validatePlatformUrl('custom', 'http://169.254.169.254/latest/meta-data').valid).toBe(false);
    expect(validatePlatformUrl('custom', 'http://[::1]/local').valid).toBe(false);
    expect(validatePlatformUrl('custom', 'http://[::ffff:127.0.0.1]/local').valid).toBe(false);
    expect(validatePlatformUrl('custom', 'file:///C:/secret.mp4').valid).toBe(false);
  });

  it('detects DRM, CAPTCHA, and login walls on custom URLs', () => {
    expect(detectPrivateError('custom', 'Error: This video is DRM protected (Widevine)')).toContain(
      'DRM-protected'
    );
    expect(
      detectPrivateError('custom', '<div class="cf-turnstile" data-sitekey="abc"></div>')
    ).toContain('CAPTCHA');
    expect(
      detectPrivateError('custom', 'Please sign in to access this private collection')
    ).toContain('private');
  });

  it('extracts public video, audio, direct links, and images while filtering noise', () => {
    const html = `
      <!doctype html>
      <html>
        <head>
          <title>Indie Film Preview</title>
          <link rel="icon" href="/favicon.ico" />
          <meta property="og:video" content="https://cdn.example.org/videos/hero-trailer.mp4" />
        </head>
        <body>
          <video controls>
            <source src="/media/behind-scenes.webm" type="video/webm" />
            <source src="https://cdn.example.org/videos/hero-trailer.mp4" type="video/mp4" />
          </video>
          <audio src="https://cdn.example.org/audio/soundtrack.mp3"></audio>
          <a href="/downloads/bonus-track.flac">Bonus Track FLAC</a>
          <img src="/assets/poster-wide.jpg" alt="Main Poster" width="1280" height="720" />
          <img src="data:image/png;base64,AAA" width="32" height="32" />
          <img src="/assets/logo-tiny.png" width="24" height="24" />
        </body>
      </html>
    `;

    const res = parseCustomPageHtml(html, 'https://example.org/projects/indie-film');
    expect(res.ok).toBe(true);
    expect(res.platform).toBe('custom');
    expect(res.title).toBe('Indie Film Preview');
    const urls = res.items.map((it) => it.mediaUrl);
    expect(urls).toContain('https://cdn.example.org/videos/hero-trailer.mp4');
    expect(urls).toContain('https://example.org/media/behind-scenes.webm');
    expect(urls).toContain('https://cdn.example.org/audio/soundtrack.mp3');
    expect(urls).toContain('https://example.org/downloads/bonus-track.flac');
    expect(urls).toContain('https://example.org/assets/poster-wide.jpg');
    expect(urls.filter((u) => u === 'https://cdn.example.org/videos/hero-trailer.mp4')).toHaveLength(
      1
    );
    expect(urls.some((u) => u?.includes('favicon') || u?.startsWith('data:') || u?.includes('logo-tiny'))).toBe(
      false
    );
  });
});

describe('DownloadManager social media confirmation workflow', () => {
  const managers: DownloadManager[] = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(managers.splice(0).map((m) => m.shutdown()));
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
    );
  });

  it('opens confirmation popup instead of auto-starting social media downloads', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'myload-social-confirm-'));
    tempDirs.push(tmpDir);
    const defaultDir = path.join(tmpDir, 'Downloads');
    const customDir = path.join(tmpDir, 'Videos');
    await fs.mkdir(defaultDir, { recursive: true });
    await fs.mkdir(customDir, { recursive: true });

    const statePath = path.join(tmpDir, 'state.json');
    const seedStore = new StateStore(statePath, defaultDir);
    await seedStore.save([], {
      ...createDefaultSettings(defaultDir),
      browserBridgeEnabled: true,
      browserBridgePort: 19767,
      useCompactDownloadPopup: true,
      autoDownloadOnClick: true,
      showConfirmationDialog: true,
    });

    const compactCalls: Array<Omit<PopupSessionData, 'sessionId'>> = [];
    const interceptCalls: BrowserInterceptPayload[] = [];
    const focusCalls = vi.fn();

    const manager = new DownloadManager({
      stateFilePath: statePath,
      logFilePath: null,
      defaultDownloadDir: defaultDir,
      appVersion: '1.0.1',
      enableBridge: true,
      powerAdapter: {
        startSleepBlocker: () => 1,
        stopSleepBlocker: () => undefined,
        executeSystemAction: async () => undefined,
      },
      callbacks: {
        onOpenCompactPopup: (data) => compactCalls.push(data),
        onBrowserIntercept: (payload) => interceptCalls.push(payload),
        onFocusRequested: focusCalls,
      },
    });
    managers.push(manager);
    manager.start();

    const deadline = Date.now() + 2500;
    while (!manager.getBridgeStatus().running && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(manager.getBridgeStatus().running).toBe(true);

    const bridgePort = manager.getBridgeStatus().port;
    const reqBody: SocialDownloadRequest = {
      platform: 'youtube',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Sample Clip',
      format: 'mp4',
      quality: '1080p',
      items: [
        {
          id: 'item-1',
          index: 0,
          kind: 'video',
          title: 'Sample Clip',
          sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          ext: 'mp4',
        },
      ],
    };

    const compactRes = await fetch(`http://127.0.0.1:${bridgePort}/api/v1/media/download`, {
      method: 'POST',
      headers: EXT_HEADERS,
      body: JSON.stringify(reqBody),
    });
    expect(compactRes.status).toBe(200);
    const compactJson = (await compactRes.json()) as {
      ok: boolean;
      count: number;
      mode?: string;
    };
    expect(compactJson).toEqual({ ok: true, count: 1, mode: 'confirm' });
    expect(compactCalls).toHaveLength(1);
    expect(compactCalls[0].mode).toBe('confirm');
    expect(compactCalls[0].socialRequest?.fileName).toBe('Sample Clip.mp4');
    expect(manager.getSnapshot().downloads).toHaveLength(0);

    manager.updateSettings({ useCompactDownloadPopup: false });
    const modalRes = await fetch(`http://127.0.0.1:${bridgePort}/api/v1/media/download`, {
      method: 'POST',
      headers: EXT_HEADERS,
      body: JSON.stringify(reqBody),
    });
    expect(modalRes.status).toBe(200);
    expect(focusCalls).toHaveBeenCalledTimes(1);
    expect(interceptCalls).toHaveLength(1);
    expect(interceptCalls[0].socialRequest?.fileName).toBe('Sample Clip.mp4');
    expect(manager.getSnapshot().downloads).toHaveLength(0);

    const added = await manager.addSocialDownload({
      ...compactCalls[0].socialRequest!,
      saveDir: customDir,
      fileName: 'Custom Video.mp4',
      startPaused: true,
    });
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      kind: 'media',
      status: 'paused',
      name: 'Custom Video.mp4',
      saveDir: customDir,
      filePath: path.join(customDir, 'Custom Video.mp4'),
    });
  });
});

