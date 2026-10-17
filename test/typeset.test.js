import { test } from 'node:test';
import assert from 'node:assert/strict';
import { typesetWith, plainText, isFaithful, justify, lorem, normalizeText } from '../src/index.js';
import { fakeMetric, image, TEXT } from './helpers.js';

const halves = image(200, 200, (x) => (x < 100 ? [0, 0, 0] : [255, 255, 255])); // left black, right white
const run = (options = {}, text = TEXT.repeat(6), img = halves) =>
  typesetWith({ text, metric: fakeMetric, image: img, options: { width: 400, ...options } });

test('keeps every character in order (fidelity)', () => {
  const sheet = run();
  assert.equal(plainText(sheet), normalizeText(TEXT.repeat(6)));
  assert.ok(isFaithful(sheet));
});

test('fills the block without overflowing it', () => {
  const sheet = run();
  const { result, W, H } = sheet;
  assert.equal(result.overflow, false);
  assert.ok(result.lines.length * result.L <= H + 1e-6);
  for (const [i, ln] of result.lines.entries()) {
    const { lastInner } = justify(ln, i === result.lines.length - 1, W, result.fs);
    const inner = ln.items.slice(0, lastInner + 1).reduce((a, it) => a + it.adv, 0);
    assert.ok(inner <= W + 0.5, `line ${i} is ${inner} px wide, block is ${W}`);
  }
});

test('dark image areas get more ink than light ones', () => {
  const { result, W } = run();
  let left = 0, nl = 0, right = 0, nr = 0;
  for (const ln of result.lines) for (const it of ln.items) {
    if (it.ch === ' ') continue;
    if (it.x + it.adv < W * 0.4) { left += it.eff; nl++; } else if (it.x > W * 0.6) { right += it.eff; nr++; }
  }
  assert.ok(left / nl > 2 * (right / nr), `left ${left / nl} vs right ${right / nr}`);
});

test('dark paper inverts the relation', () => {
  const { result, W } = run({ paper: 'dark' });
  let left = 0, nl = 0, right = 0, nr = 0;
  for (const ln of result.lines) for (const it of ln.items) {
    if (it.ch === ' ') continue;
    if (it.x + it.adv < W * 0.4) { left += it.eff; nl++; } else if (it.x > W * 0.6) { right += it.eff; nr++; }
  }
  assert.ok(right / nr > 2 * (left / nl));
});

test('word mode gives every glyph of a word the same style', () => {
  const { result } = run({ unit: 'word' });
  for (const ln of result.lines) {
    let word = [];
    for (const it of [...ln.items, { ch: ' ' }]) {
      if (it.ch === ' ') {
        if (word.length) assert.equal(new Set(word.map((w) => `${w.wi}|${w.s}`)).size, 1);
        word = [];
      } else word.push(it);
    }
  }
});

test('a text too long for the block grows the sheet instead of dropping characters', () => {
  const sheet = run({ width: 120 }, lorem(20000, 3), image(10, 2, () => [128, 128, 128]));
  assert.equal(sheet.result.overflow, true);
  assert.ok(isFaithful(sheet));
});

test('a word longer than a line is broken between characters, nothing is lost', () => {
  const long = 'Donaudampfschifffahrtselektrizitätenhauptbetriebswerkbauunterbeamtengesellschaft';
  const sheet = run({ width: 200 }, `${long} ${long}`);
  assert.ok(isFaithful(sheet));
});

test('rejects empty text', () => {
  assert.throws(() => run({}, '   '), /empty/);
});

test('fit always returns a layout with lines, also after rounding the line height', async () => {
  const { fit, tokenize, candidates, buildLuts, LEGIBILITY, REF_RATIO } = await import('../src/index.js');
  const level = LEGIBILITY.free, cands = candidates(level, false, [{ wd: 1, st: 1 }]);
  for (const n of [300, 2000, 9000]) {
    const text = lorem(n, n), luts = buildLuts(new Set(text), cands, fakeMetric, 1, level.sizes);
    const ctx = { W: 333, H: 517, dark: (x0) => (x0 % 50) / 50, tone: (d) => 0.05 + d * 0.3, cands, luts, metric: fakeMetric, covScale: 1,
      lineRatio: REF_RATIO, sizeCount: level.sizes.length, wordMode: false, wordAvg: new Map(), normalWidth: 1, shape: true };
    const r = fit(tokenize(text), ctx);
    assert.ok(Array.isArray(r.lines) && r.lines.length > 0, `no lines for ${n} characters`);
    assert.equal(r.L * 64, Math.round(r.L * 64));
  }
});
