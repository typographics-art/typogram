// Known-answer tests (internal adversarial review 2026-10, docs/security-review-internal-2026-10-b.md): every primitive the
// sealed-data and key-management code relies on, against published vectors. Each vector names its source; the texts were
// fetched from rfc-editor.org / csrc.nist.gov / nvlpubs.nist.gov during the review and the values copied from them, except
// where a comment says "repository fixture" (BIP-39, SLIP-21: the published files live on github.com, which the review
// could not fetch; the values equal the project's own fixture and the reviewer's recollection of the published ones).
// What is tested is the PROJECT's function where one exists (hmac, hkdf, sha256, stretch, publicFromSecret, gfMul,
// b58Encode, b64urlDecode, the vendored Argon2id, mnemonicToSeed, slip21*), and the platform API in the exact shape the
// project calls it where the project has no wrapper (AES-GCM, X25519 agreement).
import test from 'node:test';
import assert from 'node:assert/strict';
import { argon2Sync, createHash } from 'node:crypto';
import { hmac, hkdf, mnemonicToSeed, mnemonicToEntropy, entropyToMnemonic, slip21Master, slip21Child } from '../src/keys.js';
import { stretch } from '../src/keys-kdf.js';
import { publicFromSecret, sealTextTo, openFrom, parseSealedTo, newRecipient } from '../src/keys-seal.js';
import { gfMul, gfInv, gfEval, gfInterpolate0 } from '../src/keys-split.js';
import { sha256, toHex, fromHex, utf8, b58Encode, b58Decode, b64urlEncode, b64urlDecode, CryptError } from '../src/crypt-codec.js';
import { sha256Hex } from '../src/structure.js';
import { argon2idAsync } from '../assets/vendor/noble-hashes/argon2.js';

const hex = (s) => fromHex(s.replace(/\s+/g, ''));

// ---- SHA-256: RFC 6234 section 8.5, the SHA-256 entries of the test table (TEST1..TEST4) ----------------------------
test('KAT SHA-256 (RFC 6234 section 8.5)', async () => {
  const T2 = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';
  const T4 = ('01234567012345670123456701234567' + '01234567012345670123456701234567').repeat(10);
  const cases = [
    ['abc', 'BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD'],
    [T2, '248D6A61D20638B8E5C026930C3E6039A33CE45964FF2167F6ECEDD419DB06C1'],
    ['a'.repeat(1000000), 'CDC76E5C9914FB9281A1C7E284D73E67F1809A48A497200E046D39CCC7112CD0'],
    [T4, '594847328451BDFA85056225462CC1D867D877FB388DF0CE35F25AB5562BFBB5'],
  ];
  for (const [msg, want] of cases) {
    assert.equal(toHex(await sha256(utf8(msg))), want.toLowerCase());
    assert.equal(await sha256Hex(msg), want.toLowerCase());
  }
});

