// Sealed data in a Typographics Art work (docs/encrypted-data.md): authenticated encryption (AES-256-GCM, Web Crypto)
// of a structured-data block (TGD) or a message, with a key that fits exactly one work.
//
//   sealed record  "tgs1." + base64url(bytes)   public: it can sit in a file, in a work's text, on a content-addressed store
//   key            "tgx1." + base58(bytes)      secret: 16 or 32 random bytes (+ the first 8 bytes of the work's fingerprint,
//                                               + optionally the whole record, so that the key alone carries the data)
//   password       no key string: PBKDF2-HMAC-SHA256 stretches it (salt and iterations stand in the record)
//
// Grammar and byte layouts: docs/key-format.md. Everything here is pure, async, and throws only CryptError.
import { canonicalText } from './secret.js';
import { decode as decodeTgd, stripText } from './structured.js';
import {
  CryptError, fail, utf8, concat, equalBytes, sha256, b64urlEncode, b64urlDecode, b58Encode, b58Decode, varint, readVarint,
  checksum, deflateRaw, inflateRaw, brotliCompress, brotliDecompress,
} from './crypt-codec.js';

export { CryptError };
export const RECORD_PREFIX = 'tgs1.';
export const KEY_PREFIX = 'tgx1.';
export const BLOCK_OPEN = 'TGS1[';
export const BLOCK_CLOSE = ']TGS1';
export const KIND = { tgd: 1, text: 2, bytes: 3 };
const KIND_NAME = { 1: 'tgd', 2: 'text', 3: 'bytes' };

export const LIMITS = {
  maxPlain: 16 * 1024 * 1024,   // after unpacking
  maxRecord: 24 * 1024 * 1024,  // sealed record, bytes
  maxInlineRecord: 32 * 1024,   // a key may carry at most this many record bytes (base58 conversion is quadratic)
  maxIterations: 5_000_000,
  minIterations: 100_000,
};
/** Longest valid key string, from the limits: prefix + base58 of (version, flags, 32-byte secret, fingerprint, the largest inline record, check). */
export const MAX_KEY_CHARS = KEY_PREFIX.length + Math.ceil((2 + 32 + 8 + LIMITS.maxInlineRecord + 2) * Math.log(256) / Math.log(58)) + 2;
/** Longest valid record string: prefix + base64url of the largest record. */
export const MAX_RECORD_CHARS = RECORD_PREFIX.length + Math.ceil(LIMITS.maxRecord * 4 / 3) + 4;
export const DEFAULT_ITERATIONS = 600_000; // OWASP 2023 for PBKDF2-HMAC-SHA256

// record flags
const F_BOUND = 1, F_DEFLATE = 2, F_PBKDF2 = 4, F_BROTLI = 8, F_RESERVED = 0xf0;
// key flags
const K_BOUND = 1, K_INLINE = 2, K_SECRET16 = 4, K_RESERVED = 0xf8;

// ---- the work ----------------------------------------------------------------------------------------------------
/** SHA-256 of the work's canonical text (src/secret.js): what a key is bound to. */
export async function workDigest(workText) {
  if (typeof workText !== 'string') throw fail('work-required', 'This key is tied to a work: give the work (its text)');
  return sha256(utf8(canonicalText(workText)));
}

// ---- key derivation ----------------------------------------------------------------------------------------------
async function contentKey(ikm, workDigestBytes) {
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: utf8('tgx1/salt'), info: concat(utf8('tgx1/aes-256-gcm'), workDigestBytes ?? new Uint8Array(0)) },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}
async function stretch(password, salt, iterations) {
  const pw = await crypto.subtle.importKey('raw', utf8(String(password).normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, pw, 256));
}
const randomBytes = (n, random) => { const a = new Uint8Array(n); random(a); return a; };
const defaultRandom = (a) => crypto.getRandomValues(a);

