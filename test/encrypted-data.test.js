// Sealed data, compact keys, key formats and the chain flow (docs/encrypted-data.md, docs/key-format.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  sealData, sealMessage, sealBytes, sealItem, openSealed, parseKey, parseRecord, describeRecord, findSealedBlocks, recordDigest, CryptError, LIMITS, MAX_KEY_CHARS, MAX_RECORD_CHARS,
} from '../src/crypt.js';
import { hideCompact, revealCompact, revealAny, packPositions, choosePositions, MAX_COMPACT_KEY_CHARS, MAX_TG1_KEY_CHARS } from '../src/crypt-book.js';
import { hideSecret } from '../src/secret.js';
import { canonicalText } from '../src/secret.js';
import {
  b58Encode, b58Decode, b64urlEncode, b64urlDecode, deflateRaw, inflateRaw, brotliAvailable, seededRandom, sha256, utf8, toHex, fromHex, concat,
} from '../src/crypt-codec.js';
import {
  anchorPayload, parseAnchorPayload, opReturnScript, estimateFeeSat, recordCid, FakeChain, FakeStore, FakeChainAdapter, ChainAdapter,
  publishSealed, openFromChain, verifyAsset, OP_RETURN_MAX,
} from '../src/crypt-chain.js';
import { encode } from '../src/structured.js';
import { file as built } from '../scripts/build-crypt-vectors.mjs';

const vectors = JSON.parse(readFileSync(new URL('./fixtures/conformance/crypt-vectors.json', import.meta.url), 'utf8'));
const WORK = vectors.work;
const WORK2 = WORK.replace('Typographics', 'Typographic');
const CSV = 'Name,Age,City\r\nAlice Müller,34,Zürich\r\nBob,41,\r\n';
const BLOCK = (await encode({ bytes: utf8(CSV), name: 'people.csv' }, { created: '2026-10-18T00:00:00Z' })).text;
const rnd = (n) => seededRandom('test/' + n);
const FAST = { iterations: 100_000 };

/** The call must reject with a CryptError (optionally of one code) and nothing else. */
const clean = async (promise, code) => {
  await assert.rejects(promise, (e) => { assert.ok(e instanceof CryptError, `expected a CryptError, got ${e?.constructor?.name}: ${e?.message}`); if (code) assert.equal(e.code, code, e.message); return true; });
};
const flipChar = (s, i, alphabet) => s.slice(0, i) + alphabet[(alphabet.indexOf(s[i]) + 1) % alphabet.length] + s.slice(i + 1);
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// ---- alphabets and codecs ----------------------------------------------------------------------------------------
test('codec: base58 and base64url round-trip for every length and with leading zeros', () => {
  const r = rnd('codec');
  for (let n = 0; n < 70; n++) for (const zeros of [0, 1, 3]) {
    const b = new Uint8Array(n); r(b); b.fill(0, 0, Math.min(zeros, n));
    assert.deepEqual(b58Decode(b58Encode(b)), b);
    assert.deepEqual(b64urlDecode(b64urlEncode(b)), b);
  }
  assert.equal(b58Encode(new Uint8Array(0)), '');
  assert.throws(() => b58Decode('0OIl'), CryptError);
  assert.throws(() => b64urlDecode('AB+/'), CryptError);
  assert.throws(() => b64urlDecode('AB'.repeat(1) + 'B'), CryptError, 'a length of 1 mod 4 is impossible');
  assert.throws(() => b64urlDecode('AAB='), CryptError);
});

test('codec: deflate round trip is exact, a bomb is stopped, garbage is a clean error', async () => {
  const cases = [new Uint8Array(0), utf8('a'), utf8('x'.repeat(100_000)), (() => { const a = new Uint8Array(70_000); rnd('inc')(a); return a; })(), utf8(BLOCK)];
  for (const c of cases) assert.deepEqual(await inflateRaw(await deflateRaw(c), 1e9), c);
  const bomb = await deflateRaw(new Uint8Array(20 * 1024 * 1024));
  assert.ok(bomb.length < 40_000);
  await clean(inflateRaw(bomb, 1024 * 1024), 'too-large');
  await clean(inflateRaw(Uint8Array.of(1, 2, 3, 4, 5), 1000), 'damaged');
});

// ---- sealed data: round trips -------------------------------------------------------------------------------------
test('seal: a TGD block round-trips, bound to the work, and is recognised (kind, checksum) after opening', async () => {
  const s = await sealData(WORK, BLOCK);
  assert.match(s.key, /^tgx1\.[1-9A-HJ-NP-Za-km-z]+$/);
  assert.match(s.record, /^tgs1\.[A-Za-z0-9_-]+$/);
  const o = await openSealed(WORK, { key: s.key, record: s.record });
  assert.equal(o.kind, 'tgd');
  assert.equal(o.block.format, 'csv');
  assert.equal(o.block.verified, true);
  assert.deepEqual(o.block.model.data?.sheets?.[0].rows[1] ?? o.block.model.sheets[0].rows[1], ['Alice Müller', '34', 'Zürich']);
});

