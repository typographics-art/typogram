#!/usr/bin/env node
// Turns the Project Gutenberg file of Moby-Dick (eBook #2701) into the demonstrator's source text.
//
//   curl -L -o pg2701.txt https://www.gutenberg.org/cache/epub/2701/pg2701.txt
//   node demo/moby-dick/prepare.mjs pg2701.txt
//
// Steps, and nothing else: keep the text between the "*** START OF" and "*** END OF" markers
// (this drops Project Gutenberg's header, footer and licence), convert CRLF to LF, trim.
// Writes source.txt and sections.json (three parts split at chapter boundaries).
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const rawPath = process.argv[2];
if (!rawPath) { console.error('Usage: node demo/moby-dick/prepare.mjs <pg2701.txt>'); process.exit(1); }

const sha = (s) => createHash('sha256').update(s).digest('hex');
const raw = readFileSync(rawPath);
const lines = raw.toString('utf8').replace(/\r\n/g, '\n').split('\n');
const start = lines.findIndex((l) => l.startsWith('*** START OF THE PROJECT GUTENBERG EBOOK'));
const end = lines.findIndex((l) => l.startsWith('*** END OF THE PROJECT GUTENBERG EBOOK'));
if (start < 0 || end < 0) throw new Error('Gutenberg markers not found');
const source = lines.slice(start + 1, end).join('\n').trim() + '\n';
writeFileSync(join(DIR, 'source.txt'), source);

// Chapter headings in the body (the table of contents lists each heading once more, earlier).
const heads = [...source.matchAll(/^CHAPTER (\d+)\. .*$/gm)];
const body = new Map();
for (const m of heads) body.set(Number(m[1]), m.index); // the later match wins: body, not contents
const epilogue = source.lastIndexOf('\nEpilogue\n') + 1;

// Three parts of about equal length, each starting at a chapter heading.
const cut = (fraction) => {
  const target = source.length * fraction;
  let best = null;
  for (const [n, at] of body) if (!best || Math.abs(at - target) < Math.abs(best.at - target)) best = { n, at };
  return best;
};
const c1 = cut(1 / 3), c2 = cut(2 / 3);
const parts = [
  { id: 'land', title: 'Part I – Ashore and out to sea', from: 0, to: c1.at, firstChapter: 'Etymology', motif: 'harbour' },
  { id: 'voyage', title: 'Part II – The whaling voyage', from: c1.at, to: c2.at, firstChapter: `Chapter ${c1.n}`, motif: 'hunt' },
  { id: 'chase', title: 'Part III – The white whale', from: c2.at, to: source.length, firstChapter: `Chapter ${c2.n}`, motif: 'whiteWhale' },
];
for (const p of parts) p.characters = p.to - p.from;

const meta = {
  source: {
    title: 'Moby-Dick; or, The Whale', author: 'Herman Melville', year: 1851, status: 'public domain',
    origin: 'Project Gutenberg eBook #2701', url: 'https://www.gutenberg.org/cache/epub/2701/pg2701.txt',
    rawSha256: sha(raw), sha256: sha(source), characters: source.length, chapters: body.size, epilogueAt: epilogue,
  },
  parts,
};
writeFileSync(join(DIR, 'sections.json'), JSON.stringify(meta, null, 2) + '\n');
console.log(`source.txt: ${source.length} characters, ${body.size} chapters, sha256 ${meta.source.sha256}`);
for (const p of parts) console.log(`  ${p.id}: from ${p.firstChapter}, ${p.characters} characters`);
