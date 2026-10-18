// Differential tests: the project's seal / open, key derivation and codecs against INDEPENDENT re-implementations written
// here from the specification text (docs/key-format.md, docs/key-management.md, docs/encrypted-data.md) using only node:crypto
// and node:zlib: no function of the project is used to compute the expected value. A mistake in the glue (a wrong salt,
// an AAD that does not bind what it claims, an off-by-one in a layout) shows up as a disagreement.
// Both directions: the project seals and the reference opens, the reference seals and the project opens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, hkdfSync, pbkdf2Sync, argon2Sync, createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, randomBytes } from 'node:crypto';
import { inflateRawSync, deflateRawSync, brotliDecompressSync } from 'node:zlib';
import { sealItem, openSealed, sealMessage, sealBytes, KEY_PREFIX, RECORD_PREFIX } from '../src/crypt.js';
import { hideCompact, revealCompact } from '../src/crypt-book.js';
import { hideSecret, revealSecret, canonicalText } from '../src/secret.js';
import { recordKey, recipientSecret, masterFromSeed, formatMaster, parseMaster } from '../src/keys.js';
import { newRecipient, sealTo, openFrom, parsePublic, formatPublic, publicFromSecret } from '../src/keys-seal.js';
import { formatKey2, parseKey2, sealWithSecret, sealBound2, openAny, workTag } from '../src/keys-work.js';
import { splitShamir, splitXor, joinShares, newMixed, mixedKey, mixKey, createVault, openVault } from '../src/keys-split.js';
import { seededRandom, toHex } from '../src/crypt-codec.js';

// ================================ independent reference implementations ===================================================
const A58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const b58enc = (bytes) => { let z = 0; while (z < bytes.length && bytes[z] === 0) z++; let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b); let s = ''; while (n > 0n) { s = A58[Number(n % 58n)] + s; n /= 58n; } return '1'.repeat(z) + s; };
const b58dec = (s) => { let z = 0; while (z < s.length && s[z] === '1') z++; let n = 0n; for (const c of s) { const i = A58.indexOf(c); assert.ok(i >= 0, 'base58 character'); n = n * 58n + BigInt(i); } let h = n.toString(16); if (h.length % 2) h = '0' + h; return Buffer.concat([Buffer.alloc(z), n ? Buffer.from(h, 'hex') : Buffer.alloc(0)]); };
const sha = (...parts) => createHash('sha256').update(Buffer.concat(parts.map((p) => Buffer.from(p)))).digest();
const check = (domain, body, n = 2) => sha(Buffer.from(domain), Buffer.from([0]), body).subarray(0, n);
const leb = (n) => { const o = []; do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 0x80; o.push(b); } while (n); return Buffer.from(o); };
const readLeb = (b, at) => { let n = 0, m = 1; for (;; at++) { n += (b[at] & 0x7f) * m; m *= 128; if (!(b[at] & 0x80)) return [n, at + 1]; } };
const hk = (ikm, salt, info, len = 32) => Buffer.from(hkdfSync('sha256', ikm, salt, info, len));
const WORK = 'The quick brown fox jumps over the lazy dog, and the owner of this work keeps a secret.';
assert.equal(canonicalText(WORK), WORK, 'the test work must be its own canonical text');
const WORK_DIGEST = sha(Buffer.from(WORK));

function gcmOpen(key, nonce, aad, ctAndTag) {
  const d = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  d.setAAD(aad); d.setAuthTag(ctAndTag.subarray(-16));
  return Buffer.concat([d.update(ctAndTag.subarray(0, -16)), d.final()]);
}
function gcmSeal(key, nonce, aad, plain) {
  const c = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  c.setAAD(aad);
  return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
}

