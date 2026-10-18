// Regression tests of the internal adversarial review 2026-10 (docs/security-review-internal-2026-10-b.md). Each test
// failed on main 4757fd5 and passes with the fix it names; the inputs are the exact reproductions of the report.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hideSecret, revealSecret } from '../src/secret.js';
import { revealAny } from '../src/crypt-book.js';
import { equalBytes } from '../src/crypt-codec.js';

const b64u = (b) => Buffer.from(b).toString('base64url');

test('B-1 tg1: a varint of more than 7 bytes is refused as damaged, never decoded to a wrong message', async () => {
  const work = 'the quick brown fox jumps over the lazy dog';
  const key = await hideSecret(work, 'fox');
  assert.equal(await revealSecret(work, key), 'fox');
  const fp = Buffer.from(key.slice(4), 'base64url').subarray(0, 8);
  // fingerprint, then 200 continuation bytes (the varint never ends in 7 bytes), a terminator, then position 5 ("u")
  const crafted = 'tg1.' + b64u(Uint8Array.from([...fp, ...new Array(200).fill(0x80), 0x00, 5]));
  for (const read of [(k) => revealSecret(work, k), (k) => revealAny(work, k)]) {
    await assert.rejects(() => read(crafted), (e) => e.code === 'damaged');
  }
  // 8 continuation bytes are already too many (the reader of src/crypt-codec.js stops at 7 bytes too)
  const eight = 'tg1.' + b64u(Uint8Array.from([...fp, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01]));
  await assert.rejects(() => revealSecret(work, eight), (e) => e.code === 'damaged');
  // a legitimate position still reads
  const one = 'tg1.' + b64u(Uint8Array.from([...fp, 0x05]));
  assert.equal(await revealSecret(work, one), 'u');
});

test('B-4 codec: equalBytes compares every byte (no early exit) and is still exact', () => {
  const a = Uint8Array.from([1, 2, 3, 4]);
  assert.equal(equalBytes(a, Uint8Array.from([1, 2, 3, 4])), true);
  assert.equal(equalBytes(a, Uint8Array.from([1, 2, 3, 5])), false);
  assert.equal(equalBytes(a, Uint8Array.from([0, 2, 3, 4])), false);
  assert.equal(equalBytes(a, Uint8Array.from([1, 2, 3])), false);
  assert.equal(equalBytes(new Uint8Array(0), new Uint8Array(0)), true);
  assert.equal(equalBytes(Uint8Array.from([0]), Uint8Array.from([0])), true);
});
