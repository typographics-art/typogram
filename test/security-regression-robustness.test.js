// Findings F2 to F5 and F9: failures must be named errors, long inputs must not overflow the stack, and a page must not put an error message into markup.
// Regression tests for the findings of the internal security review of 2026-10 (docs/security-review-internal-2026-10.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decode, toFile, seal, TgdError } from '../src/structured.js';
import { readXlsx } from '../src/structured-xlsx.js';
import { writeZip } from '../src/structured-zip.js';
import { hideSecret, revealSecret } from '../src/secret.js';
import { columnTypes, summarize } from '../src/data-panel.js';

const enc = new TextEncoder();

// ---- F2: damaged workbooks must fail with a named error ---------------------------------------------------------------
const part = (s) => enc.encode(s);
const wb = (rels, extra = []) => writeZip([
  { name: '[Content_Types].xml', data: part('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>') },
  { name: 'xl/workbook.xml', data: part('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>') },
  { name: 'xl/_rels/workbook.xml.rels', data: part(`<Relationships>${rels}</Relationships>`) },
  { name: 'xl/worksheets/sheet1.xml', data: part('<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>') },
  ...extra,
]);
test('F2 xlsx: a relationship without a Target, and a comments part that is not in the archive, give a TgdError (not a TypeError)', async () => {
  const noTarget = await wb('<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>');
  await assert.rejects(readXlsx(noTarget), (e) => e instanceof TgdError && typeof e.code === 'string');
  const good = '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>';
  assert.equal((await readXlsx(await wb(good))).data.sheets[0].rows[0][0], 'x');
  const missingComments = await wb(good, [{ name: 'xl/worksheets/_rels/sheet1.xml.rels', data: part('<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments1.xml"/></Relationships>') }]);
  await assert.rejects(readXlsx(missingComments), (e) => e instanceof TgdError && e.code === 'format');
});

// ---- F3: tg1 book key for a long secret --------------------------------------------------------------------------------
test('F3 tg1: a secret of 60 000 characters is hidden and read back (the encoder overflowed the call stack beyond about 40 000)', async () => {
  const text = 'abc def ghi '.repeat(2000), secret = 'abc '.repeat(15000).trim();
  const key = await hideSecret(text, secret);
  assert.equal(await revealSecret(text, key), secret);
});

// ---- F4: summaries and previews of a sparse sheet --------------------------------------------------------------------
test('F4 data panel: a sparse sheet with a cell in the last row (A1048576) and a workbook with 200 000 sheets are summarised without overflowing the stack or stalling', () => {
  const far = { name: 'S', cells: { A1: 'x', A1048576: 'y' } };
  const t0 = performance.now();
  assert.deepEqual(columnTypes(far).map((c) => c.col), ['A']);
  assert.ok(performance.now() - t0 < 500);
  const many = { kind: 'workbook', sheets: Array.from({ length: 200000 }, () => ({ name: 'S', rows: [] })) };
  assert.equal(summarize(many, 'xlsx').sheets.length, 200000);
});

// ---- F5: a writer that meets a model of another shape --------------------------------------------------------------------
test('F5 toFile: a block whose model does not have the shape of its kind gives a TgdError("shape") from every writer, never a TypeError', async () => {
  const block = await seal({ kind: 'markdown', blocks: [{ t: 'table', head: 'not an array' }] }, { format: 'md', created: false });
  const b = await decode(block);
  await assert.rejects(toFile(b, 'md', {}), (e) => e instanceof TgdError && e.code === 'shape');
});


// ---- tripwires: the places that handle keys and decrypted data keep their hygiene -------------------------------------------
test('tripwire: the code that handles keys, records and decrypted data uses no HTML sink, eval, browser storage, console output or Math.random', () => {
  const files = ['data-ui.js', 'data-panel.js', 'data-panel-ui.js', 'data-reader-ui.js', 'crypt.js', 'crypt-codec.js', 'crypt-book.js', 'crypt-chain.js', 'keys.js', 'keys-kdf.js', 'keys-seal.js', 'keys-work.js', 'keys-split.js', 'secret.js',
    'structured.js', 'structured-json.js', 'structured-model.js', 'structured-formats.js', 'structured-csv.js', 'structured-xlsx.js', 'structured-md.js', 'structured-xml.js', 'structured-yaml.js', 'structured-lines.js', 'structured-zip.js'];
  const bad = /\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write|\beval\s*\(|new Function|\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bconsole\.|Math\.random|\bdocument\.cookie\b/;
  for (const f of files) {
    const src = readFileSync(new URL('../src/' + f, import.meta.url), 'utf8').split('\n');
    src.forEach((line, i) => { if (!line.trim().startsWith('//') && !line.trim().startsWith('*') && bad.test(line)) assert.fail(`src/${f}:${i + 1}: ${line.trim().slice(0, 100)}`); });
  }
});
test('tripwire: the generator page escapes the message of an error before it goes into markup (F9)', () => {
  const html = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  assert.match(html, /chip\(escapeXml\(e\.message \|\| String\(e\)\), 'warn'\)/);
  assert.doesNotMatch(html, /chip\(e\.message/);
});

