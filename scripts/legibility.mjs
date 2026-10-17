#!/usr/bin/env node
// How well can the title of a one-pager be read? Renders previews (no PDF) of examples and writes, per example,
// <id>.jpg and <id>.target.png (the title card the text was set to) into an output folder; scripts/legibility.py
// then scores them. Extra arguments that are JSON objects are merged into the layout options, e.g. '{"gaps":"off"}'.
//
//   node scripts/legibility.mjs <outdir> [<options-json>] <id>...
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSession } from '../cli/core.mjs';
import { readDocument, makeOnePage } from '../cli/onepage-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const [out, ...rest] = process.argv.slice(2);
const extra = rest.filter((a) => a.startsWith('{')).map((a) => JSON.parse(a)).reduce((a, b) => ({ ...a, ...b }), {});
const ids = rest.filter((a) => !a.startsWith('{'));
mkdirSync(out, { recursive: true });
const all = JSON.parse(readFileSync(join(ROOT, 'sources.json'), 'utf8'));
const session = await openSession();
try {
  for (const ex of all) {
    if (!ids.includes(ex.id)) continue;
    const path = ex.local ? join(ROOT, ex.local) : join(ROOT, '.cache', ex.file);
    const doc = readDocument(path);
    const r = await makeOnePage(session, {
      text: doc.text, title: ex.title, subtitle: ex.subtitle, paper: ex.paper || 'a4',
      options: { ...(ex.color ? { color: ex.color } : {}), ...extra }, preview: join(out, ex.id + '.jpg'), previewWidth: 1240,
    });
    const png = await session.call('tgOnePageTarget');
    writeFileSync(join(out, ex.id + '.target.png'), Buffer.from(png.split(',')[1], 'base64'));
    console.log(ex.id, r.characters, 'chars', r.lines, 'lines', 'tone', r.toneFidelity);
  }
} finally {
  await session.close();
}
