#!/usr/bin/env node
// tg-onepage: put a whole document on one page. Needs Node 22+, Chrome/Chromium and, for PDF input, MuPDF.
import { parseArgs } from 'node:util';
import { basename, extname } from 'node:path';
import { openSession } from './core.mjs';
import { readDocument, makeOnePage, PAPERS_MM } from './onepage-core.mjs';

const HELP = `Usage: tg-onepage <document.pdf|.txt|.md> -o <onepage.pdf> [options]

The complete text goes onto one page in tiny type; together the letters form the title in large
type. People see what the page contains, machines read every word from the PDF's text layer.

  --title <text>       large title (default: file name)
  --subtitle <text>    smaller line below the title (default: page and word count)
  --paper <a4|a3|a2|letter>   page size (default a4)
  --png <file>         also write a preview image (an image only: machines need the PDF)
  --font <roboto|fraunces|recursive|archivo|notoserif|mono>

PDF text is taken exactly as stored (page numbers and hyphenation included); the result is
checked by reading it back with MuPDF.
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', short: 'o' }, title: { type: 'string' }, subtitle: { type: 'string' },
    paper: { type: 'string' }, png: { type: 'string' }, font: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  },
});
if (values.help || positionals.length !== 1 || !values.out) { process.stdout.write(HELP); process.exit(values.help ? 0 : 1); }
if (values.paper && !PAPERS_MM[values.paper]) { console.error(`Unknown paper ${values.paper}`); process.exit(1); }

const input = positionals[0];
const doc = readDocument(input);
const words = doc.text.split(/\s+/).filter(Boolean).length;
const title = values.title || basename(input, extname(input));
const subtitle = values.subtitle ?? [doc.pages ? `${doc.pages} pages` : null, `${words.toLocaleString('en-US')} words on one page`].filter(Boolean).join(' · ');

const session = await openSession();
try {
  const r = await makeOnePage(session, {
    text: doc.text, title, subtitle, paper: values.paper || 'a4', options: values.font ? { font: values.font } : {},
    pdf: values.out, preview: values.png,
  });
  console.log(`${values.out}: ${r.characters.toLocaleString('en-US')} characters on 1 ${r.paper.toUpperCase()} page, type ${r.fontSizeMm} mm`);
  if (r.check) {
    console.log(`read back with MuPDF: ${r.check.pages} page(s), ${r.check.visibleIdentical ? 'every visible character identical' : 'DIFFERS from the source'}${r.check.exact ? ' (exact)' : ''}`);
    if (!r.check.visibleIdentical || r.check.pages !== 1) process.exitCode = 2;
  }
} finally {
  await session.close();
}