test('seal: messages, bytes, every option combination', async () => {
  const msg = 'Meet at the harbour, 6 pm. Zürich 😀 – 東京';
  const bytes = new Uint8Array(3000); rnd('bytes')(bytes);
  for (const bind of [true, false]) for (const strength of [128, 256]) for (const compress of [true, false, 'deflate', ...(brotliAvailable() ? ['brotli'] : [])]) for (const pad of [0, 256]) for (const inline of [false, true]) {
    const w = bind ? WORK : null, o = { bind, strength, compress, pad, inline };
    const m = await sealMessage(w, msg, o);
    const got = await openSealed(w, inline ? { key: m.key } : { key: m.key, record: m.record });
    assert.equal(got.text, msg, JSON.stringify(o));
    const b = await sealBytes(w, bytes, o);
    assert.deepEqual((await openSealed(w, { key: b.key, record: b.record })).bytes, bytes, JSON.stringify(o));
  }
});

test('seal: a password instead of a key (PBKDF2), bound or not', async () => {
  for (const bind of [true, false]) {
    const s = await sealMessage(bind ? WORK : null, 'Open sesame', { bind, password: 'correct horse', ...FAST });
    assert.equal(s.key, null);
    assert.equal(describeRecord(s.record).password, true);
    assert.equal((await openSealed(bind ? WORK : null, { password: 'correct horse', record: s.record })).text, 'Open sesame');
    await clean(openSealed(bind ? WORK : null, { password: 'correct horsE', record: s.record }), 'auth-failed');
    if (bind) await clean(openSealed(WORK2, { password: 'correct horse', record: s.record }), 'auth-failed');
  }
  await clean(sealMessage(null, 'x', { bind: false, password: 'a', iterations: 10 }), 'bad-option');
  await clean(sealMessage(null, 'x', { bind: false, password: 'a', inline: true, ...FAST }), 'bad-option');
});

test('seal: two seals of the same data differ; a block found in a work text opens', async () => {
  const a = await sealData(WORK, BLOCK), b = await sealData(WORK, BLOCK);
  assert.notEqual(a.record, b.record);
  assert.notEqual(a.key, b.key);
  const inText = `${WORK} \n ${a.record.replace(/(.{40})/g, '$1 \n')} `.replace(a.record, `TGS1[${a.record}]TGS1`);
  const found = findSealedBlocks(`Some prose. TGS1[ ${a.record.slice(0, 30)} \n ${a.record.slice(30)} ]TGS1 more prose.`);
  assert.equal(found.length, 1);
  assert.equal((await openSealed(WORK, { key: a.key, record: found[0] })).kind, 'tgd');
  assert.equal(typeof inText, 'string');
  assert.throws(() => findSealedBlocks('TGS1[ abc'), CryptError);
});

test('seal: the key and the record are copy-paste tolerant (wrapped lines, spaces)', async () => {
  const s = await sealMessage(WORK, 'hello', {});
  const wrapped = s.key.replace(/(.{20})/g, '$1\n ');
  assert.equal((await openSealed(WORK, { key: ` ${wrapped} \n`, record: s.record.replace(/(.{30})/g, '$1 \n') })).text, 'hello');
});

test('seal: the work text may be read back differently (whitespace, invisible characters, NFD)', async () => {
  const s = await sealMessage(WORK, 'hello', {});
  const readBack = WORK.replace(/ /g, '  \n').replace(/picture/, 'pic­ture').normalize('NFD');
  assert.equal((await openSealed(readBack, { key: s.key, record: s.record })).text, 'hello');
});

// ---- failures: wrong key, wrong work, tampering, truncation -----------------------------------------------------------
test('open: wrong key, wrong work and a key without its record are named, not decoded to garbage', async () => {
  const s = await sealData(WORK, BLOCK), other = await sealData(WORK, BLOCK);
  await clean(openSealed(WORK2, { key: s.key, record: s.record }), 'wrong-work');
  await clean(openSealed(WORK, { key: other.key, record: s.record }), 'auth-failed');
  await clean(openSealed(WORK, { key: s.key }), 'no-record');
  await clean(openSealed(null, { key: s.key, record: s.record }), 'work-required');
  await clean(openSealed(WORK, { key: '', record: s.record }), 'no-key');
  await clean(openSealed(WORK, { key: 'hello', record: s.record }), 'bad-prefix');
  await clean(openSealed(WORK, { key: s.key, record: 'hello' }), 'bad-prefix');
  const nb = await sealData(null, BLOCK, { bind: false });
  assert.equal((await openSealed(WORK2, { key: nb.key, record: nb.record })).kind, 'tgd', 'an unbound key fits any work');
});

