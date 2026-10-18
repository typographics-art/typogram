// Auto-levels, the dynamic-range measure and the paper choice by key (src/tone.js, src/layout.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildToneMap, levelsOf, stretchLevels, meanLuminance, paperFor, DARK_KEY, DEFAULTS, PAPERS,
  typesetWith, isFaithful, plainText, normalizeText, dynamicRange,
} from '../src/index.js';
import { fakeMetric, image, TEXT } from './helpers.js';

test('autoLevels is off at the library level', () => {
  assert.equal(DEFAULTS.autoLevels, false);
});

test('levelsOf: percentile bounds; clip 0 gives the minimum and maximum', () => {
  const v = Float32Array.from({ length: 1000 }, (_, i) => 0.2 + 0.5 * (i / 999)); // uniform 0.2..0.7
  const [lo0, hi0] = levelsOf(v, 0);
  assert.ok(Math.abs(lo0 - 0.2) < 2 / 1024 && Math.abs(hi0 - 0.7) < 2 / 1024, `${lo0} .. ${hi0}`);
  const [lo, hi] = levelsOf(v, 0.1);
  assert.ok(lo > 0.24 && lo < 0.26 && hi > 0.64 && hi < 0.66, `${lo} .. ${hi}`);
  assert.deepEqual(levelsOf(new Float32Array(0)), [0, 1]);
  const [a, b] = levelsOf(new Float32Array(50).fill(0.5)); // a flat picture never gives an empty range
  assert.ok(b > a);
});

test('buildToneMap autoLevels: a flat, low-contrast picture is stretched over the whole scale', () => {
  // luminance 0.55 at the top down to 0.35 at the bottom: ink demand 0.45..0.65 without levels
  const img = image(40, 100, (x, y) => { const v = Math.round(255 * (0.55 - 0.2 * (y / 99))); return [v, v, v]; });
  const plain = buildToneMap(img, 40, 100, {});
  const levelled = buildToneMap(img, 40, 100, { autoLevels: true });
  const top = (m) => m.dark(0, 0, 40, 5), bottom = (m) => m.dark(0, 95, 40, 100);
  assert.ok(bottom(plain) - top(plain) < 0.25, `plain spans ${top(plain)} .. ${bottom(plain)}`);
  assert.ok(top(levelled) < 0.06 && bottom(levelled) > 0.94, `levelled spans ${top(levelled)} .. ${bottom(levelled)}`);
});

test('stretchLevels: pure; the copy spans 0..255 and the original is untouched', () => {
  const img = image(20, 20, (x) => { const v = 100 + Math.round(60 * (x / 19)); return [v, v, v]; });
  const before = Array.from(img.data);
  const out = stretchLevels(img, 0);
  assert.deepEqual(Array.from(img.data), before);
  assert.equal(out.width, 20); assert.equal(out.height, 20);
  const lums = []; for (let p = 0; p < out.data.length; p += 4) lums.push(out.data[p]);
  assert.ok(Math.min(...lums) <= 2 && Math.max(...lums) >= 253, `${Math.min(...lums)} .. ${Math.max(...lums)}`);
  for (let p = 3; p < out.data.length; p += 4) assert.equal(out.data[p], 255); // alpha is kept
});

test('meanLuminance and paperFor: a dark-key picture goes on dark paper', () => {
  const dark = image(10, 10, () => [40, 40, 40]), light = image(10, 10, () => [200, 200, 200]);
  assert.ok(Math.abs(meanLuminance(dark) - 40 / 255) < 1e-6);
  assert.equal(paperFor(meanLuminance(dark)), 'dark');
  assert.equal(paperFor(meanLuminance(light)), 'light');
  assert.equal(paperFor(DARK_KEY), 'light');
});

// A dark ground with a lighter oval: a dark-key portrait.
const portrait = image(200, 200, (x, y) => {
  const d = ((x - 100) / 60) ** 2 + ((y - 100) / 80) ** 2, v = d < 1 ? 150 : 30;
  return [v, v, v];
});
const run = (options = {}) => typesetWith({ text: TEXT.repeat(6), metric: fakeMetric, image: portrait, options: { width: 400, ...options } });

test('autoLevels keeps the text exact and does not narrow the tones used', () => {
  const plain = run(), levelled = run({ autoLevels: true });
  assert.ok(isFaithful(levelled));
  assert.equal(plainText(levelled), normalizeText(TEXT.repeat(6)));
  assert.ok(levelled.dynamicRange >= plain.dynamicRange, `${levelled.dynamicRange} vs ${plain.dynamicRange}`);
});

test('dynamicRange: on the sheet, 0..1, and higher on dark paper for a dark-key picture', () => {
  const light = run({ autoLevels: true }), dark = run({ autoLevels: true, paper: 'dark' });
  for (const s of [light, dark]) assert.ok(s.dynamicRange >= 0 && s.dynamicRange <= 1, String(s.dynamicRange));
  assert.equal(light.dynamicRange, dynamicRange(light.result, PAPERS.light));
  assert.ok(dark.dynamicRange > light.dynamicRange, `dark ${dark.dynamicRange} vs light ${light.dynamicRange}`);
  assert.equal(dynamicRange({ lines: [{ items: [{ ch: ' ', eff: 0 }] }] }, PAPERS.light), 0);
});
