#!/usr/bin/env node
// tg — read and check a Typogram's three views (docs/typogram-file.md, docs/canonical-text.md).
//
//   tg verify  <file>                         prove the picture, the embedded source and the stored hash all carry one text
//   tg extract <file> [--markdown|--json|--text] [--from-glyphs]
//                                             read the data layer (the exact source / the JSON-LD record / the plain text);
//                                             --from-glyphs reads the IMAGE layer (the glyphs) instead
//
// A Typogram is a picture made of its own readable text (the IMAGE layer) that also carries, in a DATA layer, the exact
// source and a JSON-LD record whose tgart.hash binds the two. `tg verify` recomputes the hash from the image layer and
// requires it to equal both the stored hash and the hash of the embedded source. Works on .svg, .html and .pdf.
import { readFileSync, writeFileSync, mkdirSync, openSync, writeSync, closeSync, constants as fsConstants, mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { extname, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { markupText, canonicalText, sha256Hex, stripDataLayer, readDataMarkdown, readJsonld, withJsonld } from '../src/index.js';
import { generateIssuerKey, signKeyStatement, verifyKeyStatement, signHash, verifyHash, SIG_SPEC } from '../src/sign.js';
import { buildBundle, verifyBundle } from './bundle.mjs';
import { openSession } from './core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const has = (cmd) => spawnSync('which', [cmd]).status === 0;
const die = (m, code = 1) => { console.error(`tg: ${m}`); process.exit(code); };
const decodeEntities = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|quot|apos|amp);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[e.toLowerCase()]);

