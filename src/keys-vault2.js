// The default vault (docs/key-management.md section 7, decision 13.2): "the seed alone recovers everything". The vault
// secret V IS the master secret of section 2, so the seed opens everything with no vault at all; the vault holds only
// wrappers of V for the convenience factors (a passkey, a passphrase): Shamir k-of-n over those factors, each share
// AES-256-GCM under the factor's wrap key, with the header (the mode byte included) in the AAD. The rule "a passphrase
// alone never opens anything" holds as in the strict vault: at most k-1 passphrase factors among the n convenience
// factors, so every set that opens the vault without the seed holds a high-entropy factor (one passkey and one
// passphrase: 2-of-2). The strict vault (random V, the seed is one share, `tgv1.`) stays in keys-split.js as
// `mode: 'strict'`; createVault / openVault / describeVault there dispatch to this file for `tgv2.`.
import { fail, utf8, concat, equalBytes, b64urlEncode, b64urlDecode, checksum } from './crypt-codec.js';
import { hkdf, hmac } from './keys.js';
import { stretch, encodeParams, decodeParams, checkParams, DEFAULT_PARAMS } from './keys-kdf.js';
import { gfEval, gfInterpolate0 } from './keys-split.js';

export const VAULT2_PREFIX = 'tgv2.';
const MODE_DEFAULT = 0;      // the header's mode byte; a strict vault is `tgv1.` and carries no mode byte
const HEADER = 8;            // version 2, mode, k, n, verify 4
const NAME_RE = /^[a-z][a-z0-9-]{0,15}$/;
const rnd = (random) => random ?? ((a) => crypto.getRandomValues(a));
const randomBytes = (n, random) => { const a = new Uint8Array(n); rnd(random)(a); return a; };
const squeeze = (s) => String(s ?? '').replace(/\s+/g, '');

async function wrapKey(factorKey, name) {
  const k = await hkdf(factorKey, utf8('tgv2/wrap'), utf8(name), 32);
  return crypto.subtle.importKey('raw', k, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
const verifyOf = async (master) => (await hmac('SHA-256', master, utf8('tgv2/check'))).slice(0, 4);
function splitRaw(secret, k, n, random) {
  const polys = Array.from(secret, (s) => Uint8Array.of(s, ...randomBytes(k - 1, random)));
  return Array.from({ length: n }, (_, i) => ({ x: i + 1, y: Uint8Array.from(polys, (c) => gfEval(c, i + 1)) }));
}

/**
 * Makes the default vault. `factors` holds exactly ONE master factor `{ name, master }` (the 32-byte master secret of
 * section 2; it is NOT stored: V = master, and the seed opens everything without this vault) and 1 to 7 convenience
 * factors, `{ name, key }` (32 high-entropy bytes: a passkey factor) or `{ name, passphrase, params? }`. The convenience
 * factors share V by Shamir k-of-n; `k` defaults to n (all of them). RULES (enforced): at most k-1 passphrase factors,
 * so a passphrase alone never opens the vault; no convenience factor is named "master" (that name is the seed path when
 * opening). The vault text may be stored anywhere (it is encrypted shares; a public copy lets anyone verify guesses of a
 * passphrase against its own share, which is one share and so worth nothing alone).
 * @returns {Promise<{vault:string, secret:Uint8Array}>}  `secret` is the master itself
 */
export async function createVaultDefault(factors, { k, random } = {}) {
  if (!Array.isArray(factors) || factors.length < 2 || factors.length > 8) throw fail('bad-option', 'A vault has 2 to 8 factors');
  const names = factors.map((f) => f?.name);
  if (names.some((n) => typeof n !== 'string' || !NAME_RE.test(n)) || new Set(names).size !== names.length) throw fail('bad-option', 'Factor names are unique, lower case, 1 to 16 characters (a-z, 0-9, -)');
  const masters = factors.filter((f) => f.master !== undefined);
  if (masters.length !== 1) throw fail('bad-option', 'The default vault has exactly one master factor ({ name, master }): the seed opens it without the vault');
  const master = masters[0].master;
  if (!(master instanceof Uint8Array) || master.length !== 32) throw fail('bad-option', 'The master secret is 32 bytes');
  const conv = factors.filter((f) => f.master === undefined), n = conv.length, kc = k ?? n;
  if (conv.some((f) => f.name === 'master')) throw fail('bad-option', '"master" is the seed path when opening a vault: give the factor another name');
  if (!Number.isInteger(kc) || kc < 1 || kc > n) throw fail('bad-option', 'k is 1 to the number of convenience factors');
  if (conv.filter((f) => f.passphrase !== undefined).length > kc - 1) throw fail('bad-option', 'Too many passphrase factors: a passphrase must never be enough to open the vault without the seed (at most k-1 passphrase factors; add a passkey)');
  const shares = splitRaw(master, kc, n, random);
  const header = concat(Uint8Array.of(2, MODE_DEFAULT, kc, n), await verifyOf(master));
  const out = [header];
  for (let i = 0; i < n; i++) {
    const f = conv[i];
    let key, kdf = new Uint8Array(0);
    if (f.passphrase !== undefined) {
      const salt = randomBytes(16, random), params = checkParams(f.params ?? DEFAULT_PARAMS);
      kdf = concat(encodeParams(params), salt);
      key = await stretch(f.passphrase, salt, params);
    } else if (f.key instanceof Uint8Array && f.key.length === 32) key = f.key;
    else throw fail('bad-option', 'A convenience factor has a 32-byte key or a passphrase');
    const head = concat(Uint8Array.of(f.name.length), utf8(f.name), Uint8Array.of(shares[i].x), Uint8Array.of(kdf.length), kdf);
    const nonce = randomBytes(12, random);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: concat(utf8('tgv2'), header, head), tagLength: 128 }, await wrapKey(key, f.name), shares[i].y));
    out.push(head, nonce, ct);
  }
  const body = concat(...out);
  return { vault: VAULT2_PREFIX + b64urlEncode(concat(body, await checksum('tgv2', body, 4))), secret: master };
}

