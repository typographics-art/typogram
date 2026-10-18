// Differential tests (internal adversarial review 2026-10, docs/security-review-internal-2026-10-b.md): the formats of
// docs/key-format.md and docs/key-management.md re-implemented here from the SPEC with node:crypto, node:zlib and BigInt
// only (no function of src/ is used on the reference side), then compared with the project's results on the frozen
// fixtures and on fresh random inputs, in BOTH directions where the reference can also produce: a record sealed by the
// reference must open in the project, and the other way round. A difference is a finding against the code or the spec.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, hkdfSync, pbkdf2Sync, argon2Sync, createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, randomBytes, randomInt } from 'node:crypto';
import { inflateRawSync, deflateRawSync, brotliDecompressSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { sealItem, openSealed, parseKey } from '../src/crypt.js';
import { recordKey, recipientSecret, parseMaster, masterFromSeed, formatMaster, mnemonicToSeed } from '../src/keys.js';
import { sealBound2, parseKey2, openAny, sealWithSecret } from '../src/keys-work.js';
import { sealTextTo, sealBytesTo, openFrom, newRecipient } from '../src/keys-seal.js';
import { splitShamir, joinShares, createVault, openVault, mixedKey, newMixed, factorFromMaster, factorFromPrf } from '../src/keys-split.js';

const KV = JSON.parse(readFileSync(new URL('./fixtures/key-management-vectors.json', import.meta.url), 'utf8'));
const CV = JSON.parse(readFileSync(new URL('./fixtures/conformance/crypt-vectors.json', import.meta.url), 'utf8'));
const WORK = CV.work;
// the text the key-management vectors were bound to (scripts/build-key-vectors.mjs WORK; a constant, copied here as data)
const KWORK = 'Call me Ishmael. Some years ago, never mind how long precisely, having little or no money in my purse, I thought I would sail about a little.';
const hex = (b) => Buffer.from(b).toString('hex');
const H = (s) => Buffer.from(s, 'hex');

// ============================ the reference, from the spec ===============================================================
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58decode(s) {
  let z = 0; while (z < s.length && s[z] === '1') z++;
  let n = 0n; for (const c of s) { const v = B58.indexOf(c); if (v < 0) throw new Error('not base58'); n = n * 58n + BigInt(v); }
  const out = []; while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; }
  return Buffer.from([...new Array(z).fill(0), ...out]);
}
function b58encode(buf) {
  let z = 0; while (z < buf.length && buf[z] === 0) z++;
  let n = 0n; for (const b of buf) n = n * 256n + BigInt(b);
  let s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  return '1'.repeat(z) + s;
}
const sha256 = (...parts) => createHash('sha256').update(Buffer.concat(parts.map((p) => Buffer.from(p)))).digest();
const check = (domain, body, n = 2) => sha256(Buffer.from(domain), Buffer.from([0]), body).subarray(0, n);
const varint = (n) => { const out = []; do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 0x80; out.push(b); } while (n); return Buffer.from(out); };
const readVarint = (b, at) => { let n = 0, mul = 1; for (let i = at; i < b.length && i < at + 7; i++) { n += (b[i] & 0x7f) * mul; if (!(b[i] & 0x80)) return [n, i + 1]; mul *= 128; } throw new Error('varint'); };
const frame = (b) => Buffer.concat([varint(b.length), b]);
const canonical = (t) => String(t).replace(/\p{Default_Ignorable_Code_Point}/gu, '').normalize('NFC').replace(/\s+/g, ' ').trim();
const squeeze = (s) => String(s).replace(/\s+/g, '');
const b64u = (s) => Buffer.from(s, 'base64url');
const hkdf = (ikm, salt, info, n = 32) => Buffer.from(hkdfSync('sha256', ikm, salt, info, n));
const nfc = (s) => Buffer.from(String(s).normalize('NFC'));
const aeadOpen = (key, nonce, aad, ctAndTag) => { const d = createDecipheriv('aes-256-gcm', key, nonce); d.setAAD(aad); d.setAuthTag(ctAndTag.subarray(-16)); return Buffer.concat([d.update(ctAndTag.subarray(0, -16)), d.final()]); };
const aeadSeal = (key, nonce, aad, plain) => { const c = createCipheriv('aes-256-gcm', key, nonce); c.setAAD(aad); return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]); };
function decodeChecked(text, prefix, domain, n = 2) {
  const t = squeeze(text); assert.ok(t.startsWith(prefix), `prefix ${prefix}`);
  const raw = b58decode(t.slice(prefix.length)), body = raw.subarray(0, raw.length - n);
  assert.equal(hex(raw.subarray(-n)), hex(check(domain, body, n)), `${prefix} check`);
  return body;
}