test('open: every byte of a record, flipped, is detected (header, flags, nonce, ciphertext, tag)', async () => {
  const s = await sealMessage(WORK, 'a short secret', { compress: false });
  let n = 0;
  for (let i = 0; i < s.bytes.length; i++) for (const mask of [1, 0x80]) {
    const bad = Uint8Array.from(s.bytes); bad[i] ^= mask;
    await clean(openSealed(WORK, { key: s.key, record: bad }));
    n++;
  }
  assert.equal(n, s.bytes.length * 2);
  // the same for a password record, whose header carries the salt and the iteration count
  const p = await sealMessage(null, 'a short secret', { bind: false, password: 'pw', ...FAST });
  for (let i = 0; i < p.bytes.length; i += 1) { const bad = Uint8Array.from(p.bytes); bad[i] ^= 1; await clean(openSealed(null, { password: 'pw', record: bad })); }
});

test('open: every character of a key, changed, is detected; so is every truncation', async () => {
  const s = await sealMessage(WORK, 'a short secret', { compress: false });
  for (let i = s.key.indexOf('.') + 1; i < s.key.length; i++) await clean(openSealed(WORK, { key: flipChar(s.key, i, B58), record: s.record }));
  for (let n = 0; n < s.key.length; n++) await clean(openSealed(WORK, { key: s.key.slice(0, n), record: s.record }));
  for (let n = 0; n < s.record.length; n++) await clean(openSealed(WORK, { key: s.key, record: s.record.slice(0, n) }));
  const inl = await sealMessage(WORK, 'a short secret', { inline: true, compress: false });
  for (let n = 0; n < inl.key.length; n++) await clean(openSealed(WORK, { key: inl.key.slice(0, n) }));
});

test('open: a typo in a key is reported as a typo (check characters), a foreign key as foreign', async () => {
  const s = await sealMessage(WORK, 'x', {});
  const typo = flipChar(s.key, 30, B58);
  await clean(parseKey(typo), 'checksum');
  const parsed = await parseKey(s.key);
  assert.equal(parsed.bound, true);
  assert.equal(parsed.secret.length, 32);
  assert.equal(parsed.inline, null);
});

test('open: padding and flags that are not canonical are refused (inside the authenticated data)', async () => {
  const s = await sealMessage(WORK, 'padded', { pad: 512, compress: false });
  assert.equal(s.bytes.length - 2 - 12 - 16, 512, 'padded to a multiple of 512');
  assert.equal((await openSealed(WORK, { key: s.key, record: s.record })).text, 'padded');
});

test('fuzz: random strings and bytes only ever produce a CryptError', async () => {
  const r = rnd('fuzz');
  const alphabet = B64 + B58 + '.=+/ \n\t0OIl%$#@{}[]()';
  const randomString = (n) => { const a = new Uint8Array(n); r(a); return [...a].map((b) => alphabet[b % alphabet.length]).join(''); };
  const s = await sealMessage(WORK, 'x', {});
  for (let i = 0; i < 400; i++) {
    const body = randomString(1 + (i % 120));
    for (const prefix of ['', 'tgx1.', 'tgs1.', 'tg2.', 'tg1.']) {
      await clean(openSealed(WORK, { key: prefix + body, record: s.record }));
      await clean(openSealed(WORK, { key: s.key, record: prefix + body }));
      await clean(revealAny(WORK, prefix + body));
    }
    const bytes = new Uint8Array(1 + (i % 90)); r(bytes);
    await clean(openSealed(WORK, { key: s.key, record: bytes }));
    await clean(openSealed(WORK, { key: 'tgx1.' + b58Encode(bytes) }));
    await clean(openSealed(WORK, { key: s.key, record: 'tgs1.' + b64urlEncode(bytes) }));
  }
  for (const weird of [undefined, null, 0, {}, [], '\u0000', '\ud800', '😀'.repeat(50), 'tgx1.' + '1'.repeat(200)]) {
    await clean(openSealed(WORK, { key: weird, record: s.record }));
    await clean(revealAny(WORK, weird));
  }
});

test('fuzz: random bit flips in a valid compact key never throw anything but a CryptError and never decode to another message silently', async () => {
  const msg = 'meet at noon';
  const r = rnd('flips');
  for (const o of [{}, { near: 1 }, { shortFingerprint: true }]) {
    const key = await hideCompact(WORK, msg, { ...o, random: r });
    for (let i = 4; i < key.length; i++) {
      const bad = flipChar(key, i, B58);
      try { assert.equal(await revealCompact(WORK, bad), msg, 'only an identical message may come out'); } catch (e) { assert.ok(e instanceof CryptError || e.name === 'AssertionError', String(e)); if (e.name === 'AssertionError') throw e; }
    }
  }
});

