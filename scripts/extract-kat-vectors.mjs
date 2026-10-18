#!/usr/bin/env node
// Extracts the published known-answer vectors used by test/known-answer.test.js from the standards documents themselves,
// so that no vector is typed by hand. Usage: node scripts/extract-kat-vectors.mjs <dir> > test/fixtures/known-answer-vectors.json
// <dir> holds the documents as downloaded (nothing here touches the network):
//   rfc5869.txt rfc4231.txt rfc7914.txt rfc7748.txt rfc9106.txt   https://www.rfc-editor.org/rfc/rfcNNNN.txt
//   slip21.md       https://raw.githubusercontent.com/satoshilabs/slips/master/slip-0021.md
//   bip39vec.json   https://raw.githubusercontent.com/trezor/python-mnemonic/master/vectors.json
//   gcmEncryptExtIV256.rsp  from https://csrc.nist.gov/CSRC/media/Projects/Cryptographic-Algorithm-Validation-Program/documents/mac/gcmtestvectors.zip
// The SHA-256 of every document is written into the output, so that the source of each vector is pinned.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('usage: extract-kat-vectors.mjs <dir>'); process.exit(1); }
const read = (f) => readFileSync(join(dir, f), 'utf8');
const sha = (f) => createHash('sha256').update(readFileSync(join(dir, f))).digest('hex');
const hex = (s) => s.replace(/[^0-9a-f]/gi, '').toLowerCase();

/** A hexadecimal field: `label = 0x…` or `label …` on one line, continued by indented lines that start with hex digits. */
function field(text, label, { from = 0, to = text.length } = {}) {
  const seg = text.slice(from, to), lines = seg.split('\n');
  const at = lines.findIndex((l) => new RegExp(`^\\s*${label}\\s*(?:=|:)?\\s*(?:0x)?[0-9a-f]*`, 'i').test(l) && l.trim().startsWith(label));
  if (at < 0) throw new Error(`field ${label} not found`);
  let h = '';
  const first = lines[at].trim().slice(label.length).replace(/^\s*[=:]?\s*(0x)?/i, '');
  const take = (s) => { const m = /^((?:[0-9a-f]{2}\s?)+)(?=\s{2,}\(|\s*$|\s*\()/i.exec(s.trim()); return m ? hex(m[1]) : ''; };
  h += take(first);
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!/^\s{6,}[0-9a-f]{2}/i.test(l) || /^\s*\w+\s*[=:]/.test(l)) break;
    h += take(l);
  }
  return h;
}
const between = (text, a, b) => { const i = text.lastIndexOf(a); const j = text.indexOf(b, i + a.length); if (i < 0 || j < 0) throw new Error(`section ${a}..${b}`); return text.slice(i, j); };

const out = { sources: {} };
for (const f of ['rfc5869.txt', 'rfc4231.txt', 'rfc7914.txt', 'rfc7748.txt', 'rfc9106.txt', 'slip21.md', 'bip39vec.json', 'gcmEncryptExtIV256.rsp']) out.sources[f] = { sha256: sha(f) };

