// The verified-issuer key registry (cli/keys-registry.mjs): a key file validates only when every Ed25519 statement
// self-verifies and names its issuer; the registry aggregates such files; tampering is caught; and `fetchIssuerKeyfile`
// (domain-control proof) accepts a well-formed served file and rejects an issuer mismatch or a non-2xx. Uses the existing
// test key files (seal.example with an Ed25519 + an X25519 entry, test.example with an Ed25519 entry).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateKeyfile, buildRegistry, verifyRegistry, verifiedMap, fetchIssuerKeyfile } from '../cli/keys-registry.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const seal = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'seal-keys', 'seal.example.json'), 'utf8'));
const other = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'bundle-keys', 'test.example.json'), 'utf8'));

function tmpKeysDir(files) {
  const dir = mkdtempSync(join(ROOT, 'test', '.keys-'));
  for (const [name, obj] of Object.entries(files)) writeFileSync(join(dir, name), JSON.stringify(obj, null, 2));
  return dir;
}

test('validateKeyfile: a self-signed key file verifies; X25519 entries are shape-checked', () => {
  assert.equal(validateKeyfile(seal).ok, true);
  assert.equal(validateKeyfile(other).ok, true);
  assert.equal(validateKeyfile({ issuer: 'x', keys: [] }).ok, false); // bad hostname + no keys
});

test('validateKeyfile: a tampered Ed25519 statement is rejected', () => {
  const bad = structuredClone(seal);
  bad.keys[0].publicKey = bad.keys[0].publicKey.slice(0, -2) + (bad.keys[0].publicKey.endsWith('A') ? 'BB' : 'AA');
  const v = validateKeyfile(bad);
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /did not verify/.test(p)), v.problems.join('; '));
});

test('buildRegistry: aggregates every key file, sorted, and carries forward verified metadata', () => {
  const dir = tmpKeysDir({ 'seal.example.json': seal, 'test.example.json': other });
  try {
    const { registry, problems } = buildRegistry(dir, { verified: { 'seal.example': { verifiedAt: '2026-10-19', verifiedVia: 'https://seal.example/.well-known/tgart-keys.json' } } });
    assert.equal(problems.length, 0, problems.join('; '));
    assert.equal(registry.spec, 'tgart-registry-v1');
    assert.deepEqual(registry.issuers.map((e) => e.issuer), ['seal.example', 'test.example']);
    assert.equal(registry.issuers[0].verifiedAt, '2026-10-19');
    assert.equal(registry.issuers[1].verifiedVia, 'https://test.example/.well-known/tgart-keys.json'); // defaulted
    // round-trips through verifiedMap
    assert.equal(verifiedMap(registry)['seal.example'].verifiedAt, '2026-10-19');
    assert.equal(verifyRegistry(registry).ok, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('buildRegistry: a broken key file is reported, not silently included', () => {
  const broken = structuredClone(other); broken.keys[0].sig.signature = 'AAAA';
  const dir = tmpKeysDir({ 'test.example.json': broken });
  try {
    const { registry, problems } = buildRegistry(dir);
    assert.equal(registry.issuers.length, 0);
    assert.ok(problems.some((p) => /test\.example/.test(p)), problems.join('; '));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('verifyRegistry: a tampered registry fails', () => {
  const { registry } = buildRegistry(tmpKeysDir({ 'test.example.json': other }));
  registry.issuers[0].keys[0].publicKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  assert.equal(verifyRegistry(registry).ok, false);
});

test('the committed registry verifies and lists every keys/<domain>.json', () => {
  const reg = JSON.parse(readFileSync(join(ROOT, 'keys', 'registry.json'), 'utf8'));
  assert.equal(verifyRegistry(reg).ok, true, 'keys/registry.json must verify — run: tg keys build');
  const { registry } = buildRegistry(join(ROOT, 'keys'), { verified: verifiedMap(reg) });
  assert.deepEqual(registry.issuers.map((e) => e.issuer).sort(), reg.issuers.map((e) => e.issuer).sort(),
    'keys/registry.json is out of sync with the keys/<domain>.json files — run: tg keys build');
});

test('the npm and PyPI packages are in sync with keys/registry.json', () => {
  const reg = JSON.parse(readFileSync(join(ROOT, 'keys', 'registry.json'), 'utf8'));
  const npm = JSON.parse(readFileSync(join(ROOT, 'packages', 'keys', 'registry.json'), 'utf8'));
  const pypi = JSON.parse(readFileSync(join(ROOT, 'packages', 'pypi-keys', 'tgart_keys', 'registry.json'), 'utf8'));
  assert.deepEqual(npm, reg, 'packages/keys is stale — run: node scripts/build-keys-package.mjs');
  assert.deepEqual(pypi, reg, 'packages/pypi-keys is stale — run: node scripts/build-keys-package.mjs');
});

test('fetchIssuerKeyfile: accepts a well-formed served file; rejects issuer mismatch and non-2xx', async () => {
  const ok = { ok: true, status: 200, text: async () => JSON.stringify(other) };
  const r = await fetchIssuerKeyfile('test.example', { fetchImpl: async () => ok });
  assert.equal(r.keyfile.issuer, 'test.example');
  assert.match(r.url, /^https:\/\/test\.example\/\.well-known\/tgart-keys\.json$/);
  // served file names a different issuer than the domain asked for
  await assert.rejects(() => fetchIssuerKeyfile('evil.example', { fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify(other) }) }), /does not|names issuer/);
  // non-2xx
  await assert.rejects(() => fetchIssuerKeyfile('test.example', { fetchImpl: async () => ({ ok: false, status: 404, text: async () => '' }) }), /404/);
});