// ---- HMAC-SHA-256 and HMAC-SHA-512: RFC 4231 sections 4.2 to 4.8 (test cases 1 to 7) -------------------------------
test('KAT HMAC-SHA-256 / HMAC-SHA-512 (RFC 4231 test cases 1 to 7)', async () => {
  const cases = [
    { key: '0b'.repeat(20), data: utf8('Hi There'), h256: 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7', h512: '87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854' },
    { key: toHex(utf8('Jefe')), data: utf8('what do ya want for nothing?'), h256: '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843', h512: '164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737' },
    { key: 'aa'.repeat(20), data: hex('dd'.repeat(50)), h256: '773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe', h512: 'fa73b0089d56a284efb0f0756c890be9b1b5dbdd8ee81a3655f83e33b2279d39bf3e848279a722c806b485a47e67c807b946a337bee8942674278859e13292fb' },
    { key: '0102030405060708090a0b0c0d0e0f10111213141516171819', data: hex('cd'.repeat(50)), h256: '82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b', h512: 'b0ba465637458c6990e5a8c5f61d4af7e576d97ff94b872de76f8050361ee3dba91ca5c11aa25eb4d679275cc5788063a5f19741120c4f2de2adebeb10a298dd' },
    { key: '0c'.repeat(20), data: utf8('Test With Truncation'), h256: 'a3b6167473100ee06e0c796c2955552b', h512: '415fad6271580a531d4179bc891d87a6', truncated: true },
    { key: 'aa'.repeat(131), data: utf8('Test Using Larger Than Block-Size Key - Hash Key First'), h256: '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54', h512: '80b24263c7c1a3ebb71493c1dd7be8b49b46d1f41b4aeec1121b013783f8f3526b56d037e05f2598bd0fd2215d6a1e5295e64f73f63f0aec8b915a985d786598' },
    { key: 'aa'.repeat(131), data: utf8('This is a test using a larger than block-size key and a larger than block-size data. The key needs to be hashed before being used by the HMAC algorithm.'), h256: '9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2', h512: 'e37b6a775dc87dbaa4dfa9f96e5e3ffddebd71f8867289865df5a32d20cdc944b6022cac3c4982b10d5eeb55c3e4de15134676fb6de0446065c97440fa8c6a58' },
  ];
  for (const [i, c] of cases.entries()) {
    const m256 = toHex(await hmac('SHA-256', hex(c.key), c.data)), m512 = toHex(await hmac('SHA-512', hex(c.key), c.data));
    assert.equal(c.truncated ? m256.slice(0, 32) : m256, c.h256, `case ${i + 1} SHA-256`);
    assert.equal(c.truncated ? m512.slice(0, 32) : m512, c.h512, `case ${i + 1} SHA-512`);
  }
  // the project's zero-length-key convention (one zero byte) is HMAC with an empty key by definition (the key is zero-padded)
  const { createHmac } = await import('node:crypto');
  assert.equal(toHex(await hmac('SHA-256', new Uint8Array(0), utf8('x'))), createHmac('sha256', Buffer.alloc(0)).update('x').digest('hex'));
  assert.equal(toHex(await hmac('SHA-512', new Uint8Array(0), utf8('x'))), createHmac('sha512', Buffer.alloc(0)).update('x').digest('hex'));
});

// ---- HKDF-SHA-256: RFC 5869 appendix A, test cases 1 to 3 --------------------------------------------------------------
test('KAT HKDF-SHA-256 (RFC 5869 A.1, A.2, A.3)', async () => {
  const cases = [
    { ikm: '0b'.repeat(22), salt: '000102030405060708090a0b0c', info: 'f0f1f2f3f4f5f6f7f8f9', L: 42, okm: '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865' },
    { ikm: Array.from({ length: 80 }, (_, i) => i.toString(16).padStart(2, '0')).join(''), salt: Array.from({ length: 80 }, (_, i) => (0x60 + i).toString(16).padStart(2, '0')).join(''), info: Array.from({ length: 80 }, (_, i) => (0xb0 + i).toString(16).padStart(2, '0')).join(''), L: 82,
      okm: 'b11e398dc80327a1c8e7f78c596a49344f012eda2d4efad8a050cc4c19afa97c59045a99cac7827271cb41c65e590e09da3275600c2f09b8367793a9aca3db71cc30c58179ec3e87c14c01d5c1f3434f1d87' },
    { ikm: '0b'.repeat(22), salt: '', info: '', L: 42, okm: '8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8' },
  ];
  for (const [i, c] of cases.entries()) assert.equal(toHex(await hkdf(hex(c.ikm), hex(c.salt), hex(c.info), c.L)), c.okm, `A.${i + 1}`);
});

// ---- PBKDF2-HMAC-SHA512 and BIP-39: the Trezor vectors (repository fixture; python-mnemonic vectors.json) ---------------
test('KAT BIP-39 seed and checksum (Trezor vectors via the repository fixture; PBKDF2-HMAC-SHA512, 2048 rounds)', async () => {
  const abandon = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  assert.equal(toHex(await mnemonicToSeed(abandon, 'TREZOR')), 'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04');
  assert.equal(toHex(await mnemonicToSeed('all all all all all all all all all all all all')), 'c76c4ac4f4e4a00d6b274d5c39c700bb4a7ddc04fbc6f78e85ca75007b5b495f74a9043eeb77bdd53aa6fc3a0e31462270316fa04b8c19114c8798706cd02ac8');
  for (const [entropy, words] of [
    ['00000000000000000000000000000000', abandon],
    ['7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f', 'legal winner thank year wave sausage worth useful legal winner thank yellow'],
    ['ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo vote'],
    ['808080808080808080808080808080808080808080808080', 'letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter always'],
  ]) {
    assert.equal(await entropyToMnemonic(hex(entropy)), words);
    assert.equal(toHex((await mnemonicToEntropy(words)).entropy), entropy);
  }
  // the checksum is checked: the last word carries it
  await assert.rejects(() => mnemonicToEntropy(abandon.replace(/about$/, 'abandon')), (e) => e.code === 'mnemonic-checksum');
  // PBKDF2-HMAC-SHA512 through the project's stretch() equals node:crypto (RFC 8018 has no SHA-512 vectors; this is a cross-implementation check)
  const { pbkdf2Sync } = await import('node:crypto');
  assert.equal(toHex(await stretch('pässword', new Uint8Array(16).fill(7), { kdf: 'pbkdf2-sha512', iterations: 100000 })), pbkdf2Sync(Buffer.from('pässword'.normalize('NFC')), Buffer.alloc(16, 7), 100000, 32, 'sha512').toString('hex'));
});

// ---- SLIP-21: the published test keys (repository fixture; satoshilabs/slips slip-0021.md) --------------------------------
test('KAT SLIP-21 (the four published keys of the "all all ... all" seed)', async () => {
  const seed = await mnemonicToSeed('all all all all all all all all all all all all');
  const m = await slip21Master(seed);
  assert.equal(toHex(m.key), 'dbf12b44133eaab506a740f6565cc117228cbf1dd70635cfa8ddfdc9af734756');
  const a = await slip21Child(m, 'SLIP-0021');
  assert.equal(toHex(a.key), '1d065e3ac1bbe5c7fad32cf2305f7d709dc070d672044a19e610c77cdf33de0d');
  assert.equal(toHex((await slip21Child(a, 'Master encryption key')).key), 'ea163130e35bbafdf5ddee97a17b39cef2be4b4f390180d65b54cf05c6a82fde');
  assert.equal(toHex((await slip21Child(a, 'Authentication key')).key), '47194e938ab24cc82bfa25f6486ed54bebe79c40ae2a5a32ea6db294d81861a6');
});

// ---- X25519: RFC 7748 section 5.2 (two function vectors, the iterated vector) and 6.1 (Diffie-Hellman) -------------------
test('KAT X25519 (RFC 7748 sections 5.2 and 6.1)', async () => {
  // The project's own wrapper is publicFromSecret (= X25519(k, 9)); the agreement is done by the same Web Crypto call it uses.
  const PKCS8 = hex('302e020100300506032b656e04220420');
  const x25519 = async (k, u) => {
    const sk = await crypto.subtle.importKey('pkcs8', new Uint8Array([...PKCS8, ...k]), 'X25519', false, ['deriveBits']);
    const pk = await crypto.subtle.importKey('raw', u, 'X25519', true, []);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'X25519', public: pk }, sk, 256));
  };
  assert.equal(toHex(await x25519(hex('a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4'), hex('e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c'))), 'c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552');
  assert.equal(toHex(await x25519(hex('4b66e9d4d1b4673c5ad22691957d6af5c11b6421e0ea01d42ca4169e7918ba0d'), hex('e5210f12786811d3f4b7959d0538ae2c31dbe7106fc03c3efc4cd549c715a493'))), '95cbde9476e8907d7aade45cb4b873f88b595a68799fa152e6f8f7647aac7957');
  // iterated vector: k = u = 9; after one iteration (that is X25519(9, 9) = publicFromSecret(9)), after 1000 iterations
  const nine = new Uint8Array(32); nine[0] = 9;
  assert.equal(toHex(await publicFromSecret(nine)), '422c8e7a6227d7bca1350b3e2bb7279f7897b87bb6854b783c60e80311ae3079');
  let k = nine, u = nine;
  for (let i = 0; i < 1000; i++) { const next = await x25519(k, u); u = k; k = next; }
  assert.equal(toHex(k), '684cf59ba83309552800ef566f2f4d3c1c3887c49360e3875f2eb94d99532c51');
  // 6.1: Alice and Bob
  const a = hex('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a'), b = hex('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb');
  const A = await publicFromSecret(a), B = await publicFromSecret(b);
  assert.equal(toHex(A), '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a');
  assert.equal(toHex(B), 'de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f');
  const K = '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742';
  assert.equal(toHex(await x25519(a, B)), K);
  assert.equal(toHex(await x25519(b, A)), K);
  // low-order inputs (u = 0, u = 1, and the order-8 point) give an all-zero secret; the project refuses them in a record
  const r = await newRecipient();
  const rec = parseSealedTo((await sealTextTo(r.public, 'x')).record);
  for (const bad of ['00'.repeat(32), '01' + '00'.repeat(31), 'e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800']) {
    const t = Uint8Array.from(rec.bytes); t.set(hex(bad), 2);
    await assert.rejects(() => openFrom(r.secret, 'tgr1.' + b64urlEncode(t)), (e) => e instanceof CryptError && ['auth-failed', 'damaged'].includes(e.code), bad);
  }
});

