#!/usr/bin/env node
// Fuzzer of every decoder that sees untrusted input (internal adversarial review 2026-10, docs/security-review-internal-2026-10-b.md).
// Deterministic (xorshift128 from the seed, printed), bounded in time, and strict about outcomes: a decoder may return a
// result or throw a CryptError (crypt modules) / TgdError (structured data); anything else, or a call over the time
// bound, is a finding and is printed with the input that caused it.
//
//   node scripts/fuzz-crypto-b.mjs [--seconds 120] [--seed tg-fuzz-b] [--quick]      (--quick: the deterministic subset the test suite runs)
//
// Strategies: random text per prefix; valid tokens with bit flips, truncations, insertions and swapped characters; bodies
// of random bytes with a CORRECT checksum (so that the parsers behind the checksum are reached); records with a valid
// header and random ciphertext; random bytes and mutated fixtures for every file format.
import { readFileSync, readdirSync } from 'node:fs';
import { seededRandom, CryptError, b58Encode, b64urlEncode, checksum, utf8, concat } from '../src/crypt-codec.js';
import { parseKey, parseRecord, openSealed, findSealedBlocks, describeRecord, sealMessage, LIMITS } from '../src/crypt.js';
import { revealAny, hideCompact } from '../src/crypt-book.js';
import { parseMaster, mnemonicToSeed, seedFromHex, recordKey } from '../src/keys.js';
import { parsePublic, parseSecret, openFrom, sealTextTo, newRecipient, parseSealedTo } from '../src/keys-seal.js';
import { parseKey2, openAny, sealBound2 } from '../src/keys-work.js';
import { parseShare, joinShares, splitShamir, parseHalf, mixedKey, openVault, describeVault, createVault } from '../src/keys-split.js';
import { decodeParams } from '../src/keys-kdf.js';
import { decodeAll, encode, TgdError } from '../src/structured.js';
import { FORMATS } from '../src/structured-formats.js';
import { openZip } from '../src/structured-zip.js';
import { parseJson } from '../src/structured-json.js';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };
const QUICK = args.includes('--quick');
const SEED = opt('seed', 'tg-fuzz-b'), SECONDS = QUICK ? 12 : Number(opt('seconds', 120));
const PER_CALL_MS = 1500, TOTAL_MB = 1024;
const rnd = seededRandom(SEED);
const byte = () => { const b = new Uint8Array(1); rnd(b); return b[0]; };
const int = (n) => Math.floor((byte() * 256 + byte()) / 65536 * n);
const bytes = (n) => { const b = new Uint8Array(n); rnd(b); return b; };
const pick = (a) => a[int(a.length)];
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz', B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const text = (alpha, n) => Array.from({ length: n }, () => alpha[int(alpha.length)]).join('');
const WORK = 'Typographics Art sets a text character for character so that it forms a picture, and the text stays readable text: every word can be selected, searched and copied, as in any book; digits like 2026 and a little punctuation, too.';

// ---- mutations of a valid token ------------------------------------------------------------------------------------------
function mutate(s) {
  const k = int(7), i = int(Math.max(1, s.length));
  if (k === 0) return s.slice(0, i); // truncation
  if (k === 1) return s.slice(0, i) + s.slice(i + 1); // deletion
  if (k === 2) return s.slice(0, i) + pick([...B58, ...B64, ' ', '\n', ' ', '.', '[', ']']) + s.slice(i); // insertion
  if (k === 3) return s.slice(0, i) + pick([...B58, ...B64]) + s.slice(i + 1); // substitution
  if (k === 4) { const j = int(Math.max(1, s.length)); return s.slice(0, Math.min(i, j)) + s[Math.max(i, j)] + s.slice(Math.min(i, j) + 1, Math.max(i, j)) + s[Math.min(i, j)] + s.slice(Math.max(i, j) + 1); } // swap
  if (k === 5) return s + s.slice(int(s.length)); // duplication
  return s.slice(0, i) + text(B58, int(40)) + s.slice(i); // a random run
}
/** A base58 token with a correct checksum over random body bytes (the parser behind the checksum is reached). */
async function forgedB58(prefix, domain, body, check = 2) { return prefix + b58Encode(concat(body, await checksum(domain, body, check))); }