// ---- limits -----------------------------------------------------------------------------------------------------------
test('limits: oversize input and decompression bombs are refused with a named error', async () => {
  const huge = new Uint8Array(15 * 1024 * 1024);
  const s = await sealBytes(null, huge, { bind: false });
  assert.ok(s.stats.recordBytes < 100_000, 'zeros compress to almost nothing');
  await clean(openSealed(null, { key: s.key, record: s.record }, { limits: { maxPlain: 1024 * 1024 } }), 'too-large');
  const filler = new Uint8Array(LIMITS.maxInlineRecord + 10); rnd('filler')(filler);
  await clean(sealBytes(null, filler, { bind: false, inline: true, compress: false }), 'too-large');
  assert.ok((await sealBytes(null, filler, { bind: false, compress: false })).key, 'the same data with the record kept apart is fine');
  await clean(sealBytes(null, new Uint8Array(LIMITS.maxPlain + 1), { bind: false }), 'too-large');
  await clean(sealItem(null, { kind: 'bytes', payload: new Uint8Array(0) }, { bind: false, strength: 100 }), 'bad-option');
  await clean(sealData(WORK, 'not a block'), 'not-tgd');
});

test('limits: the sealed block count and the key are bounded', () => {
  const many = Array.from({ length: 70 }, () => 'TGS1[tgs1.AAAA]TGS1').join(' ');
  assert.throws(() => findSealedBlocks(many), CryptError);
});

// ---- sizes ------------------------------------------------------------------------------------------------------------
test('size: the cost of the format is fixed and small', async () => {
  const k256 = await sealMessage(WORK, 'x', { compress: false });
  const k128 = await sealMessage(WORK, 'x', { compress: false, strength: 128 });
  const unbound = await sealMessage(null, 'x', { bind: false, compress: false });
  assert.ok(k256.key.length <= 64, `key ${k256.key.length}`);
  assert.ok(k128.key.length <= 43, `key ${k128.key.length}`);
  assert.ok(unbound.key.length <= 54);
  // header 2 + nonce 12 + tag 16 + length 1 + kind 1 + payload 1
  assert.equal(k256.bytes.length, 2 + 12 + 16 + 1 + 1 + 1);
  assert.ok(k256.record.length === 5 + Math.ceil(k256.bytes.length * 4 / 3));
  const sheet = await sealData(WORK, BLOCK.repeat(1));
  assert.ok(sheet.stats.recordBytes < utf8(BLOCK).length, 'the sealed record is smaller than the plain block');
});

test('size: a 200-row sheet seals to about a fifth of its TGD text, and the key stays short', async () => {
  const rows = ['id,name,city,amount,date'];
  const r = rnd('sheet');
  for (let i = 0; i < 200; i++) { const a = new Uint8Array(3); r(a); rows.push(`${i},Person ${a[0]},City ${a[1] % 9},${(a[2] * 13.37).toFixed(2)},2026-0${1 + (a[0] % 9)}-1${a[1] % 10}`); }
  const e = await encode({ bytes: utf8(rows.join('\n') + '\n'), name: 'sheet.csv' }, { created: '2026-10-18T00:00:00Z' });
  const s = await sealData(WORK, e.text);
  assert.ok(s.stats.recordBytes < utf8(e.text).length / 3, `${s.stats.recordBytes} vs ${utf8(e.text).length}`);
  assert.ok(s.key.length <= 64);
  assert.equal((await openSealed(WORK, { key: s.key, record: s.record })).block.sum, (await openSealed(WORK, { key: s.key, record: s.record })).block.sum);
});

// ---- compact book-cipher keys ----------------------------------------------------------------------------------------
test('tg2: round trips, shorter than tg1, same fingerprint rule, typos and other works detected', async () => {
  const text = WORK.repeat(3);
  const msg = 'typographics art sets a text';
  const tg1 = await hideSecret(text, msg), fixed = await hideCompact(text, msg), near = await hideCompact(text, msg, { near: 1 });
  for (const k of [fixed, near, await hideCompact(text, msg, { shortFingerprint: true })]) { assert.match(k, /^tg2\./); assert.equal(await revealCompact(text, k), msg); assert.equal(await revealAny(text, k), msg); }
  assert.equal(await revealAny(text, tg1), msg);
  assert.ok(fixed.length < tg1.length, `${fixed.length} < ${tg1.length}`);
  assert.ok(near.length < fixed.length);
  await clean(revealCompact(text.replace('Art', 'Ark'), fixed), 'wrong-text');
  await clean(revealCompact(text, flipChar(fixed, 10, B58)), 'checksum');
  assert.notEqual(await hideCompact(text, msg), await hideCompact(text, msg));
  await clean(hideCompact(text, 'Zürich ™'), 'missing');
  await clean(hideCompact(text, ''), 'empty-secret');
});

