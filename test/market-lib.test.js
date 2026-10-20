import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, conversion, kindOf } from '../scripts/market-lib.mjs';

const pricing = { products: [{ label: 'Poster', gelatoUid: 'flat_300x400', base: 11.92 }, { label: 'Mug', gelatoUid: 'mug_product', base: 6.59 }] };

test('kindOf classifies catalog uids and titles', () => {
  assert.equal(kindOf('framed_poster_500x700'), 'Framed poster');
  assert.equal(kindOf('Mona Lisa — Typographic Mug'), 'Mug');
  assert.equal(kindOf('flat_500x700'), 'Poster');
  assert.equal(kindOf('x'), 'Other');
});

test('aggregate sums units, revenue and contribution per kind and work', () => {
  const r = aggregate([{ items: [{ title: 'Poster', productUid: 'flat_300x400', workId: 'a', quantity: 2, price: 29 }, { title: 'Mug', productUid: 'mug_product', workId: 'b', quantity: 1, price: 22 }] }], pricing);
  assert.equal(r.units, 3); assert.equal(r.revenue, 80);
  assert.equal(r.kinds.Poster.contribution, +(58 - 23.84).toFixed(2));
  assert.equal(r.works.b.units, 1);
});

test('conversion refuses a rate on too few sessions', () => {
  assert.equal(conversion(1, 50), null);
  assert.equal(conversion(3, 300), 1);
});
