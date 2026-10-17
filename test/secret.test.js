import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hideSecret, revealSecret } from '../src/index.js';
import { TEXT } from './helpers.js';

const PUBLIC = TEXT.repeat(3);

test('secret: hide and reveal round-trip, with random positions', async () => {
  const secret = 'meet at the harbour';
  const a = await hideSecret(PUBLIC, secret), b = await hideSecret(PUBLIC, secret);
  assert.match(a, /^tg1\./);
  assert.notEqual(a, b, 'two keys for the same secret differ');
  assert.equal(await revealSecret(PUBLIC, a), secret);
  assert.equal(await revealSecret(PUBLIC, b), secret);
});

test('secret: the text read back from a PDF works (whitespace and invisible characters ignored)', async () => {
  const key = await hideSecret(PUBLIC, 'thou art');
  const readBack = PUBLIC.replace(/ /g, '  \n').replace(/day/, 'da­y');
  assert.equal(await revealSecret(readBack, key), 'thou art');
});

test('secret: a wrong or changed work is detected, not decoded into garbage', async () => {
  const key = await hideSecret(PUBLIC, 'summer');
  await assert.rejects(revealSecret(PUBLIC.replace('lovely', 'lively'), key), /different work/);
});

test('secret: characters missing from the public text are reported', async () => {
  await assert.rejects(hideSecret(PUBLIC, 'Zürich 2026'), (e) => e.missing.includes('Z') && e.missing.includes('ü'));
});

test('secret: a damaged or foreign key is refused', async () => {
  await assert.rejects(revealSecret(PUBLIC, 'hello'), /tg1\./);
  await assert.rejects(revealSecret(PUBLIC, 'tg1.AAAA'), /damaged/);
});

test('secret: stacked combining marks in another order still fit (PDF readers differ, NFC)', async () => {
  const text = PUBLIC + ' café á̧';
  const key = await hideSecret(text, 'é');
  assert.equal(await revealSecret(text.normalize('NFD'), key), 'é');
});

test('work text: SVG, HTML and pdf.js items give the work\'s public text', async () => {
  const { markupText, pdfItemsText, canonicalText } = await import('../src/index.js');
  const svg = '<svg><style>@import url(x)</style><rect/><text><tspan x="1" y="2">Fish &amp; </tspan><tspan x="1" y="9">chips &lt;3</tspan></text></svg>';
  assert.equal(markupText(svg, 'svg'), 'Fish & chips <3');
  const html = '<link rel="stylesheet" href="x"><style>a{}</style><div><div><span>caf&#233; </span></div><div><span>au lait</span></div></div>';
  assert.equal(markupText(html, 'html'), 'café au lait');
  const item = (str, y, hasEOL = false) => ({ str, hasEOL, transform: [10, 0, 0, 10, 0, y] });
  assert.equal(canonicalText(pdfItemsText([[item('public interest', 100), item('unless', 88)], [item('end', 50, true)]])), 'public interest unless end');
});

test('secret: a letter the work does not contain is named, with the chars as the UI quotes them', async () => {
  // Real report: "…sexy" in a German text that has no "y". The UI shows e.missing, so it must be exactly that letter.
  const noY = 'abcdefghijklmnopqrstuvwxz hallo du bist super, sex ist egal. '.repeat(4);
  await assert.rejects(hideSecret(noY, 'hallo du bist sexy'), (e) => e.missing.length === 1 && e.missing[0] === 'y');
  assert.equal(await revealSecret(noY, await hideSecret(noY, 'hallo du bist sex')), 'hallo du bist sex');
});

test('secret: every refusal carries a stable code the UI can translate', async () => {
  const text = 'Wer reitet so spät durch Nacht und Wind? '.repeat(3);
  await assert.rejects(hideSecret(text, '   '), (e) => e.code === 'empty-secret');
  await assert.rejects(hideSecret(text, 'xyz'), (e) => e.code === 'missing' && e.missing.includes('x'));
  await assert.rejects(revealSecret(text, ''), (e) => e.code === 'no-key');
  await assert.rejects(revealSecret(text, 'hello'), (e) => e.code === 'bad-prefix');
  await assert.rejects(revealSecret(text, 'tg1.'), (e) => e.code === 'damaged');
  await assert.rejects(revealSecret(text, 'tg1.$$$$'), (e) => e.code === 'damaged');
  const key = await hideSecret(text, 'Wind');
  await assert.rejects(revealSecret(text.replace('Wer', 'Wir'), key), (e) => e.code === 'wrong-text' && e.wrongText === true);
});