/** tgx1 key text: version 1, flags (bound 1, inline 2, secret16 4), secret, 8-byte fingerprint when bound, record when inline, 2-byte check. */
function refKey1({ secret, bound, inline }, digest) {
  const flags = (bound ? 1 : 0) | (inline ? 2 : 0) | (secret.length === 16 ? 4 : 0);
  const raw = Buffer.concat([Buffer.from([1, flags]), secret, bound ? digest.subarray(0, 8) : Buffer.alloc(0), inline ?? Buffer.alloc(0)]);
  return 'tgx1.' + b58enc(Buffer.concat([raw, check('tgx1', raw)]));
}
function refParseKey1(text) {
  assert.ok(text.startsWith('tgx1.'));
  const raw = b58dec(text.slice(5)), body = raw.subarray(0, -2);
  assert.deepEqual(raw.subarray(-2), check('tgx1', body), 'key check value');
  assert.equal(body[0], 1);
  const f = body[1], sl = f & 4 ? 16 : 32;
  let at = 2 + sl; const secret = body.subarray(2, at);
  const fp = f & 1 ? body.subarray(at, at + 8) : null; at += f & 1 ? 8 : 0;
  return { secret, bound: !!(f & 1), fp, inline: f & 2 ? body.subarray(at) : null };
}
/** Independent reader of a tgs1 record. `ikmFor(rec)` gives the input key material. Returns { kind, body }. */
function refOpenTgs1(recordText, ikm, workDigest) {
  assert.ok(recordText.startsWith('tgs1.'));
  const bytes = Buffer.from(recordText.slice(5), 'base64url');
  assert.equal(bytes[0], 1);
  const flags = bytes[1]; let at = 2, salt = null, iters = null;
  if (flags & 4) { salt = bytes.subarray(2, 18); [iters, at] = readLeb(bytes, 18); }
  const head = bytes.subarray(0, at), nonce = bytes.subarray(at, at + 12), ct = bytes.subarray(at + 12);
  const secret = typeof ikm === 'function' ? ikm({ salt, iters }) : ikm;
  const key = hk(secret, 'tgx1/salt', Buffer.concat([Buffer.from('tgx1/aes-256-gcm'), flags & 1 ? workDigest : Buffer.alloc(0)]));
  const plain = gcmOpen(key, nonce, Buffer.concat([Buffer.from('tgs1'), head]), ct);
  const [len, at2] = readLeb(plain, 0);
  assert.ok(plain.subarray(at2 + len).every((b) => b === 0), 'zero padding');
  const kind = plain[at2]; let body = plain.subarray(at2 + 1, at2 + len);
  if (flags & 2) body = inflateRawSync(body); else if (flags & 8) body = brotliDecompressSync(body);
  return { kind, body, flags, head };
}
function refSealTgs1({ secret, nonce, kind, payload, workDigest, compress = false, pad = 0 }) {
  let body = payload, flags = workDigest ? 1 : 0;
  if (compress) { const p = deflateRawSync(payload); if (p.length < payload.length) { body = p; flags |= 2; } }
  const data = Buffer.concat([Buffer.from([kind]), body]);
  let plain = Buffer.concat([leb(data.length), data]);
  if (pad) plain = Buffer.concat([plain, Buffer.alloc((pad - (plain.length % pad)) % pad)]);
  const head = Buffer.from([1, flags]);
  const key = hk(secret, 'tgx1/salt', Buffer.concat([Buffer.from('tgx1/aes-256-gcm'), workDigest ?? Buffer.alloc(0)]));
  const ct = gcmSeal(key, nonce, Buffer.concat([Buffer.from('tgs1'), head]), plain);
  return { record: 'tgs1.' + Buffer.concat([head, nonce, ct]).toString('base64url'), bytes: Buffer.concat([head, nonce, ct]) };
}

