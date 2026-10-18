// Two layout edge cases found with real data: (1) a long unbroken token on a short text (gap layout) ran past the
// page edge and its tail was lost from the PDF text layer; (2) the set of units measured was not the set laid out
// (a space plus a combining mark is ONE grapheme cluster), so Thai and similar scripts crashed with "reading 'adv'".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { typesetWith, plainText, isFaithful, normalizeText } from '../src/index.js';
import { graphemes, tokenize } from '../src/layout.js';
import { findChrome, openSession } from '../cli/core.mjs';
import { makeOnePage } from '../cli/onepage-core.mjs';
import { fakeMetric, image } from './helpers.js';

const gray = image(300, 300, () => [128, 128, 128]);
const bar = image(300, 300, (x, y) => (y > 100 && y < 200 && x > 40 && x < 260 ? [0, 0, 0] : [255, 255, 255]));
// ink only in the right half: every line is entered by a large indent
const right = image(300, 300, (x, y) => (y > 20 && y < 280 && x > 150 ? [0, 0, 0] : [255, 255, 255]));

/** Metric that, like the browser's, knows exactly the grapheme clusters of the source and nothing else. */
const strictMetric = (text) => {
  const known = new Set(graphemes(normalizeText(text)));
  return (c) => {
    if (!known.has(c)) throw new Error(`unit ${JSON.stringify(c)} was laid out but not measured`);
    return fakeMetric(c);
  };
};

const SCRIPTS = {
  thai: 'สวัสดีครับ ผมชื่อสมชาย ยินดีที่ได้รู้จัก ทำ ำ น ำ',
  'emoji modifiers, ZWJ, flags': 'ok 👍🏽 family 👨‍👩‍👧 swiss 🇨🇭🇩🇪 done',
  arabic: 'مرحبا بالعالم كيف حالك اليوم',
  devanagari: 'नमस्ते दुनिया ङ्क्ष कि क्षि',
  'space before a combining mark': 'x ́y a  ́b ́',
};

test('tokenize: cuts along grapheme clusters and joins back to the normalised text', () => {
  for (const [name, text] of Object.entries(SCRIPTS)) {
    const toks = tokenize(text);
    assert.equal(toks.join(''), normalizeText(text), name);
    assert.deepEqual(toks.flatMap(graphemes), graphemes(normalizeText(text)), `${name}: same units as the metrics`);
    for (const t of toks) assert.ok(t === ' ' || !t.startsWith(' '), `${name}: a word never starts with a bare space`);
  }
  assert.deepEqual(tokenize('a ำb c'), ['a ำb', ' ', 'c']); // the cluster " ำ" is not a space
});

test('layout: every laid-out unit was measured, every character is kept in order (all scripts, both units, gaps on and off)', () => {
  for (const [name, text] of Object.entries(SCRIPTS)) {
    for (const unit of ['char', 'word']) {
      for (const gaps of ['off', 'on']) {
        const sheet = typesetWith({ text, metric: strictMetric(text), image: bar, options: { width: 300, unit, gaps, color: 'gray' } });
        assert.ok(isFaithful(sheet), `${name}/${unit}/${gaps}`);
        assert.equal(plainText(sheet), normalizeText(text), `${name}/${unit}/${gaps}: text preserved`);
      }
    }
  }
});

test('layout: a space followed by a mark stays one unit and is not taken for a gap', () => {
  const text = 'ab ำcd ef';
  const sheet = typesetWith({ text, metric: strictMetric(text), image: gray, options: { width: 300 } });
  const chs = sheet.result.lines.flatMap((ln) => ln.items.map((it) => it.ch));
  assert.ok(chs.includes(' ำ'));
  assert.equal(plainText(sheet), text);
});

/** The right edge of the last glyph of every line, indent included, must stay inside the layout width. */
const overhang = (sheet) => Math.max(...sheet.result.lines.map((ln) => {
  let inner = ln.w, j = ln.items.length - 1;
  while (j >= 0 && ln.items[j].ch === ' ') { inner -= ln.items[j].adv; j--; }
  return (ln.indent || 0) + inner - sheet.W;
}));

