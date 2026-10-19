#!/usr/bin/env node
// Per-article hash. The whole-document hash proves the whole text; this adds, to each articles.json entry, the sha256 of
// just THAT article's canonical span in source.structured.md (its heading through the next same-or-higher heading). So a
// reader can prove a single cited article is unchanged from the sealed document without re-hashing all ~180 000
// characters — the real win for quoting a law in a brief. Entries and headings are both in document order, so an
// ambiguous number (e.g. US "Section 1", which recurs per article) resolves positionally.
//
//   node scripts/hash-articles.mjs [<id> …]   # every structured example, or the named ones
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalText } from '../src/secret.js';
import { sha256Hex } from '../src/structure.js';

const EX = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Every heading of source.structured.md with the span of text it owns (to the next heading of the same or a higher level).
function sections(md) {
  const lines = md.split('\n');
  const heads = [];
  lines.forEach((ln, i) => { const m = /^(#{1,6})\s+(.+?)\s*$/.exec(ln); if (m) heads.push({ level: m[1].length, label: m[2], line: i }); });
  return heads.map((h, idx) => {
    let end = lines.length;
    for (let j = idx + 1; j < heads.length; j++) if (heads[j].level <= h.level) { end = heads[j].line; break; }
    return { label: h.label, text: lines.slice(h.line, end).join('\n') };
  });
}

async function hashLaw(id) {
  const ap = join(EX, id, 'articles.json'), sp = join(EX, id, 'source.structured.md');
  if (!existsSync(ap) || !existsSync(sp)) return null;
  const arts = JSON.parse(readFileSync(ap, 'utf8'));
  const secs = sections(readFileSync(sp, 'utf8'));
  const miss = [];
  let si = 0, matched = 0;
  for (const a of arts) {
    const re = new RegExp('^' + esc(a.num) + '(?![\\dA-Za-z])');
    while (si < secs.length && !re.test(secs[si].label)) si++;
    if (si >= secs.length) { miss.push(a.num); delete a.hash; continue; }
    a.hash = await sha256Hex(canonicalText(secs[si].text));
    matched++; si++;
  }
  writeFileSync(ap, JSON.stringify(arts, null, 2) + '\n');
  return { id, total: arts.length, matched, miss };
}

const ids = process.argv.slice(2).length ? process.argv.slice(2)
  : readdirSync(EX).filter((id) => existsSync(join(EX, id, 'articles.json')) && existsSync(join(EX, id, 'source.structured.md'))).sort();
let bad = 0;
for (const id of ids) {
  const r = await hashLaw(id);
  if (!r) { console.error(`  (no structured source for ${id})`); continue; }
  const ok = r.matched === r.total;
  console.log(`${ok ? 'ok  ' : 'MISS'} ${id}: hashed ${r.matched}/${r.total}${r.miss.length ? ' — unmatched: ' + r.miss.slice(0, 8).join(', ') + (r.miss.length > 8 ? ` …(+${r.miss.length - 8})` : '') : ''}`);
  if (!ok) bad++;
}
process.exit(bad ? 1 : 0);
