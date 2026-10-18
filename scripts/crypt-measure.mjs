#!/usr/bin/env node
// Reproduces every measured number in docs/encrypted-data.md and docs/key-format.md.
//   node scripts/crypt-measure.mjs [keys|leak|alphabets|payload|kdf|book|chain|all]
// Deterministic where it can be (seeded random for texts and the sheet); the random choices of keys are averaged over runs.
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { canonicalText, hideSecret } from '../src/secret.js';
import { graphemes, normalizeText } from '../src/layout.js';
import { hideCompact, choosePositions } from '../src/crypt-book.js';
import { sealData, sealMessage, DEFAULT_ITERATIONS } from '../src/crypt.js';
import { encode } from '../src/structured.js';
import { b58Encode, b64urlEncode, sha256, utf8, deflateRaw } from '../src/crypt-codec.js';

const rd = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const which = process.argv[2] || 'all';
const want = (n) => which === 'all' || which === n;

// seeded random (xorshift32) so the texts are the same on every run
let seed = 20261018;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
const seededFill = (a) => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(rnd() * 4294967296); };

// The three works (canonical text of real texts) and the message source.
const pep = canonicalText(rd('samples/example-pep-8.txt'));
const big = canonicalText(rd('samples/example-us-constitution.txt') + ' ' + rd('samples/example-ch-bundesverfassung.txt') + ' ' + rd('samples/example-de-grundgesetz.txt'));
const WORKS = [['3k', pep.slice(0, 3000)], ['50k', pep.slice(0, 50000)], ['600k', big.slice(0, 600000)]];
const source = canonicalText(rd('samples/gallery-twain.txt')).toLowerCase().replace(/[^a-z ,.]/g, '');
const messageFor = (len, work) => { // len characters of English, restricted to what the work contains
  const have = new Set(graphemes(work));
  return [...source].filter((c) => have.has(c)).join('').slice(1000, 1000 + len);
};
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const fmt = (x, d = 0) => x.toFixed(d);
const table = (head, rows) => { console.log('| ' + head.join(' | ') + ' |\n|' + head.map(() => '---').join('|') + '|'); rows.forEach((r) => console.log('| ' + r.join(' | ') + ' |')); console.log(); };

if (want('keys')) {
  console.log('## Key length (characters, mean of 5 keys) by message length and work length\n');
  const policies = [['tg1 (varint)', null], ['tg2 fixed width', { near: Infinity }], ['tg2 near K=32', { near: 32 }], ['tg2 near K=8', { near: 8 }], ['tg2 near K=2', { near: 2 }], ['tg2 near K=1', { near: 1 }]];
  const rows = [];
  for (const [label, o] of policies) {
    const row = [label];
    for (const [, work] of WORKS) for (const len of [10, 100, 1000]) {
      const msg = messageFor(len, work);
      if (msg.length < len) { row.push('n/a'); continue; }
      const lens = [];
      for (let i = 0; i < 5; i++) lens.push(o ? (await hideCompact(work, msg, o)).length : (await hideSecret(work, msg)).length);
      row.push(fmt(mean(lens)));
    }
    rows.push(row);
  }
  table(['format', '3k:10', '3k:100', '3k:1000', '50k:10', '50k:100', '50k:1000', '600k:10', '600k:100', '600k:1000'], rows);
  console.log('Work lengths in grapheme clusters:', WORKS.map(([n, w]) => `${n}=${graphemes(w).length}`).join(', '), '\n');
  // fingerprint 4 bytes
  const w = WORKS[1][1], m = messageFor(100, w);
  console.log('tg2 fixed, 8-byte fingerprint vs 4-byte (50k, 100 chars):', (await hideCompact(w, m)).length, 'vs', (await hideCompact(w, m, { shortFingerprint: true })).length, '\n');
}

