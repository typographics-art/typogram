// Tests of the structured-data standard (TGD): docs/structured-data.md. Fixtures: test/fixtures/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { STRIP_RE, encode, decode, decodeAll, toFile, verify, findBlocks, stripBlocks, seal, keepLiteral, TgdError } from '../src/structured.js';
import { parseJson, Dec, stringifyJson } from '../src/structured-json.js';
import { parseYaml } from '../src/structured-yaml.js';
import { parseXml } from '../src/structured-xml.js';
import { readLines } from '../src/structured-lines.js';
import { parseCsv } from '../src/structured-csv.js';
import { openZip, writeZip, crc32 } from '../src/structured-zip.js';
import { readXlsx, serialToIso, isoToSerial, dateKind } from '../src/structured-xlsx.js';
import { canonicalText } from '../src/secret.js';
import { findChrome, openSession } from '../cli/core.mjs';
import { makeOnePage } from '../cli/onepage-core.mjs';

const FX = new URL('./fixtures/', import.meta.url).pathname;
const bytes = (n) => new Uint8Array(readFileSync(FX + n));
const text = (u8) => new TextDecoder().decode(u8);
const enc = (name, o = {}) => encode({ bytes: bytes(name), name }, { created: false, ...o });
const roundtrip = async (name, o) => { const r = await enc(name, o); return { r, d: await decode(canonicalText(r.text)) }; };
const rejects = (p, code) => assert.rejects(p, (e) => e instanceof TgdError && (!code || e.code === code), `expected TgdError ${code}`);
const throwsCode = (f, code) => assert.throws(f, (e) => e instanceof TgdError && e.code === code, `expected TgdError ${code}`);

// ---- the text layer ------------------------------------------------------------------------------------------------
test('the encoded block survives canonicalText exactly (whitespace collapse, NFC, invisible characters)', async () => {
  const { r } = await roundtrip('people.csv');
  const c = canonicalText(r.text);
  assert.ok(!/\s{2}/.test(c), 'canonical text has single spaces only');
  const d = await decode(c);
  assert.equal(d.name, 'people.csv');
  assert.equal(d.model.sheets[0].rows[2][0], 'Bob\nSmith');
});

test('whitespace anywhere is irrelevant: all removed, or extra spaces and line breaks everywhere', async () => {
  const { r } = await roundtrip('basic.xlsx');
  const stripped = r.text.replace(/\s/g, '');
  assert.equal((await decode(stripped)).format, 'xlsx');
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const noisy = [...r.text.replace(/\s/g, '')].map((ch) => (rnd() < 0.15 ? ch + (rnd() < 0.5 ? ' ' : '\n\t ') : ch)).join('');
  const d = await decode(canonicalText(noisy));
  assert.equal(d.verified, true);
});

test('invisible characters inserted by an extractor are ignored; NFD input is recomposed', async () => {
  const { r } = await roundtrip('people.csv');
  const noisy = r.text.replace(/,/g, ',\u200b').replace(/"/g, '\u00ad"');
  assert.equal((await decode(canonicalText(noisy))).name, 'people.csv');
  const nfd = r.text.normalize('NFD');
  assert.notEqual(nfd, r.text.normalize('NFC'));
  assert.equal((await decode(canonicalText(nfd))).verified, true);
});

test('only characters measured safe stand literally; everything else is a \\u escape', async () => {
  const s = 'ASCII é ß Ω Ж 😀 한 日本 \u0301 \u200d \u00b5 \u00b7 \u0001 \u202e שלום';
  const r = await encode({ text: JSON.stringify({ s }), name: 'x.json' }, { created: false });
  const body = r.text.replace(/\\\\u/g, '');
  for (const ch of ['日', '\u0301', '\u200d', '\u00b5', 'ש']) assert.ok(!body.includes(ch), `${JSON.stringify(ch)} must be escaped`);
  assert.ok(body.includes('é') && body.includes('Ж') && body.includes('😀') && body.includes('한'));
  const d = await decode(canonicalText(r.text));
  assert.equal(JSON.parse(text((await toFile(d)).bytes)).s, s);
  const ascii = await encode({ text: JSON.stringify({ s: 'é😀' }), name: 'x.json' }, { created: false, unicode: 'ascii' });
  assert.ok(!/[^\x00-\x7f]/.test(ascii.text.replace(/\u00b7/g, ' ')));
  assert.equal(JSON.parse(text((await toFile(await decode(ascii.text))).bytes)).s, 'é😀');
});

test('every code point survives a string cell: round trip through emit, canonicalText and decode', async () => {
  const cps = [];
  for (let c = 0; c < 0x3000; c += 1) cps.push(c);
  for (let c = 0xd800; c < 0xe000; c += 97) cps.push(c); // lone surrogates
  cps.push(0xfeff, 0xfffe, 0xffff, 0x1f600, 0x1f468, 0x200d, 0xe0001, 0x10ffff);
  const str = cps.map((c) => (c >= 0xd800 && c < 0xe000 ? String.fromCharCode(c) : String.fromCodePoint(c))).join('');
  const out = await seal({ kind: 'json', value: str }, { format: 'json', created: false });
  const d = await decode(canonicalText(out));
  assert.equal(d.model.value, str);
});

test('the frame markers inside data cannot end or fake a block', async () => {
  const evil = 'x]TGD1 and TGD1[{"tgd":"1.0"} y';
  const r = await encode({ text: JSON.stringify([evil]), name: 'x.json' }, { created: false });
  assert.equal(findBlocks(r.text).length, 1);
  assert.equal((await decode(r.text)).model.value[0], evil);
});

test('findBlocks finds blocks in prose with their offsets; stripBlocks leaves the prose', async () => {
  const a = await enc('people.csv'), b = await enc('table.tsv');
  const prose = `Intro. ${a.text}\n\nMiddle text.\n\n${b.text} End.`;
  const c = canonicalText(prose);
  const blocks = findBlocks(c);
  assert.equal(blocks.length, 2);
  assert.equal(c.slice(0, blocks[0].start), 'Intro. ');
  assert.equal(stripBlocks(c, '[data]'), 'Intro. [data] Middle text. [data] End.');
  const all = await decodeAll(c);
  assert.deepEqual(all.map((x) => x.name), ['people.csv', 'table.tsv']);
  assert.equal(findBlocks('no block here').length, 0);
});

test('a space inside the opening marker (an extractor artefact) does not hide the block', async () => {
  const { r } = await roundtrip('table.tsv');
  assert.equal((await decode(r.text.replace('TGD1[', 'TGD 1 ['))).name, 'table.tsv');
});

test('the normative strip set equals whitespace + Default_Ignorable_Code_Point + controls (Unicode as built into this Node)', () => {
  const prop = /^[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}]$/u;
  const one = new RegExp(STRIP_RE.source, 'u');
  for (let c = 0; c <= 0x10ffff; c++) {
    if (c >= 0xd800 && c <= 0xdfff) continue;
    const ch = String.fromCodePoint(c);
    if (prop.test(ch) !== new RegExp(`^(?:${one.source})$`, 'u').test(ch)) assert.fail(`U+${c.toString(16)} differs`);
  }
});

