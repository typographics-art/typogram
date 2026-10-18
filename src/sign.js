// Issuer signatures for Typograms (docs/verification.md, docs/issuers.md). A signature proves a text came from an issuer
// (a domain) and has not changed since a date. It is made over the IDENTITY HASH (docs/canonical-text.md) — the SHA-256 of
// the canonical text — so it is independent of fonts, rendering and file format: the same text signs and verifies the same,
// whether it is an SVG, an HTML page or a PDF. We do no own cryptography: Ed25519 via node:crypto. Public keys are the raw
// 32 bytes, base64url; private keys are kept as PKCS#8 PEM and never leave the signer.
//
// A public key lives in the issuer's key file, published at https://<issuer>/.well-known/tgart-keys.json and mirrored in the
// repo as keys/<issuer>.json; `tg verify` checks a signature against it. The file lists keys by `kid` and `alg`, so an
// Ed25519 signing key and (later, for sealed sends) an X25519 recipient key can live side by side.
import { sign as edSign, verify as edVerify, createPublicKey, createPrivateKey, generateKeyPairSync } from 'node:crypto';

export const SIG_SPEC = 'tgart-sig-v1';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url');

/**
 * The exact bytes an Ed25519 signature covers: a fixed spec tag and the four fields, newline-separated, in a fixed order, so
 * every tool (ours, the Python reference, yours) signs and verifies byte-for-byte the same message. The fields never contain
 * a newline (hash is hex, issuer a hostname, kid a short id, created an ISO date), so the join is unambiguous.
 */
export function sigString({ hash, issuer, kid, created }) {
  for (const [k, v] of Object.entries({ hash, issuer, kid, created })) {
    if (typeof v !== 'string' || v.length === 0) throw new Error(`sigString: ${k} is required`);
    if (v.includes('\n')) throw new Error(`sigString: ${k} must not contain a newline`);
  }
  return `${SIG_SPEC}\n${hash}\n${issuer}\n${kid}\n${created}`;
}

/** A fresh Ed25519 issuer key. `privatePem` is the secret (PKCS#8 PEM, keep it safe); `publicKey` is the raw key, base64url. */
export function generateIssuerKey({ created = new Date().toISOString().slice(0, 10) } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    privatePem: privateKey.export({ format: 'pem', type: 'pkcs8' }),
    publicKey: publicKeyRaw(publicKey.export({ format: 'jwk' })),
    created,
  };
}

const publicKeyRaw = (jwk) => jwk.x; // OKP/Ed25519 JWK: x is the raw 32-byte public key, already base64url

/** The raw base64url public key (for the key file) that matches a PKCS#8 PEM private key. */
export function publicKeyOf(privatePem) {
  return publicKeyRaw(createPublicKey(createPrivateKey(privatePem)).export({ format: 'jwk' }));
}

/** Low-level: sign arbitrary bytes with a PKCS#8 PEM private key; returns the signature, base64url. */
export function signBytes(message, privatePem) {
  const msg = Buffer.isBuffer(message) ? message : Buffer.from(String(message), 'utf8');
  return b64u(edSign(null, msg, createPrivateKey(privatePem)));
}

/** Low-level: verify a base64url signature over bytes against a raw base64url public key. Never throws on bad input. */
export function verifyBytes(message, signature, publicKey) {
  try {
    const msg = Buffer.isBuffer(message) ? message : Buffer.from(String(message), 'utf8');
    const pub = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: String(publicKey) }, format: 'jwk' });
    return edVerify(null, msg, pub, unb64u(signature));
  } catch {
    return false;
  }
}

/** Sign the identity hash for an issuer. `privatePem` is the PKCS#8 PEM secret. Returns the signature, base64url. */
export function signHash({ hash, issuer, kid, created }, privatePem) {
  return signBytes(sigString({ hash, issuer, kid, created }), privatePem);
}

/** Verify a signature over the identity hash against a raw base64url public key. Returns true/false; never throws on bad input. */
export function verifyHash({ hash, issuer, kid, created, signature }, publicKey) {
  try {
    return verifyBytes(sigString({ hash, issuer, kid, created }), signature, publicKey);
  } catch {
    return false;
  }
}

/** An issuer key file object: { issuer, keys: [{ kid, alg, publicKey, created, use }] }. */
export function buildKeyfile(issuer, keys = []) {
  return {
    issuer: String(issuer),
    keys: keys.map((k) => ({
      kid: String(k.kid),
      alg: k.alg || 'Ed25519',
      publicKey: String(k.publicKey),
      created: k.created || new Date().toISOString().slice(0, 10),
      use: k.use || (k.alg === 'X25519' ? 'seal' : 'sign'),
      ...(k.expires ? { expires: String(k.expires) } : {}),
      ...(k.revoked ? { revoked: true } : {}),
    })),
  };
}

