import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { sanitizeFileName } from '../shared/constants';
import type { MultiPartCandidate, MultiPartScanResult } from '../shared/types';
import {
  isSameHostAndSafeScheme,
  sanitizeOutgoingHeaders,
  stripUnsafeRedirectHeaders,
  validateHttpOrHttpsUrl,
} from './security';

export interface PartPatternMatch {
  baseName: string;
  partNumber: number;
  padWidth: number;
  minIndex: number;
  buildFileName: (n: number) => string;
  buildUrl: (n: number) => string;
}

export type PartProbeFn = (
  url: string,
  headers?: Record<string, string>
) => Promise<{ ok: boolean; totalBytes: number | null }>;

export function detectPartPattern(rawUrl: string): PartPatternMatch | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const pathname = parsed.pathname;
  const slashIdx = pathname.lastIndexOf('/');
  const dirPath = slashIdx >= 0 ? pathname.slice(0, slashIdx + 1) : '/';
  const rawFile = slashIdx >= 0 ? pathname.slice(slashIdx + 1) : pathname;
  if (!rawFile) return null;

  let decodedFile = rawFile;
  try {
    decodedFile = decodeURIComponent(rawFile);
  } catch {
    decodedFile = rawFile;
  }

  const makeResult = (
    baseName: string,
    numStr: string,
    minIndex: number,
    formatName: (padded: string) => string
  ): PartPatternMatch => {
    const partNumber = Number(numStr);
    const padWidth = numStr.length;
    const buildFileName = (n: number) => {
      const padded = padWidth > 1 ? String(n).padStart(padWidth, '0') : String(n);
      return formatName(padded);
    };
    const buildUrl = (n: number) => {
      const u = new URL(parsed.toString());
      const nextFile = buildFileName(n);
      u.pathname = `${dirPath}${encodeURIComponent(nextFile)}`;
      return u.toString();
    };
    return {
      baseName: sanitizeFileName(baseName),
      partNumber,
      padWidth,
      minIndex,
      buildFileName,
      buildUrl,
    };
  };

  const mPart = decodedFile.match(/^(.*?)[._-](part)(\d+)(\.[a-z0-9]{2,6})$/i);
  if (mPart) {
    const [, stem, word, numStr, ext] = mPart;
    if (stem && numStr.length <= 4) {
      const sep = decodedFile[stem.length];
      return makeResult(
        `${stem}${ext}`,
        numStr,
        Number(numStr) === 0 ? 0 : 1,
        (padded) => `${stem}${sep}${word}${padded}${ext}`
      );
    }
  }

  const mArchiveSplit = decodedFile.match(
    /^(.*?\.(?:7z|zip|tar|gz|xz|bz2|rar|iso|mp4|mkv|avi|bin))\.(0*\d{1,4})$/i
  );
  if (mArchiveSplit) {
    const [, baseArchive, numStr] = mArchiveSplit;
    if (numStr.length >= 2) {
      return makeResult(
        baseArchive,
        numStr,
        Number(numStr) === 0 ? 0 : 1,
        (padded) => `${baseArchive}.${padded}`
      );
    }
  }

  const mRz = decodedFile.match(/^(.*?)\.([rz])(\d{2,3})$/i);
  if (mRz) {
    const [, stem, letter, numStr] = mRz;
    if (stem) {
      return makeResult(
        `${stem}.${letter.toLowerCase() === 'r' ? 'rar' : 'zip'}`,
        numStr,
        0,
        (padded) => `${stem}.${letter}${padded}`
      );
    }
  }

  const mNumericExt = decodedFile.match(/^(.*?)\.(\d{3,4})$/);
  if (mNumericExt) {
    const [, stem, numStr] = mNumericExt;
    if (stem) {
      return makeResult(
        stem,
        numStr,
        Number(numStr) === 0 ? 0 : 1,
        (padded) => `${stem}.${padded}`
      );
    }
  }

  const mPartNoExt = decodedFile.match(/^(.*?)[._-](part)(\d+)$/i);
  if (mPartNoExt) {
    const [, stem, word, numStr] = mPartNoExt;
    if (stem && numStr.length <= 4) {
      const sep = decodedFile[stem.length];
      return makeResult(
        stem,
        numStr,
        Number(numStr) === 0 ? 0 : 1,
        (padded) => `${stem}${sep}${word}${padded}`
      );
    }
  }

  return null;
}

