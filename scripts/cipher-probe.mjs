// What the cipher review measures here: node scripts/cipher-probe.mjs  (docs/cipher-review.md section 8)
// Node: primitives, AES-256-GCM speed, KDF costs. Browsers: Chromium, Firefox and WebKit from the Playwright cache when they exist,
// each loads scripts/probe.html from a local server (a secure context: localhost) and reports which Web Crypto algorithms it has.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir, cpus } from 'node:os';
import { join } from 'node:path';
import { argon2Sync, pbkdf2Sync, scryptSync } from 'node:crypto';

const s = crypto.subtle, ms = (f) => { const t = performance.now(); const r = f(); return [r, performance.now() - t]; };
const probe = async (n, f) => { try { await f(); return 'yes'; } catch { return 'no'; } };
const node = {
  version: process.version,
  X25519: await probe('x', () => s.generateKey('X25519', true, ['deriveBits'])),
  'AES-GCM-SIV': await probe('x', () => s.generateKey({ name: 'AES-GCM-SIV', length: 256 }, true, ['encrypt'])),
  'AES-OCB': await probe('x', () => s.generateKey({ name: 'AES-OCB', length: 256 }, true, ['encrypt'])),
  'ChaCha20-Poly1305': await probe('x', () => s.generateKey({ name: 'ChaCha20-Poly1305' }, true, ['encrypt'])),
  Argon2id: await probe('x', () => s.importKey('raw-secret', new Uint8Array(4), 'Argon2id', false, ['deriveBits'])),
  'ML-KEM-768': await probe('x', () => s.generateKey('ML-KEM-768', true, ['encapsulateBits', 'decapsulateBits'])),
};
const key = await s.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt']);
const data = new Uint8Array(16 * 1024 * 1024); const iv = new Uint8Array(12);
const t0 = performance.now(); for (let i = 0; i < 8; i++) await s.encrypt({ name: 'AES-GCM', iv }, key, data);
node.aesGcmMBps = Math.round((8 * 16) / ((performance.now() - t0) / 1000));
const cc = await s.generateKey({ name: 'ChaCha20-Poly1305' }, false, ['encrypt']).catch(() => null);
if (cc) { const t1 = performance.now(); for (let i = 0; i < 8; i++) await s.encrypt({ name: 'ChaCha20-Poly1305', iv }, cc, data); node.chachaMBps = Math.round((8 * 16) / ((performance.now() - t1) / 1000)); }
const salt = Buffer.alloc(16, 1);
node.kdf = {
  'PBKDF2-SHA256 600000 (ms/guess, 1 core)': Math.round(ms(() => pbkdf2Sync('pw', salt, 600000, 32, 'sha256'))[1]),
  'PBKDF2-SHA512 600000': Math.round(ms(() => pbkdf2Sync('pw', salt, 600000, 32, 'sha512'))[1]),
  'scrypt N=2^17 r=8 p=1 (128 MiB)': Math.round(ms(() => scryptSync('pw', salt, 32, { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }))[1]),
  'Argon2id 64 MiB t=3 p=1 (native)': Math.round(ms(() => argon2Sync('argon2id', { message: Buffer.from('pw'), nonce: salt, parallelism: 1, tagLength: 32, memory: 65536, passes: 3 }))[1]),
  'Argon2id 19 MiB t=2 p=1 (native, OWASP minimum)': Math.round(ms(() => argon2Sync('argon2id', { message: Buffer.from('pw'), nonce: salt, parallelism: 1, tagLength: 32, memory: 19456, passes: 2 }))[1]),
};
node.cores = cpus().length;
console.log('NODE', JSON.stringify(node, null, 1));

// browsers
const reports = {};
const server = createServer((q, r) => {
  if (q.method === 'POST') { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => { r.end('ok'); try { reports[q.headers['x-name'] ?? currentName] = JSON.parse(b); } catch { /* ignore */ } }); return; }
  r.writeHead(200, { 'content-type': 'text/html' }); r.end(readFileSync(new URL('./probe.html', import.meta.url)));
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
let currentName = '';
const cache = join(process.env.HOME, '.cache/ms-playwright');
const finds = (prefix, sub) => existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith(prefix)).map((d) => join(cache, d, sub)).find(existsSync) : null;
const url = `http://localhost:${server.address().port}/`;
const runs = [
  ['chromium', '/usr/bin/chromium', (p) => ['--headless=new', `--user-data-dir=${p}`, '--no-first-run', url]],
  ['firefox', finds('firefox-', 'firefox/firefox'), (p) => ['--headless', '--profile', p, url]],
  ['webkit', finds('webkit-', 'pw_run.sh'), () => ['--headless', url]],
];
for (const [name, bin, args] of runs) {
  if (!bin || !existsSync(bin)) { reports[name] = 'not installed here'; continue; }
  currentName = name;
  const profile = mkdtempSync(join(tmpdir(), 'tgprobe-'));
  const proc = spawn(bin, args(profile), { stdio: 'ignore', env: { ...process.env, MOZ_HEADLESS: '1' } });
  for (let i = 0; i < 150 && !reports[name]; i++) await new Promise((r) => setTimeout(r, 100));
  proc.kill(); rmSync(profile, { recursive: true, force: true });
  if (!reports[name]) reports[name] = 'did not report (could not be driven here)';
}
server.close();
console.log('BROWSERS', JSON.stringify(reports, null, 1));
