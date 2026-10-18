// Known-answer tests: every building block the project's own glue code depends on, against PUBLISHED vectors.
// The vectors in test/fixtures/known-answer-vectors.json are extracted from the standards documents by
// scripts/extract-kat-vectors.mjs (nothing typed by hand; the SHA-256 of each source document is in the fixture's "sources").
// A failing vector here is a finding: it means the platform or the project's glue computes something else than the standard.
// Sources: RFC 5869 (HKDF), RFC 4231 (HMAC), RFC 7914 section 11 (PBKDF2-HMAC-SHA-256), RFC 7748 (X25519), RFC 9106 section 5.3
// (Argon2id), FIPS 180-4 / NIST examples (SHA-256), NIST CAVP gcmtestvectors (AES-256-GCM), BIP-39 reference vectors,
// SLIP-0021 test vectors, FIPS-197 (GF(2^8), S-box), the Bitcoin Core base58 vectors, RFC 4648 section 10 (base64).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, pbkdf2Sync, argon2Sync, createHmac } from 'node:crypto';
import { hmac, hkdf, mnemonicToEntropy, mnemonicToSeed, entropyToMnemonic, slip21Master, slip21Child, slip21Path } from '../src/keys.js';
import { gfMul, gfInv, gfEval, gfInterpolate0 } from '../src/keys-split.js';
import { stretch } from '../src/keys-kdf.js';
import { publicFromSecret, formatPublic, parsePublic } from '../src/keys-seal.js';
import { b58Encode, b58Decode, b64urlEncode, b64urlDecode, toHex, fromHex, sha256, utf8, varint, readVarint } from '../src/crypt-codec.js';
import { argon2idAsync, argon2id } from '../assets/vendor/noble-hashes/argon2.js';

const V = JSON.parse(readFileSync(new URL('./fixtures/known-answer-vectors.json', import.meta.url), 'utf8'));
const hex = (h) => fromHex(h);
const subtle = globalThis.crypto.subtle;

test('the fixture pins its sources (the documents the vectors were extracted from)', () => {
  assert.equal(Object.keys(V.sources).length, 8);
  for (const s of Object.values(V.sources)) assert.match(s.sha256, /^[0-9a-f]{64}$/);
});

// ---- SHA-256 ------------------------------------------------------------------------------------------------------
test('SHA-256: FIPS 180-4 / NIST examples (empty, "abc", the 448-bit message), through the project helper and node:crypto', async () => {
  const cases = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ];
  for (const [msg, want] of cases) {
    assert.equal(toHex(await sha256(utf8(msg))), want);
    assert.equal(createHash('sha256').update(msg).digest('hex'), want);
  }
});

// ---- AES-256-GCM (the primitive src/crypt.js, keys-seal.js, keys-split.js call through Web Crypto) ----------------------
test('AES-256-GCM: NIST CAVP gcmEncryptExtIV256 cases with and without plaintext and AAD (Keylen 256, IV 96, tag 128): encrypt and decrypt', async () => {
  assert.ok(V.aesgcm.cases.length >= 10);
  for (const c of V.aesgcm.cases) {
    const key = await subtle.importKey('raw', hex(c.key), 'AES-GCM', false, ['encrypt', 'decrypt']);
    const params = { name: 'AES-GCM', iv: hex(c.iv), additionalData: hex(c.aad), tagLength: 128 };
    const sealed = new Uint8Array(await subtle.encrypt(params, key, hex(c.pt)));
    assert.equal(toHex(sealed), c.ct + c.tag, `encrypt ptBits=${c.ptBits} aadBits=${c.aadBits}`);
    assert.equal(toHex(new Uint8Array(await subtle.decrypt(params, key, sealed))), c.pt);
    // a flipped tag bit, a flipped ciphertext bit and a changed AAD are all refused
    for (const bad of [(b) => { b[b.length - 1] ^= 1; }, (b) => { b[0] ^= 0x80; }]) {
      const m = Uint8Array.from(sealed); bad(m);
      await assert.rejects(subtle.decrypt(params, key, m));
    }
    await assert.rejects(subtle.decrypt({ ...params, additionalData: concatByte(hex(c.aad)) }, key, sealed));
    // a truncated tag is refused as well (the project always passes tagLength 128 and never accepts a shorter tag)
    await assert.rejects(subtle.decrypt(params, key, sealed.slice(0, -1)));
  }
});
const concatByte = (a) => Uint8Array.from([...a, 0]);