// --- tgx1 keys and tgs1 records (key-format.md 2.3, 2.4) ---
function refParseKey(text) {
  const body = decodeChecked(text, 'tgx1.', 'tgx1');
  assert.equal(body[0], 1); const f = body[1]; assert.equal(f & 0xf8, 0);
  const sl = f & 4 ? 16 : 32; let at = 2;
  const secret = body.subarray(at, at + sl); at += sl;
  const fp = f & 1 ? body.subarray(at, at + 8) : null; at += f & 1 ? 8 : 0;
  const inline = f & 2 ? body.subarray(at) : null; if (!(f & 2)) assert.equal(body.length, at, 'no extra bytes');
  return { secret, fp, inline, bound: !!(f & 1) };
}
function refOpen(workText, { secret, password }, recordInput) {
  let bytes;
  if (Buffer.isBuffer(recordInput) || recordInput instanceof Uint8Array) bytes = Buffer.from(recordInput);
  else { let s = squeeze(recordInput); if (s.startsWith('TGS1[') && s.endsWith(']TGS1')) s = s.slice(5, -5); assert.ok(s.startsWith('tgs1.')); bytes = b64u(s.slice(5)); }
  assert.equal(bytes[0], 1); const flags = bytes[1]; assert.equal(flags & 0xf0, 0);
  let at = 2, salt = null, iterations = null;
  if (flags & 4) { salt = bytes.subarray(2, 18); [iterations, at] = readVarint(bytes, 18); assert.ok(iterations >= 100000 && iterations <= 5000000); }
  const head = bytes.subarray(0, at), nonce = bytes.subarray(at, at + 12), ct = bytes.subarray(at + 12);
  const digest = flags & 1 ? sha256(Buffer.from(canonical(workText))) : Buffer.alloc(0);
  const ikm = flags & 4 ? pbkdf2Sync(nfc(password), salt, iterations, 32, 'sha256') : Buffer.from(secret);
  const key = hkdf(ikm, Buffer.from('tgx1/salt'), Buffer.concat([Buffer.from('tgx1/aes-256-gcm'), digest]));
  const plain = aeadOpen(key, nonce, Buffer.concat([Buffer.from('tgs1'), head]), ct);
  const [len, p] = readVarint(plain, 0);
  const kind = plain[p]; let data = plain.subarray(p + 1, p + len);
  assert.ok(plain.subarray(p + len).every((b) => b === 0), 'zero padding');
  if (flags & 2) data = inflateRawSync(data);
  if (flags & 8) data = brotliDecompressSync(data);
  return { kind: { 1: 'tgd', 2: 'text', 3: 'bytes' }[kind], bytes: data };
}
function refSeal(workText, kind, payload, { bind, secret, compress, pad = 0, password, iterations = 100000 } = {}) {
  const digest = bind ? sha256(Buffer.from(canonical(workText))) : Buffer.alloc(0);
  let body = Buffer.from(payload), flags = bind ? 1 : 0;
  if (compress) { const z = deflateRawSync(body); if (z.length < body.length) { body = z; flags |= 2; } }
  const data = Buffer.concat([Buffer.from([kind]), body]);
  let plain = Buffer.concat([varint(data.length), data]);
  if (pad) plain = Buffer.concat([plain, Buffer.alloc((pad - (plain.length % pad)) % pad)]);
  let kdf = Buffer.alloc(0), ikm;
  if (password !== undefined) { const salt = randomBytes(16); kdf = Buffer.concat([salt, varint(iterations)]); ikm = pbkdf2Sync(nfc(password), salt, iterations, 32, 'sha256'); flags |= 4; } else ikm = Buffer.from(secret);
  const head = Buffer.concat([Buffer.from([1, flags]), kdf]), nonce = randomBytes(12);
  const key = hkdf(ikm, Buffer.from('tgx1/salt'), Buffer.concat([Buffer.from('tgx1/aes-256-gcm'), digest]));
  const bytes = Buffer.concat([head, nonce, aeadSeal(key, nonce, Buffer.concat([Buffer.from('tgs1'), head]), plain)]);
  let keyText = null;
  if (secret) { const raw = Buffer.concat([Buffer.from([1, (bind ? 1 : 0) | (secret.length === 16 ? 4 : 0)]), Buffer.from(secret), bind ? digest.subarray(0, 8) : Buffer.alloc(0)]); keyText = 'tgx1.' + b58encode(Buffer.concat([raw, check('tgx1', raw)])); }
  return { record: 'tgs1.' + bytes.toString('base64url'), bytes, key: keyText };
}

