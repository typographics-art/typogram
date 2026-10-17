#!/usr/bin/env node
// Assembles the website for typographics-art.org into _site/: pages, library, gallery, one-pagers and
// the Moby-Dick demonstrator (its zoom tiles must have been built: node demo/moby-dick/build.mjs zoom).
// Used by the GitHub Pages workflow and by the Cloudflare deployment (wrangler.jsonc).
import { cpSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_site');
const MAX_FILE = 25 * 1024 * 1024; // Cloudflare's limit per static asset
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const copy = (from, to = from, filter) => {
  const src = join(ROOT, from);
  if (!existsSync(src)) throw new Error(`missing: ${from}`);
  cpSync(src, join(OUT, to), { recursive: true, filter: filter ? (p) => filter(p) : undefined });
};

for (const f of ['index.html', 'app.html', 'gallery.html', 'examples.html', 'work.html', '404.html', 'favicon.svg', 'robots.txt', 'sitemap.xml', 'llms.txt', 'CNAME']) copy(f);
copy('src');
copy('assets', 'assets', (p) => !p.endsWith('brand.html'));
copy('gallery', 'gallery', (p) => !p.endsWith('works.config.json'));
copy('docs');
copy('examples/index.json');
copy('examples/motifs', 'examples/motifs', (p) => !p.endsWith('.md'));
// Everything about the project in one file, for AI assistants (scripts/build-about.mjs); /llms-full.txt is the usual address.
for (const f of ['typographics-art.md', 'typographics-art.pdf', 'preview.jpg']) copy(`about/${f}`);
copy('about/typographics-art.md', 'llms-full.txt');
for (const id of readdirSync(join(ROOT, 'examples'))) {
  if (!existsSync(join(ROOT, 'examples', id, 'onepage.pdf'))) continue;
  for (const f of ['onepage.pdf', 'preview.jpg', 'source.txt']) if (existsSync(join(ROOT, 'examples', id, f))) copy(`examples/${id}/${f}`);
}
for (const f of ['index.html', 'source.txt', 'proof.json', 'lines.json', 'preview.jpg']) copy(`demo/moby-dick/${f}`);
if (!existsSync(join(ROOT, 'demo/moby-dick/out/zoom/moby-dick.dzi'))) throw new Error('Moby-Dick zoom tiles missing: run node demo/moby-dick/build.mjs zoom');
copy('demo/moby-dick/out/zoom');

// Report and enforce the size limit.
let files = 0, bytes = 0;
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const p = join(d, name), s = statSync(p);
    if (s.isDirectory()) walk(p);
    else {
      files++; bytes += s.size;
      if (s.size > MAX_FILE) throw new Error(`${p.slice(OUT.length + 1)} is ${(s.size / 1048576).toFixed(1)} MB, above the 25 MB limit per file`);
    }
  }
};
walk(OUT);
console.log(`_site: ${files} files, ${(bytes / 1048576).toFixed(1)} MB`);
