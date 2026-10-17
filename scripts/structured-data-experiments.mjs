#!/usr/bin/env node
// Experiments behind docs/structured-data.md. Every number in that document comes from here.
//
//   node scripts/structured-data-experiments.mjs delimiters --pdfjs <dir with build/pdf.mjs>   candidate characters through a real PDF
//   node scripts/structured-data-experiments.mjs sizes                                       size inflation and token estimates per encoding
//   node scripts/structured-data-experiments.mjs visual <out-dir>                            renders a small sheet and a prose control
//
// `delimiters` and `visual` need Chrome and MuPDF (like cli/onepage.mjs). pdf.js 4.4.168 is what the site loads
// from cdnjs and is not vendored in this repository; `--pdfjs` points at an unpacked pdfjs-dist@4.4.168 package.
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { openSession } from '../cli/core.mjs';
import { makeOnePage } from '../cli/onepage-core.mjs';
import { canonicalText, pdfItemsText } from '../src/index.js';

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => { const i = rest.indexOf(name); return i < 0 ? null : rest[i + 1]; };

const mutoolText = (pdf) => spawnSync('mutool', ['draw', '-q', '-F', 'txt', '-o', '-', pdf], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout;

async function pdfjsText(pdf, dir) {
  const pdfjs = await import(pathToFileURL(join(dir, 'build/pdf.mjs')).href);
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(join(dir, 'build/pdf.worker.mjs')).href;
  const { readFileSync } = await import('node:fs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(pdf)), disableFontFace: true, verbosity: 0 }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) pages.push((await (await doc.getPage(p)).getTextContent()).items);
  return pdfItemsText(pages);
}

// ---- delimiters ----------------------------------------------------------------------------------------------
const cp = (n) => String.fromCodePoint(n);
const CANDIDATES = [
  ['|', 'U+007C VERTICAL LINE'], [cp(0xa6), 'U+00A6 BROKEN BAR'], [cp(0x2016), 'U+2016 DOUBLE VERTICAL LINE'],
  [cp(0xb6), 'U+00B6 PILCROW'], [';', 'U+003B SEMICOLON'], [',', 'U+002C COMMA'], [cp(0x23ce), 'U+23CE RETURN SYMBOL'],
  [cp(0x241e), 'U+241E SYMBOL FOR RECORD SEPARATOR'], [cp(0x241f), 'U+241F SYMBOL FOR UNIT SEPARATOR'],
  [cp(0x240a), 'U+240A SYMBOL FOR LINE FEED'], [cp(0x2063), 'U+2063 INVISIBLE SEPARATOR'], [cp(0x2064), 'U+2064 INVISIBLE PLUS'],
  [cp(0x1e), 'U+001E RECORD SEPARATOR'], [cp(0x1f), 'U+001F UNIT SEPARATOR'], [cp(0x200b), 'U+200B ZERO WIDTH SPACE'],
  [cp(0x2028), 'U+2028 LINE SEPARATOR'], [cp(0x85), 'U+0085 NEXT LINE'], [cp(0xa0), 'U+00A0 NO-BREAK SPACE'],
  [cp(0xb7), 'U+00B7 MIDDLE DOT'], [cp(0x2022), 'U+2022 BULLET'], [cp(0xa7), 'U+00A7 SECTION SIGN'], [cp(0xa4), 'U+00A4 CURRENCY SIGN'],
  [cp(0xac), 'U+00AC NOT SIGN'], [cp(0x2192), 'U+2192 RIGHTWARDS ARROW'], [cp(0x21b5), 'U+21B5 DOWNWARDS ARROW WITH CORNER LEFTWARDS'],
  [cp(0x25aa), 'U+25AA BLACK SMALL SQUARE'], [cp(0x2219), 'U+2219 BULLET OPERATOR'], [cp(0x2502), 'U+2502 BOX DRAWINGS LIGHT VERTICAL'],
  ['~', 'U+007E TILDE'], ['^', 'U+005E CIRCUMFLEX'], ['`', 'U+0060 GRAVE'], ['\\', 'U+005C BACKSLASH'], ['"', 'U+0022 QUOTATION MARK'],
  ["'", 'U+0027 APOSTROPHE'], ['{', 'U+007B BRACE'], ['}', 'U+007D BRACE'], ['[', 'U+005B BRACKET'], [']', 'U+005D BRACKET'],
  ['<', 'U+003C LESS-THAN'], ['>', 'U+003E GREATER-THAN'], ['&', 'U+0026 AMPERSAND'], [':', 'U+003A COLON'], ['/', 'U+002F SOLIDUS'],
  ['#', 'U+0023 NUMBER SIGN'], ['=', 'U+003D EQUALS'], ['_', 'U+005F LOW LINE'], ['-', 'U+002D HYPHEN-MINUS'], ['.', 'U+002E FULL STOP'],
  ['­', 'U+00AD SOFT HYPHEN'], [cp(0x2e), 'U+002E (control)'],
].filter(([c, n], i, a) => !n.includes('(control)') && a.findIndex((x) => x[0] === c) === i);

function segmentFor(n, c, reps = 24) {
  // The character in every position data uses it: between words, before and after a space, doubled, alone.
  const unit = (i) => `ab${i}${c}cd${i} ef${c} ${c}gh ${c}${c} ij ${c} `;
  return `SEG${n}x ` + Array.from({ length: reps }, (_, i) => unit(i)).join('') + `END${n}x `;
}

async function delimiters() {
  const dir = flag('--pdfjs');
  if (!dir) throw new Error('--pdfjs <dir> is needed (unpacked pdfjs-dist@4.4.168)');
  const work = mkdtempSync(join(tmpdir(), 'sd-delim-'));
  const session = await openSession();
  const rows = [];
  const TITLES = ['Data', 'Zebra Mix'];
  try {
    for (const [i, [c, name]] of CANDIDATES.entries()) {
      const text = segmentFor(i, c, 60);
      const src = canonicalText(text);
      const row = {
        char: [...c].map((x) => 'U+' + x.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' '), name,
        survivesCanonicalText: src === text.replace(/\s+/g, ' ').trim(), pipelineGate: 0, mupdf: 0, pdfjs: 0, runs: TITLES.length,
      };
      for (const title of TITLES) {
        const pdf = join(work, `d${i}.pdf`);
        try { await makeOnePage(session, { text, title, paper: 'a4', pdf }); } catch (e) { row.error = e.message.slice(0, 70); continue; }
        row.pipelineGate++;
        if (canonicalText(mutoolText(pdf)) === src) row.mupdf++;
        if (canonicalText(await pdfjsText(pdf, dir)) === src) row.pdfjs++;
      }
      rows.push(row);
      process.stderr.write(`${row.char} ${row.mupdf}/${row.pdfjs}\n`);
    }
  } finally { await session.close(); }
  console.log(JSON.stringify(rows, null, 1));
}

// ---- spaces: does a plain space survive next to characters that come from a fallback font? -------------------
async function spaces() {
  const dir = flag('--pdfjs');
  const work = mkdtempSync(join(tmpdir(), 'sd-space-'));
  const session = await openSession();
  const PATTERNS = {
    latin: 'Zurich Bern Basel', accents: 'Zürich Genève Köln', cjk: 'Tokyo 東京 Osaka 大阪 Kyoto', emoji: 'ok 😀 fine 🚀 done', cyrillic: 'Москва Санкт Петербург',
    arrow: 'a → b → c', box: 'a │ b │ c', hebrew: 'Tel שלום Aviv', middot: 'a·b·c d·e·f',
  };
  const rows = [];
  try {
    for (const [name, p] of Object.entries(PATTERNS)) {
      const text = Array.from({ length: 80 }, (_, i) => `${p} ${i}`).join(' ');
      const pdf = join(work, `s-${name}.pdf`);
      await makeOnePage(session, { text, title: 'Data', paper: 'a4', pdf });
      const want = canonicalText(text);
      const mu = canonicalText(mutoolText(pdf)), pj = dir ? canonicalText(await pdfjsText(pdf, dir)) : null;
      const diff = (a) => { if (a === want) return 'exact'; const strip = (t) => t.replace(/\s/g, ''); return strip(a) === strip(want) ? 'spaces differ' : 'text differs'; };
      rows.push({ pattern: name, mupdf: diff(mu), pdfjs: pj == null ? 'n/a' : diff(pj) });
    }
  } finally { await session.close(); }
  console.log(JSON.stringify(rows, null, 1));
}

// ---- scripts: which Unicode blocks survive a PDF round trip character for character? -----------------------
const BLOCKS = [
  ['Basic Latin', 0x21, 0x7e], ['Latin-1', 0xa1, 0xff], ['Latin Extended-A', 0x100, 0x17f], ['Latin Extended-B', 0x180, 0x24f],
  ['Latin Extended Additional (Vietnamese)', 0x1e00, 0x1eff], ['Greek', 0x370, 0x3ff], ['Cyrillic', 0x400, 0x4ff], ['Hebrew', 0x5d0, 0x5ea],
  ['Arabic', 0x620, 0x64a], ['Devanagari', 0x904, 0x939], ['Thai', 0xe01, 0xe3a], ['Hangul Syllables (sample)', 0xac00, 0xac00 + 400],
  ['Hiragana', 0x3041, 0x3096], ['Katakana', 0x30a1, 0x30fa], ['CJK Unified (sample)', 0x4e00, 0x4e00 + 800],
  ['General Punctuation', 0x2010, 0x205e], ['Currency Symbols', 0x20a0, 0x20bf], ['Letterlike Symbols', 0x2100, 0x214f],
  ['Number Forms', 0x2150, 0x218f], ['Arrows', 0x2190, 0x21ff], ['Mathematical Operators', 0x2200, 0x22ff], ['Box Drawing', 0x2500, 0x257f],
  ['Geometric Shapes', 0x25a0, 0x25ff], ['Misc Symbols', 0x2600, 0x26ff], ['Dingbats', 0x2700, 0x27bf], ['Emoji (Misc Symbols and Pictographs)', 0x1f300, 0x1f5ff],
  ['Emoji (Emoticons)', 0x1f600, 0x1f64f], ['Control Pictures', 0x2400, 0x2426], ['CJK Unified (all)', 0x4e00, 0x9fff], ['Hangul Syllables (all)', 0xac00, 0xd7a3], ['CJK Symbols and Punctuation', 0x3001, 0x303f], ['Fullwidth Forms', 0xff01, 0xff5e], ['Emoji (Transport and Map)', 0x1f680, 0x1f6ff], ['Emoji (Supplemental Symbols)', 0x1f900, 0x1f9ff], ['Misc Technical', 0x2300, 0x23ff], ['IPA Extensions', 0x250, 0x2af],
];
const NOT_SAFE = /[\p{Emoji_Modifier}\p{White_Space}\p{Default_Ignorable_Code_Point}\p{C}\p{M}"\\·]/u;
async function scripts() {
  const dir = flag('--pdfjs');
  const work = mkdtempSync(join(tmpdir(), 'sd-scripts-'));
  const session = await openSession();
  const strip = (t) => t.normalize('NFC').replace(/[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}]/gu, '');
  const rows = [];
  try {
    for (const [name, lo, hi] of BLOCKS.filter(([n]) => !flag('--only') || new RegExp(flag('--only')).test(n))) {
      const chars = [];
      for (let c = lo; c <= hi; c++) {
        const ch = String.fromCodePoint(c);
        if (/[\p{L}\p{N}\p{P}\p{S}]/u.test(ch) && !NOT_SAFE.test(ch) && ch.normalize('NFC') === ch) chars.push(ch);
      }
      const chunks = [];
      for (let i = 0; i < chars.length; i += 1) chunks.push(chars.slice(i, i + 1).join(''));
      const text = chunks.map((c, i) => `Q${i}x ${c} y${i}q`).join(' ');
      const pdf = join(work, 'b.pdf');
      try { await makeOnePage(session, { text, title: 'Data', paper: 'a4', pdf }); } catch (e) { rows.push({ block: name, chars: chars.length, error: e.message.slice(0, 60) }); continue; }
      const out = {}, failing = {};
      for (const [k, got] of [['mupdf', strip(mutoolText(pdf))], ['pdfjs', dir ? strip(await pdfjsText(pdf, dir)) : null]]) {
        if (got == null) continue;
        failing[k] = [];
        chunks.forEach((c, i) => {
          const a = got.indexOf(`Q${i}x`), b = got.indexOf(`y${i}q`);
          if (!(a >= 0 && b > a && got.slice(a + `Q${i}x`.length, b) === c)) failing[k].push(c.codePointAt(0).toString(16));
        });
        out[k] = `${chars.length - failing[k].length}/${chars.length}`;
      }
      rows.push({ block: name, chars: chars.length, ...out, failing });
      process.stderr.write(JSON.stringify(rows.at(-1)) + '\n');
    }
  } finally { await session.close(); }
  console.log(JSON.stringify(rows, null, 1));
}

// ---- tokens: how long can a space-free run be before the layout breaks it? -----------------------------------
async function tokens() {
  const work = mkdtempSync(join(tmpdir(), 'sd-tok-'));
  const session = await openSession();
  const rnd = (() => { let x = 12345; return () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  const word = (n) => Array.from({ length: n }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(rnd() * 36)]).join('');
  const rows = [];
  try {
    for (const N of [150, 400, 1000, 3000, 10000, 40000]) {
      for (const T of [8, 12, 16, 20, 24, 32, 48, 64]) {
        if (T * 3 > N) continue;
        let text = '';
        while (text.length < N) text += word(T) + ' ';
        text = text.trim();
        const pdf = join(work, 't.pdf');
        const r = await makeOnePage(session, { text, title: 'Data', paper: 'a4', pdf });
        const back = mutoolText(pdf).split('\n').map((l) => l.trim()).filter(Boolean);
        const lens = back.slice(0, -1).map((l) => l.length);
        rows.push({ N: text.length, T, lines: r.lines, charsPerLine: +(r.characters / r.lines).toFixed(1), shortestLine: Math.min(...lens), exact: r.check.exact });
        process.stderr.write(JSON.stringify(rows.at(-1)) + '\n');
      }
    }
  } finally { await session.close(); }
  console.log(JSON.stringify(rows));
}

// ---- sizes ---------------------------------------------------------------------------------------------------
async function sizes() {
  const { sizeStudy } = await import('./structured-data-sizes.mjs');
  await sizeStudy();
}

// ---- visual --------------------------------------------------------------------------------------------------
async function visual() {
  const out = rest[0];
  if (!out) throw new Error('usage: visual <out-dir>');
  mkdirSync(out, { recursive: true });
  const { visualStudy } = await import('./structured-data-sizes.mjs');
  const session = await openSession();
  try { await visualStudy(session, out, makeOnePage); } finally { await session.close(); }
}

({ delimiters, scripts, spaces, tokens, sizes, visual }[cmd] || (() => { console.error('usage: delimiters | spaces | tokens | sizes | visual'); process.exit(1); }))().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
writeFileSync; // (kept for scripts that extend this file)
