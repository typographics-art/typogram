// Data in the browser, end to end: runs scripts/check-web-data.mjs, which drives a real headless Chrome through the generator's
// "Data in this work" panel and the work page (attach, preview, write into the work, seal, save, open, break), under the site's real
// Content-Security-Policy. Skipped, with the reason, where there is no Chrome/Chromium (set CHROME_PATH) or Node lacks WebSocket (< 22).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome } from '../cli/core.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'check-web-data.mjs');

test('web data: generator panel and work page work end to end in headless Chrome', { timeout: 600000 }, (t) => {
  if (process.env.TG_SKIP_BROWSER) return t.skip('browser checks skipped in CI (run locally)');
  if (!findChrome()) return t.skip('Chrome/Chromium not found (set CHROME_PATH): the browser checks need it');
  if (typeof WebSocket === 'undefined') return t.skip('Node.js 22 or newer is needed for the DevTools connection (global WebSocket)');
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', timeout: 540000, maxBuffer: 1 << 26 });
  const out = `${r.stdout}\n${r.stderr}`;
  assert.equal(r.status, 0, `check-web-data failed (exit ${r.status}):\n${out.split('\n').filter((l) => !l.startsWith('ok')).join('\n')}`);
  assert.match(r.stdout, /\n(\d+) checks, 0 failed/);
  assert.ok(Number(/(\d+) checks/.exec(r.stdout)[1]) >= 100, 'the full set of checks ran');
});