// ---- sealing -----------------------------------------------------------------------------------------------------
/**
 * Seals data for a work.
 * @param {string|null} workText  the text of the work (anything the work's text can be read from); null with bind:false
 * @param {{kind:'tgd'|'text'|'bytes', payload:Uint8Array}} item
 * @param {object} [o]
 * @param {boolean} [o.bind=true]       tie the key to this work (a key then fails on any other work)
 * @param {128|256} [o.strength=256]    secret length in bits (ignored with a password)
 * @param {boolean} [o.inline=false]    the key also carries the record (one string holds everything)
 * @param {string}  [o.password]        use a password instead of a random secret; the result has no key string
 * @param {number}  [o.iterations]      PBKDF2 iterations (default 600 000)
 * @param {boolean|'deflate'|'brotli'} [o.compress=true]  raw deflate (true) or brotli before encrypting, kept only when smaller; false = none
 * @param {number}  [o.pad=0]           pad the plaintext up to a multiple of this many bytes (hides the exact length)
 * @param {function} [o.random]         fills a Uint8Array with random bytes (tests); default Web Crypto
 * @returns {Promise<{key:string|null, record:string, bytes:Uint8Array, stats:object}>}
 */
export async function sealItem(workText, item, o = {}) {
  const { bind = true, strength = 256, inline = false, password, compress = true, pad = 0, random = defaultRandom } = o;
  const iterations = o.iterations ?? DEFAULT_ITERATIONS;
  if (!KIND_NAME[KIND[item.kind]]) throw fail('bad-kind', `Unknown kind ${item.kind}`);
  if (![128, 256].includes(strength)) throw fail('bad-option', 'strength is 128 or 256');
  if (password !== undefined && (typeof password !== 'string' || !password)) throw fail('bad-option', 'The password is empty');
  if (password !== undefined && inline) throw fail('bad-option', 'A password has no key string to carry the record');
  if (!Number.isInteger(pad) || pad < 0 || pad > 65536) throw fail('bad-option', 'pad is 0 to 65536');
  if (password !== undefined && (!Number.isInteger(iterations) || iterations < LIMITS.minIterations || iterations > LIMITS.maxIterations)) throw fail('bad-option', `iterations is ${LIMITS.minIterations} to ${LIMITS.maxIterations}`);
  if (item.payload.length > LIMITS.maxPlain) throw fail('too-large', 'The data is too large');

  const digest = bind ? await workDigest(workText) : null;
  if (![true, false, 'deflate', 'brotli'].includes(compress)) throw fail('bad-option', "compress is true, false, 'deflate' or 'brotli'");
  let body = item.payload, deflated = false, brotli = false;
  if (compress) {
    const useBrotli = compress === 'brotli';
    const packed = useBrotli ? await brotliCompress(item.payload) : await deflateRaw(item.payload);
    if (packed.length < item.payload.length) { body = packed; deflated = !useBrotli; brotli = useBrotli; }
  }
  const data = concat(Uint8Array.of(KIND[item.kind]), body);
  let plain = concat(varint(data.length), data);
  if (pad) plain = concat(plain, new Uint8Array((pad - (plain.length % pad)) % pad));

  let flags = (bind ? F_BOUND : 0) | (deflated ? F_DEFLATE : 0) | (brotli ? F_BROTLI : 0) | (password !== undefined ? F_PBKDF2 : 0);
  let secret = null, kdf = new Uint8Array(0), ikm;
  if (password !== undefined) {
    const salt = randomBytes(16, random);
    kdf = concat(salt, varint(iterations));
    ikm = await stretch(password, salt, iterations);
  } else {
    secret = randomBytes(strength / 8, random);
    ikm = secret;
  }
  const head = concat(Uint8Array.of(1, flags), kdf);
  const nonce = randomBytes(12, random);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: concat(utf8('tgs1'), head), tagLength: 128 }, await contentKey(ikm, digest), plain));
  const bytes = concat(head, nonce, ct);
  const record = RECORD_PREFIX + b64urlEncode(bytes);

  let key = null;
  if (secret) {
    if (inline && bytes.length > LIMITS.maxInlineRecord) throw fail('too-large', `A key can carry at most ${LIMITS.maxInlineRecord} bytes of record; this one has ${bytes.length}. Keep the record separate.`);
    const kflags = (bind ? K_BOUND : 0) | (inline ? K_INLINE : 0) | (strength === 128 ? K_SECRET16 : 0);
    const raw = concat(Uint8Array.of(1, kflags), secret, bind ? digest.slice(0, 8) : new Uint8Array(0), inline ? bytes : new Uint8Array(0));
    key = KEY_PREFIX + b58Encode(concat(raw, await checksum('tgx1', raw)));
  }
  return { key, record, bytes, stats: { plainBytes: item.payload.length, compressed: deflated || brotli, method: brotli ? 'brotli' : deflated ? 'deflate' : 'none', recordBytes: bytes.length, recordChars: record.length, keyChars: key ? key.length : 0 } };
}