// ================================ tgs1 / tgx1 ============================================================================
const KIND = { tgd: 1, text: 2, bytes: 3 };
test('tgs1: records made by the project open with node:crypto (key derived by hand with hkdfSync, AES-256-GCM by createDecipheriv); key text parses and re-serialises identically', async () => {
  for (const [bind, strength, compress, pad] of [[true, 256, true, 0], [true, 128, false, 0], [false, 256, true, 64], [true, 256, 'brotli', 0], [false, 128, false, 16]]) {
    const payload = Buffer.from('Sealed data, repeated repeated repeated repeated repeated. '.repeat(8) + 'Ünïcödé ✓');
    const s = await sealItem(bind ? WORK : null, { kind: 'text', payload }, { bind, strength, compress, pad, random: seededRandom(`d1-${bind}-${strength}-${compress}-${pad}`) });
    const k = refParseKey1(s.key);
    assert.equal(k.secret.length, strength / 8);
    assert.equal(k.bound, bind);
    if (bind) assert.deepEqual(k.fp, WORK_DIGEST.subarray(0, 8));
    assert.equal(s.key, refKey1({ secret: k.secret, bound: bind, inline: null }, WORK_DIGEST), 'key text');
    const r = refOpenTgs1(s.record, k.secret, WORK_DIGEST);
    assert.equal(r.kind, KIND.text);
    assert.deepEqual(r.body, payload);
    assert.equal(!!(r.flags & 1), bind);
  }
});
test('tgs1: records sealed by an independent writer (hkdfSync + createCipheriv, fixed nonce) open with the project; the project output for the same secret and nonce is byte for byte identical', async () => {
  const secret = Buffer.from('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff', 'hex'), nonce = Buffer.from('a1a2a3a4a5a6a7a8a9aaabac', 'hex');
  const payload = Buffer.from('independent writer: ' + 'abc'.repeat(100));
  for (const compress of [false, true]) for (const bound of [true, false]) for (const pad of [0, 32]) {
    const ref = refSealTgs1({ secret, nonce, kind: 2, payload, workDigest: bound ? WORK_DIGEST : null, compress, pad });
    const key = refKey1({ secret, bound, inline: null }, WORK_DIGEST);
    const out = await openSealed(bound ? WORK : null, { key, record: ref.record });
    assert.equal(out.kind, 'text'); assert.deepEqual(Buffer.from(out.bytes), payload);
    // the project, given the same secret and nonce (secret first, then nonce: the order sealItem draws them), writes the same bytes
    const seq = [secret, nonce]; let i = 0;
    const mine = await sealItem(bound ? WORK : null, { kind: 'text', payload }, { bind: bound, strength: 256, compress, pad, random: (a) => { a.set(seq[i++]); return a; } });
    assert.equal(mine.record, ref.record, `compress=${compress} bound=${bound} pad=${pad}`);
    assert.equal(mine.key, key);
  }
});
test('tgs1 with a password: PBKDF2-HMAC-SHA-256 by hand (salt and iterations from the record head, NFC password) opens; independent writer opens with the project', async () => {
  const pw = 'pa\u0308sswörd ß'; // decomposed a-umlaut: NFC is what both sides must use
  const s = await sealItem(WORK, { kind: 'text', payload: Buffer.from('by password') }, { password: pw, iterations: 100_000, random: seededRandom('pw1') });
  const r = refOpenTgs1(s.record, ({ salt, iters }) => { assert.equal(iters, 100_000); return pbkdf2Sync(pw.normalize('NFC'), salt, iters, 32, 'sha256'); }, WORK_DIGEST);
  assert.equal(r.body.toString(), 'by password'); assert.ok(r.flags & 4);
  // reference writer
  const salt = Buffer.alloc(16, 7), nonce = Buffer.alloc(12, 9), ikm = pbkdf2Sync(pw.normalize('NFC'), salt, 100_000, 32, 'sha256');
  const head = Buffer.concat([Buffer.from([1, 1 | 4]), salt, leb(100_000)]);
  const key = hk(ikm, 'tgx1/salt', Buffer.concat([Buffer.from('tgx1/aes-256-gcm'), WORK_DIGEST]));
  const data = Buffer.concat([Buffer.from([2]), Buffer.from('written by hand')]);
  const rec = 'tgs1.' + Buffer.concat([head, nonce, gcmSeal(key, nonce, Buffer.concat([Buffer.from('tgs1'), head]), Buffer.concat([leb(data.length), data]))]).toString('base64url');
  assert.equal((await openSealed(WORK, { password: pw.normalize('NFD'), record: rec })).text, 'written by hand');
});
test('tgs1 inline key: the key carries the record; the independent reader splits key and record and opens it', async () => {
  const s = await sealItem(WORK, { kind: 'bytes', payload: Buffer.from('inline payload 0123456789') }, { inline: true, random: seededRandom('inline1') });
  const k = refParseKey1(s.key);
  assert.ok(k.inline);
  assert.equal('tgs1.' + Buffer.from(k.inline).toString('base64url'), s.record);
  assert.equal(refOpenTgs1(s.record, k.secret, WORK_DIGEST).body.toString(), 'inline payload 0123456789');
});
test('tgs1 AAD binds the header: every single-bit change of a sealed record (all positions) is refused, and so is every truncation and every one-character change of the key', async () => {
  const s = await sealItem(WORK, { kind: 'text', payload: Buffer.from('tamper me') }, { compress: false, random: seededRandom('tamper1') });
  const bytes = Buffer.from(s.record.slice(5), 'base64url');
  let refused = 0;
  for (let i = 0; i < bytes.length; i++) for (let bit = 0; bit < 8; bit++) {
    const m = Buffer.from(bytes); m[i] ^= 1 << bit;
    await assert.rejects(openSealed(WORK, { key: s.key, record: 'tgs1.' + m.toString('base64url') }), (e) => e.name === 'CryptError', `byte ${i} bit ${bit} was accepted`);
    refused++;
  }
  for (let n = 0; n < bytes.length; n++) await assert.rejects(openSealed(WORK, { key: s.key, record: 'tgs1.' + bytes.subarray(0, n).toString('base64url') }), (e) => e.name === 'CryptError');
  const body = s.key.slice(5), ALPHA = A58;
  for (let i = 0; i < body.length; i++) {
    const c = ALPHA[(ALPHA.indexOf(body[i]) + 1) % 58];
    await assert.rejects(openSealed(WORK, { key: 'tgx1.' + body.slice(0, i) + c + body.slice(i + 1), record: s.record }), (e) => e.name === 'CryptError');
  }
  assert.ok(refused > 300);
});
test('tgs1 work binding: a bound record fails on any other work text, and on the same words with one character changed', async () => {
  const s = await sealItem(WORK, { kind: 'text', payload: Buffer.from('x') }, { random: seededRandom('bind1') });
  for (const other of [WORK + '.', WORK.replace('quick', 'quack'), WORK.toUpperCase(), 'another work']) await assert.rejects(openSealed(other, { key: s.key, record: s.record }), { code: 'wrong-work' });
  // whitespace and invisible characters are not part of the canonical text, so these ARE the same work
  assert.equal((await openSealed(WORK.replace(/ /g, '  ') + '\n', { key: s.key, record: s.record })).text, 'x');
  assert.equal((await openSealed(WORK.replace('quick', 'qu\u200bick'), { key: s.key, record: s.record })).text, 'x');
});

