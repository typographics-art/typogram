#!/usr/bin/env node
// Runs Semgrep with the local rules (scripts/semgrep-js-security.yml, no network) over src, cli, api, scripts and the
// inline <script> blocks of the HTML pages (extracted to a temporary directory first, with their line offsets kept in the file
// names). Prints a summary per rule and the findings; writes the full JSON next to the output directory.
//   node scripts/semgrep-scan.mjs [--out <dir>] [--semgrep <path>]
import { readFileSync, writeFileSync, mkdirSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const a = process.argv.slice(2), opt = (n, d) => { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : d; };
const out = opt('out', mkdtempSync(join(tmpdir(), 'tg-semgrep-'))), semgrep = opt('semgrep', 'semgrep');
mkdirSync(join(out, 'inline'), { recursive: true });

// inline scripts of every HTML page: one file per <script> block without src, named page.line.js
let blocks = 0;
const pages = [];
const walk = (d) => { for (const e of readdirSync(join(root, d), { withFileTypes: true })) { if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === 'vendor') continue; const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.html')) pages.push(p); } };
walk('.');
for (const page of pages) {
  const html = readFileSync(join(root, page), 'utf8');
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/type="(?:application\/(?:ld\+)?json|importmap)"/.test(m[1])) continue;
    const line = html.slice(0, m.index).split('\n').length;
    writeFileSync(join(out, 'inline', `${page.replace(/[\\/]/g, '__')}.L${line}.js`), m[2]);
    blocks++;
  }
}
const targets = ['src', 'cli', 'api', 'scripts', join(out, 'inline')].map((t) => (t.startsWith('/') ? t : join(root, t)));
const r = spawnSync(semgrep, ['scan', '--config', join(root, 'scripts', 'semgrep-js-security.yml'), '--json', '--metrics', 'off', '--disable-version-check', '--quiet', '--exclude', 'vendor', '--exclude', 'keys-wordlist-en.js', ...targets], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, env: { ...process.env, SEMGREP_SEND_METRICS: 'off', EIO_BACKEND: process.env.EIO_BACKEND || 'posix' } });
if (r.status !== 0 && r.status !== 1) { console.error(r.stderr.slice(0, 2000)); process.exit(2); }
const j = JSON.parse(r.stdout);
writeFileSync(join(out, 'semgrep.json'), JSON.stringify(j, null, 1));
const by = {};
for (const f of j.results) (by[f.check_id.split('.').pop()] ||= []).push(f);
console.log(`semgrep ${j.version ?? ''}: ${j.results.length} findings, ${j.errors.length} errors, ${blocks} inline script blocks from ${pages.length} pages; full JSON in ${join(out, 'semgrep.json')}`);
for (const [id, list] of Object.entries(by).sort()) console.log(`${id.padEnd(34)} ${list.length}`);
// the logged-out CLI does not return the matched text (extra.lines says "requires login"): read the line from the file
const lineOf = (f) => { try { return readFileSync(f.path.startsWith('/') ? f.path : join(root, f.path), 'utf8').split('\n')[f.start.line - 1].trim().slice(0, 150); } catch { return ''; } };
if (a.includes('--list')) for (const [id, list] of Object.entries(by).sort()) for (const f of list) console.log(`${id}\t${f.path.replace(root + '/', '').replace(out + '/', '')}:${f.start.line}\t${lineOf(f)}`);
