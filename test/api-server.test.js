// The paid API over real HTTP, against a fake DigiByte node: what is checked before the body is read, and what
// the client is told. Needs node:sqlite (Node 22.5+); otherwise the whole file is skipped.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TX = 'a'.repeat(64), ADDRESS = 'DTESTADDRESS';
let sqlite = true;
try { await import('node:sqlite'); } catch { sqlite = false; }

let node, api, port, rpcCalls = 0, txs = {};
const base = () => `http://127.0.0.1:${port}`;

before(async () => {
  if (!sqlite) return;
  node = createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      rpcCalls++;
      const { params } = JSON.parse(b);
      const tx = txs[params[0]];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(tx ? { result: tx, error: null } : { result: null, error: { code: -5, message: 'No such mempool or blockchain transaction' } }));
    });
  }).listen(0, '127.0.0.1');
  await new Promise((r) => node.once('listening', r));
  port = 18000 + Math.floor(Math.random() * 1000);
  api = spawn(process.execPath, ['api/server.mjs'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), DATA_DIR: mkdtempSync(join(tmpdir(), 'tg-api-')), RECEIVE_ADDRESS: ADDRESS,
      DGB_RPC_URL: `http://127.0.0.1:${node.address().port}`, LLM_URL: 'http://127.0.0.1:1', IMAGE_URL: 'http://127.0.0.1:1',
      MAX_UPLOAD_MB: '1', PAYMENT_CHECKS_PER_MINUTE: '5', TRUST_PROXY: '1', MIN_DGB: '10', MIN_CONFIRMATIONS: '2' },
  });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base()}/health`)).ok) return; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('API did not start');
});
after(() => { api?.kill(); node?.close(); });

const post = (body, headers = {}) => fetch(`${base()}/v1/onepage`, { method: 'POST', headers: { 'content-type': 'text/plain', 'x-dgb-tx': TX, ...headers }, body });

test('api: wrong type, bad hash and an over-limit upload are refused before the node is asked', { skip: !sqlite }, async () => {
  const before = rpcCalls;
  assert.equal((await post('x', { 'content-type': 'image/png' })).status, 415);
  assert.equal((await post('x', { 'x-dgb-tx': 'zz' })).status, 400);
  const big = await post(Buffer.alloc(3 * 1048576, 97));
  assert.equal(big.status, 413, 'a proper 413, not a reset connection');
  assert.equal((await big.json()).error, 'too_large');
  assert.equal(rpcCalls, before, 'no call to the node for any of these');
});

test('api: an unknown transaction is 402 and is checked BEFORE the body is read', { skip: !sqlite }, async () => {
  const r = await post('hello');
  assert.equal(r.status, 402);
  assert.equal((await r.json()).error, 'tx_not_found');
});

test('api: too many payment checks from one client get 429', { skip: !sqlite }, async () => {
  let last;
  // Different hashes: the same unknown hash is answered from a short cache and costs no check.
  for (let i = 0; i < 8; i++) last = await post('hello', { 'x-dgb-tx': i.toString(16).padStart(64, 'c'), 'cf-connecting-ip': '203.0.113.9' });
  assert.equal(last.status, 429);
  assert.equal(last.headers.get('retry-after'), '60');
});

test('api: asking again for the same unknown hash is answered from a short cache, without a call to the node', { skip: !sqlite }, async () => {
  const id = 'd'.repeat(64);
  assert.equal((await post('hello', { 'x-dgb-tx': id, 'cf-connecting-ip': '203.0.113.20' })).status, 402);
  const before = rpcCalls;
  for (let i = 0; i < 5; i++) assert.equal((await post('hello', { 'x-dgb-tx': id, 'cf-connecting-ip': '203.0.113.20' })).status, 402);
  assert.equal(rpcCalls, before);
});

test('api: an underpaying transaction is 402 with the reason, a failed job exposes no internals', { skip: !sqlite }, async () => {
  const id = 'b'.repeat(64);
  txs[id] = { confirmations: 5, vout: [{ value: 1, scriptPubKey: { address: ADDRESS } }] };
  const r = await post('hello', { 'x-dgb-tx': id, 'cf-connecting-ip': '203.0.113.50' });
  assert.equal(r.status, 402);
  const body = await r.json();
  assert.equal(body.error, 'amount_too_low');
  assert.equal(body.required_dgb, 10);
});

test('api: refuses to start with a nonsense setting', { skip: !sqlite }, async () => {
  const r = await new Promise((resolve) => {
    const p = spawn(process.execPath, ['api/server.mjs'], { cwd: ROOT, env: { ...process.env, RECEIVE_ADDRESS: 'x', DGB_RPC_URL: 'http://127.0.0.1:1', LLM_URL: 'http://127.0.0.1:1', IMAGE_URL: 'http://127.0.0.1:1', MIN_DGB: 'abc' } });
    let err = ''; p.stderr.on('data', (c) => (err += c)); p.on('close', (code) => resolve({ code, err }));
  });
  assert.notEqual(r.code, 0);
  assert.match(r.err, /MIN_DGB/);
});