// RFC 5869 appendix A.1 to A.3 (HKDF-SHA-256)
{
  const t = read('rfc5869.txt'); out.hkdf = [];
  for (const [n, a, b] of [[1, 'A.1.  Test Case 1', 'A.2.  Test Case 2'], [2, 'A.2.  Test Case 2', 'A.3.  Test Case 3'], [3, 'A.3.  Test Case 3', 'A.4.  Test Case 4']]) {
    const s = between(t, a, b);
    const f = (l) => { const m = new RegExp(`^\\s*${l}\\s*=\\s*(\\(0 octets\\)|0x)`, 'm').exec(s); return m && m[1] === '(0 octets)' ? '' : field(s, l); };
    out.hkdf.push({ source: `RFC 5869 appendix A.${n}`, ikm: f('IKM'), salt: f('salt'), info: f('info'), L: Number(/L\s*=\s*(\d+)/.exec(s)[1]), prk: f('PRK'), okm: f('OKM') });
  }
}
// RFC 4231 section 4.2 to 4.8 (HMAC-SHA-256 and HMAC-SHA-512)
{
  const t = read('rfc4231.txt'); out.hmac = [];
  const start = t.indexOf('4.2.  Test Case 1\n');
  const names = ['4.2.  Test Case 1', '4.3.  Test Case 2', '4.4.  Test Case 3', '4.5.  Test Case 4', '4.6.  Test Case 5', '4.7.  Test Case 6', '4.8.  Test Case 7', '5.  Security Considerations'];
  names.slice(0, -1).forEach((nm, i) => {
    const a = t.indexOf(nm + '\n', start), b = t.indexOf(names[i + 1] + '\n', a);
    const s = t.slice(a, b);
    out.hmac.push({ source: `RFC 4231 section ${nm.split('.  ')[0]}`, key: field(s, 'Key'), data: field(s, 'Data'), sha256: field(s, 'HMAC-SHA-256'), sha512: field(s, 'HMAC-SHA-512'), truncated: i === 4 });
  });
}
// RFC 7914 section 11 (PBKDF2-HMAC-SHA-256)
{
  const t = read('rfc7914.txt'); const s = between(t, '11.  Test Vectors for PBKDF2', '12.  Test Vectors for scrypt');
  const blocks = [...s.matchAll(/PBKDF2-HMAC-SHA-256 \(P="([^"]*)", S="([^"]*)",\s*c=(\d+), dkLen=(\d+)\) =\n((?:\s+(?:[0-9a-f]{2} ?)+\n)+)/g)];
  out.pbkdf2sha256 = blocks.map((m) => ({ source: 'RFC 7914 section 11', password: m[1], salt: m[2], iterations: Number(m[3]), dkLen: Number(m[4]), dk: hex(m[5]) }));
}
// RFC 7748 sections 5.2 and 6.1 (X25519)
{
  const t = read('rfc7748.txt'); out.x25519 = { source: 'RFC 7748', vectors: [], iterations: [], dh: {} };
  const s52 = between(t, '5.2.  Test Vectors', '   X448:\n\n');
  const re = /Input scalar:\n\s+([0-9a-f]{64})\n[\s\S]*?Input u-coordinate:\n\s+([0-9a-f]{64})\n[\s\S]*?Output u-coordinate:\n\s+([0-9a-f]{64})/g;
  for (const m of s52.matchAll(re)) out.x25519.vectors.push({ source: 'RFC 7748 section 5.2', scalar: m[1], u: m[2], out: m[3] });
  const it = t.slice(t.indexOf('For each iteration, set k'));
  out.x25519.iterations = [...it.matchAll(/After (one|[\d,]+) iterations?:\n\s+([0-9a-f]{64})\n/g)].map((m) => ({ n: m[1] === 'one' ? 1 : Number(m[1].replace(/,/g, '')), out: m[2] }));
  const s61 = between(t, '6.1.  Curve25519', '6.2.  Curve448');
  const g = (l) => new RegExp(`${l}[^\\n]*:\\n\\s+([0-9a-f]{64})`).exec(s61)[1];
  out.x25519.dh = { source: 'RFC 7748 section 6.1', a: g("Alice's private key"), A: g("Alice's public key"), b: g("Bob's private key"), B: g("Bob's public key"), K: g('Their shared secret') };
}
// RFC 9106 section 5.3 (Argon2id)
{
  const t = read('rfc9106.txt'); const s = between(t, '5.3.  Argon2id Test Vectors', '6.  IANA Considerations');
  const bytes = (label, next) => hex(between(s, label, next).slice(label.length));
  out.argon2id = { source: 'RFC 9106 section 5.3', memoryKiB: 32, passes: 3, parallelism: 4, tagLength: 32, version: 19,
    password: bytes('Password[32]:', 'Salt[16]:'), salt: bytes('Salt[16]:', 'Secret[8]:'), secret: bytes('Secret[8]:', 'Associated data[12]:'), ad: bytes('Associated data[12]:', 'Pre-hashing digest:'),
    tag: hex(s.slice(s.lastIndexOf('Tag:') + 4).split('\n\n')[0].replace(/RFC 9106[^\n]*|Biryukov[^\n]*/g, '')) };
}
// SLIP-0021 test vectors
{
  const t = read('slip21.md');
  const k = (l) => new RegExp(`Key\\(${l}\\) = ([0-9a-f]{64})`).exec(t)[1];
  out.slip21 = { source: 'SLIP-0021 "Test vectors"', seed: /S = ([0-9a-f]{128})/.exec(t)[1], mnemonic: 'all all all all all all all all all all all all',
    master: k('m'), slip21: k('m/"SLIP-0021"'), encryption: k('m/"SLIP-0021"/"Master encryption key"'), authentication: k('m/"SLIP-0021"/"Authentication key"') };
}
// BIP-39 vectors of the Trezor reference implementation (passphrase "TREZOR")
{
  const j = JSON.parse(read('bip39vec.json'));
  out.bip39 = { source: 'trezor/python-mnemonic vectors.json (the BIP-39 reference vectors), passphrase TREZOR', passphrase: 'TREZOR', english: j.english.map(([entropy, mnemonic, seed]) => ({ entropy, mnemonic, seed })) };
}
// NIST CAVP GCM, AES-256, 96-bit IV, 128-bit tag: a spread of cases with and without plaintext and AAD
{
  const t = read('gcmEncryptExtIV256.rsp').replace(/\r\n/g, '\n'); const cases = []; let hdr = {};
  for (const block of t.split(/\n\n/)) {
    const h = /\[Keylen = (\d+)\]\s*\[IVlen = (\d+)\]\s*\[PTlen = (\d+)\]\s*\[AADlen = (\d+)\]\s*\[Taglen = (\d+)\]/.exec(block);
    if (h) { hdr = { ptlen: +h[3], aadlen: +h[4], ivlen: +h[2], taglen: +h[5] }; }
    const c = /Count = (\d+)\nKey = ([0-9a-f]+)\nIV = ([0-9a-f]+)\nPT = ([0-9a-f]*)\nAAD = ([0-9a-f]*)\nCT = ([0-9a-f]*)\nTag = ([0-9a-f]+)/.exec(block);
    if (c && hdr.ivlen === 96 && hdr.taglen === 128) cases.push({ ptBits: hdr.ptlen, aadBits: hdr.aadlen, count: +c[1], key: c[2], iv: c[3], pt: c[4], aad: c[5], ct: c[6], tag: c[7] });
  }
  const pick = [];
  const want = [[0, 0], [0, 128], [128, 0], [128, 128], [408, 160], [256, 384], [104, 720], [0, 720], [408, 720], [104, 160], [256, 0], [0, 384]];
  for (const [p, a] of want) { const c = cases.find((x) => x.ptBits === p && x.aadBits === a); if (c) pick.push(c); }
  out.aesgcm = { source: 'NIST CAVP GCM test vectors, gcmEncryptExtIV256.rsp (Keylen 256, IVlen 96, Taglen 128)', cases: pick };
}
process.stdout.write(JSON.stringify(out, null, 1) + '\n');
