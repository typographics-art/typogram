// Phase I2 sealed Typograms, end to end through the real CLI (no Chrome: a pre-rendered signed fixture lives under
// test/fixtures/seal/, its public key file — Ed25519 signing statement + X25519 sealing entry — under test/fixtures/
// seal-keys/). Guards that `tg verify` reports SEALED VERIFIED, that tampering the ciphertext is caught as SEALED
// TAMPERED (the signature covers the armor, so a tamper is seen BEFORE any decryption), and that `tg open` refuses a
// tampered work and a non-matching identity. The seal↔open decryption round-trip itself is in test/seal.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, cpSync, rmSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateX25519Identity } from '../vendor/age-encryption.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TG = join(ROOT, 'cli', 'tg.mjs');
const FIXTURE = join(ROOT, 'test', 'fixtures', 'seal', 'note.sealed.tg.svg');
const KEYS = join(ROOT, 'test', 'fixtures', 'seal-keys');
const run = (...args) => spawnSync('node', [TG, ...args], { encoding: 'utf8' });

// A throwaway copy of the fixture inside test/ (never a full /tmp), optionally mutated.
function onCopy(mutate) {
  const dir = mkdtempSync(join(ROOT, 'test', '.seal-'));
  const svg = join(dir, 'note.sealed.tg.svg');
  cpSync(FIXTURE, svg);
  if (mutate) writeFileSync(svg, mutate(readFileSync(svg, 'utf8')));
  return { dir, svg, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// Flip one base64 character of the ciphertext in the embedded source (the contiguous armor lives only in the data
// layer; the image layer is per-glyph), so the picture and the source diverge — a tamper of the sealed payload.
function tamperArmor(svg) {
  const end = svg.indexOf('END AGE ENCRYPTED FILE');
  assert.ok(end > 0, 'fixture should carry an age payload');
  const at = svg.lastIndexOf('\n', end - 2) - 6;
  return svg.slice(0, at) + (svg[at] === 'A' ? 'B' : 'A') + svg.slice(at + 1);
}

test('tg verify: the sealed fixture is SEALED VERIFIED (exit 0)', () => {
  const r = run('verify', FIXTURE, '--keys', KEYS);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /SEALED VERIFIED/);
  // recipients + cipher are read from the SIGNED envelope text (not the unsigned tgart JSON)
  assert.match(r.stdout, /sealed \(age v1\) to seal\.example:seal-2026-10/);
});

test('tg verify: a tampered sealed payload is SEALED TAMPERED (exit 1)', () => {
  const { svg, cleanup } = onCopy(tamperArmor);
  try {
    const r = run('verify', svg, '--keys', KEYS);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /SEALED TAMPERED/);
  } finally { cleanup(); }
});

test('tg open: refuses a tampered sealed work before decrypting (exit 1)', () => {
  const { dir, svg, cleanup } = onCopy(tamperArmor);
  try {
    const id = join(dir, 'id.age');
    writeFileSync(id, 'AGE-SECRET-KEY-1DUMMYDUMMYDUMMYDUMMYDUMMYDUMMYDUMMYDUMMYDUMMYDUMMYDUMMY0\n');
    const r = run('open', svg, '--identity', id, '--keys', KEYS);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /refusing to open/);
    assert.match(r.stderr, /SEALED TAMPERED/);
  } finally { cleanup(); }
});

test('tg open: a non-matching identity cannot open the fixture (exit 1)', async () => {
  const { dir, cleanup } = onCopy();
  try {
    const id = join(dir, 'wrong.age');
    writeFileSync(id, (await generateX25519Identity()) + '\n');
    const r = run('open', FIXTURE, '--identity', id, '--keys', KEYS);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /could not open|no identity matched/);
  } finally { cleanup(); }
});

test('tg verify: forged tgart.recipients do not change the shown (signed) recipients', () => {
  // The JSON-LD record is not covered by the signature; the envelope text is. Forging tgart.recipients leaves the work
  // VERIFIED (the hash is unchanged) but must NOT change what verify reports — that is read from the signed envelope.
  const { svg, cleanup } = onCopy((s) => s.replace(/"recipients":\s*\[[^\]]*\]/, '"recipients":[{"issuer":"attacker.example","kid":"evil"}]'));
  try {
    const r = run('verify', svg, '--keys', KEYS);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /to seal\.example:seal-2026-10/);
    assert.doesNotMatch(r.stdout, /attacker\.example/);
  } finally { cleanup(); }
});

test('tg open: refuses a non-sealed Typogram', () => {
  const r = run('open', join(ROOT, 'test', 'fixtures', 'bundle', '01-overview.svg'), '--identity', '/dev/null');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not a sealed Typogram/);
});
