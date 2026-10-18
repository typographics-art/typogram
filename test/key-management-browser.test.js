// The key modules in a real browser (headless Chromium, no dependency: the DevTools protocol over a WebSocket): the page
// derives everything from the same frozen vectors and the results must equal the Node results byte for byte. Also: the
// WebAuthn PRF extension with Chromium's virtual authenticator (a passkey that returns a 32-byte secret) feeding the vault.
// Skipped when no Chromium is found (set CHROME_PATH) or Node has no global WebSocket.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, extname, resolve } from 'node:path';
import { build, WORK } from '../scripts/build-key-vectors.mjs';
import { createVault, openVault, factorFromPrf, prfInput } from '../src/keys-split.js';
import { toHex } from '../src/crypt-codec.js';

const root = resolve(new URL('..', import.meta.url).pathname);
const chrome = [process.env.CHROME_PATH, 'chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome'].filter(Boolean).find((c) => spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0);
const vectors = JSON.parse(readFileSync(new URL('./fixtures/key-management-vectors.json', import.meta.url), 'utf8'));
const types = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' };

test('browser: the derivations equal the Node results and the frozen vectors; PRF passkey feeds the vault', { skip: !chrome || typeof WebSocket === 'undefined' ? 'no Chromium or no WebSocket' : false, timeout: 120000 }, async () => {
  const server = createServer((q, r) => {
    try { const f = join(root, new URL(q.url, 'http://x').pathname); if (!f.startsWith(root)) throw new Error('outside'); const b = readFileSync(f); r.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream' }); r.end(b); } catch { r.writeHead(404); r.end(); }
  }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const profile = mkdtempSync(join(tmpdir(), 'tgkeys-chrome-'));
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'];
  if (process.getuid?.() === 0 || process.env.CHROME_NO_SANDBOX) args.unshift('--no-sandbox', '--disable-dev-shm-usage');
  const proc = spawn(chrome, args, { stdio: 'ignore' });
  let ws;
  try {
    let port;
    for (let i = 0; i < 300 && !port; i++) { await new Promise((r) => setTimeout(r, 100)); try { port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { /* not yet */ } }
    assert.ok(port, 'Chromium did not start');
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((r) => { ws.onopen = r; });
    let id = 0; const pend = new Map();
    ws.onmessage = (e) => { const m = JSON.parse(e.data); pend.get(m.id)?.(m); };
    const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result))); ws.send(JSON.stringify({ id: i, method, params })); });
    const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    await send('Page.enable'); await send('Runtime.enable');
    await send('Page.navigate', { url: `http://localhost:${server.address().port}/test/fixtures/keys-browser.html` });
    for (let i = 0; i < 300 && !(await evaluate('window.ready === true')); i++) await new Promise((r) => setTimeout(r, 100));
    const out = await evaluate(`window.runKeys(${JSON.stringify(vectors)}, ${JSON.stringify(WORK)})`);
    assert.equal(out.secure, true);
    assert.equal(out.x25519, true, 'this Chromium has X25519 in Web Crypto');
    assert.deepEqual(out.bip39, vectors.bip39.map((x) => x.seed));
    assert.equal(out.slip21master, vectors.slip21[0].key);
    assert.equal(out.masterText, vectors.master.text);
    assert.deepEqual(out.recordKeys, vectors.recordKeys.map((x) => x.key));
    assert.equal(out.recipientPublic, vectors.recipient.public0);
    assert.equal(out.tgx2, vectors.tgx2.keyText);
    assert.equal(out.opened, vectors.sealedWithSecret.plain);
    assert.equal(out.openedTo, vectors.sealTo[0].plain);
    assert.equal(out.shamir, vectors.secretHex); assert.equal(out.xor, vectors.secretHex);
    assert.deepEqual(out.mixed, vectors.mixed.map((x) => x.key));
    assert.equal(out.vault, vectors.vault.secret);
    assert.deepEqual(out.storage, { local: 0, session: 0 }, 'nothing was written to browser storage');
    // the memory-hard KDF in the browser equals Node's native Argon2id at the default parameters (64 MiB, 3 passes)
    const { argon2Sync, pbkdf2Sync } = await import('node:crypto');
    assert.equal(out.argon, argon2Sync('argon2id', { message: Buffer.from('browser'), nonce: Buffer.alloc(16, 2), parallelism: 1, tagLength: 32, memory: 65536, passes: 3 }).toString('hex'));
    assert.equal(out.pbkdf2, pbkdf2Sync('browser', Buffer.alloc(16, 2), 600000, 32, 'sha512').toString('hex'));
    console.log(`# browser: ${out.ua.match(/Chrome\/[\d.]+/)?.[0]}; Argon2id 64 MiB x3 ${out.argonMs} ms (JavaScript), PBKDF2-SHA512 600000 ${out.pbkdf2Ms} ms`);
    // WebAuthn PRF: a virtual passkey returns a deterministic 32-byte secret for a given input
    await send('WebAuthn.enable', {});
    await send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
    const input = toHex(await prfInput('vault-1'));
    const prf = await evaluate(`(async () => {
      const hex = (x) => [...new Uint8Array(x)].map((c) => c.toString(16).padStart(2, '0')).join('');
      const salt = Uint8Array.from(${JSON.stringify(input)}.match(/../g), (h) => parseInt(h, 16));
      const cred = await navigator.credentials.create({ publicKey: { rp: { name: 'test' }, user: { id: new Uint8Array(8), name: 'u', displayName: 'u' }, challenge: new Uint8Array(32), pubKeyCredParams: [{ type: 'public-key', alg: -7 }], authenticatorSelection: { residentKey: 'required', userVerification: 'required' }, extensions: { prf: {} } } });
      const get = async (s) => (await navigator.credentials.get({ publicKey: { challenge: new Uint8Array(32), allowCredentials: [{ type: 'public-key', id: cred.rawId }], userVerification: 'required', extensions: { prf: { eval: { first: s } } } } })).getClientExtensionResults().prf?.results?.first;
      const a = await get(salt), b = await get(salt), c = await get(new Uint8Array(32));
      return { enabled: cred.getClientExtensionResults().prf?.enabled, a: hex(a), b: hex(b), c: hex(c) };
    })()`);
    assert.equal(prf.enabled, true);
    assert.equal(prf.a.length, 64); assert.equal(prf.a, prf.b, 'same input, same secret'); assert.notEqual(prf.a, prf.c, 'another input, another secret');
    const passkey = await factorFromPrf(Uint8Array.from(prf.a.match(/../g), (h) => parseInt(h, 16)));
    const { vault, secret } = await createVault([{ name: 'passkey', key: passkey }, { name: 'seed', key: new Uint8Array(32).fill(4) }], { mode: 'strict' });
    assert.equal(toHex((await openVault(vault, { passkey: { key: passkey }, seed: { key: new Uint8Array(32).fill(4) } })).secret), toHex(secret));
  } finally {
    ws?.close(); proc.kill(); server.close();
    await new Promise((r) => setTimeout(r, 300)); // Chrome still writes to its profile for a moment after SIGTERM
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

const firefox = [join(process.env.HOME ?? '', '.cache/ms-playwright'), process.env.FIREFOX_DIR].filter(Boolean).flatMap((d) => { try { return readdirSync(d).filter((x) => x.startsWith('firefox')).map((x) => join(d, x, 'firefox/firefox')); } catch { return []; } }).find((f) => { try { return readFileSync(f).length > 0; } catch { return false; } }) ?? process.env.FIREFOX_PATH;
test('browser: Firefox gives the same results from the same modules', { skip: !firefox ? 'no Firefox (set FIREFOX_PATH)' : false, timeout: 120000 }, async () => {
  let report;
  const server = createServer((q, r) => {
    if (q.method === 'POST') { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => { r.end('ok'); report = JSON.parse(b); }); return; }
    try { const f = join(root, new URL(q.url, 'http://x').pathname); if (!f.startsWith(root)) throw new Error('outside'); const b = readFileSync(f); r.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream' }); r.end(b); } catch { r.writeHead(404); r.end(); }
  }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const profile = mkdtempSync(join(tmpdir(), 'tgkeys-ff-'));
  const proc = spawn(firefox, ['--headless', '--profile', profile, `http://localhost:${server.address().port}/test/fixtures/keys-browser.html?report`], { stdio: 'ignore', env: { ...process.env, MOZ_HEADLESS: '1' } });
  try {
    for (let i = 0; i < 600 && !report; i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(report, 'Firefox did not report');
    assert.equal(report.error, undefined, report.error);
    assert.deepEqual(report.bip39, vectors.bip39.map((x) => x.seed));
    assert.equal(report.masterText, vectors.master.text);
    assert.deepEqual(report.recordKeys, vectors.recordKeys.map((x) => x.key));
    assert.equal(report.recipientPublic, vectors.recipient.public0);
    assert.equal(report.tgx2, vectors.tgx2.keyText);
    assert.equal(report.opened, vectors.sealedWithSecret.plain);
    assert.equal(report.openedTo, vectors.sealTo[0].plain);
    assert.equal(report.shamir, vectors.secretHex);
    assert.deepEqual(report.mixed, vectors.mixed.map((x) => x.key));
    assert.equal(report.vault, vectors.vault.secret);
    assert.equal(report.x25519, true);
    console.log(`# firefox: ${report.ua.match(/Firefox\/[\d.]+/)?.[0]}; Argon2id 64 MiB x3 ${report.argonMs} ms (JavaScript), PBKDF2-SHA512 600000 ${report.pbkdf2Ms} ms`);
  } finally { proc.kill(); server.close(); rmSync(profile, { recursive: true, force: true }); }
});
