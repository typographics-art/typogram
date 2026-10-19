#!/usr/bin/env node
// Convert the EUR-Lex HTML of an EU regulation (e.g. the AI Act, CELEX 32024R1689) into clean structured Markdown:
// Chapters, Articles (with their headings) and numbered paragraphs, using the Official Journal CSS classes —
// oj-ti-section-1 (CHAPTER N), oj-ti-section-2 (chapter title), oj-ti-art ("Article N"), oj-sti-art (article heading),
// oj-normal (paragraph). The recitals before Article 1 and the annexes after the last article are left out; the enacting
// articles are the structured, addressable part.
//
//   node scripts/eurlex-to-md.mjs <in.html> <out.md> [<out.index.json>] [--title "..."]
import { readFileSync, writeFileSync } from 'node:fs';
import { fontSafe } from '../src/font-safe.js';

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', hellip: '…', sect: '§', deg: '°', middot: '·', bull: '•', eacute: 'é', egrave: 'è', agrave: 'à', uuml: 'ü', ouml: 'ö', auml: 'ä', szlig: 'ß', ccedil: 'ç' };
const decode = (s) => s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (NAMED[e] ?? m));
const strip = (h) => decode(h.replace(/<[^>]+>/g, ' ')).replace(/`/g, '').replace(/\s+/g, ' ').trim();

const args = process.argv.slice(2);
const ti = args.indexOf('--title');
const title = ti !== -1 ? args[ti + 1] : 'Regulation (EU) 2024/1689 — Artificial Intelligence Act';
const [inPath, outPath, indexPath] = args.filter((a, i) => a !== '--title' && args[i - 1] !== '--title');
const html = readFileSync(inPath, 'utf8');

const out = [`# ${title}`, ''];
const index = [];
let started = false, inAnnex = false, pendingChapter = false, curArticle = null, chapter = [];
const re = /<p[^>]*class="oj-([a-z0-9-]+)"[^>]*>([\s\S]*?)<\/p>/gi;
let m;
while ((m = re.exec(html))) {
  const cls = m[1], text = strip(m[2]);
  if (!text) continue;
  if (started && /^ANNEX\s+[IVX]+/i.test(text)) inAnnex = true;   // the annexes follow the last article — stop there
  if (inAnnex) continue;
  if (cls === 'ti-section-1') {                                    // CHAPTER N
    started = true; curArticle = null; out.push(`## ${text}`, ''); chapter = [text]; pendingChapter = true;
  } else if (cls === 'ti-section-2') {                             // chapter title (follows the CHAPTER line)
    if (pendingChapter) { out[out.length - 2] = `## ${chapter[0]} — ${text}`; chapter = [`${chapter[0]} — ${text}`]; pendingChapter = false; }
  } else if (cls === 'ti-art') {                                   // Article N
    started = true; const n = (text.match(/(\d+)/) || [])[1];
    curArticle = { num: text, n }; out.push(`### ${text}`, '');
    index.push({ id: `article-${n}`, num: text, heading: '', path: [...chapter] });
  } else if (cls === 'sti-art') {                                  // article heading
    if (curArticle) { out[out.length - 2] = `### ${curArticle.num} — ${text}`; if (index.length) index[index.length - 1].heading = text; }
  } else if (cls === 'normal') {                                   // paragraph text
    if (started && curArticle) out.push(text, '');
  }
}

const md = fontSafe(out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n');
writeFileSync(outPath, md);
if (indexPath) writeFileSync(indexPath, JSON.stringify(index, null, 2));
console.error(`${outPath}: ${md.length.toLocaleString('en-US')} chars, ${index.length} articles`);