// ---- Argon2id: RFC 9106 section 5.3 (m = 32 KiB, t = 3, p = 4, with secret and associated data) ------------------------
test('KAT Argon2id (RFC 9106 section 5.3): the vendored @noble/hashes code and Node\'s argon2Sync both reproduce the tag', async () => {
  const password = new Uint8Array(32).fill(1), salt = new Uint8Array(16).fill(2), secret = new Uint8Array(8).fill(3), ad = new Uint8Array(12).fill(4);
  const want = '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659';
  assert.equal(toHex(await argon2idAsync(password, salt, { t: 3, m: 32, p: 4, dkLen: 32, key: secret, personalization: ad })), want, 'vendored');
  assert.equal(argon2Sync('argon2id', { message: password, nonce: salt, parallelism: 4, tagLength: 32, memory: 32, passes: 3, secret, associatedData: ad }).toString('hex'), want, 'node:crypto');
  // the project's stretch() (no secret, no associated data) equals Node for the review's parameter set
  assert.equal(toHex(await stretch('pw ✓', salt, { kdf: 'argon2id', memoryKiB: 8192, passes: 1, parallelism: 2 })), argon2Sync('argon2id', { message: Buffer.from('pw ✓'), nonce: salt, parallelism: 2, tagLength: 32, memory: 8192, passes: 1 }).toString('hex'));
});