/** Seals a TGD data block (`TGD1[...]TGD1`, the encoder's output) for a work. */
export async function sealData(workText, tgdBlockText, o) {
  // Whitespace is not significant in a block, so the block is stored without any: one canonical text per block.
  const body = stripFrame(tgdBlockText);
  // Never seal what cannot be opened again: a block the decoder refuses (a wrong checksum, nesting deeper than 64 levels, more than
  // 4 million values, ...) would give a sealed record whose key opens it and then reports not-tgd. The encoder only writes readable blocks;
  // this guards blocks that come from elsewhere.
  try { await decodeTgd(BLOCK_TGD_OPEN + body + BLOCK_TGD_CLOSE); } catch (e) { throw fail('not-tgd', `This data block cannot be read back, so it is not sealed: ${e.message}`); }
  return sealItem(workText, { kind: 'tgd', payload: utf8(body) }, o);
}
/** Seals a message (text) for a work. */
export const sealMessage = (workText, message, o) => sealItem(workText, { kind: 'text', payload: utf8(String(message).normalize('NFC')) }, o);
/** Seals arbitrary bytes for a work. */
export const sealBytes = (workText, bytes, o) => sealItem(workText, { kind: 'bytes', payload: bytes }, o);

function stripFrame(block) {
  const s = stripText(block);
  if (!s.startsWith('TGD1[') || !s.endsWith(']TGD1')) throw fail('not-tgd', 'This is not a TGD data block (it must start with "TGD1[" and end with "]TGD1")');
  return s.slice(5, -5);
}

// ---- parsing keys and records -----------------------------------------------------------------------------------
/** Normalises text that was copied around: trims, and removes whitespace inside (a chat app may wrap a long key). */
const squeeze = (s) => String(s).replace(/\s+/g, '');

/**
 * Parses a key string without needing the work.
 * @returns {Promise<{secret:Uint8Array, bound:boolean, fp:Uint8Array|null, inline:Uint8Array|null, strength:number}>}
 * @throws {CryptError} no-key, bad-prefix, damaged, checksum, version
 */
export async function parseKey(key) {
  if (typeof key === 'string' && key.length > 4 * MAX_KEY_CHARS) throw fail('damaged', 'The key is too long to be a key');
  const k = squeeze(key ?? '');
  if (!k) throw fail('no-key', 'Paste the key first (it starts with "tgx1.")');
  if (k.length > MAX_KEY_CHARS) throw fail('damaged', 'The key is too long to be a key');
  if (!k.startsWith(KEY_PREFIX)) throw fail('bad-prefix', 'Not a sealed-data key (it starts with "tgx1.")');
  let raw;
  try { raw = b58Decode(k.slice(KEY_PREFIX.length), MAX_KEY_CHARS); } catch { throw fail('damaged', 'The key is damaged (a character that does not belong to a key)'); }
  if (b58Encode(raw) !== k.slice(KEY_PREFIX.length)) throw fail('damaged', 'The key is damaged');
  if (raw.length < 2 + 16 + 2) throw fail('damaged', 'The key is too short');
  const body = raw.slice(0, -2);
  if (!equalBytes(raw.slice(-2), await checksum('tgx1', body))) throw fail('checksum', 'The key has a typing error (its check characters do not match)');
  if (body[0] !== 1) throw fail('version', `This key has format version ${body[0]}; this reader understands 1`);
  const f = body[1];
  if (f & K_RESERVED) throw fail('damaged', 'The key is damaged (unknown flags)');
  const sl = f & K_SECRET16 ? 16 : 32;
  const bound = !!(f & K_BOUND), inline = !!(f & K_INLINE);
  let at = 2 + sl;
  if (body.length < at + (bound ? 8 : 0)) throw fail('damaged', 'The key is too short');
  const secret = body.slice(2, at);
  const fp = bound ? body.slice(at, at + 8) : null;
  at += bound ? 8 : 0;
  const rec = inline ? body.slice(at) : null;
  if (!inline && body.length !== at) throw fail('damaged', 'The key is damaged (extra bytes)');
  if (inline && !rec.length) throw fail('damaged', 'The key says it carries a record but carries none');
  return { secret, bound, fp, inline: rec, strength: sl * 8 };
}

