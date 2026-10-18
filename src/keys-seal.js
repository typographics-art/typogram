// Sealing to the owner of a public key (docs/key-management.md section 4): ECIES with X25519, an ephemeral key per
// record, HKDF-SHA-256 with domain separation and both public keys in the salt, AES-256-GCM with the header and an
// optional context authenticated. Web Crypto only (X25519: Node 20+ here tested on 26, Chrome 133+, Firefox 130+,
// Safari 17+; see docs/cipher-review.md for what is measured and what is cited).
//
//   recipient public key  "tgp1." + base58(version, 32-byte X25519 key, 2-byte check)     public
//   recipient secret key  "tgq1." + base58(version, 32-byte secret, 2-byte check)         secret (or derived: keys.js recipientSecret)
//   sealed record         "tgr1." + base64url(version, flags, ephemeral key 32, nonce 12, ciphertext + tag)   public
//
// The sender is not authenticated: anybody who knows the public key can seal to it. Throws only CryptError.
import { fail, utf8, concat, equalBytes, b58Encode, b58Decode, b64urlEncode, b64urlDecode, checksum, varint, deflateRaw, inflateRaw } from './crypt-codec.js';
import { hkdf } from './keys.js';

export const PUBLIC_PREFIX = 'tgp1.', SECRET_PREFIX = 'tgq1.', RECORD_PREFIX = 'tgr1.';
const KIND = { tgd: 1, text: 2, bytes: 3 }, KIND_NAME = { 1: 'tgd', 2: 'text', 3: 'bytes' };
export const LIMITS = { maxPlain: 16 * 1024 * 1024, maxRecord: 24 * 1024 * 1024, maxContext: 512 };
const F_DEFLATE = 1, F_RESERVED = 0xfe;
const PKCS8_X25519 = Uint8Array.of(0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20);

const squeeze = (s) => String(s ?? '').replace(/\s+/g, '');
async function encodeKey(prefix, domain, bytes) { const body = concat(Uint8Array.of(1), bytes); return prefix + b58Encode(concat(body, await checksum(domain, body))); }
async function decodeKey(text, prefix, domain, what) {
  const t = squeeze(text);
  if (!t) throw fail('no-key', `Give the ${what} first (it starts with "${prefix}")`);
  if (t.length > 128) throw fail('damaged', `This is too long to be a ${what}`);
  if (!t.startsWith(prefix)) throw fail('bad-prefix', `Not a ${what} (it starts with "${prefix}")`);
  let raw;
  try { raw = b58Decode(t.slice(prefix.length), 128); } catch { throw fail('damaged', `The ${what} is damaged`); }
  if (b58Encode(raw) !== t.slice(prefix.length) || raw.length !== 1 + 32 + 2) throw fail('damaged', `The ${what} is damaged`);
  if (!equalBytes(raw.slice(-2), await checksum(domain, raw.slice(0, -2)))) throw fail('checksum', `The ${what} has a typing error`);
  if (raw[0] !== 1) throw fail('version', `This ${what} has format version ${raw[0]}; this reader understands 1`);
  return raw.slice(1, 33);
}

const importSecret = (secret) => crypto.subtle.importKey('pkcs8', concat(PKCS8_X25519, secret), 'X25519', true, ['deriveBits']);
const importPublic = (pub) => crypto.subtle.importKey('raw', pub, 'X25519', true, []);
function need32(b, what) { if (!(b instanceof Uint8Array) || b.length !== 32) throw fail('bad-option', `${what} is 32 bytes`); }

/** The public key (32 bytes) of a 32-byte X25519 secret. */
export async function publicFromSecret(secret) {
  need32(secret, 'The secret');
  const jwk = await crypto.subtle.exportKey('jwk', await importSecret(secret));
  return b64urlDecode(jwk.x);
}
export const formatPublic = (pub) => { need32(pub, 'The public key'); return encodeKey(PUBLIC_PREFIX, 'tgp1', pub); };
export const formatSecret = (sec) => { need32(sec, 'The secret'); return encodeKey(SECRET_PREFIX, 'tgq1', sec); };
export const parsePublic = (text) => decodeKey(text, PUBLIC_PREFIX, 'tgp1', 'recipient public key');
export const parseSecret = (text) => decodeKey(text, SECRET_PREFIX, 'tgq1', 'recipient secret key');
/** A fresh random recipient key pair as text. */
export async function newRecipient(random = (a) => crypto.getRandomValues(a)) {
  const sec = new Uint8Array(32); random(sec);
  return { secret: await formatSecret(sec), public: await formatPublic(await publicFromSecret(sec)) };
}

const ctxBytes = (context) => {
  if (context === undefined || context === null || context === '') return new Uint8Array(0);
  const b = typeof context === 'string' ? utf8(context.normalize('NFC')) : context;
  if (!(b instanceof Uint8Array) || b.length > LIMITS.maxContext) throw fail('bad-option', `The context is text or bytes of at most ${LIMITS.maxContext} bytes`);
  return b;
};
const frame = (b) => concat(varint(b.length), b);
async function contentKey(secretBits, epk, rpk, ctx) {
  const k = await hkdf(secretBits, concat(epk, rpk), concat(utf8('tgr1/aes-256-gcm'), Uint8Array.of(0), frame(ctx)), 32);
  return crypto.subtle.importKey('raw', k, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function agree(secretKey, pubBytes) {
  let pub;
  try { pub = await importPublic(pubBytes); } catch { throw fail('damaged', 'The key is not a valid X25519 public key'); }
  let bits;
  try { bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'X25519', public: pub }, secretKey, 256)); } catch { throw fail('auth-failed', 'The key exchange failed (a weak or invalid public key)'); }
  if (bits.every((b) => b === 0)) throw fail('auth-failed', 'The key exchange failed (a weak or invalid public key)');
  return bits;
}

