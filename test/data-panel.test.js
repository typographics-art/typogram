// The pure logic of the data panels (src/data-panel.js): what a model holds, previews, types, capacity, wording, and every
// error mapped to a message in both languages. The browser behaviour is checked by scripts/check-web-data.mjs (test/web-data.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encode, decode, TgdError, CryptError, dataPanel } from '../src/index.js';
import * as P from '../src/data-panel.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const SAMPLES = join(dirname(fileURLToPath(import.meta.url)), '..', 'samples', 'data');
const bytes = (p) => new Uint8Array(readFileSync(p));

test('data-panel: is part of the public API', () => {
  assert.equal(dataPanel.T, P.T);
});

test('formats: the web panel offers nine types and rejects the settings file', () => {
  assert.deepEqual(P.WEB_FORMATS, ['xlsx', 'csv', 'tsv', 'json', 'md', 'yaml', 'xml', 'ics', 'vcf']);
  assert.equal(P.detectWebFormat('a.csv', new Uint8Array()), 'csv');
  assert.equal(P.detectWebFormat('a.xlsx', new Uint8Array()), 'xlsx');
  assert.equal(P.detectWebFormat('x.env', new Uint8Array()), null, 'kv is not offered in the web');
  assert.equal(P.detectWebFormat('x.exe', Uint8Array.of(0x4d, 0x5a)), null);
  assert.equal(P.detectWebFormat('noext', new TextEncoder().encode('{"a":1}')), 'json', 'detected by content');
  for (const e of ['.xlsx', '.csv', '.tsv', '.json', '.md', '.yaml', '.xml', '.ics', '.vcf']) assert.ok(P.ACCEPT.split(',').includes(e), e);
  assert.equal(P.formatLabel('ics'), 'iCalendar');
});

test('summarize: counts sheets, rows, cells and formulas of the xlsx sample, dense and sparse alike', async () => {
  const r = await encode({ bytes: bytes(join(SAMPLES, 'bakery-orders.xlsx')), name: 'bakery-orders.xlsx' }, { created: false });
  const s = P.summarize(r.model, r.format);
  assert.equal(s.kind, 'workbook');
  assert.equal(s.sheets.length, 2);
  assert.equal(s.sheets[0].name, 'Orders');
  assert.equal(s.sheets[0].rows, 32, 'header + 30 orders + total');
  assert.equal(s.sheets[0].cols, 7);
  assert.equal(s.sheets[0].header, true);
  assert.equal(s.formulas, 1);
  assert.ok(s.cells > 200);
  const sparse = P.summarize({ kind: 'workbook', sheets: [{ name: 's', cells: { A1: 'x', C5: 2, XFD1000: 'y' } }] }, 'xlsx');
  assert.deepEqual([sparse.sheets[0].rows, sparse.sheets[0].cols, sparse.cells], [1000, 16384, 3]);
});

test('summarize: json, markdown, xml, calendar; and the empty file', async () => {
  const json = P.summarize({ kind: 'json', value: { a: [1, 2, { b: 3 }] } }, 'json');
  assert.equal(json.nodes, 6);
  const md = P.summarize((await encode({ bytes: bytes(join(FIX, 'sample.md')), name: 'sample.md' }, { created: false })).model, 'md');
  assert.ok(md.blocks >= 5 && md.headings >= 1);
  const xml = P.summarize((await encode({ bytes: bytes(join(FIX, 'sample.xml')), name: 'sample.xml' }, { created: false })).model, 'xml');
  assert.ok(xml.elements >= 2);
  const ics = P.summarize((await encode({ bytes: bytes(join(FIX, 'sample.ics')), name: 'sample.ics' }, { created: false })).model, 'ics');
  assert.ok(ics.items >= 1);
  assert.equal(P.isEmptyModel(P.summarize({ kind: 'workbook', sheets: [{ name: 'a', rows: [] }] }, 'csv')), true);
  assert.equal(P.isEmptyModel(P.summarize({ kind: 'workbook', sheets: [{ name: 'a', rows: [['x']] }] }, 'csv')), false);
});