// ---- HKDF-SHA-256 (RFC 5869) --------------------------------------------------------------------------------------
test('HKDF-SHA-256: RFC 5869 appendix A.1 to A.3, through the project helper (keys.js hkdf)', async () => {
  assert.equal(V.hkdf.length, 3);
  for (const v of V.hkdf) {
    const okm = await hkdf(hex(v.ikm), hex(v.salt), hex(v.info), v.L);
    assert.equal(toHex(okm), v.okm, v.source);
    // the PRK is HMAC(salt, IKM) (extract); with an empty salt it is a zero string of hash length
    const prk = createHmac('sha256', v.salt ? hex(v.salt) : Buffer.alloc(32)).update(hex(v.ikm)).digest('hex');
    assert.equal(prk, v.prk, v.source + ' (PRK)');
  }
});

// ---- HMAC (RFC 4231) ----------------------------------------------------------------------------------------------
test('HMAC-SHA-256 and HMAC-SHA-512: RFC 4231 test cases 1 to 7 (including the 131-byte key and the truncation case), through keys.js hmac', async () => {
  assert.equal(V.hmac.length, 7);
  for (const v of V.hmac) {
    const m256 = toHex(await hmac('SHA-256', hex(v.key), hex(v.data))), m512 = toHex(await hmac('SHA-512', hex(v.key), hex(v.data)));
    if (v.truncated) { assert.equal(m256.slice(0, 32), v.sha256, v.source); assert.equal(m512.slice(0, 32), v.sha512, v.source); } else { assert.equal(m256, v.sha256, v.source); assert.equal(m512, v.sha512, v.source); }
  }
});
test('HMAC with an empty key: the project replaces it by one zero byte (Web Crypto refuses empty keys); that equals HMAC with the empty key', async () => {
  for (const [alg, node] of [['SHA-256', 'sha256'], ['SHA-512', 'sha512']]) {
    assert.equal(toHex(await hmac(alg, new Uint8Array(0), utf8('data'))), createHmac(node, Buffer.alloc(0)).update('data').digest('hex'));
  }
});

// ---- PBKDF2 -------------------------------------------------------------------------------------------------------
test('PBKDF2-HMAC-SHA-256: RFC 7914 section 11 (c=1 and c=80000), Web Crypto as the project calls it', async () => {
  assert.equal(V.pbkdf2sha256.length, 2);
  for (const v of V.pbkdf2sha256) {
    const k = await subtle.importKey('raw', utf8(v.password), 'PBKDF2', false, ['deriveBits']);
    const dk = new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: utf8(v.salt), iterations: v.iterations }, k, v.dkLen * 8));
    assert.equal(toHex(dk), v.dk, v.source);
    assert.equal(pbkdf2Sync(v.password, v.salt, v.iterations, v.dkLen, 'sha256').toString('hex'), v.dk);
  }
});
test('PBKDF2-HMAC-SHA-512: the project KDF (keys-kdf.js stretch, iterations >= 100000) against node:crypto pbkdf2Sync', async () => {
  const salt = hex('000102030405060708090a0b0c0d0e0f');
  const got = await stretch('pässwörd', salt, { kdf: 'pbkdf2-sha512', iterations: 100_000 });
  assert.equal(toHex(got), pbkdf2Sync('pässwörd'.normalize('NFC'), salt, 100_000, 32, 'sha512').toString('hex'));
  // NFC: the same password typed decomposed gives the same key
  assert.equal(toHex(await stretch('pa\u0308ssword', salt, { kdf: 'pbkdf2-sha512', iterations: 100_000 })), toHex(await stretch('pässword', salt, { kdf: 'pbkdf2-sha512', iterations: 100_000 })));
});

// ---- X25519 (RFC 7748) --------------------------------------------------------------------------------------------
const PKCS8 = Uint8Array.of(0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20);
const x25519 = async (scalarHex, uHex) => {
  const sk = await subtle.importKey('pkcs8', Uint8Array.from([...PKCS8, ...hex(scalarHex)]), 'X25519', false, ['deriveBits']);
  const pk = await subtle.importKey('raw', hex(uHex), 'X25519', false, []);
  return toHex(new Uint8Array(await subtle.deriveBits({ name: 'X25519', public: pk }, sk, 256)));
};
test('X25519: RFC 7748 section 5.2 (two vectors; the second u-coordinate has its top bit set, which the RFC says to mask)', async () => {
  assert.equal(V.x25519.vectors.length, 2);
  for (const v of V.x25519.vectors) assert.equal(await x25519(v.scalar, v.u), v.out, v.source);
});
test('X25519: RFC 7748 section 5.2 iterated 1 and 1000 times (k, u := X25519(k, u), k); the 1 000 000-iteration value is not run', async () => {
  let k = '09' + '00'.repeat(31), u = k;
  for (let i = 1; i <= 1000; i++) { const next = await x25519(k, u); u = k; k = next; if (i === 1) assert.equal(k, V.x25519.iterations[0].out); }
  assert.equal(k, V.x25519.iterations[1].out);
});
test('X25519: RFC 7748 section 6.1 Diffie-Hellman, and the project public-key helpers (publicFromSecret, tgp1 format)', async () => {
  const d = V.x25519.dh;
  assert.equal(toHex(await publicFromSecret(hex(d.a))), d.A);
  assert.equal(toHex(await publicFromSecret(hex(d.b))), d.B);
  assert.equal(await x25519(d.a, d.B), d.K);
  assert.equal(await x25519(d.b, d.A), d.K);
  assert.equal(toHex(await parsePublic(await formatPublic(hex(d.A)))), d.A);
});

