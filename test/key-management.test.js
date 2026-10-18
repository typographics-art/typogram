// Key management (docs/key-management.md): master and record keys, recipient sealing, hidden work binding, splitting,
// password mixing, the vault, the CLI. Frozen vectors: test/fixtures/key-management-vectors.json (scripts/build-key-vectors.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, statSync, lstatSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, argon2Sync } from 'node:crypto';
import {
  mnemonicToEntropy, mnemonicToSeed, entropyToMnemonic, seedFromHex, slip21Master, slip21Child, slip21Path, masterFromSeed, formatMaster, parseMaster,
  recordKey, recipientSecret, hmac, MASTER_PREFIX, LIMITS as KLIMITS,
} from '../src/keys.js';
import { BIP39_ENGLISH } from '../src/keys-wordlist-en.js';
import { newRecipient, parsePublic, parseSecret, publicFromSecret, formatPublic, sealTo, sealTextTo, sealBytesTo, openFrom, parseSealedTo } from '../src/keys-seal.js';
import { sealBound2, sealWithSecret, openAny, openWithSecret, parseKey2, formatKey2, workTag, assertPublishable, KEY2_PREFIX } from '../src/keys-work.js';
import {
  gfMul, gfInv, gfEval, gfInterpolate0, splitXor, splitShamir, joinShares, parseShare, newMixed, mixKey, mixedKey, parseHalf, createVault, openVault, describeVault,
  generatePassphrase, prfInput, factorFromPrf, factorFromMaster,
} from '../src/keys-split.js';
import { stretch, checkParams, DEFAULT_PARAMS } from '../src/keys-kdf.js';
import { sealMessage, openSealed, parseKey, workDigest, CryptError } from '../src/crypt.js';
import { seededRandom, toHex, fromHex, utf8, sha256, b58Encode, concat, b64urlEncode, b64urlDecode, checksum } from '../src/crypt-codec.js';
import { build, WORK } from '../scripts/build-key-vectors.mjs';

const vectors = JSON.parse(readFileSync(new URL('./fixtures/key-management-vectors.json', import.meta.url), 'utf8'));
const FAST = { kdf: 'pbkdf2-sha512', iterations: 100000 }, FAST_ARGON = { kdf: 'argon2id', memoryKiB: 8192, passes: 1, parallelism: 1 };
const text = (s) => ({ kind: 'text', payload: utf8(s) });
const rejects = async (fn, code) => { try { await fn(); } catch (e) { assert.ok(e instanceof CryptError, `not a CryptError: ${e?.stack}`); if (code) assert.equal(e.code, code, e.message); return e; } assert.fail('should have thrown'); };
/** Every failure must be a CryptError; returns how many calls failed. */
async function cleanErrors(fn, inputs) { let n = 0; for (const x of inputs) { try { await fn(x); } catch (e) { assert.ok(e instanceof CryptError, `${String(x).slice(0, 30)} -> ${e?.stack}`); n++; } } return n; }
const rand = seededRandom('fuzz');
const fuzzStrings = (prefix, count, max = 120) => Array.from({ length: count }, (_, i) => { const b = new Uint8Array(1 + (i * 7) % max); rand(b); return prefix + [...b].map((x) => String.fromCharCode(33 + (x % 94))).join(''); });

// ---- data files -------------------------------------------------------------------------------------------------------
test('wordlist: the 2048 BIP-39 English words, hash of the published file, unique 4-letter prefixes', () => {
  assert.equal(BIP39_ENGLISH.length, 2048);
  assert.equal(createHash('sha256').update(BIP39_ENGLISH.join('\n') + '\n').digest('hex'), '2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda');
  assert.deepEqual([...BIP39_ENGLISH].sort(), [...BIP39_ENGLISH], 'sorted');
  assert.equal(new Set(BIP39_ENGLISH.map((w) => w.slice(0, 4))).size, 2048);
  assert.match(readFileSync(new URL('../src/keys-wordlist-en.js', import.meta.url), 'utf8'), /Licence: MIT/);
});
test('vendored Argon2id: files match SHA256SUMS; the JavaScript result equals Node\'s native Argon2id', async () => {
  const dir = new URL('../assets/vendor/noble-hashes/', import.meta.url);
  for (const line of readFileSync(new URL('SHA256SUMS', dir), 'utf8').trim().split('\n')) {
    const [sum, name] = line.split(/\s+/);
    assert.equal(createHash('sha256').update(readFileSync(new URL(name, dir))).digest('hex'), sum, name);
  }
  const salt = new Uint8Array(16).fill(9);
  for (const [m, t, p] of [[8192, 1, 1], [8192, 2, 2], [19456, 2, 1]]) {
    const js = await stretch('pässword ✓', salt, { kdf: 'argon2id', memoryKiB: m, passes: t, parallelism: p });
    const native = argon2Sync('argon2id', { message: Buffer.from('pässword ✓'.normalize('NFC')), nonce: salt, parallelism: p, tagLength: 32, memory: m, passes: t });
    assert.equal(toHex(js), native.toString('hex'), `m=${m} t=${t} p=${p}`);
  }
});
test('kdf parameters: bounds are enforced (a public record cannot make a reader burn memory)', async () => {
  for (const bad of [{ kdf: 'argon2id', memoryKiB: 2 ** 30, passes: 3, parallelism: 1 }, { kdf: 'argon2id', memoryKiB: 8192, passes: 0, parallelism: 1 }, { kdf: 'pbkdf2-sha512', iterations: 10 }, { kdf: 'md5' }, null, {}]) await rejects(async () => checkParams(bad), 'bad-option');
  await rejects(() => stretch('', new Uint8Array(16), FAST), 'no-key');
  await rejects(() => stretch('x', new Uint8Array(4), FAST), 'bad-option');
});

// ---- frozen vectors ---------------------------------------------------------------------------------------------------
test('vectors: regenerating gives exactly the frozen file', async () => {
  assert.deepEqual(JSON.parse(JSON.stringify(await build())), vectors);
});
test('vectors: BIP-39 (the Trezor vector), SLIP-21 (the four published keys), entropy round trip', async () => {
  assert.equal(vectors.bip39[0].seed, 'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04');
  assert.equal(vectors.bip39[2].seed.slice(0, 32), 'c76c4ac4f4e4a00d6b274d5c39c700bb');
  assert.deepEqual(vectors.slip21.map((x) => x.key), ['dbf12b44133eaab506a740f6565cc117228cbf1dd70635cfa8ddfdc9af734756', '1d065e3ac1bbe5c7fad32cf2305f7d709dc070d672044a19e610c77cdf33de0d', 'ea163130e35bbafdf5ddee97a17b39cef2be4b4f390180d65b54cf05c6a82fde', '47194e938ab24cc82bfa25f6486ed54bebe79c40ae2a5a32ea6db294d81861a6']);
  for (const e of vectors.entropy) { assert.deepEqual([...(await mnemonicToEntropy(e.mnemonic)).entropy], [...fromHex(e.entropy)]); }
  assert.equal(vectors.entropy[0].mnemonic.split(' ').length, 12);
  assert.equal(vectors.entropy[2].mnemonic.split(' ').length, 24);
  assert.equal(vectors.entropy[3].mnemonic.split(' ').length, 18);
});
test('vectors: every frozen record and share opens to its plaintext', async () => {
  const master = await parseMaster(vectors.master.text);
  assert.equal(toHex(master), vectors.master.master);
  const K = await recordKey(master, 'tgx2-vector');
  assert.equal((await openAny(WORK, { key: vectors.sealedWithSecret.key, record: vectors.sealedWithSecret.record })).text, vectors.sealedWithSecret.plain);
  assert.equal((await openWithSecret(WORK, K, vectors.sealedWithSecret.record)).text, vectors.sealedWithSecret.plain);
  const rs = await recipientSecret(master, 0);
  assert.equal((await openFrom(rs, vectors.sealTo[0].record, { context: vectors.sealTo[0].context })).text, vectors.sealTo[0].plain);
  assert.equal(toHex((await openFrom(rs, vectors.sealTo[1].record)).bytes), vectors.sealTo[1].plainHex);
  assert.equal(toHex(await joinShares(vectors.xor)), vectors.secretHex);
  assert.equal(toHex(await joinShares([vectors.shamir[4], vectors.shamir[0], vectors.shamir[2]])), vectors.secretHex);
  for (const m of vectors.mixed) assert.equal(toHex(await mixedKey(m.half, m.password)), m.key);
  const o = await openVault(vectors.vault.vault, { seed: { key: await factorFromMaster(master) }, passphrase: { passphrase: vectors.vault.passphrase } });
  assert.equal(toHex(o.secret), vectors.vault.secret);
  assert.equal(vectors.passphrase.split(' ').length, 8);
});