if (want('leak')) {
  console.log('## Unpredictability by policy (50k work, 1000 messages of 100 characters, shared random source)\n');
  const [, work] = WORKS[1];
  const clusters = graphemes(work), N = clusters.length;
  const where = new Map();
  clusters.forEach((c, i) => { if (!where.has(c)) where.set(c, 0); where.set(c, where.get(c) + 1); });
  const rows = [];
  for (const [label, near] of [['all occurrences (tg1, tg2 fixed)', Infinity], ['K=32', 32], ['K=8', 8], ['K=2', 2], ['K=1', 1]]) {
    let choiceBits = 0, chars = 0, sameChar = 0, samePos = 0;
    const joint = new Map(), byChar = new Map(), byBucket = new Map();
    for (let t = 0; t < 1000; t++) {
      const msg = messageFor(100, work).slice(0, 0) + [...source.slice(rnd() * (source.length - 200) | 0)].filter((c) => where.has(c)).slice(0, 100).join('');
      const wanted = graphemes(msg);
      const pos = choosePositions(clusters, wanted, { near, random: seededFill });
      let prev = -1;
      wanted.forEach((c, i) => {
        const n = where.get(c);
        choiceBits += Math.log2(Math.min(near, n));
        chars++;
        const d = (((pos[i] - prev - 1) % N) + N) % N;
        prev = pos[i];
        const bucket = Number.isFinite(near) ? Math.floor(Math.log2(d + 1)) : 'x';
        byChar.set(c, (byChar.get(c) || 0) + 1);
        byBucket.set(bucket, (byBucket.get(bucket) || 0) + 1);
        const jk = c + '|' + bucket; joint.set(jk, (joint.get(jk) || 0) + 1);
      });
      for (let i = 0; i < wanted.length; i++) for (let j = i + 1; j < wanted.length; j++) if (wanted[i] === wanted[j]) { sameChar++; if (pos[i] === pos[j]) samePos++; }
    }
    const H = (m, tot) => -[...m.values()].reduce((a, v) => a + (v / tot) * Math.log2(v / tot), 0);
    const hc = H(byChar, chars), hj = H(joint, chars), hb = H(byBucket, chars);
    rows.push([label, fmt(choiceBits / chars, 2), fmt(hc, 2), fmt(hc - (hj - hb), 2), fmt(100 * samePos / sameChar, 2) + ' %']);
  }
  table(['policy', 'random choice, bits per character', 'entropy of the message character, bits', 'information the distance gives about it, bits', 'equal characters that share one position'], rows);
}

if (want('alphabets')) {
  console.log('## Text alphabets for a 43-byte key and a 5 000-byte record\n');
  const k = new Uint8Array(43), r = new Uint8Array(5000);
  seededFill(k); seededFill(r);
  const z85 = (n) => Math.ceil(n / 4) * 5, b91 = (n) => Math.ceil(n * 8 / 6.5), b32 = (n) => Math.ceil(n * 8 / 5), b16 = (n) => 2 * n;
  table(['alphabet', 'characters', 'bits per character', '43 bytes', '5000 bytes', 'safe in a URL', 'inert in chat markdown', 'double-click selects all'], [
    ['base64url (tg1, records)', '64', '6.00', b64urlEncode(k).length, b64urlEncode(r).length, 'yes', 'no: `_` is italic in WhatsApp, Telegram, Slack, Discord', 'no: `-` ends a word in most browsers'],
    ['base58 (Bitcoin; tgx1, tg2)', '58', '5.86', b58Encode(k).length, b58Encode(r).length, 'yes', 'yes', 'yes'],
    ['base32 (5 bit, case-folded)', '32', '5.00', b32(43), b32(5000), 'yes', 'yes', 'yes'],
    ['base16 (hex)', '16', '4.00', b16(43), b16(5000), 'yes', 'yes', 'yes'],
    ['Z85 / base85', '85', '6.41', z85(43), z85(5000), 'no (`"`, `<`, `>`, `\\`, `%`, `&` need escaping)', 'no (`*`, `_`, `~`, backtick)', 'no'],
    ['base91', '91', '6.50', b91(43), b91(5000), 'no', 'no', 'no'],
  ]);
}

