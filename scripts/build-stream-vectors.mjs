#!/usr/bin/env node
// Writes test/fixtures/conformance/stream-vectors.json: conformance vectors for the `tgst1` encrypted-stream format
// (docs/encrypted-media-adapter.md, src/stream.js). Everything is deterministic (seeded random); an implementation in
// another language (the Rust self-extractor, docs/self-extractor-plan.md) must open every vector and reproduce the
// decrypted metadata + every plaintext frame byte for byte, using ONLY: secret, fileSalt (from the file's own header),
// workDigest (for bound vectors) and the sealed bytes — the same inputs a real player has.
//   node scripts/build-stream-vectors.mjs          rewrite the file
import { writeFileSync } from 'node:fs';
import { sealStream, StreamReader } from '../src/stream.js';
import { seededRandom, toHex, utf8, sha256 } from '../src/crypt-codec.js';

const rnd = (n) => seededRandom('tg-art-stream/' + n);
const secretOf = (n, len) => { const a = new Uint8Array(len); rnd(n)(a); return a; };

const v = [];

const add = async (name, o) => {
  const file = await sealStream(o);
  const reader = new StreamReader(file);
  const meta = await reader.open(o.secret, o.workDigest ?? null);
  const frames = [];
  for (let i = 0; i < reader.frameCount; i++) frames.push(toHex(await reader.frame(i)));
  // Self-check before this ever reaches another language: the reader's own output must match what we sealed.
  const rebuilt = frames.length ? Uint8Array.from(Buffer.concat(frames.map((h) => Buffer.from(h, 'hex')))) : new Uint8Array(0);
  if (toHex(rebuilt) !== toHex(o.bytes)) throw new Error(`${name}: round-trip mismatch`);
  v.push({
    name,
    secretHex: toHex(o.secret),
    workDigestHex: o.workDigest ? toHex(o.workDigest) : null,
    fileHex: toHex(file),
    expect: { meta, frameCount: reader.frameCount, frameSize: reader.frameSize, size: reader.size, frameHex: frames },
  });
};

// 1. Small single-frame file, unbound, default frame size.
await add('single-frame-unbound', {
  secret: secretOf(1, 32), bytes: utf8('one small encrypted frame, well under the 1 MiB default'),
  media: 'text/plain', name: 'note.txt', created: '2026-10-18T00:00:00Z', title: 'A short note', random: rnd(10),
});

// 2. Multi-frame file (frameSize forced to the format minimum, 4096 bytes) — three full frames plus a short remainder
//    frame, exercising the per-frame counter nonce and the AAD binding (header || counter) across more than one frame.
{
  const bytes = new Uint8Array(4096 * 3 + 17); for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) & 0xff;
  await add('multi-frame-three-plus-remainder', {
    secret: secretOf(2, 32), bytes, media: 'application/octet-stream', frameSize: 4096, random: rnd(12),
  });
}

// 3. 16-byte secret (the format accepts 16 or 32 byte secrets).
await add('single-frame-16-byte-secret', {
  secret: secretOf(4, 16), bytes: utf8('a shorter secret still derives a full 32-byte AES-256 key via HKDF'),
  media: 'text/plain', random: rnd(13),
});

// 4. Bound to a work (the metadata derivation mixes the work's SHA-256 into the HKDF info) — the Rust reader needs the
//    work digest, not the work text, exactly like a real player that already knows which work a stream belongs to.
await add('bound-to-work', {
  secret: secretOf(5, 32), bytes: utf8('this stream is tied to a specific work via its digest'),
  media: 'text/plain', workDigest: await sha256(utf8('the work this stream is bound to')), random: rnd(14),
});

// 5. Empty payload (frameCount = 0 — only the header + metadata frame; no data frames at all).
await add('empty-payload', { secret: secretOf(6, 32), bytes: new Uint8Array(0), media: 'application/octet-stream', random: rnd(15) });

writeFileSync(
  new URL('../test/fixtures/conformance/stream-vectors.json', import.meta.url),
  JSON.stringify({ standard: 'tgst1', version: 1, note: 'see scripts/build-stream-vectors.mjs', vectors: v }, null, 2) + '\n',
);
console.log(`wrote ${v.length} stream vectors`);
