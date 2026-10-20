#!/usr/bin/env node
// One overview image of all the print masters — to review the whole line at a glance and as a marketing asset.
// Each tile is a downscaled master labelled with its title and print size; the grid matches the gallery order.
//
//   node scripts/build-contact-sheet.mjs   ->  prints/contact-sheet.jpg
//
// Needs ImageMagick (`magick`) and the masters from scripts/build-prints.mjs.
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'prints');
if (spawnSync('magick', ['-version']).status !== 0) { console.error('ImageMagick (magick) is required.'); process.exit(1); }
const manifest = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8'));

const dir = mkdtempSync(join(tmpdir(), 'tg-contact-'));
try {
  // Pre-shrink each master to a thumbnail so montage does not load 15 full-size (50 MP) images at once.
  const args = ['montage'];
  for (const w of manifest) {
    const src = join(OUT, `${w.id}.png`);
    if (!existsSync(src)) { console.error(`missing master: ${w.file} (run scripts/build-prints.mjs first)`); process.exit(1); }
    const small = join(dir, `${w.id}.png`);
    const r = spawnSync('magick', [src, '-resize', '600x600', small]);
    if (r.status !== 0) { console.error(`${w.id}: ${String(r.stderr).trim()}`); process.exit(1); }
    args.push('-label', `${w.title}  ·  ${w.inches} in`, small);
  }
  const out = join(OUT, 'contact-sheet.jpg');
  args.push('-tile', '4x', '-geometry', '600x600>+14+28', '-background', '#0b0b0b', '-fill', '#eeeeee', '-pointsize', '20', '-quality', '88', out);
  const m = spawnSync('magick', args);
  if (m.status !== 0) { console.error(`montage failed: ${String(m.stderr).trim()}`); process.exit(1); }
  const dim = spawnSync('magick', ['identify', '-format', '%wx%h', out], { encoding: 'utf8' }).stdout.trim();
  console.log(`contact sheet: prints/contact-sheet.jpg (${dim}px, ${manifest.length} works)`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