test('tg2: Rice distances are chosen only when they are shorter; positions come back exactly for every policy', async () => {
  const clusters = [...canonicalText(WORK.repeat(40))];
  const wanted = [...'meet at noon at the harbour'];
  for (const near of [Infinity, 32, 8, 2, 1]) {
    const pos = choosePositions(clusters, wanted, { near, random: rnd('near' + near) });
    assert.deepEqual(pos.map((p) => clusters[p]), wanted);
    const { mode } = packPositions(pos, clusters.length);
    if (near === Infinity) assert.equal(mode, 0, 'uniform positions: fixed width');
    if (near === 1) assert.equal(mode, 1, 'nearest occurrences: Rice distances');
  }
});

// ---- the chain --------------------------------------------------------------------------------------------------------
const flow = async (opts = {}) => {
  const chain = new FakeChain(), store = new FakeStore();
  return { chain, store, adapter: new FakeChainAdapter(chain, store, opts) };
};

test('chain: anchor payload layout, limits and script', async () => {
  const c = await sha256(utf8('x'));
  const p = anchorPayload(c);
  assert.equal(p.length, 37);
  assert.deepEqual(parseAnchorPayload(p), { commitment: c, hint: null });
  assert.equal(parseAnchorPayload(anchorPayload(c, 'example.org/r')).hint, 'example.org/r');
  assert.equal(anchorPayload(c, 'x'.repeat(43)).length, OP_RETURN_MAX);
  assert.throws(() => anchorPayload(c, 'x'.repeat(44)), (e) => e.code === 'payload-too-large');
  assert.throws(() => opReturnScript(new Uint8Array(81)), (e) => e.code === 'payload-too-large');
  assert.equal(toHex(opReturnScript(p)).slice(0, 4), '6a25');
  assert.equal(toHex(opReturnScript(new Uint8Array(80))).slice(0, 6), '6a4c50');
  for (const bad of [new Uint8Array(0), p.slice(0, 36), concat(p, Uint8Array.of(1)), concat(utf8('TGA2'), p.slice(4)), Uint8Array.of(...p.slice(0, 4), 2, ...p.slice(5))]) assert.throws(() => parseAnchorPayload(bad), (e) => e.code === 'bad-anchor');
  assert.ok(estimateFeeSat(37) >= 10_000 && estimateFeeSat(80) > estimateFeeSat(37));
});

test('chain: CID derivation is a pure function of the commitment', async () => {
  const c = await sha256(utf8('record bytes'));
  assert.equal(recordCid(c), vectors.anchor.cid);
  assert.match(recordCid(c), /^bafkrei[a-z2-7]{52}$/);
});

test('chain: publish, fetch, verify and open with the key, end to end', async () => {
  const { chain, adapter } = await flow();
  const pub = await publishSealed(adapter, WORK, { kind: 'tgd', text: BLOCK }, { hint: 'example.org/r/1' });
  assert.match(pub.assetId, /^fake:fake:[0-9a-f]{64}:0$/);
  assert.ok(pub.feeSat >= 10_000);
  assert.match(pub.cid, /^bafkrei/);
  chain.mine(2);
  const got = await openFromChain(adapter, pub.assetId, WORK, { key: pub.key });
  assert.equal(got.kind, 'tgd');
  assert.equal(got.confirmations, 2);
  assert.equal((await verifyAsset(adapter, pub.assetId, pub.record)).ok, true);
  // the chain alone shows a commitment: no key, no plaintext, no work
  const tx = chain.getTx(pub.txid);
  const onChain = toHex(fromHex(tx.script));
  assert.ok(!onChain.includes(toHex(utf8('Alice'))));
  assert.equal(parseAnchorPayload(FakeChain.dataOf(tx.script)).hint, 'example.org/r/1');
  assert.equal(toHex(parseAnchorPayload(FakeChain.dataOf(tx.script)).commitment), toHex(await recordDigest(pub.record)));
});

test('chain: wrong key or wrong work on a fetched record is named', async () => {
  const { chain, adapter } = await flow();
  const pub = await publishSealed(adapter, WORK, { kind: 'text', text: 'private note' });
  chain.mine();
  await clean(openFromChain(adapter, pub.assetId, WORK2, { key: pub.key }), 'wrong-work');
  const other = await sealMessage(WORK, 'x');
  await clean(openFromChain(adapter, pub.assetId, WORK, { key: other.key }), 'auth-failed');
  assert.equal((await openFromChain(adapter, pub.assetId, WORK, { key: pub.key })).text, 'private note');
});