// ---- AES-256-GCM: NIST CAVP gcmtestvectors (gcmEncryptExtIV256.rsp, gcmDecrypt256.rsp), 96-bit IV, 128-bit tag ---------------
test('KAT AES-256-GCM with AAD (NIST CAVP gcmtestvectors.zip: gcmEncryptExtIV256 / gcmDecrypt256), in the call shape the project uses', async () => {
  const aead = async (keyHex, ivHex, aadHex, ptHex) => {
    const key = await crypto.subtle.importKey('raw', hex(keyHex), 'AES-GCM', false, ['encrypt', 'decrypt']);
    return toHex(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: hex(ivHex), additionalData: hex(aadHex), tagLength: 128 }, key, hex(ptHex))));
  };
  const enc = [ // [Keylen 256][IVlen 96][PTlen 128][AADlen 128][Taglen 128] Count 0, 1, 2
    ['92e11dcdaa866f5ce790fd24501f92509aacf4cb8b1339d50c9c1240935dd08b', 'ac93a1a6145299bde902f21a', '2d71bcfa914e4ac045b2aa60955fad24', '1e0889016f67601c8ebea4943bc23ad6', '8995ae2e6df3dbf96fac7b7137bae67f', 'eca5aa77d51d4a0a14d9c51e1da474ab'],
    ['7da3bccaffb3464178ca7c722379836db50ce0bfb47640b9572163865332e486', 'c04fd2e701c3dc62b68738b3', 'fd671cab1ee21f0df6bb610bf94f0e69', 'fec0311013202e4ffdc4204926ae0ddf', '6be61b17b7f7d494a7cdf270562f37ba', '5e702a38323fe1160b780d17adad3e96'],
    ['a359b9584beec189527f8842dda6b6d4c6a5db2f889635715fa3bcd7967c0a71', '8616c4cde11b34a944caba32', '33a46b7539d64c6e1bdb91ba221e3007', 'e1796fca20cb3d3ab0ade69b2a18891e', 'b0d316e95f3f3390ba10d0274965c62b', 'aeaedcf8a012cc32ef25a62790e9334c'],
    // [PTlen 256][AADlen 160] Count 0, 1
    ['5853c020946b35f2c58ec427152b840420c40029636adcbb027471378cfdde0f', 'eec313dd07cc1b3e6b068a47', 'ce7458e56aef9061cb0c42ec2315565e6168f5a6249ffd31610b6d17ab64935e', '1389b522c24a774181700553f0246bbabdd38d6f', 'eadc3b8766a77ded1a58cb727eca2a9790496c298654cda78febf0da16b6903b', '3d49a5b32fde7eafcce90079217ffb57'],
    ['5019ac0617fea10517a2a2714e6cd369c681be340c2a24611306edcd9d5c3928', 'fd1fa6b5cab9aa8d56418abb', '4349221f6647a906a47e64b5a7a1deb2f7caf5c3fef16f0b968d625bca363dca', '953bcbd731a139c5de3a2b75e9ffa4f48018266a', 'dbce650508dab5f499767651ee734692f7b157341977692d2ca879799e8f54aa', '20239e97e2db4985f07e271ba545bbbf'],
    // [PTlen 0][AADlen 128] Count 0: a tag over AAD only
    ['78dc4e0aaf52d935c3c01eea57428f00ca1fd475f5da86a49c8dd73d68c8e223', 'd79cf22d504cc793c3fb6c8a', '', 'b96baa8c1c75a671bfb2d08d06be5f36', '', '3e5d486aa2e30b22e040b85723a06e76'],
  ];
  for (const [key, iv, pt, aad, ct, tag] of enc) assert.equal(await aead(key, iv, aad, pt), ct + tag, 'Web Crypto returns ciphertext || tag');
  // gcmDecrypt256 [256][96][128][128][128]: Count 0 and 1 open, Count 2 and 4 are FAIL cases (the tag does not verify)
  const dec = [
    ['54e352ea1d84bfe64a1011096111fbe7668ad2203d902a01458c3bbd85bfce14', 'df7c3bca00396d0c018495d9', '426e0efc693b7be1f3018db7ddbb7e4d', 'ee8257795be6a1164d7e1d2d6cac77a7', '7e968d71b50c1f11fd001f3fef49d045', '85fc3dfad9b5a8d3258e4fc44571bd3b'],
    ['82f0d1ddc58123f805541f55a7eab43f56ddfefc06c73d57709df3d5a4aabfb3', '0c9d74af29ed4406c77a8e4b', 'c61155d41495e9fc76060fe7f8c926a2', '66d8c881d66370504d2bf00cdb06259e', '34325620a392739beeee6c370967d539', '3fe7811a8224a1881da34a27e03da86a'],
    ['9a0343f850a6427120f764789ffec6d237447b898fbf51d2182f065d3861497d', '3deef6f453dd70d92143adcd', 'e93165935ac18e3a2845d15fe31a9286', 'f5fc50d18766bc3d9e16dd136d45816b', 'dbb8226a624520863db6897017b2a4f8', null],
    ['2a765ceac97265c15209eea90bea85cd9586b972160502ff592a306dc017e6b9', '62c545d9d4e3c7acb66b4bf1', 'ae0594a7b66d3a958e4e6212d3288f91', 'ec9aa846d185cc0f43d392240cd6e2c4', '7d12474e23dc233bc6312d4d5b2deee4', null],
  ];
  for (const [key, iv, ct, tag, aad, pt] of dec) {
    const k = await crypto.subtle.importKey('raw', hex(key), 'AES-GCM', false, ['decrypt']);
    const open = crypto.subtle.decrypt({ name: 'AES-GCM', iv: hex(iv), additionalData: hex(aad), tagLength: 128 }, k, hex(ct + tag));
    if (pt === null) await assert.rejects(open, 'a FAIL vector must not open');
    else assert.equal(toHex(new Uint8Array(await open)), pt);
  }
});

