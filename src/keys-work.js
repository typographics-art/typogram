// Hidden work binding (docs/key-management.md section 5): key version `tgx2.`. A `tgx1.` key carries the first 8 bytes
// of the work's SHA-256 in the clear, so anybody with a list of candidate works can see WHICH work it belongs to. A
// `tgx2.` key carries instead a 4-byte tag HMAC-SHA-256(secret, "tgx2/work" || SHA-256(work text)) that only the
// holder of the key can test. The sealed record (`tgs1.`) is unchanged: it is built, and opened, by src/crypt.js.
//
// Also here: sealing and opening with a secret that is given (a per-record key from keys.js, or a mixed key from
// keys-split.js) instead of a fresh random one.
import { sealItem, openSealed, parseKey, parseRecord, parseRecordBytes, workDigest, KEY_PREFIX } from './crypt.js';
import { fail, utf8, concat, equalBytes, b58Encode, b58Decode, checksum } from './crypt-codec.js';
import { hmac } from './keys.js';

export const KEY2_PREFIX = 'tgx2.';
const K_BOUND = 1, K_INLINE = 2, K_SECRET16 = 4, K_RESERVED = 0xf8;
const TAG_BYTES = 4;
const MAX_INLINE = 32 * 1024;
export const MAX_KEY2_CHARS = KEY2_PREFIX.length + Math.ceil((2 + 32 + TAG_BYTES + MAX_INLINE + 2) * Math.log(256) / Math.log(58)) + 2;

const squeeze = (s) => String(s ?? '').replace(/\s+/g, '');
export async function workTag(secret, digest) { return (await hmac('SHA-256', secret, concat(utf8('tgx2/work'), digest))).slice(0, TAG_BYTES); }

/** Builds a `tgx2.` key from its parts. `digest` is the work's SHA-256 (or null for an unbound key). */
export async function formatKey2({ secret, digest = null, inline = null }) {
  if (!(secret instanceof Uint8Array) || ![16, 32].includes(secret.length)) throw fail('bad-option', 'The secret is 16 or 32 bytes');
  if (inline && inline.length > MAX_INLINE) throw fail('too-large', `A key can carry at most ${MAX_INLINE} bytes of record`);
  const flags = (digest ? K_BOUND : 0) | (inline ? K_INLINE : 0) | (secret.length === 16 ? K_SECRET16 : 0);
  const raw = concat(Uint8Array.of(2, flags), secret, digest ? await workTag(secret, digest) : new Uint8Array(0), inline ?? new Uint8Array(0));
  return KEY2_PREFIX + b58Encode(concat(raw, await checksum('tgx2', raw)));
}

/** Parses a `tgx2.` key without the work. @returns {{secret, bound, tag, inline, strength}} */
export async function parseKey2(key) {
  if (typeof key === 'string' && key.length > 4 * MAX_KEY2_CHARS) throw fail('damaged', 'The key is too long to be a key');
  const k = squeeze(key);
  if (!k) throw fail('no-key', 'Paste the key first (it starts with "tgx2.")');
  if (k.length > MAX_KEY2_CHARS) throw fail('damaged', 'The key is too long to be a key');
  if (!k.startsWith(KEY2_PREFIX)) throw fail('bad-prefix', 'Not a tgx2 key (it starts with "tgx2.")');
  let raw;
  try { raw = b58Decode(k.slice(KEY2_PREFIX.length), MAX_KEY2_CHARS); } catch { throw fail('damaged', 'The key is damaged (a character that does not belong to a key)'); }
  if (b58Encode(raw) !== k.slice(KEY2_PREFIX.length)) throw fail('damaged', 'The key is damaged');
  if (raw.length < 2 + 16 + 2) throw fail('damaged', 'The key is too short');
  const body = raw.slice(0, -2);
  if (!equalBytes(raw.slice(-2), await checksum('tgx2', body))) throw fail('checksum', 'The key has a typing error (its check characters do not match)');
  if (body[0] !== 2) throw fail('version', `This key has format version ${body[0]}; this reader understands 2`);
  const f = body[1];
  if (f & K_RESERVED) throw fail('damaged', 'The key is damaged (unknown flags)');
  const sl = f & K_SECRET16 ? 16 : 32, bound = !!(f & K_BOUND), inline = !!(f & K_INLINE);
  let at = 2 + sl;
  if (body.length < at + (bound ? TAG_BYTES : 0)) throw fail('damaged', 'The key is too short');
  const secret = body.slice(2, at), tag = bound ? body.slice(at, at + TAG_BYTES) : null;
  at += bound ? TAG_BYTES : 0;
  if (!inline && body.length !== at) throw fail('damaged', 'The key is damaged (extra bytes)');
  if (inline && body.length === at) throw fail('damaged', 'The key says it carries a record but carries none');
  return { secret, bound, tag, inline: inline ? body.slice(at) : null, strength: sl * 8 };
}

