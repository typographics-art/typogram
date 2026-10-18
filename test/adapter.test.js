// The adapter (cli/tg-adapter.mjs) end to end: it seals media as a stream and serves it over HTTP with Range, and serves a
// sealed data block as its native format. Spawns the real CLI and drives it with fetch.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encode } from '../src/structured.js';
import { sealData } from '../src/crypt.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'cli', 'tg-adapter.mjs');
const dir = mkdtempSync(join(tmpdir(), 'tg-adapter-test-'));
const procs = [];
after(() => { for (const p of procs) try { p.kill(); } catch { /* gone */ } rmSync(dir, { recursive: true, force: true }); });

function run(args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn('node', [CLI, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    if (input !== undefined) { p.stdin.write(input); p.stdin.end(); }
    p.on('exit', (code) => resolve({ code, out, err }));
    p.on('error', reject);
  });
}

/** Starts `serve`, resolves once it prints a URL; the process is killed in `after`. */
function serve(args, keyString) {
  return new Promise((resolve, reject) => {
    const p = spawn('node', [CLI, 'serve', ...args, '--key-stdin'], { stdio: ['pipe', 'pipe', 'pipe'] });
    procs.push(p);
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; const m = /http:\/\/\S+/.exec(out); if (m) resolve({ url: m[0], proc: p }); });
    p.stderr.on('data', (d) => (err += d));
    p.on('exit', (code) => reject(new Error(`serve exited (${code}): ${err}`)));
    p.stdin.write(keyString); p.stdin.end();
    setTimeout(() => reject(new Error(`serve printed no URL: ${err}`)), 8000);
  });
}

test('adapter: seals media as a stream and serves it with Content-Type and byte ranges', async () => {
  const data = Buffer.from(Array.from({ length: 7000 }, (_, i) => (i * 131 + 17) & 255));
  const media = join(dir, 'clip.mp4'); writeFileSync(media, data);
  const sealed = join(dir, 'clip.tgst');
  const { code, out } = await run(['seal', media, '-o', sealed, '--frame', '2048']);
  assert.equal(code, 0);
  const key = out.trim().split('\n').pop();
  assert.match(key, /^tgx2\./);

  const { url } = await serve([sealed], key);
  const get = async (headers) => { const r = await fetch(url, { headers }); return { r, b: Buffer.from(await r.arrayBuffer()) }; };

  const full = await get({});
  assert.equal(full.r.status, 200);
  assert.equal(full.r.headers.get('content-type'), 'video/mp4');
  assert.equal(full.r.headers.get('accept-ranges'), 'bytes');
  assert.equal(Buffer.compare(full.b, data), 0, 'full GET returns the original bytes');

  for (const [a, b] of [[100, 199], [2040, 2060], [0, 0], [6990, 7099]]) {
    const { r, b: body } = await get({ Range: `bytes=${a}-${b}` });
    assert.equal(r.status, 206, `range ${a}-${b}`);
    const end = Math.min(b, 6999);
    assert.equal(r.headers.get('content-range'), `bytes ${a}-${end}/7000`);
    assert.equal(Buffer.compare(body, data.subarray(a, end + 1)), 0, `range ${a}-${b} bytes`);
  }
  const suffix = await get({ Range: 'bytes=-50' });
  assert.equal(suffix.r.status, 206);
  assert.equal(Buffer.compare(suffix.b, data.subarray(6950)), 0);

  // a path other than the token is 404 (a stray local request cannot read the plaintext by guessing)
  const u = new URL(url); const notoken = await fetch(`${u.origin}/clip.mp4`);
  assert.equal(notoken.status, 404);
});

test('adapter: serves a sealed data block as its native format (CSV in, CSV out)', async () => {
  const csv = 'name,qty\nBrot,3\nMilch,2\n';
  const block = (await encode({ bytes: new TextEncoder().encode(csv), name: 'orders.csv' }, { created: false })).text;
  const sealed = await sealData('', block);
  const rec = join(dir, 'orders.tgs'); writeFileSync(rec, sealed.record);

  const { url } = await serve([rec], sealed.key);
  const r = await fetch(url);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'text/csv');
  assert.match(r.headers.get('content-disposition') || '', /orders\.csv/);
  const body = (await r.text()).replace(/\r\n/g, '\n').trim();
  assert.equal(body, csv.trim());
});

test('adapter: an unsafe declared media type is served as a download, not rendered (no XSS from a crafted file)', async () => {
  const data = Buffer.from('<script>alert(1)</script>');
  const html = join(dir, 'evil.bin'); writeFileSync(html, data);
  const sealed = join(dir, 'evil.tgst');
  // the metadata type is set by whoever seals: a hostile sender could declare text/html or svg
  const { out } = await run(['seal', html, '-o', sealed, '--type', 'text/html']);
  const key = out.trim().split('\n').pop();
  const { url } = await serve([sealed], key);
  const r = await fetch(url);
  assert.equal(r.headers.get('content-type'), 'application/octet-stream', 'text/html is downgraded');
  assert.match(r.headers.get('content-disposition') || '', /^attachment/, 'served as a download');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('content-security-policy') || '', /default-src 'none'/);
});

test('adapter: a real video keeps its type and is served inline with nosniff', async () => {
  const media = join(dir, 'ok.mp4'); writeFileSync(media, Buffer.from('a tiny clip body'));
  const sealed = join(dir, 'ok.tgst');
  const { out } = await run(['seal', media, '-o', sealed]);
  const { url } = await serve([sealed], out.trim().split('\n').pop());
  const r = await fetch(url);
  assert.equal(r.headers.get('content-type'), 'video/mp4');
  assert.match(r.headers.get('content-disposition') || '', /^inline/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('adapter: refuses to start on a wrong key', async () => {
  const data = Buffer.from('hello world, a small clip');
  const media = join(dir, 'x.mp4'); writeFileSync(media, data);
  const sealed = join(dir, 'x.tgst');
  const { out } = await run(['seal', media, '-o', sealed]);
  const good = out.trim().split('\n').pop();
  // a syntactically valid key of the same shape, but the wrong secret
  const wrong = 'tgx2.' + good.slice(5).split('').reverse().join('');
  const res = await run(['serve', sealed, '--key-stdin', '--port', '0'], { input: wrong });
  assert.equal(res.code, 1);
  assert.match(res.err, /key/i);
});
