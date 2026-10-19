// Browser-safe verification of a Typogram (SVG or HTML) — the same three-state check as the `tg verify` CLI, but using
// Web Crypto (crypto.subtle), so it runs in a page with no node:crypto. It recomputes the identity hash from the data
// layer, checks it against the stored hash, then verifies the issuer's Ed25519 signature over the canonical sig-string.
// Key fetching is injected (`fetchKeyfile(issuer)`), so the caller controls the network (the page fetches same-origin
// /.well-known/tgart-keys.json; a test passes the key file directly). PDFs are not handled here (their data layer is in
// MuPDF attachments) — use `tg verify` for those.
import { canonicalText } from './secret.js';
import { sha256Hex } from './structure.js';
import { markupText } from './work-text.js';
import { readJsonld } from './typogram.js';

const b64urlToBytes = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * @returns {Promise<{state:'VERIFIED'|'UNSIGNED'|'TAMPERED'|'NO_DATA'|'ERROR', hash?, storedHash?, issuer?, kid?, created?, reason?}>}
 */
export async function verifyTypogram(text, { fetchKeyfile } = {}) {
  const container = /<svg[\s>]/i.test(text) ? 'svg' : 'html';
  let imageText, record;
  try { imageText = markupText(text, container); record = readJsonld(text); }
  catch { return { state: 'NO_DATA', reason: 'could not read the picture or its data layer' }; }
  if (!imageText || !record) return { state: 'NO_DATA', reason: 'no data layer — not a Typogram, or a plain image' };

  // The identity hash is over the picture's own text (the image layer), as the generator and the CLI compute it.
  const hash = await sha256Hex(canonicalText(imageText));
  const tg = record.tgart || {};
  const storedHash = tg.hash;
  if (storedHash && (!HEX64.test(String(storedHash)) || storedHash !== hash)) {
    return { state: 'TAMPERED', reason: 'the stored hash does not match the text', hash, storedHash: String(storedHash) };
  }
  if (!tg.signature) return { state: 'UNSIGNED', hash, issuer: tg.issuer || null };

  const issuer = String(tg.issuer || ''), kid = String(tg.kid || ''), created = String(tg.created || '');
  const sigMsg = new TextEncoder().encode(`tgart-sig-v1\n${hash}\n${issuer}\n${kid}\n${created}`);
  let keyfile;
  try { keyfile = await fetchKeyfile(issuer); } catch { return { state: 'TAMPERED', reason: `could not fetch the key for ${issuer}`, hash, issuer, kid }; }
  const keys = (keyfile && keyfile.keys) || [];
  const k = keys.find((e) => e.kid === kid && e.alg === 'Ed25519');
  if (!k) return { state: 'TAMPERED', reason: `the key file has no Ed25519 key "${kid}" for ${issuer}`, hash, issuer, kid };
  const revoked = new Set(keys.flatMap((e) => e.revokes || []).concat(keys.filter((e) => e.revoked).map((e) => e.kid)));
  if (revoked.has(kid)) return { state: 'TAMPERED', reason: `key "${kid}" has been revoked`, hash, issuer, kid };

  let ok = false;
  try {
    const pub = await crypto.subtle.importKey('raw', b64urlToBytes(k.publicKey), { name: 'Ed25519' }, false, ['verify']);
    ok = await crypto.subtle.verify({ name: 'Ed25519' }, pub, b64urlToBytes(tg.signature), sigMsg);
  } catch { return { state: 'ERROR', reason: 'this browser cannot verify Ed25519 — use the `tg verify` command instead', hash, issuer, kid }; }
  return ok ? { state: 'VERIFIED', hash, issuer, kid, created } : { state: 'TAMPERED', reason: 'the signature does not verify against the published key', hash, issuer, kid };
}
