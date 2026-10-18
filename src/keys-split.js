// Second factors and key splitting (docs/key-management.md sections 6 to 8). Pure, async where it hashes, Web Crypto only.
//
//   XOR n-of-n and Shamir k-of-n (GF(2^8), the AES polynomial) -> text shares "tgsh1." + base58(...)  (shares.*)
//   password mixing: a random secret + a memorised password -> the key; guessing the password alone gets nowhere (mix.*)
//   the vault: a random vault secret wrapped by k-of-n FACTORS (seed, passkey, passphrase), the passphrase never alone
//   (that is `mode: 'strict'`, `tgv1.`; the default vault, V = the master so the seed alone recovers everything, is keys-vault2.js)
//   a passphrase generator from the BIP-39 list, and the WebAuthn PRF input/output helpers
//
// A share, a half key or a vault entry stored on a public chain protects nothing by itself it is not meant to: the
// rule is that nothing public ever depends on a human-chosen secret alone.
import { fail, utf8, concat, equalBytes, sha256, b58Encode, b58Decode, b64urlEncode, b64urlDecode, checksum, varint, readVarint } from './crypt-codec.js';
import { hkdf, hmac } from './keys.js';
import { BIP39_ENGLISH } from './keys-wordlist-en.js';
import { stretch, encodeParams, decodeParams, checkParams, DEFAULT_PARAMS } from './keys-kdf.js';
import { createVaultDefault, openVaultDefault, describeVaultDefault, VAULT2_PREFIX } from './keys-vault2.js';

const rnd = (random) => random ?? ((a) => crypto.getRandomValues(a));
const randomBytes = (n, random) => { const a = new Uint8Array(n); rnd(random)(a); return a; };
const squeeze = (s) => String(s ?? '').replace(/\s+/g, '');

// ============================ GF(256) =====================================================================================
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
{ let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x ^= (x << 1) ^ (x & 0x80 ? 0x11b : 0); x &= 255; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; }
export const gfMul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
export const gfInv = (a) => { if (!a) throw fail('bad-option', 'zero has no inverse'); return EXP[255 - LOG[a]]; };
/** Evaluates a polynomial (coefficients, constant term first) at x (Horner). */
export function gfEval(coeffs, x) { let y = 0; for (let i = coeffs.length - 1; i >= 0; i--) y = gfMul(y, x) ^ coeffs[i]; return y; }
/** Lagrange interpolation at x = 0 from points [x, y]. */
export function gfInterpolate0(points) {
  let acc = 0;
  for (let i = 0; i < points.length; i++) {
    let num = 1, den = 1;
    for (let j = 0; j < points.length; j++) if (i !== j) { num = gfMul(num, points[j][0]); den = gfMul(den, points[i][0] ^ points[j][0]); }
    acc ^= gfMul(points[i][1], gfMul(num, gfInv(den)));
  }
  return acc;
}

// ============================ shares ======================================================================================
export const SHARE_PREFIX = 'tgsh1.';
export const SHARE_LIMITS = { maxSecret: 255, maxShares: 255 };
const T_XOR = 1, T_SHAMIR = 2;
const SHARE_CHECK = 4;

