#!/usr/bin/env node
// Bounded, deterministic fuzzing of every decoder and parser that sees untrusted input: keys of every prefix, sealed
// records, shares, vaults, mnemonics, and the structured-data readers (csv, tsv, json, yaml, xml, md, ics, vcf, kv, xlsx/zip,
// TGD blocks). The only acceptable outcomes of a case are a correct result or a clean, named error (CryptError / TgdError
// with a string `code`) inside a time bound. Anything else is a finding: an unexpected exception type, a hang or slow
// case, a result that does not round-trip, a TGD block that the encoder wrote and the decoder refuses.
//
//   node scripts/fuzz-crypto.mjs [--seed N] [--seconds S | --iterations N] [--targets keys,records,structured,tgd,xlsx] [--max-ms M]
//
// The seed is printed first; the same seed and iteration count replay the same cases. In a long run the driver restarts
// itself as a watched child process, so that a hang is reported with the input that caused it (written to --last-case).
// Used by test/fuzz-crypto.test.js with a fixed seed and a few thousand cases.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { CryptError, sealItem, openSealed, parseKey, parseRecord, describeRecord, KEY_PREFIX } from '../src/crypt.js';
import { b58Encode, b58Decode, b64urlEncode, b64urlDecode, seededRandom } from '../src/crypt-codec.js';
import { hideCompact, revealCompact, revealAny } from '../src/crypt-book.js';
import { hideSecret, revealSecret } from '../src/secret.js';
import { parseMaster, formatMaster, mnemonicToEntropy, seedFromHex, entropyToMnemonic, masterFromSeed } from '../src/keys.js';
import { newRecipient, sealTo, openFrom, parsePublic, parseSecret, parseSealedTo } from '../src/keys-seal.js';
import { sealBound2, openAny, parseKey2, openWithSecret } from '../src/keys-work.js';
import { splitShamir, splitXor, joinShares, parseShare, newMixed, parseHalf, createVault, describeVault, openVault } from '../src/keys-split.js';
import { encode, decode, decodeAll, toFile, TgdError, stripText } from '../src/structured.js';
import { exportFormats, summarize, summaryLine, isEmptyModel, sheetPreview, columnTypes, outline, hasEscapedScripts, warningsFor, blockJson, composeWork, cellInfo } from '../src/data-panel.js';
import { structuredText } from '../src/structure.js';
import { writeZip, openZip } from '../src/structured-zip.js';
import { FORMATS } from '../src/structured-formats.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, '..', 'test', 'fixtures');
const WORK = 'The quick brown fox jumps over the lazy dog, and the owner of this work keeps a secret. '.repeat(3);
const enc = new TextEncoder(), dec = new TextDecoder();

// ---- deterministic randomness (xorshift32 seeded by SHA-256 of the seed) ----------------------------------------------
export function makeRng(seed) {
  let s = createHash('sha256').update(String(seed)).digest().readUInt32LE(0) || 1;
  const next = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
  const rng = { next, int: (n) => next() % n, pick: (a) => a[next() % a.length], chance: (p) => next() / 4294967296 < p };
  return rng;
}