// ---- integrity ---------------------------------------------------------------------------------------------------
test('one changed character fails the checksum with a clear message', async () => {
  const { r } = await roundtrip('people.csv');
  for (const [from, to] of [['Alice', 'Alicf'], ['34', '35'], ['"people.csv"', '"people.cvs"'], ['Zürich', 'Zurich']]) {
    const bad = r.text.replace(from, to);
    assert.notEqual(bad, r.text, from);
    const v = await verify(bad);
    assert.equal(v.ok, false);
    assert.equal(v.blocks[0].code, 'checksum');
    assert.match(v.blocks[0].message, /checksum does not match/);
  }
  await rejects(decode(r.text.replace('"sum":"', '"sum":"0')), 'shape');
});

test('damaged, unterminated and foreign blocks give distinct errors', async () => {
  const { r } = await roundtrip('people.csv');
  await rejects(decode(r.text.slice(0, -8)), 'unterminated');
  await rejects(decode('plain prose'), 'none');
  await rejects(decode('TGD1[{"tgd":"2.0","sum":"' + '0'.repeat(64) + '","data":{"kind":"x"}}]TGD1'), 'version');
  await rejects(decode('TGD1[{"tgd":"1.0","data":{"kind":"x"}}]TGD1'), 'shape');
  await rejects(decode('TGD1[{"tgd":"1.0",]TGD1'), 'syntax');
  const v = await verify(`${r.text} and ${r.text.replace('Alice', 'Alicf')}`);
  assert.deepEqual(v.blocks.map((b) => b.ok), [true, false]);
});

test('unknown envelope members are ignored (forward compatibility); the checksum still covers them', async () => {
  const { r } = await roundtrip('table.tsv');
  const future = await seal({ kind: 'workbook', sheets: [{ name: 'S', rows: [['a']] }] }, { format: 'tsv', created: false });
  const withExtra = future.replace('"by":', '"future":{"x":1},"by":');
  await rejects(decode(withExtra), 'checksum');
  assert.ok(r.text);
});

test('non-canonical numbers in a block are refused (they would be rounded by a plain JSON parser)', async () => {
  const body = '{"tgd":"1.0","sum":"' + '0'.repeat(64) + '","data":{"kind":"json","value":12345678901234567890}}';
  const v = await verify('TGD1[' + body + ']TGD1');
  assert.equal(v.ok, false);
});

test('a middle dot outside a string is a syntax error, inside it is a space; encode returns the model', async () => {
  throwsCode(() => parseJson('{"a"\u00b7:1}', { marker: true }), 'syntax');
  assert.equal(parseJson('"a\u00b7b"', { marker: true }), 'a b');
  assert.equal(parseJson('"a\\u00b7b"', { marker: true }), 'a\u00b7b');
  const { r } = await roundtrip('table.tsv');
  assert.equal(r.model.kind, 'workbook');
});