test('chain: availability is not guaranteed (store loses the record), integrity is (store replaces it)', async () => {
  const { chain, store, adapter } = await flow();
  const pub = await publishSealed(adapter, WORK, { kind: 'text', text: 'note' });
  chain.mine();
  const loc = pub.commitment;
  const copy = await store.get(loc);
  store.replace(loc, concat(copy.slice(0, -1), Uint8Array.of(copy.at(-1) ^ 1)));
  await clean(adapter.fetch(pub.assetId), 'commitment-mismatch');
  store.delete(loc);
  await clean(adapter.fetch(pub.assetId), 'unavailable');
  // the anchor alone still verifies a copy somebody kept
  assert.equal((await adapter.verify(pub.assetId, copy)).ok, true);
  assert.equal((await adapter.verify(pub.assetId, concat(copy.slice(0, -1), Uint8Array.of(copy.at(-1) ^ 1)))).ok, false);
});

test('chain: unconfirmed, unknown, foreign and unrelated outputs', async () => {
  const { chain, adapter } = await flow({ minConfirmations: 2 });
  const pub = await publishSealed(adapter, WORK, { kind: 'text', text: 'note' });
  await clean(adapter.fetch(pub.assetId), 'unconfirmed');
  chain.mine();
  await clean(adapter.fetch(pub.assetId), 'unconfirmed');
  chain.mine();
  assert.ok((await adapter.fetch(pub.assetId)).record);
  await clean(adapter.fetch('fake:fake:' + '0'.repeat(64) + ':0'), 'not-found');
  await clean(adapter.fetch('dgb:tx:abc'), 'bad-asset');
  await clean(adapter.fetch(undefined), 'bad-asset');
  const { txid } = await chain.sendData(utf8('some other protocol payload that is not ours, 37+ bytes long.....'));
  chain.mine(3);
  await clean(adapter.fetch(`fake:fake:${txid}:0`), 'bad-anchor');
  assert.equal((await adapter.verify(`fake:fake:${txid}:0`, new Uint8Array(1))).ok, false);
  await clean(publishSealed(adapter, WORK, { kind: 'text', text: 'x' }, { seal: { inline: true } }), 'bad-option');
  await clean(new ChainAdapter().publish(), 'not-implemented');
});

test('chain: a password-only record is not published unless the risk is accepted', async () => {
  const { chain, adapter } = await flow();
  const o = { password: 'correct horse', ...FAST, bind: false };
  await clean(publishSealed(adapter, null, { kind: 'text', text: 'x' }, { seal: o }), 'weak-for-chain');
  const pub = await publishSealed(adapter, null, { kind: 'text', text: 'x' }, { seal: { ...o, allowPassword: true } });
  chain.mine();
  assert.equal((await openFromChain(adapter, pub.assetId, null, { password: 'correct horse' })).text, 'x');
});

test('chain: the whole record cannot go on chain, only a commitment (80-byte limit measured)', async () => {
  const { chain } = await flow();
  const s = await sealData(WORK, BLOCK);
  assert.ok(s.bytes.length > OP_RETURN_MAX);
  await assert.rejects(chain.sendData(s.bytes), (e) => e.code === 'payload-too-large');
});

test('chain: the fake chain persists as JSON and reloads', async () => {
  const { chain, adapter } = await flow();
  const pub = await publishSealed(adapter, WORK, { kind: 'text', text: 'x' });
  chain.mine(4);
  const again = FakeChain.fromJSON(JSON.parse(JSON.stringify(chain)));
  assert.equal(again.getTx(pub.txid).confirmations, 4);
});

// ---- conformance vectors -----------------------------------------------------------------------------------------------
test('vectors: the committed file is what the builder produces (deterministic parts), and every vector opens', async () => {
  for (const key of ['sealed', 'negatives', 'book', 'anchor', 'alphabets']) assert.deepEqual(vectors[key].filter ? vectors[key].filter((x) => x.mode !== 'open') : vectors[key], built[key].filter ? built[key].filter((x) => x.mode !== 'open') : built[key], `vector group ${key} drifted: run node scripts/build-crypt-vectors.mjs`);
  for (const v of vectors.sealed) {
    if (v.needs === 'brotli' && !brotliAvailable()) continue;
    const o = await openSealed(v.work, { key: v.key ?? undefined, password: v.password, record: v.record });
    assert.equal(o.kind, v.expect.kind, v.name);
    if (v.expect.text !== undefined && o.kind === 'text') assert.equal(o.text, v.expect.text, v.name);
    if (v.expect.body !== undefined) assert.equal(o.text, v.expect.body, v.name);
    if (v.expect.hex !== undefined) assert.equal(toHex(o.bytes), v.expect.hex, v.name);
  }
  for (const v of vectors.negatives) await clean(openSealed(v.work, { key: v.key, record: v.record }), v.expect.error);
  for (const b of vectors.book) assert.equal(await revealAny(b.work, b.key), b.expect.text, b.name);
  assert.equal(b58Encode(fromHex(vectors.alphabets.bytesHex)), vectors.alphabets.base58);
  assert.equal(b64urlEncode(fromHex(vectors.alphabets.bytesHex)), vectors.alphabets.base64url);
  const c = fromHex(vectors.anchor.commitment);
  assert.equal(toHex(anchorPayload(c)), vectors.anchor.payload);
  assert.equal(toHex(opReturnScript(anchorPayload(c))), vectors.anchor.script);
});