// ================================ tgx2 ===================================================================================
test('tgx2: the 4-byte work tag HMAC-SHA-256(secret, "tgx2/work" || SHA-256(work)) and the key layout agree with an independent builder; the tgx2 key opens, a tgx2 key for another work is refused before decryption', async () => {
  const secret = Buffer.alloc(32, 0x5a);
  const mine = await formatKey2({ secret, digest: WORK_DIGEST });
  const tag = createHmac('sha256', secret).update(Buffer.concat([Buffer.from('tgx2/work'), WORK_DIGEST])).digest().subarray(0, 4);
  const raw = Buffer.concat([Buffer.from([2, 1]), secret, tag]);
  assert.equal(mine, 'tgx2.' + b58enc(Buffer.concat([raw, check('tgx2', raw)])));
  assert.equal(toHex(await workTag(secret, WORK_DIGEST)), tag.toString('hex'));
  const s = await sealWithSecret(WORK, { kind: 'text', payload: Buffer.from('v2') }, secret, { random: seededRandom('t2') });
  assert.equal(s.key, mine);
  const k2 = await parseKey2(s.key);
  assert.deepEqual(Buffer.from(k2.secret), secret);
  assert.equal((await openAny(WORK, { key: s.key, record: s.record })).text, 'v2');
  await assert.rejects(openAny('another work', { key: s.key, record: s.record }), { code: 'wrong-work' });
  // the record is an ordinary tgs1 record: the reference reader opens it with the secret
  assert.equal(refOpenTgs1(s.record, secret, WORK_DIGEST).body.toString(), 'v2');
});

// ================================ keys.js: master, record keys ============================================================
test('record keys: HKDF-SHA-256(master, salt "tgart/hkdf/v1", info "tgart/record-key/v1" 00 framed(id) framed(context)) by hand, NFC ids, empty and non-empty context; recipient secret likewise', async () => {
  const master = Buffer.alloc(32).fill(0x42);
  const frame = (s) => { const b = Buffer.from(s.normalize('NFC')); return Buffer.concat([leb(b.length), b]); };
  for (const [id, ctx] of [['invoice-1', ''], ['invoice-1', 'work-a'], ['re\u0301cord ü', 'ctx'], ['x'.repeat(512), 'y'.repeat(256)]]) {
    const want = hk(master, 'tgart/hkdf/v1', Buffer.concat([Buffer.from('tgart/record-key/v1'), Buffer.from([0]), frame(id), frame(ctx)]));
    assert.equal(toHex(await recordKey(master, id, ctx)), want.toString('hex'));
  }
  assert.notEqual(toHex(await recordKey(master, 'a', 'bc')), toHex(await recordKey(master, 'ab', 'c')), 'framing separates id and context');
  for (const i of [0, 1, 127, 128, 70000, 0xffffffff]) assert.equal(toHex(await recipientSecret(master, i)), hk(master, 'tgart/hkdf/v1', Buffer.concat([Buffer.from('tgart/recipient/v1'), Buffer.from([0]), leb(i)])).toString('hex'));
});
test('master secret: SLIP-21 path tgart/master/v1 by hand (HMAC-SHA-512 chain), "tgmk1." format with check; parse round trip', async () => {
  const seed = Buffer.alloc(64, 0x11);
  let node = createHmac('sha512', 'Symmetric key seed').update(seed).digest();
  for (const l of ['tgart', 'master', 'v1']) node = createHmac('sha512', node.subarray(0, 32)).update(Buffer.concat([Buffer.from([0]), Buffer.from(l)])).digest();
  const master = node.subarray(32);
  assert.equal(toHex(await masterFromSeed(seed)), master.toString('hex'));
  const body = Buffer.concat([Buffer.from([1]), master]);
  assert.equal(await formatMaster(master), 'tgmk1.' + b58enc(Buffer.concat([body, check('tgmk1', body)])));
  assert.deepEqual(Buffer.from(await parseMaster(await formatMaster(master))), master);
});