// ---- GF(256): FIPS-197 section 4.2 equations 4.6 and 4.7, and a full check against shift-and-add multiplication ----------
test('KAT GF(2^8) of the Shamir code (FIPS-197 section 4.2; every product against an independent multiplication)', () => {
  for (const [b, want] of [[0x01, 0x57], [0x02, 0xae], [0x04, 0x47], [0x08, 0x8e], [0x10, 0x07], [0x20, 0x0e], [0x40, 0x1c], [0x80, 0x38], [0x13, 0xfe]]) assert.equal(gfMul(0x57, b), want, `{57}•{${b.toString(16)}}`);
  // independent multiplication: shift-and-add with reduction by m(x) = x^8 + x^4 + x^3 + x + 1 (0x11b), as in equation 4.5
  const slow = (a, b) => { let r = 0; for (let i = 0; i < 8; i++) { if (b & 1) r ^= a; b >>= 1; a <<= 1; if (a & 0x100) a ^= 0x11b; } return r; };
  // hand-computed: {53}•{ca}: 0x53 = x^6+x^4+x+1, 0xca = x^7+x^6+x^3+x; the product reduces to 1 (they are inverses)
  assert.equal(slow(0x53, 0xca), 1); assert.equal(gfMul(0x53, 0xca), 1); assert.equal(gfInv(0x53), 0xca);
  for (let a = 0; a < 256; a++) for (let b = 0; b < 256; b++) assert.equal(gfMul(a, b), slow(a, b), `${a}*${b}`);
  for (let a = 1; a < 256; a++) assert.equal(slow(a, gfInv(a)), 1, `inverse of ${a}`);
  // Lagrange at 0 recovers the constant term for every degree 1 and 2 polynomial over a few evaluation points
  for (let s = 0; s < 256; s += 3) for (let a1 = 1; a1 < 256; a1 += 37) {
    assert.equal(gfInterpolate0([[1, gfEval([s, a1], 1)], [2, gfEval([s, a1], 2)]]), s);
    assert.equal(gfInterpolate0([[3, gfEval([s, a1, 7], 3)], [250, gfEval([s, a1, 7], 250)], [17, gfEval([s, a1, 7], 17)]]), s);
  }
});