/** Parses a record string (`tgs1.…`, or a `TGS1[ … ]TGS1` block) into its fields; no key needed. */
export function parseRecord(text) {
  if (typeof text === 'string' && text.length > 4 * MAX_RECORD_CHARS) throw fail('too-large', 'The sealed record is too large');
  let s = squeeze(text ?? '');
  if (s.length > MAX_RECORD_CHARS + BLOCK_OPEN.length + BLOCK_CLOSE.length) throw fail('too-large', 'The sealed record is too large');
  if (s.startsWith(BLOCK_OPEN) && s.endsWith(BLOCK_CLOSE)) s = s.slice(BLOCK_OPEN.length, -BLOCK_CLOSE.length);
  if (!s) throw fail('no-record', 'The sealed record is missing');
  if (!s.startsWith(RECORD_PREFIX)) throw fail('bad-prefix', 'Not a sealed record (it starts with "tgs1.")');
  let bytes;
  try { bytes = b64urlDecode(s.slice(RECORD_PREFIX.length)); } catch { throw fail('damaged', 'The sealed record is damaged (a character that does not belong to it)'); }
  return parseRecordBytes(bytes);
}
export function parseRecordBytes(bytes) {
  if (bytes.length > LIMITS.maxRecord) throw fail('too-large', 'The sealed record is too large');
  if (bytes.length < 2 + 12 + 16 + 1) throw fail('damaged', 'The sealed record is too short');
  if (bytes[0] !== 1) throw fail('version', `This record has format version ${bytes[0]}; this reader understands 1`);
  const flags = bytes[1];
  if ((flags & F_RESERVED) || (flags & F_DEFLATE && flags & F_BROTLI)) throw fail('damaged', 'The sealed record is damaged (unknown flags)');
  let at = 2, salt = null, iterations = null;
  if (flags & F_PBKDF2) {
    if (bytes.length < at + 16 + 1) throw fail('damaged', 'The sealed record is too short');
    salt = bytes.slice(at, at + 16); at += 16;
    [iterations, at] = readVarint(bytes, at);
    if (iterations < LIMITS.minIterations || iterations > LIMITS.maxIterations) throw fail('damaged', 'The sealed record asks for an unreasonable iteration count');
  }
  if (bytes.length < at + 12 + 16 + 1) throw fail('damaged', 'The sealed record is too short');
  return { bytes, head: bytes.slice(0, at), nonce: bytes.slice(at, at + 12), ct: bytes.slice(at + 12), bound: !!(flags & F_BOUND), deflate: !!(flags & F_DEFLATE), brotli: !!(flags & F_BROTLI), pbkdf2: !!(flags & F_PBKDF2), salt, iterations };
}

// ---- opening -----------------------------------------------------------------------------------------------------
/**
 * Opens a sealed record.
 * @param {string|null} workText   the work's text (needed when the key/record is bound to a work)
 * @param {{key?:string, record?:string|Uint8Array, password?:string}} input  the key (or a password) and, unless the key carries it, the record
 * @param {{limits?:object}} [o]
 * @returns {Promise<{kind:'tgd'|'text'|'bytes', bytes:Uint8Array, text?:string, block?:object, inline:boolean}>}
 *   for kind 'tgd', `block` is the decoded TGD block (checksum verified), `text` the TGD body
 * @throws {CryptError} codes: no-key, bad-prefix, damaged, checksum, version, work-required, wrong-work, no-record, auth-failed, too-large, not-tgd
 */