export async function defaultPartProbe(
  urlStr: string,
  headers?: Record<string, string>
): Promise<{ ok: boolean; totalBytes: number | null }> {
  const safeHeaders = {
    'User-Agent': 'MyLoad/1.0 (Windows NT; Download Manager)',
    ...sanitizeOutgoingHeaders(headers),
  };
  try {
    const head = await requestHeader(urlStr, 'HEAD', safeHeaders);
    if (head.statusCode >= 200 && head.statusCode < 300) {
      return { ok: true, totalBytes: head.totalBytes };
    }
    if (head.statusCode === 405 || head.statusCode === 501 || head.statusCode === 403) {
      const getProbe = await requestHeader(urlStr, 'GET', {
        ...safeHeaders,
        Range: 'bytes=0-0',
      });
      if (getProbe.statusCode >= 200 && getProbe.statusCode < 300) {
        return { ok: true, totalBytes: getProbe.totalBytes };
      }
    }
    return { ok: false, totalBytes: null };
  } catch {
    return { ok: false, totalBytes: null };
  }
}

export async function scanMultiParts(
  rawUrl: string,
  opts?: {
    requestHeaders?: Record<string, string>;
    pageCandidates?: Array<{ url: string; fileName?: string }>;
    maxParts?: number;
    probeFn?: PartProbeFn;
  }
): Promise<MultiPartScanResult> {
  const pattern = detectPartPattern(rawUrl);
  const probeFn = opts?.probeFn ?? defaultPartProbe;
  const maxParts = opts?.maxParts ?? 100;
  const pageCandidates = (opts?.pageCandidates ?? []).filter(
    (cand) => Boolean(cand?.url) && isSameHostAndSafeScheme(rawUrl, cand.url)
  );

  if (!pattern) {
    const stemMatch = matchPageCandidatesFallback(rawUrl, pageCandidates);
    if (stemMatch.parts.length >= 2) {
      return stemMatch;
    }
    return {
      matched: false,
      baseName: deriveNameFromUrl(rawUrl),
      parts: [],
    };
  }

  const byNumber = new Map<number, MultiPartCandidate>();

  const originalName = pattern.buildFileName(pattern.partNumber);
  const origProbe = await probeFn(rawUrl, opts?.requestHeaders);
  byNumber.set(pattern.partNumber, {
    url: rawUrl,
    fileName: originalName,
    partNumber: pattern.partNumber,
    totalBytes: origProbe.totalBytes,
    isOriginal: true,
  });

  for (const cand of pageCandidates) {
    if (!cand?.url) continue;
    const candPat = detectPartPattern(cand.url);
    if (candPat && candPat.baseName.toLowerCase() === pattern.baseName.toLowerCase()) {
      if (!byNumber.has(candPat.partNumber)) {
        byNumber.set(candPat.partNumber, {
          url: cand.url,
          fileName: cand.fileName ? sanitizeFileName(path.basename(cand.fileName)) : candPat.buildFileName(candPat.partNumber),
          partNumber: candPat.partNumber,
          totalBytes: null,
          isOriginal: cand.url === rawUrl,
        });
      }
    }
  }

  let backMisses = 0;
  for (let n = pattern.partNumber - 1; n >= pattern.minIndex; n -= 1) {
    if (byNumber.has(n)) {
      backMisses = 0;
      continue;
    }
    const candidateUrl = pattern.buildUrl(n);
    const res = await probeFn(candidateUrl, opts?.requestHeaders);
    if (res.ok) {
      backMisses = 0;
      byNumber.set(n, {
        url: candidateUrl,
        fileName: pattern.buildFileName(n),
        partNumber: n,
        totalBytes: res.totalBytes,
        isOriginal: false,
      });
    } else {
      backMisses += 1;
      if (backMisses >= 2) break;
    }
  }

  let forwardMisses = 0;
  let cursor = pattern.partNumber + 1;
  while (cursor <= maxParts && forwardMisses < 2) {
    const batchNums: number[] = [];
    for (let k = 0; k < 4 && cursor + k <= maxParts; k += 1) {
      const n = cursor + k;
      if (!byNumber.has(n)) batchNums.push(n);
    }
    if (batchNums.length === 0) {
      cursor += 4;
      continue;
    }
    const results = await Promise.all(
      batchNums.map(async (n) => {
        const u = pattern.buildUrl(n);
        const res = await probeFn(u, opts?.requestHeaders);
        return { n, u, res };
      })
    );
    for (const r of results) {
      if (r.res.ok) {
        forwardMisses = 0;
        byNumber.set(r.n, {
          url: r.u,
          fileName: pattern.buildFileName(r.n),
          partNumber: r.n,
          totalBytes: r.res.totalBytes,
          isOriginal: false,
        });
      } else {
        forwardMisses += 1;
      }
    }
    cursor += 4;
  }

  const sortedParts = [...byNumber.values()].sort((a, b) => a.partNumber - b.partNumber);
  return {
    matched: sortedParts.length >= 2,
    baseName: pattern.baseName,
    parts: sortedParts,
  };
}

