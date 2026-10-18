// Key management (docs/key-management.md): a master secret from a user-held seed (BIP-39 words or hex), SLIP-21
// symmetric derivation (HMAC-SHA512 only), and one independent key per record (HKDF-SHA-256). Web Crypto only; no
// dependency; pure, async, throws only CryptError. Nothing here touches the wallet's signing keys: the seed enters a
// SLIP-21 tree whose root HMAC key ("Symmetric key seed") is not the BIP-32 one ("Bitcoin seed"), and every label path
// must start with "tgart", so no output can equal a BIP-32 / BIP-44 (m/44'/20'/...) node.
//
// Error messages never contain words, seeds or keys.
import { BIP39_ENGLISH } from './keys-wordlist-en.js';
import { fail, utf8, concat, equalBytes, sha256, b58Encode, b58Decode, checksum, varint, fromHex, toHex } from './crypt-codec.js';

export const MASTER_PREFIX = 'tgmk1.';
export const MASTER_LABELS = Object.freeze(['tgart', 'master', 'v1']);
// HKDF info is limited to 1024 bytes by Node's Web Crypto (measured: it throws OperationError beyond); the limits keep every info string below that.
export const LIMITS = { maxId: 512, maxContext: 256, maxLabel: 64, maxLabels: 8, maxMnemonicChars: 1024 };

// ---- HMAC / HKDF ---------------------------------------------------------------------------------------------------
export async function hmac(hash, key, data) {
  const k = await crypto.subtle.importKey('raw', key.length ? key : new Uint8Array(1), { name: 'HMAC', hash }, false, ['sign']);
  // Web Crypto refuses a zero-length HMAC key; HMAC pads a key with zero bytes anyway, so one zero byte is the same key.
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
export async function hkdf(ikm, salt, info, length = 32) {
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, base, length * 8));
}

// ---- BIP-39 ---------------------------------------------------------------------------------------------------------
const WORD_INDEX = new Map(BIP39_ENGLISH.map((w, i) => [w, i]));
/** Splits and normalises typed words (NFKD, lower case, any whitespace). */
const wordsOf = (text) => String(text ?? '').normalize('NFKD').toLowerCase().split(/\s+/).filter(Boolean);

/**
 * Checks a mnemonic and returns its entropy. Errors never quote the words.
 * @throws {CryptError} mnemonic-words (not 12/15/18/21/24 words), mnemonic-unknown-word, mnemonic-checksum, too-large
 * @returns {Promise<{words:number, entropy:Uint8Array}>}
 */
export async function mnemonicToEntropy(text) {
  if (typeof text === 'string' && text.length > LIMITS.maxMnemonicChars) throw fail('too-large', 'The mnemonic is too long');
  const words = wordsOf(text);
  if (![12, 15, 18, 21, 24].includes(words.length)) throw fail('mnemonic-words', 'A mnemonic has 12, 15, 18, 21 or 24 words');
  let bits = '';
  for (const w of words) {
    const i = WORD_INDEX.get(w);
    if (i === undefined) throw fail('mnemonic-unknown-word', 'A word is not in the BIP-39 English list (check the spelling)');
    bits += i.toString(2).padStart(11, '0');
  }
  const entBits = (words.length * 11 * 32) / 33, csBits = words.length * 11 - entBits;
  const entropy = Uint8Array.from(bits.slice(0, entBits).match(/.{8}/g), (b) => parseInt(b, 2));
  const want = [...(await sha256(entropy))[0].toString(2).padStart(8, '0')].slice(0, csBits).join('');
  if (bits.slice(entBits) !== want) throw fail('mnemonic-checksum', 'The words do not form a valid mnemonic (a word is wrong or misplaced)');
  return { words: words.length, entropy };
}
/** Makes a mnemonic from entropy (16, 20, 24, 28 or 32 bytes): for tools and tests; users bring their own seed. */
export async function entropyToMnemonic(entropy) {
  if (![16, 20, 24, 28, 32].includes(entropy.length)) throw fail('bad-option', 'Entropy is 16, 20, 24, 28 or 32 bytes');
  const csBits = entropy.length / 4;
  const bits = [...entropy].map((b) => b.toString(2).padStart(8, '0')).join('') + [...(await sha256(entropy))[0].toString(2).padStart(8, '0')].slice(0, csBits).join('');
  return bits.match(/.{11}/g).map((b) => BIP39_ENGLISH[parseInt(b, 2)]).join(' ');
}
/**
 * BIP-39 seed: PBKDF2-HMAC-SHA512(NFKD(words), "mnemonic" + NFKD(passphrase), 2048 iterations) -> 64 bytes.
 * The checksum is verified (a typo is refused, not turned into a different seed).
 */