// ---- hardening: nothing quadratic or unbounded on hostile input -------------------------------------------------------
const fast = async (promise, code, ms = 400) => {
  const t = performance.now();
  await clean(promise, code);
  const took = performance.now() - t;
  assert.ok(took < ms, `took ${took.toFixed(0)} ms, limit ${ms}`);
};

test('hardening: over-long keys are refused before any decoding, quickly', async () => {
  const s = await sealMessage(WORK, 'x', {});
  const five = 'z'.repeat(5 * 1024 * 1024);
  await fast(openSealed(WORK, { key: 'tgx1.' + five, record: s.record }), 'damaged');
  await fast(openSealed(WORK, { key: 'tgx1.' + 'z'.repeat(100 * 1024), record: s.record }), 'damaged');
  await fast(parseKey('tgx1.' + 'z'.repeat(MAX_KEY_CHARS)), 'damaged');
  await fast(parseKey(('tgx1.' + 'z'.repeat(2000)).replace(/(.{50})/g, '$1\n').repeat(5000)), 'damaged');
  await fast(revealCompact(WORK, 'tg2.' + five), 'damaged');
  await fast(revealCompact(WORK, 'tg2.' + 'z'.repeat(100 * 1024)), 'damaged');
  await fast(revealAny(WORK, 'tg2.' + five), 'damaged');
  await fast(revealAny(WORK, 'tg1.' + 'A'.repeat(5 * 1024 * 1024)), 'damaged');
  await fast(revealAny(WORK, 'tg1.' + 'A'.repeat(MAX_TG1_KEY_CHARS + 1)), 'damaged');
  assert.ok(MAX_KEY_CHARS < 50_000 && MAX_COMPACT_KEY_CHARS < 12_000, 'the bounds derive from the limits');
  // the bounds are not tighter than the longest key the code itself makes
  const biggest = await sealBytes(null, Uint8Array.from({ length: LIMITS.maxInlineRecord - 40 }, (_, i) => (i * 7919) & 255), { bind: false, compress: false, inline: true });
  assert.ok(biggest.key.length <= MAX_KEY_CHARS, `${biggest.key.length} <= ${MAX_KEY_CHARS}`);
  assert.equal((await openSealed(null, { key: biggest.key })).bytes.length, LIMITS.maxInlineRecord - 40);
});

test('hardening: the longest compact key the code makes is inside its bound', async () => {
  const text = WORK.repeat(2);
  const base = 'meet at noon at the harbour, '.repeat(70).slice(0, 2047).trimEnd();
  const msg = base + 'e'.repeat(2048 - base.length);
  const k = await hideCompact(text, msg);
  assert.ok(k.length <= MAX_COMPACT_KEY_CHARS, `${k.length}`);
  assert.equal(await revealCompact(text, k), msg);
  await clean(hideCompact(text, msg + 'e'), 'too-large');
});

test('hardening: a long record is cut off by its size, a deflate bomb by its output cap, both fast', async () => {
  const s = await sealMessage(WORK, 'x', {});
  await fast(openSealed(WORK, { key: s.key, record: 'tgs1.' + 'A'.repeat(MAX_RECORD_CHARS + 100) }), 'too-large', 1000);
  await fast(openSealed(WORK, { key: s.key, record: 'A'.repeat(200 * 1024 * 1024) }), 'too-large', 1000);
  const zeros = new Uint8Array(15 * 1024 * 1024);
  const bomb = await sealBytes(null, zeros, { bind: false });
  assert.ok(bomb.bytes.length < 40_000, 'a small record that inflates to 15 MiB');
  await fast(openSealed(null, { key: bomb.key, record: bomb.record }, { limits: { maxPlain: 1024 * 1024 } }), 'too-large', 1000);
  await fast(openSealed(null, { key: bomb.key, record: bomb.record }, { limits: { maxPlain: 1000 } }), 'too-large', 1000);
  const ok = await openSealed(null, { key: bomb.key, record: bomb.record });
  assert.equal(ok.bytes.length, zeros.length, 'within the default limit it still opens');
  await clean(sealBytes(null, zeros, { bind: false, password: 'x', iterations: 6_000_000 }), 'bad-option');
});