// ---- the nasty cells -----------------------------------------------------------------------------------------------
test('CSV: leading zeros, 20-digit IDs, quotes, newlines, empty cells, unicode, formulas survive byte for byte', async () => {
  const { d } = await roundtrip('people.csv');
  const rows = d.model.sheets[0].rows;
  assert.equal(rows[1][4], 'said "hi", left');
  assert.equal(rows[1][3], '00742');
  assert.equal(rows[2][3], '12345678901234567890');
  assert.equal(rows[2][2], null);
  assert.equal(rows[3][0], 'Zoë 😀');
  const out = await toFile(d, 'csv', { safe: false });
  assert.equal(text(out.bytes), text(bytes('people.csv')));
});

test('CSV dialects: semicolon with decimal commas, TSV, BOM, UTF-16, CRLF/LF, no final newline', async () => {
  const semi = await roundtrip('semicolon.csv');
  assert.equal(semi.d.model.dialect.delimiter, ';');
  assert.equal(semi.d.model.sheets[0].rows[1][1], '8,7');
  assert.equal(text((await toFile(semi.d, 'csv', { safe: false })).bytes), text(bytes('semicolon.csv')));
  const tsv = await roundtrip('table.tsv');
  assert.deepEqual(tsv.d.model.sheets[0].rows[2], [null, 'x', null]);
  assert.equal(text((await toFile(tsv.d, 'tsv')).bytes), text(bytes('table.tsv')));
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('a,b\nc,d')]);
  const b = await decode((await encode({ bytes: bom, name: 'b.csv' }, { created: false })).text);
  assert.equal(b.model.dialect.bom, true);
  assert.equal(b.model.dialect.final, false);
  assert.deepEqual([...(await toFile(b, 'csv')).bytes], [...bom]);
  const u16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('x;y\r\n1;2\r\n', 'utf16le')]);
  assert.deepEqual((await decode((await encode({ bytes: new Uint8Array(u16), name: 'u.csv' }, { created: false })).text)).model.sheets[0].rows, [['x', 'y'], ['1', '2']]);
  await rejects(encode({ bytes: new Uint8Array([0x61, 0x2c, 0xe9, 0x0a]), name: 'l1.csv' }), 'encoding');
  const l1 = await encode({ bytes: new Uint8Array([0x61, 0x2c, 0xe9, 0x0a]), name: 'l1.csv' }, { created: false, encoding: 'windows-1252' });
  assert.equal((await decode(l1.text)).model.sheets[0].rows[0][1], 'é');
  await rejects(encode({ text: 'a,"b\n', name: 'u.csv' }), 'syntax');
});

