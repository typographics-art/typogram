// A Typogram is a valid SVG that also carries a metadata block (src/typogram.js). The metadata must never disturb the
// character-for-character text of the work (the read-back stays exact), and it must round-trip for anyone who parses it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeMeta, readMeta, embedSource, readSource } from '../src/typogram.js';
import { typesetWith, toSvg, markupText, canonicalText, normalizeText } from '../src/index.js';
import { fakeMetric, image, TEXT } from './helpers.js';

test('typogram: writeMeta/readMeta round-trip, and format+v are stamped', () => {
  const meta = { title: 'Orders', created: '2026-10-18T00:00:00Z', kind: 'data', textSha256: 'deadbeef' };
  const svg = `<svg><text>x</text>${writeMeta(meta)}</svg>`;
  const back = readMeta(svg);
  assert.equal(back.format, 'typogram');
  assert.equal(back.v, 1);
  for (const k of Object.keys(meta)) assert.equal(back[k], meta[k]);
});

test('typogram: readMeta is tolerant — no block, broken JSON or a foreign element is null', () => {
  assert.equal(readMeta('<svg><text>x</text></svg>'), null);
  assert.equal(readMeta('<metadata><typogram>{not json</typogram></metadata>'), null);
  assert.equal(readMeta('nonsense'), null);
  assert.equal(readMeta(42), null);
});

test('typogram: a title with < > & survives the escaped metadata (and cannot break the SVG anchors)', () => {
  const meta = { title: 'a < b & c </text> <script>', kind: 'art' };
  const svg = `<svg><text>hi</text>${writeMeta(meta)}</svg>`;
  assert.ok(!svg.includes('</text></text>'), 'the title did not inject a second </text>');
  // the only real </text> is the artwork's, so a reader still finds the text boundary
  assert.equal(svg.indexOf('</text>'), svg.lastIndexOf('</text>'));
  assert.equal(readMeta(svg).title, 'a < b & c </text> <script>');
});

test('typogram: the exact source (Markdown tables, lists, code, line breaks) round-trips losslessly', async () => {
  const md = '# Title\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- one\n- two\n\n```js\nconst x = 1;\n  indented();\n```\n';
  const bytes = new TextEncoder().encode(md);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg"><text>Title a b 1 2 one two const x = 1; indented();</text></svg>`;
  svg = await embedSource(svg, bytes, { media: 'text/markdown' });
  const back = await readSource(svg);
  assert.equal(back.media, 'text/markdown');
  assert.equal(new TextDecoder().decode(back.bytes), md, 'byte-exact source, with its line breaks and structure');
  // the embedded source does not disturb the picture's text boundary
  assert.equal(svg.indexOf('</text>'), svg.lastIndexOf('</text>'));
  assert.equal(await readSource('<svg><text>x</text></svg>'), null);
});

test('typogram: the metadata does not change the work text (read-back stays exact)', () => {
  const text = TEXT.repeat(4);
  const sheet = typesetWith({ text, metric: fakeMetric, image: image(40, 40, () => [128, 128, 128]), options: { width: 400 } });
  const plain = toSvg(sheet);
  const withMeta = toSvg(sheet, { description: 'A picture', metadata: { title: 'A picture', kind: 'art', textSha256: 'abc' } });
  // the visible text is identical with and without metadata, and equals the source
  assert.equal(canonicalText(markupText(withMeta, 'svg')), canonicalText(markupText(plain, 'svg')));
  assert.equal(canonicalText(markupText(withMeta, 'svg')), normalizeText(text));
  assert.equal(readMeta(withMeta).title, 'A picture');
  assert.equal(readMeta(plain), null); // no metadata unless asked
});