// ---- Argon2id (RFC 9106 section 5.3) ------------------------------------------------------------------------------
test('Argon2id: the RFC 9106 section 5.3 vector (with secret and associated data) against the VENDORED @noble/hashes and against node:crypto argon2Sync', async () => {
  const a = V.argon2id;
  const viaNoble = await argon2idAsync(hex(a.password), hex(a.salt), { t: a.passes, m: a.memoryKiB, p: a.parallelism, dkLen: a.tagLength, key: hex(a.secret), personalization: hex(a.ad) });
  assert.equal(toHex(viaNoble), a.tag, 'vendored noble argon2idAsync');
  assert.equal(toHex(argon2id(hex(a.password), hex(a.salt), { t: a.passes, m: a.memoryKiB, p: a.parallelism, dkLen: a.tagLength, key: hex(a.secret), personalization: hex(a.ad) })), a.tag, 'vendored noble argon2id (sync)');
  const viaNode = argon2Sync('argon2id', { message: hex(a.password), nonce: hex(a.salt), secret: hex(a.secret), associatedData: hex(a.ad), parallelism: a.parallelism, tagLength: a.tagLength, memory: a.memoryKiB, passes: a.passes });
  assert.equal(viaNode.toString('hex'), a.tag, 'node:crypto argon2Sync');
});
test('Argon2id: the project KDF (keys-kdf.js stretch) agrees with node:crypto at the project minimum and default parameters, also when two derivations run at once', async () => {
  const salt = hex('a0a1a2a3a4a5a6a7a8a9aaabacadaeaf');
  for (const [p, mem] of [[{ memoryKiB: 8192, passes: 1, parallelism: 1 }, 8192], [{ memoryKiB: 16384, passes: 2, parallelism: 2 }, 16384]]) {
    const want = argon2Sync('argon2id', { message: Buffer.from('correct horse'), nonce: salt, parallelism: p.parallelism, tagLength: 32, memory: p.memoryKiB, passes: p.passes }).toString('hex');
    const [x, y] = await Promise.all([stretch('correct horse', salt, { kdf: 'argon2id', ...p }), stretch('correct horse', salt, { kdf: 'argon2id', ...p })]);
    assert.equal(toHex(x), want); assert.equal(toHex(y), want); assert.ok(mem);
  }
});

// ---- BIP-39 -------------------------------------------------------------------------------------------------------
test('BIP-39: all 24 English reference vectors: entropy -> mnemonic, mnemonic -> entropy, mnemonic + "TREZOR" -> seed (PBKDF2-HMAC-SHA-512, 2048 rounds)', async () => {
  assert.equal(V.bip39.english.length, 24);
  for (const v of V.bip39.english) {
    assert.equal(await entropyToMnemonic(hex(v.entropy)), v.mnemonic);
    assert.equal(toHex((await mnemonicToEntropy(v.mnemonic)).entropy), v.entropy);
    const seed = await mnemonicToSeed(v.mnemonic, V.bip39.passphrase);
    assert.equal(toHex(seed), v.seed, v.mnemonic.slice(0, 30));
    assert.equal(pbkdf2Sync(v.mnemonic.normalize('NFKD'), 'mnemonic' + 'TREZOR', 2048, 64, 'sha512').toString('hex'), v.seed);
  }
});
test('BIP-39: a wrong checksum word and an unknown word are refused', async () => {
  await assert.rejects(mnemonicToEntropy('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon'), { code: 'mnemonic-checksum' });
  await assert.rejects(mnemonicToEntropy('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandonx'), { code: 'mnemonic-unknown-word' });
});