// ---- the decoders, with what counts as a clean refusal -----------------------------------------------------------------
const clean = (e, kinds) => kinds.some((K) => e instanceof K);
const results = { calls: 0, ok: 0, refused: 0, findings: [], slowest: 0, slowestWhat: '' };
let memPeak = 0;
async function run(what, fn, kinds = [CryptError]) {
  const t = performance.now();
  let outcome;
  try { await fn(); outcome = 'ok'; } catch (e) { outcome = clean(e, kinds) ? 'refused' : { finding: `${e?.name}: ${e?.message}`.slice(0, 200), stack: String(e?.stack).split('\n').slice(0, 4).join(' | ') }; }
  const ms = performance.now() - t;
  results.calls++;
  if (ms > results.slowest) { results.slowest = ms; results.slowestWhat = what; }
  if (ms > PER_CALL_MS) results.findings.push({ what, ms: Math.round(ms), reason: 'over the time bound' });
  if (outcome === 'ok') results.ok++; else if (outcome === 'refused') results.refused++; else results.findings.push({ what, ...outcome });
  const mem = process.memoryUsage().rss / 1048576;
  if (mem > memPeak) memPeak = mem;
  if (mem > TOTAL_MB) results.findings.push({ what, reason: `rss ${Math.round(mem)} MB` });
}
const show = (s) => (typeof s === 'string' ? JSON.stringify(s.length > 80 ? s.slice(0, 77) + '...' : s) : `${s.length} bytes`);

