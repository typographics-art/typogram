// Hidden messages in a Typographics Art work, as a book cipher: the work keeps only its public text; the key
// lists, for every character of the secret, one position in that text where the same character stands (chosen
// at random among all its occurrences, so two keys for the same secret look unrelated). With the key and the
// right work the secret comes back; with another work the key's text fingerprint does not match.
//
// The work itself carries nothing hidden: no invisible text, no extra characters. The key is the secret —
// keep it like a password. Pure; works in the browser and in Node 20+ (Web Crypto).
import { normalizeText, graphemes } from './layout.js';

const PREFIX = 'tg1.';
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/gu;

/**
 * The text both sides index into: normalised whitespace, no invisible characters (PDFs do not carry them), NFC
 * (PDF readers order stacked combining marks differently: MuPDF and pdf.js disagree without it).
 */
export const canonicalText = (text) => normalizeText(String(text).replace(INVISIBLE, '').normalize('NFC'));

async function fingerprint(clusters) {
  const bytes = new TextEncoder().encode(clusters.join(''));
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)).slice(0, 8);
}

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

function varints(numbers) {
  const out = [];
  for (let n of numbers) {
    do { let b = n & 0x7f; n = Math.floor(n / 128); if (n) b |= 0x80; out.push(b); } while (n);
  }
  return out;
}
function readVarints(bytes) {
  const out = [];
  let n = 0, shift = 1, len = 0;
  for (const b of bytes) {
    // at most 7 bytes per number (2^49 > any position): a longer run would overflow to NaN and index nothing, silently
    if (++len > 7) throw new Error('The key is damaged');
    n += (b & 0x7f) * shift;
    if (b & 0x80) shift *= 128;
    else { out.push(n); n = 0; shift = 1; len = 0; }
  }
  if (shift !== 1) throw new Error('The key is damaged');
  return out;
}

/** A uniform random integer below n from Web Crypto (rejection sampling, no modulo bias). */
function randomBelow(n, random) {
  const limit = Math.floor(0x100000000 / n) * n, buf = new Uint32Array(1);
  for (;;) { random(buf); if (buf[0] < limit) return buf[0] % n; }
}

/**
 * Hides `secret` in the public text of a work. Throws if a character of the secret does not occur in the text
 * (the error lists them, so a different wording or a longer text can be chosen).
 * @returns {Promise<string>} the key, "tg1.<base64url>"
 */
export async function hideSecret(publicText, secret, { random = (a) => crypto.getRandomValues(a) } = {}) {
  const clusters = graphemes(canonicalText(publicText));
  const wanted = graphemes(normalizeText(String(secret).normalize('NFC')));
  if (!wanted.length) throw Object.assign(new Error('The secret is empty'), { code: 'empty-secret' });
  const where = new Map();
  clusters.forEach((c, i) => { if (!where.has(c)) where.set(c, []); where.get(c).push(i); });
  const missing = [...new Set(wanted.filter((c) => !where.has(c)))];
  if (missing.length) throw Object.assign(new Error(`Not in the text: ${missing.map((c) => JSON.stringify(c)).join(' ')}`), { missing, code: 'missing' });
  const positions = wanted.map((c) => { const list = where.get(c); return list[randomBelow(list.length, random)]; });
  return PREFIX + b64url(new Uint8Array([...(await fingerprint(clusters)), ...varints(positions)]));
}

/**
 * Reads the secret back from the public text of the work the key was made for.
 * @returns {Promise<string>}
 */
export async function revealSecret(publicText, key) {
  const k = String(key).trim();
  const damaged = () => Object.assign(new Error('The key is damaged'), { code: 'damaged' });
  if (!k) throw Object.assign(new Error('Paste the key first (it starts with "tg1.")'), { code: 'no-key' });
  if (!k.startsWith(PREFIX)) throw Object.assign(new Error('Not a Typographics Art key (it starts with "tg1.")'), { code: 'bad-prefix' });
  let bytes;
  try { bytes = unb64url(k.slice(PREFIX.length)); } catch { throw damaged(); }
  if (bytes.length < 9) throw damaged();
  const clusters = graphemes(canonicalText(publicText));
  const fp = await fingerprint(clusters);
  if (fp.some((b, i) => b !== bytes[i])) throw Object.assign(new Error('This key belongs to a different work (or the text was changed)'), { wrongText: true, code: 'wrong-text' });
  let positions;
  try { positions = readVarints(bytes.slice(8)); } catch { throw damaged(); }
  return positions.map((p) => {
    if (p >= clusters.length) throw damaged();
    return clusters[p];
  }).join('');
}
