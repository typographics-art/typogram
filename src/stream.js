// Encrypted media as a seekable stream: the `tgst1` format (docs/encrypted-media-adapter.md). A file is cut into frames,
// each its own AES-256-GCM box, so an adapter can decrypt only the frames a byte range touches — a player seeks and
// streams without the plaintext ever touching the disk. Same key model as a sealed record (src/crypt.js): the 16/32-byte
// secret of a tgx1./tgx2. key, or a record key from a seed. The metadata envelope (media type, name, size, …) is a frame
// of its own and is encrypted, so without the key a recipient learns nothing but the frame layout.
import { fail, utf8, concat, equalBytes, sha256, toHex } from './crypt-codec.js';
import { hkdf } from './keys.js';

const MAGIC = utf8('TGST1');            // 5 bytes
export const HEADER = 44;               // magic5 flags1 fileSalt16 frameSize4 frameCount4 totalSize8 metaCtLen2
const TAG = 16;
const META_COUNTER = 0xffffffffffffffffn;
export const DEFAULT_FRAME = 1 << 20;   // 1 MiB plaintext per data frame
const MIN_FRAME = 4 << 10, MAX_FRAME = 16 << 20;
const MAX_META = 64 << 10;              // plaintext metadata JSON, bytes
const FLAG_BOUND = 1;
const dec = new TextDecoder('utf-8', { fatal: true });

const u32 = (n) => Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
const rd32 = (b, o) => b[o] * 2 ** 24 + b[o + 1] * 2 ** 16 + b[o + 2] * 256 + b[o + 3];
function u64(n) { const a = new Uint8Array(8); let v = BigInt(n); for (let i = 7; i >= 0; i--) { a[i] = Number(v & 255n); v >>= 8n; } return a; }
function rd64(b, o) { let v = 0n; for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(b[o + i]); return v; }
const nonceOf = (counter) => concat(new Uint8Array(4), u64(counter)); // 12 bytes: 0x00000000 || counter (8 BE)

async function frameKey(secret, fileSalt, workDigest) {
  if (!(secret instanceof Uint8Array) || ![16, 32].includes(secret.length)) throw fail('bad-option', 'The secret is 16 or 32 bytes');
  const raw = await hkdf(secret, concat(utf8('tgst1/key'), fileSalt), concat(utf8('tgst1/aes-256-gcm'), workDigest ?? new Uint8Array(0)), 32);
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Canonical JSON of the metadata envelope: only the known fields, in a fixed order, so the bytes are deterministic. */
function metaJson({ media, size, name, created, title, sha256: sha }) {
  if (typeof media !== 'string' || !media || media.length > 255) throw fail('bad-option', 'media is the MIME type, a short string');
  const m = { media, size };
  if (name != null) m.name = String(name).slice(0, 255);
  if (created != null) m.created = String(created).slice(0, 64);
  if (title != null) m.title = String(title).slice(0, 255);
  if (sha != null) m.sha256 = String(sha);
  const order = ['media', 'size', 'name', 'created', 'title', 'sha256'];
  const bytes = utf8(JSON.stringify(Object.fromEntries(order.filter((k) => m[k] !== undefined).map((k) => [k, m[k]]))));
  if (bytes.length > MAX_META) throw fail('too-large', `The metadata is longer than ${MAX_META} bytes`);
  return bytes;
}

/**
 * Seals `bytes` as a `tgst1` stream file.
 * @param {object} o
 * @param {Uint8Array} o.secret        16 or 32 bytes (the secret of a tgx1./tgx2. key, or a record key)
 * @param {Uint8Array} [o.workDigest]  bind the stream to a work (its SHA-256); omit for an unbound stream
 * @param {Uint8Array} o.bytes         the plaintext
 * @param {string} o.media             the MIME type (required)
 * @param {string} [o.name] @param {string} [o.created] @param {string} [o.title]
 * @param {boolean} [o.sha=true]       store the plaintext SHA-256 in the metadata (a stable id)
 * @param {number} [o.frameSize]       plaintext bytes per data frame (default 1 MiB)
 * @param {function} [o.random]        fills a Uint8Array with random bytes (tests); default Web Crypto
 * @returns {Promise<Uint8Array>} the stream file
 */
export async function sealStream(o) {
  const bytes = o.bytes;
  if (!(bytes instanceof Uint8Array)) throw fail('bad-option', 'bytes is required');
  const frameSize = Math.min(MAX_FRAME, Math.max(MIN_FRAME, o.frameSize || DEFAULT_FRAME));
  const total = bytes.length;
  const frameCount = Math.ceil(total / frameSize); // 0 for an empty file
  if (frameCount > 0xffffffff) throw fail('too-large', 'The file needs more frames than the format allows');
  const random = o.random ?? ((a) => crypto.getRandomValues(a));
  const fileSalt = new Uint8Array(16); random(fileSalt);
  const workDigest = o.workDigest ?? null;
  const key = await frameKey(o.secret, fileSalt, workDigest);

  const meta = metaJson({
    media: o.media, size: total, name: o.name, created: o.created, title: o.title,
    sha256: o.sha === false ? undefined : toHex(await sha256(bytes)),
  });
  const metaCtLen = meta.length + TAG;
  if (metaCtLen > 0xffff) throw fail('too-large', 'The metadata is too large');

  const header = new Uint8Array(HEADER);
  header.set(MAGIC, 0);
  header[5] = workDigest ? FLAG_BOUND : 0;
  header.set(fileSalt, 6);
  header.set(u32(frameSize), 22);
  header.set(u32(frameCount), 26);
  header.set(u64(total), 34);
  header[42] = (metaCtLen >> 8) & 255; header[43] = metaCtLen & 255;

  const enc = async (counter, plain) => new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonceOf(counter), additionalData: concat(header, u64(counter)), tagLength: 128 }, key, plain));

  const parts = [header, await enc(META_COUNTER, meta)];
  for (let i = 0; i < frameCount; i++) parts.push(await enc(BigInt(i), bytes.subarray(i * frameSize, Math.min(total, (i + 1) * frameSize))));
  return concat(...parts);
}