/**
 * Seals data to a recipient's public key.
 * @param {string} publicKey  "tgp1..." text
 * @param {{kind:'tgd'|'text'|'bytes', payload:Uint8Array}} item
 * @param {{context?:string|Uint8Array, compress?:boolean, random?:function}} [o]
 *   context: bytes both sides must supply again (a work digest, a record id); it is authenticated, never stored
 * @returns {Promise<{record:string, bytes:Uint8Array}>}
 */
export async function sealTo(publicKey, item, o = {}) {
  const { compress = true, random = (a) => crypto.getRandomValues(a) } = o;
  if (!KIND_NAME[KIND[item.kind]]) throw fail('bad-kind', `Unknown kind ${item.kind}`);
  if (item.payload.length > LIMITS.maxPlain) throw fail('too-large', 'The data is too large');
  const rpk = await parsePublic(publicKey), ctx = ctxBytes(o.context);
  let body = item.payload, flags = 0;
  if (compress) { const p = await deflateRaw(item.payload); if (p.length < body.length) { body = p; flags |= F_DEFLATE; } }
  const esec = new Uint8Array(32); random(esec);
  const epk = await publicFromSecret(esec);
  const shared = await agree(await importSecret(esec), rpk);
  esec.fill(0);
  const head = concat(Uint8Array.of(1, flags), epk);
  const nonce = new Uint8Array(12); random(nonce);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: concat(utf8('tgr1'), head, frame(ctx)), tagLength: 128 }, await contentKey(shared, epk, rpk, ctx), concat(Uint8Array.of(KIND[item.kind]), body)));
  const bytes = concat(head, nonce, ct);
  return { record: RECORD_PREFIX + b64urlEncode(bytes), bytes };
}
export const sealTextTo = (publicKey, text, o) => sealTo(publicKey, { kind: 'text', payload: utf8(String(text).normalize('NFC')) }, o);
export const sealBytesTo = (publicKey, bytes, o) => sealTo(publicKey, { kind: 'bytes', payload: bytes }, o);

/** Parses a record; no key needed. */
export function parseSealedTo(text) {
  const s = squeeze(text);
  if (!s) throw fail('no-record', 'The sealed record is missing');
  if (s.length > Math.ceil(LIMITS.maxRecord * 4 / 3) + 16) throw fail('too-large', 'The sealed record is too large');
  if (!s.startsWith(RECORD_PREFIX)) throw fail('bad-prefix', 'Not a record sealed to a key (it starts with "tgr1.")');
  let bytes;
  try { bytes = b64urlDecode(s.slice(RECORD_PREFIX.length)); } catch { throw fail('damaged', 'The sealed record is damaged'); }
  if (bytes.length < 2 + 32 + 12 + 1 + 16) throw fail('damaged', 'The sealed record is too short');
  if (bytes[0] !== 1) throw fail('version', `This record has format version ${bytes[0]}; this reader understands 1`);
  if (bytes[1] & F_RESERVED) throw fail('damaged', 'The sealed record is damaged (unknown flags)');
  return { bytes, head: bytes.slice(0, 34), flags: bytes[1], epk: bytes.slice(2, 34), nonce: bytes.slice(34, 46), ct: bytes.slice(46) };
}

/**
 * Opens a record sealed to your public key.
 * @param {string|Uint8Array} secret  "tgq1..." text or the 32 secret bytes (keys.js recipientSecret)
 * @throws {CryptError} no-key, bad-prefix, damaged, checksum, version, auth-failed (wrong key, wrong context, or changed record)
 */
export async function openFrom(secret, record, o = {}) {
  const sec = secret instanceof Uint8Array ? secret : await parseSecret(secret);
  need32(sec, 'The secret');
  const rec = parseSealedTo(record), ctx = ctxBytes(o.context);
  const maxPlain = o.limits?.maxPlain ?? LIMITS.maxPlain;
  const skey = await importSecret(sec);
  const rpk = b64urlDecode((await crypto.subtle.exportKey('jwk', skey)).x);
  const shared = await agree(skey, rec.epk);
  let plain;
  try { plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.nonce, additionalData: concat(utf8('tgr1'), rec.head, frame(ctx)), tagLength: 128 }, await contentKey(shared, rec.epk, rpk, ctx), rec.ct)); } catch { throw fail('auth-failed', 'Wrong key, wrong context, or the record was changed'); }
  const kind = KIND_NAME[plain[0]];
  if (!kind) throw fail('damaged', 'The sealed record holds an unknown kind of data');
  const bytes = rec.flags & F_DEFLATE ? await inflateRaw(plain.slice(1), maxPlain) : plain.slice(1);
  if (bytes.length > maxPlain) throw fail('too-large', 'The data is too large');
  const out = { kind, bytes };
  if (kind !== 'bytes') { try { out.text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw fail('damaged', 'The sealed message is not valid text'); } }
  return out;
}
