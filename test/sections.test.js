import { test } from 'node:test';
import assert from 'node:assert/strict';
import { typesetSections, isFaithful, plainText, normalizeText, cropToAspect, toSvg, lorem } from '../src/index.js';
import { fakeMetric, image } from './helpers.js';

const black = image(120, 80, () => [0, 0, 0]);
const white = image(80, 120, () => [255, 255, 255]);
const texts = [lorem(2500, 1), lorem(1200, 2), lorem(2500, 3)];
const run = (options = {}) => typesetSections({
  sections: [{ text: texts[0], image: black, title: 'I' }, { text: texts[1], image: white, title: 'II' }, { text: texts[2], image: black, title: 'III' }],
  metric: fakeMetric, options: { width: 500, aspect: 1.4, ...options },
});

test('sections: whole text preserved in order, with the space between panels', () => {
  const s = run();
  assert.ok(isFaithful(s));
  assert.equal(normalizeText(plainText(s)), texts.map(normalizeText).join(' '));
  const svg = toSvg(s);
  const inner = svg.slice(svg.indexOf('<text'), svg.lastIndexOf('</text>')).replace(/<[^>]+>/g, '');
  assert.equal(normalizeText(inner), s.text);
});

test('sections: one type size everywhere, panels fill the sheet without overflow or gaps', () => {
  const s = run();
  const sizes = new Set(s.result.lines.flatMap((l) => l.items.filter((it) => it.ch !== ' ').map(() => s.result.fs)));
  assert.equal(sizes.size, 1);
  assert.equal(s.sections.length, 3);
  const totalLines = s.sections.reduce((a, p) => a + p.lineCount, 0);
  assert.equal(totalLines, s.result.lines.length);
  const target = 500 * 1.4;
  assert.ok(s.H <= target + 0.5, `sheet ${s.H} > ${target}`);
  assert.ok(target - s.H < s.result.L * 3, `gap of ${target - s.H}px`);
  // panel heights follow text length: the short middle text gets the smallest panel
  assert.ok(s.sections[1].height < s.sections[0].height && s.sections[1].height < s.sections[2].height);
});

test('sections: each panel follows its own image', () => {
  const s = run();
  const mean = (p) => {
    const its = s.result.lines.slice(p.firstLine, p.firstLine + p.lineCount).flatMap((l) => l.items).filter((it) => it.ch !== ' ');
    return its.reduce((a, it) => a + it.eff, 0) / its.length;
  };
  const [a, b, c] = s.sections.map(mean);
  assert.ok(a > 2 * b && c > 2 * b, `black ${a.toFixed(3)} / white ${b.toFixed(3)} / black ${c.toFixed(3)}`);
});

test('cropToAspect: centre crop with exact size', () => {
  const img = image(100, 50, (x) => [x, 0, 0]);
  const c = cropToAspect(img, 1);
  assert.equal(c.width, 50); assert.equal(c.height, 50);
  assert.equal(c.data[0], 25); // first column of the crop is column 25 of the source
  const t = cropToAspect(img, 0.25);
  assert.equal(t.width, 100); assert.equal(t.height, 25);
});

test('sections: aspect is required', () => {
  assert.throws(() => typesetSections({ sections: [{ text: 'a b', image: black }], metric: fakeMetric, options: {} }), /aspect/);
});

test('SVG in parts concatenates to exactly the same document as toSvg', async () => {
  const { svgHead, svgLines, SVG_TAIL } = await import('../src/index.js');
  const s = run();
  const n = s.result.lines.length, mid = Math.floor(n / 3);
  const parts = svgHead(s) + svgLines(s, 0, mid) + svgLines(s, mid, n) + SVG_TAIL;
  const strip = (x) => normalizeText(x.slice(x.indexOf('<text'), x.lastIndexOf('</text>')).replace(/<[^>]+>/g, ''));
  assert.equal(strip(parts), strip(toSvg(s)));
  assert.equal(strip(parts), s.text);
});

test('line heights are exact multiples of 1/64 px, so browsers place every line without drift', () => {
  const s = run();
  assert.equal(s.result.L * 64, Math.round(s.result.L * 64));
});