/** The matching public key entry from a key file, by kid (and alg), or null. A revoked or expired key is not returned. */
export function findKey(keyfile, { issuer, kid, alg = 'Ed25519', at = new Date().toISOString().slice(0, 10) } = {}) {
  if (!keyfile || typeof keyfile !== 'object' || !Array.isArray(keyfile.keys)) return null;
  if (issuer && keyfile.issuer && keyfile.issuer !== issuer) return null;
  const k = keyfile.keys.find((e) => e && e.kid === kid && (e.alg || 'Ed25519') === alg);
  if (!k || k.revoked) return null;
  if (k.expires && String(at) > String(k.expires)) return null;
  return k.publicKey || null;
}

// ---- the self-contained signed key statement (docs/issuers.md) -------------------------------------------------------
// A key statement says "this public key belongs to this issuer, valid from this date, replacing this earlier key" and is
// signed with the key itself — and, on rotation, also with the key it replaces. Because the proof travels inside the
// statement, it stays checkable wherever it goes: on the domain, in the repo, in an archive, or beside a Typogram. Anchors
// (tgart.anchors in docs/verification.md) are added AFTER signing and are deliberately NOT part of the signed core, so
// adding one later never invalidates the signature.
export const KEY_SPEC = 'tgart-key-v1';
const CORE_FIELDS = ['spec', 'issuer', 'kid', 'alg', 'publicKey', 'created', 'expires', 'predecessor', 'revokes'];

/** Deterministic JSON: object keys sorted recursively, so two implementations sign and verify byte-for-byte the same message. */
export function canonicalJson(v) {
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}

const statementCore = (s) => { const c = {}; for (const k of CORE_FIELDS) c[k] = k in s && s[k] !== undefined ? s[k] : (k === 'revokes' ? [] : null); return c; };
const keyStatementMessage = (core) => Buffer.from(KEY_SPEC + '\n' + canonicalJson(core), 'utf8');

/** The SHA-256 (hex) of a key statement's signed core — what an anchor pins. */
export async function keyStatementDigest(statement) {
  const { subtle } = await import('node:crypto');
  const d = await subtle.digest('SHA-256', keyStatementMessage(statementCore(statement)));
  return Buffer.from(d).toString('hex');
}

/**
 * Build a signed key statement. `privatePem` is THIS key's secret (the self-signature). For a rotation, pass the previous
 * key as `predecessor` ({ kid, publicKey }) and its secret as `predecessorPem`, so the old key endorses the new one.
 */
export function signKeyStatement(
  { issuer, kid, publicKey, created = new Date().toISOString().slice(0, 10), expires = null, predecessor = null, revokes = [] },
  privatePem,
  { predecessorPem = null } = {},
) {
  const core = { spec: KEY_SPEC, issuer: String(issuer), kid: String(kid), alg: 'Ed25519', publicKey: String(publicKey), created, expires, predecessor, revokes };
  const msg = keyStatementMessage(core);
  const statement = { ...core, sig: { by: 'self', signature: signBytes(msg, privatePem) } };
  if (predecessor && predecessorPem) statement.prevSig = { by: predecessor.kid, signature: signBytes(msg, predecessorPem) };
  statement.anchors = [];
  return statement;
}

/**
 * Verify a key statement: the self-signature by its own key, and (on rotation) the predecessor's endorsement. Returns
 * { ok, selfSig, predSig, expired, issuer, kid, publicKey }. `predSig` is null when there is no predecessor.
 */
export function verifyKeyStatement(statement, { at = new Date().toISOString().slice(0, 10) } = {}) {
  const r = { ok: false, selfSig: false, predSig: null, expired: false, issuer: statement?.issuer, kid: statement?.kid, publicKey: statement?.publicKey };
  if (!statement || statement.spec !== KEY_SPEC || typeof statement.publicKey !== 'string') return r;
  const msg = keyStatementMessage(statementCore(statement));
  r.selfSig = statement.sig?.by === 'self' && verifyBytes(msg, statement.sig?.signature, statement.publicKey);
  if (statement.predecessor) {
    r.predSig = !!(statement.prevSig && statement.predecessor.publicKey && verifyBytes(msg, statement.prevSig.signature, statement.predecessor.publicKey));
  }
  r.expired = !!(statement.expires && String(at) > String(statement.expires));
  r.ok = r.selfSig && r.predSig !== false && !r.expired;
  return r;
}