test('cellInfo: every cell type shows what it is, a formula shows its cached value, long text is clipped', () => {
  assert.deepEqual(P.cellInfo(null), { text: '', kind: 'empty', full: '' });
  assert.equal(P.cellInfo('Zoë 😀').kind, 'text');
  assert.equal(P.cellInfo(3.5).text, '3.5');
  assert.equal(P.cellInfo(true).text, 'TRUE');
  assert.deepEqual([P.cellInfo({ $: 'd', v: '2024-03-05' }).text, P.cellInfo({ $: 'd', v: '2024-03-05' }).kind], ['2024-03-05', 'date']);
  assert.equal(P.cellInfo({ $: 'n', v: '12345678901234567890' }).text, '12345678901234567890', 'a long number stays whole');
  assert.equal(P.cellInfo({ $: 'e', v: '#DIV/0!' }).kind, 'error');
  assert.equal(P.cellInfo({ $: 'f', f: 'SUM(A1:A2)', v: 3 }).text, '=SUM(A1:A2) → 3');
  assert.equal(P.cellInfo({ $: 'f', f: 'A1' }, { noValue: '(kein Wert)' }).text, '=A1 → (kein Wert)');
  const long = P.cellInfo('x'.repeat(500), { max: 20 });
  assert.equal(long.text.length, 20);
  assert.equal(long.full.length, 500);
  assert.equal(P.cellInfo('a\nb  c').text, 'a b c', 'line breaks do not break the table');
});

test('sheetPreview: first rows, column letters, what was left out; sparse sheets list used rows with their numbers', () => {
  const rows = Array.from({ length: 20 }, (_, i) => Array.from({ length: 15 }, (_, c) => `${i}-${c}`));
  const p = P.sheetPreview({ name: 's', rows }, { maxRows: 8, maxCols: 12 });
  assert.equal(p.rows.length, 8);
  assert.equal(p.columns.length, 12);
  assert.equal(p.columns[11], 'L');
  assert.equal(p.moreRows, 12);
  assert.equal(p.moreCols, 3);
  assert.equal(p.rows[7].n, 8);
  const sp = P.sheetPreview({ name: 's', cells: { B2: 'x', D100: 'y', A5: 'z' } }, { maxRows: 2 });
  assert.deepEqual(sp.rows.map((r) => r.n), [2, 5]);
  assert.equal(sp.moreRows, 1);
  assert.equal(sp.rows[0].cells[1].text, 'x');
  assert.equal(P.sheetPreview({ name: 'e', rows: [] }).columns.length, 1, 'an empty sheet still has a column');
});

test('columnTypes: the header row is not a type, the dominant type per column is named', () => {
  const t = P.columnTypes({ name: 's', header: true, rows: [['Name', 'Qty', 'When'], ['a', 1, { $: 'd', v: '2024-01-01' }], ['b', 2, { $: 'd', v: '2024-01-02' }], ['c', 'n/a', null]] });
  assert.deepEqual(t.map((c) => [c.col, c.header, c.main]), [['A', 'Name', 'text'], ['B', 'Qty', 'number'], ['C', 'When', 'date']]);
  assert.deepEqual(t[1].kinds, { number: 2, text: 1 });
});

test('outline: a readable list for models that are not a table, capped', async () => {
  const j = P.outline({ kind: 'json', value: { name: 'x', items: [1, 2, 3, 4, 5, 6, 7], nested: { deep: true } } });
  assert.match(j[0].text, /object with 3 keys/);
  assert.ok(j.some((l) => l.text.includes('array of 7')));
  assert.ok(j.some((l) => l.text === '… 2'), 'the rest of a long array is counted');
  const md = P.outline((await encode({ bytes: bytes(join(FIX, 'sample.md')), name: 'sample.md' }, { created: false })).model);
  assert.ok(md.some((l) => l.text.startsWith('# ')));
  const cal = P.outline((await encode({ bytes: bytes(join(FIX, 'sample.ics')), name: 'sample.ics' }, { created: false })).model);
  assert.match(cal[0].text, /^VCALENDAR/);
  assert.equal(P.outline({ kind: 'json', value: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, i])) }, 30).length, 30);
  assert.deepEqual(P.outline({ kind: 'nothing' }), []);
});

test('capacity: the spec numbers (600 000 characters a page, 345/sqrt(N) mm), amber at 1 mm, red above a page', () => {
  assert.equal(P.PAGE.chars, 600000);
  assert.ok(Math.abs(P.typeMm(11169) - 3.26) < 0.05, 'measured 3.2 mm for 11 169 characters');
  assert.ok(Math.abs(P.typeMm(1394) - 9.24) < 0.1, 'measured 9.5 mm for 1 394 characters');
  assert.equal(P.capacity(5000).state, 'ok');
  assert.equal(P.capacity(119025).state, 'ok');
  assert.equal(P.capacity(120000).state, 'tight');
  assert.equal(P.capacity(600000).state, 'tight');
  assert.equal(P.capacity(600001).state, 'over');
  assert.equal(P.capacity(1200000).ratio, 2);
  assert.equal(P.capacity(0).mm, 0);
});

