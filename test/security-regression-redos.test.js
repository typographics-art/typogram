// Finding F1: quadratic regular expressions (denial of service by a data file).
// Regression tests for the findings of the internal security review of 2026-10 (docs/security-review-internal-2026-10.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { encode, TgdError } from '../src/structured.js';
import { parseYaml, cutComment } from '../src/structured-yaml.js';
import { parseXml } from '../src/structured-xml.js';
import { structuredText } from '../src/structure.js';

const enc = new TextEncoder();
const timed = async (fn) => { const t = performance.now(); const r = await fn(); return { r, ms: performance.now() - t }; };
const FAST_MS = 400; // linear work on 60 000 characters takes a few milliseconds; the quadratic versions took seconds

// ---- F1: quadratic regular expressions (denial of service by a data file) ----------------------------------------------
test('F1 YAML: a value or a flow collection followed by a long run of white space is read in linear time (comment stripping)', async () => {
  const n = 60000;
  const a = await timed(() => encode({ bytes: enc.encode('a: b' + ' '.repeat(n) + 'c\n'), name: 'x.yaml', format: 'yaml' }, { created: false }));
  assert.ok(a.ms < FAST_MS, `${a.ms.toFixed(0)} ms`);
  assert.equal(a.r.model.value.a, 'b' + ' '.repeat(n) + 'c');
  const b = await timed(async () => { try { parseYaml('[1, 2]' + ' '.repeat(n) + 'x'); } catch (e) { return e.code; } });
  assert.ok(b.ms < FAST_MS, `${b.ms.toFixed(0)} ms`); assert.equal(b.r, 'syntax');
});
test('F1 YAML: cutComment equals the old regular expressions on every string of length 0 to 6 over { space, tab, #, a, newline, U+2028 }', () => {
  const alpha = [' ', '\t', '#', 'a', '\n', ' '];
  const gen = (len, f, pre = '') => { if (pre.length === len) return f(pre); for (const c of alpha) gen(len, f, pre + c); };
  let n = 0;
  for (let len = 0; len <= 6; len++) gen(len, (s) => { n++; assert.equal(cutComment(s, true), s.replace(/\s+#.*$/, ''), JSON.stringify(s)); assert.equal(cutComment(s, false), s.replace(/\s*#.*$/, ''), JSON.stringify(s)); });
  assert.ok(n > 55000);
});
test('F1 Markdown: a heading with a long run of spaces, a paragraph that ends in a long run of spaces, and a table row are read in linear time', async () => {
  const n = 60000;
  for (const text of ['# a' + ' '.repeat(n) + 'x\n', 'a' + ' '.repeat(n) + 'x\n', '[a]: ' + ' '.repeat(n) + 'x\n', '|a|\n|' + ' '.repeat(n) + 'x\n', '***' + ' '.repeat(n) + 'x\n', 'text' + '\t'.repeat(n) + 'x\n']) {
    const { ms } = await timed(() => encode({ bytes: enc.encode(text), name: 'x.md', format: 'md' }, { created: false }));
    assert.ok(ms < FAST_MS, `${JSON.stringify(text.slice(0, 12))}: ${ms.toFixed(0)} ms`);
  }
});
test('F1 Markdown: headings still read as before (text, closing hashes, bare hashes, 7 hashes are no heading)', async () => {
  const read = async (md) => (await encode({ bytes: enc.encode(md), name: 'x.md', format: 'md' }, { created: false })).model.blocks;
  assert.deepEqual(await read('# One\n## Two ##\n### Three   ###  \n#### \n##### x #y\n'), [
    { t: 'h', l: 1, x: 'One' }, { t: 'h', l: 2, x: 'Two' }, { t: 'h', l: 3, x: 'Three' }, { t: 'h', l: 4, x: '' }, { t: 'h', l: 5, x: 'x #y' }]);
  assert.equal((await read('####### seven\n'))[0].t, 'p');
});
test('F1 XML: a declaration "<?xml" followed by a long run of white space is refused in linear time', async () => {
  const { ms, r } = await timed(async () => { try { parseXml('<?xml ' + ' '.repeat(60000)); } catch (e) { return e.code; } });
  assert.ok(ms < FAST_MS, `${ms.toFixed(0)} ms`); assert.equal(r, 'syntax');
  assert.deepEqual(parseXml('<?xml  version="1.0" encoding="UTF-8"?><a/>').declaration, { version: '1.0', encoding: 'UTF-8' });
});
test('F1 text structure (Read view): a heading line with a long run of white space inside is split in linear time, and headings still come out the same', () => {
  const t0 = performance.now();
  const doc = structuredText('# Title' + ' '.repeat(30000) + 'more\n\nbody\n');
  assert.ok(performance.now() - t0 < FAST_MS);
  assert.equal(doc.sections[0].title.startsWith('Title'), true);
  assert.deepEqual(structuredText('# A ##\n\ntext\n\n#   B  \n\nmore').sections.map((s) => s.title), ['A', 'B']);
});