// ---- SLIP-0021 ----------------------------------------------------------------------------------------------------
test('SLIP-0021: the four published keys (master, "SLIP-0021", "Master encryption key", "Authentication key") from the seed of "all all ... all"', async () => {
  const s = V.slip21;
  assert.equal(toHex(await mnemonicToSeed(s.mnemonic)), s.seed);
  const m = await slip21Master(hex(s.seed));
  assert.equal(toHex(m.key), s.master);
  const n1 = await slip21Child(m, 'SLIP-0021');
  assert.equal(toHex(n1.key), s.slip21);
  assert.equal(toHex((await slip21Child(n1, 'Master encryption key')).key), s.encryption);
  assert.equal(toHex((await slip21Child(n1, 'Authentication key')).key), s.authentication);
});
test('SLIP-0021: the project path function refuses every path that does not start with "tgart" (the published SLIP-0021 tree is out of reach)', async () => {
  for (const labels of [['SLIP-0021'], [], ['TGART'], ['x', 'tgart'], 'tgart', null]) await assert.rejects(slip21Path(hex(V.slip21.seed), labels), { code: 'bad-option' });
  assert.ok((await slip21Path(hex(V.slip21.seed), ['tgart', 'master', 'v1'])).key.length === 32);
});

// ---- GF(2^8), the AES field ---------------------------------------------------------------------------------------
const peasant = (a, b) => { let p = 0; for (let i = 0; i < 8; i++) { if (b & 1) p ^= a; const hi = a & 0x80; a = (a << 1) & 0xff; if (hi) a ^= 0x1b; b >>= 1; } return p; };
test('GF(256): the project multiplication equals a bitwise multiplication modulo x^8+x^4+x^3+x+1 (0x11b) for all 65 536 pairs; FIPS-197 examples {57}.{83}={c1}, {57}.{13}={fe}', () => {
  for (let a = 0; a < 256; a++) for (let b = 0; b < 256; b++) if (gfMul(a, b) !== peasant(a, b)) assert.fail(`gfMul(${a},${b}) = ${gfMul(a, b)}, want ${peasant(a, b)}`);
  assert.equal(gfMul(0x57, 0x83), 0xc1);
  assert.equal(gfMul(0x57, 0x13), 0xfe);
  assert.equal(gfMul(0x02, 0x80), 0x1b); // x * x^7 = x^8 = x^4+x^3+x+1
});
test('GF(256): every non-zero element has the inverse the table says (a * inv(a) = 1), {53}^-1 = {ca}, zero has none', () => {
  for (let a = 1; a < 256; a++) assert.equal(gfMul(a, gfInv(a)), 1, `a=${a}`);
  assert.equal(gfInv(0x53), 0xca);
  assert.throws(() => gfInv(0), { code: 'bad-option' });
});
test('GF(256): the AES S-box (FIPS-197 figure 7, rows 0 to 3) is the affine map of the project inverse, and for all 256 inputs equals an independently generated S-box', () => {
  const rot = (x, n) => ((x << n) | (x >> (8 - n))) & 0xff;
  const sbox = (x) => { const b = x ? gfInv(x) : 0; return b ^ rot(b, 1) ^ rot(b, 2) ^ rot(b, 3) ^ rot(b, 4) ^ 0x63; };
  const rows = ['637c777bf26b6fc53001672bfed7ab76', 'ca82c97dfa5947f0add4a2af9ca472c0', 'b7fd9326363ff7cc34a5e5f171d83115', '04c723c31896059a071280e2eb27b275'];
  const published = rows.join('');
  assert.equal(published.length, 128);
  for (let x = 0; x < 64; x++) assert.equal(sbox(x), parseInt(published.slice(2 * x, 2 * x + 2), 16), `S[${x.toString(16)}]`);
  assert.equal(sbox(0x53), 0xed); // FIPS-197 section 5.1.1
  assert.equal(sbox(0xff), 0x16);
  const indep = (x) => { let inv = 0; if (x) for (let y = 1; y < 256; y++) if (peasant(x, y) === 1) inv = y; return inv ^ rot(inv, 1) ^ rot(inv, 2) ^ rot(inv, 3) ^ rot(inv, 4) ^ 0x63; };
  for (let x = 0; x < 256; x++) assert.equal(sbox(x), indep(x));
});
test('Shamir over GF(256): a hand-computed polynomial (f(x) = 0x42 + 0x13 x; f(1) = 0x51, f(2) = 0x64) evaluates and interpolates back to 0x42', () => {
  assert.equal(gfEval([0x42, 0x13], 1), 0x51);
  assert.equal(gfEval([0x42, 0x13], 2), 0x64);
  assert.equal(gfInterpolate0([[1, 0x51], [2, 0x64]]), 0x42);
  assert.equal(gfInterpolate0([[2, 0x64], [1, 0x51]]), 0x42);
  // degree 2 through three points, any three of five
  const c = [0xa7, 0x3c, 0xe1];
  const pts = [1, 2, 3, 4, 5].map((x) => [x, gfEval(c, x)]);
  for (const pick of [[0, 1, 2], [2, 3, 4], [0, 2, 4], [4, 1, 0]]) assert.equal(gfInterpolate0(pick.map((i) => pts[i])), 0xa7);
});

