// Draw the signed seal (the green corner + white check) onto a raster image in place, matching the SVG seal
// (src/stamp.js) geometry. The shapes are opaque, so re-stamping is idempotent (it redraws identical pixels). Used for
// the preview/thumbnail images that serve as a Typogram's file icon, so a signed work is recognizable as a thumbnail.
import { spawnSync } from 'node:child_process';
import { sealGeometry } from '../src/stamp.js';

/** Stamp a raster (jpg/png) in place with the signed seal. Returns true on success. Needs ImageMagick (`magick`). */
export function stampRaster(file) {
  const id = spawnSync('identify', ['-format', '%w %h', file], { encoding: 'utf8' });
  if (id.status !== 0) return false;
  const [W, H] = id.stdout.trim().split(/\s+/).map(Number);
  if (!(W > 0 && H > 0)) return false;
  const g = sealGeometry(W, H);
  const r = spawnSync('magick', [file,
    '-fill', '#1f8a4c', '-stroke', 'none', '-draw', `polygon ${g.triangle}`,
    '-fill', 'none', '-stroke', 'white', '-strokewidth', String(g.stroke), '-draw', `stroke-linecap round stroke-linejoin round path '${g.check}'`,
    file], { encoding: 'utf8' });
  return r.status === 0;
}

// CLI: node scripts/stamp-raster.mjs <image>...
if (import.meta.url === `file://${process.argv[1]}`) {
  for (const f of process.argv.slice(2)) console.error(`${stampRaster(f) ? 'stamped' : 'FAILED'}: ${f}`);
}
