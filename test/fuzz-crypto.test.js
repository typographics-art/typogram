// A small, deterministic subset of scripts/fuzz-crypto.mjs inside the normal test run: the same fuzzer, a fixed seed, a few
// thousand cases over every decoder and parser that sees untrusted input (keys of every prefix, sealed records, shares, vaults,
// mnemonics, csv/tsv/json/yaml/xml/md/ics/vcf/kv/xlsx files, TGD blocks, the page summaries of a decoded block), plus a sample of
// the hostile run shapes (long runs of one token behind every lead-in, which finds quadratic regular expressions).
// The only acceptable outcome of a case is a correct result or a clean, named error inside the time bound.
// The long run (minutes, any seed):  node scripts/fuzz-crypto.mjs --seed <n> --iterations 150000   and   node scripts/fuzz-crypto.mjs --hostile
import test from 'node:test';
import assert from 'node:assert/strict';
import { runFuzz, runHostile, makeRng, mutateBytes } from '../scripts/fuzz-crypto.mjs';

test('fuzz: 6 000 deterministic cases over all parsers end in a result or a named error, quickly (seed 20261018)', async () => {
  const r = await runFuzz({ seed: 20261018, iterations: 6000, maxMs: 2500 });
  assert.deepEqual(r.findings, []);
  assert.equal(r.iterations, 6000);
  for (const t of ['keys', 'records', 'structured', 'models', 'tgd', 'xlsx']) assert.ok(r.byTarget[t] > 0, `target ${t} was not exercised`);
});
test('fuzz: 150 hostile run shapes (a lead-in, a run of 30 000 characters of one token, a tail) are parsed in near-linear time (seed 7)', async () => {
  const r = await runHostile({ n: 30000, maxMs: 500, sample: 150, seed: 7 });
  assert.deepEqual(r.findings, []);
  assert.ok(r.iterations >= 150);
});
test('fuzz: the generator is deterministic (same seed, same mutations)', () => {
  const a = makeRng('s'), b = makeRng('s');
  const base = Uint8Array.from({ length: 64 }, (_, i) => i);
  for (let i = 0; i < 50; i++) assert.deepEqual(mutateBytes(a, base), mutateBytes(b, base));
});
