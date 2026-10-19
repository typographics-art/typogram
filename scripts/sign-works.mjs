#!/usr/bin/env node
// Sign the publishable Typogram works — the law one-pagers (examples/<id>/onepage.svg) and the gallery works
// (gallery/*.svg) — as typographics-art.org, so `tg verify` passes and the site shows the green "signed" corner.
// Signing adds ONLY the signature to the data layer; the picture and the identity hash are unchanged, so previews and
// thumbnails do NOT need re-rendering. **Re-run this after any `examples/build.mjs` or `cli/build-gallery.mjs` render**,
// because a render produces an UNSIGNED svg. Then it recomputes the `signed` flags in index.json / works.json.
//
// The signing key is SECRET — pass it as a file or an env var, never commit it:
//   node scripts/sign-works.mjs --key /path/to/typographics-art.org.pem
//   TGART_SIGNING_KEY="$(…from your secret store…)" node scripts/sign-works.mjs
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

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

try {
  const svgs = [];
  for (const id of readdirSync(join(ROOT, 'examples'))) if (existsSync(join(ROOT, 'examples', id, 'onepage.svg'))) svgs.push(join(ROOT, 'examples', id, 'onepage.svg'));
  for (const f of readdirSync(join(ROOT, 'gallery'))) if (f.endsWith('.svg')) svgs.push(join(ROOT, 'gallery', f));

  let ok = 0;
  for (const f of svgs) {
    const s = tg('sign', f, '--key', keyFile, '--issuer', ISSUER, '--kid', KID, '--out', f);
    if (s.status === 0 && verify(f)) ok++;
    else console.error(`  FAILED: ${f.slice(ROOT.length + 1)} — ${(s.stderr || '').trim().split('\n')[0]}`);
  }
  console.error(`sign-works: signed + verified ${ok}/${svgs.length} works as ${ISSUER} (kid ${KID})`);

  // Recompute the signed flags from the actual verification result.
  const idxPath = join(ROOT, 'examples', 'index.json');
  const idx = JSON.parse(readFileSync(idxPath, 'utf8'));
  for (const e of idx) e.signed = verify(join(ROOT, 'examples', e.id, 'onepage.svg'));
  writeFileSync(idxPath, JSON.stringify(idx, null, 2) + '\n');

  const wPath = join(ROOT, 'gallery', 'works.json');
  const w = JSON.parse(readFileSync(wPath, 'utf8'));
  const arr = Array.isArray(w) ? w : (w.works || []);
  for (const x of arr) x.signed = verify(join(ROOT, x.svg));
  writeFileSync(wPath, JSON.stringify(w, null, 2) + '\n');

  console.error(`sign-works: flags updated — examples ${idx.filter((e) => e.signed).length}/${idx.length}, gallery ${arr.filter((x) => x.signed).length}/${arr.length}`);
} finally { if (tmp) rmSync(tmp, { recursive: true, force: true }); }
