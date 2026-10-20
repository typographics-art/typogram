#!/usr/bin/env node
// Relink the print masters into _prints/prints/ (with a noindex + long-cache _headers) and deploy the
// separate `typographics-prints` worker, which serves them at https://typographics-art.org/prints/<id>.png
// for Gelato to fetch. It deploys independently of the main site, so a site deploy never removes the masters.
//
//   node scripts/build-prints.mjs && node scripts/deploy-prints.mjs
//
// The masters are noindex (not surfaced in search) but publicly fetchable, which Gelato needs to pull the
// print file. Wrangler auth is the operator's OAuth login (CLOUDFLARE_API_TOKEN is unset so OAuth is used).
import { readdirSync, mkdirSync, rmSync, linkSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'prints'), STAGE = join(ROOT, '_prints', 'prints');
const pngs = existsSync(SRC) ? readdirSync(SRC).filter((f) => f.endsWith('.png')) : [];
if (!pngs.length) { console.error('no masters in prints/ — run scripts/build-prints.mjs first'); process.exit(1); }
rmSync(join(ROOT, '_prints'), { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
for (const f of pngs) linkSync(join(SRC, f), join(STAGE, f));
writeFileSync(join(ROOT, '_prints', '_headers'), '/prints/*\n  X-Robots-Tag: noindex\n  Cache-Control: public, max-age=31536000, immutable\n');
console.log(`staged ${pngs.length} masters -> _prints/prints/`);
const r = spawnSync('env', ['-u', 'CLOUDFLARE_API_TOKEN', 'npx', '--yes', 'wrangler@4', 'deploy', '--config', 'wrangler-prints.jsonc'], { cwd: ROOT, stdio: 'inherit' });
process.exit(r.status || 0);