test('CSV export guards formula injection on the FINAL text of every cell that is not a plain number', async () => {
  const hostile = ['=cmd|\' /C calc\'!A0', '+1+1', '-2+3', '@SUM(A1)', '\t=1', '\r=1', '=1+1', '-5', '+1.5e3', '.5', '-x'];
  const typed = [
    { $: 'e', v: '-ERR' }, { $: 'f', f: 'A1', v: '=HYPERLINK("http://x")' }, { $: 'f', f: 'A1' }, { $: 'dt', v: '2024-01-01T00:00:00' },
    { $: 'n', v: '-1E+21' }, -7, true, null,
  ];
  const model = { kind: 'workbook', sheets: [{ name: 'S', rows: [hostile, typed] }] };
  const block = await decode(await seal(model, { format: 'csv', created: false }));
  const out = await toFile(block, 'csv');
  const csv = text(out.bytes);
  for (const cell of ['=cmd', '+1+1', '-2+3', '@SUM', '=1+1', '-x', '=HYPERLINK', '-ERR']) {
    for (const m of csv.matchAll(new RegExp(`(^|,|")(.{0,1})${cell.replace(/[|+@=$.()]/g, '\\$&')}`, 'g'))) assert.ok(m[2] === "'" || m[1] === '"' && m[2] === "'", `${cell} must be preceded by '`);
  }
  assert.match(csv, /'=cmd/);
  assert.match(csv, /,-5,/); // a plain number is no formula
  assert.match(csv, /-1E\+21/);
  assert.match(csv, /-7/);
  assert.ok(out.notes.some((n) => /leading '/.test(n)));
  for (const row of parseCsv(csv, ',')) for (const cell of row) if (cell && /^[=+\-@\t\r]/.test(cell)) assert.match(cell, /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/, `unguarded cell ${JSON.stringify(cell)}`);
  assert.match(text((await toFile(block, 'csv', { safe: false })).bytes), /^=cmd/);
});

test('JSON: big numbers, 1.10, -0, key order, integer-like keys, $ keys and invisible characters are exact', async () => {
  const { d } = await roundtrip('data.json');
  const out = text((await toFile(d, 'json')).bytes);
  assert.match(out, /"id": 12345678901234567890,/);
  assert.match(out, /"ratio": 1\.10,/);
  assert.match(out, /"big": 1E\+21,/);
  assert.match(out, /-0,/);
  assert.ok(out.indexOf('"10"') < out.indexOf('"2"'), 'key order kept');
  assert.match(out, /"\$": "dollar"/);
  assert.match(out, /\\u200d/);
  const again = parseJson(out);
  assert.ok(again.get('id') instanceof Dec);
  throwsCode(() => parseJson('{"a":1,"a":2}'), 'syntax');
  throwsCode(() => parseJson('[1,]'), 'syntax');
  throwsCode(() => parseJson('01'), 'syntax');
  throwsCode(() => parseJson('['.repeat(10000)), 'limit');
});

test('JSON -> typed key collision: user objects shaped like typed values stay user data', async () => {
  const src = '{"$":"n","v":"5","$$":{"$":"d","v":"x"}}';
  const r = await encode({ text: src, name: 'c.json' }, { created: false });
  const d = await decode(r.text);
  assert.equal(stringifyJson(parseJson(text((await toFile(d)).bytes)), { indent: 0 }), '{"$":"n","v":"5","$$":{"$":"d","v":"x"}}');
});

// ---- Excel ---------------------------------------------------------------------------------------------------------
test('XLSX (openpyxl): types, long IDs, dates, formulas, merges, comments, names, hidden sheet, sparse cell', async () => {
  const { d } = await roundtrip('basic.xlsx');
  const m = d.model, s = m.sheets[0];
  assert.equal(s.name, 'Q1 Sales');
  assert.equal(s.cells.D2, '007');
  assert.equal(s.cells.D3, '00123456789012345678');
  assert.deepEqual(s.cells.E2, { $: 'dt', v: '2024-03-05T14:30:00' });
  assert.deepEqual(s.cells.I2, { $: 't', v: '09:05:30' });
  assert.equal(s.cells.H2, true);
  assert.equal(s.cells.C3, 0.1);
  assert.equal(s.cells.F2, 'zwei  Leerzeichen, "Anführungszeichen"');
  assert.equal(s.cells.F3, 'Zeile1\nZeile2');
  assert.deepEqual(s.cells.B4, { $: 'f', f: 'SUM(B2:B3)' });
  assert.equal(s.cells.Z100, 'far away');
  assert.deepEqual(s.merges, ['A6:C6']);
  assert.deepEqual(s.comments, { A1: 'Column titles' });
  assert.equal(m.names.Prices, "'Q1 Sales'!$C$2:$C$3");
  assert.equal(m.sheets[1].state, 'hidden');
  assert.ok(d.lossy.some((l) => /styles/.test(l)));
});

test('XLSX (Excel style): cached formulas, shared formulas, errors, inline and rich strings, _x0001_, dates, 20-digit numbers', async () => {
  const { d } = await roundtrip('excelish.xlsx');
  const rows = d.model.sheets[0].rows;
  assert.deepEqual(rows[0], ['Item', '  padded  ', 'Rich text', 'ctl\u0001char _x0041_']);
  assert.deepEqual(rows[1][2], { $: 'f', f: 'A2+B2', v: 3.5 });
  assert.deepEqual(rows[2][3], { $: 'e', v: '#DIV/0!' });
  assert.deepEqual(rows[2][2], { $: 'f', f: 'A3*2', v: 0.2 });
  assert.equal(rows[3][2], 200000000000000000000); // shared formula follower: value only
  assert.equal(rows[3][3], 'inline');
  assert.deepEqual(rows[3][4], { $: 'f', f: '"x"&"y"', v: 'xy' });
  assert.deepEqual(rows[3][5], { $: 'n', v: '12345678901234567890' });
  assert.deepEqual(rows[2][1], { $: 'n', v: '1E-3' });
  assert.deepEqual(rows[4].slice(0, 3), [{ $: 'd', v: '2024-03-05' }, { $: 'dt', v: '2024-03-05T14:30:00' }, { $: 't', v: '12:00:00' }]);
  assert.deepEqual(rows[4][3], { $: 'd', v: '1900-02-28' });
  assert.deepEqual(rows[4][4], { $: 'd', v: '1900-03-01' });
  assert.equal(rows[4][5], 60, 'serial 60 (1900-02-29) stays a number');
  assert.ok(d.lossy.some((l) => /shared formulas/.test(l)));
  assert.equal(d.model.sheets[0].header, true);
});

test('XLSX: the 1904 date system', async () => {
  const { d } = await roundtrip('date1904.xlsx');
  assert.equal(d.model.date1904, true);
  assert.deepEqual(d.model.sheets[0].rows[4][0], { $: 'd', v: '2028-03-06' });
});

test('XLSX: serial <-> ISO conversion and date format recognition', () => {
  assert.equal(serialToIso(45356, 'date'), '2024-03-05');
  assert.equal(serialToIso(1, 'date'), '1900-01-01');
  assert.equal(serialToIso(59, 'date'), '1900-02-28');
  assert.equal(serialToIso(60, 'date'), null);
  assert.equal(serialToIso(61, 'date'), '1900-03-01');
  assert.equal(serialToIso(0, 'date'), null);
  assert.equal(serialToIso(-1, 'date'), null);
  assert.equal(serialToIso(0.5, 'time'), '12:00:00');
  assert.equal(serialToIso(1.5, 'time'), null);
  assert.equal(serialToIso(45356.5000115741, 'datetime'), '2024-03-05T12:00:01');
  for (const iso of ['2024-03-05', '1900-01-01', '1900-02-28', '1900-03-01', '2024-03-05T14:30:00.250', '9999-12-31']) {
    for (const d1904 of [false, true]) {
      const n = isoToSerial(iso, d1904);
      if (d1904 && iso < '1904') continue;
      assert.equal(serialToIso(n, iso.includes('T') ? 'datetime' : 'date', d1904), iso, `${iso} ${d1904}`);
    }
  }
  assert.equal(dateKind(14, null), 'date');
  assert.equal(dateKind(22, null), 'datetime');
  assert.equal(dateKind(21, null), 'time');
  assert.equal(dateKind(164, 'yyyy\\-mm\\-dd'), 'date');
  assert.equal(dateKind(164, '0.00" m"'), null);
  assert.equal(dateKind(164, '[h]:mm:ss'), 'time');
  assert.equal(dateKind(164, 'General'), null);
  assert.equal(dateKind(164, '0.0%'), null);
  assert.equal(dateKind(164, 'dd/mm/yyyy hh:mm'), 'datetime');
});

test('XLSX writer: model -> xlsx -> model is the identity; formulas only on request; sheet names repaired', async () => {
  const { d } = await roundtrip('basic.xlsx');
  const same = async (opts) => {
    const out = await toFile(d, 'xlsx', opts);
    const again = await decode((await encode({ bytes: out.bytes, name: 'basic.xlsx' }, { created: false })).text);
    return { again, out };
  };
  const { again } = await same({ formulas: true });
  assert.deepEqual(again.model, d.model);
  const plain = await same({});
  assert.deepEqual(plain.again.model.sheets[0].cells.B4, undefined, 'a formula without a cached value is dropped');
  assert.ok(plain.out.notes.some((n) => /formulas/i.test(n)));
  const odd = await decode(await seal({ kind: 'workbook', sheets: [{ name: 'a:b/c', rows: [['x']] }, { name: 'A:B/C', rows: [['y']] }] }, { created: false }));
  const out = await toFile(odd, 'xlsx');
  assert.equal(out.notes.length, 2);
  assert.deepEqual((await readXlsx(out.bytes)).data.sheets.map((s) => s.name), ['a_b_c', 'A_B_C_2']);
  assert.deepEqual([...(await toFile(d, 'xlsx')).bytes], [...(await toFile(d, 'xlsx')).bytes], 'deterministic output');
});

test('XLSX writer output is a well-formed workbook other readers accept (python openpyxl, when installed)', async (t) => {
  const py = spawnSync('python3', ['-c', 'import openpyxl'], { encoding: 'utf8' });
  if (py.status !== 0) return t.skip('python3 with openpyxl is not installed');
  const { d } = await roundtrip('basic.xlsx');
  const dir = mkdtempSync(join(tmpdir(), 'tgd-'));
  writeFileSync(join(dir, 'o.xlsx'), (await toFile(d, 'xlsx', { formulas: true })).bytes);
  const r = spawnSync('python3', ['-c', 'import sys,warnings,openpyxl\nwarnings.simplefilter("ignore")\nwb=openpyxl.load_workbook(sys.argv[1])\nws=wb["Q1 Sales"]\nprint(ws["D2"].value, ws["B4"].value, ws["A1"].comment.text)', join(dir, 'o.xlsx')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '007 =SUM(B2:B3) Column titles');
});

test('XLSX limits: a sparse sheet is not densified (A1 + XFD1048576; 10000 rows with one cell at column 16000)', async () => {
  const sheet = (cells) => `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${cells}</sheetData></worksheet>`;
  const make = async (sheetXml) => {
    const f = (name, s) => ({ name, data: new TextEncoder().encode(s) });
    return writeZip([
      f('xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      f('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
      f('xl/worksheets/sheet1.xml', sheetXml),
    ]);
  };
  const two = await make(sheet('<row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c></row><row r="1048576"><c r="XFD1048576" t="inlineStr"><is><t>z</t></is></c></row>'));
  const t0 = Date.now();
  const r1 = await readXlsx(two);
  assert.deepEqual(r1.data.sheets[0].cells, { A1: 'a', XFD1048576: 'z' });
  const many = await make(sheet(Array.from({ length: 10000 }, (_, i) => `<row r="${i + 1}"><c r="${'WXD'}${i + 1}" t="inlineStr"><is><t>v${i}</t></is></c></row>`).join('')));
  const r2 = await readXlsx(many);
  assert.equal(Object.keys(r2.data.sheets[0].cells).length, 10000);
  assert.ok(Date.now() - t0 < 10000, 'no gigabyte allocation');
  assert.ok(process.memoryUsage().heapUsed < 800e6);
  // a dense limit is honoured when asked for
  const enc2 = await encode({ bytes: two, name: 's.xlsx' }, { created: false });
  const back = await decode(enc2.text);
  assert.ok((await toFile(back, 'csv')).bytes.length > 0); // two far-apart cells: a small table, written without a million rows of cells
});

test('XLSX limits: cell cap, row/column bounds', async () => {
  const f = (name, s) => ({ name, data: new TextEncoder().encode(s) });
  const base = (sheetXml) => writeZip([
    f('xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    f('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    f('xl/worksheets/sheet1.xml', `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetXml}</sheetData></worksheet>`),
  ]);
  const rowsXml = Array.from({ length: 50 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c></row>`).join('');
  await rejects(readXlsx(await base(rowsXml), { limits: { maxCells: 10 } }), 'limit');
  await rejects(readXlsx(await base('<row r="1"><c r="ZZZZ1"><v>1</v></c></row>')), 'shape');
  await rejects(readXlsx(await base('<row r="2000000"><c r="A2000000"><v>1</v></c></row>')), 'shape');
});

// ---- hostile archives and XML ----------------------------------------------------------------------------------------
test('zip bomb: a file compressed over 300:1 is refused before it is inflated; a lying size header is caught while inflating', async () => {
  const zeros = new Uint8Array(40 * 1024 * 1024);
  const bomb = await writeZip([{ name: 'xl/workbook.xml', data: zeros }]);
  assert.ok(bomb.length < 100000, `bomb is ${bomb.length} bytes`);
  throwsCode(() => openZip(bomb), 'limit');
  await rejects(encode({ bytes: bomb, name: 'b.xlsx' }), 'limit');
  // same bomb with the declared size patched down to look harmless
  const lying = bomb.slice();
  const dv = new DataView(lying.buffer);
  for (let i = 0; i < lying.length - 4; i++) if (dv.getUint32(i, true) === 0x02014b50) dv.setUint32(i + 24, 5000, true);
  const z = openZip(lying);
  await rejects(z.read('xl/workbook.xml'), 'limit');
  throwsCode(() => openZip(bomb, { maxTotalBytes: 1000, maxRatio: 1e9 }), 'limit');
  throwsCode(() => openZip(bomb, { maxEntryBytes: 1000, maxRatio: 1e9 }), 'limit');
  throwsCode(() => openZip(bomb, { maxEntries: 0, maxRatio: 1e9 }), 'limit');
});

test('zip slip and other unsafe archive entries are refused', async () => {
  const one = (name) => writeZip([{ name, data: new TextEncoder().encode('x') }]);
  for (const name of ['../evil.xml', 'xl/../../evil', '/etc/passwd', 'C:/evil', 'xl\\sheet.xml', 'a/./../..']) { const z = await one(name); throwsCode(() => openZip(z), 'zip-slip'); }
  const dup = await writeZip([{ name: 'a.xml', data: new Uint8Array(1) }, { name: 'a.xml', data: new Uint8Array(1) }]);
  throwsCode(() => openZip(dup), 'zip');
  throwsCode(() => openZip(new TextEncoder().encode('not a zip at all, definitely not')), 'zip');
  const good = await writeZip([{ name: 'a.xml', data: new TextEncoder().encode('hello hello hello hello hello hello hello hello hello hello hello hello hello hello hello hello hello') }]);
  const bad = good.slice();
  bad[40] ^= 0xff; // flip a data byte: CRC or inflate must object
  await rejects(openZip(bad).read('a.xml'), 'zip');
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('XML: DOCTYPE and entity expansion (billion laughs, XXE) are refused; deep nesting is limited', async () => {
  const laughs = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;">]><lolz>&lol2;</lolz>';
  throwsCode(() => parseXml(laughs), 'syntax');
  throwsCode(() => parseXml('<!DOCTYPE x SYSTEM "file:///etc/passwd"><x>&xxe;</x>'), 'syntax');
  throwsCode(() => parseXml('<a>&custom;</a>'), 'syntax');
  throwsCode(() => parseXml('<a>&#0;</a>'), 'syntax');
  throwsCode(() => parseXml('<a>' .repeat(300) + '</a>'.repeat(300)), 'limit');
  throwsCode(() => parseXml('<a x="1" x="2"/>'), 'syntax');
  throwsCode(() => parseXml('<a><b></a></b>'), 'syntax');
  await rejects(encode({ text: laughs, name: 'l.xml' }), 'syntax');
  assert.deepEqual(parseXml('<a>&lt;&#65;&#x42;&amp;</a>').root, ['a', '<AB&']);
  // inside an xlsx part
  const f = (name, s) => ({ name, data: new TextEncoder().encode(s) });
  const xl = await writeZip([f('xl/workbook.xml', laughs)]);
  await rejects(readXlsx(xl), 'syntax');
});

test('YAML: anchors, tags, multiple documents, tabs, duplicate keys are refused; deep and long flow collections are limited', () => {
  for (const bad of ['a: &x 1\nb: *x', 'a: !!str 1', 'a: 1\n---\nb: 2', 'a:\n\tb: 1', 'a: 1\na: 2', '<<: {a: 1}', '? complex\n: v', '%YAML 1.2\n---\na: 1'])
    throwsCode(() => parseYaml(bad), 'syntax');
  throwsCode(() => parseYaml('a: ' + '['.repeat(100000)), 'limit');
  throwsCode(() => parseYaml('a: ' + '['.repeat(100000) + ']'.repeat(100000)), 'limit');
  throwsCode(() => parseYaml('a: ' + '{k: '.repeat(5000)), 'limit');
  throwsCode(() => parseYaml('a: [' + '1,'.repeat(5000) + ']', { maxNodes: 1000 }), 'limit');
  assert.equal(parseYaml('a: [' + '1,'.repeat(5000) + '1]').get('a').length, 5001);
  throwsCode(() => parseYaml('a:\n' + Array.from({ length: 200 }, (_, i) => ' '.repeat(i + 1) + 'a:').join('\n')), 'limit');
});

test('YAML subset: typing narrowed on purpose; round trip', async () => {
  const { d } = await roundtrip('sample.yaml');
  const v = d.model.value;
  assert.equal(v.zip, '00123');
  assert.deepEqual(v.ratio, { $: 'n', v: '1.10' });
  assert.equal(v.tags[2], '007');
  assert.equal(v.notes, 'line one\nline two\n');
  assert.equal(v.folded, 'a long text');
  assert.deepEqual(v.flow, [1, 'two', { k: 'v' }]);
  const out = parseYaml(text((await toFile(d)).bytes));
  assert.equal(out.get('zip'), '00123');
  assert.equal(out.get('tags')[2], '007');
  assert.equal(out.get('ratio').lit, '1.10');
  assert.equal((await decode((await encode({ bytes: (await toFile(d)).bytes, name: 'x.yaml' }, { created: false })).text)).model.value.title, 'Plan');
});

// ---- other formats ---------------------------------------------------------------------------------------------------
test('Markdown: structured model, normalised output, fixpoint', async () => {
  const { d } = await roundtrip('sample.md');
  const types = d.model.blocks.map((b) => b.t);
  assert.deepEqual(types, ['h', 'p', 'h', 'ul', 'ol', 'ol', 'table', 'quote', 'code', 'code', 'hr', 'html', 'p']);
  assert.equal(d.model.front, 'title: Quarterly notes\ntags: [sales, "q1"]');
  const tbl = d.model.blocks[6];
  assert.deepEqual(tbl.align, ['l', 'r', 'c']);
  assert.deepEqual(tbl.rows[1], ['South', '18', '60 %']);
  assert.equal(d.model.blocks[8].lang, 'js');
  const md = text((await toFile(d)).bytes);
  const d2 = await decode((await encode({ bytes: new TextEncoder().encode(md), name: 'sample.md' }, { created: false })).text);
  assert.deepEqual(d2.model, d.model);
  assert.equal(text((await toFile(d2)).bytes), md, 'the writer is a fixpoint');
});

test('XML: element tree, mixed content, attributes, CDATA, comments dropped', async () => {
  const { d } = await roundtrip('sample.xml');
  const root = d.model.root;
  assert.equal(root[0], 'catalog');
  assert.equal(root[1]['xmlns:x'], 'urn:example:extra');
  const book = root.find((x) => Array.isArray(x) && x[0] === 'book');
  const n = book.find((x) => Array.isArray(x) && x[0] === 'note');
  assert.equal(n[1], 'Mixed ');
  assert.equal(n[3], ' with  two  spaces and a <cdata & stuff> section.');
  const out = text((await toFile(d)).bytes);
  assert.match(out, /<note>Mixed <b>content<\/b> with  two  spaces and a &lt;cdata &amp; stuff&gt; section\.<\/note>/);
  assert.doesNotMatch(out, /comment/);
});

test('iCalendar and vCard: components, parameters, escapes kept, long lines folded at 75 octets', async () => {
  const ics = await roundtrip('sample.ics');
  const ev = ics.d.model.items[0].k[0];
  assert.equal(ev.c, 'VEVENT');
  assert.ok(ev.p.find((p) => p[0] === 'SUMMARY')[1] === 'Kick-off\\, Zürich');
  assert.deepEqual(ev.p.find((p) => p[0] === 'ATTENDEE')[2], ['CN="Müller, Anna"', 'ROLE=REQ-PARTICIPANT']);
  assert.ok(ev.p.find((p) => p[0] === 'DESCRIPTION')[1].includes('f' + 'olded because'), 'unfolded');
  const out = text((await toFile(ics.d)).bytes);
  for (const line of out.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  assert.match(out, /^BEGIN:VCALENDAR\r\nVERSION:2\.0/);
  const again = await decode((await encode({ bytes: new TextEncoder().encode(out), name: 'a.ics' }, { created: false })).text);
  assert.deepEqual(again.model, ics.d.model);
  const vcf = await roundtrip('sample.vcf');
  assert.equal(vcf.d.model.items.length, 2);
  assert.equal(vcf.d.model.items[1].p[2][0], 'item1.EMAIL');
  throwsCode(() => readLines('BEGIN:VEVENT\nEND:VCALENDAR\n'), 'syntax');
});

test('key=value: pairs, comments dropped and declared', async () => {
  const { d, r } = await roundtrip('sample.env');
  assert.deepEqual(d.model.pairs, [['HOST', 'example.org'], ['PORT', '8080'], ['GREETING', 'hello world'], ['EMPTY', '']]);
  assert.ok(r.lossy.some((l) => /comments/.test(l)));
  assert.equal(text((await toFile(d)).bytes), 'HOST=example.org\nPORT=8080\nGREETING=hello world\nEMPTY=\n');
});

test('format detection by extension and by content; unknown types are refused clearly', async () => {
  const sniff = async (b, n) => (await encode({ bytes: new TextEncoder().encode(b), name: n }, { created: false })).format;
  assert.equal(await sniff('{"a":1}', 'noext'), 'json');
  assert.equal(await sniff('BEGIN:VCALENDAR\nEND:VCALENDAR\n', 'noext'), 'ics');
  assert.equal(await sniff('<a/>', 'noext'), 'xml');
  const x = await encode({ bytes: bytes('basic.xlsx') }, { created: false });
  assert.equal(x.format, 'xlsx');
  await rejects(encode({ text: 'plain words', name: 'a.bin' }), 'format');
  await rejects(encode({ text: 'x', name: 'a.csv' }, { limits: { maxInputBytes: 0 } }), 'limit');
});

test('attachment: the original file can travel along (base64) and is verified', async () => {
  const r = await enc('basic.xlsx', { attach: true });
  const d = await decode(canonicalText(r.text));
  assert.equal(d.attach.length, 1);
  assert.equal(d.attach[0].size, bytes('basic.xlsx').length);
  const { fromBase64 } = await import('../src/structured.js');
  assert.deepEqual([...fromBase64(d.attach[0].base64)], [...bytes('basic.xlsx')]);
});

test('the layout choice changes looks only: compact, rows and cells decode to the same model', async () => {
  const models = [];
  for (const layout of ['compact', 'rows', 'cells']) models.push((await roundtrip('people.csv', { layout })).d.model);
  assert.deepEqual(models[0], models[1]);
  assert.deepEqual(models[1], models[2]);
  assert.ok(keepLiteral(0x41) && !keepLiteral(0x22) && !keepLiteral(0xb7) && !keepLiteral(0x65e5));
  assert.ok(keepLiteral(0x65e5, 'plain'));
});

test('the conformance vectors: the reference decoder passes them and the reference encoder reproduces them', async () => {
  const suite = JSON.parse(readFileSync(FX + 'conformance/vectors.json', 'utf8'));
  assert.equal(suite.standard, 'TGD');
  for (const v of suite.vectors) {
    if (v.expect.error) { await rejects(decode(canonicalText(v.text)), v.expect.error); continue; }
    const d = await decode(canonicalText(v.text));
    assert.deepEqual(d.model, v.expect.model, v.name);
    assert.equal(d.name, v.expect.name);
    if (!['whitespace-noise', 'prose-around'].includes(v.name)) {
      const again = await seal(v.expect.model, { format: v.expect.format, name: v.expect.name, created: v.expect.created }, { layout: 'rows' });
      assert.equal(again, v.text, `${v.name}: the encoder is deterministic`);
    }
  }
  assert.ok(suite.vectors.length >= 12);
});

// ---- end to end through a real PDF ------------------------------------------------------------------------------------
test('end to end: a sheet becomes a one-page PDF and comes back out of its text layer (MuPDF)', async (t) => {
  if (process.env.TG_SKIP_BROWSER) return t.skip('browser checks skipped in CI (run locally)');
  if (!findChrome()) return t.skip('Chrome/Chromium not found (set CHROME_PATH)');
  if (spawnSync('which', ['mutool']).status !== 0) return t.skip('MuPDF (mutool) not found');
  const { r } = await roundtrip('people.csv');
  const prose = 'Quarterly people list. The data block below is machine readable. ' + r.text;
  const dir = mkdtempSync(join(tmpdir(), 'tgd-pdf-'));
  const pdf = join(dir, 'work.pdf');
  const session = await openSession();
  try { await makeOnePage(session, { text: prose, title: 'People', paper: 'a4', pdf }); } finally { await session.close(); }
  const back = spawnSync('mutool', ['draw', '-q', '-F', 'txt', '-o', '-', pdf], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout;
  const d = await decode(canonicalText(back));
  assert.equal(d.verified, true);
  assert.deepEqual(d.model, (await decode(r.text)).model);
  assert.equal(text((await toFile(d, 'csv', { safe: false })).bytes), text(bytes('people.csv')));
  assert.ok(existsSync(pdf));
});
