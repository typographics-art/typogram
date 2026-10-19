#!/usr/bin/env node
// Builds every example in sources.json: downloads the source (official URL, SHA-256 recorded),
// sets the whole text on one page, reads the page back with MuPDF and writes README.md.
//
//   node examples/build.mjs              # all examples
//   node examples/build.mjs pep-8 un-human-rights
//
// Needs Node 22+, Chrome/Chromium, curl and MuPDF (mutool); qpdf is optional and makes the PDFs smaller.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSession } from '../cli/core.mjs';
import { readDocument, makeOnePage, motifSource } from '../cli/onepage-core.mjs';
import { canonicalText, sha256Hex } from '../src/index.js';
import { fontSafe } from '../src/font-safe.js';

const DIR = dirname(fileURLToPath(import.meta.url));
const CACHE = join(DIR, '.cache');
mkdirSync(CACHE, { recursive: true });
const all = JSON.parse(readFileSync(join(DIR, 'sources.json'), 'utf8'));
const only = process.argv.slice(2);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const session = await openSession();
try {
  for (const ex of all) {
    if (only.length && !only.includes(ex.id)) continue;
    const out = join(DIR, ex.id);
    mkdirSync(out, { recursive: true });
    let bytes, doc, source, hasPart;
    if (ex.structured) {
      // A reformatted, structured Markdown source (committed, produced by scripts/fedlex-to-md.mjs): one heading per
      // article with numbered paragraphs. It is the authoritative text set on the page AND embedded as the data-layer
      // source, so the picture, the embedded source and the hash all carry one text. articles.json is the machine index
      // (→ JSON-LD hasPart) so a reader can address a single article precisely.
      const mdPath = join(out, 'source.structured.md');
      bytes = readFileSync(mdPath);
      doc = { text: bytes.toString('utf8'), pages: null, extractor: 'fedlex-akn-to-md' };
      source = { bytes, media: 'text/markdown' };
      if (existsSync(join(out, 'articles.json'))) hasPart = JSON.parse(readFileSync(join(out, 'articles.json'), 'utf8'));
    } else {
      let path;
      if (ex.local) path = join(DIR, ex.local);
      else {
        path = join(CACHE, ex.file);
        if (!existsSync(path)) {
          log(`${ex.id}: downloading`);
          const r = spawnSync('curl', ['-sSfL', '--max-time', '180', '-H', 'Accept: application/pdf,text/plain,*/*', '-o', path, ex.url]);
          if (r.status !== 0) throw new Error(`${ex.id}: download failed: ${r.stderr}`);
        }
      }
      bytes = readFileSync(path);
      doc = readDocument(path);
    }
    doc.text = fontSafe(doc.text); // only glyphs the embedded subset font has — no system-font fallback, no layout drift
    if (source) source = { bytes: Buffer.from(doc.text, 'utf8'), media: source.media }; // source == page text (tg verify)
    log(`${ex.id}: setting ${doc.text.length.toLocaleString('en-US')} characters`);
    // Motif: an image file (sent as data URL) or a procedural recipe; otherwise the title card.
    const motif = ex.motif ? motifSource(ex.motif.startsWith('recipe:') ? ex.motif : join(DIR, ex.motif)) : null;
    // Dark poster, best quality: dark paper, one type size (sharpest picture), auto-levels, full weight/width range,
    // sharper colour steps. The paper-aware card (cli/render.html) sets the title in light ink on the dark ground.
    // Per-example `color`/`options` override.
    // `gaps` is left to the default (off with a motif, auto for a title card): auto lets a title-only page set the
    // title only where it is dark with blank space between words, which is what forms a short document's title.
    const options = { paper: 'dark', color: 'photo', legibility: 'free', unit: 'char', contrast: 1.9, brightness: 0.05,
      edges: 1.0, autoLevels: true, colorStep: 6, sizeCount: 1, ...(ex.color ? { color: ex.color } : {}), ...(ex.options || {}) };
    const r = await makeOnePage(session, {
      text: doc.text, title: ex.title, subtitle: ex.subtitle, paper: ex.paper || 'a4', motif, options, source, hasPart,
      meta: source ? { title: ex.document, inLanguage: ex.inLanguage || null, license: ex.licence, sourceUrl: ex.url || null } : undefined,
      svg: ex.structured ? join(out, 'onepage.svg') : undefined,
      pdf: join(out, 'onepage.pdf'), preview: join(out, 'preview.jpg'), previewWidth: 1240,
    });
    const record = {
      id: ex.id, document: ex.document, category: ex.category, licence: ex.licence, url: ex.url || null,
      sourceSha256: sha(bytes), sourcePages: doc.pages, sourceBytes: bytes.length, extractor: doc.extractor, ...r,
      sizeFactor: r.pdfBytes ? +(r.pdfBytes / bytes.length).toFixed(2) : null,
      motif: ex.motif || null, motifCredit: ex.motifCredit || null,
      structured: !!ex.structured, articles: Array.isArray(hasPart) ? hasPart.length : null,
    };
    // Publish the raw source text (with its line breaks, which the picture cannot carry) so that work.html can show
    // the structured Read view and the Machine checksum for this one-pager. The binding is checked here: the canonical
    // checksum of the source text must equal that of the text read back out of the finished PDF.
    writeFileSync(join(out, 'source.txt'), doc.text);
    record.text = 'source.txt';
    record.textSha256 = await sha256Hex(canonicalText(doc.text));
    record.textMatchesArt = (await sha256Hex(canonicalText(readDocument(join(out, 'onepage.pdf')).text))) === record.textSha256;
    if (!record.textMatchesArt) throw new Error(`${ex.id}: the text read back from the PDF differs from the source text`);
    writeFileSync(join(out, 'check.json'), JSON.stringify(record, null, 2) + '\n');
    log(`${ex.id}: ${r.characters.toLocaleString('en-US')} characters, type ${r.fontSizeMm} mm, PDF ${(r.pdfBytes / 1048576).toFixed(2)} MB ` +
      `(source ${(bytes.length / 1048576).toFixed(2)} MB, unoptimized ${(r.pdfBytesUnoptimized / 1048576).toFixed(2)} MB), read back: ${r.check.pages} page, ` +
      `${r.check.visibleIdentical ? 'identical' : 'DIFFERS'}${r.check.exact ? ' (exact)' : ''}`);
    if (!r.check.visibleIdentical || r.check.pages !== 1) process.exitCode = 1;
  }
} finally {
  await session.close();
}