// ================================ tgr1 (ECIES) ===========================================================================
const PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex'), SPKI = Buffer.from('302a300506032b656e032100', 'hex');
const privOf = (sec) => createPrivateKey({ key: Buffer.concat([PKCS8, sec]), format: 'der', type: 'pkcs8' });
const pubRaw = (priv) => createPublicKey(priv).export({ format: 'der', type: 'spki' }).subarray(-32);
const pubObj = (raw) => createPublicKey({ key: Buffer.concat([SPKI, raw]), format: 'der', type: 'spki' });
test('tgr1: a record sealed by the project to a recipient opens with node:crypto (diffieHellman + hkdfSync, salt epk||rpk, info "tgr1/aes-256-gcm" 00 framed(context)); and the reverse', async () => {
  const rec = await newRecipient(seededRandom('rcpt1'));
  const secRaw = b58dec(rec.secret.slice(5)); assert.deepEqual(secRaw.subarray(-2), check('tgq1', secRaw.subarray(0, -2)));
  const sec = secRaw.subarray(1, 33), pubTxt = b58dec(rec.public.slice(5)); const rpk = pubTxt.subarray(1, 33);
  assert.deepEqual(pubRaw(privOf(sec)), rpk, 'tgp1 holds the X25519 public key of the secret');
  assert.deepEqual(pubTxt.subarray(-2), check('tgp1', pubTxt.subarray(0, -2)));
  for (const ctx of ['', 'work digest é', Buffer.from([1, 2, 3])]) {
    const item = { kind: 'text', payload: Buffer.from('to the owner of the key') };
    const s = await sealTo(rec.public, item, { context: ctx, random: seededRandom('tgr1-' + ctx.toString()) });
    const bytes = Buffer.from(s.record.slice(5), 'base64url');
    assert.equal(bytes[0], 1);
    const head = bytes.subarray(0, 34), epk = bytes.subarray(2, 34), nonce = bytes.subarray(34, 46), ct = bytes.subarray(46);
    const c = typeof ctx === 'string' ? Buffer.from(ctx.normalize('NFC')) : ctx, framed = Buffer.concat([leb(c.length), c]);
    const shared = diffieHellman({ privateKey: privOf(sec), publicKey: pubObj(epk) });
    const key = hk(shared, Buffer.concat([epk, rpk]), Buffer.concat([Buffer.from('tgr1/aes-256-gcm'), Buffer.from([0]), framed]));
    let plain = gcmOpen(key, nonce, Buffer.concat([Buffer.from('tgr1'), head, framed]), ct);
    assert.equal(plain[0], 2);
    plain = plain.subarray(1); if (bytes[1] & 1) plain = inflateRawSync(plain);
    assert.equal(plain.toString(), 'to the owner of the key');
    // wrong context is refused
    await assert.rejects(openFrom(rec.secret, s.record, { context: 'other' }), { code: 'auth-failed' });
  }
  // reference writer -> project reader
  const esec = Buffer.alloc(32, 0x33), epk = pubRaw(privOf(esec)), nonce = Buffer.alloc(12, 4), ctx = Buffer.from('ctx');
  const shared = diffieHellman({ privateKey: privOf(esec), publicKey: pubObj(rpk) }), framed = Buffer.concat([leb(ctx.length), ctx]);
  const key = hk(shared, Buffer.concat([epk, rpk]), Buffer.concat([Buffer.from('tgr1/aes-256-gcm'), Buffer.from([0]), framed]));
  const head = Buffer.concat([Buffer.from([1, 0]), epk]);
  const ct = gcmSeal(key, nonce, Buffer.concat([Buffer.from('tgr1'), head, framed]), Buffer.concat([Buffer.from([2]), Buffer.from('hand made')]));
  const out = await openFrom(rec.secret, 'tgr1.' + Buffer.concat([head, nonce, ct]).toString('base64url'), { context: 'ctx' });
  assert.equal(out.text, 'hand made');
});
test('tgr1: every single-bit change and every truncation of a sealed record is refused; an all-zero (small-order) ephemeral key is refused', async () => {
  const rec = await newRecipient(seededRandom('rcpt2'));
  const s = await sealTo(rec.public, { kind: 'text', payload: Buffer.from('tamper') }, { compress: false, random: seededRandom('tgr1b') });
  const bytes = Buffer.from(s.record.slice(5), 'base64url');
  for (let i = 0; i < bytes.length; i++) for (let bit = 0; bit < 8; bit++) {
    const m = Buffer.from(bytes); m[i] ^= 1 << bit;
    await assert.rejects(openFrom(rec.secret, 'tgr1.' + m.toString('base64url')), (e) => e.name === 'CryptError', `byte ${i} bit ${bit}`);
  }
  for (let n = 0; n < bytes.length; n += 3) await assert.rejects(openFrom(rec.secret, 'tgr1.' + bytes.subarray(0, n).toString('base64url')), (e) => e.name === 'CryptError');
  const zero = Buffer.from(bytes); zero.fill(0, 2, 34);
  await assert.rejects(openFrom(rec.secret, 'tgr1.' + zero.toString('base64url')), (e) => e.name === 'CryptError');
});