// ---- base58 and base64url -----------------------------------------------------------------------------------------
test('base58: the Bitcoin Core vectors (leading zero bytes become leading "1"), both directions', () => {
  const vectors = [
    ['', ''], ['61', '2g'], ['626262', 'a3gV'], ['636363', 'aPEr'], ['73696d706c792061206c6f6e6720737472696e67', '2cFupjhnEsSn59qHXstmK2ffpLv2'],
    ['00eb15231dfceb60925886b67d065299925915aeb172c06647', '1NS17iag9jJgTHD1VXjvLCEnZuQ3rJDE9L'], ['516b6fcd0f', 'ABnLTmg'], ['bf4f89001e670274dd', '3SEo3LWLoPntC'],
    ['572e4794', '3EFU7m'], ['ecac89cad93923c02321', 'EJDM8drfXA6uyA'], ['10c8511e', 'Rt5zm'], ['00000000000000000000', '1111111111'], ['00', '1'], ['0000', '11'], ['0001', '12'],
  ];
  for (const [h, s] of vectors) { assert.equal(b58Encode(hex(h)), s, h); assert.equal(toHex(b58Decode(s)), h, s); }
});
test('base58: differential against an independent BigInt implementation on 4 000 random strings incl. leading zeros, and every length from 0 to 70', () => {
  const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const ref = (bytes) => { let z = 0; while (z < bytes.length && bytes[z] === 0) z++; let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b); let s = ''; while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; } return '1'.repeat(z) + s; };
  let seed = 12345; const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
  for (let i = 0; i < 4000; i++) {
    const len = Math.floor(rnd() * 70); const b = Uint8Array.from({ length: len }, () => (rnd() < 0.2 ? 0 : Math.floor(rnd() * 256)));
    assert.equal(b58Encode(b), ref(b)); assert.deepEqual(b58Decode(ref(b)), b);
  }
  for (let len = 0; len <= 70; len++) for (const fill of [0, 1, 255]) { const b = new Uint8Array(len).fill(fill); assert.equal(b58Encode(b), ref(b)); assert.deepEqual(b58Decode(ref(b)), b); }
});
test('base64url: RFC 4648 section 10 vectors (padding dropped), the URL alphabet, and a strict decoder that refuses padding, the standard alphabet and non-canonical trailing bits', () => {
  for (const [p, s] of [['', ''], ['f', 'Zg'], ['fo', 'Zm8'], ['foo', 'Zm9v'], ['foob', 'Zm9vYg'], ['fooba', 'Zm9vYmE'], ['foobar', 'Zm9vYmFy']]) { assert.equal(b64urlEncode(utf8(p)), s); assert.deepEqual(b64urlDecode(s), utf8(p)); }
  assert.equal(b64urlEncode(Uint8Array.of(0xfb, 0xff)), '-_8');
  assert.equal(b64urlEncode(Uint8Array.of(0xfb, 0xef, 0xbe)), '--' + '--');
  for (const bad of ['Zg==', 'Zm9v+', 'Zm9v/', 'Zh', 'Z', 'Zm9vY', 'Zm 9v', 'Zm9v\n']) assert.throws(() => b64urlDecode(bad), { code: 'damaged' }, bad);
  let seed = 99; const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let i = 0; i < 2000; i++) { const b = Uint8Array.from({ length: rnd() % 40 }, () => rnd() & 255); assert.equal(b64urlEncode(b), Buffer.from(b).toString('base64url')); assert.deepEqual(b64urlDecode(b64urlEncode(b)), b); }
});
test('varint (LEB128): round trips and the canonical vectors from the LEB128 definition (624485 = e5 8e 26)', () => {
  assert.equal(toHex(varint(0)), '00'); assert.equal(toHex(varint(127)), '7f'); assert.equal(toHex(varint(128)), '8001'); assert.equal(toHex(varint(624485)), 'e58e26');
  for (const n of [0, 1, 127, 128, 255, 16383, 16384, 2 ** 31, 2 ** 32, 2 ** 48]) assert.deepEqual(readVarint(varint(n), 0), [n, varint(n).length]);
});
