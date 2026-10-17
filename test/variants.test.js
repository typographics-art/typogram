import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  typesetWith, isFaithful, candidates, buildLuts, layoutAt, LEGIBILITY, REF_RATIO, toHtml, toSvg, normalizeText,
} from '../src/index.js';
import { fakeMetric, image, TEXT } from './helpers.js';

const halves = image(200, 200, (x) => (x < 100 ? [0, 0, 0] : [255, 255, 255]));
const run = (options) => typesetWith({ text: TEXT.repeat(6), metric: fakeMetric, image: halves, options: { width: 400, ...options } });

test('stretch on: width variants are used, and only on fonts that have a width axis', () => {
  const used = new Set(run({ stretch: true }).result.lines.flatMap((l) => l.items.map((it) => it.wd)));
  assert.ok(used.size > 1, `only width index ${[...used]} used`);
  const off = new Set(run({ stretch: false }).result.lines.flatMap((l) => l.items.map((it) => it.wd)));
  assert.deepEqual([...off], [1], 'stretch off must stay at the normal width (index 1 for Roboto Flex)');
  const mono = new Set(run({ stretch: true, font: 'mono' }).result.lines.flatMap((l) => l.items.map((it) => it.wd)));
  assert.deepEqual([...mono], [0]);
});

test('stretch keeps fidelity and is written to HTML and SVG as a width variation', () => {
  const s = run({ stretch: true });
  assert.ok(isFaithful(s));
  assert.match(toHtml(s), /'wdth' (75|125)/);
  const svg = toSvg(s);
  assert.match(svg, /'wdth' (75|125)/);
  const inner = svg.slice(svg.indexOf('<text'), svg.lastIndexOf('</text>')).replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  assert.equal(normalizeText(inner), s.text);
});

test('shape: a glyph on an edge takes the tone of the half where its ink is', () => {
  const metric = (ch) => ({ ...fakeMetric(ch), prof: new Float32Array([0.9, 0.1, 0.5, 0.5]) });
  const adv = metric('b').adv[14]; // normal width, middle weight, at reference size
  // Image: dark exactly under the left half of the glyph's cell, light elsewhere.
  const dark = (x0, y0, x1, y1) => Math.max(0, Math.min(x1, adv / 2) - x0) / (x1 - x0);
  const level = LEGIBILITY.medium, cands = candidates(level, false, [{ wd: 1, st: 1 }]);
  const ctx = (shape) => ({
    W: 400, H: 100, dark, tone: (d) => d, cands, metric, covScale: 1,
    luts: buildLuts(new Set('b'), cands, metric, 1, level.sizes), lineRatio: REF_RATIO,
    sizeCount: level.sizes.length, wordMode: false, wordAvg: new Map(), normalWidth: 1, shape,
  });
  const L = 40 / REF_RATIO; // glyphs at reference size, so the cell is exactly `adv` wide
  const flat = layoutAt(['b'], L, ctx(false)).lines[0].items[0].base;
  const sharp = layoutAt(['b'], L, ctx(true)).lines[0].items[0].base;
  assert.ok(Math.abs(flat - 0.5) < 0.05, `flat target ${flat}`);
  assert.ok(sharp > 0.85, `shape-aware target ${sharp}`);
});
