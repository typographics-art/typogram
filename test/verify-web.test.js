// The browser verifier (src/verify-web.js) as a regression guard: the same three states the /v page shows, on committed
// artifacts. Uses Web Crypto (crypto.subtle), exactly as the page does; the issuer key file is injected, so no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyTypogram } from '../src/verify-web.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const keyfile = JSON.parse(read('keys/typographics-art.org.json'));
const fetchKeyfile = async () => keyfile;

test('VERIFIED: the signed about artifact checks out against the published key', async () => {
  const r = await verifyTypogram(read('about/typographics-art.svg'), { fetchKeyfile });
  assert.equal(r.state, 'VERIFIED', r.reason || '');
  assert.equal(r.issuer, 'typographics-art.org');
  assert.match(r.hash, /^[0-9a-f]{64}$/);
});

test('UNSIGNED: a consistent but unsigned example is UNSIGNED, not TAMPERED', async () => {
  const p = 'examples/ch-bundesverfassung/onepage.svg';
  if (!existsSync(join(ROOT, p))) return; // regenerated artifact; skip if not built
  const r = await verifyTypogram(read(p), { fetchKeyfile });
  assert.equal(r.state, 'UNSIGNED', r.reason || '');
});

test('TAMPERED: altering the stored hash is detected', async () => {
  const svg = read('about/typographics-art.svg').replace(/"hash":"[0-9a-f]{64}"/, `"hash":"${'0'.repeat(64)}"`);
  const r = await verifyTypogram(svg, { fetchKeyfile });
  assert.equal(r.state, 'TAMPERED', r.reason || '');
});

test('TAMPERED: a signed work whose key cannot be fetched does not pass', async () => {
  const r = await verifyTypogram(read('about/typographics-art.svg'), { fetchKeyfile: async () => { throw new Error('offline'); } });
  assert.notEqual(r.state, 'VERIFIED');
});

test('NO_DATA: plain markup with no data layer is not a Typogram', async () => {
  const r = await verifyTypogram('<svg xmlns="http://www.w3.org/2000/svg"><text>hello</text></svg>', { fetchKeyfile });
  assert.equal(r.state, 'NO_DATA');
});