// ---- mutation ---------------------------------------------------------------------------------------------------------
const INTERESTING = [0, 1, 2, 0x7f, 0x80, 0x81, 0xfe, 0xff];
export function mutateBytes(rng, input, rounds = 1 + rng.int(3)) {
  let b = Uint8Array.from(input);
  for (let r = 0; r < rounds; r++) {
    const op = rng.int(10);
    if (!b.length && op < 7) { b = Uint8Array.of(rng.int(256)); continue; }
    if (op === 0) b[rng.int(b.length)] ^= 1 << rng.int(8);
    else if (op === 1) b[rng.int(b.length)] = rng.pick(INTERESTING);
    else if (op === 2) { const at = rng.int(b.length + 1), n = 1 + rng.int(8); b = Uint8Array.from([...b.subarray(0, at), ...Array.from({ length: n }, () => rng.int(256)), ...b.subarray(at)]); }
    else if (op === 3) { const at = rng.int(b.length), n = 1 + rng.int(Math.min(16, b.length - at)); b = Uint8Array.from([...b.subarray(0, at), ...b.subarray(at + n)]); }
    else if (op === 4) { const at = rng.int(b.length), n = 1 + rng.int(Math.min(64, b.length - at)); b = Uint8Array.from([...b.subarray(0, at + n), ...b.subarray(at, at + n), ...b.subarray(at + n)]); }
    else if (op === 5) b = b.subarray(0, rng.int(b.length + 1));
    else if (op === 6) b = Uint8Array.from([...b, ...new Uint8Array(1 + rng.int(32)).fill(rng.pick(INTERESTING))]);
    else if (op === 7) { const i = rng.int(b.length), j = rng.int(b.length); const t = b[i]; b[i] = b[j]; b[j] = t; }
    else if (op === 8) { const i = rng.int(b.length); b[i] = (b[i] + (rng.chance(0.5) ? 1 : 255)) & 255; }
    else { const at = rng.int(b.length + 1); b = Uint8Array.from([...b.subarray(0, at), ...b.subarray(rng.int(b.length + 1))]); }
  }
  return b.length > 262144 ? b.subarray(0, 262144) : b;
}
const TOKENS = ['\0', '\ufeff', '\u2028', '\u202e', '"', "'", '\\', '\\u', '<', '>', '&', '&#x0;', '&amp;', '&lt;', '#', '|', '\n', '\r\n', '\t', ' ', ',', ';', ':', '---', '```', '- ', '* ', '[', ']', '{', '}', '$', '__proto__', 'constructor', '=1', '=cmd|', '@SUM(', '%', '\ud800', '·', 'TGD1[', ']TGD1', '\u0301', '😀', '<a>', '</a>', '{"a":', '[[', '\n  - ', '\n> ', '\n  k:'];
export function mutateText(rng, text, rounds = 1 + rng.int(4)) {
  let s = text;
  for (let r = 0; r < rounds; r++) {
    const op = rng.int(6), at = rng.int(s.length + 1);
    if (op === 0) s = s.slice(0, at) + rng.pick(TOKENS) + s.slice(at);
    else if (op === 1) s = s.slice(0, at) + s.slice(at + 1 + rng.int(8));
    else if (op === 2) s = s.slice(0, at) + rng.pick(TOKENS) + s.slice(at + 1);
    else if (op === 3) s = s.slice(0, at) + s.slice(at, at + 1 + rng.int(40)).repeat(2 + rng.int(40)) + s.slice(at);
    else if (op === 4) s = s.slice(0, at);
    else s = s.slice(0, at) + rng.pick(TOKENS).repeat(1 + rng.int(300)) + s.slice(at);
    if (s.length > 262144) s = s.slice(0, 262144);
  }
  return s;
}

// ---- checksum-aware key mutation: change the body, then make the check value right again -------------------------------
const sum = (domain, body, n) => createHash('sha256').update(Buffer.concat([Buffer.from(domain), Buffer.from([0]), Buffer.from(body)])).digest().subarray(0, n);
const B58_KEYS = { 'tgx1.': ['tgx1', 2], 'tgx2.': ['tgx2', 2], 'tgp1.': ['tgp1', 2], 'tgq1.': ['tgq1', 2], 'tgmk1.': ['tgmk1', 2], 'tgxm1.': ['tgxm1', 2], 'tgsh1.': ['tgsh1', 4], 'tg2.': ['tg2', 2] };
export function mutateKeyText(rng, text) {
  const prefix = Object.keys(B58_KEYS).find((p) => text.startsWith(p)) ?? (text.startsWith('tgv1.') ? 'tgv1.' : null);
  if (prefix && rng.chance(0.7)) {
    try {
      if (prefix === 'tgv1.') {
        const raw = b64urlDecode(text.slice(5)), body = mutateBytes(rng, raw.subarray(0, -4));
        return 'tgv1.' + b64urlEncode(Uint8Array.from([...body, ...sum('tgv1', body, 4)]));
      }
      const [domain, n] = B58_KEYS[prefix];
      const raw = b58Decode(text.slice(prefix.length)), body = mutateBytes(rng, raw.subarray(0, -n));
      return prefix + b58Encode(Uint8Array.from([...body, ...sum(domain, body, n)]));
    } catch { /* fall through to a plain text mutation */ }
  }
  return mutateText(rng, text, 1 + rng.int(3));
}
export function mutateRecordText(rng, text) {
  const m = /^(tgs1\.|tgr1\.)(.*)$/s.exec(text);
  if (m && rng.chance(0.8)) { try { return m[1] + b64urlEncode(mutateBytes(rng, b64urlDecode(m[2]))); } catch { /* plain */ } }
  return mutateText(rng, text, 1 + rng.int(3));
}

