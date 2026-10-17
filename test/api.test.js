import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluatePayment, TXID } from '../api/dgb.mjs';

const ADDRESS = 'DT6eHuhe5Bvh2yKnVvt6EFLjURK7vad1CC';
const RULES = { address: ADDRESS, minDgb: 10, minConfirmations: 2 };
const tx = (outs, confirmations) => ({ confirmations, vout: outs.map(([address, value]) => ({ value, scriptPubKey: { address } })) });

test('evaluatePayment: enough to our address with enough confirmations pays', () => {
  assert.deepEqual(evaluatePayment(tx([[ADDRESS, 10], ['DOther', 5]], 3), RULES), { ok: true, paidDgb: 10, confirmations: 3 });
  assert.equal(evaluatePayment(tx([[ADDRESS, 6], [ADDRESS, 4.00000001]], 2), RULES).ok, true, 'outputs to our address add up');
});

test('evaluatePayment: says why a transaction does not pay', () => {
  assert.equal(evaluatePayment(tx([['DOther', 50]], 9), RULES).reason, 'no_output_to_address');
  assert.equal(evaluatePayment(tx([[ADDRESS, 9.99999999]], 9), RULES).reason, 'amount_too_low');
  assert.equal(evaluatePayment(tx([[ADDRESS, 10]], 1), RULES).reason, 'not_confirmed');
  assert.equal(evaluatePayment(tx([[ADDRESS, 10]], undefined), RULES).reason, 'not_confirmed', 'a mempool transaction has no confirmations');
  assert.equal(evaluatePayment({ confirmations: 5, vout: [{ value: 12, scriptPubKey: { addresses: [ADDRESS] } }] }, RULES).ok, true, 'older nodes list addresses[]');
});

test('TXID accepts only 64 lowercase hex characters', () => {
  assert.ok(TXID.test('a'.repeat(64)));
  assert.ok(!TXID.test('a'.repeat(63)) && !TXID.test('g'.repeat(64)));
});

test('store: a transaction is burned once; a failed job releases it for another try', async (t) => {
  let openStore;
  try { ({ openStore } = await import('../api/store.mjs')); } catch { return t.skip('node:sqlite needs Node 22.5+'); }
  const s = openStore(join(mkdtempSync(join(tmpdir(), 'tg-api-')), 'api.sqlite'));
  const id = 'b'.repeat(64);
  assert.equal(s.reserve(id, 10, 2, 'job-1'), true);
  assert.equal(s.reserve(id, 10, 2, 'job-2'), false, 'reserved: a second job cannot take it');
  s.release(id, 'image model down');
  assert.equal(s.reserve(id, 10, 3, 'job-3'), true, 'released: the payer can try again');
  s.burn(id, { job: 'job-3' });
  assert.equal(s.payment(id).status, 'burned');
  assert.equal(s.reserve(id, 10, 3, 'job-4'), false, 'burned: never again');
  s.close();
});

test('store: a released payment may start at most MAX_RELEASES further jobs', async (t) => {
  let store;
  try { store = await import('../api/store.mjs'); } catch { return t.skip('node:sqlite needs Node 22.5+'); }
  const s = store.openStore(join(mkdtempSync(join(tmpdir(), 'tg-api-')), 'api.sqlite'));
  const id = 'c'.repeat(64);
  assert.equal(s.reserve(id, 10, 2, 'job-0'), true);
  for (let i = 1; i <= store.MAX_RELEASES; i++) {
    s.release(id, 'outage');
    assert.equal(s.reserve(id, 10, 2, `job-${i}`), true, `retry ${i} allowed`);
  }
  s.release(id, 'outage');
  assert.equal(s.reserve(id, 10, 2, 'job-x'), false, 'no more retries');
  s.close();
});