// --- master, record keys, recipient secrets (key-management.md 2) ---
const hmac512 = (key, data) => createHmac('sha512', key).update(data).digest();
function refMasterFromSeed(seed) {
  let i = hmac512(Buffer.from('Symmetric key seed'), seed);
  for (const label of ['tgart', 'master', 'v1']) i = hmac512(i.subarray(0, 32), Buffer.concat([Buffer.from([0]), Buffer.from(label)]));
  return i.subarray(32);
}
const refFormatMaster = (m) => { const body = Buffer.concat([Buffer.from([1]), m]); return 'tgmk1.' + b58encode(Buffer.concat([body, check('tgmk1', body)])); };
const refParseMaster = (t) => { const body = decodeChecked(t, 'tgmk1.', 'tgmk1'); assert.equal(body[0], 1); assert.equal(body.length, 33); return body.subarray(1); };
const refRecordKey = (master, id, ctx = '') => hkdf(master, Buffer.from('tgart/hkdf/v1'), Buffer.concat([Buffer.from('tgart/record-key/v1'), Buffer.from([0]), frame(nfc(id)), frame(nfc(ctx))]));
const refRecipientSecret = (master, index) => hkdf(master, Buffer.from('tgart/hkdf/v1'), Buffer.concat([Buffer.from('tgart/recipient/v1'), Buffer.from([0]), varint(index)]));
const refFactorFromMaster = (master) => hkdf(master, Buffer.from('tgart/hkdf/v1'), Buffer.from('tgart/factor/seed/v1'));
const refFactorFromPrf = (prf) => hkdf(prf, Buffer.from('tgart/hkdf/v1'), Buffer.from('tgart/factor/passkey/v1'));

// --- tgx2 (key-management.md 4) ---
const refWorkTag = (secret, digest) => createHmac('sha256', secret).update(Buffer.concat([Buffer.from('tgx2/work'), digest])).digest().subarray(0, 4);
function refParseKey2(text) {
  const body = decodeChecked(text, 'tgx2.', 'tgx2');
  assert.equal(body[0], 2); const f = body[1]; const sl = f & 4 ? 16 : 32; let at = 2;
  const secret = body.subarray(at, at + sl); at += sl;
  const tag = f & 1 ? body.subarray(at, at + 4) : null; at += f & 1 ? 4 : 0;
  const inline = f & 2 ? body.subarray(at) : null; if (!(f & 2)) assert.equal(body.length, at);
  return { secret, tag, inline };
}

// --- tgr1 (key-management.md 3.2) ---
const PKCS8 = H('302e020100300506032b656e04220420'), SPKI = H('302a300506032b656e032100');
const xPriv = (sk) => createPrivateKey({ key: Buffer.concat([PKCS8, Buffer.from(sk)]), format: 'der', type: 'pkcs8' });
const xPub = (pk) => createPublicKey({ key: Buffer.concat([SPKI, Buffer.from(pk)]), format: 'der', type: 'spki' });
const xPublicOf = (sk) => createPublicKey(xPriv(sk)).export({ format: 'der', type: 'spki' }).subarray(-32);
const x25519 = (sk, pk) => diffieHellman({ privateKey: xPriv(sk), publicKey: xPub(pk) });
const refParsePublic = (t) => { const body = decodeChecked(t, 'tgp1.', 'tgp1'); assert.equal(body[0], 1); assert.equal(body.length, 33); return body.subarray(1); };
const refParseSecret = (t) => { const body = decodeChecked(t, 'tgq1.', 'tgq1'); assert.equal(body[0], 1); assert.equal(body.length, 33); return body.subarray(1); };
const refFormatPublic = (pk) => { const body = Buffer.concat([Buffer.from([1]), pk]); return 'tgp1.' + b58encode(Buffer.concat([body, check('tgp1', body)])); };
function refOpenFrom(secret, recordText, ctx = '') {
  const s = squeeze(recordText); assert.ok(s.startsWith('tgr1.'));
  const bytes = b64u(s.slice(5)); assert.equal(bytes[0], 1); const flags = bytes[1]; assert.equal(flags & 0xfe, 0);
  const epk = bytes.subarray(2, 34), nonce = bytes.subarray(34, 46), ct = bytes.subarray(46);
  const rpk = xPublicOf(secret), shared = x25519(secret, epk);
  assert.ok(!shared.every((b) => b === 0), 'low-order point');
  const ctxB = nfc(ctx);
  const key = hkdf(shared, Buffer.concat([epk, rpk]), Buffer.concat([Buffer.from('tgr1/aes-256-gcm'), Buffer.from([0]), frame(ctxB)]));
  const plain = aeadOpen(key, nonce, Buffer.concat([Buffer.from('tgr1'), bytes.subarray(0, 34), frame(ctxB)]), ct);
  let data = plain.subarray(1); if (flags & 1) data = inflateRawSync(data);
  return { kind: { 1: 'tgd', 2: 'text', 3: 'bytes' }[plain[0]], bytes: data };
}
function refSealTo(pubText, kind, payload, ctx = '', compress = true) {
  const rpk = refParsePublic(pubText), esk = randomBytes(32), epk = xPublicOf(esk), shared = x25519(esk, rpk);
  let body = Buffer.from(payload), flags = 0;
  if (compress) { const z = deflateRawSync(body); if (z.length < body.length) { body = z; flags = 1; } }
  const ctxB = nfc(ctx), head = Buffer.concat([Buffer.from([1, flags]), epk]), nonce = randomBytes(12);
  const key = hkdf(shared, Buffer.concat([epk, rpk]), Buffer.concat([Buffer.from('tgr1/aes-256-gcm'), Buffer.from([0]), frame(ctxB)]));
  const ct = aeadSeal(key, nonce, Buffer.concat([Buffer.from('tgr1'), head, frame(ctxB)]), Buffer.concat([Buffer.from([kind]), body]));
  return 'tgr1.' + Buffer.concat([head, nonce, ct]).toString('base64url');
}