test('composeWork: placement, lead-in and an empty text', () => {
  const block = 'TGD1[{}]TGD1';
  assert.equal(P.composeWork({ prose: 'My text.', block, placement: 'after' }), `My text.\n\n${block}`);
  assert.equal(P.composeWork({ prose: 'My text.', lead: 'Title', block, placement: 'after' }), `Title\n\nMy text.\n\n${block}`);
  assert.equal(P.composeWork({ prose: 'My text.', lead: 'Title', block, placement: 'only' }), `Title\n\n${block}`);
  assert.equal(P.composeWork({ prose: 'My text.', block, placement: 'only' }), block);
  assert.equal(P.composeWork({ prose: '  ', block }), block);
});

test('exportFormats: the source format first, only formats the kind can be written as', () => {
  assert.deepEqual(P.exportFormats('workbook', 'xlsx').map((f) => f.id), ['xlsx', 'csv', 'tsv', 'json']);
  assert.deepEqual(P.exportFormats('workbook', 'csv').map((f) => f.id)[0], 'csv');
  assert.deepEqual(P.exportFormats('markdown', 'md').map((f) => f.id), ['md']);
  assert.ok(P.exportFormats('json', 'yaml').map((f) => f.id).includes('json'));
  assert.equal(P.exportFormats('workbook', 'xlsx')[0].primary, true);
  assert.equal(P.exportFormats('workbook', 'xlsx')[0].label, '.xlsx');
});

test('downloadName: no path, no control characters, a new extension', () => {
  assert.equal(P.downloadName('budget.xlsx', 'csv'), 'budget.csv');
  assert.equal(P.downloadName('../../etc/passwd', '.json'), 'passwd.json');
  assert.equal(P.downloadName('a\u0000b\nc.csv', 'csv'), 'a-b-c.csv');
  assert.equal(P.downloadName('', 'csv'), 'data.csv');
  assert.equal(P.downloadName('.hidden', 'md'), 'data.md', 'a dot file has no usable stem');
});