test('evaluatePayment fails closed on unusable rules and on a NaN amount', () => {
  const tx = { confirmations: 0, vout: [{ value: 0.00000001, scriptPubKey: { address: 'DOUR' } }] };
  for (const rules of [{ address: 'DOUR', minDgb: NaN, minConfirmations: NaN }, { address: 'DOUR', minDgb: 0, minConfirmations: 2 }, { address: 'DOUR', minDgb: -1, minConfirmations: 2 }, { address: 'DOUR', minDgb: 10, minConfirmations: 1.5 }, { address: '', minDgb: 10, minConfirmations: 2 }]) {
    const r = evaluatePayment(tx, rules);
    assert.equal(r.ok, false, JSON.stringify(rules));
    assert.equal(r.reason, 'invalid_rules');
  }
  const broken = evaluatePayment({ confirmations: 5, vout: [{ value: 'abc', scriptPubKey: { address: 'DOUR' } }] }, { address: 'DOUR', minDgb: 10, minConfirmations: 2 });
  assert.equal(broken.ok, false);
  assert.equal(broken.reason, 'invalid_transaction');
});

test('numberFrom: unset gives the fallback, nonsense stops the service', async () => {
  const { numberFrom } = await import('../api/config.mjs');
  assert.equal(numberFrom({}, 'MIN_DGB', 10), 10);
  assert.equal(numberFrom({ MIN_DGB: '' }, 'MIN_DGB', 10), 10);
  assert.equal(numberFrom({ MIN_DGB: '2.5' }, 'MIN_DGB', 10, { min: 0, minExclusive: true }), 2.5);
  for (const bad of ['abc', 'NaN', 'Infinity', '-1', '0']) assert.throws(() => numberFrom({ MIN_DGB: bad }, 'MIN_DGB', 10, { min: 0, minExclusive: true }), /MIN_DGB/, bad);
  assert.throws(() => numberFrom({ MIN_CONFIRMATIONS: '1.5' }, 'MIN_CONFIRMATIONS', 2, { integer: true }), /integer/);
  assert.throws(() => numberFrom({ PORT: '70000' }, 'PORT', 8080, { min: 1, max: 65535, integer: true }), /PORT/);
  assert.equal(numberFrom({ MIN_CONFIRMATIONS: '0' }, 'MIN_CONFIRMATIONS', 2, { min: 0, integer: true }), 0);
});

test('store: recover burns a payment whose picture was made, releases the others, and frees orphan reservations', async (t) => {
  let openStore;
  try { ({ openStore } = await import('../api/store.mjs')); } catch { return t.skip('node:sqlite needs Node 22.5+'); }
  const store = openStore(join(mkdtempSync(join(tmpdir(), 'tg-store-')), 'api.sqlite'));
  const tx = (c) => c.repeat(64);
  store.reserve(tx('a'), 10, 2, 'job-a'); store.addJob('job-a', tx('a'), 'h', null, '/x'); store.setJob('job-a', { status: 'running', image_made: 1 });
  store.reserve(tx('b'), 10, 2, 'job-b'); store.addJob('job-b', tx('b'), 'h', null, '/x'); store.setJob('job-b', { status: 'running' });
  store.reserve(tx('c'), 10, 2, 'job-never-queued');
  store.recover();
  assert.equal(store.payment(tx('a')).status, 'burned', 'the picture was made: the payment is spent');
  assert.equal(store.payment(tx('b')).status, 'released', 'nothing was made: the payer may try again');
  assert.equal(store.payment(tx('c')).status, 'released', 'reserved without a job: not stuck');
  assert.equal(store.job('job-a').status, 'failed');
  store.close();
});

test('store: expired lists finished jobs past the retention, not recent ones', async (t) => {
  let openStore;
  try { ({ openStore } = await import('../api/store.mjs')); } catch { return t.skip('node:sqlite needs Node 22.5+'); }
  const store = openStore(join(mkdtempSync(join(tmpdir(), 'tg-store-')), 'api.sqlite'));
  store.addJob('old', 'x'.repeat(64), 'h', null, '/x'); store.setJob('old', { status: 'done', result: '/r', finished_at: "2020-01-01 00:00:00" });
  store.addJob('new', 'y'.repeat(64), 'h', null, '/x'); store.setJob('new', { status: 'done', result: '/r', finished_at: new Date().toISOString().replace('T', ' ').slice(0, 19) });
  assert.deepEqual(store.expired(7).map((j) => j.id), ['old']);
  store.close();
});