// ---- a tgx1-shaped key for the existing reader ---------------------------------------------------------------------
async function tgx1Key(secret, digest) {
  const raw = concat(Uint8Array.of(1, (digest ? K_BOUND : 0) | (secret.length === 16 ? K_SECRET16 : 0)), secret, digest ? digest.slice(0, 8) : new Uint8Array(0));
  return KEY_PREFIX + b58Encode(concat(raw, await checksum('tgx1', raw)));
}
function secretFrom(random, secret) {
  // sealItem asks for its secret first, then for the nonce: hand it ours first, real randomness after.
  let first = true;
  return (a) => { if (first) { first = false; if (a.length !== secret.length) throw fail('bad-option', 'internal: secret length'); a.set(secret); } else (random ?? ((x) => crypto.getRandomValues(x)))(a); return a; };
}

/**
 * Seals with a secret you already have (a per-record key from keys.js, a mixed key from keys-split.js).
 * @param {object} [o]  as sealItem (bind, compress, pad, strength follows the secret), plus `keyVersion: 2|1` for the printed key (default 2)
 * @returns {Promise<{key:string, record:string, bytes:Uint8Array, stats:object}>}
 */
export async function sealWithSecret(workText, item, secret, o = {}) {
  if (!(secret instanceof Uint8Array) || ![16, 32].includes(secret.length)) throw fail('bad-option', 'The secret is 16 or 32 bytes');
  const { keyVersion = 2, ...rest } = o;
  if (rest.password !== undefined) throw fail('bad-option', 'A given secret and a password cannot be combined here');
  const sealed = await sealItem(workText, item, { ...rest, strength: secret.length * 8, random: secretFrom(rest.random, secret) });
  const k1 = await parseKey(sealed.key);
  if (!equalBytes(k1.secret, secret)) throw fail('bad-option', 'internal: the given secret was not used');
  const digest = k1.bound ? await workDigest(workText) : null;
  const key = keyVersion === 2 ? await formatKey2({ secret, digest, inline: k1.inline }) : sealed.key;
  return { ...sealed, key };
}

/** Seals for a work with a fresh random secret and a `tgx2.` key (the work is not recognisable from the key). */
export async function sealBound2(workText, item, o = {}) {
  const strength = o.strength ?? 256;
  if (![128, 256].includes(strength)) throw fail('bad-option', 'strength is 128 or 256');
  const secret = new Uint8Array(strength / 8);
  (o.random ?? ((a) => crypto.getRandomValues(a)))(secret);
  const out = await sealWithSecret(workText, item, secret, { ...o, strength: undefined, random: undefined });
  return out;
}

/** Opens a record with a raw secret (and the work's text if the record is bound). */
export async function openWithSecret(workText, secret, record, o = {}) {
  if (!(secret instanceof Uint8Array) || ![16, 32].includes(secret.length)) throw fail('bad-option', 'The secret is 16 or 32 bytes');
  // Is the record bound? Its header says so; the synthesised key must match, or the reader refuses before decrypting.
  const parsed = record instanceof Uint8Array ? parseRecordBytes(record) : parseRecord(record);
  const digest = parsed.bound ? await workDigest(workText) : null;
  return openSealed(workText, { key: await tgx1Key(secret, digest), record: parsed.bytes }, o);
}

/**
 * Opens with a `tgx1.` or a `tgx2.` key. For `tgx2.`, a work whose tag does not match is refused as `wrong-work` BEFORE
 * any decryption, so the two kinds of error stay distinguishable for the holder of the key.
 * @param {{key:string, record?:string|Uint8Array}} input
 */
export async function openAny(workText, input, o = {}) {
  const key = squeeze(input.key);
  if (!key.startsWith(KEY2_PREFIX)) return openSealed(workText, input, o);
  const k = await parseKey2(key);
  let digest = null;
  if (k.bound) {
    digest = await workDigest(workText); // throws work-required
    if (!equalBytes(await workTag(k.secret, digest), k.tag)) throw fail('wrong-work', 'This key belongs to a different work (or the text was changed)', { wrongText: true });
  }
  const record = input.record !== undefined && input.record !== null && input.record !== '' ? input.record : k.inline;
  if (!record) throw fail('no-record', 'This key does not carry the data: give the sealed record too');
  const out = await openSealed(workText, { key: await tgx1Key(k.secret, digest), record }, o);
  return { ...out, inline: !!k.inline && !input.record };
}

/**
 * The rule "a human-chosen password is never the only secret of a record that is public, permanent or anchored":
 * call this before a record leaves the machine (publishing, anchoring, putting it in a work). A record sealed with a
 * password alone (flag PBKDF2 of src/crypt.js) is refused; `acceptPasswordOnly` is the explicit local-file escape.
 * @throws {CryptError} password-only-refused
 */
export function assertPublishable(record, { acceptPasswordOnly = false } = {}) {
  const r = typeof record === 'string' ? parseRecord(record) : parseRecordBytes(record);
  if (r.pbkdf2 && !acceptPasswordOnly) throw fail('password-only-refused', 'This record is protected by a password alone. A public record can be attacked offline for ever, so it is not published. Seal it with a random key (or a key plus a password) instead.');
  return true;
}