async function main() {
  const t0 = Date.now(), deadline = t0 + SECONDS * 1000;
  console.log(`fuzz-crypto-b: seed ${JSON.stringify(SEED)}, ${SECONDS} s, per-call bound ${PER_CALL_MS} ms, node ${process.version}`);
  // valid tokens to mutate
  const sealed = await sealMessage(WORK, 'a message to seal, 2026', { random: rnd });
  const sealed2 = await sealBound2(WORK, { kind: 'text', payload: utf8('tgx2 message') }, { random: rnd });
  const inline = await sealMessage(WORK, 'inline', { inline: true, random: rnd });
  const pw = await sealMessage(null, 'pw', { bind: false, password: 'correct horse', iterations: 100000, random: rnd });
  const book2 = await hideCompact(WORK, 'hidden', { random: rnd });
  const recipient = await newRecipient(rnd);
  const toRec = (await sealTextTo(recipient.public, 'for you', { random: rnd, context: 'ctx' })).record;
  const master = await recordKey(new Uint8Array(32).fill(5), 'fuzz'); // any 32 bytes serve as a master here
  const { formatMaster } = await import('../src/keys.js');
  const masterText = await formatMaster(master);
  const shares = await splitShamir(bytes(32), 2, 3, { random: rnd });
  const { newMixed } = await import('../src/keys-split.js');
  const half = (await newMixed('pw', { params: { kdf: 'pbkdf2-sha512', iterations: 100000 }, random: rnd })).half;
  const vault = (await createVault([{ name: 'a', key: bytes(32) }, { name: 'b', key: bytes(32) }, { name: 'p', passphrase: 'x y', params: { kdf: 'pbkdf2-sha512', iterations: 100000 } }], { mode: 'strict', random: rnd })).vault;
  const vault2 = (await createVault([{ name: 'seed', master }, { name: 'a', key: bytes(32) }, { name: 'p', passphrase: 'x y', params: { kdf: 'pbkdf2-sha512', iterations: 100000 } }], { random: rnd })).vault;
  const valid = { 'tgx1.': sealed.key, 'tgx2.': sealed2.key, 'tgs1.': sealed.record, 'tg2.': book2, 'tgr1.': toRec, 'tgp1.': recipient.public, 'tgq1.': recipient.secret, 'tgmk1.': masterText, 'tgsh1.': shares[0], 'tgxm1.': half, 'tgv1.': vault, 'tgv2.': vault2, 'inline': inline.key, 'pw': pw.record };
  const fixtures = readdirSync(new URL('../test/fixtures/', import.meta.url).pathname).filter((f) => /\.(csv|tsv|json|xlsx|md|yaml|xml|ics|vcf|env)$/.test(f))
    .map((f) => ({ name: f, bytes: new Uint8Array(readFileSync(new URL('../test/fixtures/' + f, import.meta.url))) }));
  const vectors = JSON.parse(readFileSync(new URL('../test/fixtures/conformance/crypt-vectors.json', import.meta.url), 'utf8'));
  const tgdBlock = (await encode({ bytes: fixtures.find((f) => f.name === 'people.csv').bytes, name: 'people.csv' }, { created: false })).text;

  const strategies = [
    // random text per prefix
    async () => { const p = pick(Object.keys(valid)); const s = (p.endsWith('.') ? p : '') + text(pick([B58, B64, B58 + ' \n', 'abc']), int(QUICK ? 300 : 3000)); await parseAny(s); },
    // mutated valid tokens
    async () => { const p = pick(Object.keys(valid)); let s = valid[p]; for (let i = 0, n = 1 + int(4); i < n; i++) s = mutate(s); await parseAny(s); },
    // forged bodies with a correct checksum, per base58 format
    async () => {
      const kind = pick(['tgx1', 'tgx2', 'tgmk1', 'tgp1', 'tgq1', 'tgsh1', 'tgxm1', 'tg2']);
      const n = int(QUICK ? 120 : 600);
      const body = bytes(n);
      if (int(3) === 0) body[0] = { tgx1: 1, tgx2: 2, tgmk1: 1, tgp1: 1, tgq1: 1, tgsh1: 1, tgxm1: 1, tg2: int(128) }[kind]; // a plausible version byte
      if (kind === 'tgsh1' && int(2)) { body[1] = 1 + int(2); body[6] = 2 + int(3); body[7] = body[6] + int(3); body[8] = 1 + int(body[7]); }
      if (kind === 'tgxm1' && int(2)) { body[1] = 1 + int(2); }
      const tok = await forgedB58(kind + '.', kind, body, kind === 'tgsh1' ? 4 : 2);
      await parseAny(tok);
    },
    // forged vaults: base64url body with a correct 4-byte checksum, plausible header
    async () => {
      const n = 7 + int(QUICK ? 200 : 600); const body = bytes(n); const v2 = int(2); body[0] = 1 + v2; body[1] = v2 ? int(2) : 2 + int(2); body[2] = body[1] + int(4);
      const pre = v2 ? 'tgv2' : 'tgv1', tok = pre + '.' + b64urlEncode(concat(body, await checksum(pre, body, 4)));
      await run('vault ' + show(tok), () => openVault(tok, { a: { key: bytes(32) }, b: { key: bytes(32) }, p: { passphrase: 'x y' } }));
      await run('describeVault ' + show(tok), () => describeVault(tok));
    },
    // records with a valid header and random ciphertext, opened with the right key, the wrong key and a password
    async () => {
      const flags = int(16), kdf = flags & 4 ? concat(bytes(16), Uint8Array.of(0xa0, 0x8d, 0x06)) : new Uint8Array(0); // 100 000 iterations
      const body = concat(Uint8Array.of(1, flags), kdf, bytes(12 + 16 + int(QUICK ? 64 : 400)));
      const rec = 'tgs1.' + b64urlEncode(body);
      await run('record ' + show(rec), () => openSealed(WORK, { key: sealed.key, record: rec }));
      await run('record+pw ' + show(rec), () => openSealed(null, { password: 'x', record: rec }));
      await run('describeRecord ' + show(rec), () => describeRecord(rec));
      await run('openAny tgx2 ' + show(rec), () => openAny(WORK, { key: sealed2.key, record: rec }));
      const r1 = 'tgr1.' + b64urlEncode(concat(Uint8Array.of(1, int(2)), bytes(32 + 12 + 16 + int(200))));
      await run('tgr1 ' + show(r1), () => openFrom(recipient.secret, r1, { context: 'ctx' }));
    },
    // the authenticated inner structure: a valid record whose plaintext was crafted (sealer bugs must never crash the reader)
    async () => {
      const { sealItem } = await import('../src/crypt.js');
      const payload = bytes(int(40));
      const kind = pick(['tgd', 'text', 'bytes']);
      await run('inner ' + kind, async () => { const s = await sealItem(WORK, { kind, payload }, { compress: int(2) === 0, pad: pick([0, 0, 16, 1024]), random: rnd }); await openSealed(WORK, { key: s.key, record: s.record }); });
    },
    // shares: mixtures, duplicates, k-1, forged with a correct checksum
    async () => {
      const set = [...shares]; const m = int(4);
      const list = m === 0 ? [set[0]] : m === 1 ? [set[0], set[0]] : m === 2 ? [mutate(set[0]), set[1]] : [set[int(3)], await forgedB58('tgsh1.', 'tgsh1', concat(Uint8Array.of(1, 2), bytes(4), Uint8Array.of(2, 3, 1 + int(3)), bytes(32)), 4)];
      await run('join ' + list.map(show).join(','), () => joinShares(list));
    },
    // mnemonics and hex seeds
    async () => { const s = pick([text('abcdefghijklmnopqrstuvwxyz \n', int(200)), 'abandon '.repeat(int(30)) + 'about', text('0123456789abcdefg', int(140))]); await run('mnemonic ' + show(s), () => mnemonicToSeed(s)); await run('seedHex ' + show(s), () => seedFromHex(s)); },
    // sealed blocks inside a text
    async () => { const t = text('TGS1[]tgs1.' + B64 + ' \n', int(QUICK ? 400 : 4000)); await run('findSealedBlocks ' + show(t), () => findSealedBlocks(t)); },
    // kdf parameter descriptors
    async () => { const b = bytes(1 + int(12)); if (int(2)) b[0] = 1 + int(2); await run('decodeParams ' + show(b), () => decodeParams(b, 0)); },
    // file formats: random bytes, mutated fixtures, mutated TGD blocks, zip bombs and odd zips
    async () => {
      const f = pick(fixtures);
      const b = Uint8Array.from(f.bytes);
      const kind = int(4);
      if (kind === 0) for (let i = 0, n = 1 + int(20); i < n; i++) b[int(b.length)] = byte();
      const data = kind === 1 ? bytes(int(QUICK ? 300 : 3000)) : kind === 2 ? b.subarray(0, int(b.length)) : b;
      const fmt = pick(Object.keys(FORMATS));
      await run(`read ${fmt} <- ${f.name}/${kind}`, () => FORMATS[fmt].read(data, { name: f.name }), [TgdError]);
    },
    async () => { let s = tgdBlock; for (let i = 0, n = 1 + int(4); i < n; i++) s = mutate(s); await run('decodeAll ' + show(s), () => decodeAll(s), [TgdError]); },
    async () => { const s = text('{}[]":,0123456789.-eE+tfnrulaseb \\\n', int(QUICK ? 300 : 3000)); await run('json ' + show(s), () => parseJson(s), [TgdError]); },
    async () => {
      // a zip with random directory fields (sizes, offsets, counts) around real deflate data
      const z = Uint8Array.from(fixtures.find((f) => f.name === 'basic.xlsx').bytes);
      for (let i = 0, n = 1 + int(12); i < n; i++) z[int(z.length)] = byte();
      await run('zip mutated', () => { const a = openZip(z); return Promise.all(a.names.map((n) => a.read(n))); }, [TgdError]);
      await run('xlsx mutated', () => FORMATS.xlsx.read(z, {}), [TgdError]);
    },
  ];
  const parseAny = async (s) => {
    await run('parseKey ' + show(s), () => parseKey(s));
    await run('parseRecord ' + show(s), () => parseRecord(s));
    await run('openSealed ' + show(s), () => openSealed(WORK, { key: s, record: sealed.record }));
    await run('openSealed(record) ' + show(s), () => openSealed(WORK, { key: sealed.key, record: s }));
    await run('openAny ' + show(s), () => openAny(WORK, { key: s, record: sealed.record }));
    await run('parseKey2 ' + show(s), () => parseKey2(s));
    await run('revealAny ' + show(s), () => revealAny(WORK, s));
    await run('parseMaster ' + show(s), () => parseMaster(s));
    await run('parsePublic ' + show(s), () => parsePublic(s));
    await run('parseSecret ' + show(s), () => parseSecret(s));
    await run('openFrom ' + show(s), () => openFrom(recipient.secret, s));
    await run('parseSealedTo ' + show(s), () => parseSealedTo(s));
    await run('parseShare ' + show(s), () => parseShare(s));
    await run('parseHalf ' + show(s), () => parseHalf(s));
    await run('mixedKey ' + show(s), () => mixedKey(s, 'pw'));
    await run('describeVault ' + show(s), () => describeVault(s));
    await run('openVault ' + show(s), () => openVault(s, { a: { key: bytes(32) } }));
  };
  // the frozen conformance vectors must still open (the fuzzer must not run on a broken build)
  for (const v of vectors.sealed) {
    await run('vector ' + v.name, async () => {
      const r = await openSealed(v.work ?? null, { key: v.key ?? undefined, password: v.password, record: v.record });
      const got = r.kind === 'text' ? r.text : r.kind === 'tgd' ? r.text : [...r.bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
      const want = v.expect.text ?? v.expect.body ?? v.expect.hex;
      if (r.kind !== v.expect.kind || got !== want) throw new Error('vector mismatch ' + v.name);
    });
  }
  let i = 0;
  while (Date.now() < deadline) { await strategies[i++ % strategies.length](); if (QUICK && i > 400) break; }
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`calls ${results.calls}: ${results.ok} ok, ${results.refused} refused cleanly, ${results.findings.length} findings; slowest call ${results.slowest.toFixed(0)} ms (${results.slowestWhat.slice(0, 60)}); peak rss ${Math.round(memPeak)} MB; ${seconds} s`);
  for (const f of results.findings.slice(0, 20)) console.log('FINDING', JSON.stringify(f));
  if (results.findings.length) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(2); });