// ---- A: master and record keys ----------------------------------------------------------------------------------------
test('mnemonic: 12/15/18/21/24 words checked; errors are clean and never quote the words', async () => {
  const good = vectors.entropy[0].mnemonic;
  assert.equal((await mnemonicToEntropy('  ' + good.toUpperCase().replace(/ /g, '\n ') + ' ')).words, 12);
  const swapped = good.replace('about', 'abandon');
  const e1 = await rejects(() => mnemonicToSeed(swapped), 'mnemonic-checksum');
  const e2 = await rejects(() => mnemonicToSeed(good.replace('about', 'secretword')), 'mnemonic-unknown-word');
  const e3 = await rejects(() => mnemonicToSeed(good + ' abandon'), 'mnemonic-words');
  for (const e of [e1, e2, e3]) assert.doesNotMatch(e.message, /secretword|abandon|about/);
  await rejects(() => mnemonicToSeed(''), 'mnemonic-words');
  await rejects(() => mnemonicToSeed('x '.repeat(2000)), 'too-large');
  for (const n of [16, 20, 24, 28, 32]) assert.equal((await entropyToMnemonic(new Uint8Array(n).fill(n))).split(' ').length, n * 3 / 4);
  await rejects(() => entropyToMnemonic(new Uint8Array(15)), 'bad-option');
  // a one-word typo in every position of a 12-word mnemonic is caught (checksum 4 bits: 1 in 16 slips through by design; count them)
  let slips = 0, tries = 0;
  const words = good.split(' ');
  for (let i = 0; i < 12; i++) for (const w of ['zoo', 'wrong', 'ability']) { if (w === words[i]) continue; tries++; const t = [...words]; t[i] = w; try { await mnemonicToEntropy(t.join(' ')); slips++; } catch (e) { assert.ok(e instanceof CryptError); } }
  assert.ok(slips <= tries / 4, `${slips} of ${tries} typos passed the checksum`);
});
test('seed from hex: 16 to 64 bytes only', async () => {
  assert.equal(seedFromHex('00'.repeat(16)).length, 16);
  for (const bad of ['', 'zz'.repeat(16), '00'.repeat(15), '00'.repeat(65), '0'.repeat(33)]) assert.throws(() => seedFromHex(bad), (e) => e instanceof CryptError);
});
test('slip-21: only below "tgart"; the wallet trees are disjoint (HMAC key differs from BIP-32\'s "Bitcoin seed")', async () => {
  const seed = await mnemonicToSeed(vectors.entropy[0].mnemonic);
  for (const labels of [[], ['SLIP-0021'], ['m', "44'", "20'"], ['tgart', ''], Array(9).fill('tgart'), 'tgart']) await rejects(() => slip21Path(seed, labels), 'bad-option');
  await rejects(() => slip21Master(new Uint8Array(8)), 'bad-seed');
  const master = await masterFromSeed(seed);
  const bip32 = await hmac('SHA-512', utf8('Bitcoin seed'), seed);
  const node = await slip21Master(seed);
  for (const part of [bip32.slice(0, 32), bip32.slice(32), node.key, node.chain]) assert.notEqual(toHex(part), toHex(master));
  assert.notEqual(toHex(node.key), toHex(bip32.slice(0, 32)));
  // the DigiByte derivation the platform uses is BIP-32 under m/44'/20'/0'/0/i: its first step is HMAC("Bitcoin seed", seed); nothing here uses it
  const src = ['keys.js', 'keys-seal.js', 'keys-work.js', 'keys-split.js', 'keys-kdf.js'].map((f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8').replace(/^\/\/.*$/gm, '')).join('\n');
  assert.doesNotMatch(src, /Bitcoin seed|secp256k1|44'/);
});
test('master text: round trip, typo, prefix, version, length', async () => {
  const m = await parseMaster(vectors.master.text);
  assert.equal(await formatMaster(m), vectors.master.text);
  assert.equal(toHex(await parseMaster(' ' + vectors.master.text.replace(/(.{10})/g, '$1\n') + ' ')), toHex(m));
  const t = vectors.master.text;
  await rejects(() => parseMaster(t.slice(0, 20) + (t[20] === 'A' ? 'B' : 'A') + t.slice(21)), 'checksum');
  await rejects(() => parseMaster('tgx1.' + t.slice(6)), 'bad-prefix');
  await rejects(() => parseMaster(''), 'no-key');
  await rejects(() => parseMaster(MASTER_PREFIX + '1'.repeat(300)), 'damaged');
  assert.ok(await cleanErrors(parseMaster, fuzzStrings(MASTER_PREFIX, 200)) > 190);
});
test('record keys: unrelated for different ids and contexts; the master never appears; one key reveals neither the master nor another key', async () => {
  const master = await parseMaster(vectors.master.text);
  const keys = [];
  for (let i = 0; i < 300; i++) keys.push(await recordKey(master, `record-${i}`));
  assert.equal(new Set(keys.map(toHex)).size, 300);
  // unrelated: Hamming distance between any two keys is about 128 of 256 bits
  let min = 256, max = 0;
  for (let i = 1; i < 300; i++) { let d = 0; for (let j = 0; j < 32; j++) { let x = keys[0][j] ^ keys[i][j]; while (x) { d += x & 1; x >>= 1; } } min = Math.min(min, d); max = Math.max(max, d); }
  assert.ok(min > 90 && max < 166, `Hamming distances ${min}..${max}`);
  assert.notEqual(toHex(await recordKey(master, 'a', 'x')), toHex(await recordKey(master, 'a', '')));
  assert.notEqual(toHex(await recordKey(master, 'ab', 'c')), toHex(await recordKey(master, 'a', 'bc')), 'framing: id and context cannot slide into each other');
  assert.equal(toHex(await recordKey(master, 'é')), toHex(await recordKey(master, 'é')), 'NFC');
  // the master is in no output of any function (sealed record, keys, shares, vault, recipient key)
  const outputs = [...keys.map(toHex), await formatKey2({ secret: keys[0] }), (await sealWithSecret(WORK, text('x'), keys[1])).record, (await sealWithSecret(WORK, text('x'), keys[1])).key, toHex(await recipientSecret(master, 3)), ...await splitShamir(keys[2], 2, 3), ...await splitXor(keys[2], 2), (await createVault([{ name: 'a', key: keys[3] }, { name: 'b', key: keys[4] }], { mode: 'strict' })).vault, (await createVault([{ name: 'seed', master }, { name: 'a', key: keys[3] }, { name: 'b', key: keys[4] }])).vault];
  const mh = toHex(master), mt = vectors.master.text.slice(6, 30);
  for (const o of outputs) { assert.ok(!o.includes(mh) && !o.includes(mt)); }
  const raw = (await sealWithSecret(WORK, text('x'), keys[1])).bytes;
  assert.ok(!toHex(raw).includes(mh));
  for (const bad of [new Uint8Array(31), 'x']) await rejects(() => recordKey(bad, 'a'), 'bad-option');
  await rejects(() => recordKey(master, ''), 'bad-option');
  await rejects(() => recordKey(master, 5), 'bad-option');
  await rejects(() => recordKey(master, 'x'.repeat(KLIMITS.maxId + 1)), 'bad-option');
  await rejects(() => recordKey(master, 'a', 'x'.repeat(KLIMITS.maxContext + 1)), 'bad-option');
  await recordKey(master, 'x'.repeat(KLIMITS.maxId), 'y'.repeat(KLIMITS.maxContext)); // the longest input stays under the 1024-byte HKDF info limit of Node
});
test('one record key is enough to open one record, and only that one', async () => {
  const master = await parseMaster(vectors.master.text);
  const k1 = await recordKey(master, 'one'), k2 = await recordKey(master, 'two');
  const a = await sealWithSecret(WORK, text('first'), k1), b = await sealWithSecret(WORK, text('second'), k2);
  assert.equal((await openAny(WORK, { key: a.key, record: a.record })).text, 'first');
  await rejects(() => openAny(WORK, { key: a.key, record: b.record }), 'auth-failed');
  assert.equal((await openWithSecret(WORK, k2, b.record)).text, 'second');
  // re-sealing the same id with new content: same key, fresh nonce
  const a2 = await sealWithSecret(WORK, text('first, revised'), k1);
  assert.equal(a.key, a2.key); assert.notEqual(a.record, a2.record);
  assert.equal((await openAny(WORK, { key: a.key, record: a2.record })).text, 'first, revised');
});

// ---- B: recipient sealing ---------------------------------------------------------------------------------------------
test('recipient: sealed to a public key, opened with the secret; ephemeral key per record; the record is authenticated', async () => {
  const r = await newRecipient(), other = await newRecipient();
  const a = await sealTextTo(r.public, 'dear owner', { context: 'ctx' }), b = await sealTextTo(r.public, 'dear owner', { context: 'ctx' });
  assert.notEqual(a.record, b.record);
  assert.notEqual(toHex(parseSealedTo(a.record).epk), toHex(parseSealedTo(b.record).epk));
  assert.equal((await openFrom(r.secret, a.record, { context: 'ctx' })).text, 'dear owner');
  await rejects(() => openFrom(other.secret, a.record, { context: 'ctx' }), 'auth-failed');
  await rejects(() => openFrom(r.secret, a.record, { context: 'other' }), 'auth-failed');
  await rejects(() => openFrom(r.secret, a.record), 'auth-failed');
  const big = Uint8Array.from({ length: 100000 }, (_, i) => (i * 31) & 255);
  const c = await sealBytesTo(r.public, big);
  assert.deepEqual([...(await openFrom(r.secret, c.record)).bytes], [...big]);
  const kinds = await sealTo(r.public, { kind: 'tgd', payload: utf8('{}') });
  assert.equal((await openFrom(r.secret, kinds.record)).kind, 'tgd');
  // every byte flipped is refused cleanly
  const bytes = parseSealedTo(a.record).bytes;
  const { b64urlEncode } = await import('../src/crypt-codec.js');
  let refused = 0;
  for (let i = 0; i < bytes.length; i++) {
    const t = Uint8Array.from(bytes); t[i] ^= 1 << (i % 8);
    try { await openFrom(r.secret, 'tgr1.' + b64urlEncode(t), { context: 'ctx' }); } catch (e) { assert.ok(e instanceof CryptError); refused++; }
  }
  assert.equal(refused, bytes.length);
  // the public key is not enough to open: it is not the secret
  await rejects(() => openFrom(r.public, a.record), 'bad-prefix');
  // a low-order public key (all zero) is refused as an ephemeral key
  const zero = Uint8Array.from(bytes); zero.fill(0, 2, 34);
  await rejects(() => openFrom(r.secret, 'tgr1.' + b64urlEncode(zero), { context: 'ctx' }));
});
test('recipient: key texts (typo, prefix, derived from the master, deterministic from a seeded source)', async () => {
  const master = await parseMaster(vectors.master.text);
  const s = await recipientSecret(master, 0), pub = await formatPublic(await publicFromSecret(s));
  assert.equal(pub, vectors.recipient.public0);
  assert.equal(toHex(await parsePublic(pub)), toHex(await publicFromSecret(s)));
  assert.notEqual(vectors.recipient.public0, vectors.recipient.public1);
  await rejects(() => parsePublic(pub.slice(0, 12) + (pub[12] === 'A' ? 'B' : 'A') + pub.slice(13)), 'checksum');
  await rejects(() => parsePublic(vectors.recipient.secretText0), 'bad-prefix');
  await rejects(() => parseSecret(pub), 'bad-prefix');
  await rejects(() => publicFromSecret(new Uint8Array(5)), 'bad-option');
  await rejects(() => sealTextTo('tgp1.nonsense', 'x'), 'damaged');
  assert.ok(await cleanErrors((x) => sealTextTo(x, 'x'), fuzzStrings('tgp1.', 100)) > 95);
  assert.ok(await cleanErrors((x) => openFrom(vectors.recipient.secretText0, x), fuzzStrings('tgr1.', 100, 300)) > 95);
  await rejects(() => sealTextTo(pub, 'x', { context: 5 }), 'bad-option');
  await rejects(() => sealTextTo(pub, 'x', { context: 'y'.repeat(513) }), 'bad-option');
});

// ---- C: hidden work binding -------------------------------------------------------------------------------------------
test('tgx2: the key is not longer than tgx1, does not carry the work fingerprint, still tells wrong work from wrong key', async () => {
  const a1 = await sealMessage(WORK, 'hello');
  const a2 = await sealBound2(WORK, text('hello'));
  assert.ok(a2.key.startsWith(KEY2_PREFIX));
  assert.equal(a1.key.length, 64); assert.equal(a2.key.length, 59);
  const d = await workDigest(WORK);
  // tgx1 shows the fingerprint, tgx2 does not
  assert.equal(toHex((await parseKey(a1.key)).fp), toHex(d.slice(0, 8)));
  const k2 = await parseKey2(a2.key);
  assert.equal(toHex(k2.tag).length, 8);
  assert.notEqual(toHex(k2.tag), toHex(d.slice(0, 4)));
  // two keys for the same work have unrelated tags: the tag is no identifier of the work
  const tags = new Set();
  for (let i = 0; i < 30; i++) tags.add(toHex((await parseKey2((await sealBound2(WORK, text('x'))).key)).tag));
  assert.equal(tags.size, 30);
  // an observer with a list of candidate works cannot test them against a tgx2 key without the secret: the tag depends on it
  assert.equal(toHex(await workTag(k2.secret, d)), toHex(k2.tag));
  assert.notEqual(toHex(await workTag(new Uint8Array(32), d)), toHex(k2.tag));
  // opening
  assert.equal((await openAny(WORK, { key: a2.key, record: a2.record })).text, 'hello');
  const e1 = await rejects(() => openAny(WORK + ' changed', { key: a2.key, record: a2.record }), 'wrong-work');
  assert.equal(e1.wrongText, true);
  await rejects(() => openAny(null, { key: a2.key, record: a2.record }), 'work-required');
  await rejects(() => openAny(WORK, { key: a2.key }), 'no-record');
  const other = await sealBound2(WORK, text('other'));
  await rejects(() => openAny(WORK, { key: a2.key, record: other.record }), 'auth-failed');
  // inline key: one string holds everything
  const inl = await sealBound2(WORK, text('inside'), { inline: true });
  assert.equal((await openAny(WORK, { key: inl.key })).text, 'inside');
  assert.equal((await openAny(WORK, { key: inl.key })).inline, true);
  // unbound
  const ub = await sealBound2(null, text('free'), { bind: false });
  assert.equal((await openAny('anything', { key: ub.key, record: ub.record })).text, 'free');
  // 128-bit
  const s16 = await sealBound2(WORK, text('short'), { strength: 128 });
  assert.ok(s16.key.length < a2.key.length);
  assert.equal((await openAny(WORK, { key: s16.key, record: s16.record })).text, 'short');
  // typo
  await rejects(() => openAny(WORK, { key: a2.key.slice(0, 20) + (a2.key[20] === 'A' ? 'B' : 'A') + a2.key.slice(21), record: a2.record }), 'checksum');
});
test('tgx2: old tgx1 keys and records still open through the same entry point (backward compatibility)', async () => {
  const a = await sealMessage(WORK, 'old style');
  assert.equal((await openAny(WORK, { key: a.key, record: a.record })).text, 'old style');
  assert.equal((await openSealed(WORK, { key: a.key, record: a.record })).text, 'old style');
  // a record made with a tgx2 key opens with the equivalent tgx1 key built by the old reader's rules
  const K = await recordKey(await parseMaster(vectors.master.text), 'compat');
  const s2 = await sealWithSecret(WORK, text('both'), K), s1 = await sealWithSecret(WORK, text('both'), K, { keyVersion: 1 });
  assert.match(s1.key, /^tgx1\./); assert.match(s2.key, /^tgx2\./);
  assert.equal((await openSealed(WORK, { key: s1.key, record: s2.record })).text, 'both');
});
test('tgx2: fuzz, and the distinctions that are lost are exactly the documented ones', async () => {
  assert.ok(await cleanErrors((x) => parseKey2(x), fuzzStrings(KEY2_PREFIX, 300)) > 290);
  assert.ok(await cleanErrors((x) => openAny(WORK, { key: x, record: x }), fuzzStrings(KEY2_PREFIX, 100)) > 95);
  // master-derived flow: a wrong work cannot be told from a wrong key (no tag exists to test), both are auth-failed
  const K = await recordKey(await parseMaster(vectors.master.text), 'lost');
  const s = await sealWithSecret(WORK, text('x'), K);
  await rejects(() => openWithSecret('other work', K, s.record), 'auth-failed');
  // with a tgx2 key, a wrong work IS told apart, except with probability 2^-32 per wrong work (tag collision), then auth-failed
  await rejects(() => openAny('other work', { key: s.key, record: s.record }), 'wrong-work');
});

// ---- D: splitting, mixing, vault --------------------------------------------------------------------------------------
test('gf(256): field laws and the AES test products', () => {
  assert.equal(gfMul(0x57, 0x83), 0xc1); // FIPS-197 section 4.2
  for (let a = 1; a < 256; a++) assert.equal(gfMul(a, gfInv(a)), 1);
  for (let a = 0; a < 256; a += 5) for (let b = 0; b < 256; b += 7) { assert.equal(gfMul(a, b), gfMul(b, a)); for (const c of [1, 2, 3, 0x53, 0xff]) assert.equal(gfMul(a, b ^ c), gfMul(a, b) ^ gfMul(a, c)); }
  assert.throws(() => gfInv(0), (e) => e instanceof CryptError);
  assert.equal(gfEval([5, 3, 1], 0), 5);
});
test('shamir: any k of n recover; k-1 do not; refusals are clean', async () => {
  const secret = fromHex(vectors.secretHex);
  const n = 5, k = 3, shares = await splitShamir(secret, k, n);
  const subsets = (arr, size) => (size === 0 ? [[]] : arr.flatMap((x, i) => subsets(arr.slice(i + 1), size - 1).map((s) => [x, ...s])));
  for (const s of subsets(shares, k)) assert.equal(toHex(await joinShares(s)), vectors.secretHex);
  for (const s of subsets(shares, 4)) assert.equal(toHex(await joinShares(s)), vectors.secretHex);
  assert.equal(toHex(await joinShares(shares)), vectors.secretHex);
  for (const s of subsets(shares, k - 1)) { const e = await rejects(() => joinShares(s), 'share-too-few'); assert.equal(e.needed, 3); assert.equal(e.given, 2); }
  // k-1 shares interpreted as a smaller polynomial give a wrong value, never the secret
  const parsed = await Promise.all(shares.slice(0, 2).map(parseShare));
  const guess = Uint8Array.from(secret, (_, j) => gfInterpolate0(parsed.map((p) => [p.index, p.data[j]])));
  assert.notEqual(toHex(guess), vectors.secretHex);
  // other split: shares do not mix
  const other = await splitShamir(secret, k, n);
  await rejects(() => joinShares([shares[0], shares[1], other[2]]), 'share-set');
  await rejects(() => joinShares([shares[0], shares[0], shares[1]]), 'share-duplicate');
  const xorShare = (await splitXor(secret, 2))[0];
  await rejects(() => joinShares([xorShare, shares[0], shares[1]]), 'share-set');
  // a damaged share is caught by its checksum, a damaged-but-valid-checksum share by the consistency check
  const t = shares[0];
  await rejects(() => joinShares([t.slice(0, 15) + (t[15] === 'A' ? 'B' : 'A') + t.slice(16), shares[1], shares[2]]), 'checksum');
  const p = await parseShare(shares[3]); // forge: a share at index 4 with other data and a correct checksum
  const { b58Encode: enc } = await import('../src/crypt-codec.js');
  const { checksum } = await import('../src/crypt-codec.js');
  const body = Uint8Array.from([1, 2, ...p.setId, p.k, p.n, p.index, ...p.data.map((x) => x ^ 1)]);
  const forged = 'tgsh1.' + enc(Uint8Array.from([...body, ...await checksum('tgsh1', body, 4)]));
  await rejects(() => joinShares([shares[0], shares[1], shares[2], forged]), 'share-inconsistent');
  for (const bad of [[], 'x', null]) await rejects(() => joinShares(bad), 'no-share');
  await rejects(() => splitShamir(secret, 1, 3), 'bad-option');
  await rejects(() => splitShamir(secret, 4, 3), 'bad-option');
  await rejects(() => splitShamir(new Uint8Array(0), 2, 3), 'bad-option');
  await rejects(() => splitShamir(new Uint8Array(256), 2, 3), 'bad-option');
  // 255 shares work
  const many = await splitShamir(new Uint8Array([1, 2, 3]), 2, 255);
  assert.deepEqual([...await joinShares([many[254], many[0]])], [1, 2, 3]);
});
test('shamir: exhaustive proof on one byte that k-1 shares carry no information (k = 2 and k = 3)', () => {
  // The share of x is secret + a1 x (+ a2 x^2). For every secret s and every value of the first share y1 (at x = 1),
  // the number of coefficient choices producing y1 must be the same constant: then y1 is uniform whatever s is.
  const counts2 = Array.from({ length: 256 }, () => new Uint32Array(256));
  for (let s = 0; s < 256; s++) for (let a1 = 0; a1 < 256; a1++) counts2[s][gfEval([s, a1], 1)]++;
  for (let s = 0; s < 256; s++) for (let y = 0; y < 256; y++) assert.equal(counts2[s][y], 1);
  // k = 3: two shares (x = 1, 2) of a degree-2 polynomial: every pair (y1, y2) arises from exactly one (a1, a2), for every secret
  for (let s = 0; s < 256; s++) {
    const seen = new Uint8Array(65536);
    for (let a1 = 0; a1 < 256; a1++) for (let a2 = 0; a2 < 256; a2++) seen[(gfEval([s, a1, a2], 1) << 8) | gfEval([s, a1, a2], 2)]++;
    for (let i = 0; i < 65536; i++) if (seen[i] !== 1) assert.fail(`secret ${s}: pair ${i} arises ${seen[i]} times`);
  }
});
test('shamir: the real splitter draws uniform coefficients (the share of one byte is uniform over many runs)', async () => {
  const hist = new Uint32Array(256);
  const rnd = seededRandom('uniform');
  for (let i = 0; i < 25600; i++) { const [s1] = await splitShamir(Uint8Array.of(0x42), 2, 2, { random: rnd }); hist[(await parseShare(s1)).data[0]]++; }
  // 100 expected per value; chi-square with 255 degrees of freedom: 99.99th percentile about 330
  const chi = hist.reduce((acc, c) => acc + ((c - 100) ** 2) / 100, 0);
  assert.ok(chi < 330, `chi-square ${chi.toFixed(1)}`);
});
test('xor: n of n, fewer give nothing; clean refusals; share tokens', async () => {
  const secret = fromHex(vectors.secretHex);
  for (const n of [2, 3, 5]) {
    const sh = await splitXor(secret, n);
    assert.equal(toHex(await joinShares(sh)), vectors.secretHex);
    await rejects(() => joinShares(sh.slice(1)), 'share-too-few');
  }
  const a = await splitXor(secret, 2), b = await splitXor(secret, 2);
  await rejects(() => joinShares([a[0], b[1]]), 'share-set');
  await rejects(() => splitXor(secret, 1), 'bad-option');
  await rejects(() => splitXor(secret, 17), 'bad-option');
  const p = await parseShare(a[0]);
  assert.equal(p.type, 'xor'); assert.equal(p.n, 2); assert.equal(p.data.length, 32);
  assert.ok(a[0].startsWith('tgsh1.'));
  // one share alone: the data is the XOR mask, uniform: two splits of the same secret give different first shares
  assert.notEqual(a[0], b[0]);
  assert.equal(toHex(await joinShares(a.map((s) => ` ${s.slice(0, 20)}\n${s.slice(20)} `))), vectors.secretHex, 'whitespace from copying is ignored');
});
test('shares: fuzz (random text, flipped characters) gives only clean errors', async () => {
  assert.ok(await cleanErrors(parseShare, fuzzStrings('tgsh1.', 300, 300)) > 290);
  const sh = await splitShamir(fromHex(vectors.secretHex), 2, 3);
  let caught = 0, total = 0;
  const alpha = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  for (let i = 6; i < sh[0].length; i += 3) { const c = alpha[(alpha.indexOf(sh[0][i]) + 1) % 58]; const t = sh[0].slice(0, i) + c + sh[0].slice(i + 1); total++; try { await joinShares([t, sh[1]]); } catch (e) { assert.ok(e instanceof CryptError); caught++; } }
  assert.equal(caught, total, 'a single changed character is always caught (4-byte checksum)');
});
test('mixing: the password alone is nothing; the half key alone is nothing; both give the key; wrong password gives a key that does not open', async () => {
  for (const params of [FAST, FAST_ARGON]) {
    const m = await newMixed('correct horse', { params });
    assert.match(m.half, /^tgxm1\./);
    assert.equal(toHex(await mixedKey(m.half, 'correct horse')), toHex(m.key));
    const wrong = await mixedKey(m.half, 'correct horsf');
    assert.notEqual(toHex(wrong), toHex(m.key));
    const h = await parseHalf(m.half);
    assert.notEqual(toHex(h.secret), toHex(m.key), 'the half key is not the key');
    // the same password with another half key gives an unrelated key (no password-only key exists)
    const m2 = await newMixed('correct horse', { params });
    assert.notEqual(toHex(m2.key), toHex(m.key));
    const rec = await sealWithSecret(WORK, text('guarded'), m.key);
    assert.equal((await openWithSecret(WORK, m.key, rec.record)).text, 'guarded');
    await rejects(() => openWithSecret(WORK, wrong, rec.record), 'auth-failed');
    assert.equal(h.params.kdf, params.kdf);
  }
  assert.equal(toHex(await mixedKey(' ' + (await newMixed('é', { params: FAST, random: seededRandom('q') })).half + ' ', 'é')), toHex(await mixedKey((await newMixed('é', { params: FAST, random: seededRandom('q') })).half, 'é')), 'NFC');
  await rejects(() => newMixed('', { params: FAST }), 'no-key');
  await rejects(() => mixKey(new Uint8Array(31), 'x', FAST), 'bad-option');
  await rejects(() => parseHalf('tgxm1.' + '1'.repeat(300)), 'damaged');
  assert.ok(await cleanErrors(parseHalf, fuzzStrings('tgxm1.', 200)) > 190);
  const t = (await newMixed('x', { params: FAST })).half;
  await rejects(() => parseHalf(t.slice(0, 15) + (t[15] === 'A' ? 'B' : 'A') + t.slice(16)), 'checksum');
});
test('vault: any 2 of 3 factors open it; the passphrase alone never; rules enforced; wrong factors are skipped', async () => {
  const master = await parseMaster(vectors.master.text);
  const seed = await factorFromMaster(master), passkey = await factorFromPrf(new Uint8Array(32).fill(3));
  const { vault, secret } = await createVault([{ name: 'seed', key: seed }, { name: 'passkey', key: passkey }, { name: 'passphrase', passphrase: 'alpha beta gamma delta', params: FAST }], { mode: 'strict' });
  const d = await describeVault(vault);
  assert.deepEqual([d.k, d.n, d.factors.map((f) => f.name)], [2, 3, ['seed', 'passkey', 'passphrase']]);
  const sets = { seed: { key: seed }, passkey: { key: passkey }, passphrase: { passphrase: 'alpha beta gamma delta' } };
  for (const names of [['seed', 'passkey'], ['seed', 'passphrase'], ['passkey', 'passphrase'], ['seed', 'passkey', 'passphrase']]) {
    const o = await openVault(vault, Object.fromEntries(names.map((n) => [n, sets[n]])));
    assert.equal(toHex(o.secret), toHex(secret), names.join('+'));
  }
  for (const only of ['seed', 'passkey', 'passphrase']) { const e = await rejects(() => openVault(vault, { [only]: sets[only] }), 'vault-too-few'); assert.equal(e.have, 1); assert.equal(e.need, 2); }
  await rejects(() => openVault(vault, {}), 'vault-too-few');
  const e = await rejects(() => openVault(vault, { seed: sets.seed, passphrase: { passphrase: 'wrong words' } }), 'vault-too-few');
  assert.equal(e.have, 1);
  await rejects(() => openVault(vault, { seed: { key: new Uint8Array(32) }, passkey: sets.passkey }), 'vault-too-few');
  // the vault secret then serves as the master of record keys
  assert.equal((await recordKey(secret, 'r')).length, 32);
  // rules
  const k = () => crypto.getRandomValues(new Uint8Array(32));
  await rejects(() => createVault([{ name: 'a', passphrase: 'one one' }, { name: 'b', passphrase: 'two two' }, { name: 'c', key: k() }], { k: 2, mode: 'strict' }), 'bad-option');
  await rejects(() => createVault([{ name: 'a', passphrase: 'one' }, { name: 'b', passphrase: 'two' }], { k: 2, mode: 'strict' }), 'bad-option');
  await rejects(() => createVault([{ name: 'a', key: k() }], { k: 2, mode: 'strict' }), 'bad-option');
  await rejects(() => createVault([{ name: 'a', key: k() }, { name: 'b', key: k() }], { k: 1, mode: 'strict' }), 'bad-option');
  await rejects(() => createVault([{ name: 'a', key: k() }, { name: 'a', key: k() }], { mode: 'strict' }), 'bad-option');
  await rejects(() => createVault([{ name: 'A', key: k() }, { name: 'b', key: k() }], { mode: 'strict' }), 'bad-option');
  await rejects(() => createVault([{ name: 'a', key: new Uint8Array(5) }, { name: 'b', key: k() }], { mode: 'strict' }), 'bad-option');
  // 3 of 3 with two passphrases is fine (a set of 3 needs a key factor? no: k=3 allows 2 passphrases, needs the third factor)
  const v3 = await createVault([{ name: 'a', key: k() }, { name: 'b', passphrase: 'x y', params: FAST }, { name: 'c', passphrase: 'z w', params: FAST }], { k: 3, mode: 'strict' });
  assert.equal((await describeVault(v3.vault)).k, 3);
  // a 2-of-3 vault with a wrong-factor check: tampering is refused
  const bytes = vault;
  const tampered = bytes.slice(0, 40) + (bytes[40] === 'A' ? 'B' : 'A') + bytes.slice(41);
  await rejects(() => openVault(tampered, sets), 'checksum');
  assert.ok(await cleanErrors((x) => openVault(x, sets), fuzzStrings('tgv1.', 200, 400)) > 190);
  assert.ok(await cleanErrors((x) => describeVault(x), fuzzStrings('', 50)) > 45);
});
test('vault with argon2id passphrase factor (the default parameters)', async () => {
  const { vault, secret } = await createVault([{ name: 'seed', key: new Uint8Array(32).fill(1) }, { name: 'phrase', passphrase: 'orbit vivid yellow pencil', params: FAST_ARGON }], { mode: 'strict' });
  const d = await describeVault(vault);
  assert.deepEqual(d.factors[1].params, FAST_ARGON);
  assert.equal(toHex((await openVault(vault, { seed: { key: new Uint8Array(32).fill(1) }, phrase: { passphrase: 'orbit vivid yellow pencil' } })).secret), toHex(secret));
  assert.deepEqual(DEFAULT_PARAMS, { kdf: 'argon2id', memoryKiB: 65536, passes: 3, parallelism: 1 });
});
test('vault, default mode (decision 13.2): V is the master, the seed alone recovers everything, passkey + passphrase open it without the seed, a passphrase alone never', async () => {
  const master = await parseMaster(vectors.master.text), passkey = await factorFromPrf(new Uint8Array(32).fill(3));
  const factors = [{ name: 'seed', master }, { name: 'passkey', key: passkey }, { name: 'passphrase', passphrase: 'alpha beta gamma delta', params: FAST }];
  const { vault, secret } = await createVault(factors); // no mode given: the default
  assert.ok(vault.startsWith('tgv2.')); assert.equal(toHex(secret), toHex(master), 'V = master');
  assert.ok((await createVault(factors, { mode: 'default' })).vault.startsWith('tgv2.'));
  // the header: version 2, mode 0 (default), k 2, n 2; the mode is visible without any factor
  assert.deepEqual([...b64urlDecode(vault.slice(5)).slice(0, 4)], [2, 0, 2, 2]);
  const d = await describeVault(vault);
  assert.deepEqual([d.mode, d.k, d.n, d.seed, d.factors.map((f) => [f.name, f.passphrase])], ['default', 2, 2, true, [['passkey', false], ['passphrase', true]]]);
  // the seed path: the master is the secret, checked against the vault; without any vault, the master simply is the secret
  const bySeed = await openVault(vault, { master });
  assert.equal(toHex(bySeed.secret), toHex(master)); assert.deepEqual(bySeed.used, ['master']);
  assert.equal(toHex(await masterFromSeed(seedFromHex(vectors.master.seedHex))), toHex(master), 'the seed alone gives V: no vault needed');
  await rejects(() => openVault(vault, { master: new Uint8Array(32).fill(9) }), 'vault-mismatch');
  await rejects(() => openVault(vault, { master: new Uint8Array(31) }), 'bad-option');
  // the convenience path: 2-of-2; each alone gives vault-too-few with the numbers; a wrong passphrase is skipped
  const both = await openVault(vault, { passkey: { key: passkey }, passphrase: { passphrase: 'alpha beta gamma delta' } });
  assert.equal(toHex(both.secret), toHex(master)); assert.deepEqual(both.used, ['passkey', 'passphrase']);
  for (const only of [{ passkey: { key: passkey } }, { passphrase: { passphrase: 'alpha beta gamma delta' } }, {}]) { const e = await rejects(() => openVault(vault, only), 'vault-too-few'); assert.equal(e.need, 2); }
  assert.equal((await rejects(() => openVault(vault, { passkey: { key: passkey }, passphrase: { passphrase: 'wrong words' } }), 'vault-too-few')).have, 1);
  // THE RULE: without the seed a passphrase must never be enough (refused at creation, whatever k)
  await rejects(() => createVault([{ name: 'seed', master }, { name: 'passphrase', passphrase: 'one one', params: FAST }]), 'bad-option');
  await rejects(() => createVault([{ name: 'seed', master }, { name: 'passkey', key: passkey }, { name: 'passphrase', passphrase: 'one one', params: FAST }], { k: 1 }), 'bad-option');
  await rejects(() => createVault([{ name: 'seed', master }, { name: 'a', passphrase: 'one', params: FAST }, { name: 'b', passphrase: 'two', params: FAST }], { k: 2 }), 'bad-option');
  // a single passkey may stand alone without the seed (high entropy): 1-of-1
  const pkOnly = await createVault([{ name: 'seed', master }, { name: 'passkey', key: passkey }]);
  assert.equal((await describeVault(pkOnly.vault)).k, 1);
  assert.equal(toHex((await openVault(pkOnly.vault, { passkey: { key: passkey } })).secret), toHex(master));
  // 2-of-3 without the seed: two passkeys and a passphrase
  const three = await createVault([{ name: 'seed', master }, { name: 'phone', key: passkey }, { name: 'laptop', key: new Uint8Array(32).fill(7) }, { name: 'passphrase', passphrase: 'alpha beta gamma delta', params: FAST }], { k: 2 });
  assert.equal(toHex((await openVault(three.vault, { laptop: { key: new Uint8Array(32).fill(7) }, passphrase: { passphrase: 'alpha beta gamma delta' } })).secret), toHex(master));
  await rejects(() => openVault(three.vault, { passphrase: { passphrase: 'alpha beta gamma delta' } }), 'vault-too-few');
  // other rules: exactly one master factor of 32 bytes; no convenience factor named "master"; k in range; an unknown mode
  await rejects(() => createVault([{ name: 'a', key: passkey }, { name: 'b', key: new Uint8Array(32).fill(5) }]), 'bad-option');
  await rejects(() => createVault([{ name: 'seed', master }, { name: 'seed2', master }, { name: 'passkey', key: passkey }]), 'bad-option');
  await rejects(() => createVault([{ name: 'seed', master: new Uint8Array(31) }, { name: 'passkey', key: passkey }]), 'bad-option');
  await rejects(() => createVault([{ name: 'seed', master }, { name: 'master', key: passkey }]), 'bad-option');
  await rejects(() => createVault([{ name: 'seed', master }, { name: 'passkey', key: passkey }], { k: 2 }), 'bad-option');
  await rejects(() => createVault(factors, { mode: 'loose' }), 'bad-option');
  // tampering: any changed character is refused; the mode byte sits in the authenticated header, so a vault whose
  // mode byte was changed (with a fresh outer checksum) is refused outright, never read as another mode
  const tampered = vault.slice(0, 40) + (vault[40] === 'A' ? 'B' : 'A') + vault.slice(41);
  await rejects(() => openVault(tampered, { passkey: { key: passkey }, passphrase: { passphrase: 'alpha beta gamma delta' } }), 'checksum');
  const body = b64urlDecode(vault.slice(5)).slice(0, -4); body[1] = 1;
  const flipped = 'tgv2.' + b64urlEncode(concat(body, await checksum('tgv2', body, 4)));
  await rejects(() => openVault(flipped, { master }), 'version');
  assert.ok(await cleanErrors((x) => openVault(x, { master }), fuzzStrings('tgv2.', 200, 400)) > 190);
  assert.ok(await cleanErrors((x) => describeVault(x), fuzzStrings('tgv2.', 50)) > 45);
  // the strict vault is unchanged: random V, the seed one share that opens nothing alone, tgv1.
  const seedFactor = await factorFromMaster(master);
  const strict = await createVault([{ name: 'seed', key: seedFactor }, { name: 'passkey', key: passkey }], { mode: 'strict' });
  assert.ok(strict.vault.startsWith('tgv1.')); assert.notEqual(toHex(strict.secret), toHex(master)); assert.equal((await describeVault(strict.vault)).mode, 'strict');
  await rejects(() => openVault(strict.vault, { seed: { key: seedFactor } }), 'vault-too-few');
  await rejects(() => openVault(strict.vault, { master }), 'vault-too-few', 'a strict vault has no seed path');
});
test('vault, default mode: the frozen vector opens by the seed alone and by passkey + passphrase; the old strict vector is untouched', async () => {
  const v = vectors.vaultDefault, master = await parseMaster(vectors.master.text);
  assert.ok(v.vault.startsWith('tgv2.')); assert.equal(v.secret, vectors.master.master, 'the vector\'s V is the master of the frozen seed');
  assert.equal(toHex((await openVault(v.vault, { master })).secret), v.secret);
  const pk = await factorFromPrf(Uint8Array.from({ length: 32 }, (_, i) => 255 - i));
  assert.equal(toHex((await openVault(v.vault, { passkey: { key: pk }, passphrase: { passphrase: v.passphrase } })).secret), v.secret);
  await rejects(() => openVault(v.vault, { passphrase: { passphrase: v.passphrase } }), 'vault-too-few');
  assert.ok(vectors.vault.vault.startsWith('tgv1.')); assert.notEqual(vectors.vault.secret, vectors.master.master);
});
test('passphrase generator: words from the list, uniform, 11 bits each; passkey (WebAuthn PRF) helpers', async () => {
  const p = generatePassphrase(8);
  assert.equal(p.split(' ').length, 8);
  for (const w of p.split(' ')) assert.ok(BIP39_ENGLISH.includes(w));
  const hist = new Uint32Array(2048), rnd = seededRandom('words2');
  for (let i = 0; i < 2048 * 40; i++) hist[BIP39_ENGLISH.indexOf(generatePassphrase(1, { random: rnd }))]++;
  const chi = hist.reduce((a, c) => a + ((c - 40) ** 2) / 40, 0);
  assert.ok(chi < 2047 + 6 * Math.sqrt(2 * 2047), `chi-square ${chi.toFixed(0)}`);
  assert.throws(() => generatePassphrase(0), (e) => e instanceof CryptError);
  assert.equal((await prfInput('a')).length, 32);
  assert.notEqual(toHex(await prfInput('a')), toHex(await prfInput('b')));
  const f = await factorFromPrf(new Uint8Array(32).fill(1));
  assert.notEqual(toHex(f), toHex(new Uint8Array(32).fill(1)), 'the raw PRF output is never used as a key');
  await rejects(() => factorFromPrf(new Uint8Array(31)), 'bad-option');
});

// ---- the principle: a password is never the sole secret of a published record -----------------------------------------
test('password-only records: the library flags them, the publish rule refuses them, a mixed key passes', async () => {
  const pw = await sealMessage(null, 'pw', { bind: false, password: 'correct horse', iterations: 100000 });
  await rejects(async () => assertPublishable(pw.record), 'password-only-refused');
  assert.equal(assertPublishable(pw.record, { acceptPasswordOnly: true }), true);
  const keyed = await sealMessage(null, 'k', { bind: false });
  assert.equal(assertPublishable(keyed.record), true);
  const m = await newMixed('correct horse', { params: FAST });
  const mixed = await sealWithSecret(null, text('m'), m.key, { bind: false });
  assert.equal(assertPublishable(mixed.record), true);
});

// ---- CLI --------------------------------------------------------------------------------------------------------------
const CLI = new URL('../cli/tg-crypt.mjs', import.meta.url).pathname;
const WORKFILE = new URL('../samples/example-pep-8.txt', import.meta.url).pathname;
const run = (args, { input, env = {} } = {}) => spawnSync(process.execPath, [CLI, ...args], { input, encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
test('cli: master, derive, seal and open with a record id; secrets never as arguments, never echoed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tgkeys-'));
  try {
    const mn = join(dir, 'mn'); writeFileSync(mn, vectors.entropy[0].mnemonic + '\n');
    const m = run(['master', '--mnemonic-file', mn]);
    assert.equal(m.status, 0, m.stderr);
    const master = m.stdout.trim();
    assert.match(master, /^tgmk1\./);
    assert.ok(!m.stderr.includes(master) && !m.stderr.includes('abandon'));
    const same = run(['master', '--mnemonic-stdin'], { input: vectors.entropy[0].mnemonic });
    assert.equal(same.stdout.trim(), master);
    assert.equal(run(['master'], { env: { TG_CRYPT_MNEMONIC: vectors.entropy[0].mnemonic } }).stdout.trim(), master);
    const withPass = run(['master', '--mnemonic-stdin'], { input: vectors.entropy[0].mnemonic, env: { TG_CRYPT_BIP39_PASSPHRASE: 'TREZOR' } });
    assert.notEqual(withPass.stdout.trim(), master);
    const hexSeed = run(['master', '--seed-stdin'], { input: vectors.master.seedHex });
    assert.equal(hexSeed.stdout.trim(), vectors.master.text);
    // wrong inputs: clean errors without the words
    const bad = run(['master', '--mnemonic-stdin'], { input: vectors.entropy[0].mnemonic.replace('about', 'secretword') });
    assert.equal(bad.status, 1); assert.doesNotMatch(bad.stdout + bad.stderr, /secretword|abandon/);
    assert.equal(run(['master']).status, 1);
    assert.equal(run(['master', '--mnemonic-stdin', '--seed-stdin'], { input: 'x' }).status, 1);
    // never as an argument
    for (const args of [['master', '--mnemonic', 'abandon abandon'], ['derive', 'x', '--master', master], ['split', '--key', 'SECRETKEY123', '--xor', '2'], ['seal', '-', '--master=' + master, '--record-id', 'x']]) {
      const r = run(args); assert.equal(r.status, 1); assert.match(r.stderr, /Unknown option/); assert.doesNotMatch(r.stdout + r.stderr, /SECRETKEY123|tgmk1\.[1-9A-Za-z]{20}/);
    }
    // derive: the same record key as the library; bound to a work with --work
    const mf = join(dir, 'master'); writeFileSync(mf, master + '\n');
    const d1 = run(['derive', 'invoice-1', '--master-file', mf]), d2 = run(['derive', 'invoice-2', '--master-file', mf]);
    assert.match(d1.stdout, /^tgx2\./); assert.notEqual(d1.stdout, d2.stdout);
    assert.equal(run(['derive', 'invoice-1', '--master-stdin'], { input: master }).stdout, d1.stdout);
    assert.equal(run(['derive', 'invoice-1'], { env: { TG_CRYPT_MASTER: master } }).stdout, d1.stdout);
    assert.equal(run(['derive', 'invoice-1', '--master-file', mf]).stderr, '');
    assert.notEqual(run(['derive', 'invoice-1', '--master-file', mf, '--work', WORKFILE]).stdout, d1.stdout);
    // seal and open with a record id, bound to a work
    const rec = join(dir, 'r.tgs');
    const s = run(['seal', WORKFILE, '--message', 'for invoice one', '--record-id', 'invoice-1', '--master-file', mf, '-o', rec]);
    assert.equal(s.status, 0, s.stderr); assert.equal(s.stdout, '', 'no key is printed: it is derived again');
    const o = run(['open', WORKFILE, '--record', rec, '--record-id', 'invoice-1', '--master-file', mf]);
    assert.equal(o.stdout.trim(), 'for invoice one', o.stderr);
    assert.equal(run(['open', WORKFILE, '--record', rec, '--record-id', 'invoice-2', '--master-file', mf]).status, 1);
    assert.equal(run(['open', '-', '--record', rec, '--record-id', 'invoice-1', '--master-file', mf]).status, 1, 'a bound record needs its work');
    // the derived key printed by derive opens the record through the old command too
    const dk = run(['derive', 'invoice-1', '--master-file', mf, '--work', WORKFILE]).stdout.trim();
    assert.equal(run(['open', WORKFILE, '--key-stdin', '--record', rec], { input: dk }).stdout.trim(), 'for invoice one');
  } finally { rmSync(dir, { recursive: true }); }
});
test('cli: seal to a public key, open with the secret or with the master key plus index; split and join', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tgkeys-'));
  try {
    const sk = join(dir, 'sk');
    const n = run(['recipient', '--new', '-o', sk]);
    assert.equal(n.status, 0, n.stderr); assert.match(n.stdout, /^tgp1\./);
    const secret = readFileSync(sk, 'utf8').trim();
    assert.ok(!(n.stdout + n.stderr).includes(secret));
    assert.equal(run(['recipient', '--recipient-key-file', sk]).stdout, n.stdout);
    const rec = join(dir, 'to.tgs');
    const s = run(['seal', WORKFILE, '--to', n.stdout.trim(), '--message', 'for you', '-o', rec]);
    assert.equal(s.status, 0, s.stderr); assert.equal(s.stdout, '');
    assert.match(readFileSync(rec, 'utf8'), /^tgr1\./);
    assert.equal(run(['open', WORKFILE, '--record', rec, '--recipient-key-file', sk]).stdout.trim(), 'for you');
    assert.equal(run(['open', WORKFILE, '--record', rec, '--recipient-key-stdin'], { input: secret }).stdout.trim(), 'for you');
    assert.equal(run(['open', WORKFILE, '--record', rec], { env: { TG_CRYPT_RECIPIENT_KEY: secret } }).stdout.trim(), 'for you');
    assert.equal(run(['open', '-', '--record', rec, '--recipient-key-file', sk]).status, 1, 'sealed for a work: another context fails');
    const other = join(dir, 'sk2'); run(['recipient', '--new', '-o', other]);
    const wrong = run(['open', WORKFILE, '--record', rec, '--recipient-key-file', other]);
    assert.equal(wrong.status, 1); assert.doesNotMatch(wrong.stdout + wrong.stderr, /tgq1/);
    assert.equal(run(['seal', WORKFILE, '--to', 'tgp1.abc', '--message', 'x']).status, 1);
    // recipient derived from the master key
    const mf = join(dir, 'mf'); writeFileSync(mf, vectors.master.text + '\n');
    const pub = run(['recipient', '--master-file', mf, '--index', '2']).stdout.trim();
    const dsk = run(['derive', '-', '--recipient', '--index', '2', '--master-file', mf]).stdout.trim();
    assert.match(dsk, /^tgq1\./);
    const rec2 = join(dir, 'to2.tgs');
    assert.equal(run(['seal', '-', '--to', pub, '--message', 'by index', '-o', rec2]).status, 0);
    assert.equal(run(['open', '-', '--record', rec2, '--master-file', mf, '--index', '2']).stdout.trim(), 'by index');
    assert.equal(run(['open', '-', '--record', rec2, '--master-file', mf, '--index', '3']).status, 1);
    // split and join
    const key = run(['derive', 'x', '--master-file', mf]).stdout.trim();
    const kf = join(dir, 'kf'); writeFileSync(kf, key + '\n');
    const sp = run(['split', '--shamir', '2:3', '--key-file', kf]);
    assert.equal(sp.status, 0, sp.stderr);
    const shares = sp.stdout.trim().split('\n'); assert.equal(shares.length, 3);
    assert.ok(!sp.stderr.includes(key));
    const f1 = join(dir, 's1'), f3 = join(dir, 's3'); writeFileSync(f1, shares[0] + '\n'); writeFileSync(f3, shares[2] + '\n');
    assert.equal(run(['join', f1, f3]).stdout.trim(), key);
    assert.equal(run(['join', '--shares-stdin'], { input: shares[1] + '\n' + shares[2] + '\n' }).stdout.trim(), key);
    const few = run(['join', f1]); assert.equal(few.status, 1); assert.match(few.stderr, /2 shares are needed/);
    const x = run(['split', '--xor', '2', '--key-stdin'], { input: key }).stdout.trim().split('\n');
    assert.equal(run(['join', '--shares-stdin'], { input: x.join('\n') }).stdout.trim(), key);
    const mix = run(['join', '--shares-stdin'], { input: x[0] + '\n' + shares[1] }); assert.equal(mix.status, 1); assert.match(mix.stderr, /different secrets/);
    assert.equal(run(['split', '--key-file', kf]).status, 1);
    const prefix = join(dir, 'p'); assert.equal(run(['split', '--shamir', '2:2', '--key-file', kf, '-o', prefix]).stdout, '');
    assert.equal(run(['join', prefix + '.1', prefix + '.2']).stdout.trim(), key);
  } finally { rmSync(dir, { recursive: true }); }
});
test('cli: a password alone no longer seals a record without --accept-password-only, and publish refuses such records', () => {
  // `publish` is an experiment and hidden from the public command list; the test switches it on for its own runs.
  const runX = (args, o = {}) => run(args, { ...o, env: { ...(o.env || {}), TG_CRYPT_EXPERIMENTAL: '1' } });
  const dir = mkdtempSync(join(tmpdir(), 'tgkeys-'));
  try {
    const rec = join(dir, 'p.tgs');
    const no = run(['seal', '-', '--message', 'x', '--no-bind', '--password-stdin', '--iterations', '100000', '-o', rec], { input: 'correct horse\n' });
    assert.equal(no.status, 1); assert.match(no.stderr, /password alone/); assert.doesNotMatch(no.stdout + no.stderr, /correct horse/);
    const yes = run(['seal', '-', '--message', 'x', '--no-bind', '--password-stdin', '--accept-password-only', '--iterations', '100000', '-o', rec], { input: 'correct horse\n' });
    assert.equal(yes.status, 0, yes.stderr);
    const chain = join(dir, 'chain.json'), store = join(dir, 'store');
    const pub = runX(['publish', rec, '--chain', chain, '--store', store]);
    assert.equal(pub.status, 1); assert.match(pub.stderr, /password alone/);
    assert.equal(runX(['publish', rec, '--chain', chain, '--store', store, '--accept-password-only']).status, 0);
    const keyed = join(dir, 'k.tgs');
    assert.equal(run(['seal', '-', '--message', 'x', '--no-bind', '-o', keyed]).status, 0);
    assert.equal(runX(['publish', keyed, '--chain', chain, '--store', store]).status, 0);
    const help = run(['--help']).stdout;
    for (const w of ['master', 'derive', 'recipient', 'split', 'join', '--to', 'TG_CRYPT_MASTER', 'TG_CRYPT_MNEMONIC', '--accept-password-only']) assert.ok(help.includes(w), w);
    assert.doesNotMatch(help, /--master </);
  } finally { rmSync(dir, { recursive: true }); }
});

test('cli: files with secrets are created exclusively with mode 0600; existing files and symlinks are refused; --force replaces', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tgkeys-'));
  const mode = (p) => statSync(p).mode & 0o777;
  try {
    const mf = join(dir, 'mf'); writeFileSync(mf, vectors.master.text + '\n');
    // recipient --new
    const sk = join(dir, 'sk');
    const a = run(['recipient', '--new', '-o', sk]);
    assert.equal(a.status, 0, a.stderr);
    assert.equal(mode(sk), 0o600);
    const secret = readFileSync(sk, 'utf8');
    assert.ok(!a.stdout.includes(secret.trim()) && !a.stderr.includes(secret.trim()), 'the secret is not printed when -o is used');
    // an existing file: refused, content untouched, the path named
    const again = run(['recipient', '--new', '-o', sk]);
    assert.equal(again.status, 1); assert.ok(again.stderr.includes(sk)); assert.equal(readFileSync(sk, 'utf8'), secret);
    // a symlink pointing elsewhere (existing target, and a dangling one): refused, the target untouched, never followed
    const victim = join(dir, 'victim'); writeFileSync(victim, 'precious');
    const link = join(dir, 'link'); symlinkSync(victim, link);
    const viaLink = run(['recipient', '--new', '-o', link]);
    assert.equal(viaLink.status, 1); assert.equal(readFileSync(victim, 'utf8'), 'precious'); assert.ok(lstatSync(link).isSymbolicLink());
    const dangling = join(dir, 'dangling'), nowhere = join(dir, 'nowhere'); symlinkSync(nowhere, dangling);
    assert.equal(run(['recipient', '--new', '-o', dangling]).status, 1); assert.equal(existsSync(nowhere), false);
    // --force replaces the file; through a symlink it replaces the LINK, not the target
    const forced = run(['recipient', '--new', '-o', sk, '--force']);
    assert.equal(forced.status, 0, forced.stderr); assert.notEqual(readFileSync(sk, 'utf8'), secret); assert.equal(mode(sk), 0o600);
    assert.equal(run(['recipient', '--new', '-o', link, '--force']).status, 0);
    assert.equal(readFileSync(victim, 'utf8'), 'precious'); assert.equal(lstatSync(link).isSymbolicLink(), false); assert.equal(mode(link), 0o600);
    // a world-readable old file is replaced by a private one with --force
    const wide = join(dir, 'wide'); writeFileSync(wide, 'old', { mode: 0o644 });
    assert.equal(mode(wide) & 0o044, 0o044);
    assert.equal(run(['recipient', '--new', '-o', wide, '--force']).status, 0); assert.equal(mode(wide), 0o600);
    // the share files likewise
    const kf = join(dir, 'kf'); writeFileSync(kf, run(['derive', 'k', '--master-file', mf]).stdout);
    const prefix = join(dir, 'sh');
    const sp = run(['split', '--shamir', '2:3', '--key-file', kf, '-o', prefix]);
    assert.equal(sp.status, 0, sp.stderr); assert.equal(sp.stdout, '');
    for (const i of [1, 2, 3]) { assert.equal(mode(`${prefix}.${i}`), 0o600); assert.equal(mode(`${prefix}.${i}`) & 0o077, 0); }
    const old1 = readFileSync(`${prefix}.1`, 'utf8');
    const refuse = run(['split', '--shamir', '2:3', '--key-file', kf, '-o', prefix]);
    assert.equal(refuse.status, 1); assert.ok(refuse.stderr.includes(`${prefix}.1`)); assert.equal(readFileSync(`${prefix}.1`, 'utf8'), old1);
    const v2 = join(dir, 'victim2'); writeFileSync(v2, 'keep'); const prefix2 = join(dir, 'sh2'); symlinkSync(v2, `${prefix2}.1`);
    assert.equal(run(['split', '--xor', '2', '--key-file', kf, '-o', prefix2]).status, 1); assert.equal(readFileSync(v2, 'utf8'), 'keep');
    assert.equal(run(['split', '--shamir', '2:3', '--key-file', kf, '-o', prefix, '--force']).status, 0);
    assert.notEqual(readFileSync(`${prefix}.1`, 'utf8'), old1); assert.equal(mode(`${prefix}.1`), 0o600);
    // decrypted output: open -o is private and exclusive as well
    const rec = join(dir, 'r.tgs'); assert.equal(run(['seal', '-', '--message', 'plain text', '--no-bind', '-o', rec]).status, 0);
    const key = run(['seal', '-', '--message', 'plain text', '--no-bind', '-o', rec]).stdout.trim();
    const out = join(dir, 'out.txt'); writeFileSync(out, 'x');
    const bytesRec = join(dir, 'b.tgs'); const datafile = join(dir, 'd.bin'); writeFileSync(datafile, Buffer.from([1, 2, 3]));
    const bkey = run(['seal', '-', '--data', datafile, '--raw', '--no-bind', '-o', bytesRec]).stdout.trim();
    const o1 = run(['open', '-', '--key-stdin', '--record', bytesRec, '-o', out], { input: bkey });
    assert.equal(o1.status, 1); assert.equal(readFileSync(out, 'utf8'), 'x');
    const out2 = join(dir, 'out2.bin');
    assert.equal(run(['open', '-', '--key-stdin', '--record', bytesRec, '-o', out2], { input: bkey }).status, 0);
    assert.equal(mode(out2), 0o600); assert.deepEqual([...readFileSync(out2)], [1, 2, 3]);
    assert.equal(run(['open', '-', '--key-stdin', '--record', bytesRec, '-o', out], { input: bkey + '\n' }).status, 1);
    assert.equal(run(['open', '-', '--key-stdin', '--record', bytesRec, '-o', out, '--force'], { input: bkey }).status, 0);
    assert.ok(key.startsWith('tgx1.'));
  } finally { rmSync(dir, { recursive: true }); }
});
test('cli: vault create, open and inspect; the seed alone opens the default vault, a passphrase alone never; secrets only from files, stdin or the environment; -o is 0600 and exclusive', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tgkeys-'));
  const mode = (p) => statSync(p).mode & 0o777;
  try {
    const seedf = join(dir, 'seed'); writeFileSync(seedf, vectors.master.seedHex + '\n');
    const pkf = join(dir, 'prf'); writeFileSync(pkf, toHex(Uint8Array.from({ length: 32 }, (_, i) => 255 - i)) + '\n');
    const ppf = join(dir, 'pp'); writeFileSync(ppf, 'alpha beta gamma\n');
    const vf = join(dir, 'vault.tgv');
    // create (the default mode): the vault goes to a 0600 file; nothing secret in stdout or stderr
    const c = run(['vault', 'create', '--seed-file', seedf, '--passkey-file', pkf, '--passphrase-file', ppf, '-o', vf]);
    assert.equal(c.status, 0, c.stderr); assert.equal(c.stdout, ''); assert.equal(mode(vf), 0o600);
    const vault = readFileSync(vf, 'utf8').trim(); assert.match(vault, /^tgv2\./);
    assert.doesNotMatch(c.stdout + c.stderr, /alpha beta|tgmk1\.|tgv2\./); assert.match(c.stderr, /seed alone/);
    // inspect: mode, threshold, factor names; no secret
    const i = run(['vault', 'inspect', vf]); assert.equal(i.status, 0, i.stderr);
    const info = JSON.parse(i.stdout);
    assert.deepEqual([info.mode, info.k, info.n, info.seed, info.factors.map((f) => f.name)], ['default', 2, 2, true, ['passkey', 'passphrase']]);
    assert.doesNotMatch(i.stdout, /alpha beta|tgmk1\./);
    // open with the seed alone: a success line naming the factor, no secret printed; with -o the secret (the master key of the seed) goes to a 0600 file
    const o1 = run(['vault', 'open', vf, '--seed-file', seedf]);
    assert.equal(o1.status, 0, o1.stderr); assert.match(o1.stdout, /^Vault opened with master\b/); assert.doesNotMatch(o1.stdout + o1.stderr, /tgmk1\./);
    const sf = join(dir, 'secret');
    const o2 = run(['vault', 'open', vf, '--seed-stdin', '-o', sf], { input: vectors.master.seedHex });
    assert.equal(o2.status, 0, o2.stderr); assert.equal(o2.stdout, ''); assert.equal(mode(sf), 0o600);
    assert.equal(readFileSync(sf, 'utf8').trim(), vectors.master.text, 'the default vault\'s secret IS the master of the seed');
    assert.equal(run(['vault', 'open', vf], { env: { TG_CRYPT_SEED: vectors.master.seedHex } }).status, 0);
    assert.equal(run(['vault', 'open', vf, '--master-file', sf]).status, 0, 'the master key text opens it too');
    // open without the seed: passkey + passphrase; either alone is refused with the numbers; a wrong seed does not belong
    const o3 = run(['vault', 'open', vf, '--passkey-file', pkf, '--passphrase-stdin'], { input: 'alpha beta gamma\n' });
    assert.equal(o3.status, 0, o3.stderr); assert.match(o3.stdout, /^Vault opened with passkey \+ passphrase\b/);
    assert.equal(run(['vault', 'open', vf, '--passkey-file', pkf, '--passphrase-file', ppf]).status, 0);
    assert.equal(run(['vault', 'open', vf, '--passkey-file', pkf], { env: { TG_CRYPT_PASSPHRASE: 'alpha beta gamma' } }).status, 0);
    const alone = run(['vault', 'open', vf, '--passphrase-file', ppf]); assert.equal(alone.status, 1); assert.match(alone.stderr, /2 factors are needed.*1 worked/);
    assert.equal(run(['vault', 'open', vf, '--passkey-file', pkf]).status, 1);
    assert.equal(run(['vault', 'open', vf]).status, 1);
    const wrong = run(['vault', 'open', vf, '--seed-stdin'], { input: 'ff'.repeat(32) }); assert.equal(wrong.status, 1); assert.match(wrong.stderr, /does not belong/);
    // the rule at creation: seed + passphrase only would let the passphrase open it alone, so it is refused and no file is made
    const bad = run(['vault', 'create', '--seed-file', seedf, '--passphrase-file', ppf, '-o', join(dir, 'bad.tgv')]);
    assert.equal(bad.status, 1); assert.match(bad.stderr, /passphrase/); assert.equal(existsSync(join(dir, 'bad.tgv')), false);
    // strict mode: tgv1., the seed is one share and does not open it alone; its secret is not the master
    const sv = join(dir, 'strict.tgv');
    const sc = run(['vault', 'create', '--mode', 'strict', '--seed-file', seedf, '--passkey-file', pkf, '--passphrase-file', ppf, '-o', sv]);
    assert.equal(sc.status, 0, sc.stderr); assert.match(readFileSync(sv, 'utf8'), /^tgv1\./);
    assert.equal(JSON.parse(run(['vault', 'inspect', sv]).stdout).mode, 'strict');
    assert.equal(run(['vault', 'open', sv, '--seed-file', seedf]).status, 1, 'strict: the seed alone is one share');
    const ss = join(dir, 'strict-secret');
    assert.equal(run(['vault', 'open', sv, '--seed-file', seedf, '--passphrase-file', ppf, '-o', ss]).status, 0);
    assert.match(readFileSync(ss, 'utf8'), /^tgmk1\./); assert.notEqual(readFileSync(ss, 'utf8').trim(), vectors.master.text);
    assert.equal(run(['vault', 'open', sv, '--passkey-file', pkf, '--passphrase-file', ppf]).status, 0);
    assert.equal(run(['vault', 'create', '--mode', 'loose', '--seed-file', seedf, '--passkey-file', pkf]).status, 1);
    // secrets never as arguments (refused without echoing them); standard input only once; an unknown subcommand
    for (const args of [['vault', 'create', '--seed', vectors.master.seedHex, '--passkey-file', pkf], ['vault', 'open', vf, '--passphrase', 'alpha beta gamma'], ['vault', 'open', vf, '--master', vectors.master.text], ['vault', 'create', '--passkey', 'ff', '--seed-file', seedf]]) {
      const r = run(args); assert.equal(r.status, 1); assert.match(r.stderr, /Unknown option/); assert.doesNotMatch(r.stdout + r.stderr, /alpha beta|tgmk1\.[1-9A-Za-z]{10}|000102030405/);
    }
    assert.equal(run(['vault', 'open', vf, '--seed-stdin', '--passphrase-stdin'], { input: 'x' }).status, 1);
    assert.equal(run(['vault', 'frobnicate']).status, 1);
    // -o: exclusive, 0600, a symlink refused and never followed, --force replaces (the same writer as recipient --new)
    const again = run(['vault', 'create', '--seed-file', seedf, '--passkey-file', pkf, '--passphrase-file', ppf, '-o', vf]);
    assert.equal(again.status, 1); assert.ok(again.stderr.includes(vf)); assert.equal(readFileSync(vf, 'utf8').trim(), vault);
    const victim = join(dir, 'victim'); writeFileSync(victim, 'precious'); const link = join(dir, 'link'); symlinkSync(victim, link);
    assert.equal(run(['vault', 'create', '--seed-file', seedf, '--passkey-file', pkf, '-o', link]).status, 1);
    assert.equal(readFileSync(victim, 'utf8'), 'precious'); assert.ok(lstatSync(link).isSymbolicLink());
    assert.equal(run(['vault', 'open', vf, '--seed-file', seedf, '-o', link]).status, 1); assert.equal(readFileSync(victim, 'utf8'), 'precious');
    assert.equal(run(['vault', 'create', '--seed-file', seedf, '--passkey-file', pkf, '-o', vf, '--force']).status, 0);
    assert.notEqual(readFileSync(vf, 'utf8').trim(), vault); assert.equal(mode(vf), 0o600);
    // without -o the vault is printed (it is encrypted shares, storable anywhere); the help names the commands
    const printed = run(['vault', 'create', '--seed-file', seedf, '--passkey-file', pkf, '--passphrase-file', ppf]);
    assert.equal(printed.status, 0, printed.stderr); assert.match(printed.stdout, /^tgv2\.\S+\n$/);
    const help = run(['--help']).stdout;
    for (const w of ['vault create', 'vault open', 'vault inspect', '--mode', '--passkey-file', '--passphrase-file', 'TG_CRYPT_PASSPHRASE']) assert.ok(help.includes(w), w);
  } finally { rmSync(dir, { recursive: true }); }
});