async function encodeShare({ type, setId, k, n, index, data }) {
  const body = concat(Uint8Array.of(1, type), setId, Uint8Array.of(k, n, index), data);
  return SHARE_PREFIX + b58Encode(concat(body, await checksum('tgsh1', body, SHARE_CHECK)));
}
/** Parses a share token. @returns {{type:'xor'|'shamir', setId:Uint8Array, k:number, n:number, index:number, data:Uint8Array}} */
export async function parseShare(text) {
  const t = squeeze(text);
  if (!t) throw fail('no-share', 'A share is missing');
  if (t.length > 700) throw fail('damaged', 'This is too long to be a share');
  if (!t.startsWith(SHARE_PREFIX)) throw fail('bad-prefix', 'Not a share (it starts with "tgsh1.")');
  let raw;
  try { raw = b58Decode(t.slice(SHARE_PREFIX.length), 700); } catch { throw fail('damaged', 'The share is damaged (a character that does not belong to a share)'); }
  if (b58Encode(raw) !== t.slice(SHARE_PREFIX.length) || raw.length < 1 + 1 + 4 + 3 + 1 + SHARE_CHECK) throw fail('damaged', 'The share is damaged');
  const body = raw.slice(0, -SHARE_CHECK);
  if (!equalBytes(raw.slice(-SHARE_CHECK), await checksum('tgsh1', body, SHARE_CHECK))) throw fail('checksum', 'The share has a typing error (its check characters do not match)');
  if (body[0] !== 1) throw fail('version', `This share has format version ${body[0]}; this reader understands 1`);
  const type = { [T_XOR]: 'xor', [T_SHAMIR]: 'shamir' }[body[1]];
  if (!type) throw fail('damaged', 'The share is damaged (unknown kind)');
  const k = body[6], n = body[7], index = body[8];
  if (n < 2 || k < 2 || k > n || (type === 'xor' && k !== n) || index < 1 || index > n) throw fail('damaged', 'The share is damaged (counts)');
  return { type, setId: body.slice(2, 6), k, n, index, data: body.slice(9) };
}
function checkSecret(secret) {
  if (!(secret instanceof Uint8Array) || !secret.length || secret.length > SHARE_LIMITS.maxSecret) throw fail('bad-option', `The secret is 1 to ${SHARE_LIMITS.maxSecret} bytes`);
}
/** XOR n-of-n: n-1 random shares and one that completes them. Fewer than n shares give no information at all. */
export async function splitXor(secret, n = 2, { random } = {}) {
  checkSecret(secret);
  if (!Number.isInteger(n) || n < 2 || n > 16) throw fail('bad-option', 'n is 2 to 16');
  const setId = randomBytes(4, random), parts = [];
  const last = Uint8Array.from(secret);
  for (let i = 0; i < n - 1; i++) { const p = randomBytes(secret.length, random); parts.push(p); for (let j = 0; j < last.length; j++) last[j] ^= p[j]; }
  parts.push(last);
  return Promise.all(parts.map((data, i) => encodeShare({ type: T_XOR, setId, k: n, n, index: i + 1, data })));
}
/** Shamir k-of-n over GF(256), one polynomial of degree k-1 per secret byte; the share of index x is the polynomial at x (1..n). */
export async function splitShamir(secret, k, n, { random } = {}) {
  checkSecret(secret);
  if (!Number.isInteger(k) || !Number.isInteger(n) || k < 2 || k > n || n > SHARE_LIMITS.maxShares) throw fail('bad-option', `2 <= k <= n <= ${SHARE_LIMITS.maxShares}`);
  const setId = randomBytes(4, random);
  const polys = Array.from(secret, (s) => Uint8Array.of(s, ...randomBytes(k - 1, random)));
  const out = [];
  for (let x = 1; x <= n; x++) out.push(await encodeShare({ type: T_SHAMIR, setId, k, n, index: x, data: Uint8Array.from(polys, (c) => gfEval(c, x)) }));
  return out;
}
/**
 * Combines shares. Refuses cleanly: shares of different splits (`share-set`), a repeated share, too few, shares of
 * different length, and (Shamir, more than k given) shares that do not lie on one polynomial.
 * @throws {CryptError} no-share, share-set, share-duplicate, share-too-few, share-inconsistent, damaged, checksum
 */
export async function joinShares(texts) {
  if (!Array.isArray(texts) || !texts.length) throw fail('no-share', 'Give the shares');
  if (texts.length > SHARE_LIMITS.maxShares) throw fail('too-large', 'Too many shares');
  const shares = [];
  for (const t of texts) shares.push(await parseShare(t));
  const f = shares[0];
  for (const s of shares) {
    if (s.type !== f.type || s.k !== f.k || s.n !== f.n || !equalBytes(s.setId, f.setId)) throw fail('share-set', 'These shares belong to different secrets and cannot be combined');
    if (s.data.length !== f.data.length) throw fail('share-inconsistent', 'The shares do not fit together (different lengths)');
  }
  if (new Set(shares.map((s) => s.index)).size !== shares.length) throw fail('share-duplicate', 'The same share was given twice');
  if (shares.length < f.k) throw fail('share-too-few', `${f.k} shares are needed for this secret; ${shares.length} given`, { needed: f.k, given: shares.length });
  if (f.type === 'xor') {
    const out = new Uint8Array(f.data.length);
    for (const s of shares) for (let j = 0; j < out.length; j++) out[j] ^= s.data[j];
    return out;
  }
  const at = (list, j) => gfInterpolate0(list.map((s) => [s.index, s.data[j]]));
  const base = shares.slice(0, f.k), out = new Uint8Array(f.data.length);
  for (let j = 0; j < out.length; j++) out[j] = at(base, j);
  // any further share must lie on the same polynomial: interpolate at its index by shifting (Lagrange at x != 0 via a check of the constant term)
  for (const extra of shares.slice(f.k)) {
    for (let j = 0; j < out.length; j++) {
      const sub = [...base.slice(0, f.k - 1), extra];
      if (at(sub, j) !== out[j]) throw fail('share-inconsistent', 'The shares do not fit together (one of them is wrong)');
    }
  }
  return out;
}

