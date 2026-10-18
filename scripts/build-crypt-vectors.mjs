#!/usr/bin/env node
// Writes test/fixtures/conformance/crypt-vectors.json: conformance vectors for sealed data (tgs1./tgx1.), compact keys (tg2.),
// the on-chain anchor payload and the base alphabets. Everything is deterministic (seeded random, fixed times); an
// implementation in another language must open every "open" vector and reproduce every "exact" vector byte for byte.
//   node scripts/build-crypt-vectors.mjs          rewrite the file
import { writeFileSync } from 'node:fs';
import { sealData, sealMessage, sealBytes, openSealed, parseKey } from '../src/crypt.js';
import { hideCompact } from '../src/crypt-book.js';
import { hideSecret } from '../src/secret.js';
import { anchorPayload, opReturnScript, recordCid, estimateFeeSat } from '../src/crypt-chain.js';
import { encode } from '../src/structured.js';
import { seededRandom, b58Encode, b64urlEncode, toHex, utf8, sha256 } from '../src/crypt-codec.js';

export const WORK = 'Typographics Art sets a text character for character so that it forms a picture, and the text stays readable text: every word of it can be selected, searched and copied, quite as in any book; this short work only exists to give the conformance vectors a public text with a good many different letters, digits like 2026 and a little punctuation, so that a key can point into it.';
const CSV = 'Name,Age,City\r\nAlice Müller,34,Zürich\r\nBob,41,\r\n';
const block = (await encode({ bytes: utf8(CSV), name: 'people.csv' }, { created: '2026-10-18T00:00:00Z' })).text;
const hex = (b) => toHex(b);
const flip = (s, at) => s.slice(0, at) + (s[at] === 'A' ? 'B' : 'A') + s.slice(at + 1);

const sealed = async (name, workText, fn, expectOpen) => {
  const r = await fn();
  return { name, work: workText, key: r.key, record: r.record, ...expectOpen };
};
const v = [];
const rnd = (n) => seededRandom('tg-crypt/' + n);

v.push(await sealed('tgd-bound-stored', WORK, () => sealData(WORK, block, { compress: false, random: rnd(1) }), { mode: 'exact', expect: { kind: 'tgd', body: block.replace(/\s+/g, '').slice(5, -5) } }));
v.push(await sealed('tgd-bound-deflate', WORK, () => sealData(WORK, block, { random: rnd(2) }), { mode: 'open', expect: { kind: 'tgd', body: block.replace(/\s+/g, '').slice(5, -5) } }));
v.push(await sealed('message-unbound-128', null, () => sealMessage(null, 'Meet at the harbour, 6 pm. Zürich 😀', { bind: false, strength: 128, compress: false, random: rnd(3) }), { mode: 'exact', expect: { kind: 'text', text: 'Meet at the harbour, 6 pm. Zürich 😀' } }));
v.push(await sealed('bytes-inline-padded', WORK, () => sealBytes(WORK, Uint8Array.from([0, 1, 2, 3, 250, 251, 252, 253, 254, 255]), { inline: true, pad: 64, compress: false, random: rnd(4) }), { mode: 'exact', expect: { kind: 'bytes', hex: '00010203fafbfcfdfeff' } }));
{
  const r = await sealMessage(null, 'Open sesame', { bind: false, password: 'correct horse battery staple', iterations: 100000, compress: false, random: rnd(5) });
  v.push({ name: 'message-password-100k', work: null, key: null, password: 'correct horse battery staple', record: r.record, mode: 'exact', expect: { kind: 'text', text: 'Open sesame' } });
}
{
  const r = await sealMessage(WORK, 'brotli test '.repeat(30), { compress: 'brotli', random: rnd(6) });
  v.push({ name: 'message-bound-brotli', work: WORK, key: r.key, record: r.record, mode: 'open', needs: 'brotli', expect: { kind: 'text', text: 'brotli test '.repeat(30) } });
}

const good = v[0];
const negatives = [
  { name: 'wrong-work', work: WORK.replace('Typographics', 'Typographic'), key: good.key, record: good.record, expect: { error: 'wrong-work' } },
  { name: 'wrong-key-right-shape', work: WORK, key: v[1].key, record: good.record, expect: { error: 'auth-failed' } },
  { name: 'typo-in-key', work: WORK, key: flip(good.key, 20), record: good.record, expect: { error: 'checksum' } },
  { name: 'not-a-key', work: WORK, key: 'hello', record: good.record, expect: { error: 'bad-prefix' } },
  { name: 'record-tampered', work: WORK, key: good.key, record: flip(good.record, 40), expect: { error: 'auth-failed' } },
  { name: 'record-truncated', work: WORK, key: good.key, record: good.record.slice(0, 65), expect: { error: 'auth-failed' } },
  { name: 'record-not-a-record', work: WORK, key: good.key, record: 'tgs2.AAAA', expect: { error: 'bad-prefix' } },
];

const book = [];
const msg = 'meet at noon';
book.push({ name: 'tg1', work: WORK, key: await hideSecret(WORK, msg, { random: rnd(7) }), expect: { text: msg } });
book.push({ name: 'tg2-fixed', work: WORK, key: await hideCompact(WORK, msg, { random: rnd(8) }), expect: { text: msg } });
book.push({ name: 'tg2-near-1', work: WORK, key: await hideCompact(WORK, msg, { near: 1, random: rnd(9) }), expect: { text: msg } });
book.push({ name: 'tg2-short-fingerprint', work: WORK, key: await hideCompact(WORK, msg, { shortFingerprint: true, random: rnd(10) }), expect: { text: msg } });

const commitment = await sha256(utf8('record bytes'));
const anchor = {
  commitment: hex(commitment),
  payload: hex(anchorPayload(commitment)),
  payloadWithHint: hex(anchorPayload(commitment, 'example.org/r/1')),
  script: hex(opReturnScript(anchorPayload(commitment))),
  scriptMaxLength: hex(opReturnScript(anchorPayload(commitment, 'x'.repeat(43)))).slice(0, 12),
  cid: recordCid(commitment),
  feeSat: { payload37: estimateFeeSat(37), payload80: estimateFeeSat(80) },
};
const bytes = Uint8Array.from([0, 0, 1, 2, 255, 254, 253, 100, 50]);
const alphabets = { bytesHex: hex(bytes), base58: b58Encode(bytes), base64url: b64urlEncode(bytes), emptyBase58: b58Encode(new Uint8Array(0)), zeros: b58Encode(new Uint8Array(3)) };

const file = { standard: 'tgs/tgx/tg2', version: 1, note: 'open: opening must give `expect`; exact: re-sealing with the same seeded random reproduces key and record byte for byte; negatives: the code of the failure', work: WORK, sealed: v, negatives, book, anchor, alphabets };
const out = new URL('../test/fixtures/conformance/crypt-vectors.json', import.meta.url);
if (process.argv[1] === new URL(import.meta.url).pathname) { writeFileSync(out, JSON.stringify(file, null, 1) + '\n'); console.log('written', out.pathname); }
export { file };