// ---- seeds ------------------------------------------------------------------------------------------------------------
async function buildSeeds() {
  const rnd = seededRandom('fuzz-seeds');
  const item = { kind: 'text', payload: enc.encode('a sealed message, long enough to compress compress compress compress') };
  const s1 = await sealItem(WORK, item, { random: rnd }), s1i = await sealItem(WORK, item, { inline: true, random: rnd }), s1u = await sealItem(null, item, { bind: false, strength: 128, random: rnd });
  const s1p = await sealItem(WORK, item, { password: 'pw', iterations: 100000, random: rnd }), s1b = await sealItem(WORK, item, { compress: 'brotli', pad: 32, random: rnd });
  const tgdItem = await encode({ bytes: enc.encode('a,b\n1,2\n'), name: 't.csv' }, { created: false });
  const s1t = await sealItem(WORK, { kind: 'tgd', payload: enc.encode(stripText(tgdItem.text).slice(5, -5)) }, { random: rnd });
  const s2 = await sealBound2(WORK, item, { random: rnd });
  const rcpt = await newRecipient(rnd), sr = await sealTo(rcpt.public, item, { context: 'ctx', random: rnd });
  const seed = Uint8Array.from({ length: 32 }, (_, i) => i + 1), master = await masterFromSeed(seed);
  const shamir = await splitShamir(enc.encode('0123456789abcdef'), 3, 5, { random: rnd }), xor = await splitXor(enc.encode('0123456789abcdef'), 3, { random: rnd });
  const mixed = await newMixed('pw', { params: { kdf: 'pbkdf2-sha512', iterations: 100000 }, random: rnd });
  const kA = new Uint8Array(32).fill(1), kB = new Uint8Array(32).fill(2);
  const vault = await createVault([{ name: 'seed', key: kA }, { name: 'passkey', key: kB }, { name: 'phrase', passphrase: 'pw', params: { kdf: 'pbkdf2-sha512', iterations: 100000 } }], { k: 2, random: rnd });
  return {
    keys: { tgx1: [s1.key, s1i.key, s1u.key, s1b.key], tgx2: [s2.key], tg1: [await hideSecret(WORK, 'the owner keeps a secret', { random: rnd })],
      tg2: [await hideCompact(WORK, 'the owner keeps a secret', { random: rnd }), await hideCompact(WORK, 'the owner', { near: 3, shortFingerprint: true, random: rnd })],
      tgmk1: [await formatMaster(master)], tgp1: [rcpt.public], tgq1: [rcpt.secret], tgxm1: [mixed.half], tgsh1: [...shamir, ...xor], tgv1: [vault.vault] },
    records: [s1.record, s1i.record, s1u.record, s1p.record, s1b.record, s1t.record, s2.record],
    pairs: [[s1.key, s1.record], [s1i.key, ''], [s1u.key, s1u.record], [s1b.key, s1b.record], [s1t.key, s1t.record], [s2.key, s2.record], [s1.key, s1p.record]],
    modelTexts: MODEL_TEXTS,
    tgr1: [sr.record], rcpt, kA, kB, mnemonic: await entropyToMnemonic(new Uint8Array(16).fill(7)), tgdBlock: tgdItem.text,
  };
}
function loadFixtures() {
  const out = {};
  for (const f of readdirSync(FIX)) {
    const ext = f.split('.').pop();
    const format = { csv: 'csv', tsv: 'tsv', json: 'json', yaml: 'yaml', xml: 'xml', md: 'md', ics: 'ics', vcf: 'vcf', env: 'kv', xlsx: 'xlsx' }[ext];
    if (format && f !== 'key-management-vectors.json' && !f.startsWith('build-')) (out[format] ||= []).push([f, new Uint8Array(readFileSync(join(FIX, f)))]);
  }
  const small = {
    csv: 'a,b,c\n1,"x ""y""",3\n', tsv: 'a\tb\n1\t2\n', json: '{"a":[1,2,{"b":null}],"c":"d","$":1}', yaml: 'a: 1\nb:\n  - x\n  - y: [1, 2]\nc: "q" # c\n',
    xml: '<a x="1"><b>t</b><c/></a>', md: '# T\n\ntext\n\n- a\n- b\n\n| a | b |\n|---|---|\n| 1 | 2 |\n', ics: 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:x\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
    vcf: 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:A B\r\nEND:VCARD\r\n', kv: 'A=1\nB="x y"\n',
  };
  for (const [k, v] of Object.entries(small)) (out[k] ||= []).push([`small.${k}`, enc.encode(v)]);
  return out;
}

