// A Typogram is a valid SVG that also carries the DATA LAYER (src/typogram.js): the exact source in CDATA + a JSON-LD
// record, placed before the artwork <text>. The data layer must never disturb the character-for-character text of the work
// (the read-back stays exact), and the source and record must round-trip for anyone who parses them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJsonld, readDataMarkdown, readJsonld } from '../src/typogram.js';
import { typesetWith, toSvg, markupText, canonicalText, normalizeText, sha256Hex } from '../src/index.js';
import { fakeMetric, image, TEXT } from './helpers.js';

const sheetOf = (text) => typesetWith({ text, metric: fakeMetric, image: image(40, 40, () => [128, 128, 128]), options: { width: 400 } });

test('typogram: toSvg carries the data layer before <text>, and the read-back of the artwork stays exact', async () => {
  // the picture is set from the whole source (as the generator does), so the image layer and the source share a canonical text
  const md = '# A picture\n\n' + TEXT.repeat(4);
  const sheet = sheetOf(normalizeText(md));
  const hash = await sha256Hex(canonicalText(md));
  const plain = toSvg(sheet);
  const withData = toSvg(sheet, { description: 'A picture', markdown: md, jsonld: buildJsonld({ name: 'A picture', hash, charCount: md.length }) });

  // the data layer sits before the artwork, and there is only one real </text> (the picture's)
  assert.ok(withData.indexOf('<metadata>') < withData.indexOf('<text'), 'the data layer is before <text>');
  assert.equal(withData.indexOf('</text>'), withData.lastIndexOf('</text>'), 'only the artwork has a </text>');

  // the visible text is identical with and without the data layer, and the hash binds the image layer to the source
  assert.equal(canonicalText(markupText(withData, 'svg')), canonicalText(markupText(plain, 'svg')));
  assert.equal(canonicalText(markupText(withData, 'svg')), canonicalText(md), 'the image layer and the source share a canonical text (the hash binds them)');
  assert.equal(await sha256Hex(canonicalText(markupText(withData, 'svg'))), hash, 'the image-layer hash equals the stored hash');

  // the exact source and the JSON-LD record round-trip
  assert.equal(readDataMarkdown(withData).markdown, md);
  assert.equal(readDataMarkdown(withData).media, 'text/markdown');
  assert.equal(readJsonld(withData).name, 'A picture');
  assert.equal(readJsonld(withData).tgart.hash, hash);
  assert.equal(readJsonld(plain), null); // no data layer unless asked
  assert.equal(readDataMarkdown(plain), null);
});

test('typogram: hostile source (<text>, </metadata>, ]]>) in the data layer does not disturb the read-back', () => {
  const text = 'Title body one two';
  const md = '# Title\n\n' + text + '\n\nInjected </text> and </metadata> and ]]> and <text id="x">fake</text>\n';
  const svg = toSvg(sheetOf(text), { markdown: md });
  // the image-layer extraction anchors on the artwork <text>, not on the CDATA content
  assert.equal(canonicalText(markupText(svg, 'svg')), normalizeText(text));
  assert.equal(readDataMarkdown(svg).markdown, md, 'the source is byte-identical, adversarial content and all');
});

test('typogram: the exact source (Markdown tables, lists, code, line breaks) round-trips losslessly in the data layer', () => {
  const md = '# Title\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- one\n- two\n\n```js\nconst x = 1;\n  indented();\n```\n';
  const svg = toSvg(sheetOf('Title a b 1 2 one two const x = 1; indented();'), { markdown: md, media: 'text/markdown' });
  const back = readDataMarkdown(svg);
  assert.equal(back.media, 'text/markdown');
  assert.equal(back.markdown, md, 'byte-exact source, with its line breaks and structure');
});
