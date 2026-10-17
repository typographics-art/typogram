#!/usr/bin/env node
// Everything about Typographics Art in one file, for handing to an AI:
//   about/typographics-art.md   the README and the main documents as plain Markdown (also served as /llms-full.txt)
//   about/typographics-art.pdf  the same text as a one-pager, set with the technique itself
//   about/preview.jpg           a picture of the one-pager
//
//   node scripts/build-about.mjs     (needs Chrome and MuPDF, like cli/onepage.mjs)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSession } from '../cli/core.mjs';
import { makeOnePage } from '../cli/onepage-core.mjs';
import { absolutize } from './absolute-links.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'about');
const PARTS = [
  ['README.md', 'Overview'],
  ['docs/technique.md', 'Definition of the technique'],
  ['docs/algorithm.md', 'How the setting works'],
  ['docs/ai-readability.md', 'Machine readability, measured'],
  ['docs/file-size.md', 'File size, measured'],
  ['docs/hidden-messages.md', 'Hidden messages'],
  ['examples/README.md', 'One-pager examples'],
];

// Markdown without HTML blocks and images: an AI reading the file needs the words, not the layout.
const clean = (md) => md
  .replace(/<p align="center">[\s\S]*?<\/p>\n?/g, '')
  .replace(/<h1[^>]*>[\s\S]*?<\/h1>\n?/g, '')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/\[<img[^\]]*\]\([^)]*\)/g, '')
  .replace(/<img[^>]*>/g, '')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

let md = `# Typographics Art: everything in one file

This file contains the README and the main documents of the open-source project Typographics Art (https://typographics-art.org, https://github.com/typ0graphic5/tg-art). It is meant to be handed to an AI assistant as a whole. Good first questions: What is Typographics Art? How is it different from ASCII art? Can a machine still read a work? How big do the PDFs get, and why?

`;
for (const [file, title] of PARTS) {
  md += `\n---\n\n<!-- ${file} -->\n\n## ${title}\n\n${absolutize(clean(readFileSync(join(ROOT, file), 'utf8')), file)}\n`;
}
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'typographics-art.md'), md);
console.log(`about/typographics-art.md: ${md.length.toLocaleString('en-US')} characters`);

const session = await openSession();
try {
  const r = await makeOnePage(session, {
    text: md, title: 'TG Art', subtitle: 'Typographics Art · everything about this project on one page · ask your AI what it is',
    pdf: join(OUT, 'typographics-art.pdf'), preview: join(OUT, 'preview.jpg'), previewWidth: 1240,
  });
  console.log(`about/typographics-art.pdf: ${(r.pdfBytes / 1048576).toFixed(2)} MB, read back: ${r.check.visibleIdentical ? 'identical' : 'DIFFERS'}${r.check.exact ? ' (exact)' : ''}`);
  if (!r.check.visibleIdentical) process.exitCode = 2;
} finally {
  await session.close();
}