// ---- verdicts ---------------------------------------------------------------------------------------------------------
const clean = (e) => (e instanceof CryptError || e instanceof TgdError) && typeof e.code === 'string';



const MODEL_TEXTS = [
  '{"kind":"workbook","sheets":[{"name":"S","rows":[["a","b"],[1,{"$":"d","v":"2020-01-01"}],[{"$":"f","f":"A1","v":1}]]}]}',
  '{"kind":"workbook","sheets":[{"name":"S","cells":{"A1":"x","B2":2,"XFD1048576":"far"},"merges":["A1:B2"],"comments":{"A1":"c"}}],"names":{"n":"S!A1"}}',
  '{"kind":"json","value":{"a":[1,2,{"b":null}],"c":"d"}}', '{"kind":"markdown","blocks":[{"t":"h","l":1,"x":"T"},{"t":"p","x":"text"},{"t":"ul","items":[[{"t":"p","x":"i"}]]},{"t":"table","head":["a"],"rows":[["1"]]}]}',
  '{"kind":"xml","root":["a",{"x":"1"},["b","t"],"s"]}', '{"kind":"icalendar","items":[{"name":"VEVENT","props":[{"n":"SUMMARY","v":"x"}]}]}', '{"kind":"vcard","items":[{"name":"VCARD","props":[]}]}', '{"kind":"kv","pairs":[["a","b"]]}',
];
/** Seals a model (JSON text of any shape) as a TGD block through the encoder's own envelope, so the checksum is right. */
async function sealTgdModel(modelText) {
  const { seal, fromPlain } = await import('../src/structured.js').then(async (m) => ({ seal: m.seal, fromPlain: (await import('../src/structured-json.js')).fromPlain }));
  let plain;
  try { plain = JSON.parse(modelText); } catch { throw new TgdError('syntax', 'model text is not JSON'); }
  if (!plain || typeof plain !== 'object' || Array.isArray(plain)) throw new TgdError('shape', 'model is not an object');
  return seal(plain, { format: 'xlsx', name: 'm.xlsx', created: false });
}

/** What the pages do with a decoded block: summary, tables, outline, warnings, JSON view. None of it may throw anything but a named error. */
function uiCheck(block) {
  const model = block.model;
  const summary = summarize(model, block.format);
  summaryLine(summary, 'en'); summaryLine(summary, 'de'); isEmptyModel(summary);
  warningsFor({ summary, model, lang: 'en', withProse: true, over: false });
  hasEscapedScripts(model);
  blockJson(block);
  composeWork({ prose: 'p', lead: 'l', block: 'TGD1[x]TGD1', placement: 'after' });
  if (model && Array.isArray(model.sheets)) for (const sh of model.sheets) { sheetPreview(sh); sheetPreview(sh, { maxRows: 200, maxCols: 50 }); columnTypes(sh); }
  else outline(model);
  if (model && Array.isArray(model.sheets)) for (const sh of model.sheets) for (const r of (Array.isArray(sh.rows) ? sh.rows.slice(0, 20) : [])) for (const c of (Array.isArray(r) ? r.slice(0, 20) : [])) cellInfo(c);
}