// --- GF(256), Shamir shares (key-management.md 5.1), the vault (7) ---
const gfMul = (a, b) => { let r = 0; for (let i = 0; i < 8; i++) { if (b & 1) r ^= a; b >>= 1; a <<= 1; if (a & 0x100) a ^= 0x11b; } return r; };
const gfPow = (a, e) => { let r = 1; for (let i = 0; i < e; i++) r = gfMul(r, a); return r; };
const gfInv = (a) => gfPow(a, 254); // FIPS-197 equation 4.11
function lagrange0(points) {
  let acc = 0;
  for (let i = 0; i < points.length; i++) {
    let num = 1, den = 1;
    for (let j = 0; j < points.length; j++) if (i !== j) { num = gfMul(num, points[j][0]); den = gfMul(den, points[i][0] ^ points[j][0]); }
    acc ^= gfMul(points[i][1], gfMul(num, gfInv(den)));
  }
  return acc;
}
function refParseShare(text) {
  const body = decodeChecked(text, 'tgsh1.', 'tgsh1', 4);
  assert.equal(body[0], 1);
  return { type: body[1], setId: hex(body.subarray(2, 6)), k: body[6], n: body[7], index: body[8], data: body.subarray(9) };
}
function refJoin(texts) {
  const sh = texts.map(refParseShare);
  assert.ok(sh.every((s) => s.setId === sh[0].setId && s.type === sh[0].type && s.k === sh[0].k));
  assert.ok(sh.length >= sh[0].k, 'enough shares');
  if (sh[0].type === 1) { const out = Buffer.alloc(sh[0].data.length); for (const s of sh) for (let j = 0; j < out.length; j++) out[j] ^= s.data[j]; return out; }
  const use = sh.slice(0, sh[0].k);
  return Buffer.from(Array.from({ length: use[0].data.length }, (_, j) => lagrange0(use.map((s) => [s.index, s.data[j]]))));
}
function refSplit(secret, k, n) {
  const setId = randomBytes(4);
  const polys = Array.from(secret, (s) => [s, ...randomBytes(k - 1)]);
  const evalAt = (c, x) => { let y = 0; for (let i = c.length - 1; i >= 0; i--) y = gfMul(y, x) ^ c[i]; return y; };
  return Array.from({ length: n }, (_, i) => { const body = Buffer.concat([Buffer.from([1, 2]), setId, Buffer.from([k, n, i + 1]), Buffer.from(polys.map((c) => evalAt(c, i + 1)))]); return 'tgsh1.' + b58encode(Buffer.concat([body, check('tgsh1', body, 4)])); });
}
function refStretch(pw, salt, kdf) {
  let q = 0; const id = kdf[q++];
  if (id === 1) { const [it] = readVarint(kdf, q); return pbkdf2Sync(nfc(pw), salt, it, 32, 'sha512'); }
  assert.equal(id, 2);
  const [m, a] = readVarint(kdf, q), [t, b] = readVarint(kdf, a), [p] = readVarint(kdf, b);
  return argon2Sync('argon2id', { message: nfc(pw), nonce: salt, parallelism: p, tagLength: 32, memory: m, passes: t });
}
function refOpenVault(text, factors) {
  const b = b64u(squeeze(text).slice(5)), body = b.subarray(0, -4);
  assert.equal(hex(b.subarray(-4)), hex(check('tgv1', body, 4)), 'vault check');
  assert.equal(body[0], 1); const k = body[1], n = body[2], header = body.subarray(0, 7);
  let at = 7; const points = [];
  for (let i = 0; i < n; i++) {
    const start = at, nl = body[at++], name = body.subarray(at, at + nl).toString(); at += nl;
    const x = body[at++], kl = body[at++], kdf = body.subarray(at, at + kl); at += kl;
    const head = body.subarray(start, at), nonce = body.subarray(at, at + 12), ctTag = body.subarray(at + 12, at + 60); at += 60;
    const f = factors[name]; if (!f) continue;
    let factorKey;
    if (kl) { const paramsLen = kl - 16; factorKey = refStretch(f.passphrase, kdf.subarray(paramsLen), kdf.subarray(0, paramsLen)); } else factorKey = Buffer.from(f.key);
    const wrap = hkdf(factorKey, Buffer.from('tgv1/wrap'), Buffer.from(name));
    let share; try { share = aeadOpen(wrap, nonce, Buffer.concat([Buffer.from('tgv1'), header, head]), ctTag); } catch { continue; }
    points.push([x, share]);
  }
  assert.equal(at, body.length, 'no extra bytes');
  assert.ok(points.length >= k, 'enough factors');
  const use = points.slice(0, k);
  const V = Buffer.from(Array.from({ length: 32 }, (_, j) => lagrange0(use.map(([x, y]) => [x, y[j]]))));
  assert.equal(hex(createHmac('sha256', V).update('tgv1/check').digest().subarray(0, 4)), hex(header.subarray(3, 7)), 'vault verify');
  return V;
}
// --- password mixing (key-management.md 5.3) ---
function refMixedKey(halfText, password) {
  const body = decodeChecked(halfText, 'tgxm1.', 'tgxm1');
  assert.equal(body[0], 1);
  let q = 1; const id = body[q]; const params = id === 1 ? body.subarray(q, readVarint(body, q + 1)[1]) : body.subarray(q, readVarint(body, readVarint(body, readVarint(body, q + 1)[1])[1])[1]);
  const S = body.subarray(q + params.length); assert.equal(S.length, 32);
  const salt = sha256(Buffer.from('tgxm1/salt'), S);
  return hkdf(Buffer.concat([S, refStretch(password, salt, params)]), Buffer.from('tgxm1/hkdf'), Buffer.from('tgxm1/key'));
}
// --- BIP-39 ---
const refBip39Seed = (mnemonic, pass = '') => pbkdf2Sync(Buffer.from(mnemonic.normalize('NFKD')), Buffer.from(('mnemonic' + pass).normalize('NFKD')), 2048, 64, 'sha512');

