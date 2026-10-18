// Findings F2 to F5 and F9: failures must be named errors, long inputs must not overflow the stack, and a page must not put an error message into markup.
// Regression tests for the findings of the internal security review of 2026-10 (docs/security-review-internal-2026-10.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encode, decode, toFile, seal, TgdError } from '../src/structured.js';
import { readXlsx } from '../src/structured-xlsx.js';
import { sealData, openSealed } from '../src/crypt.js';
import { writeZip } from '../src/structured-zip.js';
import { hideSecret, revealSecret } from '../src/secret.js';
import { columnTypes, summarize, outline } from '../src/data-panel.js';

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



// ---- F10: the encoder must not write a block the decoder refuses ----------------------------------------------------------
test('F10 encode: input nested deeper than a data block can hold is refused when it is written (it used to be written, and the block then did not read back; sealed, it never opened)', async () => {
  const E = (text, fmt) => encode({ bytes: enc.encode(text), name: 'x.' + fmt, format: fmt }, { created: false });
  await assert.rejects(E('<a>'.repeat(100) + 'x' + '</a>'.repeat(100), 'xml'), (e) => e instanceof TgdError && e.code === 'limit');
  await assert.rejects(E('['.repeat(64) + ']'.repeat(64), 'json'), (e) => e.code === 'limit');
  await assert.rejects(E(Array.from({ length: 40 }, (_, i) => ' '.repeat(2 * i) + '- a').join('\n'), 'md'), (e) => e.code === 'limit');
  const ok = await E('<a>'.repeat(40) + 'x' + '</a>'.repeat(40), 'xml');
  assert.equal((await decode(ok.text)).model.root[0], 'a');
});
test('F10 encode: whatever depth the input has, a block that was written can be read (xml, json, markdown, yaml: depths 1 to 70)', async () => {
  const gens = { xml: (d) => '<a>'.repeat(d) + 'x' + '</a>'.repeat(d), json: (d) => '['.repeat(d) + '12345678901234567890' + ']'.repeat(d), md: (d) => Array.from({ length: d }, (_, i) => ' '.repeat(2 * i) + '- a').join('\n'), yaml: (d) => Array.from({ length: d }, (_, i) => ' '.repeat(2 * i) + 'k:').join('\n') + ' 1' };
  for (const [fmt, mk] of Object.entries(gens)) {
    let written = 0;
    for (let d = 1; d <= 70; d++) {
      let r; try { r = await encode({ bytes: enc.encode(mk(d)), name: 'x.' + fmt, format: fmt }, { created: false }); } catch (e) { assert.equal(e.code, 'limit'); continue; }
      written++;
      await decode(r.text); // throws if the block cannot be read back
    }
    assert.ok(written >= 20, `${fmt}: only ${written} depths were written`);
  }
});
test('F10 seal: more than 4 000 000 values, a text of more than 8 000 000 characters and a nesting of 70 levels are refused by the encoder, as the decoder would refuse them', async () => {
  await assert.rejects(seal({ kind: 'json', value: new Array(4_000_001).fill(0) }, { created: false }), (e) => e.code === 'limit' && /values/.test(e.message));
  await assert.rejects(seal({ kind: 'json', value: 'a'.repeat(8_000_001) }, { created: false }), (e) => e.code === 'limit');
  let deep = [1]; for (let i = 0; i < 70; i++) deep = [deep];
  await assert.rejects(seal({ kind: 'json', value: deep }, { created: false }), (e) => e.code === 'limit' && /nested/.test(e.message));
  assert.match(await seal({ kind: 'json', value: [1, 'a'.repeat(1000)] }, { created: false }), /^TGD1\[/);
});


test('F11 sealData: a block that the decoder would refuse (a changed checksum) is not sealed, because its key would open it and then report not-tgd', async () => {
  const good = (await encode({ bytes: enc.encode('a,b\n1,2\n'), name: 'x.csv', format: 'csv' }, { created: false })).text;
  const sealed = await sealData('A work text', good, {});
  assert.equal((await openSealed('A work text', { key: sealed.key, record: sealed.record })).block.model.kind, 'workbook');
  const bad = good.replace(/"sum":"([0-9a-f])/, (m, c) => `"sum":"${c === '0' ? '1' : '0'}`);
  assert.notEqual(bad, good);
  await assert.rejects(sealData('A work text', bad, {}), (e) => e.code === 'not-tgd');
});


// ---- F12: the outline of a block whose model has an unexpected shape ----------------------------------------------------------
test('F12 outline: calendar, contact, key=value and Markdown models of an unexpected shape are outlined or skipped, never a TypeError (a hostile block in a work took the whole Machine view down)', () => {
  const shapes = [
    { kind: 'vcard', items: [{ name: 'VCARD', p: 'VCARD' }] }, { kind: 'icalendar', items: [{ c: 'VEVENT', p: [1, null, ['SUMMARY', 'x']], k: 5 }, null, 7] }, { kind: 'icalendar', items: 'no' },
    { kind: 'kv', pairs: [1, null, ['a']] }, { kind: 'kv', pairs: 'no' }, { kind: 'markdown', blocks: [null, 3, { t: 'h', l: 'x', x: 1 }, { t: 'table', rows: 5, head: 'no' }, { t: 'ul', items: 3 }] }, { kind: 'markdown', blocks: 'no' },
    { kind: 'xml', root: 'no' }, { kind: 'xml', root: [1, 2, 3] }, { kind: 'json' },
  ];
  for (const m of shapes) outline(m);
  assert.ok(outline({ kind: 'icalendar', items: [{ c: 'VEVENT', p: [['SUMMARY', 'Dentist']] }] })[0].text.includes('Dentist'));
});

// ---- tripwires: the places that handle keys and decrypted data keep their hygiene -------------------------------------------
test('tripwire: the code that handles keys, records and decrypted data uses no HTML sink, eval, browser storage, console output or Math.random', () => {
  const files = ['data-ui.js', 'data-panel.js', 'data-panel-ui.js', 'data-reader-ui.js', 'crypt.js', 'crypt-codec.js', 'crypt-book.js', 'keys.js', 'keys-kdf.js', 'keys-seal.js', 'keys-work.js', 'keys-split.js', 'secret.js',
    'structured.js', 'structured-json.js', 'structured-model.js', 'structured-formats.js', 'structured-csv.js', 'structured-xlsx.js', 'structured-md.js', 'structured-xml.js', 'structured-yaml.js', 'structured-lines.js', 'structured-zip.js'];
  const bad = /\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write|\beval\s*\(|new Function|\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bconsole\.|Math\.random|\bdocument\.cookie\b/;
  for (const f of files) {
    const src = readFileSync(new URL('../src/' + f, import.meta.url), 'utf8').split('\n');
    src.forEach((line, i) => { if (!line.trim().startsWith('//') && !line.trim().startsWith('*') && bad.test(line)) assert.fail(`src/${f}:${i + 1}: ${line.trim().slice(0, 100)}`); });
  }
});
test('tripwire: the generator page sets the message of an error as text, never as markup (F9)', () => {
  const js = readFileSync(new URL('../assets/js/app.js', import.meta.url), 'utf8');
  assert.match(js, /s\.textContent = e\.message \|\| String\(e\)/);
  assert.doesNotMatch(js, /innerHTML = chip\([^)]*e\.message/);
  const html = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")/, 'no inline script: the CSP allows none');
});