async function parseVault2(text) {
  const t = squeeze(text);
  if (!t.startsWith(VAULT2_PREFIX)) throw fail(t ? 'bad-prefix' : 'no-key', 'Not a vault (it starts with "tgv1." or "tgv2.")');
  if (t.length > 4096) throw fail('damaged', 'This is too long to be a vault');
  let b;
  try { b = b64urlDecode(t.slice(VAULT2_PREFIX.length), 4096); } catch { throw fail('damaged', 'The vault is damaged'); }
  if (b.length < HEADER + 4) throw fail('damaged', 'The vault is too short');
  const body = b.slice(0, -4);
  if (!equalBytes(b.slice(-4), await checksum('tgv2', body, 4))) throw fail('checksum', 'The vault has a typing error');
  if (body[0] !== 2) throw fail('version', `This vault has format version ${body[0]}; this reader understands 2`);
  if (body[1] !== MODE_DEFAULT) throw fail('version', 'This vault is in a mode this reader does not understand');
  const k = body[2], n = body[3];
  if (k < 1 || n < k || n > 7) throw fail('damaged', 'The vault is damaged (counts)');
  const header = body.slice(0, HEADER);
  let at = HEADER;
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
  return { header, entries, k, n };
}

/** Reads a default vault without any factor: mode, threshold and the convenience factors (the seed is implied). */
export async function describeVaultDefault(text) {
  const { header, entries, k, n } = await parseVault2(text);
  return { mode: 'default', k, n, seed: true, factors: entries.map((e) => ({ name: e.name, passphrase: !!e.params, params: e.params })), headerBytes: header.length };
}

/**
 * Opens a default vault. The seed path is `available.master` (the 32-byte master secret): it IS the vault's secret, it
 * is only checked against the vault's verify bytes, and no other factor is needed (without a vault in hand, the master
 * simply is the secret). Otherwise the convenience factors, named as in the vault: `{ passkey: {key}, passphrase: {passphrase} }`.
 * @returns {Promise<{secret:Uint8Array, used:string[]}>}
 * @throws {CryptError} vault-too-few (fewer than k factors worked: `have`, `need`), vault-mismatch, damaged, checksum, version
 */
export async function openVaultDefault(text, available) {
  const { header, entries, k } = await parseVault2(text);
  const want = header.slice(4);
  const m = available?.master;
  if (m !== undefined) {
    if (!(m instanceof Uint8Array) || m.length !== 32) throw fail('bad-option', 'The master secret is 32 bytes');
    if (!equalBytes(await verifyOf(m), want)) throw fail('vault-mismatch', 'This master secret does not belong to this vault');
    return { secret: m, used: ['master'] };
  }
  const points = [], used = [];
  for (const e of entries) {
    const a = available?.[e.name];
    if (!a) continue;
    let key;
    try {
      if (e.params) { if (typeof a.passphrase !== 'string') continue; key = await stretch(a.passphrase, e.salt, e.params); }
      else { if (!(a.key instanceof Uint8Array) || a.key.length !== 32) continue; key = a.key; }
      const share = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: e.nonce, additionalData: concat(utf8('tgv2'), header, e.head), tagLength: 128 }, await wrapKey(key, e.name), e.ct));
      points.push({ x: e.x, y: share }); used.push(e.name);
    } catch (err) { if (err.name === 'CryptError' && err.code !== 'no-key') throw err; /* a wrong factor: skip */ }
  }
  if (points.length < k) throw fail('vault-too-few', `${k} factors are needed to open this vault without the seed; ${points.length} worked`, { need: k, have: points.length });
  const use = points.slice(0, k);
  const secret = Uint8Array.from({ length: 32 }, (_, j) => gfInterpolate0(use.map((p) => [p.x, p.y[j]])));
  if (!equalBytes(await verifyOf(secret), want)) throw fail('vault-mismatch', 'The factors do not fit together');
  return { secret, used: used.slice(0, k) };
}