// ============================ the comparisons ==============================================================================
test('DIFF tgs1/tgx1: the reference opens every frozen record; the project opens records the reference sealed; 48 fresh random seals both ways', async () => {
  for (const v of CV.sealed) {
    const k = v.key ? refParseKey(v.key) : null;
    const want = v.expect.text ?? v.expect.body ?? v.expect.hex;
    const r = refOpen(v.work, { secret: k?.secret, password: v.password }, v.record ?? k.inline);
    assert.equal(r.kind, v.expect.kind, v.name);
    assert.equal(r.kind === 'bytes' ? hex(r.bytes) : r.bytes.toString('utf8'), want, v.name);
    const p = await openSealed(v.work, { key: v.key ?? undefined, password: v.password, record: v.record });
    assert.equal(hex(p.bytes), hex(r.bytes), v.name);
    if (k) { const pk = await parseKey(v.key); assert.equal(hex(pk.secret), hex(k.secret)); assert.equal(pk.fp && hex(pk.fp), k.fp && hex(k.fp)); assert.equal(pk.inline && hex(pk.inline), k.inline && hex(k.inline)); }
  }
  for (let i = 0; i < 48; i++) {
    const bind = i % 2 === 0, strength = i % 3 === 0 ? 128 : 256, compress = i % 4 === 0 ? false : i % 5 === 0 ? 'brotli' : true, pad = i % 6 === 0 ? 64 : 0, password = i % 7 === 0 ? 'pw ✓ ' + i : undefined;
    const kind = ['text', 'bytes', 'tgd'][i % 3];
    const payload = kind === 'bytes' ? randomBytes(randomInt(0, 300) + 1) : Buffer.from(kind === 'tgd' ? '{"tgd":"1.0","x":' + i + '}' : 'message ' + i + ' ' + 'x'.repeat(randomInt(0, 200)));
    const work = bind ? WORK + ' ' + i : null;
    // project seals, reference opens
    const s = await sealItem(work, { kind, payload }, { bind, strength, compress, pad, password, iterations: 100000 });
    const r = refOpen(work, { secret: s.key ? refParseKey(s.key).secret : undefined, password }, s.record);
    assert.equal(r.kind, kind); assert.equal(hex(r.bytes), hex(payload), `round ${i}`);
    // reference seals, project opens (deflate only: the reference has no brotli writer; the project reads brotli above)
    const secret = password === undefined ? randomBytes(strength / 8) : undefined;
    const q = refSeal(work, { text: 2, bytes: 3, tgd: 1 }[kind], payload, { bind, secret, compress: compress !== false, pad, password });
    if (kind === 'tgd') continue; // the project then also decodes the TGD envelope, which these random payloads are not
    const o = await openSealed(work, { key: q.key ?? undefined, password, record: q.record });
    assert.equal(o.kind, kind); assert.equal(hex(o.bytes), hex(payload), `reference round ${i}`);
    // a record inside a TGS1[ ] block and with whitespace reads the same in both
    const wrapped = 'TGS1[ ' + q.record.replace(/(.{20})/g, '$1\n') + ' ]TGS1';
    assert.equal(hex((await openSealed(work, { key: q.key ?? undefined, password, record: wrapped })).bytes), hex(refOpen(work, { secret, password }, wrapped).bytes));
  }
});

