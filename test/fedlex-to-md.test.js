// scripts/fedlex-to-md.mjs converts a Fedlex Akoma Ntoso XML to structured Markdown. These guard the four fixes made
// after the Bundesverfassung one-pager was found to lose content: bis/ter paragraph numbers must survive (not collapse
// to the bare digit), list items must not inherit the paragraph mark and nested lists must stay nested, content under a
// <subdivision> (transitional provisions, Art. 196/197) must be emitted, and the alphabetical Sachverzeichnis (a
// navigation aid, not enacted text) must be dropped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(ROOT, 'test', 'fixtures', 'fedlex-sample.akn.xml');

function convert() {
  const dir = mkdtempSync(join(ROOT, 'test', '.fedlex-'));
  try {
    const out = join(dir, 'out.md'), idx = join(dir, 'idx.json');
    const r = spawnSync('node', [join(ROOT, 'scripts', 'fedlex-to-md.mjs'), FIX, out, idx], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return { md: readFileSync(out, 'utf8'), index: JSON.parse(readFileSync(idx, 'utf8')) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('bis/ter paragraph numbers survive, not collapsed to the bare digit', () => {
  const { md } = convert();
  assert.match(md, /\(1\) First\./);
  assert.match(md, /\(3bis\) Inserted later\./);   // must NOT become "(3)"
  assert.doesNotMatch(md, /\(3\) Inserted later\./);
});

test('list items carry no paragraph mark, and a nested list stays nested', () => {
  const { md } = convert();
  assert.match(md, /\(1\) It can:/);               // the paragraph mark is on the intro only
  assert.match(md, /^- a\. one;/m);
  assert.doesNotMatch(md, /\(1\) - a\./);           // not "(1) - a. one;"
  assert.match(md, /^- b\. two, namely:/m);
  assert.match(md, /^ {2}- 1\. sub-one,/m);         // nested, indented
  assert.match(md, /^ {2}- 2\. sub-two\./m);
});

test('content under a <subdivision> is emitted (transitional provisions)', () => {
  const { md } = convert();
  assert.match(md, /\*\*To Art\. 1\*\*/);
  assert.match(md, /\(1\) Nested paragraph\./);     // without the fix this whole subdivision was dropped
});

test('the Sachverzeichnis subject index is dropped, with no empty letter headings', () => {
  const { md } = convert();
  assert.doesNotMatch(md, /Sachverzeichnis/);
  assert.doesNotMatch(md, /^#{1,6} A$/m);
  assert.doesNotMatch(md, /Abgabe 1/);              // the index entry must not leak in
});

test('the article index lists the three articles', () => {
  const { index } = convert();
  assert.deepEqual(index.map((e) => e.num), ['Art. 1', 'Art. 2', 'Art. 3']);
});
