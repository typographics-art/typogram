// The passkey device check page, driven in headless Chromium with a virtual authenticator that supports the WebAuthn PRF
// extension: creating a test passkey, the three PRF requests and the vault test must all come out as the page promises.
// It also checks that the page stores nothing and reaches nothing outside its own origin. Skipped without Chromium.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, extname, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const chrome = [process.env.CHROME_PATH, 'chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome'].filter(Boolean).find((c) => spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0);
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

test('passkey check page: a virtual passkey with PRF passes every step, nothing is stored, nothing leaves the origin', { skip: !chrome || typeof WebSocket === 'undefined' ? 'no Chromium or no WebSocket' : false, timeout: 120000 }, async () => {
  const server = createServer((q, r) => {
    try { const f = join(root, new URL(q.url, 'http://x').pathname); if (!f.startsWith(root)) throw new Error('outside'); const b = readFileSync(f); r.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream' }); r.end(b); } catch { r.writeHead(404); r.end(); }
  }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const profile = mkdtempSync(join(tmpdir(), 'tgpk-chrome-'));
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
    let id = 0; const pend = new Map(); const events = [];
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id) pend.get(m.id)?.(m); else events.push(m); };
    const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result))); ws.send(JSON.stringify({ id: i, method, params })); });
    const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    for (const d of ['Page', 'Runtime', 'Network', 'WebAuthn']) await send(`${d}.enable`);
    await send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
    await send('Page.navigate', { url: `http://localhost:${server.address().port}/passkey-check.html` });
    // documentElement is null for a moment while the browser swaps about:blank for the page, so the probe tolerates it (it raced once under the full suite)
    for (let i = 0; i < 300 && !(await evaluate('document.documentElement?.dataset.ready === "1"')); i++) await new Promise((r) => setTimeout(r, 100));
    const wait = async (cond, what) => { for (let i = 0; i < 300; i++) { if (await evaluate(cond)) return; await new Promise((r) => setTimeout(r, 100)); } throw new Error(`timeout waiting for ${what}`); };

    await evaluate("document.querySelector('[data-lang=en]').click()"); // the browser's own language must not decide the test
    assert.equal(await evaluate("document.querySelector('#make').disabled"), false, 'the buttons are enabled on a secure page');
    await evaluate("document.querySelector('#make').click()");
    await wait("document.querySelector('#credId').value.length > 10", 'a credential id');
    assert.match(await evaluate("document.querySelector('#makeMsg').textContent"), /Test passkey created/);
    await evaluate("document.querySelector('#test').click()");
    await wait("document.querySelector('#testMsg').className.includes('good') || document.querySelector('#testMsg').className.includes('bad')", 'the test result');
    const res = await evaluate('JSON.parse(JSON.stringify(window.tgPasskeyCheck.state.res))');
    assert.equal(res.prfGet, true); assert.equal(res.len, 32);
    assert.equal(res.stable, true, 'the same input gives the same secret'); assert.equal(res.differ, true, 'another input gives another secret');
    assert.equal(res.vaultOpen, true, 'the vault opens with the passkey and a second factor');
    assert.equal(res.vaultLock, true, 'the vault stays closed with the passkey alone');
    assert.match(res.fp, /^[0-9a-f]{8}$/); assert.notEqual(res.fp, res.fp2);
    assert.match(await evaluate("document.querySelector('#testMsg').textContent"), /works as a key factor/);

    // the copy block holds facts and no secret: no 64-hex-character value, no credential id
    const block = await evaluate("document.querySelector('#block').value");
    const credId = await evaluate("document.querySelector('#credId').value");
    assert.doesNotMatch(block, /[0-9a-f]{40}/i, 'no long hex value in the result block');
    assert.ok(!block.includes(credId), 'the credential id is not in the result block');
    assert.equal(JSON.parse(block).tool, 'passkey-check/1');

    // reusing a credential id (as after a reload) gives the same fingerprint
    const before = res.fp;
    await evaluate("document.querySelector('#test').click()");
    await new Promise((r) => setTimeout(r, 1500));
    await wait("document.querySelector('#testMsg').className.includes('good')", 'the second run');
    assert.equal(await evaluate('window.tgPasskeyCheck.state.res.fp'), before, 'a second run gives the same fingerprint');

    // German
    await evaluate("document.querySelector('[data-lang=de]').click()");
    assert.match(await evaluate("document.querySelector('h1').textContent"), /Passkey-Geräteprüfung/);
    assert.match(await evaluate("document.querySelector('[data-i18n=lead]').textContent"), /Versiegelte Daten/);

    // nothing stored, nothing left the origin
    assert.deepEqual(await evaluate('({ local: localStorage.length, session: sessionStorage.length })'), { local: 1, session: 0 }, 'only the language choice may be stored');
    const external = events.filter((e) => e.method === 'Network.requestWillBeSent').map((e) => e.params.request.url).filter((u) => !u.startsWith('http://localhost:') && !u.startsWith('data:') && !u.startsWith('about:'));
    assert.deepEqual(external, [], 'no request left the origin');
  } finally {
    ws?.close(); proc.kill(); server.close();
    await new Promise((r) => setTimeout(r, 300)); // Chrome still writes to its profile for a moment after SIGTERM
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