// ================================ shares, mixing, vault ===================================================================
function refGf() {
  const mul = (a, b) => { let p = 0; while (b) { if (b & 1) p ^= a; a <<= 1; if (a & 0x100) a ^= 0x11b; b >>= 1; } return p; };
  const pow = (a, n) => { let r = 1; while (n) { if (n & 1) r = mul(r, a); a = mul(a, a); n >>= 1; } return r; };
  const inv = (a) => pow(a, 254);
  const at0 = (pts) => { let acc = 0; for (let i = 0; i < pts.length; i++) { let l = 1; for (let j = 0; j < pts.length; j++) if (i !== j) l = mul(l, mul(pts[j][0], inv(pts[i][0] ^ pts[j][0]))); acc ^= mul(pts[i][1], l); } return acc; };
  return { mul, inv, at0 };
}
const GF = refGf();
function refParseShare(text) {
  assert.ok(text.startsWith('tgsh1.'));
  const raw = b58dec(text.slice(6)), body = raw.subarray(0, -4);
  assert.deepEqual(raw.subarray(-4), check('tgsh1', body, 4));
  return { type: body[1], setId: body.subarray(2, 6), k: body[6], n: body[7], index: body[8], data: body.subarray(9) };
}
test('Shamir and XOR shares: layout parsed by hand; any k shares reconstruct with an independent GF(256) implementation (peasant multiplication, inverse a^254); k-1 shares do not', async () => {
  const secret = Buffer.from('0123456789abcdef0123456789abcdeffedcba98765432100123456789abcdef', 'hex');
  for (const [k, n] of [[2, 2], [2, 5], [3, 5], [5, 5], [4, 9]]) {
    const shares = (await splitShamir(secret, k, n, { random: seededRandom(`sh${k}${n}`) })).map(refParseShare);
    assert.ok(shares.every((s, i) => s.type === 2 && s.k === k && s.n === n && s.index === i + 1 && s.data.length === 32));
    for (const pick of [shares.slice(0, k), shares.slice(n - k), [...shares].reverse().slice(0, k)]) {
      const out = Buffer.from(Array.from({ length: 32 }, (_, j) => GF.at0(pick.map((s) => [s.index, s.data[j]]))));
      assert.deepEqual(out, secret, `${k} of ${n}`);
    }
    if (k > 2) { // k-1 shares interpolate to something else (a fixed wrong answer of the right shape, not the secret)
      const few = shares.slice(0, k - 1); const out = Buffer.from(Array.from({ length: 32 }, (_, j) => GF.at0(few.map((s) => [s.index, s.data[j]]))));
      assert.notDeepEqual(out, secret);
    }
  }
  const x = (await splitXor(secret, 4, { random: seededRandom('x4') })).map(refParseShare);
  assert.ok(x.every((s) => s.type === 1 && s.k === 4 && s.n === 4));
  assert.deepEqual(Buffer.from(x.reduce((acc, s) => acc.map((b, i) => b ^ s.data[i]), Buffer.alloc(32))), secret);
});
test('Shamir: shares made by an independent splitter (hand-written layout and checksum) are joined by the project', async () => {
  const secret = Buffer.from('independent secret 32 bytes long!');
  const k = 3, n = 5, setId = Buffer.from('01020304', 'hex');
  const coeffs = Array.from(secret, (s) => [s, 17, 99].map((c, i) => (i === 0 ? s : c ^ s)));
  const polyAt = (c, x) => c.reduceRight((y, co) => GF.mul(y, x) ^ co, 0);
  const share = (x) => { const body = Buffer.concat([Buffer.from([1, 2]), setId, Buffer.from([k, n, x]), Buffer.from(coeffs.map((c) => polyAt(c, x)))]); return 'tgsh1.' + b58enc(Buffer.concat([body, check('tgsh1', body, 4)])); };
  assert.deepEqual(Buffer.from(await joinShares([share(5), share(2), share(4)])), secret);
  assert.deepEqual(Buffer.from(await joinShares([share(1), share(2), share(3), share(4), share(5)])), secret);
});
test('password mixing: key = HKDF-SHA-256(secret || stretched, salt "tgxm1/hkdf", info "tgxm1/key") with stretched = KDF(password, SHA-256("tgxm1/salt" || secret)): Argon2id and PBKDF2 variants by hand', async () => {
  const secret = Buffer.alloc(32, 0x77), salt = sha(Buffer.from('tgxm1/salt'), secret);
  const a = { kdf: 'argon2id', memoryKiB: 8192, passes: 1, parallelism: 1 };
  const stretchedA = argon2Sync('argon2id', { message: Buffer.from('mix pass'), nonce: salt, parallelism: 1, tagLength: 32, memory: 8192, passes: 1 });
  assert.equal(toHex(await mixKey(secret, 'mix pass', a)), hk(Buffer.concat([secret, stretchedA]), 'tgxm1/hkdf', 'tgxm1/key').toString('hex'));
  const p = { kdf: 'pbkdf2-sha512', iterations: 100_000 };
  const stretchedP = pbkdf2Sync('mix pass', salt, 100_000, 32, 'sha512');
  assert.equal(toHex(await mixKey(secret, 'mix pass', p)), hk(Buffer.concat([secret, stretchedP]), 'tgxm1/hkdf', 'tgxm1/key').toString('hex'));
  const m = await newMixed('pw', { params: p, random: seededRandom('mix') });
  const raw = b58dec(m.half.slice(6)), body = raw.subarray(0, -2);
  assert.deepEqual(raw.subarray(-2), check('tgxm1', body));
  assert.equal(body[0], 1); assert.equal(body[1], 1); // params id 1 = pbkdf2-sha512
  const [iters, at] = readLeb(body, 2); assert.equal(iters, 100_000);
  const hs = body.subarray(at); assert.equal(hs.length, 32);
  assert.equal(toHex(await mixedKey(m.half, 'pw')), toHex(m.key));
  assert.equal(m.key.length, 32);
  assert.notEqual(toHex(await mixedKey(m.half, 'pw2')), toHex(m.key));
});
test('vault: layout parsed by hand; each factor wrapped with HKDF(factorKey, salt "tgv1/wrap", info name) + AES-256-GCM with AAD "tgv1" || header || entry head; shares recombine (independent GF) to the vault secret; check tag HMAC(secret, "tgv1/check")', async () => {
  const kSeed = Buffer.alloc(32, 1), kPass = Buffer.alloc(32, 2);
  const params = { kdf: 'pbkdf2-sha512', iterations: 100_000 };
  const { vault, secret } = await createVault([{ name: 'seed', key: kSeed }, { name: 'passkey', key: kPass }, { name: 'phrase', passphrase: 'correct horse battery', params }], { k: 2, random: seededRandom('vault1') });
  assert.ok(vault.startsWith('tgv1.'));
  const raw = Buffer.from(vault.slice(5), 'base64url'), body = raw.subarray(0, -4);
  assert.deepEqual(raw.subarray(-4), check('tgv1', body, 4));
  assert.deepEqual([...body.subarray(0, 3)], [1, 2, 3]);
  const header = body.subarray(0, 7);
  assert.deepEqual(header.subarray(3), createHmac('sha256', secret).update('tgv1/check').digest().subarray(0, 4));
  let at = 7; const points = []; const factorKeys = { seed: kSeed, passkey: kPass };
  for (let i = 0; i < 3; i++) {
    const start = at, nl = body[at++], name = body.subarray(at, at + nl).toString(); at += nl;
    const x = body[at++], kl = body[at++]; let fk = factorKeys[name];
    if (kl) { assert.equal(body[at], 1); const [it, a2] = readLeb(body, at + 1); assert.equal(it, 100_000); const salt = body.subarray(a2, a2 + 16); assert.equal(a2 + 16, at + kl); fk = pbkdf2Sync('correct horse battery', salt, it, 32, 'sha512'); }
    at += kl;
    const head = body.subarray(start, at), nonce = body.subarray(at, at + 12), ct = body.subarray(at + 12, at + 12 + 48); at += 60;
    const wrap = hk(fk, 'tgv1/wrap', name);
    points.push([x, gcmOpen(wrap, nonce, Buffer.concat([Buffer.from('tgv1'), header, head]), ct)]);
  }
  assert.equal(at, body.length);
  for (const pick of [[0, 1], [1, 2], [0, 2]]) assert.deepEqual(Buffer.from(Array.from({ length: 32 }, (_, j) => GF.at0(pick.map((i) => [points[i][0], points[i][1][j]])))), Buffer.from(secret));
  // and the project opens it with two factors; one factor, or only the passphrase, is never enough
  assert.deepEqual(Buffer.from((await openVault(vault, { seed: { key: kSeed }, passkey: { key: kPass } })).secret), Buffer.from(secret));
  assert.deepEqual(Buffer.from((await openVault(vault, { seed: { key: kSeed }, phrase: { passphrase: 'correct horse battery' } })).secret), Buffer.from(secret));
  await assert.rejects(openVault(vault, { phrase: { passphrase: 'correct horse battery' } }), { code: 'vault-too-few' });
  await assert.rejects(createVault([{ name: 'a', passphrase: 'x' }, { name: 'b', passphrase: 'y' }], { k: 2 }), { code: 'bad-option' });
  // single-bit damage anywhere in the vault is refused (checksum) or yields no secret
  for (let i = 0; i < raw.length; i += 7) { const m = Buffer.from(raw); m[i] ^= 0x10; await assert.rejects(openVault('tgv1.' + m.toString('base64url'), { seed: { key: kSeed }, passkey: { key: kPass } }), (e) => e.name === 'CryptError'); }
});

