// Byte-level helpers for the sealed-data and compact-key formats (docs/key-format.md): text alphabets, variable-length
// integers, bit packing, Rice codes, a short checksum, and raw-deflate compression with an output cap.
// Pure; browser and Node 20+ (Web Crypto, CompressionStream). No dependency.

/** An error with a stable `code`; every failure of the crypt modules is one of these, never anything else. */
export class CryptError extends Error {
  constructor(code, message, extra) {
    super(message);
    this.name = 'CryptError';
    this.code = code;
    if (extra) Object.assign(this, extra);
  }
}
/**
 * A deterministic byte source for TEST VECTORS ONLY (xorshift128, seeded from a string): never use it for real keys.
 * Returns a function that fills a typed array, like `crypto.getRandomValues`.
 */
export function seededRandom(seedText) {
  let a = 0x9e3779b9, b = 0x243f6a88, c = 0xb7e15162, d = 0xdeadbeef;
  for (const ch of seedText) { a ^= ch.codePointAt(0); a = Math.imul(a, 0x85ebca6b) >>> 0; b ^= a >>> 13; c = Math.imul(c ^ b, 0xc2b2ae35) >>> 0; d ^= c >>> 16; }
  const next = () => { const t = a ^ (a << 11); a = b; b = c; c = d; d = (d ^ (d >>> 19) ^ t ^ (t >>> 8)) >>> 0; return d; };
  for (let i = 0; i < 16; i++) next();
  return (arr) => { const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength); for (let i = 0; i < bytes.length; i++) bytes[i] = next() & 255; return arr; };
}
export const fail = (code, message, extra) => new CryptError(code, message, extra);

const enc = new TextEncoder();
export const utf8 = (s) => enc.encode(s);
export const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
/** Equal length and equal bytes, without stopping at the first difference (key check values, work tags and vault checks are compared with this). */
export const equalBytes = (a, b) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
};

export async function sha256(bytes) { return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); }
export const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
export const fromHex = (h) => {
  if (!/^(?:[0-9a-f]{2})*$/i.test(h)) throw fail('damaged', 'Not hexadecimal');
  return Uint8Array.from(h.match(/../g) || [], (x) => parseInt(x, 16));
};

// ---- base64url (RFC 4648 section 5, no padding), strict ------------------------------------------------------
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]));
export function b64urlEncode(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '') + (i + 2 < bytes.length ? B64[n & 63] : '');
  }
  return out;
}
/** No text alphabet decoder reads more than this many characters unless told otherwise (a cheap guard against huge inputs). */
export const MAX_TEXT_CHARS = 64 * 1024 * 1024;
export function b64urlDecode(s, maxChars = MAX_TEXT_CHARS) {
  if (s.length > maxChars) throw fail('damaged', 'The text is too long to be a key or record');
  if (s.length % 4 === 1) throw fail('damaged', 'Not base64url');
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    let n = 0, k = 0;
    for (let j = 0; j < 4 && i + j < s.length; j++, k++) {
      const v = B64_INDEX.get(s[i + j]);
      if (v === undefined) throw fail('damaged', 'Not base64url');
      n |= v << (18 - 6 * j);
    }
    out[o++] = (n >> 16) & 255;
    if (k > 2) out[o++] = (n >> 8) & 255;
    if (k > 3) out[o++] = n & 255;
  }
  // canonical: the unused low bits of the last character must be zero (one text per byte string)
  if (!equalBytes(Uint8Array.from(b64urlEncode(out), (c) => c.charCodeAt(0)), Uint8Array.from(s, (c) => c.charCodeAt(0)))) throw fail('damaged', 'Not canonical base64url');
  return out;
}

// ---- base58 (Bitcoin alphabet: no 0 O I l, no punctuation, double-click selects it whole) -----------------------
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58_INDEX = new Map([...B58].map((c, i) => [c, i]));
// The conversion goes through a BigInt (bytes <-> hex <-> BigInt, 8 base58 digits per division or multiply-add, 58^8 < 2^53 so
// each chunk is an exact Number). It is still quadratic in the length, but in native big-number arithmetic: a key that carries a
// 32 KiB record (44 800 characters) takes about 0.1 s in each direction (the limb arithmetic in plain Numbers that was here first
// took 0.8 s, and one digit per pass 1.6 s). Leading zero bytes are leading '1' characters, as in Bitcoin's base58.
const B58_CHUNK = 58n ** 8n; // 128 063 081 718 016 < 2^53
const hexOf = (bytes) => Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join('');
export function b58Encode(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  let v = zeros < bytes.length ? BigInt('0x' + hexOf(bytes.subarray(zeros))) : 0n;
  let digits = '';
  while (v > 0n) {
    let r = Number(v % B58_CHUNK), part = '';
    v /= B58_CHUNK;
    for (let d = 0; d < 8; d++) { part = B58[r % 58] + part; r = Math.floor(r / 58); }
    digits = part + digits;
  }
  return '1'.repeat(zeros) + digits.replace(/^1+/, '');
}
export function b58Decode(s, maxChars = 100_000) {
  if (s.length > maxChars) throw fail('damaged', 'The key is too long to be a key');
  let zeros = 0;
  while (zeros < s.length && s[zeros] === '1') zeros++;
  let v = 0n, i = zeros;
  const take = (n) => {
    let c = 0;
    for (let k = 0; k < n; k++) { const d = B58_INDEX.get(s[i++]); if (d === undefined) throw fail('damaged', 'Not base58'); c = c * 58 + d; }
    return c;
  };
  const head = (s.length - zeros) % 8;
  if (head) v = BigInt(take(head));
  while (i < s.length) v = v * B58_CHUNK + BigInt(take(8));
  let hex = v.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const body = v === 0n ? [] : hex.match(/../g).map((h) => parseInt(h, 16));
  const out = new Uint8Array(zeros + body.length);
  out.set(body, zeros);
  return out;
}