function matchPageCandidatesFallback(
  rawUrl: string,
  pageCandidates: Array<{ url: string; fileName?: string }>
): MultiPartScanResult {
  const baseName = deriveNameFromUrl(rawUrl);
  const m = baseName.match(/^(.*?)[_-](\d{2,3})(\.[a-z0-9]{2,6})$/i);
  if (!m || pageCandidates.length === 0) {
    return { matched: false, baseName, parts: [] };
  }
  const [, stem, numStr, ext] = m;
  if (/^(19|20)\d{2}$/.test(numStr) || /^(32|64|86)$/.test(numStr)) {
    return { matched: false, baseName, parts: [] };
  }
  const parts: MultiPartCandidate[] = [
    {
      url: rawUrl,
      fileName: baseName,
      partNumber: Number(numStr),
      totalBytes: null,
      isOriginal: true,
    },
  ];
  const seen = new Set<string>([rawUrl]);
  for (const cand of pageCandidates) {
    if (!cand?.url || !isSameHostAndSafeScheme(rawUrl, cand.url) || seen.has(cand.url)) continue;
    const candName = cand.fileName ? path.basename(cand.fileName) : deriveNameFromUrl(cand.url);
    const cm = candName.match(/^(.*?)[_-](\d{2,3})(\.[a-z0-9]{2,6})$/i);
    if (
      cm &&
      cm[1].toLowerCase() === stem.toLowerCase() &&
      cm[3].toLowerCase() === ext.toLowerCase()
    ) {
      seen.add(cand.url);
      parts.push({
        url: cand.url,
        fileName: sanitizeFileName(candName),
        partNumber: Number(cm[2]),
        totalBytes: null,
        isOriginal: false,
      });
    }
  }
  parts.sort((a, b) => a.partNumber - b.partNumber);
  return {
    matched: parts.length >= 2,
    baseName: `${stem}${ext}`,
    parts,
  };
}

function deriveNameFromUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const seg = u.pathname.split('/').filter(Boolean).pop();
    if (seg) return sanitizeFileName(decodeURIComponent(seg));
  } catch {
  }
  return 'download';
}

function requestHeader(
  urlStr: string,
  method: 'HEAD' | 'GET',
  headers: Record<string, string>,
  redirects = 0
): Promise<{ statusCode: number; totalBytes: number | null }> {
  const url = validateHttpOrHttpsUrl(urlStr);
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(url, { method, headers }, (res) => {
      const statusCode = res.statusCode ?? 0;
      const loc = res.headers.location;
      if (loc && [301, 302, 303, 307, 308].includes(statusCode) && redirects < 6) {
        res.resume();
        let nextUrl: string;
        try {
          nextUrl = validateHttpOrHttpsUrl(new URL(loc, url).toString()).toString();
        } catch (err) {
          reject(err);
          return;
        }
        requestHeader(
          nextUrl,
          method,
          stripUnsafeRedirectHeaders(headers, urlStr, nextUrl),
          redirects + 1
        )
          .then(resolve)
          .catch(reject);
        return;
      }
      res.destroy();
      let totalBytes: number | null = null;
      if (statusCode === 206 && res.headers['content-range']) {
        const m = String(res.headers['content-range']).match(/\/(\d+)\s*$/);
        if (m) totalBytes = Number(m[1]);
      } else if (res.headers['content-length']) {
        const len = Number(res.headers['content-length']);
        if (Number.isFinite(len) && len >= 0) totalBytes = len;
      }
      resolve({ statusCode, totalBytes });
    });
    req.setTimeout(3500, () => req.destroy(new Error('Timeout')));
    req.on('error', reject);
    req.end();
  });
}

