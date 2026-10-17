#!/usr/bin/env node
// Renders every work in gallery/works.config.json to gallery/<id>.svg (the work, text kept as text)
// and gallery/<id>.jpg (preview), and writes gallery/works.json for gallery.html.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSession } from './core.mjs';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'gallery');
const works = JSON.parse(readFileSync(join(DIR, 'works.config.json'), 'utf8'));
const session = await openSession();
const out = [];
try {
  for (const w of works) {
    const svg = await session.render(w.text, `recipe:${w.motif}`, w.options, 'svg');
    const jpg = await session.render(w.text, `recipe:${w.motif}`, w.options, 'jpg');
    if (!svg.meta.faithful) throw new Error(`${w.id}: text not preserved`);
    writeFileSync(join(DIR, `${w.id}.svg`), svg.data);
    writeFileSync(join(DIR, `${w.id}.jpg`), jpg.data);
    const { text, ...rest } = w;
    out.push({ ...rest, textLength: text.length, meta: svg.meta, svg: `gallery/${w.id}.svg`, preview: `gallery/${w.id}.jpg` });
    console.log(`${w.id}: ${svg.meta.characters} characters (${svg.meta.filler} filler), tone fidelity ${svg.meta.toneFidelity.toFixed(2)}`);
  }
} finally {
  await session.close();
}
writeFileSync(join(DIR, 'works.json'), JSON.stringify(out, null, 2) + '\n');
