#!/usr/bin/env node
// Sign the publishable Typogram works — the law one-pagers (examples/<id>/onepage.svg) and the gallery works
// (gallery/*.svg) — as typographics-art.org, so `tg verify` passes and the site shows the green "signed" corner.
// Signing adds ONLY the signature to the data layer and bakes the visible green "signed" corner into the svg (a
// decorative overlay — it does not change the identity hash, so `tg verify` still passes). It then draws the same
// corner onto the full-size PREVIEW (scripts/stamp-raster.mjs) and runs scripts/build-thumbs.mjs to derive the sealed
// card thumbnail from it, so a signed work is recognizable on the card and as a file icon. **Re-run this after any
// `examples/build.mjs` or `cli/build-gallery.mjs` render**, because a render produces an UNSIGNED, unstamped svg + plain
// rasters. Then it recomputes the `signed` flags and the thumbnail cache-bust `rev` in index.json / works.json.
//
// The signing key is SECRET — pass it as a file or an env var, never commit it:
//   node scripts/sign-works.mjs --key /path/to/typographics-art.org.pem
//   TGART_SIGNING_KEY="$(…from your secret store…)" node scripts/sign-works.mjs
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { stampRaster } from './stamp-raster.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ISSUER = 'typographics-art.org', KID = '2026-10';
const REGISTRY = join(ROOT, 'keys', 'registry.json');
const argv = process.argv.slice(2);

let keyFile = argv.includes('--key') ? argv[argv.indexOf('--key') + 1] : null;
let tmp;
if (!keyFile) {
  const env = process.env.TGART_SIGNING_KEY;
  if (!env) { console.error('sign-works: need --key <file> or $TGART_SIGNING_KEY (the Ed25519 signing key, PKCS#8 PEM)'); process.exit(1); }
  tmp = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'tgart-sign-'));
  keyFile = join(tmp, 'key.pem'); writeFileSync(keyFile, env.endsWith('\n') ? env : env + '\n', { mode: 0o600 });
}

const tg = (...a) => spawnSync('node', [join(ROOT, 'cli', 'tg.mjs'), ...a], { encoding: 'utf8' });
const verify = (f) => existsSync(f) && tg('verify', f, '--keys', REGISTRY).status === 0;

// The full-size PREVIEW beside a work's svg — examples/<id>/preview.{jpg,png} or gallery/<slug>.{jpg,png}. We stamp the
// preview (the source of truth); scripts/build-thumbs.mjs then derives the sealed card thumbnail from it, so the seal
// shows on the card and as a file icon. Only the ones that exist are returned.
const previewsFor = (svgPath) => {
  const out = [];
  if (svgPath.includes(`${sep}examples${sep}`)) {
    const dir = dirname(svgPath);
    for (const ext of ['jpg', 'png']) out.push(join(dir, `preview.${ext}`));
  } else {
    const stem = svgPath.replace(/\.svg$/, '');
    for (const ext of ['jpg', 'png']) out.push(`${stem}.${ext}`);
  }
  return out.filter(existsSync);
};

const rev = (p) => { try { return createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 10); } catch { return null; } };

try {
  const svgs = [];
  for (const id of readdirSync(join(ROOT, 'examples'))) if (existsSync(join(ROOT, 'examples', id, 'onepage.svg'))) svgs.push(join(ROOT, 'examples', id, 'onepage.svg'));
  for (const f of readdirSync(join(ROOT, 'gallery'))) if (f.endsWith('.svg')) svgs.push(join(ROOT, 'gallery', f));

  let ok = 0, stamped = 0;
  for (const f of svgs) {
    // `tg sign` re-signs the data layer AND bakes the seal into the svg (hash-safe, so verify still passes).
    const s = tg('sign', f, '--key', keyFile, '--issuer', ISSUER, '--kid', KID, '--out', f);
    if (s.status === 0 && verify(f)) {
      ok++;
      for (const p of previewsFor(f)) if (stampRaster(p)) stamped++; else console.error(`  preview stamp FAILED: ${p.slice(ROOT.length + 1)}`);
    } else console.error(`  FAILED: ${f.slice(ROOT.length + 1)} — ${(s.stderr || '').trim().split('\n')[0]}`);
  }
  console.error(`sign-works: signed + verified ${ok}/${svgs.length} works as ${ISSUER} (kid ${KID}); stamped ${stamped} previews`);

  // Derive the sealed card thumbnails from the stamped previews (examples/<id>/thumb.jpg, gallery/thumbs/<id>.jpg).
  if (stamped) {
    const t = spawnSync('node', [join(ROOT, 'scripts', 'build-thumbs.mjs')], { encoding: 'utf8' });
    if (t.status !== 0) console.error(`  build-thumbs FAILED: ${(t.stderr || '').trim().split('\n').pop()}`);
    else console.error(`  thumbnails: ${(t.stdout || '').trim().split('\n').pop()}`);
  }

  // Recompute the signed flags (from the actual verification) and the thumbnail cache-bust rev (sha256 of the served
  // thumbnail) so a now-sealed poster gets a fresh `?v=` and is seen at once past the one-day `_headers` cache.
  const idxPath = join(ROOT, 'examples', 'index.json');
  const idx = JSON.parse(readFileSync(idxPath, 'utf8'));
  for (const e of idx) { e.signed = verify(join(ROOT, 'examples', e.id, 'onepage.svg')); e.rev = rev(join(ROOT, 'examples', e.id, 'thumb.jpg')); }
  writeFileSync(idxPath, JSON.stringify(idx, null, 2) + '\n');

  const wPath = join(ROOT, 'gallery', 'works.json');
  const w = JSON.parse(readFileSync(wPath, 'utf8'));
  const arr = Array.isArray(w) ? w : (w.works || []);
  for (const x of arr) { x.signed = verify(join(ROOT, x.svg)); x.rev = rev(join(ROOT, 'gallery', 'thumbs', `${x.id}.jpg`)); }
  writeFileSync(wPath, JSON.stringify(w, null, 2) + '\n');

  console.error(`sign-works: flags updated — examples ${idx.filter((e) => e.signed).length}/${idx.length}, gallery ${arr.filter((x) => x.signed).length}/${arr.length}`);
} finally { if (tmp) rmSync(tmp, { recursive: true, force: true }); }
