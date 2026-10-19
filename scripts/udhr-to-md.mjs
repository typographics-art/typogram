#!/usr/bin/env node
// Reflow the OHCHR plain-text/PDF extraction of the Universal Declaration of Human Rights into clean, structured
// Markdown — a Preamble section and one `### Article N` per article — plus a machine-readable article index. The PDF
// extraction wraps every line and double-spaces it, so the whole text is reflowed to single spaces first and then split
// on the "Article N" markers (the Declaration has no sub-structure beyond its 30 articles).
//
//   node scripts/udhr-to-md.mjs <in.pdf|in.txt> <out.md> [<out.index.json>]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { fontSafe } from '../src/font-safe.js';

const [, , inPath, outPath, indexPath] = process.argv;
if (!inPath || !outPath) { console.error('usage: node scripts/udhr-to-md.mjs <in.pdf|in.txt> <out.md> [<out.index.json>]'); process.exit(1); }

const raw = extname(inPath).toLowerCase() === '.pdf'
  ? execFileSync('mutool', ['draw', '-q', '-F', 'txt', '-o', '-', inPath], { encoding: 'utf8', maxBuffer: 1 << 26 })
  : readFileSync(inPath, 'utf8');
// The OHCHR text heads the first article "Article I" (Roman) but the rest "Article 2".."Article 30" (Arabic);
// normalise that one Roman numeral so the split finds all 30. `\bArticle I\b` cannot match "Article II" (no boundary
// between the two I's), so only article 1 is touched.
const flat = raw.replace(/\s+/g, ' ').trim().replace(/\bArticle I\b/g, 'Article 1');

// Everything up to "Article 1" is the title + preamble; from there each "Article N" starts an article.
const parts = flat.split(/\bArticle (\d+)\b\s*/);
let head = parts[0];
// Drop the document title and the "Preamble" label from the head; keep the enacting text.
head = head.replace(/^Universal Declaration of Human Rights\s*/i, '').replace(/^Preamble\s*/i, '').trim();

const out = ['# Universal Declaration of Human Rights', '', '## Preamble', '', head, ''];
const index = [];
for (let i = 1; i < parts.length; i += 2) {
  const num = parts[i];
  const body = (parts[i + 1] || '').trim();
  index.push({ id: `article-${num}`, num: `Article ${num}`, heading: '', path: [] });
  out.push(`### Article ${num}`, '', body, '');
}

const md = fontSafe(out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n');
writeFileSync(outPath, md);
if (indexPath) writeFileSync(indexPath, JSON.stringify(index, null, 2));
console.error(`${outPath}: ${md.length.toLocaleString('en-US')} chars, ${index.length} articles`);
