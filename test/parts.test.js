import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lorem, inkFor, buildToneMap, toHtml, toSvg, typesetWith, normalizeText, tokenize } from '../src/index.js';
import { fakeMetric, image, TEXT } from './helpers.js';

test('lorem: exact upper bound, deterministic, starts with the classic sentence', () => {
  for (const n of [60, 500, 12345]) {
    const t = lorem(n, 7);
    assert.ok(t.length <= n, `${t.length} > ${n}`);
    assert.ok(t.length > n - 20);
    assert.ok(t.endsWith('.'));
  }
  assert.equal(lorem(800, 5), lorem(800, 5));
  assert.notEqual(lorem(800, 5), lorem(800, 6));
  assert.ok(lorem(300).startsWith('Lorem ipsum dolor sit amet, consectetur adipiscing elit.'));
});

test('tokenize round-trips the normalised text', () => {
  const t = '  Hello\n\nworld,\tthis  is   text ';
  assert.equal(tokenize(t).join(''), normalizeText(t));
  assert.equal(normalizeText(t), 'Hello world, this is text');
});

test('inkFor: ink plus paper averages to the target where the gamut allows it', () => {
  const paper = [251, 251, 248], target = [180, 170, 160], cov = 0.5; // reachable: ink = paper + (target - paper) / 0.5
  const ink = inkFor(target, cov, paper, 1, false);
  const mixed = ink.map((v, i) => cov * v + (1 - cov) * paper[i]);
  mixed.forEach((v, i) => assert.ok(Math.abs(v - target[i]) <= 4, `${v} vs ${target[i]}`));
});

test('inkFor: keeps the hue when the gamut is exceeded (dark paper, light blue sky)', () => {
  const ink = inkFor([200, 225, 245], 0.3, [17, 18, 22], 1, true);
  assert.ok(ink[2] > ink[1] && ink[1] > ink[0], `blue must stay dominant: ${ink}`);
  assert.ok(ink[0] < 250, 'must not collapse to white');
});

test('inkFor: legibility cap keeps ink away from light paper', () => {
  const ink = inkFor([250, 250, 247], 0.2, [251, 251, 248], 0.55, false);
  const lum = (0.2126 * ink[0] + 0.7152 * ink[1] + 0.0722 * ink[2]) / 255;
  assert.ok(lum <= 0.56);
});

test('tone map: area means and contrast', () => {
  const img = image(100, 50, (x) => (x < 50 ? [0, 0, 0] : [255, 255, 255]));
  const m = buildToneMap(img, 200, 100, {});
  assert.ok(Math.abs(m.dark(0, 0, 100, 100) - 1) < 1e-9);
  assert.ok(Math.abs(m.dark(100, 0, 200, 100)) < 1e-9);
  assert.ok(Math.abs(m.dark(0, 0, 200, 100) - 0.5) < 1e-9);
  assert.deepEqual(m.rgb(150, 10, 190, 90), [255, 255, 255]);
  const inv = buildToneMap(img, 200, 100, { brightIsInk: true });
  assert.ok(Math.abs(inv.dark(100, 0, 200, 100) - 1) < 1e-9);
});

function sheet(options) {
  const img = image(80, 80, (x, y) => [x * 3, y * 3, 120]);
  return typesetWith({ text: TEXT + ' <b>&"</b>', metric: fakeMetric, image: img, options: { width: 300, ...options } });
}
const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

test('HTML output contains the text as characters, markup in the text is escaped', () => {
  const s = sheet({ color: 'photo' });
  const html = toHtml(s);
  assert.ok(!html.includes('<b>'), 'raw markup from the text must not leak into HTML');
  assert.equal(normalizeText(unescape(html.replace(/<[^>]+>/g, ''))), s.text);
});

test('SVG output contains the text as characters', () => {
  const s = sheet({ color: 'gray' });
  const svg = toSvg(s);
  const inner = svg.slice(svg.indexOf('<text'), svg.lastIndexOf('</text>'));
  assert.equal(normalizeText(unescape(inner.replace(/<[^>]+>/g, ''))), s.text);
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
});

test('outputs switch off ligatures and kerning, so every glyph stays its own character', async () => {
  const { toStandaloneHtml, GLYPH_CSS } = await import('../src/index.js');
  const s = sheet({ color: 'mono' });
  assert.ok(toStandaloneHtml(s).includes('font-variant-ligatures:none'));
  assert.ok(toSvg(s).includes('font-variant-ligatures:none'));
  assert.match(GLYPH_CSS, /"liga" 0/);
});

test('a letter with combining accents, and an emoji sequence, are set as one glyph', async () => {
  const { graphemes, typesetWith: ts } = await import('../src/index.js');
  const zalgo = 'z̯̯͡a̧͎', family = '👩‍👩‍👧', text = `before ${zalgo} and ${family} after`;
  assert.deepEqual(graphemes(zalgo), ['z̯̯͡', 'a̧͎']);
  assert.equal(graphemes(family).length, 1);
  const s = ts({ text, metric: fakeMetric, image: image(40, 40, () => [90, 90, 90]), options: { width: 300 } });
  const items = s.result.lines.flatMap((l) => l.items);
  assert.ok(items.some((it) => it.ch === 'z̯̯͡'), 'base letter and its marks stay together');
  assert.ok(items.some((it) => it.ch === family), 'emoji sequence stays one glyph');
  assert.ok(items.every((it) => !/^\p{M}/u.test(it.ch)), 'no glyph starts with a combining mark');
  const svg = toSvg(s), inner = svg.slice(svg.indexOf('<text'), svg.lastIndexOf('</text>')).replace(/<[^>]+>/g, '');
  assert.equal(normalizeText(inner), normalizeText(text));
});

test('pdfStats counts fonts per weight, width and size; estimatePdfBytes grows with them', async () => {
  const { pdfStats, estimatePdfBytes } = await import('../src/index.js');
  const img = image(80, 80, (x, y) => [(x * 3) % 256, (y * 3) % 256, 128]);
  const many = typesetWith({ text: TEXT.repeat(8), metric: fakeMetric, image: img, options: { legibility: 'free', color: 'photo', width: 300 } });
  const few = typesetWith({ text: TEXT.repeat(8), metric: fakeMetric, image: img, options: { legibility: 'free', color: 'photo', width: 300, weightCount: 1, sizeCount: 1, stretch: false } });
  const a = pdfStats(many), b = pdfStats(few);
  assert.equal(b.fonts, 1);
  assert.ok(a.fonts > b.fonts && a.outlines > b.outlines);
  assert.equal(a.glyphs, TEXT.repeat(8).replace(/\s/g, '').length);
  assert.ok(estimatePdfBytes(a) > estimatePdfBytes(b));
  assert.ok(estimatePdfBytes(a, { optimized: true }) < estimatePdfBytes(a));
});
