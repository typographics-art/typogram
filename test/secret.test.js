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
