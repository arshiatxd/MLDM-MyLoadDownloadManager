import path from 'node:path';

const ALLOWED_HEADER_KEYS: Record<string, string> = {
  cookie: 'Cookie',
  referer: 'Referer',
  'user-agent': 'User-Agent',
};

const EXTENSION_ORIGIN_RE = /^(chrome-extension|moz-extension):\/\/[a-z0-9_-]+$/i;

export function isPathInsideDir(baseDir: string, targetPath: string): boolean {
  if (!baseDir || !targetPath) return false;
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);

  const cmpBase = process.platform === 'win32' ? resolvedBase.toLowerCase() : resolvedBase;
  const cmpTarget = process.platform === 'win32' ? resolvedTarget.toLowerCase() : resolvedTarget;

  if (cmpBase === cmpTarget) return false;

  const prefix = cmpBase.endsWith(path.sep) ? cmpBase : `${cmpBase}${path.sep}`;
  return cmpTarget.startsWith(prefix);
}

export function sanitizeHeaderValue(val: string, maxLen = 8192): string | null {
  if (typeof val !== 'string') return null;
  if (/[\r\n\0]/.test(val)) return null;
  const cleaned = val.trim();
  if (!cleaned) return null;
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

export function sanitizeOutgoingHeaders(raw?: Record<string, string>): Record<string, string> {
  if (!raw) return {};
  const clean: Record<string, string> = {};
  for (const [key, val] of Object.entries(raw)) {
    const canonical = ALLOWED_HEADER_KEYS[key.toLowerCase()];
    if (!canonical) continue;
    const safe = sanitizeHeaderValue(val);
    if (safe) {
      clean[canonical] = safe;
    }
  }
  return clean;
}

export function stripUnsafeRedirectHeaders(
  headers: Record<string, string>,
  fromUrlStr: string,
  toUrlStr: string
): Record<string, string> {
  let stripCookie = false;
  let stripReferer = false;

  try {
    const fromUrl = new URL(fromUrlStr);
    const toUrl = new URL(toUrlStr);
    const sameHost = fromUrl.hostname.toLowerCase() === toUrl.hostname.toLowerCase();
    const samePort = fromUrl.port === toUrl.port;
    const isDowngrade = fromUrl.protocol === 'https:' && toUrl.protocol === 'http:';

    if (!sameHost || !samePort || isDowngrade) {
      stripCookie = true;
    }
    if (isDowngrade) {
      stripReferer = true;
    }
  } catch {
    stripCookie = true;
    stripReferer = true;
  }

  if (!stripCookie && !stripReferer) {
    return headers;
  }

  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (stripCookie && lower === 'cookie') continue;
    if (stripReferer && lower === 'referer') continue;
    next[k] = v;
  }
  return next;
}

export function validateHttpOrHttpsUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Invalid URL format');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }
  return parsed;
}

export function isSameHostAndSafeScheme(baseUrlStr: string, candidateUrlStr: string): boolean {
  try {
    const base = new URL(baseUrlStr);
    const cand = new URL(candidateUrlStr);
    if (cand.protocol !== 'http:' && cand.protocol !== 'https:') return false;
    if (base.protocol === 'https:' && cand.protocol === 'http:') return false;
    return base.hostname.toLowerCase() === cand.hostname.toLowerCase();
  } catch {
    return false;
  }
}

export function redactSensitiveUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^magnet:/i.test(trimmed)) {
    const hashMatch = trimmed.match(/xt=urn:btih:([a-zA-Z0-9]{16,64})/i);
    return hashMatch ? `magnet:?xt=urn:btih:${hashMatch[1]}` : 'magnet:?...';
  }
  try {
    const u = new URL(trimmed);
    if (u.username || u.password) {
      u.username = '';
      u.password = '';
    }
    if (u.search) {
      const redactedParams = new URLSearchParams();
      for (const [k] of u.searchParams.entries()) {
        redactedParams.append(k, '***');
      }
      u.search = redactedParams.toString();
    }
    u.hash = '';
    return u.toString();
  } catch {
    return trimmed;
  }
}

export function isAllowedExtensionOrigin(origin: string): boolean {
  return EXTENSION_ORIGIN_RE.test(origin.trim());
}

