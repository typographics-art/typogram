// The compact book-cipher key "tg2." (docs/key-format.md): the same idea as src/secret.js ("tg1."), the same text
// fingerprint, but positions are bit-packed (fixed width = ceil(log2 text length)) or Rice-coded as distances
// (when the encoder picks occurrences near the previous one), the alphabet is base58 and a 2-byte check catches typing
// errors. Like tg1 this is OBFUSCATION, not encryption (see docs/encrypted-data.md section 3): use src/crypt.js
// for anything that must stay secret.
import { canonicalText } from './secret.js';
import { normalizeText, graphemes } from './layout.js';
import {
  fail, concat, equalBytes, sha256, utf8, b58Encode, b58Decode, varint, readVarint, checksum, BitWriter, BitReader, riceWrite,
  riceRead, riceBits,
} from './crypt-codec.js';

export const BOOK_PREFIX = 'tg2.';
const MAX_CHARS = 2048; // longest secret a compact key may hold (longer ones: seal them, src/crypt.js)
/** Longest valid tg2 key: prefix + base58 of (flags, 8-byte fingerprint, 2-byte count, MAX_CHARS positions of at most 32 bits, check). */
export const MAX_COMPACT_KEY_CHARS = 4 + Math.ceil((1 + 8 + 2 + (MAX_CHARS * 32) / 8 + 2) * Math.log(256) / Math.log(58)) + 2;
/** Longest tg1 key a reader will look at (the decoder is linear: 400 000 characters are the keys of messages of about 100 000 characters). */
export const MAX_TG1_KEY_CHARS = 400_000;

async function fingerprint(clusters) { return (await sha256(utf8(clusters.join('')))).slice(0, 8); }

function randomBelow(n, random) {
  const limit = Math.floor(0x100000000 / n) * n, buf = new Uint32Array(1);
  for (;;) { random(buf); if (buf[0] < limit) return buf[0] % n; }
}
const bitsFor = (n) => Math.max(1, Math.ceil(Math.log2(n)));

/**
 * Chooses one position per character of the secret.
 * `near` = Infinity: uniformly among all occurrences (as tg1). `near` = K: uniformly among the next K occurrences after the
 * previous position (wrapping round), so that the distances are short and the key is short, at the price of
 * unpredictability (docs/key-format.md section 3: measured).
 */
export function choosePositions(clusters, wanted, { near = Infinity, random = (a) => crypto.getRandomValues(a) } = {}) {
  const where = new Map();
  clusters.forEach((c, i) => { if (!where.has(c)) where.set(c, []); where.get(c).push(i); });
  const missing = [...new Set(wanted.filter((c) => !where.has(c)))];
  if (missing.length) throw fail('missing', `Not in the text: ${missing.map((c) => JSON.stringify(c)).join(' ')}`, { missing });
  const N = clusters.length;
  let prev = -1;
  return wanted.map((c) => {
    const list = where.get(c);
    let pos;
    if (!Number.isFinite(near) || near >= list.length) pos = list[randomBelow(list.length, random)];
    else {
      // first occurrence strictly after prev (cyclic), then the next near-1 ones
      let lo = 0, hi = list.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid] > prev) hi = mid; else lo = mid + 1; }
      pos = list[(lo + randomBelow(near, random)) % list.length];
    }
    prev = pos;
    return pos;
  });
}

const gaps = (positions, N) => { let prev = -1; return positions.map((p) => { const d = (((p - prev - 1) % N) + N) % N; prev = p; return d; }); };

/** Encodes positions for a text of N clusters; picks the shorter of fixed width and Rice distances. */
export function packPositions(positions, N) {
  const width = bitsFor(N);
  const fixed = new BitWriter();
  for (const p of positions) fixed.bits(p, width);
  const d = gaps(positions, N);
  let bestK = 0, bestBits = Infinity;
  for (let k = 0; k <= 31; k++) { let b = 0; for (const x of d) b += riceBits(x, k); if (b < bestBits) { bestBits = b; bestK = k; } }
  if (bestBits < positions.length * width) {
    const w = new BitWriter();
    for (const x of d) riceWrite(w, x, bestK);
    return { mode: 1, param: bestK, bits: w.finish() };
  }
  return { mode: 0, param: width - 1, bits: fixed.finish() };
}

