import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const BUILD_DIR = path.resolve('build');

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function sdRoundedBox(px, py, cx, cy, halfW, halfH, r) {
  const dx = Math.abs(px - cx) - halfW + r;
  const dy = Math.abs(py - cy) - halfH + r;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
}

function sdSegment(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const wx = px - x1;
  const wy = py - y1;
  const lenSq = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / lenSq));
  return Math.hypot(px - (x1 + t * vx), py - (y1 + t * vy));
}

function sdUpperSemicircle(px, py, cx, cy, r) {
  if (py <= cy) {
    return Math.abs(Math.hypot(px - cx, py - cy) - r);
  }
  return Math.min(
    Math.hypot(px - (cx - r), py - cy),
    Math.hypot(px - (cx + r), py - cy)
  );
}

function sdTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const e0x = bx - ax;
  const e0y = by - ay;
  const e1x = cx - bx;
  const e1y = cy - by;
  const e2x = ax - cx;
  const e2y = ay - cy;

  const v0x = px - ax;
  const v0y = py - ay;
  const v1x = px - bx;
  const v1y = py - by;
  const v2x = px - cx;
  const v2y = py - cy;

  const c0 = clamp01((v0x * e0x + v0y * e0y) / (e0x * e0x + e0y * e0y || 1));
  const c1 = clamp01((v1x * e1x + v1y * e1y) / (e1x * e1x + e1y * e1y || 1));
  const c2 = clamp01((v2x * e2x + v2y * e2y) / (e2x * e2x + e2y * e2y || 1));

  const pq0x = v0x - e0x * c0;
  const pq0y = v0y - e0y * c0;
  const pq1x = v1x - e1x * c1;
  const pq1y = v1y - e1y * c1;
  const pq2x = v2x - e2x * c2;
  const pq2y = v2y - e2y * c2;

  const s = Math.sign(e0x * e2y - e0y * e2x);
  const d0x = pq0x * pq0x + pq0y * pq0y;
  const d0y = s * (v0x * e0y - v0y * e0x);
  const d1x = pq1x * pq1x + pq1y * pq1y;
  const d1y = s * (v1x * e1y - v1y * e1x);
  const d2x = pq2x * pq2x + pq2y * pq2y;
  const d2y = s * (v2x * e2y - v2y * e2x);

  const dx = Math.min(d0x, d1x, d2x);
  const dy = Math.min(d0y, d1y, d2y);
  return -Math.sqrt(dx) * Math.sign(dy);
}

function glyphDist(u, v) {
  const k = 1 / 64;
  const strokeR = 2.7 * k;
  const dLeftStem = sdSegment(u, v, 14.5 * k, 17.0 * k, 14.5 * k, 35.0 * k) - strokeR;
  const dArch1 = sdUpperSemicircle(u, v, 20.25 * k, 22.75 * k, 5.75 * k) - strokeR;
  const dMidStem = sdSegment(u, v, 26.0 * k, 22.75 * k, 26.0 * k, 35.0 * k) - strokeR;
  const dArch2 = sdUpperSemicircle(u, v, 31.75 * k, 22.75 * k, 5.75 * k) - strokeR;
  const dRightStem = sdSegment(u, v, 37.5 * k, 22.75 * k, 37.5 * k, 44.5 * k) - strokeR;
  const dHoriz = sdSegment(u, v, 37.5 * k, 44.5 * k, 47.5 * k, 44.5 * k) - strokeR;
  const dHead =
    sdTriangle(
      u,
      v,
      45.5 * k,
      39.2 * k,
      53.8 * k,
      44.5 * k,
      45.5 * k,
      49.8 * k
    ) - 0.011;
  return Math.min(dLeftStem, dArch1, dMidStem, dArch2, dRightStem, dHoriz, dHead);
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function renderIconRgba(size) {
  const buf = Buffer.alloc(size * size * 4);
  const aa = 1.35 / size;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let accR = 0;
      let accG = 0;
      let accB = 0;
      let accA = 0;

      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          const u = (x + (sx + 0.5) * 0.5) / size;
          const v = (y + (sy + 0.5) * 0.5) / size;

          const bgDist = sdRoundedBox(u, v, 0.5, 0.5, 0.4375, 0.4375, 0.21875);
          const bgAlpha = 1 - smoothstep(-aa, aa, bgDist);
          if (bgAlpha <= 0) continue;

          let r = 217;
          let g = 27;
          let b = 54;

          const fgDist = glyphDist(u, v);
          const fgAlpha = 1 - smoothstep(-aa, aa, fgDist);
          r = r * (1 - fgAlpha) + 255 * fgAlpha;
          g = g * (1 - fgAlpha) + 255 * fgAlpha;
          b = b * (1 - fgAlpha) + 255 * fgAlpha;

          accR += r * bgAlpha;
          accG += g * bgAlpha;
          accB += b * bgAlpha;
          accA += bgAlpha;
        }
      }

      const idx = (y * size + x) * 4;
      if (accA > 0) {
        buf[idx] = Math.round(accR / accA);
        buf[idx + 1] = Math.round(accG / accA);
        buf[idx + 2] = Math.round(accB / accA);
        buf[idx + 3] = Math.round((accA / 4) * 255);
      }
    }
  }

  return buf;
}

