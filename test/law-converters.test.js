// Guards for the EUR-Lex and gesetze-im-internet converters, after the law one-pager audit found losses:
//   - eurlex-to-md: a lettered point is two Official-Journal paragraphs (a bare "(a)" then the text); they must be
//     recombined into "(a) text", not left as an orphan marker.
//   - gii-to-md: a German enumeration <DL> is nested INSIDE the <P>; it must become a real list (and a nested a)/b)
//     sub-list under an item must survive), not be flattened to "…über: 1.die…;2.die…".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(script, input, ext) {
  const dir = mkdtempSync(join(ROOT, 'test', '.law-'));
  try {
    const inPath = join(dir, 'in.' + ext), out = join(dir, 'out.md');
    writeFileSync(inPath, input);
    const r = spawnSync('node', [join(ROOT, 'scripts', script), inPath, out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return readFileSync(out, 'utf8');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('eurlex-to-md: a bare point marker is joined with its text, not orphaned', () => {
  const html = `<p class="oj-ti-section-1">CHAPTER I</p><p class="oj-ti-section-2">General provisions</p>
<p class="oj-ti-art">Article 1</p><p class="oj-sti-art">Subject matter</p>
<p class="oj-normal">1. This Regulation lays down:</p>
<p class="oj-normal">(a)</p><p class="oj-normal">harmonised rules;</p>
<p class="oj-normal">(b)</p><p class="oj-normal">prohibitions;</p>`;
  const md = run('eurlex-to-md.mjs', html, 'html');
  assert.match(md, /\(a\) harmonised rules;/);
  assert.match(md, /\(b\) prohibitions;/);
  assert.doesNotMatch(md, /^\(a\)$/m);   // no orphan marker line
});

test('gii-to-md: a <DL> nested in a <P> becomes a real list, with its nested sub-list', () => {
  const xml = `<dokumente><norm><metadaten><enbez>Art 1</enbez><titel>Test</titel></metadaten>
<textdaten><text><Content><P>(1) Der Bund regelt: <DL Type="arabic"><DT>1.</DT><DD><LA>die A;</LA></DD>
<DT>2.</DT><DD><LA>die B und zwar <DL Type="alpha"><DT>a)</DT><DD><LA>X,</LA></DD><DT>b)</DT><DD><LA>Y;</LA></DD></DL> sowie Z.</LA></DD></DL></P></Content></text></textdaten></norm></dokumente>`;
  const md = run('gii-to-md.mjs', xml, 'xml');
  assert.match(md, /\(1\) Der Bund regelt:/);
  assert.match(md, /^- 1\. die A;/m);
  assert.match(md, /^- 2\. die B und zwar/m);
  assert.match(md, /^ {2}- a\) X,/m);                 // nested, indented
  assert.match(md, /^ {2}- b\) Y;/m);
  assert.match(md, /sowie Z\./);                       // trailing text after the nested list is kept
  assert.doesNotMatch(md, /1\.die A/);                 // not flattened/glued
});