// ============================ password mixing =============================================================================
export const HALF_PREFIX = 'tgxm1.';
/**
 * K = HKDF-SHA-256( ikm = secret || stretch(password, salt = SHA-256("tgxm1/salt" || secret)), "tgxm1/key" ) -> 32 bytes.
 * The secret is random (256 bits) and is kept as the "half key"; the password is memorised. K needs both: a password
 * guess alone has nothing to be checked against, and the secret alone gives nothing.
 */
export async function mixKey(secret, password, params = DEFAULT_PARAMS) {
  if (!(secret instanceof Uint8Array) || secret.length !== 32) throw fail('bad-option', 'The secret is 32 bytes');
  const salt = await sha256(concat(utf8('tgxm1/salt'), secret));
  const stretched = await stretch(password, salt, params);
  return hkdf(concat(secret, stretched), utf8('tgxm1/hkdf'), utf8('tgxm1/key'), 32);
}
/** A fresh half key (text, to be stored; not secret enough to publish) and the 32-byte key it makes with the password. */
export async function newMixed(password, { params = DEFAULT_PARAMS, random } = {}) {
  const p = checkParams(params), secret = randomBytes(32, random);
  const body = concat(Uint8Array.of(1), encodeParams(p), secret);
  return { half: HALF_PREFIX + b58Encode(concat(body, await checksum('tgxm1', body))), key: await mixKey(secret, password, p) };
}
export async function parseHalf(text) {
  const t = squeeze(text);
  if (!t) throw fail('no-key', 'Give the half key first (it starts with "tgxm1.")');
  if (t.length > 160) throw fail('damaged', 'This is too long to be a half key');
  if (!t.startsWith(HALF_PREFIX)) throw fail('bad-prefix', 'Not a half key (it starts with "tgxm1.")');
  let raw;
  try { raw = b58Decode(t.slice(HALF_PREFIX.length), 160); } catch { throw fail('damaged', 'The half key is damaged'); }
  if (b58Encode(raw) !== t.slice(HALF_PREFIX.length) || raw.length < 1 + 2 + 32 + 2) throw fail('damaged', 'The half key is damaged');
  const body = raw.slice(0, -2);
  if (!equalBytes(raw.slice(-2), await checksum('tgxm1', body))) throw fail('checksum', 'The half key has a typing error');
  if (body[0] !== 1) throw fail('version', `This half key has format version ${body[0]}; this reader understands 1`);
  const [params, at] = decodeParams(body, 1);
  if (body.length !== at + 32) throw fail('damaged', 'The half key is damaged');
  return { params, secret: body.slice(at) };
}
/** The key from a half key and the password (a wrong password gives a different key: the record then fails to open). */
export async function mixedKey(half, password) { const h = await parseHalf(half); return mixKey(h.secret, password, h.params); }

// ============================ passphrases =================================================================================
/** `words` random words of the BIP-39 list (11 bits each, exactly uniform: 2048 divides 65536). */
export function generatePassphrase(words = 8, { random } = {}) {
  if (!Number.isInteger(words) || words < 1 || words > 64) throw fail('bad-option', 'words is 1 to 64');
  const b = randomBytes(words * 2, random);
  return Array.from({ length: words }, (_, i) => BIP39_ENGLISH[((b[2 * i] << 8) | b[2 * i + 1]) & 0x7ff]).join(' ');
}
export const passphraseBits = (words) => words * 11;

// ============================ WebAuthn PRF helpers =========================================================================
/** The `eval.first` input for a passkey's PRF: 32 bytes bound to this application and a label (e.g. the vault id). */
export const prfInput = async (label = 'default') => sha256(utf8(`tgart/webauthn-prf/v1\0${String(label).normalize('NFC')}`));
/** A factor key from the 32-byte PRF output (never use the raw output elsewhere). */
export async function factorFromPrf(prfOutput) {
  if (!(prfOutput instanceof Uint8Array) || prfOutput.length !== 32) throw fail('bad-option', 'The PRF output is 32 bytes');
  return hkdf(prfOutput, utf8('tgart/hkdf/v1'), utf8('tgart/factor/passkey/v1'), 32);
}
/** A factor key from the master secret (the seed backup as one factor). */
export async function factorFromMaster(master) {
  if (!(master instanceof Uint8Array) || master.length !== 32) throw fail('bad-option', 'The master secret is 32 bytes');
  return hkdf(master, utf8('tgart/hkdf/v1'), utf8('tgart/factor/seed/v1'), 32);
}

