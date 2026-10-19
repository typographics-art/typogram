// Phase I1 bundles, as a deterministic guard (no Chrome): verify a committed signed bundle fixture and confirm the
// four tamper cases are caught — a changed document, a missing document, an extra document. The fixture and its test
// key file live under test/fixtures/ (keys for tests only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, cpSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyBundle } from '../cli/bundle.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(ROOT, 'test', 'fixtures', 'bundle');
const keyfile = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'bundle-keys', 'test.example.json'), 'utf8'));
const loadKeyfile = () => keyfile;

// Work on a throwaway copy of the fixture (kept inside test/ so it never touches a full /tmp), mutate it, verify.
async function onCopy(mutate) {
  const dir = mkdtempSync(join(ROOT, 'test', '.bundle-'));
  try { cpSync(FIX, dir, { recursive: true }); mutate(dir); return await verifyBundle(dir, { loadKeyfile }); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

test('bundle VERIFIED: the signed fixture checks out, three documents', async () => {
  const r = await verifyBundle(FIX, { loadKeyfile });
  assert.equal(r.state, 'VERIFIED', r.issues.join('; '));
  assert.equal(r.documents, 3);
});

test('bundle TAMPERED: a changed document is caught', async () => {
  const r = await onCopy((d) => { const p = join(d, '02-design.svg'); writeFileSync(p, readFileSync(p, 'utf8').replace('three services', 'four services')); });
  assert.equal(r.state, 'TAMPERED');
  assert.ok(r.issues.some((i) => /02-design/.test(i)), r.issues.join('; '));
});

test('bundle TAMPERED: a missing document is caught', async () => {
  const r = await onCopy((d) => rmSync(join(d, '03-rules.svg')));
  assert.equal(r.state, 'TAMPERED');
  assert.ok(r.issues.some((i) => /03-rules.*missing/.test(i)), r.issues.join('; '));
});

test('bundle TAMPERED: an extra document is caught', async () => {
  const r = await onCopy((d) => cpSync(join(d, '01-overview.svg'), join(d, 'zz-extra.svg')));
  assert.equal(r.state, 'TAMPERED');
  assert.ok(r.issues.some((i) => /extra/.test(i)), r.issues.join('; '));
});
