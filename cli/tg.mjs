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
import { readFileSync, writeFileSync, mkdirSync, chmodSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { extname, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { markupText, canonicalText, sha256Hex, stripDataLayer, readDataMarkdown, readJsonld } from '../src/index.js';
import { generateIssuerKey, signKeyStatement, verifyKeyStatement } from '../src/sign.js';

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

  if (problems.length) { console.error(`tg: FAIL — ${file}\n  - ${problems.join('\n  - ')}`); process.exit(1); }
  console.log(`tg: OK — ${file}`);
  console.log(`  image layer, embedded source and stored hash all carry one text (sha256 ${imgHash})`);
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

  if (privateOut) { writeFileSync(privateOut, key.privatePem, { mode: 0o600 }); chmodSync(privateOut, 0o600); }
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

// ---- argv ------------------------------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const cmd = argv.shift();
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const positionals = argv.filter((a) => !a.startsWith('--'));
const file = positionals[0];
const mode = flags.has('--json') ? 'json' : flags.has('--text') ? 'text' : 'markdown';

if (cmd === 'verify') { if (!file) die('usage: tg verify <file>'); await cmdVerify(file); }
else if (cmd === 'extract') { if (!file) die('usage: tg extract <file> [--markdown|--json|--text] [--from-glyphs]'); await cmdExtract(file, mode, flags.has('--from-glyphs')); }
else if (cmd === 'keygen') { cmdKeygen(); }
else { console.error('usage: tg verify <file>  |  tg extract <file> [--markdown|--json|--text] [--from-glyphs]  |  tg keygen --issuer <domain> [--kid <id>] [--out <dir>] [--private-out <file>]'); process.exit(cmd === '--help' || cmd === '-h' ? 0 : 1); }