test('DIFF master, record keys, recipient secrets, factors: the SLIP-21 and HKDF chains of the spec reproduce the fixture and the project', async () => {
  const seed = H(KV.master.seedHex);
  const m = refMasterFromSeed(seed);
  assert.equal(hex(m), KV.master.master);
  assert.equal(refFormatMaster(m), KV.master.text);
  assert.equal(hex(refParseMaster(KV.master.text)), KV.master.master);
  assert.equal(hex(await masterFromSeed(seed)), hex(m)); assert.equal(await formatMaster(m), refFormatMaster(m)); assert.equal(hex(await parseMaster(KV.master.text)), hex(m));
  for (const rk of KV.recordKeys) { const id = /^x\*\d+$/.test(rk.id) ? 'x'.repeat(Number(rk.id.slice(2))) : rk.id; /* the fixture writes a 512-character id as x*512 */ assert.equal(hex(refRecordKey(m, id, rk.context)), rk.key, rk.id); assert.equal(hex(await recordKey(m, id, rk.context)), rk.key); }
  for (let i = 0; i < 20; i++) { const id = 'id-' + randomBytes(4).toString('hex') + (i % 2 ? ' é' : ''), ctx = i % 3 ? 'ctx' + i : ''; assert.equal(hex(await recordKey(m, id, ctx)), hex(refRecordKey(m, id, ctx))); }
  assert.equal(hex(refRecipientSecret(m, 0)), KV.recipient.secret0); assert.equal(hex(refRecipientSecret(m, 1)), KV.recipient.secret1);
  assert.equal(hex(await recipientSecret(m, 300)), hex(refRecipientSecret(m, 300)));
  assert.equal(refFormatPublic(xPublicOf(H(KV.recipient.secret0))), KV.recipient.public0);
  assert.equal(hex(refFactorFromMaster(m)), KV.prf.seedFactor);
  assert.equal(hex(await factorFromMaster(m)), KV.prf.seedFactor);
  const PRF_OUT = Buffer.from(Array.from({ length: 32 }, (_, i) => 255 - i)); // the PRF output the fixture's passkey factor was made from (build-key-vectors.mjs)
  assert.equal(hex(refFactorFromPrf(PRF_OUT)), KV.prf.factor);
  assert.equal(hex(await factorFromPrf(PRF_OUT)), KV.prf.factor);
  assert.equal(hex(sha256(Buffer.from('tgart/webauthn-prf/v1\0vault-1'))), KV.prf.input, 'prfInput(label) = SHA-256("tgart/webauthn-prf/v1" 0x00 label)');
  for (const v of KV.bip39) { assert.equal(hex(refBip39Seed(v.mnemonic, v.passphrase)), v.seed); assert.equal(hex(await mnemonicToSeed(v.mnemonic, v.passphrase)), v.seed); }
});

