#!/usr/bin/env node
// Structural pre-sign gate. A signature proves a Typogram carries its EMBEDDED source faithfully — it does NOT prove the
// embedded source matches the OFFICIAL authoritative version. A converter error (a dropped article, a missing annex, a
// silent numbering hole) would otherwise be certified as authentic. This checks each law's source against a committed,
// official-derived skeleton (examples/<id>/official-structure.json): heading counts, contiguous/complete numbering (with
// declared repealed gaps), exact letter-suffix sets, verbatim first/last anchors, and completeness for composite
// instruments (annexes). It exits non-zero on ANY divergence, so the signing step refuses to sign a diverging source.
//
//   node scripts/check-against-official.mjs [<id> …]   # every example with a reference, or the named ones
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EX = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');

const captures = (text, pattern) => {
  const re = new RegExp(pattern, 'gm'); const out = []; let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
};

function runCheck(text, c) {
  switch (c.type) {
    case 'count': {
      const n = (text.match(new RegExp(c.pattern, 'gm')) || []).length;
      return { ok: n === c.expect, msg: `${c.label}: found ${n}, expect ${c.expect}` };
    }
    case 'numberedComplete': {
      const got = new Set(captures(text, c.pattern).map(Number));
      const except = new Set(c.except || []);
      const missing = [];
      for (let i = c.range[0]; i <= c.range[1]; i++) if (!got.has(i) && !except.has(i)) missing.push(i);
      return { ok: missing.length === 0, msg: `${c.label}: ${missing.length ? 'MISSING ' + missing.join(',') : 'complete ' + c.range[0] + '..' + c.range[1] + (c.except ? ' (except ' + c.except.join(',') + ')' : '')}` };
    }
    case 'exactSet': {
      const got = new Set(captures(text, c.pattern));
      const want = new Set(c.members);
      const missing = [...want].filter((x) => !got.has(x));
      const extra = [...got].filter((x) => !want.has(x));
      const ok = !missing.length && !extra.length;
      return { ok, msg: `${c.label}: ${ok ? 'exact (' + want.size + ')' : (missing.length ? 'MISSING ' + missing.join(',') + ' ' : '') + (extra.length ? 'EXTRA ' + extra.join(',') : '')}` };
    }
    case 'anchor':
      return { ok: text.includes(c.text), msg: `${c.label}: ${text.includes(c.text) ? 'present' : 'MISSING anchor ' + JSON.stringify(c.text.slice(0, 48))}` };
    case 'requireOrDeclare': {
      // Composite-instrument completeness: the headings must be present, OR the source must carry an explicit scope note,
      // so a signature over an article-only body never reads as certifying the whole instrument.
      const have = (text.match(new RegExp(c.pattern, 'gm')) || []).length;
      const declared = !!(c.declare && text.includes(c.declare));
      return { ok: have >= c.min || declared, msg: `${c.label}: found ${have} (need ≥${c.min}), scope-note declared: ${declared}` };
    }
    default:
      return { ok: false, msg: `unknown check type ${c.type}` };
  }
}

export function checkLaw(id) {
  const refPath = join(EX, id, 'official-structure.json');
  if (!existsSync(refPath)) return null;
  const ref = JSON.parse(readFileSync(refPath, 'utf8'));
  const text = readFileSync(join(EX, id, 'source.txt'), 'utf8');
  const results = ref.checks.map((c) => runCheck(text, c));
  return { id, ok: results.every((r) => r.ok), results, ref };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ids = process.argv.slice(2).length ? process.argv.slice(2)
    : readdirSync(EX).filter((id) => existsSync(join(EX, id, 'official-structure.json'))).sort();
  let failed = 0;
  for (const id of ids) {
    const r = checkLaw(id);
    if (!r) { console.error(`  (no official-structure.json for ${id})`); continue; }
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${id}  — official: ${r.ref.official}`);
    for (const res of r.results) console.log(`    ${res.ok ? '✓' : '✗'} ${res.msg}`);
    if (!r.ok) failed++;
  }
  console.log(`\n${ids.length - failed}/${ids.length} law sources match their official skeleton`);
  process.exit(failed ? 1 : 0);
}
