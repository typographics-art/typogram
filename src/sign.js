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

/** Sign the identity hash for an issuer. `privatePem` is the PKCS#8 PEM secret. Returns the signature, base64url. */
export function signHash({ hash, issuer, kid, created }, privatePem) {
  const msg = Buffer.from(sigString({ hash, issuer, kid, created }), 'utf8');
  return b64u(edSign(null, msg, createPrivateKey(privatePem)));
}

/** Verify a signature over the identity hash against a raw base64url public key. Returns true/false; never throws on bad input. */
export function verifyHash({ hash, issuer, kid, created, signature }, publicKey) {
  try {
    const msg = Buffer.from(sigString({ hash, issuer, kid, created }), 'utf8');
    const pub = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: String(publicKey) }, format: 'jwk' });
    return edVerify(null, msg, pub, unb64u(signature));
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
