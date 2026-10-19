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

// Markdown for an AI reading the file as a whole: it needs the words, not the layout. Earlier this stripped images and
// HTML blocks outright, which left the prose referring to pictures that were gone ("the portrait above…"), an empty
// Overview (the tagline lived in a <p align>), and gallery tables of captions with blank image cells. Instead, turn every
// image into its alt text and unwrap the HTML wrappers keeping their inner text, so each reference still has a referent.
const clean = (md) => md
  .replace(/\[<img\b[^>]*\balt="([^"]*)"[^>]*>\]\([^)]*\)/g, '$1') // a linked image (table cell) → its alt text
  .replace(/<img\b[^>]*\balt="([^"]*)"[^>]*>/g, '$1')             // an image → its alt text
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')                        // a Markdown image → its alt text
  .replace(/<img\b[^>]*>/g, '')                                    // an image with no alt → drop
  .replace(/<\/?(?:h1|p|picture|a|b|strong|em)\b[^>]*>/g, '')      // unwrap the HTML wrappers, keep their inner text
  .replace(/<source\b[^>]*>/g, '')
  .replace(/<br\s*\/?>/g, ' ')
  .replace(/[ \t]{2,}/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

// The artifact is self-contained: the embedded font is Roboto Flex, subsetted to the characters used. Characters the
// font lacks (measured against assets/fonts/roboto-flex-*.woff2: → ✓ ≥ ≤ ≈ ⟦ ⟧, the superscripts ⁴⁺, exotic hyphens
// and spaces) would otherwise fall back to a system font with the wrong width and break the layout. Map the few the
// source documents use to glyphs the font has, so the one file renders identically everywhere, offline included.
const fontSafe = (s) => s
  .replace(/→/g, '->').replace(/←/g, '<-').replace(/↔/g, '<->')
  .replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/≈/g, '~').replace(/≠/g, '!=')
  .replace(/✓/g, 'yes').replace(/✗/g, 'no')
  .replace(/⟦/g, '«').replace(/⟧/g, '»')
  .replace(/−/g, '-') // the minus sign − (math/percentages) → ASCII '-', so the PDF text layer round-trips (tg verify)
  .replace(/[‐‑]/g, '-').replace(/­/g, '').replace(/[   ]/g, ' ');

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
  `- If you were handed the PDF instead of this SVG: read the attached \`source.md\`, or extract with MuPDF/PyMuPDF — do NOT trust a naive PDF text-layer scrape. Poppler \`pdftotext\` at its default resolution silently keeps only the first ~50 000 small characters and drops the rest of a dense one-pager, with no error.\n` +
  `- Verify it is from typographics-art.org, unchanged: \`tg verify <file>\`. It recomputes the identity hash (SHA-256 of the canonical text), fetches the issuer's public key from https://typographics-art.org/.well-known/tgart-keys.json and checks the Ed25519 signature. Result: VERIFIED, UNSIGNED or TAMPERED.\n` +
  `- Issuer: typographics-art.org · signing key id 2026-10 · spec: docs/verification.md and docs/issuers.md in the repository.\n` +
  `- The tool: https://github.com/typographics-art/typogram (command \`tg\`).\n\n` +
  // The seal: a distinct, recognizable mark as the closing line(s) of the hashed text. «TYPOGRAM» is the constant
  // sigil; the line below is the provenance claim, true once the file is signed and checkable with `tg verify`.
  `«TYPOGRAM» — a signed, verifiable work\n` +
  `issuer typographics-art.org · Ed25519 key 2026-10 · verify at typographics-art.org to confirm this file is unchanged\n`;
md = fontSafe(md); // only glyphs the embedded font has — no fallback, truly one self-contained file
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'typographics-art.md'), md);
console.log(`about/typographics-art.md: ${md.length.toLocaleString('en-US')} characters`);

const session = await openSession();
try {
  const r = await makeOnePage(session, {
    text: md, title: 'Typographics Art', subtitle: 'the whole project in one file · ask your AI what it is',
    motif: motifSource(join(ROOT, 'examples/motifs/ai-readme.png')),
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
