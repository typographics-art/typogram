// Phase I3 — handoff packages. A handoff is a set of files one person (or their agent) hands to another, sealed and
// signed: the files are packed into one archive, that archive becomes the plaintext of a sealed Typogram (cli/seal.mjs),
// and the sender signs it (Phase H). So `tg open` on a handoff checks the sender's signature, decrypts with the
// recipient's key, and writes the files out — only after showing the manifest and being confirmed. Responsibility is the
// user's and their agent's: the tool selects nothing and filters nothing silently; it shows every file (path, size,
// origin) and, by default, runs a warn-only secret scan. This module is the archive format and the scan (pure, no I/O).
import { createHash } from 'node:crypto';

export const HANDOFF_SPEC = 'tgart-handoff-v1';
// Where each file came from — set by whoever builds the package. Files read from a repo/filesystem are "human";
// an agent's own summary is "ai-summary"; anything else it generated is "ai-generated". A file with no origin is refused.
export const ORIGINS = new Set(['human', 'ai-summary', 'ai-generated']);

/**
 * Build a handoff archive from `entries` (`[{ path, bytes, origin }]`). Returns a plain object: a `manifest`
 * (path, size, origin, sha256 per file) and `files` (path → base64). It carries the file bytes, so it is the plaintext
 * that gets sealed — never write it unencrypted.
 */
export function buildArchive(entries, { created = new Date().toISOString().slice(0, 10), title = null } = {}) {
  const files = {};
  const manifest = [];
  const seen = new Set();
  for (const e of entries) {
    const path = String(e.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!path || path.split('/').includes('..')) throw new Error(`unsafe archive path: ${JSON.stringify(e.path)}`);
    if (seen.has(path)) throw new Error(`duplicate path in handoff: ${path}`);
    if (!ORIGINS.has(e.origin)) throw new Error(`${path}: origin must be one of ${[...ORIGINS].join(', ')}`);
    seen.add(path);
    const b = Buffer.isBuffer(e.bytes) ? e.bytes : Buffer.from(e.bytes);
    files[path] = b.toString('base64');
    manifest.push({ path, size: b.length, origin: e.origin, sha256: createHash('sha256').update(b).digest('hex') });
  }
  if (!manifest.length) throw new Error('a handoff needs at least one file');
  return { spec: HANDOFF_SPEC, created, title, manifest, files };
}

/** The archive as the text to seal (compact JSON). */
export const archiveToText = (archive) => JSON.stringify(archive);

/** Parse a decrypted handoff archive, or null if the text is not one. Verifies each file's sha256 against the manifest. */
export function readArchive(text) {
  let a;
  try { a = JSON.parse(text); } catch { return null; }
  if (!a || a.spec !== HANDOFF_SPEC || !Array.isArray(a.manifest) || !a.files || typeof a.files !== 'object') return null;
  return a;
}

/** Yield each file in a handoff archive as `{ path, origin, size, bytes }`, checking its hash. Throws on a mismatch. */
export function* archiveFiles(archive) {
  for (const m of archive.manifest) {
    const b = Buffer.from(archive.files[m.path] || '', 'base64');
    const h = createHash('sha256').update(b).digest('hex');
    if (h !== m.sha256) throw new Error(`${m.path}: content does not match the manifest hash`);
    yield { path: m.path, origin: m.origin, size: b.length, bytes: b };
  }
}

// A warn-only secret scan over file contents. It never blocks; it points out what looks like a credential so a person
// can decide. Patterns are deliberately broad and few — this is a nudge, not a vault.
const SECRET_PATTERNS = [
  [/-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, 'a private key block'],
  [/AKIA[0-9A-Z]{16}/, 'an AWS access key id'],
  [/\bghp_[A-Za-z0-9]{36}\b/, 'a GitHub token'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, 'a Slack token'],
  [/\b(?:npm_[A-Za-z0-9]{36}|AGE-SECRET-KEY-1[0-9A-Z]{20,})\b/, 'an npm or age secret'],
  [/\b(?:api[_-]?key|secret|passwd|password|token)\s*[:=]\s*["']?[A-Za-z0-9/+_-]{16,}/i, 'a key/secret assignment'],
];

/** Scan entries (`[{ path, bytes }]`) for anything that looks like a secret. Returns `[{ path, what }]` (empty = clean). */
export function scanSecrets(entries) {
  const hits = [];
  for (const e of entries) {
    let text;
    try { text = (Buffer.isBuffer(e.bytes) ? e.bytes : Buffer.from(e.bytes)).toString('utf8'); } catch { continue; }
    for (const [re, what] of SECRET_PATTERNS) if (re.test(text)) hits.push({ path: e.path, what });
  }
  return hits;
}
