// Short texts are set only where the picture is dark and the rest of the page is blank (options.gaps).
// The blank is layout, not text: these tests lock that no character is added, lost or moved by it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { typesetWith, plainText, isFaithful, justify, normalizeText, toHtml, toSvg, forEachGlyph } from '../src/index.js';
import { canonicalText } from '../src/secret.js';
import { SPARSE_LINES } from '../src/layout.js';
import { fakeMetric, image, TEXT } from './helpers.js';

// A dark bar in the middle third of a white page: the "title".
const bar = image(300, 300, (x, y) => (y > 100 && y < 200 && x > 40 && x < 260 ? [0, 0, 0] : [255, 255, 255]));
const white = image(300, 300, () => [255, 255, 255]);
const run = (text, options = {}, img = bar) =>
  typesetWith({ text, metric: fakeMetric, image: img, options: { width: 400, gaps: 'on', color: 'gray', ...options } });
const items = (sheet) => sheet.result.lines.flatMap((ln) => ln.items);
const SHORT = TEXT.repeat(2);

/** Text content of the HTML / SVG the sheet serialises to, tags removed and entities resolved. */
const stripTags = (s) => s.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

test('gaps: the set text is the source text, character for character', () => {
  const sheet = run(SHORT);
  assert.ok(sheet.result.lines.some((ln) => ln.mask), 'the masked layout was used');
  assert.equal(plainText(sheet), normalizeText(SHORT));
  assert.ok(isFaithful(sheet));
  assert.equal(canonicalText(plainText(sheet)), canonicalText(SHORT));
});

test('gaps: HTML and SVG read back to the same canonical text', () => {
  const sheet = run(SHORT);
  assert.equal(canonicalText(stripTags(toHtml(sheet))), canonicalText(SHORT));
  assert.equal(canonicalText(stripTags(toSvg(sheet).replace(/<style>.*?<\/style>/, ''))), canonicalText(SHORT));
});

test('gaps: glyphs stand only on dark parts of the picture, the rest of the page is blank', () => {
  const sheet = run(SHORT);
  const { L } = sheet.result, ink = (y) => y >= 100 / 300 * sheet.H - L && y <= 200 / 300 * sheet.H + L;
  sheet.result.lines.forEach((ln, i) => {
    if (ln.items.some((it) => it.ch !== ' ')) assert.ok(ink(i * L) || ink((i + 1) * L), `line ${i} carries text outside the bar`);
  });
  const glyphs = items(sheet).filter((it) => it.ch !== ' ');
  assert.ok(glyphs.every((it) => it.x >= (40 / 300) * sheet.W - 2 * sheet.result.fs));
});

test('gaps: only spaces grow, lines are not justified, indents are layout', () => {
  const sheet = run(SHORT);
  let extras = 0, indents = 0;
  sheet.result.lines.forEach((ln, i) => {
    assert.equal(justify(ln, i === sheet.result.lines.length - 1, sheet.W, sheet.result.fs).ws, 0);
    if (ln.indent) indents++;
    for (const it of ln.items) {
      if (it.extra) { extras++; assert.equal(it.ch, ' ', 'only a space may take extra width'); }
    }
  });
  assert.ok(indents > 0, 'lines start at the picture, not at the margin');
  assert.ok(extras > 0, 'gaps between words are carried by spaces');
});

test('gaps: rendering positions match the layout (SVG x of every glyph is inside the line)', () => {
  const sheet = run(SHORT);
  forEachGlyph(sheet, (it, x) => {
    assert.ok(x >= sheet.pad - 0.01 && x <= sheet.pad + sheet.W + sheet.result.fs, `glyph at ${x}`);
  });
  assert.match(toHtml(sheet), /text-indent:/);
  assert.match(toHtml(sheet), /word-spacing:[\d.]+px/);
});

test('gaps: edge cases keep the text exactly (one word, one character, marks and emoji, tabs and newlines, a huge word)', () => {
  const cases = {
    'one character': 'x',
    'one word': 'Typographics',
    'combining marks': 'Café naïve à مرحبا नमस्ते '.repeat(20),
    emoji: 'Hi 👨‍👩‍👧 there 🇨🇭 flag ❤️ '.repeat(20),
    'tabs and newlines': 'one\ttwo\n\nthree \t four\r\nfive   six '.repeat(15),
    'a word wider than the page': 'A' + 'wide'.repeat(200) + 'Z end of it',
    'a word wider than the ink': `${'m'.repeat(60)} tiny words after ${'w'.repeat(45)} and more`,
  };
  for (const [name, text] of Object.entries(cases)) {
    for (const img of [bar, white]) {
      const sheet = run(text, {}, img);
      assert.equal(canonicalText(plainText(sheet)), canonicalText(text), name);
      assert.equal(normalizeText(plainText(sheet)), normalizeText(text), name);
      assert.equal(canonicalText(stripTags(toHtml(sheet))), canonicalText(text), `${name} (HTML)`);
    }
  }
});

test('gaps: no character is added or removed (multiset of glyphs equals the source)', () => {
  const text = 'Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau';
  const sheet = run(text);
  const count = (s) => [...s].reduce((m, c) => m.set(c, (m.get(c) || 0) + 1), new Map());
  assert.deepEqual(count(plainText(sheet)), count(normalizeText(text)));
});

test('gaps: with no dark area the masked layout cannot hold the text and the plain layout is kept', () => {
  const sheet = run(SHORT, {}, white);
  assert.ok(!sheet.result.lines.some((ln) => ln.mask));
  assert.ok(isFaithful(sheet));
});

test("gaps 'auto': short texts use gaps, long ones and the default do not", () => {
  const short = run(SHORT, { gaps: 'auto' });
  assert.ok(short.result.lines.some((ln) => ln.mask));
  const long = run(TEXT.repeat(400), { gaps: 'auto' });
  assert.ok(long.result.lines.length > SPARSE_LINES);
  assert.ok(!long.result.lines.some((ln) => ln.mask), 'a long text keeps the plain layout');
  const off = run(SHORT, { gaps: 'off' });
  assert.ok(!off.result.lines.some((ln) => ln.mask));
  const dflt = typesetWith({ text: SHORT, metric: fakeMetric, image: bar, options: { width: 400 } });
  assert.ok(!dflt.result.lines.some((ln) => ln.mask), "the library default is 'off'");
});

test('gaps: the picture is followed better than without (more ink in the bar, less outside it)', () => {
  const on = run(TEXT.repeat(3)), off = run(TEXT.repeat(3), { gaps: 'off' });
  const share = (sheet) => {
    const { L } = sheet.result;
    let inside = 0, all = 0;
    sheet.result.lines.forEach((ln, i) => {
      const y = (i + 0.5) * L, e = ln.items.reduce((a, it) => a + it.eff, 0);
      all += e; if (y > (100 / 300) * sheet.H && y < (200 / 300) * sheet.H) inside += e;
    });
    return inside / all;
  };
  assert.ok(share(on) > share(off) + 0.1, `${share(on)} vs ${share(off)}`);
});
