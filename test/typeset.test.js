import { test } from 'node:test';
import assert from 'node:assert/strict';
import { typesetWith, plainText, isFaithful, justify, lorem, normalizeText, LEGIBILITY } from '../src/index.js';
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

test('a short text is never broken inside an ordinary word: the size is reduced instead (a long token still breaks)', async () => {
  const { ORDINARY_WORD } = await import('../src/layout.js');
  const text = 'Our September orders, in plain words.';
  const sheet = run({ width: 400 }, text, image(10, 13, () => [128, 128, 128]));
  const lines = sheet.result.lines.map((ln) => ln.items.map((it) => it.ch).join(''));
  assert.equal(normalizeText(lines.join(' ')), normalizeText(text), `a line boundary fell inside a word: ${JSON.stringify(lines)}`);
  assert.ok(lines.length >= 2, 'the short text still spans several lines');
  const token = 'x'.repeat(ORDINARY_WORD + 1);
  const long = run({ width: 200 }, `${token} ${token}`);
  assert.ok(isFaithful(long));
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

test('repeated letters stay far enough apart for PDF extractors (no "fake bold" drop)', async () => {
  const { REPEAT_GAP } = await import('../src/layout.js');
  const narrow = (ch) => {
    const m = fakeMetric(ch);
    if (ch === 'l') m.adv = m.adv.map((a) => (a / 0.55) * 0.06);
    return m;
  };
  const text = Array.from({ length: 400 }, (_, i) => (i % 3 ? 'hallo' : 'llll')).join(' ');
  const img = image(120, 120, (x, y) => ((x >> 2) + (y >> 2)) % 2 ? [0, 0, 0] : [255, 255, 255]);
  const sheet = typesetWith({ text, metric: narrow, image: img, options: { legibility: 'free', color: 'gray', width: 300, sizeCount: null } }); // the rule matters with mixed sizes
  const { lines, fs } = sheet.result, minS = Math.min(...LEGIBILITY.free.sizes);
  let checked = 0;
  for (const ln of lines) for (let i = 1; i < ln.items.length; i++) {
    const a = ln.items[i - 1], b = ln.items[i];
    if (a.ch !== b.ch || b.ch === ' ') continue;
    checked++;
    if (b.s === minS) continue; // the smallest size is the fallback when nothing else fits
    assert.ok(a.adv >= REPEAT_GAP * fs * b.s - 1e-9, `"${b.ch}" at size ${b.s} only ${(a.adv / (fs * b.s)).toFixed(3)} em after the previous one`);
  }
  assert.ok(checked > 50, `too few repeated letters checked (${checked})`);
});

test('glyphs take tone and colour where they are drawn, after justification', async () => {
  const { forEachGlyph } = await import('../src/index.js');
  const words = Array.from({ length: 900 }, (_, i) => ['typographic', 'art', 'is', 'text', 'set', 'as', 'a', 'picture'][i % 8]).join(' ');
  const img = image(160, 200, (x, y) => (x < 80 ? [20, 20, 20] : [230, 230, 230]));
  const sheet = typesetWith({ text: words, metric: fakeMetric, image: img, options: { legibility: 'free', color: 'gray', width: 400 } });
  const { fs } = sheet.result;
  let worst = 0, n = 0;
  forEachGlyph(sheet, (it, x, y, i) => {
    if (it.ch === ' ' || i === sheet.result.lines.length - 1) return;
    worst = Math.max(worst, Math.abs(x - sheet.pad - it.x)); n++;
  });
  assert.ok(n > 1000);
  assert.ok(worst < 0.5 * fs, `a glyph is drawn ${worst.toFixed(1)} px (${(worst / fs).toFixed(2)} em) away from where its tone was taken`);
});