// ============================ the vault: k-of-n factors ===================================================================
export const VAULT_PREFIX = 'tgv1.';
const NAME_RE = /^[a-z][a-z0-9-]{0,15}$/;
async function wrapKey(factorKey, name) {
  const k = await hkdf(factorKey, utf8('tgv1/wrap'), utf8(name), 32);
  return crypto.subtle.importKey('raw', k, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
/**
 * Wraps a random 32-byte vault secret V by k-of-n factors. A factor is `{name, key}` (32 high-entropy bytes: the seed
 * factor, a passkey factor) or `{name, passphrase, params?}` (stretched with a memory-hard KDF). Shamir splits V; each
 * share is encrypted under one factor. RULES (enforced): k >= 2, and at most k-1 passphrase factors, so every set of k
 * factors that opens the vault contains at least one high-entropy factor: a passphrase alone can never open anything.
 * The vault text may be stored anywhere (it is encrypted shares), though a public copy lets anyone verify guesses of a
 * passphrase against its own share, which is one share and so worth nothing alone.
 * @returns {Promise<{vault:string, secret:Uint8Array}>}
 */
export async function createVault(factors, { k, mode = 'default', random } = {}) {
  // mode 'default' (decision 13.2): V = the master, the seed alone recovers everything -> `tgv2.` (keys-vault2.js); 'strict': this function, `tgv1.`
  if (mode === 'default') return createVaultDefault(factors, { k, random });
  if (mode !== 'strict') throw fail('bad-option', 'mode is "default" (the seed alone recovers everything) or "strict" (the seed is one share)');
  k ??= 2;
  if (!Array.isArray(factors) || factors.length < 2 || factors.length > 8) throw fail('bad-option', 'A vault has 2 to 8 factors');
  if (!Number.isInteger(k) || k < 2 || k > factors.length) throw fail('bad-option', 'k is 2 to the number of factors');
  const names = factors.map((f) => f?.name);
  if (names.some((n) => typeof n !== 'string' || !NAME_RE.test(n)) || new Set(names).size !== names.length) throw fail('bad-option', 'Factor names are unique, lower case, 1 to 16 characters (a-z, 0-9, -)');
  if (factors.filter((f) => f.passphrase !== undefined).length > k - 1) throw fail('bad-option', 'Too many passphrase factors: a passphrase must never be enough to open the vault (at most k-1 passphrase factors)');
  const secret = randomBytes(32, random);
  const shares = await splitShamirRaw(secret, k, factors.length, random);
  const parts = [Uint8Array.of(1, k, factors.length)];
  const entries = [];
  for (let i = 0; i < factors.length; i++) {
    const f = factors[i];
    let key, kdf = new Uint8Array(0);
    if (f.passphrase !== undefined) {
      const salt = randomBytes(16, random), params = checkParams(f.params ?? DEFAULT_PARAMS);
      kdf = concat(encodeParams(params), salt);
      key = await stretch(f.passphrase, salt, params);
    } else if (f.key instanceof Uint8Array && f.key.length === 32) key = f.key;
    else throw fail('bad-option', 'A factor has a 32-byte key or a passphrase');
    const head = concat(Uint8Array.of(f.name.length), utf8(f.name), Uint8Array.of(shares[i].x), Uint8Array.of(kdf.length), kdf);
    entries.push({ head, key, name: f.name, share: shares[i].y });
  }
  const verify = (await hmac('SHA-256', secret, utf8('tgv1/check'))).slice(0, 4);
  const header = concat(...parts, verify);
  const out = [header];
  for (const e of entries) {
    const nonce = randomBytes(12, random);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: concat(utf8('tgv1'), header, e.head), tagLength: 128 }, await wrapKey(e.key, e.name), e.share));
    out.push(e.head, nonce, ct);
  }
  const body = concat(...out);
  return { vault: VAULT_PREFIX + b64urlEncode(concat(body, await checksum('tgv1', body, 4))), secret };
}
async function splitShamirRaw(secret, k, n, random) {
  const polys = Array.from(secret, (s) => Uint8Array.of(s, ...randomBytes(k - 1, random)));
  return Array.from({ length: n }, (_, i) => ({ x: i + 1, y: Uint8Array.from(polys, (c) => gfEval(c, i + 1)) }));
}
/** Reads a vault without any factor: threshold and the names of its factors. */
export async function describeVault(text) {
  if (squeeze(text).startsWith(VAULT2_PREFIX)) return describeVaultDefault(text);
  const { header, entries, k } = await parseVault(text);
  return { mode: 'strict', k, factors: entries.map((e) => ({ name: e.name, passphrase: !!e.params, params: e.params })), n: entries.length, headerBytes: header.length };
}
async function parseVault(text) {
  const t = squeeze(text);
  if (!t.startsWith(VAULT_PREFIX)) throw fail(t ? 'bad-prefix' : 'no-key', 'Not a vault (it starts with "tgv1." or "tgv2.")');
  if (t.length > 4096) throw fail('damaged', 'This is too long to be a vault');
  let b;
  try { b = b64urlDecode(t.slice(VAULT_PREFIX.length), 4096); } catch { throw fail('damaged', 'The vault is damaged'); }
  if (b.length < 8 + 4) throw fail('damaged', 'The vault is too short');
  const body = b.slice(0, -4);
  if (!equalBytes(b.slice(-4), await checksum('tgv1', body, 4))) throw fail('checksum', 'The vault has a typing error');
  if (body[0] !== 1) throw fail('version', `This vault has format version ${body[0]}; this reader understands 1`);
  const k = body[1], n = body[2];
  if (k < 2 || n < k || n > 8) throw fail('damaged', 'The vault is damaged (counts)');
  const header = body.slice(0, 7);
  let at = 7;
  const entries = [];
  try {
    for (let i = 0; i < n; i++) {
      const start = at, nl = body[at++], name = new TextDecoder('utf-8', { fatal: true }).decode(body.slice(at, at + nl)); at += nl;
      if (!NAME_RE.test(name)) throw fail('damaged', 'bad name');
      const x = body[at++], kl = body[at++];
      let params = null, salt = null;
      if (kl) { const [p, a] = decodeParams(body, at); params = p; salt = body.slice(a, a + 16); if (salt.length !== 16 || a + 16 !== at + kl) throw fail('damaged', 'bad kdf'); }
      at += kl;
      const head = body.slice(start, at), nonce = body.slice(at, at + 12), ct = body.slice(at + 12, at + 12 + 32 + 16);
      at += 12 + 48;
      if (nonce.length !== 12 || ct.length !== 48 || x < 1) throw fail('damaged', 'short');
      entries.push({ name, x, params, salt, head, nonce, ct });
    }
  } catch { throw fail('damaged', 'The vault is damaged'); }
  if (at !== body.length) throw fail('damaged', 'The vault is damaged (extra bytes)');
  return { header: body.slice(0, 7), entries, k };
}
/**
 * Opens a vault with the factors you have: `{ seed: {key}, passkey: {key}, passphrase: {passphrase: '...'} }`, names as in the vault.
 * @returns {Promise<{secret:Uint8Array, used:string[]}>}
 * @throws {CryptError} vault-too-few (fewer than k factors worked: `have`, `need`), vault-mismatch, damaged, checksum
 */
