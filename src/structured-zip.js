// A minimal ZIP reader and writer for .xlsx files, on top of raw deflate (Node's zlib, or the browser's
// DecompressionStream / CompressionStream) behind two small adapters. No dependency.
//
// The reader is written for hostile input: entry names with "..", absolute or backslash paths, drive letters or NUL
// are refused (zip slip; nothing here ever writes to disk, but a name that cannot be safe is never a spreadsheet);
// duplicate names are refused (two readers would pick different ones); encrypted and ZIP64 archives are refused;
// every entry is inflated with a hard output limit (declared size, total limit, ratio limit) and its CRC-32 is
// checked. Limits are options; the defaults suit spreadsheets of a few million cells.
import { TgdError } from './structured-json.js';

export const DEFAULT_ZIP_LIMITS = { maxEntries: 4096, maxEntryBytes: 256 * 1024 * 1024, maxTotalBytes: 384 * 1024 * 1024, maxRatio: 300 };

// ---- raw deflate adapters -----------------------------------------------------------------------------------------
const isNode = typeof process !== 'undefined' && !!process.versions?.node;

/** Inflates raw deflate data; throws TgdError('limit') as soon as the output would exceed maxOut. */
export async function inflateRaw(bytes, maxOut) {
  if (isNode) {
    const { inflateRawSync } = await import('node:zlib');
    try { return new Uint8Array(inflateRawSync(bytes, { maxOutputLength: maxOut + 1 })); } catch (e) {
      if (e?.code === 'ERR_BUFFER_TOO_LARGE') throw new TgdError('limit', 'A file inside the archive is larger than it says (zip bomb?)');
      throw new TgdError('zip', `A compressed file inside the archive is damaged (${e?.code || e?.message})`);
    }
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader(), chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxOut) { await reader.cancel(); throw new TgdError('limit', 'A file inside the archive is larger than it says (zip bomb?)'); }
      chunks.push(value);
    }
  } catch (e) { if (e instanceof TgdError) throw e; throw new TgdError('zip', 'A compressed file inside the archive is damaged'); }
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

export async function deflateRaw(bytes) {
  if (isNode) { const { deflateRawSync } = await import('node:zlib'); return new Uint8Array(deflateRawSync(bytes, { level: 9 })); }
  if (typeof CompressionStream === 'undefined') return null; // the writer then stores the entry
  const out = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
  return new Uint8Array(out);
}

// ---- CRC-32 -------------------------------------------------------------------------------------------------------
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

// ---- reader -------------------------------------------------------------------------------------------------------
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

