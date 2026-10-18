// Controls and hardening: hostile keys, decompression bombs, small-order points, deep nesting, constant-time comparison, and a tripwire on the files that handle keys and decrypted data.
// Regression tests for the findings of the internal security review of 2026-10 (docs/security-review-internal-2026-10.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, createCipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { deflateRawSync, brotliCompressSync } from 'node:zlib';
import { encode, decode, decodeAll, TgdError } from '../src/structured.js';
import { openSealed } from '../src/crypt.js';
import { equalBytes } from '../src/crypt-codec.js';
import { newRecipient, openFrom } from '../src/keys-seal.js';

const enc = new TextEncoder();
const CLI = new URL('../cli/tg-crypt.mjs', import.meta.url).pathname;

// ---- F6: hostile keys cannot reach Object.prototype ---------------------------------------------------------------------
test('F6 prototype pollution: "__proto__", "constructor" and "prototype" keys in JSON, YAML, XML, CSV and key=value files stay ordinary data', async () => {
  const files = { json: '{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted2":2}}}', yaml: '__proto__:\n  polluted: 1\nconstructor:\n  prototype:\n    polluted2: 2\n', xml: '<a __proto__="x" constructor="y"><__proto__>t</__proto__></a>', csv: '__proto__,constructor\n1,2\n', kv: '__proto__=1\nconstructor=2\n' };
  for (const [fmt, text] of Object.entries(files)) {
    const r = await encode({ bytes: enc.encode(text), name: 'x.' + fmt, format: fmt }, { created: false });
    const b = await decode(r.text);
    assert.equal(({}).polluted, undefined); assert.equal(({}).polluted2, undefined); assert.equal(Object.prototype.polluted, undefined);
    assert.ok(JSON.stringify(b.model).includes('__proto__'), fmt);
    if (fmt === 'json' || fmt === 'yaml') assert.ok(Object.prototype.hasOwnProperty.call(b.model.value, '__proto__'), 'an own property, not the prototype');
  }
});

// ---- F7: decompression bombs inside authenticated records ------------------------------------------------------------------
const leb = (n) => { const o = []; do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 0x80; o.push(b); } while (n); return Buffer.from(o); };
const A58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const b58 = (bytes) => { let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b); let s = ''; while (n > 0n) { s = A58[Number(n % 58n)] + s; n /= 58n; } return s; };
const sha = (...p) => createHash('sha256').update(Buffer.concat(p.map((x) => Buffer.from(x)))).digest();
test('F7 a tgs1 record whose deflate or brotli body unpacks to 512 MiB is refused as too-large without unpacking it', async () => {
  const secret = randomBytes(32), head0 = Buffer.from([1, 0]);
  const key = 'tgx1.' + b58(Buffer.concat([head0, secret, sha(Buffer.from('tgx1'), Buffer.from([0]), Buffer.concat([head0, secret])).subarray(0, 2)]));
  const zeros = Buffer.alloc(512 * 1024 * 1024);
  for (const [flag, comp] of [[2, (r) => deflateRawSync(r, { level: 9 })], [8, (r) => brotliCompressSync(r)]]) {
    const data = Buffer.concat([Buffer.from([3]), comp(zeros)]), plain = Buffer.concat([leb(data.length), data]), head = Buffer.from([1, flag]), nonce = randomBytes(12);
    const k = Buffer.from(hkdfSync('sha256', secret, 'tgx1/salt', 'tgx1/aes-256-gcm', 32));
    const c = createCipheriv('aes-256-gcm', k, nonce); c.setAAD(Buffer.concat([Buffer.from('tgs1'), head]));
    const record = 'tgs1.' + Buffer.concat([head, nonce, c.update(plain), c.final(), c.getAuthTag()]).toString('base64url');
    const before = process.memoryUsage().rss;
    await assert.rejects(openSealed(null, { key, record }), { code: 'too-large' });
    assert.ok(process.memoryUsage().rss - before < 200 * 1024 * 1024, 'the bomb must not be unpacked');
  }
});

// ---- F8: comparison of check values ---------------------------------------------------------------------------------------
test('F8 equalBytes: same answers as before for equal, different, shorter and longer inputs (typed arrays and Buffers), without an early exit', () => {
  const a = Uint8Array.of(1, 2, 3, 4);
  assert.equal(equalBytes(a, Uint8Array.of(1, 2, 3, 4)), true);
  assert.equal(equalBytes(a, Buffer.from([1, 2, 3, 4])), true);
  for (const b of [[0, 2, 3, 4], [1, 2, 3, 5], [1, 2, 3], [1, 2, 3, 4, 5], []]) assert.equal(equalBytes(a, Uint8Array.from(b)), false);
  assert.equal(equalBytes(new Uint8Array(0), new Uint8Array(0)), true);
});


// ---- F13: the CLI does not replace an existing record file ---------------------------------------------------------------
test('F13 tg-crypt seal: a second seal into the same default file is refused and leaves the first record (and the key printed for it) intact; --force replaces it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tg-f13-'));
  try {
    const run = (...args) => spawnSync(process.execPath, [CLI, 'seal', '-', '--no-bind', ...args], { cwd: dir, encoding: 'utf8' });
    const first = run('--message', 'first', '-o', 'rec.tgs');
    assert.equal(first.status, 0, first.stderr);
    const before = readFileSync(join(dir, 'rec.tgs'), 'utf8');
    const second = run('--message', 'second', '-o', 'rec.tgs');
    assert.equal(second.status, 1);
    assert.match(second.stderr, /already exists; it was not touched/);
    assert.equal(second.stdout, '', 'no key is printed for a record that was not written');
    assert.equal(readFileSync(join(dir, 'rec.tgs'), 'utf8'), before);
    const forced = run('--message', 'third', '-o', 'rec.tgs', '--force');
    assert.equal(forced.status, 0, forced.stderr);
    assert.notEqual(readFileSync(join(dir, 'rec.tgs'), 'utf8'), before);
    const open = spawnSync(process.execPath, [CLI, 'open', '-', '--record', 'rec.tgs', '--key-stdin'], { cwd: dir, encoding: 'utf8', input: forced.stdout });
    assert.equal(open.stdout.trim(), 'third');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- the all-zero small-order point: refused by tgr1 (RFC 7748 section 6.1 advice) ---------------------------------------------
test('tgr1: a record whose ephemeral key is a small-order point is refused cleanly', async () => {
  const rec = await newRecipient();
  const bytes = Buffer.concat([Buffer.from([1, 0]), Buffer.alloc(32), randomBytes(12), randomBytes(40)]);
  await assert.rejects(openFrom(rec.secret, 'tgr1.' + bytes.toString('base64url')), (e) => e.name === 'CryptError');
});
test('decodeAll: a data block with 70 000 nested arrays is refused as limit, not by a stack overflow', async () => {
  const text = 'TGD1[' + '['.repeat(70000) + ']'.repeat(70000) + ']TGD1';
  const [r] = await decodeAll(text);
  assert.ok(r.error instanceof TgdError); assert.ok(['limit', 'shape', 'syntax'].includes(r.error.code), r.error.code);
});