if (want('payload')) {
  console.log('## A sheet before and after sealing (200 rows, 6 columns, seeded)\n');
  const city = ['Zürich', 'Bern', 'Genève', 'Basel', 'Lausanne', 'Luzern', 'St. Gallen', 'Lugano', 'Winterthur', 'Chur'];
  const first = ['Anna', 'Luca', 'Mia', 'Noah', 'Elena', 'Jonas', 'Sara', 'Leon', 'Lea', 'Nico'], last = ['Müller', 'Meier', 'Schmid', 'Keller', 'Weber', 'Huber', 'Frei', 'Brunner', 'Baumann', 'Gerber'];
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const rowsCsv = [['Name', 'Email', 'City', 'Amount', 'Date', 'Note']];
  for (let i = 0; i < 200; i++) {
    const f = pick(first), l = pick(last);
    rowsCsv.push([`${f} ${l}`, `${f}.${l}${i}@example.org`.toLowerCase().replace('ü', 'ue'), pick(city), (rnd() * 5000).toFixed(2), `2026-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`, rnd() < 0.3 ? 'follow up, call back' : '']);
  }
  const csv = rowsCsv.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n') + '\r\n';
  const csvBytes = utf8(csv);
  const e = await encode({ bytes: csvBytes, name: 'customers.csv' }, { created: '2026-10-18T00:00:00Z' });
  const stripped = e.text.replace(/\s+/g, '');
  const body = utf8(stripped.slice(5, -5));
  const dict = utf8('{"tgd":"1.0","sum":"","format":"csv","name":"","created":"2026-","by":"tg-data/1.0","read":"TGD·1:·JSON,·each·middle·dot·stands·for·one·space,·\\\\uXXXX·is·one·character.","lossy":["types:·every·cell·is·text","quoting·style:·fields·are·quoted·only·where·needed"],"data":{"kind":"workbook","dialect":{"delimiter":",","eol":"\\r\\n","final":true},"sheets":[{"name":"","rows":[[');
  const sizes = [
    ['source CSV file', csvBytes.length],
    ['TGD block as the encoder writes it (rows layout)', utf8(e.text).length],
    ['TGD body, whitespace removed (what is sealed)', body.length],
    ['TGD body, gzip (deflate + 18 bytes)', zlib.gzipSync(body, { level: 9 }).length],
    ['TGD body, raw deflate through CompressionStream (what browsers offer: default level)', (await deflateRaw(body)).length],
    ['TGD body, raw deflate, zlib level 9 (Node only)', zlib.deflateRawSync(body, { level: 9 }).length],
    ['TGD body, raw deflate, preset dictionary of the envelope keys', zlib.deflateRawSync(body, { level: 9, dictionary: dict }).length],
    ['TGD body, brotli (Node only; not in CompressionStream)', zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length],
    ['source CSV, raw deflate', zlib.deflateRawSync(csvBytes, { level: 9 }).length],
  ];
  table(['variant', 'bytes'], sizes.map(([a, b]) => [a, b]));
  const work = WORKS[2][1];
  const plain = await sealData(work, e.text, { compress: false });
  const packed = await sealData(work, e.text);
  const inl = await sealData(work, e.text, { inline: true });
  const brot = await sealData(work, e.text, { compress: 'brotli' });
  const padded = await sealData(work, e.text, { pad: 1024 });
  const noBind = await sealData(null, e.text, { bind: false });
  const k128 = await sealData(work, e.text, { strength: 128 });
  table(['sealed variant', 'record bytes', 'record characters (base64url)', 'key characters (base58)'], [
    ['not compressed', plain.stats.recordBytes, plain.record.length, plain.key.length],
    ['deflate (default), key separate', packed.stats.recordBytes, packed.record.length, packed.key.length],
    ['brotli (Node 24+; browsers: probe first)', brot.stats.recordBytes, brot.record.length, brot.key.length],
    ['deflate, 128-bit secret', k128.stats.recordBytes, k128.record.length, k128.key.length],
    ['deflate, not bound to a work', noBind.stats.recordBytes, noBind.record.length, noBind.key.length],
    ['deflate, padded to 1024', padded.stats.recordBytes, padded.record.length, padded.key.length],
    ['deflate, record inside the key', inl.stats.recordBytes, '(in the key)', inl.key.length],
  ]);
  const packedLen = (await deflateRaw(body)).length;
  console.log(`Fixed overhead of a sealed record: header 2 + nonce 12 + tag 16 + inner (length varint + kind byte) = ${packed.stats.recordBytes - packedLen} bytes over the deflated body (${packedLen}).`);
  console.log(`Overhead without a random nonce would be 12 bytes less (${fmt(100 * 12 / packed.stats.recordBytes, 1)} % of this record); not taken: see docs/encrypted-data.md section 4.\n`);
  // book cipher on the same TGD text
  const have = new Set(graphemes(work));
  const need = [...new Set(graphemes(stripped))];
  const miss = need.filter((c) => !have.has(c));
  console.log(`(a) Book cipher over the TGD text: ${graphemes(stripped).length} characters to hide; distinct characters ${need.length}, absent from the 600k work: ${miss.length} (${miss.slice(0, 20).map((c) => JSON.stringify(c)).join(' ')}).`);
  for (const [n, w] of WORKS) { const h = new Set(graphemes(w)); const m = need.filter((c) => !h.has(c)); console.log(`   work ${n}: ${m.length} of ${need.length} characters absent`); }
  const bits = Math.ceil(Math.log2(graphemes(work).length));
  console.log(`   if every character were present: 600k work, ${bits} bits each = ${Math.ceil(graphemes(stripped).length * bits / 8)} bytes, about ${Math.ceil(graphemes(stripped).length * bits / 8 * 8 / 5.86)} characters of key (tg2 fixed), against ${packed.key.length} for the sealed key + ${packed.record.length} for the record.\n`);
  globalThis.__csv = { csv, e, body };
}