test('gaps: a word longer than a line is broken inside the room behind the indent, never past the page edge', () => {
  const URL = 'https://example.com/' + 'a1b2c3d4e5/'.repeat(20);
  const B64 = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo'.repeat(8);
  for (const [name, img] of [['bar', bar], ['right half', right]]) {
    for (const text of [`Please read ${URL} before the meeting, thanks.`, `Attached: ${B64} end`, URL, `Short ${URL.slice(0, 60)} x`]) {
      const sheet = typesetWith({ text, metric: fakeMetric, image: img, options: { width: 400, gaps: 'on', color: 'gray' } });
      // (the right-half picture leaves too little room for the two long prose cases: they fall back to the plain layout)
      const gapLayout = sheet.result.lines.some((ln) => ln.mask);
      if (img === bar || text === URL || text.startsWith('Short')) assert.ok(gapLayout, `${name}: gap layout in use`);
      assert.ok(overhang(sheet) <= 0.5, `${name}: a line runs ${overhang(sheet).toFixed(1)} px past the layout width`);
      assert.equal(plainText(sheet), normalizeText(text), `${name}: text preserved`);
    }
  }
});

test('gaps: auto mode on a short structured block (long tokens without spaces) stays inside the page', () => {
  const block = 'TGD1[{"read":"TGD·1:·JSON,·each·middle·dot·stands·for·one·space","lossy":["types:·every·cell·is·text","quoting·style:·fields·are·quoted·only·where·needed","an·empty·quoted·field·(\\"\\")·and·an·empty·field·are·the·same"]}]';
  for (const img of [bar, right]) {
    const sheet = typesetWith({ text: block, metric: fakeMetric, image: img, options: { width: 500, gaps: 'auto', color: 'gray' } });
    assert.ok(overhang(sheet) <= 0.5);
    assert.ok(isFaithful(sheet));
  }
});

// ---- end to end through Chrome and MuPDF ------------------------------------------------------------------------
async function throughPdf(t, text, options = {}) {
  if (!findChrome()) return t.skip('Chrome/Chromium not found (set CHROME_PATH)');
  if (spawnSync('which', ['mutool']).status !== 0) return t.skip('MuPDF (mutool) not found');
  const pdf = join(mkdtempSync(join(tmpdir(), 'tg-edge-')), 'page.pdf');
  const session = await openSession();
  let r;
  try { r = await makeOnePage(session, { text, title: 'Edge', paper: 'a4', options, pdf }); } finally { await session.close(); }
  assert.ok(existsSync(pdf));
  return r;
}

test('end to end: a short block with very long tokens prints and reads back from the PDF (gap layout)', async (t) => {
  const rows = Array.from({ length: 30 }, (_, i) => `"${i}":["n${i * 7}","c${i * 3}"]`).join(',');
  const block = 'TGD1[{"read":"TGD·1:·JSON,·each·middle·dot·stands·for·one·space","lossy":["types:·every·cell·is·text","quoting·style:·fields·are·quoted·only·where·needed","an·empty·quoted·field·(\\"\\")·and·an·empty·field·are·the·same"],"rows":{' + rows + '}}]';
  const url = 'See https://example.com/' + 'a1b2c3d4e5/'.repeat(18) + ' for the report.';
  for (const text of [block, url]) {
    const r = await throughPdf(t, text);
    if (!r) return;
    assert.equal(r.check.visibleIdentical, true);
    assert.equal(r.check.pages, 1);
  }
});

test('end to end: Thai, emoji with modifiers, Arabic and Devanagari are set, printed and read back', async (t) => {
  const text = Object.values(SCRIPTS).join(' ');
  const r = await throughPdf(t, text);
  if (!r) return;
  assert.equal(r.check.visibleIdentical, true);
});
