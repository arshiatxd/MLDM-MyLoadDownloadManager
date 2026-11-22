import net from 'node:net';
import { isHttpUrl } from '../shared/constants';
import type {
  SocialMediaItem,
  SocialPlatform,
  SocialScanResult,
} from '../shared/types';

const PLATFORM_HOSTS: Record<Exclude<SocialPlatform, 'custom'>, Set<string>> = {
  youtube: new Set([
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'music.youtube.com',
    'youtu.be',
  ]),
  instagram: new Set([
    'instagram.com',
    'www.instagram.com',
    'm.instagram.com',
    'instagr.am',
    'www.instagr.am',
  ]),
  tiktok: new Set([
    'tiktok.com',
    'www.tiktok.com',
    'm.tiktok.com',
    'vm.tiktok.com',
    'vt.tiktok.com',
  ]),
  spotify: new Set([
    'open.spotify.com',
    'play.spotify.com',
    'spotify.link',
    'spotify.app.link',
  ]),
};

const PLATFORM_DISPLAY: Record<SocialPlatform, string> = {
  youtube: 'YouTube',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  spotify: 'Spotify',
  custom: 'Custom URL',
};

function isPrivateIpv4Tuple(a: number, b: number): boolean {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224) return true;
  return false;
}

export function isPrivateIpAddress(rawIp: string): boolean {
  let ip = (rawIp || '').trim().toLowerCase();
  const zoneIdx = ip.indexOf('%');
  if (zoneIdx >= 0) ip = ip.slice(0, zoneIdx);
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);

  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    return parts.length !== 4 || isPrivateIpv4Tuple(parts[0], parts[1]);
  }

  if (net.isIPv6(ip)) {
    if (ip === '::' || ip === '::1') return true;
    const v4Mapped = ip.match(/^::ffff:(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (v4Mapped) {
      return isPrivateIpv4Tuple(Number(v4Mapped[1]), Number(v4Mapped[2]));
    }
    const v4HexMapped = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (v4HexMapped) {
      const hi = parseInt(v4HexMapped[1], 16);
      return isPrivateIpv4Tuple((hi >> 8) & 0xff, hi & 0xff);
    }
    const firstWordMatch = ip.match(/^([0-9a-f]{1,4}):/);
    if (firstWordMatch) {
      const firstWord = parseInt(firstWordMatch[1], 16);
      if ((firstWord & 0xfe00) === 0xfc00) return true;
      if ((firstWord & 0xffc0) === 0xfe80) return true;
      if ((firstWord & 0xff00) === 0xff00) return true;
    }
    return false;
  }

  return false;
}

export function isPrivateOrLocalHost(hostname: string): boolean {
  let clean = (hostname || '').trim().toLowerCase().replace(/\.+$/, '');
  if (clean.startsWith('[') && clean.endsWith(']')) {
    clean = clean.slice(1, -1);
  }
  if (!clean) return true;
  if (
    clean === 'localhost' ||
    clean.endsWith('.localhost') ||
    clean.endsWith('.local') ||
    clean.endsWith('.internal') ||
    clean.endsWith('.home.arpa')
  ) {
    return true;
  }
  if (net.isIP(clean)) {
    return isPrivateIpAddress(clean);
  }
  if (!clean.includes('.')) {
    return true;
  }
  return false;
}

export function validatePlatformUrl(
  platform: SocialPlatform,
  rawUrl: string
): { valid: boolean; normalizedUrl?: string; error?: string } {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed || !isHttpUrl(trimmed)) {
    return { valid: false, error: `Please enter a valid ${PLATFORM_DISPLAY[platform]} URL.` };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: `Invalid ${PLATFORM_DISPLAY[platform]} URL.` };
  }
  const host = parsed.hostname.toLowerCase();
  if (platform === 'custom') {
    if (isPrivateOrLocalHost(host)) {
      return { valid: false, error: 'Local and private network URLs cannot be scanned.' };
    }
    return { valid: true, normalizedUrl: parsed.toString() };
  }
  if (!PLATFORM_HOSTS[platform]?.has(host)) {
    return {
      valid: false,
      error: `That URL does not belong to ${PLATFORM_DISPLAY[platform]}.`,
    };
  }
  return { valid: true, normalizedUrl: parsed.toString() };
}

