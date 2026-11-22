import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserBridgeServer } from '../src/main/bridge';
import { LogManager } from '../src/main/logger';
import {
  detectPrivateError,
  normalizeYtDlpMetadata,
  parseInstagramEmbedHtml,
  parseSpotifyEmbedHtml,
  parseTikTokRehydrationHtml,
  validatePlatformUrl,
} from '../src/main/social-parsers';
import { createZipArchive } from '../src/main/zip-builder';
import type { SocialDownloadRequest, SocialScanResult } from '../src/shared/types';

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
  });
});