// ================================ book ciphers ============================================================================
test('tg1 key: independent decoder (base64url, 8-byte SHA-256 fingerprint of the canonical text, LEB128 positions) reads what the project hid', async () => {
  const secret = 'the owner keeps a secret';
  const key = await hideSecret(WORK, secret, { random: seededRandom('tg1') });
  assert.ok(key.startsWith('tg1.'));
  const bytes = Buffer.from(key.slice(4), 'base64url');
  assert.deepEqual(bytes.subarray(0, 8), WORK_DIGEST.subarray(0, 8));
  const chars = [...WORK]; let at = 8, out = '';
  while (at < bytes.length) { let p; [p, at] = readLeb(bytes, at); out += chars[p]; }
  assert.equal(out, secret);
  assert.equal(await revealSecret(WORK, key), secret);
});
test('tg2 key: independent decoder (flags, fingerprint, LEB128 count, fixed-width or Rice-coded positions, check value) reads what the project hid, in both coding modes', async () => {
  const text = WORK.repeat(4), secrets = ['the owner keeps a secret', 'a'.repeat(40) + 'zzz'];
  for (const [secret, near] of [[secrets[0], Infinity], [secrets[0], 4], [secrets[1], Infinity], [secrets[1], 2]]) {
    for (const shortFp of [false, true]) {
      const key = await hideCompact(text, secret, { near, shortFingerprint: shortFp, random: seededRandom('tg2' + near + shortFp) });
      const raw = b58dec(key.slice(4)), body = raw.subarray(0, -2);
      assert.deepEqual(raw.subarray(-2), check('tg2', body));
      const flags = body[0], mode = flags & 1, fpLen = flags & 2 ? 4 : 8, param = flags >> 2;
      assert.equal(!!(flags & 2), shortFp);
      assert.deepEqual(body.subarray(1, 1 + fpLen), sha(Buffer.from(text)).subarray(0, fpLen));
      const [count, at] = readLeb(body, 1 + fpLen);
      assert.equal(count, [...secret].length);
      const chars = [...text], N = chars.length; let pos = at * 8;
      const bit = () => (body[pos >> 3] >> (7 - (pos & 7))) & 1 && (pos++, 1) || (pos++, 0);
      const bits = (w) => { let v = 0; for (let i = 0; i < w; i++) v = v * 2 + bit(); return v; };
      let prev = -1, out = '';
      for (let i = 0; i < count; i++) {
        let p;
        if (mode === 0) p = bits(param + 1); else { let q = 0; while (bit()) q++; p = (prev + 1 + q * 2 ** param + bits(param)) % N; }
        out += chars[p]; prev = p;
      }
      assert.equal(out, secret);
      assert.equal(await revealCompact(text, key), secret);
    }
  }
});

