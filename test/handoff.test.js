// Phase I3 handoff archive core (cli/handoff.mjs): pack files + manifest, round-trip, per-file hash check, origin
// enforcement, path safety, and the warn-only secret scan. The CLI (tg handoff / tg open) seals this archive as a signed
// Typogram and is tested separately.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildArchive, archiveToText, readArchive, archiveFiles, scanSecrets } from '../cli/handoff.mjs';

const entries = [
  { path: 'docs/plan.md', bytes: Buffer.from('# Plan\n\nShip it.\n'), origin: 'human' },
  { path: 'notes.txt', bytes: Buffer.from('agent summary'), origin: 'ai-summary' },
];

test('buildArchive → archiveFiles round-trips with manifest and origins', () => {
  const a = buildArchive(entries, { created: '2026-10-19', title: 'Handoff' });
  assert.equal(a.spec, 'tgart-handoff-v1');
  assert.equal(a.manifest.length, 2);
  assert.deepEqual(a.manifest.map((m) => [m.path, m.origin, m.size]), [['docs/plan.md', 'human', 17], ['notes.txt', 'ai-summary', 13]]);
  const back = readArchive(archiveToText(a));
  const files = [...archiveFiles(back)];
  assert.equal(files[0].bytes.toString('utf8'), '# Plan\n\nShip it.\n');
  assert.equal(files[1].origin, 'ai-summary');
});

test('buildArchive enforces origin, path safety, duplicates and non-empty', () => {
  assert.throws(() => buildArchive([{ path: 'a', bytes: Buffer.from('x'), origin: 'nope' }]), /origin must be one of/);
  assert.throws(() => buildArchive([{ path: '../escape', bytes: Buffer.from('x'), origin: 'human' }]), /unsafe archive path/);
  assert.throws(() => buildArchive([{ path: 'a', bytes: Buffer.from('1'), origin: 'human' }, { path: 'a', bytes: Buffer.from('2'), origin: 'human' }]), /duplicate path/);
  assert.throws(() => buildArchive([]), /at least one file/);
});

test('archiveFiles catches a tampered file (hash mismatch)', () => {
  const a = buildArchive(entries);
  a.files['notes.txt'] = Buffer.from('tampered').toString('base64'); // manifest hash no longer matches
  assert.throws(() => [...archiveFiles(a)], /does not match the manifest hash/);
});

test('readArchive rejects a non-handoff text', () => {
  assert.equal(readArchive('{"spec":"something-else"}'), null);
  assert.equal(readArchive('not json'), null);
});

test('scanSecrets warns on a private key and a token, passes clean content', () => {
  const hits = scanSecrets([
    { path: 'key.pem', bytes: Buffer.from('-----BEGIN PRIVATE KEY-----\nMII...\n-----END PRIVATE KEY-----') },
    { path: 'readme.md', bytes: Buffer.from('nothing secret here') },
    { path: 'cfg', bytes: Buffer.from('api_key: ' + 'A'.repeat(24)) },
  ]);
  assert.ok(hits.some((h) => h.path === 'key.pem'));
  assert.ok(hits.some((h) => h.path === 'cfg'));
  assert.ok(!hits.some((h) => h.path === 'readme.md'));
});
