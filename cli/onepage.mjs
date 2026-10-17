#!/usr/bin/env node
// tg-onepage: put a whole document on one page. Needs Node 22+, Chrome/Chromium and MuPDF; qpdf makes the PDF smaller.
import { parseArgs } from 'node:util';
import { basename, extname } from 'node:path';
import { openSession } from './core.mjs';
import { readDocument, makeOnePage, motifSource, PAPERS_MM } from './onepage-core.mjs';

const HELP = `Usage: tg-onepage <document.pdf|.txt|.md> -o <onepage.pdf> [options]

The complete text goes onto one page in tiny type; together the letters form the title in large
type. People see what the page contains, machines read every word from the PDF's text layer.

  --title <text>       large title (default: file name)
  --subtitle <text>    smaller line below the title (default: page and word count)
  --paper <a4|a3|a2|letter>   page size (default a4)
  --motif <image>      form a picture (JPEG/PNG/WebP) above the title instead of the title alone;
                       works from about 20 000 characters on, shorter texts are too coarse
  --weights <1-10>     use at most this many font weights: every weight × width × size is a separate
                       font in the PDF, so fewer make a much smaller file (see docs/file-size.md)
  --png <file>         also write a preview image (an image only: machines need the PDF)
  --font <roboto|fraunces|recursive|archivo|notoserif|mono>

With qpdf installed, the PDF is repacked losslessly and gets much smaller.
PDF text is taken exactly as stored (page numbers and hyphenation included); the result is
checked by reading it back with MuPDF.
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', short: 'o' }, title: { type: 'string' }, subtitle: { type: 'string' },
    paper: { type: 'string' }, motif: { type: 'string' }, weights: { type: 'string' }, png: { type: 'string' }, font: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  },
});
if (values.help || positionals.length !== 1 || !values.out) { process.stdout.write(HELP); process.exit(values.help ? 0 : 1); }
if (values.paper && !PAPERS_MM[values.paper]) { console.error(`Unknown paper ${values.paper}`); process.exit(1); }
const weights = values.weights == null ? null : Number(values.weights);
if (weights != null && !(Number.isInteger(weights) && weights >= 1 && weights <= 10)) { console.error('--weights takes a whole number from 1 to 10'); process.exit(1); }

const input = positionals[0];
const doc = readDocument(input);
const words = doc.text.split(/\s+/).filter(Boolean).length;
const title = values.title || basename(input, extname(input));
const subtitle = values.subtitle ?? [doc.pages ? `${doc.pages} pages` : null, `${words.toLocaleString('en-US')} words on one page`].filter(Boolean).join(' · ');

let motif = null;
try { motif = values.motif ? motifSource(values.motif) : null; } catch (e) { console.error(e.code === 'ENOENT' ? `Motif not found: ${values.motif}` : e.message); process.exit(1); }

const session = await openSession();
try {
  const r = await makeOnePage(session, {
    text: doc.text, title, subtitle, paper: values.paper || 'a4', motif, options: { ...(values.font ? { font: values.font } : {}), ...(weights ? { weightCount: weights } : {}) },
    pdf: values.out, preview: values.png,
  });
  console.log(`${values.out}: ${r.characters.toLocaleString('en-US')} characters on 1 ${r.paper.toUpperCase()} page, type ${r.fontSizeMm} mm, ${(r.pdfBytes / 1048576).toFixed(2)} MB`);
  if (r.check) {
    console.log(`read back with MuPDF: ${r.check.pages} page(s), ${r.check.visibleIdentical ? 'every visible character identical' : 'DIFFERS from the source'}${r.check.exact ? ' (exact)' : ''}`);
    if (!r.check.visibleIdentical || r.check.pages !== 1) process.exitCode = 2;
  }
} finally {
  await session.close();
}