export async function mnemonicToSeed(text, passphrase = '') {
  await mnemonicToEntropy(text);
  const phrase = wordsOf(text).join(' ');
  const pw = await crypto.subtle.importKey('raw', utf8(phrase), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-512', salt: utf8('mnemonic' + String(passphrase).normalize('NFKD')), iterations: 2048 }, pw, 512));
}
/** A seed given as hexadecimal (16 to 64 bytes), for people without a word list. */
export function seedFromHex(hex) {
  const h = String(hex ?? '').replace(/\s+/g, '');
  if (h.length < 32 || h.length > 128 || h.length % 2) throw fail('bad-seed', 'A hex seed is 16 to 64 bytes (32 to 128 hex characters)');
  return fromHex(h);
}

// ---- SLIP-21 --------------------------------------------------------------------------------------------------------
const SLIP21_ROOT_KEY = utf8('Symmetric key seed');
/** The SLIP-21 master node of a seed: `{chain, key}`, 32 bytes each. */
export async function slip21Master(seed) {
  if (!(seed instanceof Uint8Array) || seed.length < 16 || seed.length > 64) throw fail('bad-seed', 'The seed is 16 to 64 bytes');
  const i = await hmac('SHA-512', SLIP21_ROOT_KEY, seed);
  return { chain: i.slice(0, 32), key: i.slice(32) };
}
/** A SLIP-21 child: HMAC-SHA512(parent chain code, 0x00 || label). */
export async function slip21Child(node, label) {
  const l = typeof label === 'string' ? utf8(label) : label;
  if (!l.length || l.length > LIMITS.maxLabel) throw fail('bad-option', `A label is 1 to ${LIMITS.maxLabel} bytes`);
  const i = await hmac('SHA-512', node.chain, concat(Uint8Array.of(0), l));
  return { chain: i.slice(0, 32), key: i.slice(32) };
}
/** Derives a node below the "tgart" label only; any other first label is refused (the wallet's trees are never entered). */
export async function slip21Path(seed, labels) {
  if (!Array.isArray(labels) || !labels.length || labels.length > LIMITS.maxLabels || labels[0] !== 'tgart') throw fail('bad-option', 'Label paths must start with "tgart"');
  let node = await slip21Master(seed);
  for (const l of labels) node = await slip21Child(node, l);
  return node;
}

// ---- master secret and per-record keys -----------------------------------------------------------------------------
/** The master secret: the key of the SLIP-21 node tgart/master/v1 (32 bytes). Everything below derives from it. */
export async function masterFromSeed(seed) { return (await slip21Path(seed, MASTER_LABELS)).key; }

export const formatMaster = async (master) => MASTER_PREFIX + b58Encode(concat(Uint8Array.of(1), master, await checksum('tgmk1', concat(Uint8Array.of(1), master))));
export async function parseMaster(text) {
  const t = String(text ?? '').replace(/\s+/g, '');
  if (!t) throw fail('no-key', 'Give the master key first (it starts with "tgmk1.")');
  if (t.length > 128) throw fail('damaged', 'This is too long to be a master key');
  if (!t.startsWith(MASTER_PREFIX)) throw fail('bad-prefix', 'Not a master key (it starts with "tgmk1.")');
  let raw;
  try { raw = b58Decode(t.slice(MASTER_PREFIX.length), 128); } catch { throw fail('damaged', 'The master key is damaged'); }
  if (b58Encode(raw) !== t.slice(MASTER_PREFIX.length) || raw.length !== 1 + 32 + 2) throw fail('damaged', 'The master key is damaged');
  if (!equalBytes(raw.slice(-2), await checksum('tgmk1', raw.slice(0, -2)))) throw fail('checksum', 'The master key has a typing error');
  if (raw[0] !== 1) throw fail('version', `This master key has format version ${raw[0]}; this reader understands 1`);
  return raw.slice(1, 33);
}

const framed = (bytes) => concat(varint(bytes.length), bytes);
function textPart(value, name, max, allowEmpty) {
  if (typeof value !== 'string') throw fail('bad-option', `${name} is a string`);
  const b = utf8(value.normalize('NFC'));
  if ((!allowEmpty && !b.length) || b.length > max) throw fail('bad-option', `${name} is ${allowEmpty ? 0 : 1} to ${max} bytes`);
  return b;
}
const need32 = (m) => { if (!(m instanceof Uint8Array) || m.length !== 32) throw fail('bad-option', 'The master secret is 32 bytes'); };

/**
 * K_i = HKDF-SHA-256(ikm = master, salt = "tgart/hkdf/v1", info = "tgart/record-key/v1" 0x00 framed(recordId) framed(context)) -> 32 bytes.
 * Different record ids or contexts give unrelated keys; K_i reveals nothing about the master or about other keys.
 */
export async function recordKey(master, recordId, context = '') {
  need32(master);
  const id = textPart(recordId, 'The record id', LIMITS.maxId, false), ctx = textPart(context, 'The context', LIMITS.maxContext, true);
  return hkdf(master, utf8('tgart/hkdf/v1'), concat(utf8('tgart/record-key/v1'), Uint8Array.of(0), framed(id), framed(ctx)), 32);
}
/** The 32-byte secret behind a recipient key pair (src/keys-seal.js): HKDF domain "tgart/recipient/v1" and an index. */
export async function recipientSecret(master, index = 0) {
  need32(master);
  if (!Number.isInteger(index) || index < 0 || index > 0xffffffff) throw fail('bad-option', 'index is 0 to 4294967295');
  return hkdf(master, utf8('tgart/hkdf/v1'), concat(utf8('tgart/recipient/v1'), Uint8Array.of(0), varint(index)), 32);
}
export { toHex };
