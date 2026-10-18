// Guards test/fixtures/conformance/stream-vectors.json (scripts/build-stream-vectors.mjs): every vector must still
// decrypt, with StreamReader, to exactly the metadata and frame bytes the fixture records. This is the ground truth the
// Rust self-extractor's crypto crate (docs/self-extractor-plan.md) is checked against — a failing vector here means the
// fixture is out of date with src/stream.js, not that the Rust side is wrong.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { StreamReader } from '../src/stream.js';
import { fromHex, toHex } from '../src/crypt-codec.js';

const V = JSON.parse(readFileSync(new URL('./fixtures/conformance/stream-vectors.json', import.meta.url), 'utf8'));

test('the fixture is the tgst1 standard, version 1', () => {
  assert.equal(V.standard, 'tgst1');
  assert.equal(V.version, 1);
  assert.ok(V.vectors.length >= 5);
});

for (const vec of V.vectors) {
  test(`stream vector: ${vec.name}`, async () => {
    const reader = new StreamReader(fromHex(vec.fileHex));
    const secret = fromHex(vec.secretHex);
    const workDigest = vec.workDigestHex ? fromHex(vec.workDigestHex) : null;
    const meta = await reader.open(secret, workDigest);
    assert.deepEqual(meta, vec.expect.meta);
    assert.equal(reader.frameCount, vec.expect.frameCount);
    assert.equal(reader.frameSize, vec.expect.frameSize);
    assert.equal(reader.size, vec.expect.size);
    for (let i = 0; i < reader.frameCount; i++) {
      assert.equal(toHex(await reader.frame(i)), vec.expect.frameHex[i], `frame ${i}`);
    }
  });
}
