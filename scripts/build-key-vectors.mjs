// Builds the frozen test vectors of the key-management modules: node scripts/build-key-vectors.mjs [--write]
// Without --write it prints the JSON; test/key-management.test.js compares it with test/fixtures/key-management-vectors.json.
import { writeFileSync } from 'node:fs';
import { mnemonicToSeed, seedFromHex, slip21Master, slip21Child, masterFromSeed, formatMaster, recordKey, recipientSecret, entropyToMnemonic } from '../src/keys.js';
import { formatPublic, formatSecret, publicFromSecret, sealTextTo, sealBytesTo } from '../src/keys-seal.js';
import { formatKey2, sealWithSecret, workTag } from '../src/keys-work.js';
import { splitXor, splitShamir, newMixed, createVault, generatePassphrase, prfInput, factorFromPrf, factorFromMaster } from '../src/keys-split.js';
import { seededRandom, toHex, fromHex, utf8, sha256 } from '../src/crypt-codec.js';
import { workDigest } from '../src/crypt.js';

export const WORK = 'Call me Ishmael. Some years ago, never mind how long precisely, having little or no money in my purse, I thought I would sail about a little.';
const T = new TextEncoder();
const hex = toHex;
export async function build() {
  const v = {};
  const m12 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const all12 = 'all all all all all all all all all all all all';
  v.bip39 = [];
  for (const [mn, pass] of [[m12, 'TREZOR'], [m12, ''], [all12, ''], [all12, 'Zürich ✓']]) v.bip39.push({ mnemonic: mn, passphrase: pass, seed: hex(await mnemonicToSeed(mn, pass)) });
  v.entropy = [];
  for (const e of ['00'.repeat(16), '7f'.repeat(16), 'ff'.repeat(32), '80'.repeat(24)]) v.entropy.push({ entropy: e, mnemonic: await entropyToMnemonic(fromHex(e)) });
  // SLIP-21 as published in https://github.com/satoshilabs/slips/blob/master/slip-0021.md
  const s21 = await mnemonicToSeed(all12, '');
  let n = await slip21Master(s21);
  const slip = [{ path: [], key: hex(n.key) }];
  n = await slip21Child(n, 'SLIP-0021'); slip.push({ path: ['SLIP-0021'], key: hex(n.key) });
  const a = await slip21Child(n, 'Master encryption key'), b = await slip21Child(n, 'Authentication key');
  slip.push({ path: ['SLIP-0021', 'Master encryption key'], key: hex(a.key) }, { path: ['SLIP-0021', 'Authentication key'], key: hex(b.key) });
  v.slip21 = slip;
  const seed = seedFromHex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
  const master = await masterFromSeed(seed);
  v.master = { seedHex: hex(seed), master: hex(master), text: await formatMaster(master) };
  v.recordKeys = [];
  for (const [id, ctx] of [['a', ''], ['b', ''], ['a', 'x'], ['Rechnung 2026/ä', ''], ['x'.repeat(512), 'c']]) v.recordKeys.push({ id: id.length > 40 ? `x*${id.length}` : id, context: ctx, key: hex(await recordKey(master, id, ctx)) });
  const rs = await recipientSecret(master, 0), rs1 = await recipientSecret(master, 1);
  v.recipient = { secret0: hex(rs), public0: await formatPublic(await publicFromSecret(rs)), secretText0: await formatSecret(rs), secret1: hex(rs1), public1: await formatPublic(await publicFromSecret(rs1)) };
  const digest = await workDigest(WORK), K = await recordKey(master, 'tgx2-vector');
  v.tgx2 = { key: hex(K), digest: hex(digest), tag: hex(await workTag(K, digest)), keyText: await formatKey2({ secret: K, digest }), unbound: await formatKey2({ secret: K }), key16: await formatKey2({ secret: K.slice(0, 16), digest }) };
  const sealed = await sealWithSecret(WORK, { kind: 'text', payload: T.encode('secret note ✓') }, K, { random: seededRandom('tgx2-seal') });
  v.sealedWithSecret = { key: sealed.key, record: sealed.record, plain: 'secret note ✓' };
  const to = await sealTextTo(v.recipient.public0, 'for the owner', { context: 'work:abc', random: seededRandom('seal-to') });
  const toB = await sealBytesTo(v.recipient.public0, Uint8Array.from({ length: 300 }, (_, i) => i & 15), { random: seededRandom('seal-to-bytes') });
  v.sealTo = [{ record: to.record, context: 'work:abc', plain: 'for the owner' }, { record: toB.record, context: '', plainHex: hex(Uint8Array.from({ length: 300 }, (_, i) => i & 15)) }];
  const secret = Uint8Array.from({ length: 32 }, (_, i) => i * 7 + 1);
  v.xor = await splitXor(secret, 3, { random: seededRandom('xor') });
  v.shamir = await splitShamir(secret, 3, 5, { random: seededRandom('shamir') });
  v.secretHex = hex(secret);
  v.mixed = [];
  for (const [pw, params] of [['correct horse', { kdf: 'pbkdf2-sha512', iterations: 100000 }], ['Zürich ✓', { kdf: 'argon2id', memoryKiB: 8192, passes: 1, parallelism: 1 }]]) {
    const r = await newMixed(pw, { params, random: seededRandom('mix' + pw) });
    v.mixed.push({ password: pw, half: r.half, key: hex(r.key) });
  }
  const factors = [{ name: 'seed', key: await factorFromMaster(master) }, { name: 'passkey', key: await factorFromPrf(Uint8Array.from({ length: 32 }, (_, i) => 255 - i)) }, { name: 'passphrase', passphrase: 'alpha beta gamma', params: { kdf: 'argon2id', memoryKiB: 8192, passes: 1, parallelism: 1 } }];
  const vault = await createVault(factors, { k: 2, random: seededRandom('vault') });
  v.vault = { vault: vault.vault, secret: hex(vault.secret), passphrase: 'alpha beta gamma' };
  v.passphrase = generatePassphrase(8, { random: seededRandom('words') });
  v.prf = { input: hex(await prfInput('vault-1')), factor: hex(await factorFromPrf(Uint8Array.from({ length: 32 }, (_, i) => 255 - i))), seedFactor: hex(await factorFromMaster(master)) };
  return v;
}
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const json = JSON.stringify(await build(), null, 1) + '\n';
  if (process.argv.includes('--write')) writeFileSync(new URL('../test/fixtures/key-management-vectors.json', import.meta.url), json); else process.stdout.write(json);
}
