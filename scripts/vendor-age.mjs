#!/usr/bin/env node
// Regenerate vendor/age-encryption.mjs — the age encryption library bundled into one auditable file for Phase I
// (sealed Typograms / handoff). This project ships no runtime dependencies, so the library and its crypto deps are
// vendored as a single unminified ESM bundle rather than installed. Run this to update it; it verifies an X25519
// encrypt/decrypt round-trip before writing, and fails if the round-trip does not hold.
//
//   node scripts/vendor-age.mjs            # pins age-encryption@PIN below
//
// Needs network (npm) and npx (esbuild). Writes vendor/age-encryption.mjs.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const PIN = 'age-encryption@0.3.1'; // BSD-3-Clause; deps are noble/scure (pinned by npm's resolution, printed below)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'vendor', 'age-encryption.mjs');

const work = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'tg-age-'));
try {
  writeFileSync(join(work, 'package.json'), '{"name":"age-build","private":true,"type":"module"}\n');
  console.error(`installing ${PIN} …`);
  execFileSync('npm', ['install', '--no-audit', '--no-fund', PIN], { cwd: work, stdio: 'inherit' });
  const dep = (p) => JSON.parse(readFileSync(join(work, 'node_modules', p, 'package.json'), 'utf8')).version;
  const versions = ['age-encryption', '@noble/ciphers', '@noble/curves', '@noble/hashes', '@noble/post-quantum', '@scure/base'].map((p) => `${p}@${dep(p)}`);
  const bundle = join(work, 'bundle.mjs');
  execFileSync('npx', ['--yes', 'esbuild', join(work, 'node_modules', 'age-encryption', 'dist', 'index.js'), '--bundle', '--format=esm', '--platform=neutral', '--legal-comments=inline', `--outfile=${bundle}`], { cwd: work, stdio: 'inherit' });

  // Verify a real round-trip before writing the vendored file.
  const mod = await import('file://' + bundle);
  const id = await mod.generateX25519Identity();
  const r = await mod.identityToRecipient(id);
  const enc = new mod.Encrypter(); enc.addRecipient(r);
  const ct = await enc.encrypt(new TextEncoder().encode('round-trip'));
  const dec = new mod.Decrypter(); dec.addIdentity(id);
  const pt = new TextDecoder().decode(await dec.decrypt(ct, 'uint8array'));
  if (pt !== 'round-trip') throw new Error('round-trip failed — not writing the vendored file');

  const header = [
    '// VENDORED — age-encryption, bundled for Phase I (sealed Typograms / handoff). Do not edit by hand.',
    `//   source:  ${versions.join(' ')}`,
    '//   bundled: esbuild --bundle --format=esm --platform=neutral --legal-comments=inline (unminified, so it stays auditable)',
    '//   regenerate: node scripts/vendor-age.mjs   (verifies an X25519 encrypt/decrypt round-trip after bundling)',
    '//   exports: Encrypter, Decrypter, armor, generateX25519Identity, identityToRecipient, Stanza, webauthn, …',
    '',
  ].join('\n');
  writeFileSync(OUT, header + readFileSync(bundle, 'utf8'));
  console.error(`wrote ${OUT} (${versions.join(', ')}); round-trip verified`);
} finally { rmSync(work, { recursive: true, force: true }); }