// ---- variable-length integers (LEB128, as in tg1.) -------------------------------------------------------------
export function varint(n) {
  const out = [];
  do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 0x80; out.push(b); } while (n);
  return Uint8Array.from(out);
}
/** @returns {[number, number]} value and the offset after it */
export function readVarint(bytes, at) {
  let n = 0, mul = 1;
  for (let i = at; i < bytes.length && i < at + 7; i++) {
    n += (bytes[i] & 0x7f) * mul;
    if (!(bytes[i] & 0x80)) return [n, i + 1];
    mul *= 128;
  }
  throw fail('damaged', 'The key is damaged');
}

// ---- bit streams ------------------------------------------------------------------------------------------------
export class BitWriter {
  constructor() { this.bytes = []; this.cur = 0; this.n = 0; }
  bit(b) { this.cur = (this.cur << 1) | b; if (++this.n === 8) { this.bytes.push(this.cur); this.cur = 0; this.n = 0; } }
  bits(value, width) { for (let i = width - 1; i >= 0; i--) this.bit(Math.floor(value / 2 ** i) % 2); }
  finish() { while (this.n) this.bit(0); return Uint8Array.from(this.bytes); }
}
export class BitReader {
  constructor(bytes, at = 0) { this.bytes = bytes; this.pos = at * 8; this.end = bytes.length * 8; }
  bit() { if (this.pos >= this.end) throw fail('damaged', 'The key is damaged'); const b = (this.bytes[this.pos >> 3] >> (7 - (this.pos & 7))) & 1; this.pos++; return b; }
  bits(width) { let v = 0; for (let i = 0; i < width; i++) v = v * 2 + this.bit(); return v; }
}
/** Rice code: quotient in unary, k remainder bits. */
export function riceWrite(w, value, k) {
  const q = Math.floor(value / 2 ** k);
  for (let i = 0; i < q; i++) w.bit(1);
  w.bit(0);
  w.bits(value % 2 ** k, k);
}
export function riceRead(r, k, limit) {
  let q = 0;
  while (r.bit()) if (++q > limit) throw fail('damaged', 'The key is damaged');
  return q * 2 ** k + r.bits(k);
}
export const riceBits = (value, k) => Math.floor(value / 2 ** k) + 1 + k;

// ---- short checksum ---------------------------------------------------------------------------------------------
/** The first `n` bytes of SHA-256(domain, 0x00, bytes): catches typos in a key before any decryption is tried. */
export async function checksum(domain, bytes, n = 2) { return (await sha256(concat(utf8(domain), Uint8Array.of(0), bytes))).slice(0, n); }

// ---- raw deflate (RFC 1951) through the platform streams ---------------------------------------------------------
async function pump(stream, input, cap) {
  const writer = stream.writable.getWriter();
  const writing = writer.write(input).then(() => writer.close());
  writing.catch(() => {}); // an error surfaces on the reading side
  const reader = stream.readable.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > cap) { await reader.cancel().catch(() => {}); throw fail('too-large', `The data is larger than ${cap} bytes once unpacked`); }
    chunks.push(value);
  }
  await writing;
  return concat(...chunks);
}
export const deflateRaw = (bytes) => pump(new CompressionStream('deflate-raw'), bytes, Infinity);
/** Brotli is in Node's streams and in newer browsers; probe before use. */
export function brotliAvailable() { try { new CompressionStream('brotli'); new DecompressionStream('brotli'); return true; } catch { return false; } }
export function brotliCompress(bytes) {
  if (!brotliAvailable()) throw fail('unsupported-compression', 'This platform cannot write brotli; use deflate');
  return pump(new CompressionStream('brotli'), bytes, Infinity);
}
export async function brotliDecompress(bytes, cap) {
  if (!brotliAvailable()) throw fail('unsupported-compression', 'This record is compressed with brotli, which this platform cannot read');
  try { return await pump(new DecompressionStream('brotli'), bytes, cap); } catch (e) {
    if (e instanceof CryptError) throw e;
    throw fail('damaged', 'The compressed data is damaged');
  }
}
export async function inflateRaw(bytes, cap) {
  try { return await pump(new DecompressionStream('deflate-raw'), bytes, cap); } catch (e) {
    if (e instanceof CryptError) throw e;
    throw fail('damaged', 'The compressed data is damaged');
  }
}