export async function openVault(text, available) {
  if (squeeze(text).startsWith(VAULT2_PREFIX)) return openVaultDefault(text, available);
  const { header, entries, k } = await parseVault(text);
  const points = [], used = [];
  for (const e of entries) {
    const a = available?.[e.name];
    if (!a) continue;
    let key;
    try {
      if (e.params) { if (typeof a.passphrase !== 'string') continue; key = await stretch(a.passphrase, e.salt, e.params); }
      else { if (!(a.key instanceof Uint8Array) || a.key.length !== 32) continue; key = a.key; }
      const share = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: e.nonce, additionalData: concat(utf8('tgv1'), header, e.head), tagLength: 128 }, await wrapKey(key, e.name), e.ct));
      points.push({ x: e.x, y: share }); used.push(e.name);
    } catch (err) { if (err.name === 'CryptError' && err.code !== 'no-key') throw err; /* a wrong factor: skip */ }
  }
  if (points.length < k) throw fail('vault-too-few', `${k} factors are needed to open this vault; ${points.length} worked`, { need: k, have: points.length });
  const use = points.slice(0, k);
  const secret = Uint8Array.from({ length: 32 }, (_, j) => gfInterpolate0(use.map((p) => [p.x, p.y[j]])));
  const verify = (await hmac('SHA-256', secret, utf8('tgv1/check'))).slice(0, 4);
  if (!equalBytes(verify, header.slice(3))) throw fail('vault-mismatch', 'The factors do not fit together');
  return { secret, used: used.slice(0, k) };
}
