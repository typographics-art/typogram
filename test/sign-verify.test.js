// Phase H: tg sign + three-state tg verify (VERIFIED 0 / UNSIGNED 2 / TAMPERED 1). SVG only, offline (no render/network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateIssuerKey, signKeyStatement } from '../src/sign.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TG = join(HERE, '..', 'cli', 'tg.mjs');
const SUBJECT = join(HERE, '..', 'gallery', 'blue-marble.svg'); // a real, consistent Typogram (signed in the repo)
const run = (...a) => spawnSync(process.execPath, [TG, ...a], { encoding: 'utf8' });

test('tg sign/verify: unsigned → 2, signed → VERIFIED 0, no key / bad signature / wrong key → TAMPERED 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tg-sv-'));
  try {
    // SUBJECT is committed signed; strip just the signature for a consistent UNSIGNED work (hash still matches).
    const unsigned = join(dir, 'unsigned.svg');
    writeFileSync(unsigned, readFileSync(SUBJECT, 'utf8').replace(/"signature":"[^"]*",/, ''));
    assert.equal(run('verify', unsigned).status, 2, 'an unsigned Typogram is UNSIGNED (exit 2)');

    assert.equal(run('keygen', '--issuer', 'test.example', '--kid', 'k1', '--out', dir, '--private-out', join(dir, 'priv.pem')).status, 0);
    const signed = join(dir, 'signed.svg');
    assert.equal(run('sign', SUBJECT, '--key', join(dir, 'priv.pem'), '--issuer', 'test.example', '--kid', 'k1', '--out', signed).status, 0);

    const v = run('verify', signed, '--keys', dir);
    assert.equal(v.status, 0, `signed should be VERIFIED:\n${v.stdout}${v.stderr}`);
    assert.match(v.stdout, /VERIFIED/);
    assert.match(v.stdout, /test\.example/);

    assert.equal(run('verify', signed).status, 1, 'no issuer key available → TAMPERED (exit 1)');

    const bad = join(dir, 'bad.svg');
    writeFileSync(bad, readFileSync(signed, 'utf8').replace(/("signature":")([A-Za-z0-9])/, '$1Z'));
    assert.equal(run('verify', bad, '--keys', dir).status, 1, 'a corrupted signature → TAMPERED');

    // signed with a different key but claiming test.example → the real test.example key rejects it
    assert.equal(run('keygen', '--issuer', 'evil.example', '--kid', 'k1', '--out', dir, '--private-out', join(dir, 'evil.pem')).status, 0);
    const spoof = join(dir, 'spoof.svg');
    assert.equal(run('sign', SUBJECT, '--key', join(dir, 'evil.pem'), '--issuer', 'test.example', '--kid', 'k1', '--out', spoof).status, 0);
    assert.equal(run('verify', spoof, '--keys', join(dir, 'keys', 'test.example.json')).status, 1, 'signed with the wrong key → TAMPERED');

    // signing does not change the identity hash (the image + source are untouched)
    const h = (p) => (JSON.parse(readFileSync(p, 'utf8').match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])).tgart.hash;
    assert.equal(h(signed), run('extract', SUBJECT, '--json').stdout.match(/"hash":\s*"([0-9a-f]{64})"/)[1], 'the hash is unchanged by signing');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('tg verify: a malformed issuer in the record is rejected (no path traversal / escape injection)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tg-sv-'));
  try {
    run('keygen', '--issuer', 'test.example', '--kid', 'k1', '--out', dir, '--private-out', join(dir, 'priv.pem'));
    const signed = join(dir, 's.svg');
    run('sign', SUBJECT, '--key', join(dir, 'priv.pem'), '--issuer', 'test.example', '--kid', 'k1', '--out', signed);
    const evil = join(dir, 'evil.svg');
    writeFileSync(evil, readFileSync(signed, 'utf8').replace('"issuer":"test.example"', '"issuer":"../../../tmp/x"'));
    const r = run('verify', evil, '--keys', dir);
    assert.equal(r.status, 1, `malformed issuer → TAMPERED:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr + r.stdout, /malformed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('tg verify: a revoked signing key is rejected (TAMPERED)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tg-sv-'));
  try {
    run('keygen', '--issuer', 'rev.example', '--kid', 'k1', '--out', dir, '--private-out', join(dir, 'k1.pem'));
    const k1stmt = JSON.parse(readFileSync(join(dir, 'keys', 'rev.example.json'), 'utf8')).keys[0];
    const k2 = generateIssuerKey();
    const k2stmt = signKeyStatement({ issuer: 'rev.example', kid: 'k2', publicKey: k2.publicKey, revokes: ['k1'] }, k2.privatePem);
    const keyfile = join(dir, 'rev-keyfile.json');
    writeFileSync(keyfile, JSON.stringify({ issuer: 'rev.example', keys: [k1stmt, k2stmt] }));
    const signed = join(dir, 'rev.svg');
    run('sign', SUBJECT, '--key', join(dir, 'k1.pem'), '--issuer', 'rev.example', '--kid', 'k1', '--out', signed);
    const r = run('verify', signed, '--keys', keyfile);
    assert.equal(r.status, 1, `revoked key → TAMPERED:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr + r.stdout, /revoked/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