if (want('kdf')) {
  console.log('## PBKDF2-HMAC-SHA256 time (this machine, Node ' + process.version + ', Web Crypto; one derivation)\n');
  const rows = [];
  for (const it of [100_000, 210_000, DEFAULT_ITERATIONS, 1_000_000, 2_000_000]) {
    const ts = [];
    for (let i = 0; i < 3; i++) { const t = performance.now(); await sealMessage(null, 'x', { bind: false, password: 'correct horse', iterations: it }); ts.push(performance.now() - t); }
    rows.push([it.toLocaleString('en-US'), fmt(Math.min(...ts))]);
  }
  table(['iterations', 'ms'], rows);
}

if (want('book')) {
  console.log('## (c) hybrid: hide a 32-byte secret as characters of the work\n');
  const [, work] = WORKS[2];
  const hex = [...Array(32)].map(() => Math.floor(rnd() * 256).toString(16).padStart(2, '0')).join('');
  const k = await hideCompact(work, hex);
  const b = await hideCompact(work, hex, { near: 1 });
  console.log(`hex secret as a book cipher in the 600k work: tg1 ${(await hideSecret(work, hex)).length} characters, tg2 fixed ${k.length}, tg2 near K=1 ${b.length}; a plain tgx1 key with the same secret: ${(await sealMessage(work, 'x')).key.length} characters.\n`);
  // word-level estimate
  const words = canonicalText(rd('samples/gallery-twain.txt')).toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).filter(Boolean);
  const vocab = new Set(big.toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/));
  const msgWords = words.slice(200, 215);
  const found = msgWords.filter((w) => vocab.has(w)).length;
  const nWords = big.slice(0, 600000).split(' ').length;
  const chars = msgWords.join(' ').length;
  const spelled = msgWords.filter((w) => !vocab.has(w)).join(' ').length + (msgWords.length - found);
  const wordBits = found * (Math.ceil(Math.log2(nWords)) + 1) + spelled * 21;
  console.log(`Word level (designed only): a ${chars}-character English message of ${msgWords.length} words, ${found} found as words in the 600k work (${nWords} words): ${found} words x ${Math.ceil(Math.log2(nWords)) + 1} bits + ${spelled} spelled characters x 21 bits = ${Math.ceil(wordBits / 8)} bytes, against ${Math.ceil(chars * 20 / 8)} bytes for characters at 20 bits.\n`);
}