export function detectPrivateError(platform: SocialPlatform, text: string): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  const label = PLATFORM_DISPLAY[platform];

  if (platform === 'youtube') {
    if (
      /private video|this video is private|join this channel to get access|members[- ]only|sign in to confirm your age/i.test(
        text
      )
    ) {
      return `This ${label} video is private or restricted and cannot be downloaded.`;
    }
    if (/video unavailable|this video has been removed/i.test(lower)) {
      return `This ${label} video is unavailable or has been removed.`;
    }
  }

  if (platform === 'instagram') {
    if (
      /this account is private|"is_private"\s*:\s*true|login_required|log in to instagram|checkpoint_required|requested page cannot be found|sorry, this page isn't available/i.test(
        text
      )
    ) {
      return 'This Instagram post or account is private or requires login and cannot be downloaded.';
    }
  }

  if (platform === 'tiktok') {
    if (
      /"privateaccount"\s*:\s*true|"issecret"\s*:\s*true|"privateitem"\s*:\s*true|"statuscode"\s*:\s*(?:10222|10221)|account is private|this video is private|log in to watch/i.test(
        text
      )
    ) {
      return 'This TikTok post or account is private and cannot be downloaded.';
    }
    if (/"statuscode"\s*:\s*10204|video is currently unavailable|couldn't find this video/i.test(text)) {
      return 'This TikTok post is unavailable or has been deleted.';
    }
  }

  if (/drm protected|drm-protected|widevine|playready|fairplay|encrypted media/i.test(text)) {
    return 'This media is DRM-protected and cannot be downloaded.';
  }

  if (platform === 'spotify') {
    if (
      /private playlist|couldn't find that playlist|page not found|unavailable in your country|not found/i.test(
        lower
      )
    ) {
      return 'This Spotify track, album, or playlist is private or unavailable.';
    }
  }

  if (platform === 'custom') {
    if (
      /cf-turnstile|challenges\.cloudflare\.com|class=["'][^"']*g-recaptcha[^"']*["']|data-sitekey[^>]+recaptcha|h-captcha|verify you are human|attention required!\s*\|\s*cloudflare/i.test(
        text
      )
    ) {
      return 'This page is protected by an anti-bot or CAPTCHA check and cannot be scanned automatically.';
    }
    if (
      /login[_-]required|sign in to (?:view|watch|access|continue|download)|you must (?:be logged|log) in to|this (?:page|video|post|file|content|media) is private|members[- ]only/i.test(
        text
      )
    ) {
      return 'This page is private or requires login and cannot be scanned.';
    }
  }

  return null;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)));
}

function extractMetaTag(html: string, nameOrProp: string): string | undefined {
  const escaped = nameOrProp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re1 = new RegExp(
    `<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']*)["']`,
    'i'
  );
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${escaped}["']`,
    'i'
  );
  const m = html.match(re1) || html.match(re2);
  return m?.[1] ? decodeHtmlEntities(m[1]).trim() : undefined;
}

function pickBestCoverUrl(coverContainer: unknown): string | undefined {
  if (!coverContainer || typeof coverContainer !== 'object') return undefined;
  const obj = coverContainer as Record<string, unknown>;
  const sources = Array.isArray(obj.sources) ? obj.sources : [];
  let bestUrl: string | undefined;
  let bestWidth = -1;
  for (const s of sources) {
    if (!s || typeof s !== 'object') continue;
    const item = s as Record<string, unknown>;
    const url = typeof item.url === 'string' ? item.url : '';
    const w = typeof item.maxWidth === 'number' ? item.maxWidth : typeof item.width === 'number' ? item.width : 0;
    if (url && w >= bestWidth) {
      bestWidth = w;
      bestUrl = url;
    }
  }
  return bestUrl;
}

function extractSpotifyExtraMeta(fallbackHtml?: string): {
  album?: string;
  artist?: string;
  releaseYear?: string;
  coverUrl?: string;
} {
  if (!fallbackHtml) return {};
  const albumDesc = extractMetaTag(fallbackHtml, 'og:description');
  const coverUrl = extractMetaTag(fallbackHtml, 'og:image');
  let album: string | undefined;
  let artist: string | undefined;
  let releaseYear: string | undefined;

  const releaseDate = extractMetaTag(fallbackHtml, 'music:release_date');
  if (releaseDate) {
    const y = releaseDate.match(/^(\d{4})/);
    if (y) releaseYear = y[1];
  }

  const ldMatches = fallbackHtml.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const m of ldMatches) {
    try {
      const ld = JSON.parse(m[1]) as Record<string, unknown>;
      const inAlbum = ld.inAlbum as Record<string, unknown> | undefined;
      if (inAlbum && typeof inAlbum.name === 'string' && inAlbum.name.trim()) {
        album = inAlbum.name.trim();
      }
      const byArtist = ld.byArtist as Array<Record<string, unknown>> | Record<string, unknown> | undefined;
      if (Array.isArray(byArtist)) {
        const names = byArtist
          .map((a) => (typeof a?.name === 'string' ? a.name.trim() : ''))
          .filter(Boolean);
        if (names.length > 0) artist = names.join(', ');
      } else if (byArtist && typeof byArtist.name === 'string' && byArtist.name.trim()) {
        artist = byArtist.name.trim();
      }
      if (!releaseYear && typeof ld.datePublished === 'string') {
        const y = ld.datePublished.match(/(\d{4})/);
        if (y) releaseYear = y[1];
      }
    } catch {
    }
  }

  if (!album && albumDesc) {
    const parts = albumDesc.split('·').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      if (!artist) artist = parts[0];
      album = parts[1];
      const yMatch = parts[parts.length - 1]?.match(/\b(19\d{2}|20\d{2})\b/);
      if (!releaseYear && yMatch) releaseYear = yMatch[1];
    }
  }

  return { album, artist, releaseYear, coverUrl };
}