test('DIFF tgx2: the work tag is HMAC-SHA-256(secret, "tgx2/work" || digest)[0..4]; keys of both versions open the same record', async () => {
  const t = KV.tgx2;
  assert.equal(hex(refWorkTag(H(t.key), H(t.digest))), t.tag);
  const k2 = refParseKey2(t.keyText);
  assert.equal(hex(k2.secret), t.key); assert.equal(hex(k2.tag), t.tag);
  assert.equal(refParseKey2(t.unbound).tag, null); assert.equal(refParseKey2(t.key16).secret.length, 16);
  const digest = sha256(Buffer.from(canonical(WORK)));
  for (let i = 0; i < 12; i++) {
    const s = await sealBound2(WORK, { kind: 'text', payload: Buffer.from('m' + i) }, { strength: i % 2 ? 128 : 256, inline: i % 3 === 0 });
    const k = refParseKey2(s.key), p = await parseKey2(s.key);
    assert.equal(hex(k.tag), hex(refWorkTag(k.secret, digest))); assert.equal(hex(p.tag), hex(k.tag)); assert.equal(hex(p.secret), hex(k.secret));
    const r = refOpen(WORK, { secret: k.secret }, s.record ?? k.inline);
    assert.equal(r.bytes.toString(), 'm' + i);
    // the reference seals under the same secret: the project's tgx2 key opens that record too
    const q = refSeal(WORK, 2, Buffer.from('again ' + i), { bind: true, secret: k.secret, compress: true });
    assert.equal((await openAny(WORK, { key: s.key, record: q.record })).text, 'again ' + i);
  }
  assert.equal(hex(sha256(Buffer.from(canonical(KWORK)))), t.digest, 'the fixture digest is the canonical text of the builder work');
  const K = refRecordKey(H(KV.master.master), 'tgx2-vector');
  assert.equal(refOpen(KWORK, { secret: K }, KV.sealedWithSecret.record).bytes.toString(), KV.sealedWithSecret.plain);
  assert.equal(hex(refParseKey2(KV.sealedWithSecret.key).secret), hex(K));
});

test('DIFF tgr1: X25519 + HKDF + AES-GCM re-done with node:crypto opens the fixture and fresh records; records the reference seals open in the project', async () => {
  const m = H(KV.master.master), rs = refRecipientSecret(m, 0);
  const a = refOpenFrom(rs, KV.sealTo[0].record, KV.sealTo[0].context);
  assert.equal(a.kind, 'text'); assert.equal(a.bytes.toString(), KV.sealTo[0].plain);
  assert.equal(hex(refOpenFrom(rs, KV.sealTo[1].record, KV.sealTo[1].context).bytes), KV.sealTo[1].plainHex);
  const r = await newRecipient();
  const sec = refParseSecret(r.secret);
  assert.equal(hex(xPublicOf(sec)), hex(refParsePublic(r.public)));
  for (let i = 0; i < 16; i++) {
    const ctx = i % 2 ? 'work:' + i : '', text = 'to the owner ' + i + ' ' + 'z'.repeat(randomInt(0, 100));
    const s = await (i % 3 ? sealTextTo(r.public, text, { context: ctx }) : sealBytesTo(r.public, Buffer.from(text), { context: ctx, compress: false }));
    assert.equal(refOpenFrom(sec, s.record, ctx).bytes.toString(), text, `project seals ${i}`);
    assert.throws(() => refOpenFrom(sec, s.record, ctx + 'x'), `another context fails in the reference ${i}`);
    const q = refSealTo(r.public, 2, Buffer.from(text), ctx, i % 2 === 0);
    assert.equal((await openFrom(r.secret, q, { context: ctx })).text, text, `reference seals ${i}`);
    await assert.rejects(() => openFrom(r.secret, q, { context: ctx + 'x' }), (e) => e.code === 'auth-failed');
  }
});

