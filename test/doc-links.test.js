// Every relative link in the repo's Markdown must point at a file that exists — a broken docs link ships to GitHub and
// the website. (External links, mailto:, data: and bare anchors are not checked.) This caught two README.md links from
// the handoff/MCP docs that resolved to a non-existent docs/README.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.git', '_site', '.cache', 'dist']);

function markdownFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith('.')) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) markdownFiles(p, out);
    else if (/\.md$/.test(name)) out.push(p);
  }
  return out;
}

test('every relative link in the Markdown docs points at a file that exists', () => {
  const broken = [];
  for (const md of markdownFiles(ROOT)) {
    const rel = md.slice(ROOT.length + 1);
    for (const m of readFileSync(md, 'utf8').matchAll(/\]\(([^)]+)\)/g)) {
      const href = m[1].split(/\s/)[0].replace(/[#?].*$/, '');
      if (!href || /^(https?:|mailto:|data:|tel:|#)/.test(href)) continue;
      if (!existsSync(resolve(dirname(md), href))) broken.push(`${rel} -> ${href}`);
    }
  }
  assert.deepEqual(broken, [], `broken Markdown links:\n  ${broken.join('\n  ')}`);
});