export async function openSealed(workText, input, o = {}) {
  const maxPlain = o.limits?.maxPlain ?? LIMITS.maxPlain;
  let ikm, parsedKey = null;
  if (input.password !== undefined && input.key !== undefined && input.key !== '') throw fail('bad-option', 'Give a key or a password, not both');
  if (input.password === undefined) parsedKey = await parseKey(input.key);
  else if (typeof input.password !== 'string' || !input.password) throw fail('no-key', 'Type the password first');

  let rec;
  if (input.record !== undefined && input.record !== null && input.record !== '') rec = input.record instanceof Uint8Array ? parseRecordBytes(input.record) : parseRecord(input.record);
  else if (parsedKey?.inline) rec = parseRecordBytes(parsedKey.inline);
  else throw fail('no-record', 'This key does not carry the data: give the sealed record too');

  let digest = null;
  if (rec.bound) {
    digest = await workDigest(workText);
    if (parsedKey?.bound && !equalBytes(parsedKey.fp, digest.slice(0, 8))) throw fail('wrong-work', 'This key belongs to a different work (or the text was changed)', { wrongText: true });
    if (parsedKey && !parsedKey.bound) throw fail('auth-failed', 'The key does not open this record');
  } else if (parsedKey?.bound) throw fail('auth-failed', 'The key does not open this record');

  if (rec.pbkdf2) {
    if (input.password === undefined) throw fail('need-password', 'This record is sealed with a password, not a key');
    ikm = await stretch(input.password, rec.salt, rec.iterations);
  } else {
    if (!parsedKey) throw fail('need-key', 'This record is sealed with a key, not a password');
    ikm = parsedKey.secret;
  }
  let plain;
  try {
    plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.nonce, additionalData: concat(utf8('tgs1'), rec.head), tagLength: 128 }, await contentKey(ikm, digest), rec.ct));
  } catch {
    throw fail('auth-failed', rec.pbkdf2 ? 'Wrong password, a different work, or the record was changed' : 'Wrong key, a different work, or the record was changed');
  }
  // authenticated from here on: a malformed inner structure means a buggy sealer, but still never a crash
  const [len, at] = readVarintSafe(plain, 0);
  if (len < 1 || at + len > plain.length) throw fail('damaged', 'The sealed record is damaged (inner length)');
  if (plain.slice(at + len).some((b) => b !== 0)) throw fail('damaged', 'The sealed record is damaged (padding)');
  const kindName = KIND_NAME[plain[at]];
  if (!kindName) throw fail('damaged', 'The sealed record holds an unknown kind of data');
  const packed = plain.slice(at + 1, at + len);
  const bytes = rec.deflate ? await inflateRaw(packed, maxPlain) : rec.brotli ? await brotliDecompress(packed, maxPlain) : packed;
  if (bytes.length > maxPlain) throw fail('too-large', 'The data is too large');
  const out = { kind: kindName, bytes, inline: !!parsedKey?.inline && !(input.record) };
  if (kindName === 'text') {
    try { out.text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw fail('damaged', 'The sealed message is not valid text'); }
  } else if (kindName === 'tgd') {
    const body = new TextDecoder().decode(bytes);
    out.text = body;
    try { out.block = await decodeTgd(BLOCK_TGD_OPEN + body + BLOCK_TGD_CLOSE); } catch (e) { throw fail('not-tgd', `The opened data is not a valid TGD block: ${e.message}`); }
  }
  return out;
}
const BLOCK_TGD_OPEN = 'TGD1[', BLOCK_TGD_CLOSE = ']TGD1';
function readVarintSafe(bytes, at) { try { return readVarint(bytes, at); } catch { throw fail('damaged', 'The sealed record is damaged (inner length)'); } }

/** The data of a work's sealed blocks (`TGS1[ … ]TGS1`) found in its text, whitespace-tolerant. */
export function findSealedBlocks(text, max = 64) {
  const s = stripText(text);
  const out = [];
  for (let from = s.indexOf(BLOCK_OPEN); from >= 0;) {
    const close = s.indexOf(BLOCK_CLOSE, from + BLOCK_OPEN.length);
    if (close < 0) throw fail('unterminated', 'A sealed block starts but does not end');
    if (out.length >= max) throw fail('too-large', `More than ${max} sealed blocks`);
    out.push(s.slice(from + BLOCK_OPEN.length, close));
    from = s.indexOf(BLOCK_OPEN, close + BLOCK_CLOSE.length);
  }
  return out;
}

/** What a record shows without any key: size and mode only (for UIs that must explain what they hold). */
export function describeRecord(text) {
  const r = parseRecord(text);
  return { bytes: r.bytes.length, bound: r.bound, compressed: r.deflate || r.brotli, method: r.brotli ? 'brotli' : r.deflate ? 'deflate' : 'none', password: r.pbkdf2, iterations: r.iterations };
}

/** SHA-256 of a record's bytes: its commitment on a chain (src/crypt-chain.js). */
export async function recordDigest(record) {
  return sha256(record instanceof Uint8Array ? record : parseRecord(record).bytes);
}