test('DIFF Shamir and XOR shares: an independent GF(256) and Lagrange recover the fixture secret and fresh splits; the project joins shares the reference made', async () => {
  assert.equal(hex(refJoin([KV.shamir[4], KV.shamir[0], KV.shamir[2]])), KV.secretHex);
  assert.equal(hex(refJoin(KV.shamir.slice(0, 3))), KV.secretHex);
  assert.equal(hex(refJoin(KV.xor)), KV.secretHex);
  const parsed = refParseShare(KV.shamir[0]); assert.equal(parsed.k, 3); assert.equal(parsed.n, 5);
  for (let i = 0; i < 10; i++) {
    const secret = randomBytes(randomInt(1, 64)), k = 2 + (i % 3), n = k + (i % 4);
    const sh = await splitShamir(secret, k, n);
    const pick = [...sh].sort(() => Math.random() - 0.5).slice(0, k); // any k shares; Math.random only chooses which (no key material)
    assert.equal(hex(refJoin(pick)), hex(secret), `project split ${i}`);
    const mine = refSplit(secret, k, n);
    assert.equal(hex(await joinShares(mine.slice(n - k))), hex(secret), `reference split ${i}`);
    assert.equal(hex(await joinShares(mine)), hex(secret), 'all shares, consistency check passes');
  }
});

test('DIFF vault: wrap keys, AAD, share recovery and the verify tag re-done from the spec open the fixture vault and fresh vaults', async () => {
  const m = H(KV.master.master);
  const V = refOpenVault(KV.vault.vault, { seed: { key: refFactorFromMaster(m) }, passphrase: { passphrase: KV.vault.passphrase } });
  assert.equal(hex(V), KV.vault.secret);
  assert.equal(hex(refOpenVault(KV.vault.vault, { passkey: { key: refFactorFromPrf(Buffer.from(Array.from({ length: 32 }, (_, i) => 255 - i))) }, seed: { key: refFactorFromMaster(m) } })), KV.vault.secret);
  assert.throws(() => refOpenVault(KV.vault.vault, { passphrase: { passphrase: KV.vault.passphrase } }), /enough factors/);
  assert.throws(() => refOpenVault(KV.vault.vault, { seed: { key: refFactorFromMaster(m) }, passphrase: { passphrase: 'wrong' } }), /enough factors/);
  for (let i = 0; i < 4; i++) {
    const fa = randomBytes(32), fb = randomBytes(32), pw = 'phrase ' + i;
    const params = i % 2 ? { kdf: 'pbkdf2-sha512', iterations: 100000 } : { kdf: 'argon2id', memoryKiB: 8192, passes: 1, parallelism: 1 };
    const { vault, secret } = await createVault([{ name: 'a', key: fa }, { name: 'b', key: fb }, { name: 'p', passphrase: pw, params }], { k: 2, mode: 'strict' });
    assert.equal(hex(refOpenVault(vault, { a: { key: fa }, b: { key: fb } })), hex(secret));
    assert.equal(hex(refOpenVault(vault, { p: { passphrase: pw }, b: { key: fb } })), hex(secret));
    assert.equal(hex((await openVault(vault, { a: { key: fa }, p: { passphrase: pw } })).secret), hex(secret));
  }
});

test('DIFF password mixing: salt = SHA-256("tgxm1/salt" || S), K = HKDF(S || KDF(password), "tgxm1/hkdf", "tgxm1/key")', async () => {
  for (const v of KV.mixed) { assert.equal(hex(refMixedKey(v.half, v.password)), v.key); assert.equal(hex(await mixedKey(v.half, v.password)), v.key); }
  for (const params of [{ kdf: 'pbkdf2-sha512', iterations: 100000 }, { kdf: 'argon2id', memoryKiB: 8192, passes: 1, parallelism: 2 }]) {
    const mx = await newMixed('correct horse ✓', { params });
    assert.equal(hex(refMixedKey(mx.half, 'correct horse ✓')), hex(mx.key));
    assert.notEqual(hex(refMixedKey(mx.half, 'correct horse')), hex(mx.key));
  }
});

test('DIFF sealWithSecret: a record key used as the secret seals a record the reference opens, and the printed tgx1/tgx2 keys carry exactly that secret', async () => {
  const m = H(KV.master.master), K = refRecordKey(m, 'diff', 'c');
  const s2 = await sealWithSecret(WORK, { kind: 'text', payload: Buffer.from('k') }, await recordKey(m, 'diff', 'c'));
  const s1 = await sealWithSecret(WORK, { kind: 'text', payload: Buffer.from('k') }, await recordKey(m, 'diff', 'c'), { keyVersion: 1 });
  assert.equal(hex(refParseKey2(s2.key).secret), hex(K)); assert.equal(hex(refParseKey(s1.key).secret), hex(K));
  assert.equal(refOpen(WORK, { secret: K }, s2.record).bytes.toString(), 'k'); assert.equal(refOpen(WORK, { secret: K }, s1.record).bytes.toString(), 'k');
});