// ---- base58 (Bitcoin alphabet): the Bitcoin Core test vectors (recalled, every one re-derived with BigInt below) ----------
test('KAT base58 (Bitcoin base58_encode_decode.json, cross-checked against a BigInt conversion), leading zeros, empty, maximal', () => {
  const ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const ref = (bytes) => { let z = 0; while (z < bytes.length && bytes[z] === 0) z++; let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b); let s = ''; while (n > 0n) { s = ALPHA[Number(n % 58n)] + s; n /= 58n; } return '1'.repeat(z) + s; };
  const vectors = [['', ''], ['61', '2g'], ['626262', 'a3gV'], ['636363', 'aPEr'], ['73696d706c792061206c6f6e6720737472696e67', '2cFupjhnEsSn59qHXstmK2ffpLv2'],
    ['00eb15231dfceb60925886b67d065299925915aeb172c06647', '1NS17iag9jJgTHD1VXjvLCEnZuQ3rJDE9L'], ['516b6fcd0f', 'ABnLTmg'], ['bf4f89001e670274dd', '3SEo3LWLoPntC'], ['572e4794', '3EFU7m'],
    ['ecac89cad93923c02321', 'EJDM8drfXA6uyA'], ['10c8511e', 'Rt5zm'], ['00000000000000000000', '1111111111'], ['00', '1'], ['0000', '11'], ['0001', '12'], ['ff', '5Q'], ['0000ff', '115Q']];
  for (const [h, want] of vectors) {
    assert.equal(ref(hex(h)), want, `BigInt reference agrees with the recalled vector ${h}`);
    assert.equal(b58Encode(hex(h)), want, `encode ${h}`);
    assert.equal(toHex(b58Decode(want)), h, `decode ${want}`);
  }
  for (const bad of ['0', 'O', 'I', 'l', ' ', '1 1', 'é']) assert.throws(() => b58Decode(bad), (e) => e.code === 'damaged', JSON.stringify(bad));
  // long inputs: 8 KiB of 0xff and of 0x00 round-trip (the 32 KiB inline maximum takes about 3.7 s here: the conversion is quadratic; measured in the review)
  const big = new Uint8Array(8 * 1024).fill(255), zeros = new Uint8Array(8 * 1024);
  assert.equal(toHex(b58Decode(b58Encode(big))), toHex(big));
  assert.equal(b58Encode(zeros), '1'.repeat(8 * 1024)); assert.equal(b58Decode('1'.repeat(8 * 1024)).length, 8 * 1024);
});

