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
import { readFileSync, writeFileSync, mkdirSync, openSync, writeSync, closeSync, constants as fsConstants, mkdtempSync, rmSync, existsSync, statSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { extname, join, dirname, basename, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { markupText, canonicalText, sha256Hex, stripDataLayer, readDataMarkdown, readJsonld, withJsonld } from '../src/index.js';
import { generateIssuerKey, signKeyStatement, verifyKeyStatement, signHash, verifyHash, SIG_SPEC } from '../src/sign.js';
import { buildBundle, verifyBundle } from './bundle.mjs';
import { openSession } from './core.mjs';
import { makeOnePage } from './onepage-core.mjs';
import { sealText, openSealedText, isSealed, parseEnvelope } from './seal.mjs';
import { generateX25519Identity, identityToRecipient } from '../vendor/age-encryption.mjs';
import { buildRegistry, verifyRegistry, verifiedMap, fetchIssuerKeyfile, validateKeyfile } from './keys-registry.mjs';
import { buildArchive, archiveToText, readArchive, archiveFiles, scanSecrets, ORIGINS } from './handoff.mjs';

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
/**
 * Judge a Typogram without printing or exiting: returns `{ state, imgHash, tgart, sealed, dl, issuer?, kid?, created?,
 * problems, warnings }`. `state` is VERIFIED / UNSIGNED / TAMPERED. `sealed` is true for a sealed work (tgart.mode).
 * `cmdVerify` prints and exits on this; `cmdOpen` gates decryption on `state === 'VERIFIED'`.
 */
async function evaluate(file) {
  const raw = readFileSync(file), kind = kindOf(file, raw), text = kind === 'pdf' ? '' : raw.toString('utf8');
  const dl = dataLayer(kind, file, text);
  if (dl.markdown == null && dl.jsonld == null) die(`no data layer found in ${file} — is it a Typogram made by this tool?`);

  const imgCanon = canonicalText(imageLayerText(kind, file, text));
  const imgHash = await sha256Hex(imgCanon);
  const mdCanon = dl.markdown != null ? canonicalText(dl.markdown) : null;
  const mdHash = mdCanon != null ? await sha256Hex(mdCanon) : null;
  const storedHash = dl.jsonld && dl.jsonld.tgart ? dl.jsonld.tgart.hash : null;
  const tgart = (dl.jsonld && dl.jsonld.tgart) || {};
  // "sealed" is decided by the presence of an age payload in the EMBEDDED SOURCE (which the hash + signature cover),
  // not by tgart.mode (free-form JSON, not signed): an attacker must not be able to add or strip the SEALED label.
  const sealed = dl.markdown != null && isSealed(dl.markdown);
  const base = { file, kind, text, dl, tgart, sealed, imgHash, warnings: [] };

  const problems = [];
  // storedHash is attacker-controlled (straight from the file's tgart.hash); a real one is 64 lowercase hex (canonical-text.md).
  // Validate before printing it raw, so a crafted hash cannot inject ANSI/newline escapes into the terminal — and so a non-hex
  // value is itself a tamper signal. imgHash/mdHash come from sha256Hex and are always safe hex.
  if (!storedHash) problems.push('the data layer carries no identity hash (tgart.hash)');
  else if (typeof storedHash !== 'string' || !/^[0-9a-f]{64}$/.test(storedHash)) problems.push('the stored identity hash is not a valid SHA-256 (64 lowercase hex)');
  else if (imgHash !== storedHash) problems.push(`image-layer hash ${imgHash} ≠ stored hash ${storedHash}`);
  if (mdHash == null) problems.push('the data layer carries no embedded source');
  else if (imgHash !== mdHash) problems.push(`image-layer hash ${imgHash} ≠ embedded-source hash ${mdHash}`);

  // where the image layer and the source first diverge (helps locate a tamper), plus words on one side only
  if (mdCanon != null && imgCanon !== mdCanon) {
    const i = firstDivergence(imgCanon, mdCanon);
    problems.push(`image and source first differ at character ${i}:\n    image : …${around(imgCanon, i)}…\n    source: …${around(mdCanon, i)}…`);
    const w = (s) => new Set(s.split(' ').filter(Boolean));
    const img = w(imgCanon), md = w(mdCanon);
    const onlyImg = [...img].filter((x) => !md.has(x)).slice(0, 8), onlyMd = [...md].filter((x) => !img.has(x)).slice(0, 8);
    if (onlyImg.length) base.warnings.push(`words only in the image layer: ${onlyImg.map((x) => JSON.stringify(x)).join(' ')}`);
    if (onlyMd.length) base.warnings.push(`words only in the data layer: ${onlyMd.map((x) => JSON.stringify(x)).join(' ')}`);
  }

  // lint: the visible title must match the source's first heading (SVG/HTML)
  const title = visibleTitle(kind, text), heading = firstHeading(dl.markdown);
  if (title && heading && canonicalText(title) !== canonicalText(heading))
    problems.push(`the visible title ${JSON.stringify(title)} is not the start of the data layer (first heading ${JSON.stringify(heading)})`);

  if (problems.length) return { ...base, state: 'TAMPERED', problems };

  // Phase H signature state. The text is consistent here (no problems above).
  if (!tgart.signature) return { ...base, state: 'UNSIGNED', problems };
  const { issuer, kid, created, signature } = tgart;
  // the record's fields are attacker-controlled: validate their shape before any path lookup, trust check or printing
  if (!isHostname(issuer) || !isKid(kid) || !isIsoDate(created))
    return { ...base, state: 'TAMPERED', problems: ['the signature record has a malformed issuer, kid or date'] };

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
  if (pub && verifyHash({ hash: imgHash, issuer, kid, created, signature }, pub))
    return { ...base, state: 'VERIFIED', issuer, kid, created, problems };
  if (!sigProblems.length) sigProblems.push('the signature does not match the text and this issuer key');
  return { ...base, state: 'TAMPERED', problems: sigProblems };
}

async function cmdVerify(file) {
  const r = await evaluate(file);
  for (const w of r.warnings) console.error(`tg: warning — ${w}`);
  const seal = r.sealed ? 'SEALED ' : '';
  if (r.state === 'TAMPERED') { console.error(`tg: ${seal}TAMPERED — ${file}\n  - ${r.problems.join('\n  - ')}`); process.exit(1); }
  if (r.state === 'UNSIGNED') {
    console.log(`tg: ${seal}UNSIGNED — ${file}`);
    console.log(`  image layer, embedded source and stored hash all carry one text (sha256 ${r.imgHash}) — consistent, but not signed`);
    process.exit(2);
  }
  console.log(`tg: ${seal}VERIFIED — ${file}`);
  if (r.sealed) {
    // Recipients and cipher come from the SIGNED envelope text (the To: / Sealed lines the hash covers), not from the
    // unsigned tgart JSON, and are sanitised (control chars stripped, bounded) so a crafted value cannot corrupt output.
    const clean = (s) => String(s || '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().slice(0, 200);
    const env = parseEnvelope(r.dl.markdown || '');
    const to = clean(env.to) || '?', cipher = clean(env.cipher) || 'age';
    console.log(`  signed by ${r.issuer} (kid ${r.kid}, ${r.created}); sealed (${cipher}) to ${to} — open with your key to read it (sha256 ${r.imgHash})`);
  } else {
    console.log(`  signed by ${r.issuer} (kid ${r.kid}, ${r.created}); the image layer, the embedded source and the signature all cover one text (sha256 ${r.imgHash})`);
  }
  process.exit(0);
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
/** Every value of a repeatable flag `--name v1 --name v2`, in order. */
function opts(name) {
  const out = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === `--${name}` && argv[i + 1] != null && !argv[i + 1].startsWith('--')) out.push(argv[i + 1]);
  return out;
}
/** Positional args, excluding the values consumed by the named valued flags (so `--to X` does not count X as positional). */
function positionalArgs(valued) {
  const consumed = new Set();
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--') && valued.includes(argv[i].slice(2)) && argv[i + 1] != null && !argv[i + 1].startsWith('--')) consumed.add(i + 1);
  return argv.filter((a, i) => !a.startsWith('--') && !consumed.has(i));
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
  const tryfile = (p) => { try {
    const o = JSON.parse(readFileSync(p, 'utf8'));
    if (o && Array.isArray(o.keys)) return o; // a plain issuer key file { issuer, keys }
    // the verified-issuer registry (keys/registry.json): pick the matching issuer, so --keys can be the whole registry
    if (o && o.spec === 'tgart-registry-v1' && Array.isArray(o.issuers) && issuer) {
      const e = o.issuers.find((x) => x && x.issuer === issuer);
      return e && Array.isArray(e.keys) ? { issuer: e.issuer, keys: e.keys } : null;
    }
    return null;
  } catch { return null; } };
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

// ---- seal / open (Phase I2) ------------------------------------------------------------------------------------------
const AGE_RECIPIENT = /^age1[0-9a-z]+$/;          // an age public key (X25519 recipient)
const AGE_IDENTITY_LINE = /^AGE-SECRET-KEY-/;      // an age identity (private, opens a sealed work)

/**
 * `tg seal <file.md> --to [<issuer:kid>=]<age1…> [--to …] --key <private-key.pem> --issuer <domain> --kid <id> [--out
 * <file.svg>] [--title <text>]` — encrypt a document to one or more age recipients, set it as the picture + data layer of
 * a Typogram, mark the record sealed (tgart.mode="sealed", cipher, recipients), and sign it. The whole sealed text (the
 * envelope AND the ciphertext) is what the signature covers, so `tg verify` proves it before anyone decrypts.
 */
/** Parse `--to` recipients: `age1…` or `issuer:kid=age1…`. */
function parseRecipients(tos) {
  return tos.map((t) => {
    const eq = t.indexOf('=');
    const label = eq >= 0 ? t.slice(0, eq) : null, publicKey = eq >= 0 ? t.slice(eq + 1) : t;
    if (!AGE_RECIPIENT.test(publicKey)) die(`--to recipient is not an age public key (age1…): ${JSON.stringify(t)}`);
    if (label && label.includes(':')) { const [ri, rk] = label.split(':'); return { issuer: ri, kid: rk || '-', publicKey }; }
    return { label: label || `recipient-${publicKey.slice(4, 14)}`, publicKey };
  });
}

/**
 * Seal `plaintext` to `recipients`, render it as a Typogram, mark the record (`mode`) and sign it with the sender's key.
 * Shared by `tg seal` (mode "sealed") and `tg handoff` (mode "handoff"). The whole sealed text — the cleartext envelope
 * AND the ciphertext — is what the signature covers, so `tg verify` proves it before anyone decrypts. Returns the hash.
 */
async function sealRenderSign({ plaintext, title, issuer, kid, keyFile, recipients, outFile, mode, toc }) {
  const { text, recipients: recMeta, cipher } = await sealText({ plaintext, title, sender: issuer, recipients, toc });
  const session = await openSession();
  try { await makeOnePage(session, { text, title, source: { bytes: Buffer.from(text, 'utf8'), media: 'text/markdown' }, svg: outFile, meta: { title } }); }
  finally { await session.close(); }
  let svg = readFileSync(outFile, 'utf8');
  const rec = readJsonld(svg);
  if (!rec || !rec.tgart || typeof rec.tgart.hash !== 'string') die('internal error: the rendered Typogram has no identity hash');
  rec.tgart = { ...rec.tgart, mode: mode || 'sealed', cipher, recipients: recMeta };
  svg = withJsonld(svg, rec);
  const imgHash = await sha256Hex(canonicalText(imageLayerText('svg', outFile, svg)));
  if (imgHash !== rec.tgart.hash) die(`internal error: sealed image hash ${imgHash} ≠ stored ${rec.tgart.hash}`);
  const created = new Date().toISOString().slice(0, 10);
  const signature = signHash({ hash: rec.tgart.hash, issuer, kid, created }, readFileSync(keyFile, 'utf8'));
  rec.tgart = { ...rec.tgart, spec: SIG_SPEC, issuer, kid, created, signature, keys: `https://${issuer}/.well-known/tgart-keys.json`, verify: `https://${issuer}/v` };
  writeFileSync(outFile, withJsonld(svg, rec));
  return { hash: rec.tgart.hash, recMeta, cipher };
}

async function cmdSeal(file) {
  const keyFile = opt('key'), issuer = opt('issuer'), kid = opt('kid'), tos = opts('to');
  if (!file || !keyFile || !issuer || !kid || !tos.length)
    die('usage: tg seal <file.md> --to [<issuer:kid>=]<age1…> [--to …] --key <private-key.pem> --issuer <domain> --kid <id> [--out <file.svg>] [--title <text>]');
  if (!isHostname(issuer)) die('--issuer must be a hostname, e.g. typographics-art.org');
  if (!isKid(kid)) die('--kid must be 1–64 characters of A–Z a–z 0–9 . _ -');
  const recipients = parseRecipients(tos);
  const md = readFileSync(file, 'utf8');
  // The envelope (title, sender, recipients, date) is CLEARTEXT — only the body is encrypted. Never derive the title
  // from the plaintext (that would leak the document's first heading); default to a neutral title and warn it is public.
  const title = opt('title') || 'Sealed note';
  console.error(`tg: note — the envelope is PUBLIC (title ${JSON.stringify(title)}, sender, recipients, date). Only the document body is encrypted; do not put a secret in --title.`);
  const outFile = opt('out') || file.replace(/\.(md|markdown|txt)$/i, '') + '.sealed.tg.svg';
  const { hash, recMeta, cipher } = await sealRenderSign({ plaintext: md, title, issuer, kid, keyFile, recipients, outFile, mode: 'sealed' });
  console.log(`tg: sealed ${file} -> ${outFile} as ${issuer} (kid ${kid})`);
  console.log(`  sealed (${cipher}) to ${recMeta.map((x) => (x.issuer ? `${x.issuer}:${x.kid}` : x.label)).join(', ')}; sha256 ${hash}`);
}

/** Gather files from the given sources (files or folders, walked recursively) into handoff entries with their origin. */
function gatherSources(sources, origin) {
  const entries = [];
  const walk = (abs, rel) => {
    if (statSync(abs).isDirectory()) { for (const name of readdirSync(abs).sort()) walk(join(abs, name), rel ? `${rel}/${name}` : name); }
    else entries.push({ path: rel, bytes: readFileSync(abs), origin });
  };
  for (const s of sources) {
    if (!existsSync(s)) die(`no such file or folder: ${s}`);
    walk(s, basename(s.replace(/[/\\]+$/, '')));
  }
  return entries;
}

/**
 * `tg handoff <file|folder>… --to [<issuer:kid>=]<age1…> --key <private-key.pem> --issuer <domain> --kid <id> [--out
 * <file.svg>] [--title <text>] [--origin human|ai-summary|ai-generated] [--no-scan] [--yes]` — pack the named files into
 * one archive, seal it to the recipient(s) and sign it. The tool filters nothing: it shows every file (path, size,
 * origin), runs a warn-only secret scan, and only builds the package when confirmed with --yes.
 */
async function cmdHandoff() {
  const keyFile = opt('key'), issuer = opt('issuer'), kid = opt('kid'), tos = opts('to'), origin = opt('origin') || 'human';
  const sources = positionalArgs(['to', 'key', 'issuer', 'kid', 'out', 'title', 'origin']);
  if (!sources.length || !keyFile || !issuer || !kid || !tos.length)
    die('usage: tg handoff <file|folder>… --to [<issuer:kid>=]<age1…> --key <private-key.pem> --issuer <domain> --kid <id> [--out <file.svg>] [--title <text>] [--origin human|ai-summary|ai-generated] [--no-scan] [--yes]');
  if (!isHostname(issuer)) die('--issuer must be a hostname, e.g. typographics-art.org');
  if (!isKid(kid)) die('--kid must be 1–64 characters of A–Z a–z 0–9 . _ -');
  if (!ORIGINS.has(origin)) die(`--origin must be one of ${[...ORIGINS].join(', ')}`);
  const recipients = parseRecipients(tos);
  const entries = gatherSources(sources, origin);
  let archive;
  try { archive = buildArchive(entries, { title: opt('title') }); } catch (e) { die(e.message); }

  console.error(`tg: handoff of ${archive.manifest.length} file(s):`);
  for (const m of archive.manifest) console.error(`  ${m.origin.padEnd(12)} ${String(m.size).padStart(9)}  ${m.path}`);
  if (!flags.has('--no-scan')) {
    const hits = scanSecrets(entries);
    for (const h of hits) console.error(`tg: warning — ${h.path} looks like it contains ${h.what}`);
    if (hits.length) console.error('  (a warning only — the files are encrypted; pass --no-scan to silence.)');
  }
  if (!flags.has('--yes')) { console.error('tg: review the manifest above, then re-run with --yes to build the sealed, signed handoff.'); process.exit(0); }

  const title = opt('title') || 'Handoff package';
  const toc = [`${archive.manifest.length} file(s):`, ...archive.manifest.map((m) => `- ${m.path} (${m.size} bytes, ${m.origin})`)].join('\n');
  const outFile = opt('out') || 'handoff.tg.svg';
  const { hash, recMeta } = await sealRenderSign({ plaintext: archiveToText(archive), title, issuer, kid, keyFile, recipients, outFile, mode: 'handoff', toc });
  console.log(`tg: handoff -> ${outFile} as ${issuer} (kid ${kid}); sealed to ${recMeta.map((x) => (x.issuer ? `${x.issuer}:${x.kid}` : x.label)).join(', ')}`);
  console.log(`  ${archive.manifest.length} file(s); sha256 ${hash}. Open with: tg open ${outFile} --identity <age-id> --keys <dir> --out <dir> --yes`);
}

/**
 * `tg open <file.svg> --identity <age-identity-file> [--keys <dir|file>] [--out <file>]` — verify a sealed Typogram's
 * signature FIRST, then decrypt its payload with your age identity and write the plaintext (to --out, else stdout). It
 * refuses to decrypt anything that is not VERIFIED, so a tampered or unsigned sealed work never reaches the cipher.
 */
async function cmdOpen(file) {
  const idFile = opt('identity');
  if (!file || !idFile) die('usage: tg open <file.svg> --identity <age-identity-file> [--keys <dir|file>] [--out <file>]');
  const r = await evaluate(file);
  if (!r.sealed) die(`${file} is not a sealed Typogram (its record has no mode "sealed")`);
  if (r.state !== 'VERIFIED') {
    console.error(`tg: refusing to open — ${file} is SEALED ${r.state}`);
    if (r.problems.length) console.error(`  - ${r.problems.join('\n  - ')}`);
    else console.error('  the signature must verify before anything is decrypted — give the issuer key with --keys');
    process.exit(1);
  }
  const identities = readFileSync(idFile, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => AGE_IDENTITY_LINE.test(s));
  if (!identities.length) die(`${idFile} holds no age identity (a line starting with AGE-SECRET-KEY-)`);
  if (r.dl.markdown == null) die(`${file} carries no embedded source to open`);
  let plaintext;
  try { plaintext = await openSealedText(r.dl.markdown, { identities }); }
  catch (e) { die(`could not open ${file}: ${e.message} — is it sealed to one of your keys?`); }

  // A handoff package decrypts to an archive of files; a plain sealed document decrypts to its text.
  const archive = readArchive(plaintext);
  if (archive) {
    console.error(`tg: opened handoff (verified ${r.issuer} kid ${r.kid}) — ${archive.manifest.length} file(s):`);
    for (const m of archive.manifest) console.error(`  ${m.origin.padEnd(12)} ${String(m.size).padStart(9)}  ${m.path}`);
    const out = opt('out');
    if (!out) { console.error('tg: pass --out <dir> --yes to write these files.'); process.exit(0); }
    if (!flags.has('--yes')) { console.error(`tg: review the manifest; re-run with --out ${out} --yes to write the files.`); process.exit(0); }
    let n = 0;
    try {
      for (const f of archiveFiles(archive)) {
        const dest = join(out, f.path);
        if (dest !== join(out) && !dest.startsWith(join(out) + sep)) die(`refusing to write outside ${out}: ${f.path}`);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, f.bytes); n++;
      }
    } catch (e) { die(`could not write the handoff: ${e.message}`); }
    console.error(`tg: wrote ${n} file(s) to ${out}`);
    return;
  }
  const out = opt('out');
  if (out) { writeFileSync(out, plaintext); console.error(`tg: opened ${file} (verified ${r.issuer} kid ${r.kid}) -> ${out}`); }
  else process.stdout.write(plaintext.endsWith('\n') ? plaintext : plaintext + '\n');
}

/**
 * `tg seal-keygen --issuer <domain> [--kid <id>] [--out <dir>] [--private-out <file>]` — a new X25519 sealing key. The
 * public recipient (age1…) is written as an X25519 entry into the issuer key file (keys/<domain>.json and the served
 * .well-known), so senders can seal to it; the private identity (opens sealed works) goes to --private-out (mode 600) or
 * stdout, clearly marked. It is NOT the signing key — an issuer has an Ed25519 signing key and an X25519 sealing key.
 */
async function cmdSealKeygen() {
  const issuer = opt('issuer');
  if (!issuer) die('usage: tg seal-keygen --issuer <domain> [--kid <id>] [--out <dir>] [--private-out <file>]');
  if (!isHostname(issuer)) die('--issuer must be a hostname, e.g. typographics-art.org');
  const kid = opt('kid') || 'seal-' + new Date().toISOString().slice(0, 7); // seal-YYYY-MM
  if (!isKid(kid)) die('--kid must be 1–64 characters of A–Z a–z 0–9 . _ -');
  const identity = await generateX25519Identity();
  const recipient = await identityToRecipient(identity);
  const created = new Date().toISOString().slice(0, 10);
  const entry = { kid, alg: 'X25519', publicKey: recipient, created };

  const outDir = opt('out') || process.cwd();
  const keysPath = join(outDir, 'keys', `${issuer}.json`);
  const wellKnownPath = join(outDir, '.well-known', 'tgart-keys.json');
  const existing = readKeyfile(keysPath) || readKeyfile(wellKnownPath) || { issuer, keys: [] };
  const keys = (Array.isArray(existing.keys) ? existing.keys : []).filter((k) => !(k && k.kid === kid && k.alg === 'X25519')).concat([entry]);
  const keyfile = { issuer, keys };
  writeJson(keysPath, keyfile);
  writeJson(wellKnownPath, keyfile);

  const privateOut = opt('private-out');
  if (privateOut) writePrivateKey(privateOut, identity);
  console.log(`tg: new X25519 sealing key for ${issuer}`);
  console.log(`  kid:       ${kid}`);
  console.log(`  recipient: ${recipient}`);
  console.log(`  seal to it: tg seal <file.md> --to ${issuer}:${kid}=${recipient} --key <ed25519.pem> --issuer ${issuer} --kid <sig-kid>`);
  console.log(`  key file:  ${keysPath}  (publish at https://${issuer}/.well-known/tgart-keys.json)`);
  if (privateOut) {
    console.log(`  PRIVATE identity -> ${privateOut} (mode 600). It opens sealed works; it is the SECRET. Store it safely.`);
  } else {
    console.log('\n  PRIVATE identity (age) — SECRET, opens sealed works. Store it safely (a secret manager); it is NOT in the key file:\n');
    process.stdout.write(identity.endsWith('\n') ? identity : identity + '\n');
  }
}

// ---- keys registry (verified issuer keys, published for GitHub/npm-only agents) ------------------------------------
const readRegistry = (dir) => { try { return JSON.parse(readFileSync(join(dir, 'registry.json'), 'utf8')); } catch { return null; } };

async function cmdKeys(sub, arg) {
  const dir = opt('keys') || 'keys';
  if (sub === 'build') {
    const { registry, problems } = buildRegistry(dir, { verified: verifiedMap(readRegistry(dir)) });
    if (problems.length) die(`refusing to build the registry — these did not verify:\n  - ${problems.join('\n  - ')}`);
    writeJson(join(dir, 'registry.json'), registry);
    console.log(`tg: built ${join(dir, 'registry.json')} — ${registry.issuers.length} issuer(s): ${registry.issuers.map((e) => e.issuer).join(', ')}`);
    return;
  }
  if (sub === 'verify') {
    const reg = readRegistry(dir);
    if (!reg) die(`no registry at ${join(dir, 'registry.json')} — run: tg keys build`);
    const v = verifyRegistry(reg);
    if (!v.ok) { console.error(`tg: registry INVALID\n  - ${v.problems.join('\n  - ')}`); process.exit(1); }
    console.log(`tg: registry OK — ${reg.issuers.length} issuer(s), every key statement verifies`);
    return;
  }
  if (sub === 'list') {
    const reg = readRegistry(dir);
    if (!reg) die(`no registry at ${join(dir, 'registry.json')} — run: tg keys build`);
    for (const e of reg.issuers) console.log(`${e.issuer}  ${e.keys.map((k) => `${k.alg || 'Ed25519'}:${k.kid}`).join(' ')}  (verified ${e.verifiedAt || '—'} via ${e.verifiedVia})`);
    return;
  }
  if (sub === 'add') {
    const domain = arg;
    if (!domain) die('usage: tg keys add <domain> [--from <keyfile.json>] [--keys <dir>]');
    if (!isHostname(domain)) die('the issuer must be a hostname, e.g. example.org');
    const from = opt('from');
    let keyfile, via;
    if (from) {
      try { keyfile = JSON.parse(readFileSync(from, 'utf8')); } catch (e) { die(`cannot read ${from}: ${e.message}`); }
      const vr = validateKeyfile(keyfile);
      if (!vr.ok) die(`the key file did not verify:\n  - ${vr.problems.join('\n  - ')}`);
      if (keyfile.issuer !== domain) die(`--from file names issuer ${JSON.stringify(keyfile.issuer)}, not ${domain}`);
      via = `file:${from}`;
      console.error(`tg: note — added from a FILE; domain control was NOT checked. Confirm the same key is served at https://${domain}/.well-known/tgart-keys.json before trusting it.`);
    } else {
      let r;
      try { r = await fetchIssuerKeyfile(domain); } catch (e) { die(`could not verify ${domain}: ${e.message}`); }
      keyfile = r.keyfile; via = r.url;
      console.log(`tg: fetched and verified ${via} (self-signatures + domain control)`);
    }
    // keys/<domain>.json stays byte-identical to the issuer's published file; verification metadata lives in the registry.
    writeJson(join(dir, `${domain}.json`), { issuer: keyfile.issuer, keys: keyfile.keys });
    const verified = { ...verifiedMap(readRegistry(dir)), [domain]: { verifiedAt: new Date().toISOString().slice(0, 10), verifiedVia: via } };
    const { registry, problems } = buildRegistry(dir, { verified });
    if (problems.length) die(`refusing to write the registry — these did not verify:\n  - ${problems.join('\n  - ')}`);
    writeJson(join(dir, 'registry.json'), registry);
    console.log(`tg: added ${domain}; registry now has ${registry.issuers.length} issuer(s)`);
    return;
  }
  die('usage: tg keys <build|verify|list|add> [<domain>] [--keys <dir>] [--from <file>]');
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
else if (cmd === 'seal') { await cmdSeal(file); }
else if (cmd === 'open') { await cmdOpen(file); }
else if (cmd === 'handoff') { await cmdHandoff(); }
else if (cmd === 'seal-keygen') { await cmdSealKeygen(); }
else if (cmd === 'keys') { await cmdKeys(positionals[0], positionals[1]); }
else {
  console.error([
    'usage:',
    '  tg verify <file|folder> [--keys <dir|file>] verify a Typogram or a bundle folder: VERIFIED (0) / UNSIGNED (2) / TAMPERED (1)',
    '  tg extract <file> [--markdown|--json|--text] [--from-glyphs]',
    '  tg keygen --issuer <domain> [--kid <id>] [--out <dir>] [--private-out <file>]',
    '  tg sign <file> --key <private-key.pem> --issuer <domain> --kid <id> [--out <file>]',
    '  tg bundle <folder> -o <out-dir> --key <private-key.pem> --issuer <domain> --kid <id> [--title <text>]',
    '  tg seal-keygen --issuer <domain> [--kid <id>] [--out <dir>] [--private-out <file>]  new X25519 sealing key',
    '  tg seal <file.md> --to [<issuer:kid>=]<age1…> --key <private-key.pem> --issuer <domain> --kid <id> [--out <file.svg>]',
    '  tg open <file.svg> --identity <age-identity-file> [--keys <dir|file>] [--out <file|dir>] [--yes]  verify, decrypt (unpacks a handoff)',
    '  tg handoff <file|folder>… --to [<issuer:kid>=]<age1…> --key <pem> --issuer <domain> --kid <id> [--out <file.svg>] [--origin …] [--no-scan] [--yes]',
    '  tg keys <build|verify|list>                 the verified-issuer registry (keys/registry.json)',
    '  tg keys add <domain> [--from <keyfile.json>]  verify a domain\'s key (served at its .well-known) and add it',
  ].join('\n'));
  process.exit(cmd === '--help' || cmd === '-h' ? 0 : 1);
}