function findSpotifyEntity(obj: unknown, depth = 0): Record<string, unknown> | null {
  if (!obj || typeof obj !== 'object' || depth > 8) return null;
  const rec = obj as Record<string, unknown>;
  if (
    typeof rec.type === 'string' &&
    ['track', 'album', 'playlist'].includes(rec.type) &&
    (typeof rec.name === 'string' || typeof rec.title === 'string' || Array.isArray(rec.trackList))
  ) {
    return rec;
  }
  if (rec.entity && typeof rec.entity === 'object') {
    const found = findSpotifyEntity(rec.entity, depth + 1);
    if (found) return found;
  }
  for (const val of Object.values(rec)) {
    if (val && typeof val === 'object') {
      const found = findSpotifyEntity(val, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

export function parseSpotifyEmbedHtml(
  html: string,
  sourceUrl: string,
  fallbackPageHtml?: string
): SocialScanResult {
  const nextMatch = html.match(
    /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (!nextMatch) {
    return {
      ok: false,
      platform: 'spotify',
      contentType: 'track',
      url: sourceUrl,
      title: 'Spotify',
      items: [],
      isPrivate: true,
      error: 'This Spotify track, album, or playlist is private or unavailable.',
    };
  }

  let entity: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(nextMatch[1]) as Record<string, unknown>;
    entity = findSpotifyEntity(parsed);
  } catch {
    entity = null;
  }

  if (!entity) {
    return {
      ok: false,
      platform: 'spotify',
      contentType: 'track',
      url: sourceUrl,
      title: 'Spotify',
      items: [],
      isPrivate: true,
      error: 'This Spotify track, album, or playlist is private or unavailable.',
    };
  }

  const entityType = String(entity.type || 'track') as 'track' | 'album' | 'playlist';
  const extra = extractSpotifyExtraMeta(fallbackPageHtml);

  const entityTitle = String(entity.title || entity.name || extra.album || 'Spotify Media').trim();
  const artistsArr = Array.isArray(entity.artists) ? entity.artists : [];
  const entityArtists = artistsArr
    .map((a) =>
      a && typeof a === 'object' && typeof (a as Record<string, unknown>).name === 'string'
        ? String((a as Record<string, unknown>).name).trim()
        : ''
    )
    .filter(Boolean)
    .join(', ');

  const subtitle = typeof entity.subtitle === 'string' ? entity.subtitle.trim() : '';
  const coverUrl =
    pickBestCoverUrl(entity.coverArt) ||
    pickBestCoverUrl(
      (entity.visualIdentity as Record<string, unknown> | undefined)?.image
        ? { sources: (entity.visualIdentity as Record<string, unknown>).image }
        : undefined
    ) ||
    extra.coverUrl;

  const rawReleaseDate =
    entity.releaseDate && typeof entity.releaseDate === 'object'
      ? String((entity.releaseDate as Record<string, unknown>).isoString || '')
      : '';
  const entityYear =
    (rawReleaseDate.match(/^(\d{4})/) || [])[1] || extra.releaseYear;

  if (entityType === 'track') {
    const durationMs = typeof entity.duration === 'number' ? entity.duration : null;
    const durationSeconds = durationMs ? Math.round(durationMs / 1000) : null;
    const artist = entityArtists || extra.artist || subtitle || 'Unknown Artist';
    const album =
      (entity.album && typeof entity.album === 'object' && typeof (entity.album as Record<string, unknown>).name === 'string'
        ? String((entity.album as Record<string, unknown>).name).trim()
        : undefined) ||
      extra.album ||
      entityTitle;

    const trackItem: SocialMediaItem = {
      id: String(entity.id || entity.uri || 'track-1'),
      index: 0,
      kind: 'audio',
      title: entityTitle,
      artist,
      album,
      releaseYear: entityYear,
      durationSeconds,
      thumbnailUrl: coverUrl,
      sourceUrl,
      ext: 'mp3',
      trackNumber: 1,
      totalTracks: 1,
    };

    return {
      ok: true,
      platform: 'spotify',
      contentType: 'track',
      url: sourceUrl,
      title: entityTitle,
      author: artist,
      album,
      thumbnailUrl: coverUrl,
      durationSeconds,
      items: [trackItem],
    };
  }

  const rawTrackList = Array.isArray(entity.trackList) ? entity.trackList : [];
  if (rawTrackList.length === 0) {
    return {
      ok: false,
      platform: 'spotify',
      contentType: entityType,
      url: sourceUrl,
      title: entityTitle,
      items: [],
      isPrivate: true,
      error: `This Spotify ${entityType} is private or has no accessible tracks.`,
    };
  }

  const author =
    entityArtists ||
    subtitle.replace(/^(?:Album|Playlist|Single)\s*[·•-]\s*/i, '').trim() ||
    'Spotify';
  const albumTitle = entityType === 'album' ? entityTitle : undefined;
  const totalTracks = rawTrackList.length;

  const items: SocialMediaItem[] = rawTrackList
    .map((entry, idx) => {
      if (!entry || typeof entry !== 'object') return null;
      const t = entry as Record<string, unknown>;
      const tTitle = String(t.title || t.name || `Track ${idx + 1}`).trim();
      const tSubtitle = typeof t.subtitle === 'string' ? t.subtitle.trim() : '';
      const tArtist = tSubtitle || author;
      const tDurationMs = typeof t.duration === 'number' ? t.duration : null;
      const tDuration = tDurationMs ? Math.round(tDurationMs / 1000) : null;
      const itemUri = typeof t.uri === 'string' ? t.uri : '';
      const uriMatch = itemUri.match(/spotify:track:([a-zA-Z0-9]+)/);
      const itemSourceUrl = uriMatch
        ? `https://open.spotify.com/track/${uriMatch[1]}`
        : sourceUrl;

      const item: SocialMediaItem = {
        id: uriMatch?.[1] || `track-${idx + 1}`,
        index: idx,
        kind: 'audio',
        title: tTitle,
        artist: tArtist,
        album: albumTitle || (typeof t.albumName === 'string' ? t.albumName : entityTitle),
        releaseYear: entityYear,
        durationSeconds: tDuration,
        thumbnailUrl: pickBestCoverUrl(t.coverArt) || coverUrl,
        sourceUrl: itemSourceUrl,
        ext: 'mp3',
        trackNumber: idx + 1,
        totalTracks,
      };
      return item;
    })
    .filter((x): x is SocialMediaItem => Boolean(x));

  return {
    ok: true,
    platform: 'spotify',
    contentType: entityType,
    url: sourceUrl,
    title: entityTitle,
    author,
    album: albumTitle,
    thumbnailUrl: coverUrl,
    items,
  };
}

function unescapeJsonUrl(raw: string): string {
  return raw
    .replace(/\\u0026/gi, '&')
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&');
}

function findInstagramMediaNode(obj: unknown, depth = 0): Record<string, unknown> | null {
  if (!obj || typeof obj !== 'object' || depth > 10) return null;
  const rec = obj as Record<string, unknown>;
  if (
    rec.edge_sidecar_to_children ||
    Array.isArray(rec.carousel_media) ||
    typeof rec.video_url === 'string' ||
    typeof rec.display_url === 'string'
  ) {
    return rec;
  }
  for (const val of Object.values(rec)) {
    if (val && typeof val === 'object') {
      const found = findInstagramMediaNode(val, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

export function parseInstagramEmbedHtml(
  html: string,
  sourceUrl: string
): SocialScanResult | null {
  const privErr = detectPrivateError('instagram', html);
  if (privErr) {
    return {
      ok: false,
      platform: 'instagram',
      contentType: 'post',
      url: sourceUrl,
      title: 'Instagram',
      items: [],
      isPrivate: true,
      error: privErr,
    };
  }

  const authorMatch =
    html.match(/"username"\s*:\s*"([^"]+)"/) ||
    html.match(/class=["'][^"']*UsernameText[^"']*["'][^>]*>([^<]+)</i);
  const author = authorMatch?.[1]?.trim();

  const caption =
    extractMetaTag(html, 'og:title') ||
    (author ? `Instagram post by @${author}` : 'Instagram Post');

  const items: SocialMediaItem[] = [];
  const seenUrls = new Set<string>();

  const pushSlide = (
    kind: 'image' | 'video',
    rawMediaUrl: string,
    rawThumb?: string
  ) => {
    const cleanUrl = unescapeJsonUrl(rawMediaUrl).trim();
    if (!cleanUrl || !isHttpUrl(cleanUrl) || seenUrls.has(cleanUrl)) return;
    seenUrls.add(cleanUrl);
    const thumb = rawThumb ? unescapeJsonUrl(rawThumb).trim() : kind === 'image' ? cleanUrl : undefined;
    const idx = items.length;
    items.push({
      id: `ig-${idx + 1}`,
      index: idx,
      kind,
      title: `${author ? `@${author} ` : ''}Slide ${idx + 1}`,
      artist: author,
      thumbnailUrl: thumb,
      mediaUrl: cleanUrl,
      sourceUrl,
      ext: kind === 'video' ? 'mp4' : 'jpg',
    });
  };

  const jsonScriptMatches = html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of jsonScriptMatches) {
    const body = m[1];
    if (!body || (!body.includes('shortcode_media') && !body.includes('edge_sidecar_to_children') && !body.includes('carousel_media'))) {
      continue;
    }
    const gqlMatch = body.match(/(\{[\s\S]*\})/);
    if (!gqlMatch) continue;
    let node: Record<string, unknown> | null = null;
    try {
      node = findInstagramMediaNode(JSON.parse(gqlMatch[1]));
    } catch {
      const scIdx = body.indexOf('"shortcode_media"');
      if (scIdx >= 0) {
        const braceStart = body.indexOf('{', scIdx);
        if (braceStart >= 0) {
          try {
            node = findInstagramMediaNode(JSON.parse(body.slice(braceStart).replace(/;?\s*$/, '')));
          } catch {
          }
        }
      }
    }
    if (!node) continue;

    const sidecar = node.edge_sidecar_to_children as { edges?: Array<{ node?: Record<string, unknown> }> } | undefined;
    if (sidecar && Array.isArray(sidecar.edges) && sidecar.edges.length > 0) {
      for (const edge of sidecar.edges) {
        const child = edge?.node;
        if (!child) continue;
        const isVid = Boolean(child.is_video || child.video_url);
        const mediaUrl = isVid
          ? typeof child.video_url === 'string'
            ? child.video_url
            : ''
          : typeof child.display_url === 'string'
            ? child.display_url
            : '';
        const thumb = typeof child.display_url === 'string' ? child.display_url : undefined;
        if (mediaUrl) pushSlide(isVid ? 'video' : 'image', mediaUrl, thumb);
      }
    } else if (Array.isArray(node.carousel_media) && node.carousel_media.length > 0) {
      for (const cm of node.carousel_media) {
        if (!cm || typeof cm !== 'object') continue;
        const child = cm as Record<string, unknown>;
        const videoVersions = Array.isArray(child.video_versions)
          ? (child.video_versions as Array<Record<string, unknown>>)
          : [];
        const imgVersions = (child.image_versions2 as { candidates?: Array<Record<string, unknown>> } | undefined)
          ?.candidates;
        const thumb =
          Array.isArray(imgVersions) && typeof imgVersions[0]?.url === 'string'
            ? String(imgVersions[0].url)
            : typeof child.display_url === 'string'
              ? child.display_url
              : undefined;
        if (videoVersions.length > 0 && typeof videoVersions[0]?.url === 'string') {
          pushSlide('video', String(videoVersions[0].url), thumb);
        } else if (thumb) {
          pushSlide('image', thumb, thumb);
        }
      }
    } else {
      const isVid = Boolean(node.is_video || node.video_url);
      const vidUrl = typeof node.video_url === 'string' ? node.video_url : '';
      const imgUrl = typeof node.display_url === 'string' ? node.display_url : '';
      if (isVid && vidUrl) {
        pushSlide('video', vidUrl, imgUrl || undefined);
      } else if (imgUrl) {
        pushSlide('image', imgUrl, imgUrl);
      }
    }

    if (items.length > 0) break;
  }

  if (items.length === 0) {
    const vidRegexMatches = html.matchAll(/"video_url"\s*:\s*"([^"]+)"/g);
    for (const vm of vidRegexMatches) {
      pushSlide('video', vm[1]);
    }
    const dispRegexMatches = html.matchAll(/"display_url"\s*:\s*"([^"]+)"/g);
    for (const dm of dispRegexMatches) {
      if (items.some((i) => i.kind === 'video')) break;
      pushSlide('image', dm[1]);
    }
  }

  if (items.length === 0) {
    const ogVideo = extractMetaTag(html, 'og:video') || extractMetaTag(html, 'og:video:secure_url');
    const ogImage = extractMetaTag(html, 'og:image');
    const embedImgMatch = html.match(/<img[^>]+class=["'][^"']*EmbeddedMediaImage[^"']*["'][^>]+src=["']([^"']+)["']/i);
    if (ogVideo) {
      pushSlide('video', ogVideo, ogImage);
    } else if (embedImgMatch?.[1]) {
      pushSlide('image', decodeHtmlEntities(embedImgMatch[1]));
    } else if (ogImage) {
      pushSlide('image', ogImage);
    }
  }

  if (items.length === 0) return null;

  const isReel = /\/reel\//i.test(sourceUrl);
  return {
    ok: true,
    platform: 'instagram',
    contentType: items.length > 1 ? 'carousel' : isReel ? 'reel' : 'post',
    url: sourceUrl,
    title: caption,
    author,
    thumbnailUrl: items[0].thumbnailUrl || items[0].mediaUrl,
    items,
  };
}

export function parseTikTokRehydrationHtml(
  html: string,
  sourceUrl: string
): SocialScanResult | null {
  const privErr = detectPrivateError('tiktok', html);
  if (privErr) {
    return {
      ok: false,
      platform: 'tiktok',
      contentType: 'post',
      url: sourceUrl,
      title: 'TikTok',
      items: [],
      isPrivate: true,
      error: privErr,
    };
  }

  const rehydMatch = html.match(
    /<script[^>]+id=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (!rehydMatch) return null;

  try {
    const data = JSON.parse(rehydMatch[1]) as Record<string, unknown>;
    const scope = (data.__DEFAULT_SCOPE__ ?? {}) as Record<string, unknown>;
    const detail = (scope['webapp.video-detail'] ?? {}) as Record<string, unknown>;

    const statusCode = typeof detail.statusCode === 'number' ? detail.statusCode : 0;
    if (statusCode === 10222 || statusCode === 10221) {
      return {
        ok: false,
        platform: 'tiktok',
        contentType: 'post',
        url: sourceUrl,
        title: 'TikTok',
        items: [],
        isPrivate: true,
        error: 'This TikTok post or account is private and cannot be downloaded.',
      };
    }

    const itemInfo = detail.itemInfo as Record<string, unknown> | undefined;
    const itemStruct = (itemInfo?.itemStruct ?? null) as Record<string, unknown> | null;
    if (!itemStruct) return null;

    const authorObj = (itemStruct.author ?? {}) as Record<string, unknown>;
    if (authorObj.privateAccount === true || itemStruct.privateItem === true) {
      return {
        ok: false,
        platform: 'tiktok',
        contentType: 'post',
        url: sourceUrl,
        title: 'TikTok',
        items: [],
        isPrivate: true,
        error: 'This TikTok post or account is private and cannot be downloaded.',
      };
    }

    const author =
      (typeof authorObj.uniqueId === 'string' && authorObj.uniqueId.trim()) ||
      (typeof authorObj.nickname === 'string' && authorObj.nickname.trim()) ||
      undefined;
    const desc =
      (typeof itemStruct.desc === 'string' && itemStruct.desc.trim()) ||
      (author ? `TikTok by @${author}` : 'TikTok Post');

    const imagePost = itemStruct.imagePost as { images?: Array<Record<string, unknown>> } | undefined;
    if (imagePost && Array.isArray(imagePost.images) && imagePost.images.length > 0) {
      const slides: SocialMediaItem[] = [];
      imagePost.images.forEach((img, idx) => {
        const imageURL = img.imageURL as { urlList?: unknown[] } | undefined;
        const urlList = Array.isArray(imageURL?.urlList) ? imageURL.urlList : [];
        const firstUrl = urlList.find((u) => typeof u === 'string' && isHttpUrl(u)) as string | undefined;
        if (!firstUrl) return;
        slides.push({
          id: `tt-slide-${idx + 1}`,
          index: slides.length,
          kind: 'image',
          title: `${desc.slice(0, 80)} - Slide ${slides.length + 1}`,
          artist: author,
          thumbnailUrl: firstUrl,
          mediaUrl: firstUrl,
          sourceUrl,
          ext: 'jpg',
        });
      });

      if (slides.length > 0) {
        return {
          ok: true,
          platform: 'tiktok',
          contentType: 'carousel',
          url: sourceUrl,
          title: desc,
          author,
          thumbnailUrl: slides[0].thumbnailUrl,
          items: slides,
        };
      }
    }

    const videoObj = itemStruct.video as Record<string, unknown> | undefined;
    if (videoObj) {
      const playUrl =
        (typeof videoObj.downloadAddr === 'string' && videoObj.downloadAddr) ||
        (typeof videoObj.playAddr === 'string' && videoObj.playAddr) ||
        undefined;
      const thumb =
        (typeof videoObj.originCover === 'string' && videoObj.originCover) ||
        (typeof videoObj.cover === 'string' && videoObj.cover) ||
        undefined;
      const dur = typeof videoObj.duration === 'number' ? videoObj.duration : null;

      return {
        ok: true,
        platform: 'tiktok',
        contentType: 'video',
        url: sourceUrl,
        title: desc,
        author,
        thumbnailUrl: thumb,
        durationSeconds: dur,
        items: [
          {
            id: String(itemStruct.id || 'tt-video'),
            index: 0,
            kind: 'video',
            title: desc,
            artist: author,
            durationSeconds: dur,
            thumbnailUrl: thumb,
            mediaUrl: playUrl && isHttpUrl(playUrl) ? playUrl : undefined,
            sourceUrl,
            ext: 'mp4',
          },
        ],
      };
    }

    return null;
  } catch {
    return null;
  }
}

export function normalizeYtDlpMetadata(
  platform: 'youtube' | 'instagram' | 'tiktok' | 'custom',
  raw: Record<string, unknown>,
  sourceUrl: string
): SocialScanResult {
  const entries = Array.isArray(raw.entries)
    ? (raw.entries.filter((e): e is Record<string, unknown> => Boolean(e && typeof e === 'object')))
    : null;

  const isYtMusic = platform === 'youtube' && /music\.youtube\.com/i.test(sourceUrl);
  const topTitle =
    String(raw.title || raw.fulltitle || raw.track || raw.description || 'Media').trim();
  const topAuthor =
    (typeof raw.artist === 'string' && raw.artist.trim()) ||
    (typeof raw.uploader === 'string' && raw.uploader.trim()) ||
    (typeof raw.channel === 'string' && raw.channel.trim()) ||
    undefined;
  const topThumb = typeof raw.thumbnail === 'string' ? raw.thumbnail : undefined;
  const topDur = typeof raw.duration === 'number' ? Math.round(raw.duration) : null;

  if (entries && entries.length > 0) {
    const items: SocialMediaItem[] = entries.map((entry, idx) => {
      const ext = typeof entry.ext === 'string' ? entry.ext.toLowerCase() : 'mp4';
      const isImage = ['jpg', 'jpeg', 'png', 'webp'].includes(ext);
      const thumb = typeof entry.thumbnail === 'string' ? entry.thumbnail : topThumb;
      const directUrl =
        typeof entry.url === 'string' && isHttpUrl(entry.url) && !/\.m3u8/i.test(entry.url)
          ? entry.url
          : undefined;
      return {
        id: String(entry.id || `item-${idx + 1}`),
        index: idx,
        kind: isImage ? 'image' : 'video',
        title: String(entry.title || `${topTitle} - Slide ${idx + 1}`).trim(),
        artist:
          (typeof entry.uploader === 'string' && entry.uploader.trim()) || topAuthor,
        durationSeconds: typeof entry.duration === 'number' ? Math.round(entry.duration) : null,
        thumbnailUrl: thumb,
        mediaUrl: directUrl,
        sourceUrl: typeof entry.webpage_url === 'string' ? entry.webpage_url : sourceUrl,
        ext: isImage ? ext : 'mp4',
      };
    });

    return {
      ok: true,
      platform,
      contentType: items.length > 1 ? 'carousel' : 'post',
      url: sourceUrl,
      title: topTitle,
      author: topAuthor,
      thumbnailUrl: topThumb || items[0]?.thumbnailUrl,
      items,
    };
  }

  const singleExt = typeof raw.ext === 'string' ? raw.ext.toLowerCase() : 'mp4';
  const singleIsImg = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'].includes(singleExt);
  const singleIsAudio = ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'opus'].includes(singleExt);
  const directMediaUrl =
    platform !== 'youtube' &&
    typeof raw.url === 'string' &&
    isHttpUrl(raw.url) &&
    !/\.m3u8/i.test(raw.url)
      ? raw.url
      : undefined;

  return {
    ok: true,
    platform,
    contentType: isYtMusic || singleIsAudio
      ? 'music'
      : platform === 'instagram' && /\/reel\//i.test(sourceUrl)
        ? 'reel'
        : singleIsImg
          ? 'post'
          : 'video',
    url: sourceUrl,
    title: typeof raw.track === 'string' && raw.track.trim() ? raw.track.trim() : topTitle,
    author: topAuthor,
    album: typeof raw.album === 'string' && raw.album.trim() ? raw.album.trim() : undefined,
    thumbnailUrl: topThumb,
    durationSeconds: topDur,
    items: [
      {
        id: String(raw.id || 'media-1'),
        index: 0,
        kind: isYtMusic || singleIsAudio ? 'audio' : singleIsImg ? 'image' : 'video',
        title: typeof raw.track === 'string' && raw.track.trim() ? raw.track.trim() : topTitle,
        artist: topAuthor,
        album: typeof raw.album === 'string' && raw.album.trim() ? raw.album.trim() : undefined,
        durationSeconds: topDur,
        thumbnailUrl: topThumb,
        mediaUrl: directMediaUrl,
        sourceUrl,
        ext: isYtMusic ? 'mp3' : singleExt,
      },
    ],
  };
}

const CUSTOM_VIDEO_EXTS = new Set(['mp4', 'webm', 'mkv', 'mov', 'm4v']);
const CUSTOM_AUDIO_EXTS = new Set(['mp3', 'wav', 'm4a', 'flac', 'ogg', 'opus']);
const CUSTOM_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']);

function extractAttr(tag: string, attrName: string): string | undefined {
  const escaped = attrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = tag.match(new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  const val = m?.[1] ?? m?.[2] ?? m?.[3];
  return val ? decodeHtmlEntities(val).trim() : undefined;
}

function resolvePublicMediaUrl(rawUrl: string, baseUrl: string): string | null {
  let clean = unescapeJsonUrl(decodeHtmlEntities(rawUrl || '')).trim();
  if (!clean || clean.startsWith('#') || /^(?:data|blob|javascript|mailto):/i.test(clean)) {
    return null;
  }
  try {
    const resolved = new URL(clean, baseUrl);
    if (!isHttpUrl(resolved.toString())) return null;
    if (isPrivateOrLocalHost(resolved.hostname)) return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

function getUrlExt(rawUrl: string): string {
  try {
    const pathname = new URL(rawUrl).pathname;
    const base = pathname.split('/').pop() || '';
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  } catch {
    return '';
  }
}

function deriveTitleFromMediaUrl(rawUrl: string, fallback: string): string {
  try {
    const pathname = new URL(rawUrl).pathname;
    const leaf = decodeURIComponent(pathname.split('/').pop() || '').replace(/\.[^.]+$/, '').trim();
    if (leaf && leaf.length >= 2) return leaf.slice(0, 120);
  } catch {
  }
  return fallback;
}

function isNoiseImageUrl(rawUrl: string): boolean {
  const lower = rawUrl.toLowerCase();
  if (lower.endsWith('.ico') || lower.endsWith('.svg') || /\.ico[?#]|\.svg[?#]/i.test(lower)) {
    return true;
  }
  return /favicon|sprite|spacer|1x1|pixel|blank\.gif|gravatar|doubleclick|googlesyndication|\/ads\//i.test(
    lower
  );
}

export function parseCustomPageHtml(html: string, pageUrl: string): SocialScanResult {
  const privErr = detectPrivateError('custom', html);
  if (privErr) {
    return {
      ok: false,
      platform: 'custom',
      contentType: 'post',
      url: pageUrl,
      title: 'Custom URL',
      items: [],
      isPrivate: true,
      error: privErr,
    };
  }

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const pageTitle =
    extractMetaTag(html, 'og:title') ||
    (titleMatch?.[1] ? decodeHtmlEntities(titleMatch[1]).replace(/\s+/g, ' ').trim() : '') ||
    'Scanned Page';
  const posterThumb =
    resolvePublicMediaUrl(
      extractMetaTag(html, 'og:image') || extractMetaTag(html, 'twitter:image') || '',
      pageUrl
    ) || undefined;

  const items: SocialMediaItem[] = [];
  const seen = new Set<string>();

  const pushCandidate = (
    kind: 'video' | 'image' | 'audio',
    rawUrl: string | undefined,
    opts?: { title?: string; thumb?: string; ext?: string; direct?: boolean }
  ) => {
    if (!rawUrl || items.length >= 60) return;
    const resolved = resolvePublicMediaUrl(rawUrl, pageUrl);
    if (!resolved || seen.has(resolved)) return;
    if (kind === 'image' && isNoiseImageUrl(resolved)) return;
    seen.add(resolved);

    const extFromUrl = getUrlExt(resolved);
    const defaultExt = kind === 'audio' ? 'mp3' : kind === 'image' ? 'jpg' : 'mp4';
    const ext =
      opts?.ext ||
      (extFromUrl && (CUSTOM_VIDEO_EXTS.has(extFromUrl) || CUSTOM_AUDIO_EXTS.has(extFromUrl) || CUSTOM_IMAGE_EXTS.has(extFromUrl))
        ? extFromUrl
        : defaultExt);
    const idx = items.length;
    const labelPrefix = kind === 'audio' ? 'Audio' : kind === 'image' ? 'Image' : 'Video';
    items.push({
      id: `custom-${idx + 1}`,
      index: idx,
      kind,
      title: (opts?.title?.trim() || deriveTitleFromMediaUrl(resolved, `${labelPrefix} ${idx + 1}`)).slice(0, 140),
      thumbnailUrl: opts?.thumb || (kind === 'image' ? resolved : posterThumb),
      mediaUrl: opts?.direct === false ? undefined : resolved,
      sourceUrl: opts?.direct === false ? resolved : pageUrl,
      ext,
    });
  };

  for (const tagName of ['og:video', 'og:video:url', 'og:video:secure_url', 'twitter:player:stream']) {
    const val = extractMetaTag(html, tagName);
    if (val) pushCandidate('video', val, { direct: !/\.m3u8/i.test(val) });
  }

  for (const m of html.matchAll(/<(video|source|audio)\b[^>]*>/gi)) {
    const tag = m[0];
    const tagType = m[1].toLowerCase();
    const src = extractAttr(tag, 'src') || extractAttr(tag, 'data-src');
    if (!src) continue;
    const mime = (extractAttr(tag, 'type') || '').toLowerCase();
    const ext = getUrlExt(src);
    const isHls = ext === 'm3u8' || /\.m3u8/i.test(src) || mime.includes('mpegurl');
    const isAudio =
      tagType === 'audio' || mime.startsWith('audio/') || CUSTOM_AUDIO_EXTS.has(ext);
    const poster = extractAttr(tag, 'poster');
    const resolvedPoster = poster ? resolvePublicMediaUrl(poster, pageUrl) || undefined : undefined;
    pushCandidate(isAudio ? 'audio' : 'video', src, {
      direct: !isHls,
      thumb: resolvedPoster,
      ext: isHls ? 'mp4' : undefined,
    });
  }

  for (const tagName of ['og:audio', 'og:audio:url', 'og:audio:secure_url']) {
    const val = extractMetaTag(html, tagName);
    if (val) pushCandidate('audio', val);
  }

  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = m[1] || '';
    const href = extractAttr(`<a ${attrs}>`, 'href');
    if (!href) continue;
    const resolved = resolvePublicMediaUrl(href, pageUrl);
    if (!resolved) continue;
    const ext = getUrlExt(resolved);
    const labelText = decodeHtmlEntities((m[2] || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (CUSTOM_VIDEO_EXTS.has(ext)) {
      pushCandidate('video', resolved, { title: labelText || undefined, ext });
    } else if (CUSTOM_AUDIO_EXTS.has(ext)) {
      pushCandidate('audio', resolved, { title: labelText || undefined, ext });
    } else if (CUSTOM_IMAGE_EXTS.has(ext)) {
      pushCandidate('image', resolved, { title: labelText || undefined, ext });
    }
  }

  for (const m of html.matchAll(
    /(https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:mp4|webm|m4v|mov|mp3|wav|m4a|flac|ogg|opus|m3u8)(?:\?[^"'\\\s<>]*)?)/gi
  )) {
    const candidate = m[1];
    const ext = getUrlExt(unescapeJsonUrl(candidate));
    if (ext === 'm3u8') {
      pushCandidate('video', candidate, { direct: false, ext: 'mp4' });
    } else if (CUSTOM_AUDIO_EXTS.has(ext)) {
      pushCandidate('audio', candidate, { ext });
    } else {
      pushCandidate('video', candidate, { ext });
    }
  }

  if (posterThumb) {
    pushCandidate('image', posterThumb);
  }

  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = extractAttr(tag, 'data-src') || extractAttr(tag, 'src');
    if (!src) continue;
    const w = Number(extractAttr(tag, 'width') || '');
    const h = Number(extractAttr(tag, 'height') || '');
    if ((Number.isFinite(w) && w > 0 && w < 64) || (Number.isFinite(h) && h > 0 && h < 64)) {
      continue;
    }
    const alt = extractAttr(tag, 'alt');
    pushCandidate('image', src, { title: alt || undefined });
  }

  if (items.length === 0) {
    return {
      ok: false,
      platform: 'custom',
      contentType: 'post',
      url: pageUrl,
      title: pageTitle,
      items: [],
      error: 'No downloadable public media was found on this page.',
    };
  }

  const contentType: SocialScanResult['contentType'] =
    items.length > 1
      ? 'carousel'
      : items[0].kind === 'video'
        ? 'video'
        : items[0].kind === 'audio'
          ? 'music'
          : 'post';

  return {
    ok: true,
    platform: 'custom',
    contentType,
    url: pageUrl,
    title: pageTitle,
    thumbnailUrl: posterThumb || items.find((i) => i.thumbnailUrl)?.thumbnailUrl,
    items,
  };
}

export function describeCustomHttpError(
  statusCode: number
): { error: string; isPrivate: boolean } | null {
  if (statusCode >= 200 && statusCode < 300) {
    return null;
  }
  if (statusCode === 401) {
    return {
      isPrivate: true,
      error: 'HTTP 401 Unauthorized — this page requires you to sign in.',
    };
  }
  if (statusCode === 403) {
    return {
      isPrivate: true,
      error:
        'HTTP 403 Forbidden — this site blocked automated access or uses anti-bot protection.',
    };
  }
  if (statusCode === 404 || statusCode === 410) {
    return {
      isPrivate: false,
      error: 'HTTP 404 Not Found — this page does not exist or has been removed.',
    };
  }
  if (statusCode === 429) {
    return {
      isPrivate: false,
      error:
        'HTTP 429 Too Many Requests — this site is temporarily rate-limiting requests. Try again later.',
    };
  }
  if (statusCode >= 500) {
    return {
      isPrivate: false,
      error: `HTTP ${statusCode} Server Error — the remote website returned an error.`,
    };
  }
  return {
    isPrivate: false,
    error: `HTTP ${statusCode} — unable to load this webpage.`,
  };
}

