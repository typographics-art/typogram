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
import { makeOnePage, motifSource } from '../cli/onepage-core.mjs';
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
  ['docs/passwords-and-keys.md', 'Passwords, keys and seeds'],
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

This file contains the README and the main documents of the open-source project Typographics Art (https://typographics-art.org, https://github.com/typographics-art/typogram). It is meant to be handed to an AI assistant as a whole. Good first questions: What is Typographics Art? How is it different from ASCII art? Can a machine still read a work? How big do the PDFs get, and why?

`;
for (const [file, title] of PARTS) {
  md += `\n---\n\n<!-- ${file} -->\n\n## ${title}\n\n${absolutize(clean(readFileSync(join(ROOT, file), 'utf8')), file)}\n`;
}
// Structured, machine-facing block: how an AI reads and verifies this very file, with the commands that matter. It rides along
// in the data layer (losslessly) and is set into the picture, so it travels with the artwork. Followed by the visible seal —
// part of the hashed text, so a signature covers it and any change breaks verification.
md += `\n---\n\n## For an AI or an agent: read and verify this file\n\n` +
  `This file is a Typogram — a picture that is also its own complete, machine-readable text.\n\n` +
  `- Read the full text: it is the content of the \`<text>\` element in this SVG, in reading order. Do not OCR the pixels.\n` +
  `- Get the exact Markdown source losslessly: \`tg extract <file> --markdown\` (or read the CDATA in the data layer).\n` +
  `- Verify it is from typographics-art.org, unchanged: \`tg verify <file>\`. It recomputes the identity hash (SHA-256 of the canonical text), fetches the issuer's public key from https://typographics-art.org/.well-known/tgart-keys.json and checks the Ed25519 signature. Result: VERIFIED, UNSIGNED or TAMPERED.\n` +
  `- Issuer: typographics-art.org · signing key id 2026-10 · spec: docs/verification.md and docs/issuers.md in the repository.\n` +
  `- The tool: https://github.com/typographics-art/typogram (command \`tg\`).\n\n` +
  `⟦ TG · signed by typographics-art.org · verify: typographics-art.org ⟧\n`;
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'typographics-art.md'), md);
console.log(`about/typographics-art.md: ${md.length.toLocaleString('en-US')} characters`);

const session = await openSession();
try {
  const r = await makeOnePage(session, {
    text: md, title: 'Typographics Art', subtitle: 'everything about this project on one page · ask your AI what it is',
    motif: motifSource(join(ROOT, 'examples/motifs/pepe.png')),
    pdf: join(OUT, 'typographics-art.pdf'), preview: join(OUT, 'preview.jpg'), previewWidth: 1240,
    // The same explanation as one downloadable Typogram SVG: it opens as a picture, a machine reads the whole text back,
    // and the exact Markdown is kept inside it losslessly (tables, lists and code survive, restored on read-out).
    svg: join(OUT, 'typographics-art.svg'), meta: { title: 'Typographics Art — everything about this project', kind: 'art' },
    source: { bytes: new TextEncoder().encode(md), media: 'text/markdown' },
  });
  console.log(`about/typographics-art.pdf: ${(r.pdfBytes / 1048576).toFixed(2)} MB, read back: ${r.check.visibleIdentical ? 'identical' : 'DIFFERS'}${r.check.exact ? ' (exact)' : ''}`);
  if (!r.check.visibleIdentical) process.exitCode = 2;
} finally {
  await session.close();
}