/** Runs the fuzzing. @returns {Promise<{seed, iterations, byTarget, findings:Array, maxMs:number}>} */
export async function runFuzz({ seed = 1, iterations = 3000, seconds = 0, targets = ['keys', 'records', 'structured', 'tgd', 'xlsx', 'models'], maxMs = 3000, lastCase = null, log = () => {} } = {}) {
  const rng = makeRng(seed), S = await buildSeeds(), F = loadFixtures();
  const findings = [], seen = new Set(), byTarget = {};
  let maxSeen = 0, count = 0;
  const started = Date.now();
  const note = (target, kind, detail, input) => {
    const sig = `${target}|${kind}|${String(detail).slice(0, 120)}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    findings.push({ target, kind, detail: String(detail).slice(0, 400), input: typeof input === 'string' ? input.slice(0, 300) : Buffer.from(input ?? []).toString('hex').slice(0, 600) });
    log(`FINDING ${sig}`);
  };
  /** One case: fn must return or throw a clean error, quickly. */
  const run = async (target, label, input, fn) => {
    byTarget[target] = (byTarget[target] || 0) + 1;
    if (lastCase) writeFileSync(lastCase, JSON.stringify({ target, label, input: typeof input === 'string' ? input : Buffer.from(input).toString('hex') }));
    const t0 = performance.now();
    try { await fn(); } catch (e) {
      if (!clean(e)) note(target, 'unexpected-exception', `${label}: ${e?.name}: ${e?.message}`, input);
    }
    const ms = performance.now() - t0;
    if (ms > maxSeen) maxSeen = ms;
    if (ms > maxMs) note(target, 'slow', `${label}: ${ms.toFixed(0)} ms for ${typeof input === 'string' ? input.length + ' chars' : input.length + ' bytes'}`, input);
    count++;
  };
  const deadline = seconds ? started + seconds * 1000 : Infinity;
  const todo = () => (seconds ? Date.now() < deadline : count < iterations);
  const want = (t) => targets.includes(t);
  const keyKinds = Object.keys(S.keys);

  while (todo()) {
    const roll = rng.int(100);
    if (want('keys') && roll < 30) {
      const kind = rng.pick(keyKinds), key = rng.chance(0.15) ? mutateText(rng, rng.pick(S.keys[kind])) : mutateKeyText(rng, rng.pick(S.keys[kind]));
      const rec = rng.pick(S.records);
      await run('keys', `parse ${kind}`, key, async () => {
        if (kind === 'tgx1') { await parseKey(key); await openSealed(WORK, { key, record: rec }); }
        else if (kind === 'tgx2') { await parseKey2(key); await openAny(WORK, { key, record: rec }); }
        else if (kind === 'tg1') { try { await revealSecret(WORK, key); } catch (e) { if (typeof e?.code !== 'string') throw e; /* secret.js raises plain Errors that carry a code (docs/hidden-messages.md); revealAny wraps them */ } }
        else if (kind === 'tg2') { await revealCompact(WORK, key); await revealAny(WORK, key); }
        else if (kind === 'tgmk1') await parseMaster(key);
        else if (kind === 'tgp1') await parsePublic(key);
        else if (kind === 'tgq1') await parseSecret(key);
        else if (kind === 'tgxm1') await parseHalf(key);
        else if (kind === 'tgsh1') { await parseShare(key); await joinShares([key, rng.pick(S.keys.tgsh1)]); await joinShares([key]); }
        else if (kind === 'tgv1') { await describeVault(key); await openVault(key, { seed: { key: S.kA }, passkey: { key: S.kB } }); }
      });
    } else if (want('keys') && roll < 36) {
      const m = mutateText(rng, S.mnemonic, 1 + rng.int(3));
      await run('keys', 'mnemonic', m, async () => { await mnemonicToEntropy(m); seedFromHex(m); });
    } else if (want('keys') && roll < 40) {
      // several shares mixed from different sets, repeated, truncated
      const list = Array.from({ length: 1 + rng.int(6) }, () => (rng.chance(0.2) ? mutateKeyText(rng, rng.pick(S.keys.tgsh1)) : rng.pick(S.keys.tgsh1)));
      await run('keys', 'joinShares', list.join(' '), async () => { await joinShares(list); });
    } else if (want('records') && roll < 62) {
      const [key, rec0] = rng.pick(S.pairs), record = rec0 ? mutateRecordText(rng, rec0) : '', k = rng.chance(0.3) ? mutateKeyText(rng, key) : key;
      await run('records', 'openSealed', record + '\n' + k, async () => {
        if (record) { try { parseRecord(record); describeRecord(record); } catch (e) { if (!clean(e)) throw e; } }
        await openSealed(WORK, { key: k, record });
        await openSealed(null, { key: k, record });
      });
    } else if (want('records') && roll < 70) {
      const r = mutateRecordText(rng, S.tgr1[0]);
      await run('records', 'tgr1', r, async () => { parseSealedTo(r); await openFrom(S.rcpt.secret, r, { context: 'ctx' }); });
    } else if (want('records') && roll < 76) {
      // authenticated structure: the KEY HOLDER seals attacker-shaped inner data (a bad TGD block, a bomb, odd kinds)
      const kind = rng.pick(['tgd', 'tgd', 'text', 'bytes']), body = mutateBytes(rng, enc.encode(stripText(S.tgdBlock).slice(5, -5)));
      await run('records', 'sealed-shape ' + kind, body, async () => {
        const s = await sealItem(WORK, { kind, payload: body }, { compress: rng.chance(0.5), pad: rng.pick([0, 0, 7, 64]), random: seededRandom(`r${count}`) });
        await openSealed(WORK, { key: s.key, record: s.record });
      });
    } else if (want('structured') && roll < 84) {
      const fmts = Object.keys(F).filter((f) => f !== 'xlsx'), fmt = rng.pick(fmts), [name, bytes] = rng.pick(F[fmt]);
      const mutated = rng.chance(0.1) ? bytes : fmt === 'xlsx' ? mutateBytes(rng, bytes) : enc.encode(mutateText(rng, dec.decode(bytes)));
      await run('structured', `encode ${fmt} (${name})`, mutated, async () => {
        const r = await encode({ bytes: mutated, name: `f.${fmt}`, format: fmt }, { created: false });
        const b = await decode(r.text);
        if (JSON.stringify(b.model) !== JSON.stringify(r.model)) throw new CryptError('roundtrip', `decode(encode(x)).model differs from the encoded model (${fmt})`);
        for (const f of exportFormats(b.model.kind, b.format)) { try { await toFile(b, f.id, {}); } catch (e) { if (!clean(e)) throw e; } }
        await toFile(b, b.format, { safe: false, formulas: true });
        uiCheck(b);
      });
    } else if (want('models') && roll < 91) {
      // a decoded block whose model has any shape: the pages must still show it or name the error
      const m = mutateText(rng, rng.pick(S.modelTexts), 1 + rng.int(4));
      await run('models', 'ui model', m, async () => {
        const block = await sealTgdModel(m);
        const b = await decode(block);
        uiCheck(b);
        for (const f of exportFormats(b.model.kind, b.format)) { try { await toFile(b, f.id, {}); } catch (e) { if (!clean(e)) throw e; } }
      });
    } else if (want('tgd') && roll < 96) {
      const text = rng.chance(0.5) ? mutateText(rng, S.tgdBlock, 1 + rng.int(3)) : refreshSum(mutateText(rng, S.tgdBlock, 1 + rng.int(3)));
      await run('tgd', 'decodeAll', text, async () => { await decodeAll(text); });
    } else if (want('xlsx')) {
      const [name, bytes] = rng.pick(F.xlsx), mode = rng.int(3);
      let input = bytes;
      if (mode === 0) input = mutateBytes(rng, bytes);
      else { // mutate one XML part inside and zip it again, so the XML and cell readers see the damage and the CRC is right
        try {
          const z = openZip(bytes), files = [];
          for (const n of z.names) { let data = await z.read(n); if (mode === 1 && /\.xml$|\.rels$/.test(n) && rng.chance(0.4)) data = enc.encode(mutateText(rng, dec.decode(data), 1 + rng.int(3))); files.push({ name: n, data }); }
          input = await writeZip(files);
        } catch { input = mutateBytes(rng, bytes); }
      }
      await run('xlsx', `xlsx (${name})`, input, async () => { const r = await encode({ bytes: input, name: 'f.xlsx', format: 'xlsx' }, { created: false }); await decode(r.text); });
    }
  }
  return { seed, iterations: count, byTarget, findings, maxMs: maxSeen, ms: Date.now() - started };
}

// ---- hostile shapes: long runs of one token behind every lead-in (finds quadratic and catastrophic regular expressions) ------
const LEADS = {
  csv: ['', '"', 'a,', '"a",', '#', ';', '//'], tsv: ['', '"', 'a\t'], json: ['', '[', '{"a":', '"', '[1,', '-', '1e'],
  yaml: ['', '- ', 'a: ', 'a:\n  - ', '[', '{', '"', "'", '|\n  ', '>\n  ', '---\n', '# ', 'a: [1,', '? '],
  xml: ['', '<a>', '<a ', '<a b="', '<!--', '<![CDATA[', '<?xml ', '<a>&'], md: ['', '# ', '## a ', '- ', '1. ', '> ', '```', '~~~', '|a|\n', '|a|\n|', '---\n', '    ', '<div ', '* * ', '[a]: ', '***'],
  txt: ['', '# ', '## a ', 'Chapter 1 ', 'ART. 5 ', 'ABC DEF '], ics: ['BEGIN:VCALENDAR\r\n', 'BEGIN:VCALENDAR\r\nX:'], vcf: ['BEGIN:VCARD\r\n', 'BEGIN:VCARD\r\nN;'], kv: ['', 'a=', 'a="', "a='", '# ', 'export '],
};
const RUNS = [' ', '\t', ' a', '  #', ' #', '#', '\\', '"', "'", '&', '&#', '<', '<a', '[', ']', '{', '}', ',', ':', ': ', '-', '- ', '*', '_', '`', '|', '|-', '\n', ' \n', '\r\n', '\n ', '=', '%', '\u00b7', '\\u00', '\u0301', '\u200b', '..', '1', '0.', 'e'];
const TAILS = ['', 'x', '\n', '#', '"', ']'];
/** Every format, lead-in, run token and tail: the time one parse takes must stay near linear (`maxMs` at `n` repeats). */
export async function runHostile({ n = 40000, maxMs = 250, sample = 0, seed = 1, log = () => {} } = {}) {
  const rng = makeRng('hostile' + seed), findings = [];
  let cases = 0, slowest = 0;
  const combos = [];
  for (const [fmt, leads] of Object.entries(LEADS)) for (const lead of leads) for (const run of RUNS) for (const tail of TAILS) combos.push([fmt, lead, run, tail]);
  const list = sample ? Array.from({ length: sample }, () => rng.pick(combos)) : combos;
  const seen = new Set();
  const flag = (kind, label, detail) => { const sig = `${kind}|${label}`; if (seen.has(sig)) return; seen.add(sig); findings.push({ target: 'hostile', kind, detail: `${label}: ${detail}`, input: label }); log(`FINDING ${sig}`); };
  for (const [fmt, lead, run, tail] of list) {
    const reps = Math.ceil(n / run.length), text = lead + run.repeat(reps) + tail, label = `${fmt} ${JSON.stringify(lead)} x ${JSON.stringify(run)} x${reps} ${JSON.stringify(tail)}`;
    const t0 = performance.now();
    try {
      if (fmt === 'txt') structuredText(text); // the section splitter of the Read view (src/structure.js)
      else { const r = await encode({ bytes: enc.encode(text), name: `h.${fmt}`, format: fmt }, { created: false }); await decode(r.text); }
    } catch (e) { if (!clean(e)) flag('unexpected-exception', label, `${e?.name}: ${e?.message}`); }
    const ms = performance.now() - t0; cases++;
    if (ms > slowest) slowest = ms;
    if (ms > maxMs) flag('slow', label, `${ms.toFixed(0)} ms for ${text.length} characters`);
  }
  // the TGD decoder itself and the crypt parsers, with long input of every kind
  for (const run of RUNS) {
    const block = 'TGD1[' + run.repeat(Math.ceil(n / run.length)) + ']TGD1';
    const t0 = performance.now();
    try { await decodeAll(block); } catch (e) { if (!clean(e)) flag('unexpected-exception', `tgd ${JSON.stringify(run)}`, `${e?.name}: ${e?.message}`); }
    const ms = performance.now() - t0; cases++;
    if (ms > maxMs) flag('slow', `tgd ${JSON.stringify(run)}`, `${ms.toFixed(0)} ms`);
    for (const [name, fn] of [['parseKey', () => parseKey('tgx1.' + run.repeat(Math.ceil(n * 20 / run.length)))], ['parseRecord', () => parseRecord('tgs1.' + run.repeat(Math.ceil(n * 20 / run.length)))], ['openSealed', () => openSealed(WORK, { key: 'tgx1.' + run.repeat(1 + (n >> 2)), record: 'tgs1.' + run.repeat(1 + (n >> 2)) })], ['revealAny', () => revealAny(WORK, 'tg1.' + run.repeat(Math.ceil(n / run.length)))], ['joinShares', () => joinShares(['tgsh1.' + run.repeat(Math.ceil(n / run.length))])]]) {
      const t1 = performance.now();
      try { await fn(); } catch (e) { if (!clean(e) && typeof e?.code !== 'string') flag('unexpected-exception', `${name} ${JSON.stringify(run)}`, `${e?.name}: ${e?.message}`); }
      const m2 = performance.now() - t1; cases++;
      if (m2 > maxMs) flag('slow', `${name} ${JSON.stringify(run)}`, `${m2.toFixed(0)} ms`);
    }
  }
  return { seed, iterations: cases, byTarget: { hostile: cases }, findings, maxMs: slowest, ms: 0 };
}
const SUM = /"sum":"([0-9a-f]{64})"/;
function refreshSum(block) {
  try {
    const body = stripText(block).replace(/^TGD1\[/, '').replace(/\]TGD1$/, '');
    if (!SUM.test(body)) return block;
    const z = createHash('sha256').update(body.replace(SUM, `"sum":"${'0'.repeat(64)}"`)).digest('hex');
    return block.replace(SUM, `"sum":"${z}"`);
  } catch { return block; }
}

// ---- command line -----------------------------------------------------------------------------------------------------
async function main() {
  const a = process.argv.slice(2), opt = (n, d) => { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : d; };
  const seed = opt('seed', String(Date.now() % 1000000)), seconds = Number(opt('seconds', 0)), iterations = Number(opt('iterations', 20000));
  const targets = opt('targets', 'keys,records,structured,tgd,xlsx,models').split(','), maxMs = Number(opt('max-ms', 3000)), lastCase = opt('last-case', `${process.env.TMPDIR || '/tmp'}/tg-fuzz-last-case.json`);
  if (a.includes('--hostile')) {
    const r = await runHostile({ n: Number(opt('n', 40000)), maxMs: Number(opt('max-ms', 250)), sample: Number(opt('sample', 0)), seed, log: (m) => console.log(m) });
    console.log(`hostile shapes: ${r.iterations} cases, slowest ${r.maxMs.toFixed(0)} ms, findings ${r.findings.length}`);
    for (const f of r.findings) console.log(`  [${f.kind}] ${f.detail}`);
    process.exit(r.findings.length ? 1 : 0);
  }
  if (a.includes('--worker')) {
    const r = await runFuzz({ seed, iterations, seconds, targets, maxMs, lastCase, log: (m) => console.log(m) });
    console.log('RESULT ' + JSON.stringify(r));
    return;
  }
  console.log(`fuzz seed ${seed}; ${seconds ? seconds + ' s' : iterations + ' iterations'}; targets ${targets.join(',')}; per-case time bound ${maxMs} ms`);
  // the watched run: restart the same code in a child and kill it when it stops answering (a hang is a finding)
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker', '--seed', seed, '--seconds', String(seconds), '--iterations', String(iterations), '--targets', targets.join(','), '--max-ms', String(maxMs), '--last-case', lastCase], { stdio: ['ignore', 'pipe', 'inherit'] });
  let result = null, buf = '', lastSeen = Date.now(), hung = false;
  child.stdout.on('data', (d) => { buf += d; lastSeen = Date.now(); let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.startsWith('RESULT ')) result = JSON.parse(line.slice(7)); else console.log(line); } });
  const dog = setInterval(() => { const quiet = Date.now() - lastSeen; if (quiet > 120000 && seconds === 0) { hung = true; child.kill('SIGKILL'); } else if (seconds && Date.now() - lastSeen > (seconds + 120) * 1000) { hung = true; child.kill('SIGKILL'); } }, 5000);
  const code = await new Promise((res) => child.on('exit', res));
  clearInterval(dog);
  if (hung) { console.log(`HANG: the worker stopped answering; the case is in ${lastCase}: ${readFileSync(lastCase, 'utf8').slice(0, 400)}`); process.exit(2); }
  if (!result) { console.log(`the worker ended without a result (exit ${code}); last case in ${lastCase}: ${readFileSync(lastCase, 'utf8').slice(0, 400)}`); process.exit(2); }
  console.log(`iterations ${result.iterations} in ${(result.ms / 1000).toFixed(1)} s; per target ${JSON.stringify(result.byTarget)}; slowest case ${result.maxMs.toFixed(0)} ms; findings ${result.findings.length}`);
  for (const f of result.findings) console.log(`  [${f.target}] ${f.kind}: ${f.detail}\n     input: ${f.input}`);
  process.exit(result.findings.length ? 1 : 0);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
