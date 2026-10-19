// The verified-issuer key registry. Some AI agents can reach GitHub (and raw.githubusercontent.com) or npm but not an
// arbitrary website, so the issuer signing keys that `tg verify` needs are published here as a single file in the repo
// (keys/registry.json) and as an immutable npm package (@typographics-art/keys), in addition to each issuer's own
// https://<issuer>/.well-known/tgart-keys.json. A registry entry is "verified" in two senses: every Ed25519 key
// statement self-verifies (cryptographically consistent), and it was confirmed served at the issuer's own domain
// (domain control) when added. This module builds and checks the registry; the CLI (`tg keys …`) drives it.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { verifyKeyStatement } from '../src/sign.js';

export const REGISTRY_SPEC = 'tgart-registry-v1';
const isHostname = (s) => typeof s === 'string' && /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(s);
const AGE_RECIPIENT = /^age1[0-9a-z]+$/;

/**
 * Validate one issuer key file `{ issuer, keys: [...] }`. Every Ed25519 statement must self-verify and name this issuer;
 * every X25519 sealing entry must carry an age recipient. Returns `{ ok, problems }`.
 */
export function validateKeyfile(kf) {
  const problems = [];
  if (!kf || !isHostname(kf.issuer)) return { ok: false, problems: ['missing or malformed issuer'] };
  if (!Array.isArray(kf.keys) || !kf.keys.length) return { ok: false, problems: [`${kf.issuer}: no keys`] };
  for (const k of kf.keys) {
    if (!k || typeof k.kid !== 'string') { problems.push(`${kf.issuer}: a key has no kid`); continue; }
    if (k.alg === 'X25519') {
      if (!AGE_RECIPIENT.test(k.publicKey || '')) problems.push(`${kf.issuer} (${k.kid}): not an age recipient`);
      continue;
    }
    const v = verifyKeyStatement(k); // Ed25519 signing statement: self-signature, predecessor and validity
    if (!v.ok) problems.push(`${kf.issuer} (${k.kid}): key statement did not verify`);
    else if (v.issuer !== kf.issuer) problems.push(`${kf.issuer} (${k.kid}): statement issuer ${v.issuer} does not match the file`);
  }
  return { ok: problems.length === 0, problems };
}

/**
 * Build the registry object from every `keys/<domain>.json` in `keysDir` (registry.json itself is skipped). The key
 * files stay pristine — byte-identical to what each issuer serves — so verification metadata is kept OUT of them and
 * passed in `verified` (a `{ [issuer]: { verifiedAt, verifiedVia } }` map, normally carried forward from the previous
 * registry; `tg keys add` adds the freshly checked domain). Each file must validate. Returns `{ registry, problems }`.
 */
export function buildRegistry(keysDir, { updated = new Date().toISOString().slice(0, 10), verified = {} } = {}) {
  const files = readdirSync(keysDir).filter((f) => /\.json$/.test(f) && f !== 'registry.json').sort();
  const issuers = [];
  const problems = [];
  for (const f of files) {
    let kf;
    try { kf = JSON.parse(readFileSync(join(keysDir, f), 'utf8')); } catch (e) { problems.push(`${f}: ${e.message}`); continue; }
    const v = validateKeyfile(kf);
    if (!v.ok) { problems.push(...v.problems); continue; }
    const m = verified[kf.issuer] || {};
    issuers.push({
      issuer: kf.issuer,
      verifiedAt: typeof m.verifiedAt === 'string' ? m.verifiedAt : null,
      verifiedVia: typeof m.verifiedVia === 'string' ? m.verifiedVia : `https://${kf.issuer}/.well-known/tgart-keys.json`,
      keys: kf.keys,
    });
  }
  issuers.sort((a, b) => a.issuer.localeCompare(b.issuer));
  const registry = {
    spec: REGISTRY_SPEC,
    updated,
    note: 'Verified Typographics Art issuer keys. Each Ed25519 statement self-verifies and is served at the issuer\'s https://<issuer>/.well-known/tgart-keys.json. Check a signed work with: tg verify <file> --keys <this file>. Submit a key: https://typographics-art.org/keys.',
    issuers,
  };
  return { registry, problems };
}

/** The `{ [issuer]: { verifiedAt, verifiedVia } }` map from an existing registry, to carry forward across a rebuild. */
export const verifiedMap = (registry) =>
  Object.fromEntries(((registry && registry.issuers) || []).map((e) => [e.issuer, { verifiedAt: e.verifiedAt, verifiedVia: e.verifiedVia }]));

/** Re-validate a registry object (every issuer's statements). Returns `{ ok, problems }`. */
export function verifyRegistry(registry) {
  const problems = [];
  if (!registry || registry.spec !== REGISTRY_SPEC) return { ok: false, problems: ['not a tgart-registry-v1 document'] };
  if (!Array.isArray(registry.issuers)) return { ok: false, problems: ['no issuers array'] };
  for (const e of registry.issuers) {
    const v = validateKeyfile({ issuer: e.issuer, keys: e.keys });
    if (!v.ok) problems.push(...v.problems);
  }
  return { ok: problems.length === 0, problems };
}

/**
 * Fetch an issuer's published key file over HTTPS (domain-control proof for `tg keys add`). Returns the parsed
 * `{ issuer, keys }`. `fetchImpl` is injectable for tests. Throws on a non-2xx, a non-JSON body or a mismatched issuer.
 */
export async function fetchIssuerKeyfile(domain, { fetchImpl = fetch } = {}) {
  if (!isHostname(domain)) throw new Error(`not a hostname: ${domain}`);
  const url = `https://${domain}/.well-known/tgart-keys.json`;
  const r = await fetchImpl(url, { redirect: 'error' });
  if (!r.ok) throw new Error(`${url} returned ${r.status}`);
  const kf = JSON.parse(await r.text());
  if (kf.issuer !== domain) throw new Error(`the file at ${url} names issuer ${JSON.stringify(kf.issuer)}, not ${domain}`);
  const v = validateKeyfile(kf);
  if (!v.ok) throw new Error(`the key file at ${url} did not verify: ${v.problems.join('; ')}`);
  return { url, keyfile: kf };
}