// ---- base64url: RFC 4648 section 10 (the base64 vectors, unpadded and URL-safe) plus the canonical-form rules -------------
test('KAT base64url (RFC 4648 section 10; canonical, no padding)', () => {
  for (const [s, want] of [['', ''], ['f', 'Zg'], ['fo', 'Zm8'], ['foo', 'Zm9v'], ['foob', 'Zm9vYg'], ['fooba', 'Zm9vYmE'], ['foobar', 'Zm9vYmFy']]) {
    assert.equal(b64urlEncode(utf8(s)), want);
    assert.equal(new TextDecoder().decode(b64urlDecode(want)), s);
  }
  // the URL-safe characters: 0xfb 0xff -> "-_8" (base64 would be "+/8=")
  assert.equal(b64urlEncode(Uint8Array.from([0xfb, 0xff])), '-_8');
  assert.deepEqual([...b64urlDecode('-_8')], [0xfb, 0xff]);
  assert.equal(Buffer.from('-_8', 'base64url').toString('hex'), 'fbff');
  // non-canonical and malformed texts are refused (one text per byte string)
  for (const bad of ['Zh', 'Zm9vYh', 'Z', 'Zg==', 'Zm9v Zg', '+/8', 'Zm9vYmFy=']) assert.throws(() => b64urlDecode(bad), (e) => e.code === 'damaged', bad);
  // every length 0..300 round-trips and matches Node
  const rnd = new Uint8Array(300); for (let i = 0; i < 300; i++) rnd[i] = (i * 131 + 7) & 255;
  for (let n = 0; n <= 300; n++) { const b = rnd.subarray(0, n); assert.equal(b64urlEncode(b), Buffer.from(b).toString('base64url')); assert.deepEqual([...b64urlDecode(b64urlEncode(b))], [...b]); }
});

// ---- the sha256 helper of the checksum, against node:crypto on the exact checksum input ------------------------------------
test('KAT checksum construction: sha256(domain || 0x00 || body) equals node:crypto', async () => {
  const { checksum } = await import('../src/crypt-codec.js');
  const body = Uint8Array.from([1, 2, 3, 4, 5]);
  const want = createHash('sha256').update(Buffer.concat([Buffer.from('tgx1'), Buffer.from([0]), Buffer.from(body)])).digest();
  assert.equal(toHex(await checksum('tgx1', body)), toHex(want.subarray(0, 2)));
  assert.equal(toHex(await checksum('tgsh1', body, 4)), createHash('sha256').update(Buffer.concat([Buffer.from('tgsh1'), Buffer.from([0]), Buffer.from(body)])).digest('hex').slice(0, 8));
});