test('wording: both languages have every key, placeholders are filled, German has real umlauts', () => {
  const en = Object.keys(P.DICT.en), de = Object.keys(P.DICT.de);
  assert.deepEqual(en.filter((k) => !de.includes(k)), [], 'every English key has a German text');
  assert.deepEqual(de.filter((k) => !en.includes(k)), [], 'no German key without an English one');
  for (const k of en) {
    const a = P.DICT.en[k], b = P.DICT.de[k];
    assert.equal(Array.isArray(a), Array.isArray(b), `${k}: same shape`);
    const ph = (x) => [...JSON.stringify(x).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
    assert.equal(ph(a), ph(b), `${k}: same placeholders`);
  }
  assert.equal(P.T('en', 'd.reading', { name: 'a.csv' }), 'Reading a.csv …');
  assert.equal(P.T('de', 'd.reading', { name: 'a.csv' }), 'a.csv wird gelesen …');
  assert.equal(P.T('de', 'no.such.key'), 'no.such.key');
  assert.match(P.T('de', 'd.optSeal'), /Versiegeln \(verschlüsseln\)/);
  assert.doesNotMatch(JSON.stringify(P.DICT.de), /Schluessel|Pruefsumme|moeglich|ueber |fuer /, 'umlauts, not transliteration');
  assert.equal(P.count('en', 'sheet', 1), '1 sheet');
  assert.equal(P.count('en', 'sheet', 2), '2 sheets');
  assert.equal(P.count('de', 'sheet', 1), '1 Blatt');
  assert.equal(P.count('de', 'sheet', 3), '3 Blätter');
  assert.equal(P.count('de', 'row', 2), '2 Zeilen');
});

test('lossyText: the encoder strings are translated by pattern, counts kept, unknown ones stay English', async () => {
  const r = await encode({ bytes: bytes(join(SAMPLES, 'bakery-orders.csv')), name: 'bakery-orders.csv' }, { created: false });
  const de = P.lossyText(r.lossy, 'de');
  assert.equal(de.length, r.lossy.length);
  assert.equal(de[0], 'Typen: Jede Zelle ist Text');
  assert.deepEqual(P.lossyText(r.lossy, 'en'), r.lossy);
  assert.equal(P.lossyText(['shared formulas: 7 cells keep their value only (the first cell of each group keeps the formula)'], 'de')[0].slice(0, 30), 'geteilte Formeln: 7 Zellen beh');
  assert.equal(P.lossyText(['something new'], 'de')[0], 'something new');
  // every lossy string the readers can produce has a German form (nothing is left English by accident)
  for (const name of ['sample.md', 'sample.yaml', 'sample.xml', 'sample.ics', 'sample.vcf', 'data.json', 'basic.xlsx', 'table.tsv']) {
    const e = await encode({ bytes: bytes(join(FIX, name)), name }, { created: false });
    for (const [i, s] of P.lossyText(e.lossy, 'de').entries()) assert.notEqual(s, e.lossy[i], `${name}: "${e.lossy[i]}" has no German text`);
  }
});

test('warningsFor: formulas, hidden sheets, long cells, scripts that are written as codes, the prose note', () => {
  const model = { kind: 'workbook', sheets: [{ name: 'a', state: 'hidden', rows: [['東京', 'x'.repeat(6000), { $: 'f', f: 'A1', v: 1 }]] }] };
  const s = P.summarize(model, 'xlsx');
  const w = P.warningsFor({ summary: s, model, lang: 'en', withProse: true });
  assert.deepEqual(w.map((x) => x.id).sort(), ['formulas', 'hidden', 'longCell', 'prose', 'scripts']);
  assert.match(w.find((x) => x.id === 'scripts').text, /\\u codes/);
  const plain = { kind: 'workbook', sheets: [{ name: 'a', rows: [['Zürich', 'Zoë 😀']] }] };
  assert.deepEqual(P.warningsFor({ summary: P.summarize(plain, 'csv'), model: plain, lang: 'de' }), [], 'Latin text and emoji are written as they are: no warning');
  assert.equal(P.hasEscapedScripts({ a: ['ال'] }), true);
});

test('generatorError: every library error code the file reader can raise has a visible, actionable message in both languages', async () => {
  const cases = [['format', 'x.exe'], ['encoding'], ['syntax'], ['zip'], ['zip-slip'], ['limit'], ['shape']];
  for (const [code, name] of cases) for (const lang of ['en', 'de']) {
    const e = P.generatorError(new TgdError(code, 'line 3: bad'), lang, { name });
    assert.ok(e.title.length > 5 && e.body.length > 10, `${code} ${lang}`);
    assert.ok(e.actions.length >= 1);
    assert.equal(e.code, code);
    assert.doesNotMatch(e.title + e.body, /\{\w+\}/, 'no unfilled placeholder');
  }
  assert.equal(P.generatorError(new TgdError('encoding', 'x'), 'en').actions[0], 'encoding');
  assert.match(P.generatorError(new TgdError('syntax', 'line 12: a quoted field is not closed'), 'de').body, /line 12: a quoted field/);
  assert.match(P.generatorError(new TgdError('format', 'x'), 'en', { name: 'virus.exe' }).body, /^virus\.exe is not one of/);
  assert.equal(P.generatorError(new Error('boom'), 'en').title, 'The file could not be read');
  assert.equal(P.generatorError(null, 'en', { code: 'empty' }).title, 'The file holds no data');
  assert.match(P.generatorError(null, 'en', { code: 'fileTooBig', size: 20, max: 16 }).body, /20 MiB.*16 MiB/);
});

test('blockError: a damaged block says what happened and what to do, in both languages', async () => {
  const good = (await encode({ text: 'a,b\n1,2\n', name: 'x.csv' }, { created: false })).text;
  await assert.rejects(() => decode(good.replace('"1"', '"9"')), (e) => {
    const m = P.blockError(e, 'en');
    assert.equal(m.title, 'The data in this work was changed or is damaged');
    assert.deepEqual(m.actions, ['showBlock', 'downloadBlock']);
    assert.equal(m.code, 'checksum');
    return true;
  });
  await assert.rejects(() => decode('TGD1[{"tgd":'), (e) => {
    assert.equal(e.code, 'unterminated');
    const m = P.blockError(e, 'de');
    assert.equal(m.title, 'Der Datenblock ist abgeschnitten');
    assert.match(m.body, /Zeichen \d+/);
    return true;
  });
  for (const code of ['checksum', 'unterminated', 'version', 'syntax', 'shape', 'limit', 'none', 'format']) {
    for (const lang of ['en', 'de']) {
      const m = P.blockError(new TgdError(code, 'detail', { offset: 7 }), lang, { format: 'csv' });
      assert.ok(m.title && m.body);
      assert.doesNotMatch(m.title + m.body, /\{\w+\}/);
    }
  }
  assert.equal(P.blockError(new TgdError('format', 'No', {}), 'en', { format: '.xlsx' }).title, 'This data cannot be written as .xlsx');
  assert.equal(P.blockError(new Error('?'), 'en').title, 'The data could not be shown');
});

test('openError: one constant message per code, never the key, the password or the record', () => {
  const secret = 'tgx1.SECRETKEYTEXT';
  for (const code of ['no-key', 'bad-prefix', 'checksum', 'damaged', 'wrong-work', 'work-required', 'no-record', 'auth-failed', 'too-large', 'unsupported-compression', 'need-password', 'need-key', 'version', 'not-tgd', 'unterminated']) {
    for (const lang of ['en', 'de']) {
      const m = P.openError(new CryptError(code, `library message with ${secret}`), lang);
      assert.ok(m.body.length > 15, code);
      assert.ok(!m.body.includes(secret) && !m.title.includes(secret), 'the library message is not echoed');
      assert.equal(m.title, lang === 'de' ? 'Öffnen nicht möglich' : 'Could not open');
    }
  }
  assert.equal(P.openError(new CryptError('auth-failed', ''), 'en').body, 'The key does not open this record, or the record was changed. Check that the key and the record belong together.');
  assert.equal(P.openError(new CryptError('wrong-work', ''), 'de').body, 'Dieser Schlüssel gehört zu einem anderen Werk, oder der Text wurde verändert. Das Werk öffnen, für das der Schlüssel erzeugt wurde.');
  assert.equal(P.openError(new Error('odd'), 'en').body, 'The record could not be opened.');
  assert.match(P.openError(new CryptError('bad-prefix', ''), 'en', { field: 'record' }).body, /sealed record/);
  assert.match(P.openError(new CryptError('bad-prefix', ''), 'en', { field: 'key' }).body, /not a key/);
});

test('badPrefixField: a wrong prefix is blamed on the right field', () => {
  assert.equal(P.badPrefixField('hello', 'tgs1.abc'), 'key');
  assert.equal(P.badPrefixField('tgx1.abc', 'hello'), 'record');
  assert.equal(P.badPrefixField('', 'hello'), 'record');
  assert.equal(P.badPrefixField('', ''), 'key');
  assert.equal(P.badPrefixField('tg2.abc', ''), 'key');
});

test('hasHeader: the hint, or a first row of distinct text above more rows (CSV has no hint)', () => {
  assert.equal(P.hasHeader({ header: true, rows: [] }), true);
  assert.equal(P.hasHeader({ rows: [['a', 'b'], ['1', '2']] }), true);
  assert.equal(P.hasHeader({ rows: [['a', 'a'], ['1', '2']] }), false, 'repeated names');
  assert.equal(P.hasHeader({ rows: [['a', null], ['1', '2']] }), false, 'an empty cell');
  assert.equal(P.hasHeader({ rows: [['a', 'b']] }), false, 'one row only');
  assert.equal(P.hasHeader({ cells: { A1: 'x' } }), false);
  assert.equal(P.summarize({ kind: 'workbook', sheets: [{ name: 's', rows: [['a', 'b'], ['1', '2']] }] }, 'csv').sheets[0].header, true);
});

test('summaryLine and blockJson', async () => {
  const r = await encode({ text: 'a,b\n1,2\n', name: 'x.csv' }, { created: false });
  assert.equal(P.summaryLine(P.summarize(r.model, 'csv'), 'en'), 'CSV · 1 sheet · 2 rows · 4 cells');
  assert.equal(P.summaryLine(P.summarize(r.model, 'csv'), 'de'), 'CSV · 1 Blatt · 2 Zeilen · 4 Zellen');
  const b = await decode(r.text);
  const j = JSON.parse(P.blockJson(b));
  assert.deepEqual([j.tgd, j.format, j.name, j.sum, j.data.kind], ['1.0', 'csv', 'x.csv', b.sum, 'workbook']);
});
