// `tg keygen` (Phase H): generates an Ed25519 issuer key as a self-signed key statement in the key file. Pure (no render,
// no network), so it runs in the gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyKeyStatement, publicKeyOf } from '../src/sign.js';

const TG = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'tg.mjs');
const run = (dir, ...args) => spawnSync(process.execPath, [TG, ...args], { encoding: 'utf8' });

test('tg keygen: writes a self-signed key statement to the key file + .well-known, private key mode 600, not printed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tg-keygen-'));
  try {
    const r = run(dir, 'keygen', '--issuer', 'test.example', '--kid', 'k1', '--out', dir, '--private-out', join(dir, 'priv.pem'));
    assert.equal(r.status, 0, r.stderr);
    const wk = JSON.parse(readFileSync(join(dir, '.well-known', 'tgart-keys.json'), 'utf8'));
    const repo = JSON.parse(readFileSync(join(dir, 'keys', 'test.example.json'), 'utf8'));
    assert.deepEqual(wk, repo, 'the served and the repo-mirrored key file match');
    assert.equal(wk.issuer, 'test.example');
    const st = wk.keys[0];
    assert.equal(st.kid, 'k1');
    assert.equal(verifyKeyStatement(st).ok, true, 'the statement self-verifies');
    assert.equal(publicKeyOf(readFileSync(join(dir, 'priv.pem'), 'utf8')), st.publicKey, 'the private key matches the published public key');
    assert.equal((statSync(join(dir, 'priv.pem')).mode & 0o777).toString(8), '600', 'the private key is mode 600');
    assert.ok(!r.stdout.includes('PRIVATE KEY'), 'the private key is NOT printed to stdout when --private-out is given');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('tg keygen: a second key for the same issuer is appended, keyed by kid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tg-keygen-'));
  try {
    run(dir, 'keygen', '--issuer', 'x.org', '--kid', 'a', '--out', dir, '--private-out', join(dir, 'a.pem'));
    run(dir, 'keygen', '--issuer', 'x.org', '--kid', 'b', '--out', dir, '--private-out', join(dir, 'b.pem'));
    const wk = JSON.parse(readFileSync(join(dir, '.well-known', 'tgart-keys.json'), 'utf8'));
    assert.deepEqual(wk.keys.map((k) => k.kid).sort(), ['a', 'b'], 'both keys present, one per kid');
    for (const st of wk.keys) assert.equal(verifyKeyStatement(st).ok, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('tg keygen: requires --issuer', () => {
  const r = run('.', 'keygen');
  assert.notEqual(r.status, 0);
  assert.match(`${r.stderr}${r.stdout}`, /issuer/);
});

test('tg keygen: refuses to overwrite an existing private-key file (no TOCTOU/symlink clobber)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tg-keygen-'));
  try {
    const priv = join(dir, 'priv.pem');
    writeFileSync(priv, 'EXISTING');
    const r = run(dir, 'keygen', '--issuer', 'x.org', '--kid', 'k1', '--out', dir, '--private-out', priv);
    assert.notEqual(r.status, 0, 'must fail rather than overwrite an existing file');
    assert.equal(readFileSync(priv, 'utf8'), 'EXISTING', 'the existing file is left untouched');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
