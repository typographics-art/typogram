// Acceptance spec for the DigiByte anchor (a WANTED contribution). These are skipped until the plugin is implemented; a
// contributor removes the skips and makes them pass. They are NOT part of the main gate (npm test runs only test/*.test.js) —
// run them directly with: node --test anchors/digibyte/digibyte.test.js
//
// Keep all on-chain work on DigiByte TESTNET so no real coin is spent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type, title, anchor, verify } from './digibyte.js';

const DIGEST = 'a'.repeat(64);

test('digibyte: the plugin declares the shared contract', () => {
  assert.equal(type, 'digibyte');
  assert.equal(typeof title, 'string');
  assert.equal(typeof anchor, 'function');
  assert.equal(typeof verify, 'function');
});

test.skip('digibyte: anchor() writes the digest and returns a reference that verifies (testnet)', async () => {
  const reference = await anchor(DIGEST);
  assert.equal(typeof reference, 'string');
  assert.ok(reference.length > 0);
  const r = await verify(DIGEST, reference);
  assert.equal(r.ok, true, 'the real digest verifies');
  assert.ok(r.time === null || !Number.isNaN(Date.parse(r.time)), 'time is null (pending) or an ISO date');
});

test.skip('digibyte: a wrong digest does not verify against a real reference (testnet)', async () => {
  const reference = await anchor(DIGEST);
  const r = await verify('b'.repeat(64), reference);
  assert.equal(r.ok, false, 'a different digest must fail');
});
