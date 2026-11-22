import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function toDosTimeDate(d: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, d.getFullYear());
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const seconds = Math.floor(d.getSeconds() / 2);
  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  return { dosTime, dosDate };
}

function deduplicateEntryName(rawName: string, used: Set<string>): string {
  const normalized = rawName.replace(/\\/g, '/').replace(/^\/+/, '') || 'file';
  if (!used.has(normalized.toLowerCase())) {
    used.add(normalized.toLowerCase());
    return normalized;
  }
  const slashIdx = normalized.lastIndexOf('/');
  const dir = slashIdx >= 0 ? normalized.slice(0, slashIdx + 1) : '';
  const leaf = slashIdx >= 0 ? normalized.slice(slashIdx + 1) : normalized;
  const dot = leaf.lastIndexOf('.');
  const stem = dot > 0 ? leaf.slice(0, dot) : leaf;
  const ext = dot > 0 ? leaf.slice(dot) : '';
  let n = 1;
  while (n < 10000) {
    const candidate = `${dir}${stem} (${n})${ext}`;
    if (!used.has(candidate.toLowerCase())) {
      used.add(candidate.toLowerCase());
      return candidate;
    }
    n += 1;
  }
  return `${dir}${stem}-${Date.now()}${ext}`;
}

export async function createZipArchive(
  entries: Array<{ name: string; filePath: string }>,
  outputZipPath: string
): Promise<number> {
  await fs.promises.mkdir(path.dirname(outputZipPath), { recursive: true });
  const partPath = `${outputZipPath}.part`;
  const handle = await fs.promises.open(partPath, 'w');

  const usedNames = new Set<string>();
  const centralRecords: Buffer[] = [];
  let offset = 0;

  try {
    for (const entry of entries) {
      const raw = await fs.promises.readFile(entry.filePath);
      const stat = await fs.promises.stat(entry.filePath);
      const safeName = deduplicateEntryName(entry.name, usedNames);
      const nameBuf = Buffer.from(safeName, 'utf-8');

      const checksum = crc32(raw);
      const compressed = zlib.deflateRawSync(raw, { level: 6 });
      const useDeflate = compressed.length < raw.length;
      const payload = useDeflate ? compressed : raw;
      const method = useDeflate ? 8 : 0;

      const { dosTime, dosDate } = toDosTimeDate(stat.mtime);

      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(0x04034b50, 0);
      localHeader.writeUInt16LE(20, 4);
      localHeader.writeUInt16LE(0x0800, 6);
      localHeader.writeUInt16LE(method, 8);
      localHeader.writeUInt16LE(dosTime, 10);
      localHeader.writeUInt16LE(dosDate, 12);
      localHeader.writeUInt32LE(checksum, 14);
      localHeader.writeUInt32LE(payload.length, 18);
      localHeader.writeUInt32LE(raw.length, 22);
      localHeader.writeUInt16LE(nameBuf.length, 26);
      localHeader.writeUInt16LE(0, 28);

      const localChunk = Buffer.concat([localHeader, nameBuf, payload]);
      await handle.write(localChunk);

      const cdHeader = Buffer.alloc(46);
      cdHeader.writeUInt32LE(0x02014b50, 0);
      cdHeader.writeUInt16LE(20, 4);
      cdHeader.writeUInt16LE(20, 6);
      cdHeader.writeUInt16LE(0x0800, 8);
      cdHeader.writeUInt16LE(method, 10);
      cdHeader.writeUInt16LE(dosTime, 12);
      cdHeader.writeUInt16LE(dosDate, 14);
      cdHeader.writeUInt32LE(checksum, 16);
      cdHeader.writeUInt32LE(payload.length, 20);
      cdHeader.writeUInt32LE(raw.length, 24);
      cdHeader.writeUInt16LE(nameBuf.length, 28);
      cdHeader.writeUInt16LE(0, 30);
      cdHeader.writeUInt16LE(0, 32);
      cdHeader.writeUInt16LE(0, 34);
      cdHeader.writeUInt16LE(0, 36);
      cdHeader.writeUInt32LE(0, 38);
      cdHeader.writeUInt32LE(offset, 42);

      centralRecords.push(Buffer.concat([cdHeader, nameBuf]));
      offset += localChunk.length;
    }

    const centralDir = Buffer.concat(centralRecords);
    await handle.write(centralDir);

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(centralRecords.length, 8);
    eocd.writeUInt16LE(centralRecords.length, 10);
    eocd.writeUInt32LE(centralDir.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);
    await handle.write(eocd);

    const totalSize = offset + centralDir.length + eocd.length;
    await handle.close();
    await fs.promises.rm(outputZipPath, { force: true }).catch(() => {});
    await fs.promises.rename(partPath, outputZipPath);
    return totalSize;
  } catch (err) {
    await handle.close().catch(() => {});
    await fs.promises.rm(partPath, { force: true }).catch(() => {});
    throw err;
  }
}