/**
 * Reads a `tgst1` stream file. Parses the clear header on construction (no key needed), then `open(secret)` decrypts the
 * metadata frame, and `frame(i)` / `readRange(start, end)` decrypt only the frames a byte range touches.
 */
export class StreamReader {
  constructor(file) {
    if (!(file instanceof Uint8Array) || file.length < HEADER || !equalBytes(file.subarray(0, 5), MAGIC)) throw fail('bad-prefix', 'Not a tgst1 stream file');
    this.file = file;
    this.header = file.subarray(0, HEADER);
    this.bound = (file[5] & FLAG_BOUND) !== 0;
    this.fileSalt = file.subarray(6, 22);
    this.frameSize = rd32(file, 22);
    this.frameCount = rd32(file, 26);
    this.size = Number(rd64(file, 34));
    this.metaCtLen = (file[42] << 8) | file[43];
    if (this.frameSize < MIN_FRAME || this.frameSize > MAX_FRAME) throw fail('damaged', 'The stream header is damaged (frame size)');
    if (this.frameCount !== Math.ceil(this.size / this.frameSize)) throw fail('damaged', 'The stream header is damaged (frame count does not match the size)');
    if (this.metaCtLen < TAG || this.metaCtLen > 0xffff) throw fail('damaged', 'The stream header is damaged (metadata length)');
    const expected = HEADER + this.metaCtLen + this.size + this.frameCount * TAG;
    if (file.length !== expected) throw fail('damaged', `The stream file is ${file.length > expected ? 'longer' : 'shorter'} than its header says (truncated or changed)`);
    this.key = null; this.meta = null;
  }

  async #dec(counter, ct) {
    try {
      return new Uint8Array(await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: nonceOf(counter), additionalData: concat(this.header, u64(counter)), tagLength: 128 }, this.key, ct));
    } catch { throw fail('bad-key', 'This key does not open the stream (or it was changed)'); }
  }

  /** Decrypts the metadata frame and returns the envelope. @param {Uint8Array} [workDigest] required if the stream is bound. */
  async open(secret, workDigest = null) {
    if (this.bound && !workDigest) throw fail('work-required', 'This stream is tied to a work: give the work');
    this.key = await frameKey(secret, this.fileSalt, this.bound ? workDigest : null);
    let meta;
    try { meta = JSON.parse(dec.decode(await this.#dec(META_COUNTER, this.file.subarray(HEADER, HEADER + this.metaCtLen)))); }
    catch (e) { if (e.name === 'CryptError') throw e; throw fail('damaged', 'The metadata is damaged'); }
    if (typeof meta?.media !== 'string' || meta.size !== this.size) throw fail('damaged', 'The metadata does not match the stream');
    this.meta = meta;
    return meta;
  }

  #frameBounds(i) {
    const off = HEADER + this.metaCtLen + i * (this.frameSize + TAG);
    const plain = i < this.frameCount - 1 ? this.frameSize : this.size - (this.frameCount - 1) * this.frameSize;
    return [off, plain + TAG];
  }

  /** The plaintext of data frame `i` (0-based). */
  async frame(i) {
    if (!this.key) throw fail('no-key', 'Open the stream first');
    if (!Number.isInteger(i) || i < 0 || i >= this.frameCount) throw fail('bad-option', 'frame out of range');
    const [off, len] = this.#frameBounds(i);
    return this.#dec(BigInt(i), this.file.subarray(off, off + len));
  }

  /** The plaintext bytes [start, end) — only the frames that range touches are decrypted. */
  async readRange(start = 0, end = this.size) {
    start = Math.max(0, Math.min(this.size, start | 0));
    end = Math.max(start, Math.min(this.size, end | 0));
    if (end === start || this.frameCount === 0) return new Uint8Array(0);
    const first = Math.floor(start / this.frameSize), last = Math.floor((end - 1) / this.frameSize);
    const out = new Uint8Array(end - start);
    let at = 0;
    for (let i = first; i <= last; i++) {
      const plain = await this.frame(i), base = i * this.frameSize;
      const a = Math.max(start, base) - base, b = Math.min(end, base + plain.length) - base;
      out.set(plain.subarray(a, b), at); at += b - a;
    }
    return out;
  }
}
