#!/usr/bin/env node
// Publishes each one-pager's source text next to its artwork, so work.html can show the
// structured Read view and the Machine checksum for one-pagers (as it already does for the
// Moby-Dick demo). The source text is the raw document text that built the artwork — with its
// original line breaks, which the picture cannot carry (normalizeText collapses them). For every
// example we verify the binding: the canonical checksum of the published source text must equal
// the canonical checksum read straight back out of the artwork PDF.
//
// Fast path: works from the already-built examples/<id>/ (no Chrome rebuild). examples/build.mjs
// writes the same source.txt as a normal build output; this script keeps an existing build in sync
// and refreshes the `text`/`textSha256` fields in examples/index.json.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDocument } from '../cli/onepage-core.mjs';
import { canonicalText, sha256Hex, structuredText } from '../src/index.js';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EX = join(ROOT, 'examples');
const CACHE = join(EX, '.cache');
const only = process.argv.slice(2);

const sources = JSON.parse(readFileSync(join(EX, 'sources.json'), 'utf8'));
const index = JSON.parse(readFileSync(join(EX, 'index.json'), 'utf8'));
const byId = new Map(index.map((e) => [e.id, e]));

const pdfText = (pdf) =>
  spawnSync('mutool', ['draw', '-q', '-F', 'txt', '-o', '-', pdf], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout || '';

let written = 0, mismatches = 0, skipped = 0;
const rows = [];
for (const ex of sources) {
  if (only.length && !only.includes(ex.id)) continue;
  const out = join(EX, ex.id);
  const pdf = join(out, 'onepage.pdf');
  if (!existsSync(pdf)) { skipped++; continue; }
  const srcPath = ex.local ? join(EX, ex.local) : join(CACHE, ex.file);
  if (!existsSync(srcPath)) { console.log(`${ex.id}: source missing (${srcPath}) — skipped`); skipped++; continue; }

  const raw = readDocument(srcPath).text;
  writeFileSync(join(out, 'source.txt'), raw);
  written++;

  const textSha = await sha256Hex(canonicalText(raw));
  const artSha = await sha256Hex(canonicalText(pdfText(pdf)));
  const match = textSha === artSha;
  if (!match) mismatches++;

  const st = structuredText(raw);
  const rec = byId.get(ex.id);
  if (rec) { rec.text = 'source.txt'; rec.textSha256 = textSha; rec.textMatchesArt = match; }

  rows.push({ id: ex.id, chars: raw.length, sections: st.headings, paras: st.paragraphs, match });
  console.log(`${ex.id}: ${raw.length.toLocaleString('en-US')} chars, ${st.headings} headings, ${st.paragraphs} paragraphs, ` +
    `checksum ${match ? 'matches artwork ✓' : 'DIFFERS FROM ARTWORK ✗'} (${textSha.slice(0, 12)}…)`);
}

writeFileSync(join(EX, 'index.json'), JSON.stringify(index, null, 2) + '\n');
console.log(`\n${written} source texts written, ${skipped} skipped, ${mismatches} checksum mismatch(es).`);
if (mismatches) process.exitCode = 1;