/** The text of the first ATX heading in a Markdown source, or null. Mirrors onepage-core and tools/tg_extract.py. */
function firstHeading(md) {
  for (const raw of String(md || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    return m ? m[2].trim() : null;
  }
  return null;
}

function kindOf(file, raw) {
  const ext = extname(file).toLowerCase();
  if (ext === '.svg') return 'svg';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (ext === '.pdf') return 'pdf';
  if (raw.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  const head = raw.toString('utf8', 0, 400).trimStart();
  if (/<svg\b/i.test(head)) return 'svg';
  if (/<!doctype html|<html\b/i.test(head)) return 'html';
  return die(`unknown format for ${file} (expected .svg, .html or .pdf)`);
}

/** The Markdown carried in an HTML Typogram's <script type="text/markdown">, with the "<\/script" escape reversed, or null. */
function htmlMarkdown(raw) {
  const m = /<script type="text\/markdown">([\s\S]*?)<\/script>/.exec(raw);
  return m ? m[1].replace(/<\\\/(script)/gi, '</$1') : null;
}

// ---- the two layers, per format --------------------------------------------------------------------------------------
function imageLayerText(kind, file, text) {
  if (kind === 'svg') return markupText(text, 'svg');
  if (kind === 'html') return markupText(text, 'html');
  if (!has('mutool')) die('reading a PDF needs MuPDF (mutool)');
  const r = spawnSync('mutool', ['draw', '-q', '-F', 'txt', '-o', '-', file], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) die(`MuPDF could not read ${file}: ${String(r.stderr || '').trim().split('\n')[0] || ''}`);
  return r.stdout;
}

function pdfAttachments(file) {
  if (!has('mutool')) die('reading a PDF needs MuPDF (mutool)');
  const dir = mkdtempSync(join(tmpdir(), 'tg-pdf-read-'));
  try {
    const r = spawnSync('mutool', ['run', join(HERE, 'pdf-read-attachments.js'), file, dir], { encoding: 'utf8' });
    if (r.status !== 0) die(`MuPDF could not read ${file}: ${String(r.stderr || '').trim().split('\n')[0] || ''}`);
    const srcName = existsSync(join(dir, 'source.md')) ? 'source.md' : existsSync(join(dir, 'source.txt')) ? 'source.txt' : null;
    const markdown = srcName ? readFileSync(join(dir, srcName), 'utf8') : null;
    let jsonld = null;
    if (existsSync(join(dir, 'metadata.json'))) { try { jsonld = JSON.parse(readFileSync(join(dir, 'metadata.json'), 'utf8')); } catch { /* broken attachment */ } }
    const media = srcName === 'source.txt' ? 'text/plain' : 'text/markdown';
    return { markdown, jsonld, media };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function dataLayer(kind, file, text) {
  if (kind === 'svg') { const s = readDataMarkdown(text); return { markdown: s ? s.markdown : null, media: s ? s.media : null, jsonld: readJsonld(text) }; }
  if (kind === 'html') return { markdown: htmlMarkdown(text), media: 'text/markdown', jsonld: readJsonld(text) };
  return pdfAttachments(file);
}

/** The visible title of the picture: the SVG <title> or the HTML <article>'s first <h1>. PDF has no in-page title. */
function visibleTitle(kind, text) {
  if (kind === 'svg') { const m = /<title>([\s\S]*?)<\/title>/.exec(stripDataLayer(text)); return m ? decodeEntities(m[1]).trim() : null; }
  if (kind === 'html') { const m = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(text); return m ? decodeEntities(m[1].replace(/<[^>]+>/g, '')).trim() : null; }
  return null;
}

/** The first index where two strings differ, or -1 if one is a prefix-equal of the other (same length) / they are equal. */
function firstDivergence(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}
const around = (s, i) => JSON.stringify(s.slice(Math.max(0, i - 20), i + 20));

/** Plain prose from Markdown: block/inline markers removed, line structure kept. Used by `tg extract --text`. */
function plainText(md) {
  return String(md)
    .replace(/^ {0,3}(#{1,6})\s+/gm, '').replace(/^ {0,3}[-*+]\s+/gm, '').replace(/^ {0,3}\d+[.)]\s+/gm, '')
    .replace(/^ {0,3}(`{3,}|~{3,}).*$/gm, '').replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/(^|[^\w])_([^_]+)_/g, '$1$2')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
}

// ---- verify ----------------------------------------------------------------------------------------------------------
async function cmdVerify(file) {
  const raw = readFileSync(file), kind = kindOf(file, raw), text = kind === 'pdf' ? '' : raw.toString('utf8');
  const dl = dataLayer(kind, file, text);
  if (dl.markdown == null && dl.jsonld == null) die(`no data layer found in ${file} — is it a Typogram made by this tool?`);

  const imgCanon = canonicalText(imageLayerText(kind, file, text));
  const imgHash = await sha256Hex(imgCanon);
  const mdCanon = dl.markdown != null ? canonicalText(dl.markdown) : null;
  const mdHash = mdCanon != null ? await sha256Hex(mdCanon) : null;
  const storedHash = dl.jsonld && dl.jsonld.tgart ? dl.jsonld.tgart.hash : null;

  const problems = [];
  // storedHash is attacker-controlled (straight from the file's tgart.hash); a real one is 64 lowercase hex (canonical-text.md).
  // Validate before printing it raw, so a crafted hash cannot inject ANSI/newline escapes into the terminal — and so a non-hex
  // value is itself a tamper signal. imgHash/mdHash come from sha256Hex and are always safe hex.
  if (!storedHash) problems.push('the data layer carries no identity hash (tgart.hash)');
  else if (typeof storedHash !== 'string' || !/^[0-9a-f]{64}$/.test(storedHash)) problems.push('the stored identity hash is not a valid SHA-256 (64 lowercase hex)');
  else if (imgHash !== storedHash) problems.push(`image-layer hash ${imgHash} ≠ stored hash ${storedHash}`);
  if (mdHash == null) problems.push('the data layer carries no embedded source');
  else if (imgHash !== mdHash) problems.push(`image-layer hash ${imgHash} ≠ embedded-source hash ${mdHash}`);

  // where the image layer and the source first diverge (helps locate a tamper)
  if (mdCanon != null && imgCanon !== mdCanon) {
    const i = firstDivergence(imgCanon, mdCanon);
    problems.push(`image and source first differ at character ${i}:\n    image : …${around(imgCanon, i)}…\n    source: …${around(mdCanon, i)}…`);
  }

  // lint: words on one side only (only meaningful when the texts already differ)
  if (mdCanon != null && imgCanon !== mdCanon) {
    const w = (s) => new Set(s.split(' ').filter(Boolean));
    const img = w(imgCanon), md = w(mdCanon);
    const onlyImg = [...img].filter((x) => !md.has(x)).slice(0, 8), onlyMd = [...md].filter((x) => !img.has(x)).slice(0, 8);
    if (onlyImg.length) console.error(`tg: warning — words only in the image layer: ${onlyImg.map((x) => JSON.stringify(x)).join(' ')}`);
    if (onlyMd.length) console.error(`tg: warning — words only in the data layer: ${onlyMd.map((x) => JSON.stringify(x)).join(' ')}`);
  }

  // lint: the visible title must match the source's first heading (SVG/HTML)
  const title = visibleTitle(kind, text), heading = firstHeading(dl.markdown);
  if (title && heading && canonicalText(title) !== canonicalText(heading))
    problems.push(`the visible title ${JSON.stringify(title)} is not the start of the data layer (first heading ${JSON.stringify(heading)})`);

  if (problems.length) { console.error(`tg: TAMPERED — ${file}\n  - ${problems.join('\n  - ')}`); process.exit(1); }

  // Phase H signature state: VERIFIED / UNSIGNED / TAMPERED, exit 0 / 2 / 1. The text is consistent here (no problems above).
  const tgart = (dl.jsonld && dl.jsonld.tgart) || {};
  if (!tgart.signature) {
    console.log(`tg: UNSIGNED — ${file}`);
    console.log(`  image layer, embedded source and stored hash all carry one text (sha256 ${imgHash}) — consistent, but not signed`);
    process.exit(2);
  }
  const { issuer, kid, created, signature } = tgart;
  // the record's fields are attacker-controlled: validate their shape before any path lookup, trust check or printing
  if (!isHostname(issuer) || !isKid(kid) || !isIsoDate(created)) {
    console.error(`tg: TAMPERED — ${file}\n  - the signature record has a malformed issuer, kid or date`);
    process.exit(1);
  }
  const kf = loadKeyfile(opt('keys'), issuer);
  const sigProblems = [];
  let pub = null;
  // a kid revoked by any valid statement in this key file is rejected
  const revoked = new Set();
  for (const k of (kf && Array.isArray(kf.keys) ? kf.keys : [])) {
    if (k && Array.isArray(k.revokes) && k.revokes.length && verifyKeyStatement(k).ok) k.revokes.forEach((r) => revoked.add(r));
  }
  const stmt = kf && Array.isArray(kf.keys) ? kf.keys.find((k) => k && k.kid === kid) : null;
  if (!stmt) sigProblems.push(`no key for issuer ${issuer} (kid ${kid}) — give the issuer key file with --keys`);
  else if (stmt.revoked || revoked.has(kid)) sigProblems.push(`the signing key (kid ${kid}) has been revoked`);
  else {
    const kv = verifyKeyStatement(stmt);
    if (!kv.ok) sigProblems.push('the issuer key statement did not verify (self-signature, predecessor or validity)');
    else if (kv.issuer !== issuer) sigProblems.push('the key file issuer does not match the signed issuer');
    else if (stmt.created && created < stmt.created) sigProblems.push(`the signature date ${created} is before the key's validity (${stmt.created})`);
    else if (stmt.expires && created > stmt.expires) sigProblems.push(`the signature date ${created} is after the key expired (${stmt.expires})`);
    else pub = kv.publicKey;
  }
  if (pub && verifyHash({ hash: imgHash, issuer, kid, created, signature }, pub)) {
    console.log(`tg: VERIFIED — ${file}`);
    console.log(`  signed by ${issuer} (kid ${kid}, ${created}); the image layer, the embedded source and the signature all cover one text (sha256 ${imgHash})`);
    process.exit(0);
  }
  if (!sigProblems.length) sigProblems.push('the signature does not match the text and this issuer key');
  console.error(`tg: TAMPERED — ${file}\n  - ${sigProblems.join('\n  - ')}`);
  process.exit(1);
}

// ---- extract ---------------------------------------------------------------------------------------------------------
async function cmdExtract(file, mode, fromGlyphs) {
  const raw = readFileSync(file), kind = kindOf(file, raw), text = kind === 'pdf' ? '' : raw.toString('utf8');
  if (fromGlyphs) {
    if (mode === 'json') die('--json cannot be read from the glyphs (the image layer has no JSON-LD record)');
    const img = imageLayerText(kind, file, text);
    process.stdout.write(mode === 'text' ? canonicalText(img) + '\n' : img.endsWith('\n') ? img : img + '\n');
    return;
  }
  const dl = dataLayer(kind, file, text);
  if (mode === 'json') {
    if (!dl.jsonld) die(`${file} carries no JSON-LD record`);
    process.stdout.write(JSON.stringify(dl.jsonld, null, 2) + '\n');
    return;
  }
  if (dl.markdown == null) die(`${file} carries no embedded source (try --from-glyphs to read the picture's text)`);
  const out = mode === 'text' ? plainText(dl.markdown) : dl.markdown;
  process.stdout.write(out.endsWith('\n') ? out : out + '\n');
}

// ---- keygen ----------------------------------------------------------------------------------------------------------
/** A valued flag from argv: `--name value`. Returns `def` if absent or if the next token is itself a flag. */
function opt(name, def = null) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] != null && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
}
const readKeyfile = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const writeJson = (p, obj) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(obj, null, 2) + '\n'); };

/**
 * Write a private key safely: create a NEW file exclusively (O_EXCL, fail if it exists), mode 600, and never follow a symlink
 * (O_NOFOLLOW). This avoids a TOCTOU / symlink attack — the secret cannot land on an attacker-planted path or an existing
 * file whose permissions are looser than 600.
 */
function writePrivateKey(path, pem) {
  mkdirSync(dirname(path), { recursive: true });
  const flags = fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW || 0);
  let fd;
  try { fd = openSync(path, flags, 0o600); }
  catch (e) { die(e.code === 'EEXIST' ? `refusing to overwrite ${path} — choose a fresh path for the private key` : `could not create ${path}: ${e.message}`); }
  try { writeSync(fd, pem.endsWith('\n') ? pem : pem + '\n'); } finally { closeSync(fd); }
}

/**
 * `tg keygen --issuer <domain> [--kid <id>] [--out <dir>] [--private-out <file>]` — a new Ed25519 issuer key, written as a
 * self-signed key statement into the issuer's key file (the repo mirror keys/<domain>.json and the served
 * .well-known/tgart-keys.json). The private key goes to --private-out (mode 600) or, if omitted, to stdout, clearly marked.
 */
function cmdKeygen() {
  const issuer = opt('issuer');
  if (!issuer) die('usage: tg keygen --issuer <domain> [--kid <id>] [--out <dir>] [--private-out <file>]');
  const kid = opt('kid') || new Date().toISOString().slice(0, 7); // YYYY-MM
  const outDir = opt('out') || process.cwd();
  const privateOut = opt('private-out');

  const key = generateIssuerKey();
  const statement = signKeyStatement({ issuer, kid, publicKey: key.publicKey, created: key.created }, key.privatePem);
  if (!verifyKeyStatement(statement).ok) die('internal error: the generated key statement did not verify');

  const keysPath = join(outDir, 'keys', `${issuer}.json`);
  const wellKnownPath = join(outDir, '.well-known', 'tgart-keys.json');
  const existing = readKeyfile(keysPath) || readKeyfile(wellKnownPath) || { issuer, keys: [] };
  const keys = (Array.isArray(existing.keys) ? existing.keys : []).filter((k) => k && k.kid !== kid).concat([statement]);
  const keyfile = { issuer, keys };
  writeJson(keysPath, keyfile);
  writeJson(wellKnownPath, keyfile);

  if (privateOut) writePrivateKey(privateOut, key.privatePem);
  console.log(`tg: new Ed25519 issuer key for ${issuer}`);
  console.log(`  kid:        ${kid}`);
  console.log(`  public key: ${key.publicKey}`);
  console.log(`  key file:   ${keysPath}`);
  console.log(`  served at:  ${wellKnownPath}  (publish at https://${issuer}/.well-known/tgart-keys.json)`);
  if (privateOut) {
    console.log(`  PRIVATE key -> ${privateOut} (mode 600). It is the SECRET; it is NOT in the key file. Store it safely.`);
  } else {
    console.log('\n  PRIVATE key (PKCS#8 PEM) — SECRET. Store it safely (a secret manager); it is NOT in the key file:\n');
    process.stdout.write(key.privatePem.endsWith('\n') ? key.privatePem : key.privatePem + '\n');
  }
}

/**
 * The issuer key file for verification: `--keys` may be a key file itself, or a directory holding `<issuer>.json` or
 * `.well-known/tgart-keys.json`. Without `--keys`, `keys/<issuer>.json` relative to the current directory. Returns the
 * `{ issuer, keys: [...] }` object, or null.
 */
// These come from the (untrusted) file and feed paths, trust decisions and terminal output — validate their shape before any of
// that: a non-hostname issuer must never build a key-file path (traversal), and only well-formed values are ever printed.
const isHostname = (s) => typeof s === 'string' && /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(s);
const isKid = (s) => typeof s === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(s);
const isIsoDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

function loadKeyfile(keysArg, issuer) {
  if (issuer != null && !isHostname(issuer)) return null; // never build a key-file path from a non-hostname issuer (path traversal)
  const tryfile = (p) => { try { const o = JSON.parse(readFileSync(p, 'utf8')); return o && Array.isArray(o.keys) ? o : null; } catch { return null; } };
  if (keysArg) return tryfile(keysArg) || (issuer && (tryfile(join(keysArg, `${issuer}.json`)) || tryfile(join(keysArg, 'keys', `${issuer}.json`)))) || tryfile(join(keysArg, '.well-known', 'tgart-keys.json')) || null;
  return issuer ? tryfile(join(process.cwd(), 'keys', `${issuer}.json`)) : null;
}

/**
 * `tg sign <file> --key <private-key.pem> --issuer <domain> --kid <id> [--out <file>]` — sign a Typogram's identity hash and
 * write the signature into its data-layer record. SVG/HTML only. The image layer and the exact source are untouched, so the
 * identity hash is unchanged; only the record gains spec/issuer/kid/created/signature/keys/verify.
 */
async function cmdSign(file) {
  const keyFile = opt('key'), issuer = opt('issuer'), kid = opt('kid');
  if (!file || !keyFile || !issuer || !kid) die('usage: tg sign <file> --key <private-key.pem> --issuer <domain> --kid <id> [--out <file>]');
  if (!isHostname(issuer)) die('--issuer must be a hostname, e.g. typographics-art.org');
  if (!isKid(kid)) die('--kid must be 1–64 characters of A–Z a–z 0–9 . _ -');
  const raw = readFileSync(file), kind = kindOf(file, raw);
  if (kind === 'pdf') die('tg sign supports .svg and .html (a PDF carries its record in an attachment)');
  const text = raw.toString('utf8');
  const record = readJsonld(text);
  if (!record || !record.tgart || typeof record.tgart.hash !== 'string') die(`${file} has no identity hash to sign — is it a Typogram made by this tool?`);
  const imgHash = await sha256Hex(canonicalText(imageLayerText(kind, file, text)));
  if (imgHash !== record.tgart.hash) die(`refusing to sign: image-layer hash ${imgHash} ≠ stored hash ${record.tgart.hash} — the file is inconsistent, verify it first`);
  const created = new Date().toISOString().slice(0, 10);
  const signature = signHash({ hash: record.tgart.hash, issuer, kid, created }, readFileSync(keyFile, 'utf8'));
  record.tgart = { ...record.tgart, spec: SIG_SPEC, issuer, kid, created, signature, keys: `https://${issuer}/.well-known/tgart-keys.json`, verify: `https://${issuer}/v` };
  const out = withJsonld(text, record);
  if (!out) die('could not write the signature into the data layer');
  const outFile = opt('out') || file;
  writeFileSync(outFile, out);
  console.log(`tg: signed ${file} as ${issuer} (kid ${kid})${outFile !== file ? ` -> ${outFile}` : ''}`);
  console.log(`  sha256 ${record.tgart.hash}`);
}

// ---- argv ------------------------------------------------------------------------------------------------------------
// Phase I1 — bundle a folder of Markdown docs into signed Typograms + a signed index, and verify such a folder.
async function cmdBundle(folder) {
  const keyFile = opt('key'), issuer = opt('issuer'), kid = opt('kid');
  const out = opt('out') || (argv.indexOf('-o') >= 0 && argv[argv.indexOf('-o') + 1] && !argv[argv.indexOf('-o') + 1].startsWith('-') ? argv[argv.indexOf('-o') + 1] : null);
  if (!folder || !keyFile || !issuer || !kid || !out) die('usage: tg bundle <folder> -o <out-dir> --key <private-key.pem> --issuer <domain> --kid <id> [--title <text>]');
  if (!isHostname(issuer)) die('--issuer must be a hostname, e.g. typographics-art.org');
  if (!isKid(kid)) die('--kid must be 1–64 characters of A–Z a–z 0–9 . _ -');
  const session = await openSession();
  try {
    const m = await buildBundle(folder, out, { session, keyPem: readFileSync(keyFile, 'utf8'), issuer, kid, title: opt('title') });
    console.log(`tg: bundled ${m.documents.length} document(s) into ${out} as ${issuer} (kid ${kid})`);
    console.log(`  index ${m.indexHash}  — signing the index seals the whole folder`);
  } finally { await session.close(); }
}

async function cmdVerifyBundle(dir) {
  const r = await verifyBundle(dir, { loadKeyfile: (issuer) => loadKeyfile(opt('keys'), issuer) });
  console.log(`tg: ${r.state} — ${dir} (${r.documents} document(s), issuer ${r.issuer})`);
  for (const i of r.issues) console.log(`  - ${i}`);
  process.exit({ VERIFIED: 0, UNSIGNED: 2, TAMPERED: 1 }[r.state] ?? 1);
}

const argv = process.argv.slice(2);
const cmd = argv.shift();
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const positionals = argv.filter((a) => !a.startsWith('--'));
const file = positionals[0];
const mode = flags.has('--json') ? 'json' : flags.has('--text') ? 'text' : 'markdown';

if (cmd === 'verify') { if (!file) die('usage: tg verify <file|folder>'); if (existsSync(file) && statSync(file).isDirectory()) await cmdVerifyBundle(file); else await cmdVerify(file); }
else if (cmd === 'extract') { if (!file) die('usage: tg extract <file> [--markdown|--json|--text] [--from-glyphs]'); await cmdExtract(file, mode, flags.has('--from-glyphs')); }
else if (cmd === 'keygen') { cmdKeygen(); }
else if (cmd === 'sign') { if (!file) die('usage: tg sign <file> --key <private-key.pem> --issuer <domain> --kid <id> [--out <file>]'); await cmdSign(file); }
else if (cmd === 'bundle') { await cmdBundle(file); }
else {
  console.error([
    'usage:',
    '  tg verify <file|folder> [--keys <dir|file>] verify a Typogram or a bundle folder: VERIFIED (0) / UNSIGNED (2) / TAMPERED (1)',
    '  tg extract <file> [--markdown|--json|--text] [--from-glyphs]',
    '  tg keygen --issuer <domain> [--kid <id>] [--out <dir>] [--private-out <file>]',
    '  tg sign <file> --key <private-key.pem> --issuer <domain> --kid <id> [--out <file>]',
    '  tg bundle <folder> -o <out-dir> --key <private-key.pem> --issuer <domain> --kid <id> [--title <text>]',
  ].join('\n'));
  process.exit(cmd === '--help' || cmd === '-h' ? 0 : 1);
}