/**
 * Hides `secret` in the public text of a work.
 * @param {{near?:number, shortFingerprint?:boolean, random?:function}} [o]  shortFingerprint: 4 instead of 8 fingerprint bytes
 * @returns {Promise<string>} "tg2.<base58>"
 */
export async function hideCompact(publicText, secret, o = {}) {
  const clusters = graphemes(canonicalText(publicText));
  const wanted = graphemes(normalizeText(String(secret).normalize('NFC')));
  if (!wanted.length) throw fail('empty-secret', 'The secret is empty');
  if (wanted.length > MAX_CHARS) throw fail('too-large', 'The secret is too long for a compact key');
  const positions = choosePositions(clusters, wanted, o);
  const N = clusters.length;
  const { mode, param, bits } = packPositions(positions, N);
  const fp = await fingerprint(clusters);
  const fp4 = !!o.shortFingerprint;
  const flags = mode | (fp4 ? 2 : 0) | (param << 2);
  const raw = concat(Uint8Array.of(flags), fp.slice(0, fp4 ? 4 : 8), varint(wanted.length), bits);
  return BOOK_PREFIX + b58Encode(concat(raw, await checksum('tg2', raw)));
}

/** Reads a compact key back against the work it was made for. */
export async function revealCompact(publicText, key) {
  if (typeof key === 'string' && key.length > 4 * MAX_COMPACT_KEY_CHARS) throw fail('damaged', 'The key is too long to be a key');
  const k = String(key ?? '').replace(/\s+/g, '');
  if (!k) throw fail('no-key', 'Paste the key first (it starts with "tg2.")');
  if (k.length > MAX_COMPACT_KEY_CHARS) throw fail('damaged', 'The key is too long to be a key');
  if (!k.startsWith(BOOK_PREFIX)) throw fail('bad-prefix', 'Not a compact Typographics Art key (it starts with "tg2.")');
  let raw;
  try { raw = b58Decode(k.slice(BOOK_PREFIX.length), MAX_COMPACT_KEY_CHARS); } catch { throw fail('damaged', 'The key is damaged'); }
  if (b58Encode(raw) !== k.slice(BOOK_PREFIX.length) || raw.length < 1 + 4 + 1 + 1 + 2) throw fail('damaged', 'The key is damaged');
  const body = raw.slice(0, -2);
  if (!equalBytes(raw.slice(-2), await checksum('tg2', body))) throw fail('checksum', 'The key has a typing error (its check characters do not match)');
  const flags = body[0];
  if (flags & 0x80) throw fail('damaged', 'The key is damaged (unknown flags)');
  const mode = flags & 1, fpLen = flags & 2 ? 4 : 8, param = flags >> 2;
  if (body.length < 1 + fpLen + 2) throw fail('damaged', 'The key is damaged');
  const clusters = graphemes(canonicalText(publicText));
  const fp = await fingerprint(clusters);
  if (!equalBytes(fp.slice(0, fpLen), body.slice(1, 1 + fpLen))) throw fail('wrong-text', 'This key belongs to a different work (or the text was changed)', { wrongText: true });
  const [count, at] = readVarint(body, 1 + fpLen);
  if (count < 1 || count > MAX_CHARS) throw fail('damaged', 'The key is damaged');
  const N = clusters.length, r = new BitReader(body, at);
  const out = [];
  let prev = -1;
  for (let i = 0; i < count; i++) {
    let p;
    if (mode === 0) { p = r.bits(param + 1); } else { const d = riceRead(r, param, N + 2); p = (prev + 1 + d) % N; }
    if (p >= N) throw fail('damaged', 'The key is damaged');
    out.push(clusters[p]);
    prev = p;
  }
  return out.join('');
}

/** tg1 or tg2, by prefix. */
export async function revealAny(publicText, key) {
  if (typeof key === 'string' && key.length > 4 * MAX_TG1_KEY_CHARS) throw fail('damaged', 'The key is too long to be a key');
  const k = String(key ?? '').trim();
  if (k.length > MAX_TG1_KEY_CHARS && !k.startsWith(BOOK_PREFIX)) throw fail('damaged', 'The key is too long to be a key');
  if (k.startsWith(BOOK_PREFIX)) return revealCompact(publicText, k);
  const { revealSecret } = await import('./secret.js');
  try { return await revealSecret(publicText, k); } catch (e) {
    if (e?.code) throw fail(e.code, e.message, e.wrongText ? { wrongText: true } : undefined);
    throw fail('damaged', 'The key is damaged');
  }
}
