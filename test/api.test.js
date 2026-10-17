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