// ================================ randomness ==============================================================================
test('fresh randomness: two seals of the same data share neither secret nor nonce nor record; nonces never repeat over 2000 seals under one master-derived key family', async () => {
  const a = await sealMessage(WORK, 'same'), b = await sealMessage(WORK, 'same');
  assert.notEqual(a.key, b.key); assert.notEqual(a.record, b.record);
  const nonces = new Set(); const master = randomBytes(32);
  for (let i = 0; i < 2000; i++) {
    const s = await sealWithSecret(WORK, { kind: 'text', payload: Buffer.from('n') }, Uint8Array.from(master), { compress: false });
    nonces.add(Buffer.from(s.record.slice(5), 'base64url').subarray(2, 14).toString('hex'));
  }
  assert.equal(nonces.size, 2000, 'a 96-bit random nonce repeated in 2000 draws');
});
test('sealBound2 draws a fresh secret each time and its tgx2 key hides the work from a key-only reader (the key text contains no part of SHA-256(work))', async () => {
  const s = await sealBound2(WORK, { kind: 'text', payload: Buffer.from('h') });
  const raw = b58dec(s.key.slice(5));
  assert.equal(raw.indexOf(WORK_DIGEST.subarray(0, 8)), -1);
  const t = await sealItem(WORK, { kind: 'text', payload: Buffer.from('h') });
  assert.ok(b58dec(t.key.slice(5)).indexOf(WORK_DIGEST.subarray(0, 8)) >= 0);
});