function checkName(name) {
  if (!name || name.includes('\0') || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').some((p) => p === '..'))
    throw new TgdError('zip-slip', `The archive holds an unsafe file name (${JSON.stringify(name.slice(0, 60))}); refused`);
}

/**
 * Reads the directory of a ZIP archive. @returns {{ names:string[], read(name):Promise<Uint8Array>, has(name):boolean }}
 * `read` inflates one entry with the limits applied; the total of all entries read is counted.
 */
export function openZip(bytes, limits = {}) {
  const L = { ...DEFAULT_ZIP_LIMITS, ...limits };
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 22 || u32(b, 0) !== 0x04034b50) throw new TgdError('zip', 'This is not a ZIP archive (an .xlsx file is one)');
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new TgdError('zip', 'The ZIP archive is damaged (no end record)');
  const count = u16(b, eocd + 10), cdSize = u32(b, eocd + 12), cdOff = u32(b, eocd + 16);
  if (count === 0xffff || cdOff === 0xffffffff) throw new TgdError('zip', 'ZIP64 archives are not supported');
  if (count > L.maxEntries) throw new TgdError('limit', `The archive holds more than ${L.maxEntries} files`);
  if (cdOff + cdSize > eocd) throw new TgdError('zip', 'The ZIP archive is damaged (bad directory)');
  const entries = new Map();
  let p = cdOff, declaredTotal = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > b.length || u32(b, p) !== 0x02014b50) throw new TgdError('zip', 'The ZIP archive is damaged (bad directory entry)');
    const flags = u16(b, p + 8), method = u16(b, p + 10), crc = u32(b, p + 16), csize = u32(b, p + 20), usize = u32(b, p + 24);
    const nl = u16(b, p + 28), el = u16(b, p + 30), cl = u16(b, p + 32), off = u32(b, p + 42);
    const raw = b.subarray(p + 46, p + 46 + nl);
    const name = new TextDecoder('utf-8').decode(raw);
    p += 46 + nl + el + cl;
    checkName(name);
    if (name.endsWith('/')) continue; // directory entry
    if (entries.has(name)) throw new TgdError('zip', `The archive holds the file ${JSON.stringify(name)} twice; refused`);
    if (flags & 1) throw new TgdError('zip', 'The archive is encrypted');
    if (method !== 0 && method !== 8) throw new TgdError('zip', `Unsupported compression method ${method}`);
    if (csize === 0xffffffff || usize === 0xffffffff) throw new TgdError('zip', 'ZIP64 archives are not supported');
    if (usize > L.maxEntryBytes) throw new TgdError('limit', `A file inside the archive is larger than ${L.maxEntryBytes} bytes unpacked`);
    if (usize > 4096 && csize > 0 && usize / csize > L.maxRatio) throw new TgdError('limit', `A file inside the archive is compressed ${Math.round(usize / csize)}:1 (limit ${L.maxRatio}:1); zip bomb?`);
    declaredTotal += usize;
    if (declaredTotal > L.maxTotalBytes) throw new TgdError('limit', `The archive unpacks to more than ${L.maxTotalBytes} bytes`);
    entries.set(name, { method, crc, csize, usize, off });
  }
  let used = 0;
  return {
    names: [...entries.keys()],
    has: (name) => entries.has(name),
    async read(name) {
      const e = entries.get(name);
      if (!e) throw new TgdError('zip', `The archive has no ${JSON.stringify(name)}`);
      if (e.off + 30 > b.length || u32(b, e.off) !== 0x04034b50) throw new TgdError('zip', 'The ZIP archive is damaged (bad local header)');
      const start = e.off + 30 + u16(b, e.off + 26) + u16(b, e.off + 28);
      if (start + e.csize > b.length) throw new TgdError('zip', 'The ZIP archive is damaged (a file runs past the end)');
      const comp = b.subarray(start, start + e.csize);
      const out = e.method === 0 ? comp : await inflateRaw(comp, e.usize);
      if (out.length !== e.usize) throw new TgdError('zip', 'A file inside the archive does not have the size it says');
      if (crc32(out) !== e.crc) throw new TgdError('zip', 'A file inside the archive fails its checksum (damaged)');
      used += out.length;
      if (used > L.maxTotalBytes) throw new TgdError('limit', 'The archive unpacks to too much data');
      return out;
    },
  };
}

// ---- writer -------------------------------------------------------------------------------------------------------
const DOS_TIME = 0, DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01 00:00, so the same data gives the same bytes
const w16 = (n) => [n & 255, (n >> 8) & 255];
const w32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

/** @param {{name:string, data:Uint8Array}[]} files  @returns {Promise<Uint8Array>} */
export async function writeZip(files) {
  const locals = [], central = [];
  let offset = 0;
  const enc = new TextEncoder();
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    let data = f.data, method = 0;
    const packed = f.data.length > 64 ? await deflateRaw(f.data) : null;
    if (packed && packed.length < f.data.length) { data = packed; method = 8; }
    const head = [...w32(0x04034b50), ...w16(20), ...w16(0x0800), ...w16(method), ...w16(DOS_TIME), ...w16(DOS_DATE), ...w32(crc), ...w32(data.length), ...w32(f.data.length), ...w16(name.length), ...w16(0)];
    locals.push(new Uint8Array(head), name, data);
    central.push(new Uint8Array([...w32(0x02014b50), ...w16(20), ...w16(20), ...w16(0x0800), ...w16(method), ...w16(DOS_TIME), ...w16(DOS_DATE), ...w32(crc), ...w32(data.length), ...w32(f.data.length), ...w16(name.length), ...w16(0), ...w16(0), ...w16(0), ...w16(0), ...w32(0), ...w32(offset)]), name);
    offset += head.length + name.length + data.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array([...w32(0x06054b50), ...w16(0), ...w16(0), ...w16(files.length), ...w16(files.length), ...w32(cdSize), ...w32(offset), ...w16(0)]);
  const parts = [...locals, ...central, end];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}
