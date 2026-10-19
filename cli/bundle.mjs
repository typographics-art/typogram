// Phase I1 — bundles: turn a folder of Markdown documents into a directory of signed Typograms plus a signed index.
// Each document becomes a signed Typogram (.svg); manifest.json records every document (path, title, summary, hash,
// tokens, role, origin, readOrder, relations); index.tg.svg is the manifest as a readable, signed Typogram — and since
// it carries every document's hash, signing it seals the whole folder. `verifyBundle` checks the index signature, every
// document signature and hash, and that the files and the manifest agree exactly (a missing or extra file is an error).
// Reuses the signing of `tg sign` (src/sign.js) and the rendering of the one-pager pipeline. CLI-only (fs + Chrome).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { makeOnePage } from './onepage-core.mjs';
import { canonicalText, sha256Hex, markupText, readJsonld, readDataMarkdown, withJsonld } from '../src/index.js';
import { signHash, verifyHash, verifyKeyStatement, SIG_SPEC } from '../src/sign.js';

const ROLES = new Set(['overview', 'core', 'reference', 'appendix', 'rules']);
const ORIGINS = new Set(['human', 'ai-summary', 'ai-generated']);

// A small YAML-ish frontmatter: a leading `---` block of `key: value` lines (value may be a JSON array/object).
function frontmatter(md) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  if (!m) return { meta: {}, body: md };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const mm = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!mm) continue;
    let v = mm[2].trim();
    if (/^[[{]/.test(v)) { try { v = JSON.parse(v); } catch { /* keep string */ } }
    else v = v.replace(/^["']|["']$/g, '');
    meta[mm[1]] = v;
  }
  return { meta, body: md.slice(m[0].length) };
}
const firstHeading = (md) => (/(^|\n)#{1,6}\s+(.+)/.exec(md) || [])[2]?.replace(/\s*#*\s*$/, '').trim() || null;
const firstPara = (md) => md.split(/\n\s*\n/).map((s) => s.replace(/^#{1,6}\s+.*$/m, '').replace(/\s+/g, ' ').trim()).find((s) => s.length > 0) || '';
const tokens = (t) => t.split(/\s+/).filter(Boolean).length;

async function signSvg(svgPath, { keyPem, issuer, kid, created }) {
  const text = readFileSync(svgPath, 'utf8');
  const record = readJsonld(text);
  if (!record || !record.tgart || typeof record.tgart.hash !== 'string') throw new Error(`${svgPath}: no identity hash to sign`);
  const imgHash = await sha256Hex(canonicalText(markupText(text, 'svg')));
  if (imgHash !== record.tgart.hash) throw new Error(`${svgPath}: image hash ${imgHash} ≠ stored ${record.tgart.hash}`);
  const signature = signHash({ hash: record.tgart.hash, issuer, kid, created }, keyPem);
  record.tgart = { ...record.tgart, spec: SIG_SPEC, issuer, kid, created, signature, keys: `https://${issuer}/.well-known/tgart-keys.json`, verify: `https://${issuer}/v` };
  writeFileSync(svgPath, withJsonld(text, record));
  return record.tgart.hash;
}

function indexText(manifest) {
  const out = [`# ${manifest.title || 'Bundle'}`, '', `Issuer: ${manifest.issuer} · ${manifest.created} · ${manifest.documents.length} documents, in reading order.`, ''];
  for (const d of manifest.documents) {
    out.push(`## ${d.readOrder + 1}. ${d.title}`, '', `Role: ${d.role} · origin: ${d.origin} · ${d.tokens} tokens · file \`${d.path}\` · hash ${d.hash.slice(0, 16)}`, '', d.summary || '', '');
    for (const r of d.relations || []) out.push(`- ${r.type} ${String(r.hash).slice(0, 16)}`);
  }
  out.push('', `«TYPOGRAM» bundle index — signed by ${manifest.issuer} · verify at ${manifest.issuer}/v`);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export async function buildBundle(folder, outDir, { session, keyPem, issuer, kid, title, created = new Date().toISOString().slice(0, 10) }) {
  const files = readdirSync(folder).filter((f) => /\.md$/i.test(f)).sort();
  if (!files.length) throw new Error(`no .md files in ${folder}`);
  mkdirSync(outDir, { recursive: true });
  const documents = [];
  let n = 0;
  for (const f of files) {
    const md = readFileSync(join(folder, f), 'utf8');
    const { meta, body } = frontmatter(md);
    const name = basename(f, '.md') + '.svg';
    const svgPath = join(outDir, name);
    await makeOnePage(session, { text: md, title: firstHeading(body) || basename(f, '.md'), source: { bytes: Buffer.from(md, 'utf8'), media: 'text/markdown' }, svg: svgPath, meta: { title: firstHeading(body) || basename(f, '.md') } });
    const hash = await signSvg(svgPath, { keyPem, issuer, kid, created });
    const origin = ORIGINS.has(meta.origin) ? meta.origin : 'human';
    documents.push({
      path: name, title: firstHeading(body) || basename(f, '.md'), summary: (meta.summary || firstPara(body)).slice(0, 200),
      hash, tokens: tokens(md), role: ROLES.has(meta.role) ? meta.role : 'core', origin,
      readOrder: meta.readOrder != null && meta.readOrder !== '' ? Number(meta.readOrder) : n++,
      relations: Array.isArray(meta.relations) ? meta.relations : [],
    });
  }
  documents.sort((a, b) => a.readOrder - b.readOrder);
  documents.forEach((d, i) => { d.readOrder = i; });
  const manifest = { version: 1, issuer, created, title: title || basename(folder.replace(/\/+$/, '')), documents };
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const idxPath = join(outDir, 'index.tg.svg');
  await makeOnePage(session, { text: indexText(manifest), title: manifest.title, source: { bytes: Buffer.from(indexText(manifest), 'utf8'), media: 'text/markdown' }, svg: idxPath, meta: { title: manifest.title } });
  manifest.indexHash = await signSvg(idxPath, { keyPem, issuer, kid, created });
  return manifest;
}

// Verify a bundle directory. `loadKeyfile(issuer)` returns the issuer key file (so the caller controls the source).
export async function verifyBundle(dir, { loadKeyfile }) {
  const issues = [];
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const keyfile = loadKeyfile(manifest.issuer);

  const checkSvg = async (path, expectHash) => {
    const text = readFileSync(join(dir, path), 'utf8');
    const record = readJsonld(text);
    const tg = (record && record.tgart) || {};
    const imgHash = await sha256Hex(canonicalText(markupText(text, 'svg')));
    if (expectHash != null && imgHash !== expectHash) { issues.push(`${path}: content changed (hash ${imgHash.slice(0, 12)} ≠ manifest ${String(expectHash).slice(0, 12)})`); return 'TAMPERED'; }
    if (tg.hash !== imgHash) { issues.push(`${path}: image and stored hash differ`); return 'TAMPERED'; }
    const dl = readDataMarkdown(text); // the picture and the embedded source must be the same text (as `tg verify` requires)
    if (dl && dl.markdown != null && (await sha256Hex(canonicalText(dl.markdown))) !== imgHash) { issues.push(`${path}: the embedded source and the picture disagree`); return 'TAMPERED'; }
    if (!tg.signature) { issues.push(`${path}: unsigned`); return 'UNSIGNED'; }
    // Mirror `tg verify`: find the key statement, reject revoked kids, verify the statement's own signature (so a forged
    // key file does not pass), check the issuer matches, then verify the work's signature with that key.
    const stmt = (keyfile.keys || []).find((k) => k && k.kid === tg.kid);
    const revoked = new Set((keyfile.keys || []).flatMap((s) => (Array.isArray(s.revokes) && verifyKeyStatement(s).ok ? s.revokes : [])));
    if (!stmt || stmt.revoked || revoked.has(tg.kid)) { issues.push(`${path}: no valid key ${tg.kid} for ${tg.issuer}`); return 'TAMPERED'; }
    const kv = verifyKeyStatement(stmt);
    if (!kv.ok || kv.issuer !== tg.issuer) { issues.push(`${path}: the issuer key statement did not verify`); return 'TAMPERED'; }
    if (!verifyHash({ hash: imgHash, issuer: tg.issuer, kid: tg.kid, created: tg.created, signature: tg.signature }, kv.publicKey)) { issues.push(`${path}: signature does not verify`); return 'TAMPERED'; }
    return 'VERIFIED';
  };

  // Every document in the manifest: present, hash matches, signature verifies.
  const seenFiles = new Set(['manifest.json', 'index.tg.svg']);
  for (const d of manifest.documents) {
    seenFiles.add(d.path);
    if (!existsSync(join(dir, d.path))) { issues.push(`${d.path}: missing (in the manifest, not on disk)`); continue; }
    await checkSvg(d.path, d.hash);
  }
  // No extra Typograms beyond the manifest + the index.
  for (const f of readdirSync(dir)) if (/\.svg$/i.test(f) && !seenFiles.has(f)) issues.push(`${f}: extra file, not in the manifest`);
  // The index seals the whole folder.
  const indexState = existsSync(join(dir, 'index.tg.svg')) ? await checkSvg('index.tg.svg', manifest.indexHash) : (issues.push('index.tg.svg: missing'), 'TAMPERED');

  const state = issues.length === 0 && indexState === 'VERIFIED' ? 'VERIFIED' : indexState === 'UNSIGNED' && issues.length === 0 ? 'UNSIGNED' : 'TAMPERED';
  return { state, issuer: manifest.issuer, documents: manifest.documents.length, issues };
}
