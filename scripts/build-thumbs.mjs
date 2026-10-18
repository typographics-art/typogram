#!/usr/bin/env node
// Small preview images for the cards of the website. The full-size previews are 1240 to 1470 px wide (0.3 to 2 MB each)
// and were loaded for cards 270 to 300 px wide: the gallery alone was 13.6 MB. A thumbnail is 560 px wide, JPEG
// quality 70 (about 0.2 MB for the busiest picture); the full images stay for the work page and for downloads.
//
//   node scripts/build-thumbs.mjs        (needs ImageMagick: `magick`)
//
//   gallery/thumbs/<id>.jpg             from gallery/<id>.jpg
//   gallery/thumbs/<id>-original.jpg    from gallery/photos/<id>.jpg
//   examples/<id>/thumb.jpg             from examples/<id>/preview.jpg
//   demo/moby-dick/thumb.jpg            from demo/moby-dick/preview.jpg (the landing page's hero picture)
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
if (spawnSync('magick', ['-version']).status !== 0) { console.error('ImageMagick is needed (the `magick` command).'); process.exit(1); }

const jobs = [];
mkdirSync(join(ROOT, 'gallery', 'thumbs'), { recursive: true });
for (const w of JSON.parse(readFileSync(join(ROOT, 'gallery', 'works.json'), 'utf8'))) {
  jobs.push([w.preview, `gallery/thumbs/${w.id}.jpg`, 560]);
  jobs.push([w.original, `gallery/thumbs/${w.id}-original.jpg`, 560]);
}
for (const id of readdirSync(join(ROOT, 'examples'))) {
  if (existsSync(join(ROOT, 'examples', id, 'preview.jpg'))) jobs.push([`examples/${id}/preview.jpg`, `examples/${id}/thumb.jpg`, 560]);
}
jobs.push(['demo/moby-dick/preview.jpg', 'demo/moby-dick/thumb.jpg', 760]);
jobs.push(['gallery/photos/douglass.jpg', 'assets/start/douglass.jpg', 560]); // the generator's start photo: assets/ is served wherever the generator is

let made = 0, kept = 0, bytes = 0;
for (const [from, to, width] of jobs) {
  const src = join(ROOT, from), dst = join(ROOT, to);
  if (!existsSync(src)) { console.error(`missing source: ${from}`); process.exitCode = 1; continue; }
  if (existsSync(dst) && statSync(dst).mtimeMs >= statSync(src).mtimeMs) { kept++; bytes += statSync(dst).size; continue; }
  const r = spawnSync('magick', [src, '-resize', `${width}x`, '-quality', '70', '-sampling-factor', '4:2:0', '-strip', dst]);
  if (r.status !== 0) { console.error(`${from}: ${String(r.stderr).trim()}`); process.exitCode = 1; continue; }
  made++; bytes += statSync(dst).size;
}
console.log(`${made} thumbnails made, ${kept} up to date, ${(bytes / 1048576).toFixed(1)} MB in total`);