// README with a table of all examples that have been built.
const rows = [];
for (const ex of all) {
  if (!existsSync(join(DIR, ex.id, 'check.json'))) continue;
  const r = JSON.parse(readFileSync(join(DIR, ex.id, 'check.json'), 'utf8'));
  // Examples built earlier get the same stamp as a fresh build: the published source text and its binding to the PDF.
  const text = join(DIR, ex.id, 'source.txt'), pdf = join(DIR, ex.id, 'onepage.pdf');
  if (!r.textSha256 && existsSync(text) && existsSync(pdf)) {
    r.text = 'source.txt';
    r.textSha256 = await sha256Hex(canonicalText(readFileSync(text, 'utf8')));
    r.textMatchesArt = (await sha256Hex(canonicalText(readDocument(pdf).text))) === r.textSha256;
  }
  rows.push(r);
}
const cat = { law: 'Laws', declaration: 'Declarations', 'ai-instructions': 'AI instructions', 'agent-library': 'Agent library' };
const fmt = (n) => n.toLocaleString('en-US');
let md = `# Examples: whole documents on one page

Each example puts the **complete text** of a document on a single A4 page. The letters are tiny; together they form the document's title in large type, or a picture with the title beneath it ([original motifs](motifs/) for comparison). A person sees at a glance what the page is. A machine reads every word from the PDF's text layer: the type size does not matter to it.

Every page is checked by reading it back with MuPDF and comparing it with the source text. The table is generated by \`node examples/build.mjs\`.

> **Note on languages:** the AI instructions are English; the agent library (\`agent-bibliothek\`, \`agent-regel-*\`, \`agent-prompts-*\`) is **German on purpose**, written for German-speaking teams, and its ids follow its language.

> **Important:** the text is read from the PDF, not from the picture. Exported as a plain image (PNG, JPEG), type this small is grey texture to OCR and vision models. Share the PDF.

`;
for (const c of Object.keys(cat)) {
  const list = rows.filter((r) => r.category === c);
  if (!list.length) continue;
  md += `## ${cat[c]}\n\n| | Document | Source | On one page | File size | Read back from the PDF |\n|---|---|---|---|---|---|\n`;
  for (const r of list) {
    const mb = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(2)} MB` : `${Math.round(b / 1024)} KB`);
    const size = r.pdfBytes ? `${mb(r.pdfBytes)} (original ${mb(r.sourceBytes)})` : '';
    const motif = r.motif && !r.motif.startsWith('recipe:') ? ` · [motif](${r.motif})` : r.motif ? ' · [motif](motifs/eu-ai-act-network.png)' : '';
    md += `| [<img src="${r.id}/preview.jpg" width="120" alt="${r.id}">](${r.id}/onepage.pdf) | **[${r.document}](${r.id}/onepage.pdf)**${motif} | ${r.sourcePages ? `${r.sourcePages} pages, ` : ''}${fmt(r.words)} words${r.url ? ` · [original](${r.url})` : ''} | ${fmt(r.characters)} characters at ${r.fontSizeMm} mm | ${size} | ${r.check.visibleIdentical ? '✓ every visible character identical' : '✗ differs'}${r.check.exact ? ' (exact)' : ''} |\n`;
  }
  md += '\n';
}
const pdfRows = rows.filter((r) => r.sourcePages && r.pdfBytes), textRows = rows.filter((r) => !r.sourcePages && r.pdfBytes);
const factor = (r) => r.pdfBytes / r.sourceBytes;
const kb = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);
const byFactor = [...pdfRows].sort((a, b) => factor(a) - factor(b));
// Size facts depend on what sources exist. PDF-sourced examples compare one-pager:source; text/structured sources just
// grow into a self-contained one-pager. Guard both so the section never crashes when a category is empty.
const pdfSizes = byFactor.length ? ` Against a PDF source it runs ${factor(byFactor[0]).toFixed(1)} to ${factor(byFactor[byFactor.length - 1]).toFixed(1)} times the source size (${byFactor.map((r) => `${r.id} ${factor(r).toFixed(1)}`).join(', ')}; below 1 means smaller).` : '';
const textSizes = textRows.length ? ` A text source becomes a self-contained one-pager carrying fonts and styling (${textRows.slice(0, 6).map((r) => `${r.id}: ${kb(r.sourceBytes)} → ${kb(r.pdfBytes)}`).join('; ')}${textRows.length > 6 ? '; …' : ''}).` : '';
md += `## File size, honestly

Every glyph carries its own weight, width and size, and in colour mode its own colour; in the PDF every weight × width × type size is a separate embedded font, and every change of style starts a new text run. The picture itself is made of letters only; no image is embedded.${pdfSizes}${textSizes}

What is done about it, each step measured in [docs/file-size.md](../docs/file-size.md): glyph outlines are rounded to whole units of the 1000-unit glyph grid (invisible: at most 1/2000 of the type size), Chrome's empty accessibility tags are left out, the PDF is repacked with qpdf, photo colours are rounded to steps of 24 (of 255 per channel), and one-pagers use one type size and no width variants, which also makes their pictures sharper. With \`--weights\` (CLI) or the font-cuts slider (app) fewer weights are used, which makes files much smaller still. The table shows the optimised size next to the original.

`;
md += `## Limits

- **Short texts make coarse pictures.** The letters are the pixels. Up to about 100 lines of plain type (roughly 15 000 characters) the title is therefore set only where it is dark, with blank space between the words elsewhere (whitespace is layout, not text; see [docs/algorithm.md](../docs/algorithm.md)): the letters get smaller and the title readable, at the price of tiny type (1 to 3 mm). Photo motifs still need from about 20 000 characters on.
- **Motifs need rights.** Only public-domain images and motifs drawn for this project are used; see [motifs/](motifs/).

## How the text is taken

- **PDFs** are read with MuPDF exactly as stored, including page numbers, footnotes and words hyphenated at line ends. The one-pager reproduces the original's text layer, not a cleaned-up copy.
- **Text files** (Markdown, reStructuredText) are taken as they are.
- Whitespace is normalised to single spaces, as in all Typographics Art.

## Licences of the sources

| Example | Licence |
|---|---|
${rows.map((r) => `| ${r.id} | ${r.licence} |`).join('\n')}

## Why AI instructions?

Instructions for AI systems (system prompts, policies, agent rules such as [AGENTS.md](../AGENTS.md)) are long texts that people rarely read in full. As a one-pager, a person recognises at a glance which instructions a page carries, and a model still receives every rule. That only works if it stays honest: the visible title must name the document, and the full text must be the declared document. Tiny text must never be used to hide instructions from the people who see the page.

## Make your own

\`\`\`sh
node cli/onepage.mjs document.pdf --title "Short title" -o onepage.pdf --png preview.jpg
\`\`\`

Short titles work best: the fewer characters a document has, the coarser the picture its letters can form.
`;
writeFileSync(join(DIR, 'README.md'), md);
// A short content hash of the card thumbnail. The examples page appends it as `thumb.jpg?v=<rev>`, so a regenerated
// poster gets a new URL and is seen at once \u2014 the old URL (cached up to a day by `_headers`) is never reused.
const thumbRev = (id) => { try { return createHash('sha256').update(readFileSync(join(DIR, id, 'thumb.jpg'))).digest('hex').slice(0, 10); } catch { return null; } };
// `signed` is recomputed by VERIFYING the rendered onepage.svg against the registry — so a re-render (which produces an
// UNSIGNED svg until `scripts/sign-works.mjs` runs) can never leave a stale "signed" flag that shows a false green corner.
// signed = the svg OR the pdf verifies, so PDF-only examples (no onepage.svg) still show as signed once their PDF is.
const verifySigned = (id) => ['onepage.svg', 'onepage.pdf'].some((n) => { const f = join(DIR, id, n); return existsSync(f) && spawnSync('node', [join(DIR, '..', 'cli', 'tg.mjs'), 'verify', f, '--keys', join(DIR, '..', 'keys', 'registry.json')], { stdio: 'ignore' }).status === 0; });
writeFileSync(join(DIR, 'index.json'), JSON.stringify(rows.map((r) => ({
  id: r.id, document: r.document, category: r.category, licence: r.licence, url: r.url, sourcePages: r.sourcePages,
  words: r.words, characters: r.characters, fontSizeMm: r.fontSizeMm, readBack: r.check,
  pdfBytes: r.pdfBytes, sourceBytes: r.sourceBytes, motifCredit: r.motifCredit, text: r.text || null, textSha256: r.textSha256 || null, textMatchesArt: r.textMatchesArt ?? null,
  motifFile: r.motif ? (r.motif.startsWith('recipe:') ? 'motifs/eu-ai-act-network.png' : r.motif) : null,
  title: (all.find((x) => x.id === r.id) || {}).title?.replace(/\u00ad/g, ''),
  rev: thumbRev(r.id),
  signed: verifySigned(r.id),
})), null, 2) + '\n');
log(`README.md: ${rows.length} examples`);
