// The tgst1 stream format (src/stream.js): round-trip, random access across frame boundaries, private metadata, binding to
// a work, and that a changed, truncated or reordered file is refused rather than played as garbage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sealStream, StreamReader } from '../src/stream.js';
import { sha256, toHex, seededRandom } from '../src/crypt-codec.js';

const SECRET = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 1) & 255);
const rnd = seededRandom('stream-test');
const body = (n) => Uint8Array.from({ length: n }, (_, i) => (i * 131 + 17) & 255);
const workDigest = (t) => sha256(new TextEncoder().encode(t));

async function roundtrip(n, frameSize) {
  const bytes = body(n);
  const file = await sealStream({ secret: SECRET, bytes, media: 'application/octet-stream', name: 'x.bin', frameSize, random: rnd });
  const r = new StreamReader(file);
  await r.open(SECRET);
  return { bytes, file, r };
}

test('stream: round-trip over one and several frames, with and without a short last frame', async () => {
  for (const [n, fs] of [[0, 4096], [1, 4096], [4096, 4096], [4097, 4096], [10000, 4096], [40000, 4096]]) {
    const { bytes, r } = await roundtrip(n, fs);
    assert.equal(r.size, n);
    assert.equal(r.frameCount, Math.ceil(n / fs));
    assert.deepEqual(Buffer.from(await r.readRange(0, n)), Buffer.from(bytes), `n=${n}`);
  }
});

test('stream: random access returns exactly the requested bytes, across frame boundaries', async () => {
  const n = 20000, fs = 4096;
  const { bytes, r } = await roundtrip(n, fs);
  for (const [a, b] of [[0, 1], [0, n], [100, 200], [4095, 4097], [4096, 8192], [8190, 12300], [n - 1, n], [n, n], [5000, 5000]]) {
    assert.deepEqual(Buffer.from(await r.readRange(a, b)), Buffer.from(bytes.subarray(a, b)), `[${a},${b})`);
  }
  // out-of-range is clamped, not an error
  assert.deepEqual(Buffer.from(await r.readRange(-10, 5)), Buffer.from(bytes.subarray(0, 5)));
  assert.deepEqual(Buffer.from(await r.readRange(n - 5, n + 99)), Buffer.from(bytes.subarray(n - 5, n)));
});

test('stream: the metadata is carried and private (media, name, size, sha256); only layout is in the clear', async () => {
  const bytes = body(9000);
  const file = await sealStream({ secret: SECRET, bytes, media: 'video/mp4', name: 'clip.mp4', title: 'A clip', created: '2026-10-18T00:00:00Z', frameSize: 4096, random: rnd });
  const r = new StreamReader(file);
  const meta = await r.open(SECRET);
  assert.equal(meta.media, 'video/mp4');
  assert.equal(meta.name, 'clip.mp4');
  assert.equal(meta.title, 'A clip');
  assert.equal(meta.size, 9000);
  assert.equal(meta.sha256, toHex(await sha256(bytes)));
  // nothing of the name, type or title is readable in the clear bytes of the file
  const asText = Buffer.from(file).toString('latin1');
  for (const secretStr of ['video/mp4', 'clip.mp4', 'A clip']) assert.ok(!asText.includes(secretStr), `"${secretStr}" leaked into the clear`);
});

test('stream: a wrong key is refused, cleanly', async () => {
  const { file } = await roundtrip(9000, 4096);
  const r = new StreamReader(file);
  const wrong = Uint8Array.from(SECRET); wrong[0] ^= 1;
  await assert.rejects(r.open(wrong), { code: 'bad-key' });
});

test('stream: a stream bound to a work needs that work; another work is refused', async () => {
  const bytes = body(5000);
  const file = await sealStream({ secret: SECRET, bytes, media: 'image/png', workDigest: await workDigest('the work'), frameSize: 4096, random: rnd });
  const r = new StreamReader(file);
  assert.equal(r.bound, true);
  await assert.rejects(r.open(SECRET), { code: 'work-required' });
  await assert.rejects(r.open(SECRET, await workDigest('another work')), { code: 'bad-key' });
  const r2 = new StreamReader(file);
  await r2.open(SECRET, await workDigest('the work'));
  assert.deepEqual(Buffer.from(await r2.readRange(0, 5000)), Buffer.from(bytes));
});

test('stream: a changed data frame is refused, not played as garbage', async () => {
  const { file } = await roundtrip(10000, 4096);
  const bad = Uint8Array.from(file); bad[bad.length - 100] ^= 0x40; // inside the last data frame
  const r = new StreamReader(bad);
  await r.open(SECRET); // metadata frame is intact
  await assert.rejects(r.readRange(8192, 10000), { code: 'bad-key' });
  assert.deepEqual((await r.readRange(0, 4096)).length, 4096); // an untouched frame still opens
});

test('stream: truncation and a changed header are refused on construction', async () => {
  const { file } = await roundtrip(10000, 4096);
  assert.throws(() => new StreamReader(file.subarray(0, file.length - 1)), { code: 'damaged' });
  const h = Uint8Array.from(file); h[29] = (h[29] + 1) & 255; // bump the frame count
  assert.throws(() => new StreamReader(h), { code: 'damaged' });
  assert.throws(() => new StreamReader(body(10)), { code: 'bad-prefix' });
});

test('stream: swapping two whole frames is refused (frame index is authenticated)', async () => {
  const fs = 4096, n = 12000;
  const { file } = await roundtrip(n, fs);
  const headLen = file.length - (n + Math.ceil(n / fs) * 16) - 0; // not used; compute frame region directly
  const { HEADER } = await import('../src/stream.js');
  const metaCtLen = (file[42] << 8) | file[43];
  const base = HEADER + metaCtLen, frameLen = fs + 16;
  const swapped = Uint8Array.from(file);
  const f0 = file.subarray(base, base + frameLen), f1 = file.subarray(base + frameLen, base + 2 * frameLen);
  swapped.set(f1, base); swapped.set(f0, base + frameLen);
  const r = new StreamReader(swapped);
  await r.open(SECRET);
  await assert.rejects(r.readRange(0, fs), { code: 'bad-key' });
});