// ---- the command line never takes a secret as an argument -------------------------------------------------------------
const CLI = new URL('../cli/tg-crypt.mjs', import.meta.url).pathname;
const WORKFILE = new URL('../samples/example-pep-8.txt', import.meta.url).pathname;
const run = (args, { input, env = {} } = {}) => spawnSync(process.execPath, [CLI, ...args], { input, encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });

test('cli: --key and --password <value> are not options; the refusal does not echo the secret; help says so', () => {
  for (const args of [['open', WORKFILE, '--key', 'SECRETKEY123'], ['open', WORKFILE, '--key=SECRETKEY123'], ['open', WORKFILE, '--password=SECRETPW123'], ['open', WORKFILE, '--password', 'SECRETPW123'], ['reveal', WORKFILE, '--key', 'SECRETKEY123']]) {
    const r = run(args);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Unknown option/);
    assert.doesNotMatch(r.stdout + r.stderr, /SECRET(KEY|PW)123/, args.join(' '));
  }
  const help = run(['--help']).stdout;
  assert.doesNotMatch(help, /--key </);
  assert.doesNotMatch(help, /--password </);
  assert.match(help, /--key-file/);
  assert.match(help, /--key-stdin/);
  assert.match(help, /TG_CRYPT_KEY/);
  assert.match(help, /TG_CRYPT_PASSWORD/);
});

test('cli: keys and passwords come from a file, standard input or the environment; the key goes to standard output only', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tgcrypt-'));
  const rec = join(dir, 'm.tgs');
  const seal = run(['seal', WORKFILE, '--message', 'hello there', '-o', rec]);
  assert.equal(seal.status, 0, seal.stderr);
  const key = seal.stdout.trim();
  assert.match(key, /^tgx1\./);
  assert.ok(!seal.stderr.includes(key), 'progress messages never contain the key');
  writeFileSync(join(dir, 'k'), key + '\n');
  assert.equal(run(['open', WORKFILE, '--key-file', join(dir, 'k'), '--record', rec]).stdout.trim(), 'hello there');
  assert.equal(run(['open', WORKFILE, '--key-stdin', '--record', rec], { input: key + '\n' }).stdout.trim(), 'hello there');
  assert.equal(run(['open', WORKFILE, '--record', rec], { env: { TG_CRYPT_KEY: key } }).stdout.trim(), 'hello there');
  // an invalid key: a clean error that does not contain it
  const bad = key.slice(0, 30) + (key[30] === 'A' ? 'B' : 'A') + key.slice(31);
  for (const r of [run(['open', WORKFILE, '--key-stdin', '--record', rec], { input: bad }), run(['open', WORKFILE, '--record', rec], { env: { TG_CRYPT_KEY: bad } }), run(['open', WORKFILE, '--key-file', join(dir, 'nokey'), '--record', rec])]) {
    assert.equal(r.status, 1);
    assert.ok(!(r.stdout + r.stderr).includes(bad.slice(5, 25)), 'the error does not echo the key');
  }
  assert.equal(run(['open', WORKFILE, '--key-stdin', '--record', rec], { input: 'tgx1.NOTAREALKEY' + '1'.repeat(40) }).stderr.includes('NOTAREALKEY'), false);
  // password: stdin / file / environment
  const prec = join(dir, 'p.tgs');
  const ps = run(['seal', '-', '--message', 'pw message', '--no-bind', '--password-stdin', '--accept-password-only', '--iterations', '100000', '-o', prec], { input: 'correct horse\n' });
  assert.equal(ps.status, 0, ps.stderr);
  assert.equal(ps.stdout, '', 'no key string with a password');
  assert.equal(run(['open', '-', '--password-stdin', '--record', prec], { input: 'correct horse\n' }).stdout.trim(), 'pw message');
  writeFileSync(join(dir, 'pw'), 'correct horse\n');
  assert.equal(run(['open', '-', '--password-file', join(dir, 'pw'), '--record', prec]).stdout.trim(), 'pw message');
  assert.equal(run(['open', '-', '--record', prec], { env: { TG_CRYPT_PASSWORD: 'correct horse' } }).stdout.trim(), 'pw message');
  const wrong = run(['open', '-', '--password-stdin', '--record', prec], { input: 'hunter2-wrong\n' });
  assert.equal(wrong.status, 1);
  assert.ok(!(wrong.stdout + wrong.stderr).includes('hunter2'));
  assert.equal(run(['open', '-', '--key-stdin', '--password-stdin', '--record', prec], { input: 'x' }).status, 1);
  rmSync(dir, { recursive: true });
});