function encodeBmpEntry(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);

  const pixels = Buffer.alloc(size * size * 4);
  const maskRowBytes = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskRowBytes * size);

  for (let y = 0; y < size; y++) {
    const srcY = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const srcIdx = (srcY * size + x) * 4;
      const dstIdx = (y * size + x) * 4;
      pixels[dstIdx] = rgba[srcIdx + 2];
      pixels[dstIdx + 1] = rgba[srcIdx + 1];
      pixels[dstIdx + 2] = rgba[srcIdx];
      pixels[dstIdx + 3] = rgba[srcIdx + 3];
      if (rgba[srcIdx + 3] === 0) {
        mask[y * maskRowBytes + (x >> 3)] |= 1 << (7 - (x & 7));
      }
    }
  }

  return Buffer.concat([header, pixels, mask]);
}

function encodeIco(entries) {
  const count = entries.length;
  const dirSize = 6 + count * 16;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const dirEntries = [];
  const payloads = [];
  let offset = dirSize;

  for (const entry of entries) {
    const dir = Buffer.alloc(16);
    dir[0] = entry.size >= 256 ? 0 : entry.size;
    dir[1] = entry.size >= 256 ? 0 : entry.size;
    dir[2] = 0;
    dir[3] = 0;
    dir.writeUInt16LE(1, 4);
    dir.writeUInt16LE(32, 6);
    dir.writeUInt32LE(entry.data.length, 8);
    dir.writeUInt32LE(offset, 12);
    dirEntries.push(dir);
    payloads.push(entry.data);
    offset += entry.data.length;
  }

  return Buffer.concat([header, ...dirEntries, ...payloads]);
}

fs.mkdirSync(BUILD_DIR, { recursive: true });

const rgba256 = renderIconRgba(256);
const png256 = encodePng(256, 256, rgba256);
fs.writeFileSync(path.join(BUILD_DIR, 'icon.png'), png256);

const rgba32 = renderIconRgba(32);
const png32 = encodePng(32, 32, rgba32);
fs.writeFileSync(path.join(BUILD_DIR, 'tray-icon.png'), png32);

const rgba16 = renderIconRgba(16);
const rgba48 = renderIconRgba(48);

const ico = encodeIco([
  { size: 16, data: encodeBmpEntry(16, rgba16) },
  { size: 32, data: encodeBmpEntry(32, rgba32) },
  { size: 48, data: encodeBmpEntry(48, rgba48) },
  { size: 256, data: png256 },
]);
fs.writeFileSync(path.join(BUILD_DIR, 'icon.ico'), ico);
fs.mkdirSync(path.resolve('public'), { recursive: true });
fs.writeFileSync(path.resolve('public/favicon.ico'), ico);

const EXT_ICONS_DIR = path.resolve('extension/icons');
fs.mkdirSync(EXT_ICONS_DIR, { recursive: true });
const rgba128 = renderIconRgba(128);
fs.writeFileSync(path.join(EXT_ICONS_DIR, 'icon16.png'), encodePng(16, 16, rgba16));
fs.writeFileSync(path.join(EXT_ICONS_DIR, 'icon32.png'), png32);
fs.writeFileSync(path.join(EXT_ICONS_DIR, 'icon48.png'), encodePng(48, 48, rgba48));
fs.writeFileSync(path.join(EXT_ICONS_DIR, 'icon128.png'), encodePng(128, 128, rgba128));

console.log('Generated build/icon.png, build/tray-icon.png, build/icon.ico, public/favicon.ico, and extension/icons/*');

