// The non-DOM logic of the two data panels (docs/structured-data-ui.md, docs/encrypted-data.md section 9): the generator's
// "Data in this work" panel (app.html) and the Machine view's data cards (work.html). Everything here is pure, so it runs in
// Node and is unit-tested (test/data-panel.test.js): summarising a model, a preview of its cells, the column types, capacity
// against the page, warnings, the wording in English and German, and every error mapped to a message that says what to do.
// The DOM glue is src/data-panel-ui.js (generator) and src/data-reader-ui.js (work page).
import { gridOf, colName, parseAddr, cellText } from './structured-model.js';
import { FORMATS, detectFormat } from './structured-formats.js';
import { keepLiteral, modelJson, READ_NOTE } from './structured.js';

// ---- formats ------------------------------------------------------------------------------------------------------
/** The file types the web panel takes (the library also reads `kv`, a settings file: not offered here, see the docs). */
export const WEB_FORMATS = ['xlsx', 'csv', 'tsv', 'json', 'md', 'yaml', 'xml', 'ics', 'vcf'];
export const ACCEPT = WEB_FORMATS.flatMap((id) => FORMATS[id].ext).join(',');
const LABELS = { xlsx: 'Excel', csv: 'CSV', tsv: 'TSV', json: 'JSON', md: 'Markdown', yaml: 'YAML', xml: 'XML', ics: 'iCalendar', vcf: 'vCard', kv: 'Settings file' };
export const formatLabel = (id) => LABELS[id] || String(id || '?').toUpperCase();

/** The format of a chosen file for the web panel, or null (unknown type, or one the panel does not offer). */
export function detectWebFormat(name, bytes) {
  const id = detectFormat(name, bytes);
  return id && WEB_FORMATS.includes(id) ? id : null;
}

// ---- capacity -----------------------------------------------------------------------------------------------------
/** One A4 page (docs/structured-data.md section 6): about 600 000 characters, type size about 345 / sqrt(N) mm. */
export const PAGE = { chars: 600000, amberMm: 1 };
export const typeMm = (n) => (n > 0 ? 345 / Math.sqrt(n) : 0);
/**
 * How much of a page `chars` characters take. `state`: 'ok', 'tight' (type below 1 mm, about 120 000 characters, still legible
 * with zoom) or 'over' (above 600 000: machine-readable at best, so the data text is refused).
 */
export function capacity(chars) {
  const share = chars / PAGE.chars, mm = typeMm(chars);
  return { chars, cap: PAGE.chars, share, mm, state: chars > PAGE.chars ? 'over' : mm < PAGE.amberMm ? 'tight' : 'ok', ratio: Math.round(share * 10) / 10 };
}

// ---- summaries ----------------------------------------------------------------------------------------------------
const isTyped = (v) => v && typeof v === 'object' && !Array.isArray(v) && typeof v.$ === 'string';
export function cellKind(v) {
  if (v === null || v === undefined) return 'empty';
  if (typeof v === 'string') return 'text';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'number') return 'number';
  if (isTyped(v)) return { n: 'number', d: 'date', dt: 'date', t: 'date', e: 'error', f: 'formula' }[v.$] || 'text';
  return 'text';
}

/** True if the sheet has a header: the encoder's hint, or (CSV carries none) a first row of distinct non-empty text above more rows. */
export function hasHeader(sheet) {
  if (sheet.header) return true;
  const rows = sheet.rows;
  if (!Array.isArray(rows) || rows.length < 2 || !rows[0].length) return false;
  const first = rows[0];
  return first.every((v) => typeof v === 'string' && v.trim() !== '') && new Set(first).size === first.length;
}

/** Rows and columns of one sheet without building a dense grid (a sparse sheet can be huge). */
function sheetStats(sheet) {
  let rows = 0, cols = 0, cells = 0, formulas = 0, longest = 0;
  const see = (v) => {
    if (v === null || v === undefined) return;
    cells++;
    if (isTyped(v) && v.$ === 'f') formulas++;
    const len = typeof v === 'string' ? v.length : 0;
    if (len > longest) longest = len;
  };
  if (Array.isArray(sheet.rows)) {
    rows = sheet.rows.length;
    for (const r of sheet.rows) { if (r.length > cols) cols = r.length; r.forEach(see); }
  } else {
    for (const [a, v] of Object.entries(sheet.cells || {})) {
      let p;
      try { p = parseAddr(a); } catch { continue; }
      if (p.r + 1 > rows) rows = p.r + 1;
      if (p.c + 1 > cols) cols = p.c + 1;
      see(v);
    }
  }
  return { rows, cols, cells, formulas, longest };
}

function countNodes(v, limit = 2e6) {
  let n = 0;
  const go = (x) => {
    if (n > limit) return;
    n++;
    if (Array.isArray(x)) x.forEach(go);
    else if (x && typeof x === 'object') Object.values(x).forEach(go);
  };
  go(v);
  return n;
}

/** What a data model holds, in numbers: for the title line, the preview and the warnings. */
export function summarize(model, format) {
  const kind = model?.kind;
  const base = { kind, format };
  if (kind === 'workbook') {
    const sheets = (model.sheets || []).map((s) => ({ name: s.name, hidden: !!s.state, header: hasHeader(s), ...sheetStats(s) }));
    const sum = (k) => sheets.reduce((n, s) => n + s[k], 0);
    return { ...base, sheets, rows: sum('rows'), cells: sum('cells'), formulas: sum('formulas'), longestCell: Math.max(0, ...sheets.map((s) => s.longest)) };
  }
  if (kind === 'json') return { ...base, nodes: countNodes(model.value) };
  if (kind === 'markdown') {
    const blocks = model.blocks || [];
    return { ...base, blocks: blocks.length, headings: blocks.filter((b) => b.t === 'h').length };
  }
  if (kind === 'xml') return { ...base, elements: countNodes(model.root) };
  if (kind === 'icalendar' || kind === 'vcard') return { ...base, items: (model.items || []).length };
  if (kind === 'kv') return { ...base, items: (model.pairs || []).length };
  return base;
}

/** The title line of a file: "Excel · 2 sheets · 63 rows · 296 cells". */
export function summaryLine(summary, lang) {
  const parts = [formatLabel(summary.format)];
  if (summary.kind === 'workbook') parts.push(count(lang, 'sheet', summary.sheets.length), count(lang, 'row', summary.rows), count(lang, 'cell', summary.cells));
  else if (summary.kind === 'json') parts.push(count(lang, 'value', summary.nodes));
  else if (summary.kind === 'markdown') parts.push(count(lang, 'block', summary.blocks), count(lang, 'heading', summary.headings));
  else if (summary.kind === 'xml') parts.push(count(lang, 'element', summary.elements));
  else if (summary.items !== undefined) parts.push(count(lang, 'entry', summary.items));
  return parts.join(' \u00b7 ');
}

/** The "nothing to write" test: a file that holds no cells, entries or blocks. */
export function isEmptyModel(summary) {
  if (summary.kind === 'workbook') return summary.cells === 0;
  if (summary.kind === 'markdown') return summary.blocks === 0;
  if (summary.kind === 'icalendar' || summary.kind === 'vcard' || summary.kind === 'kv') return summary.items === 0;
  if (summary.kind === 'xml') return false;
  return false;
}

// ---- cells, previews, types ---------------------------------------------------------------------------------------
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
/** A cell for display: { text, kind, full } (`kind`: empty text number date boolean formula error), `noValue` for a formula with no cached value. */
export function cellInfo(v, { max = 60, noValue = '(no value)' } = {}) {
  const kind = cellKind(v);
  if (kind === 'empty') return { text: '', kind, full: '' };
  let full;
  if (kind === 'formula') {
    const cached = v.v === undefined ? null : v.v;
    full = `=${v.f} → ${cached === null ? noValue : cellText(cached)}`;
  } else if (kind === 'boolean') full = v ? 'TRUE' : 'FALSE';
  else if (typeof v === 'string') full = v;
  else full = cellText(v);
  return { text: clip(full.replace(/\s+/g, ' '), max), kind, full };
}

/**
 * The first `maxRows` used rows of a sheet as { n: row number, cells: [info …] }, at most `maxCols` columns, plus how many
 * rows and columns were left out. Dense and sparse sheets alike (a sparse sheet lists only rows that hold something).
 */
export function sheetPreview(sheet, { maxRows = 8, maxCols = 12, noValue } = {}) {
  let list, total;
  if (Array.isArray(sheet.rows)) {
    total = sheet.rows.length;
    list = sheet.rows.slice(0, maxRows).map((cells, i) => ({ n: i + 1, cells }));
  } else {
    const byRow = new Map();
    for (const [a, v] of Object.entries(sheet.cells || {})) {
      let p;
      try { p = parseAddr(a); } catch { continue; }
      if (!byRow.has(p.r)) byRow.set(p.r, []);
      byRow.get(p.r)[p.c] = v;
    }
    const ks = [...byRow.keys()].sort((a, b) => a - b);
    total = ks.length;
    list = ks.slice(0, maxRows).map((r) => ({ n: r + 1, cells: Array.from(byRow.get(r), (v) => (v === undefined ? null : v)) }));
  }
  const width = Math.max(1, ...list.map((r) => r.cells.length));
  const cols = Math.min(width, maxCols);
  return {
    columns: Array.from({ length: cols }, (_, c) => colName(c)),
    rows: list.map((r) => ({ n: r.n, cells: Array.from({ length: cols }, (_, c) => cellInfo(r.cells[c] ?? null, { noValue })) })),
    moreRows: Math.max(0, total - list.length),
    moreCols: Math.max(0, width - cols),
  };
}

/** The types found in each column of a sheet: [{ col, header, kinds: { text: n, … }, main }] (the header row is not counted). */
export function columnTypes(sheet, { maxRows = 5000 } = {}) {
  let grid;
  try { grid = gridOf({ ...sheet, rows: Array.isArray(sheet.rows) ? sheet.rows.slice(0, maxRows) : undefined }, { maxDense: 2e6 }); } catch { return []; }
  const width = Math.max(0, ...grid.map((r) => (r ? r.length : 0)));
  const out = [];
  for (let c = 0; c < width; c++) {
    const kinds = {};
    let header = null;
    grid.slice(0, maxRows).forEach((row, i) => {
      const v = row ? row[c] ?? null : null;
      if (i === 0 && hasHeader(sheet)) { header = v === null ? null : cellText(v); return; }
      const k = cellKind(v);
      if (k !== 'empty') kinds[k] = (kinds[k] || 0) + 1;
    });
    const main = Object.entries(kinds).sort((a, b) => b[1] - a[1])[0]?.[0] || 'empty';
    out.push({ col: colName(c), header, kinds, main });
  }
  return out;
}

/** An indented outline of a model that is not a workbook (JSON, Markdown, XML, calendar, contacts): [{ depth, text }], at most `max` lines. */
export function outline(model, max = 200) {
  const out = [];
  const add = (depth, text) => { if (out.length < max) out.push({ depth, text: clip(String(text), 120) }); return out.length < max; };
  const describe = (x) => (Array.isArray(x) ? `[${x.length}]` : x && typeof x === 'object' ? `{${Object.keys(x).length}}` : x === null ? 'null' : typeof x === 'string' ? JSON.stringify(clip(x, 60)) : String(x));
  const walkJson = (x, depth, key) => {
    if (out.length >= max || depth > 6) return;
    if (Array.isArray(x)) {
      add(depth, `${key === undefined ? '' : key + ': '}array of ${x.length}`);
      x.slice(0, 5).forEach((y, i) => walkJson(y, depth + 1, String(i)));
      if (x.length > 5) add(depth + 1, `… ${x.length - 5}`);
    } else if (x && typeof x === 'object' && !isTyped(x)) {
      add(depth, `${key === undefined ? '' : key + ': '}object with ${Object.keys(x).length} keys`);
      for (const [k, y] of Object.entries(x).slice(0, 40)) walkJson(y, depth + 1, k);
    } else add(depth, `${key === undefined ? '' : key + ': '}${isTyped(x) ? `${x.$}:${x.v}` : describe(x)}`);
  };
  const walkXml = (el, depth) => {
    if (!Array.isArray(el) || out.length >= max || depth > 8) return;
    const attrs = el[1] && typeof el[1] === 'object' && !Array.isArray(el[1]) ? el[1] : null;
    add(depth, `<${el[0]}${attrs ? ' ' + Object.entries(attrs).slice(0, 4).map(([k, v]) => `${k}="${clip(String(v), 20)}"`).join(' ') : ''}>`);
    for (const ch of el.slice(attrs ? 2 : 1)) {
      if (typeof ch === 'string') { if (ch.trim()) add(depth + 1, JSON.stringify(clip(ch.trim(), 60))); } else walkXml(ch, depth + 1);
    }
  };
  const walkItem = (item, depth) => {
    if (out.length >= max || depth > 6) return;
    const props = item.p || [];
    const hint = props.find((p) => ['SUMMARY', 'FN', 'N', 'UID'].includes(p[0]));
    add(depth, `${item.c}${hint ? ` – ${hint[1]}` : ''} (${props.length})`);
    (item.k || []).forEach((k) => walkItem(k, depth + 1));
  };
  switch (model?.kind) {
    case 'json': walkJson(model.value, 0); break;
    case 'xml': walkXml(model.root, 0); break;
    case 'markdown':
      for (const b of model.blocks || []) {
        if (b.t === 'h') add(Math.max(0, b.l - 1), `${'#'.repeat(b.l)} ${b.x}`);
        else if (b.t === 'p') add(0, b.x);
        else if (b.t === 'table') add(0, `table ${(b.rows || []).length + 1}×${(b.head || []).length}`);
        else if (b.t === 'ul' || b.t === 'ol') add(0, `${b.t === 'ul' ? 'list' : 'numbered list'} of ${(b.items || []).length}`);
        else if (b.t === 'code') add(0, `code${b.lang ? ' ' + b.lang : ''}`);
        else add(0, b.t);
        if (out.length >= max) break;
      }
      break;
    case 'icalendar': case 'vcard': (model.items || []).forEach((i) => walkItem(i, 0)); break;
    case 'kv': (model.pairs || []).slice(0, max).forEach(([k]) => add(0, k)); break;
    default: break;
  }
  return out;
}

// ---- composing the work's text ------------------------------------------------------------------------------------
/** The text a work is set from: [lead-in] [my text] block. `placement`: 'after' (my text, then the data) or 'only' (lead-in, then the data). */
export function composeWork({ prose = '', lead = '', block = '', placement = 'after' }) {
  const parts = placement === 'only' ? [lead.trim(), block] : [lead.trim(), String(prose).trim(), block];
  return parts.filter(Boolean).join('\n\n');
}

/** Formats a decoded block can be written as, the source format first: [{ id, label, primary }]. */
export function exportFormats(kind, source) {
  const ids = Object.values(FORMATS).filter((f) => f.id !== 'kv' && f.kinds.includes(kind)).map((f) => f.id);
  if (source && ids.includes(source)) ids.sort((a, b) => (b === source) - (a === source));
  return ids.map((id) => ({ id, label: '.' + FORMATS[id].ext[0].slice(1), primary: id === source }));
}

/** The decoded block as the `.tgd.json` form (the same as `tg-data decode`): envelope members plus the exact data, pretty. */
// The copied JSON carries the same one-line reading note as the block, so it stays self-describing wherever it is pasted.
export const blockJson = (block) => modelJson({ data: new Map([['tgd', block.version], ['format', block.format], ['name', block.name], ['sum', block.sum], ['read', READ_NOTE], ['data', block.data]]) });

/** A file name from the block's name with a new extension; no path, no control characters. */
export function downloadName(name, ext) {
  const stem = String(name || 'data').replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '').replace(/[^\p{L}\p{N}._ -]+/gu, '-').replace(/^[.-]+/, '').slice(0, 80) || 'data';
  return `${stem}${ext.startsWith('.') ? ext : '.' + ext}`;
}

// ---- wording ------------------------------------------------------------------------------------------------------
const COUNT = {
  en: { sheet: ['sheet', 'sheets'], row: ['row', 'rows'], cell: ['cell', 'cells'], column: ['column', 'columns'], value: ['value', 'values'], block: ['block', 'blocks'], heading: ['heading', 'headings'], element: ['element', 'elements'], entry: ['entry', 'entries'], char: ['character', 'characters'] },
  de: { sheet: ['Blatt', 'Blätter'], row: ['Zeile', 'Zeilen'], cell: ['Zelle', 'Zellen'], column: ['Spalte', 'Spalten'], value: ['Wert', 'Werte'], block: ['Block', 'Blöcke'], heading: ['Überschrift', 'Überschriften'], element: ['Element', 'Elemente'], entry: ['Eintrag', 'Einträge'], char: ['Zeichen', 'Zeichen'] },
};
export const intFmt = (n, lang) => Number(n).toLocaleString(lang === 'de' ? 'de-CH' : 'en-US');
/** "3 sheets" / "1 Blatt": a number with its noun in the right form. */
export const count = (lang, noun, n) => `${intFmt(n, lang)} ${COUNT[lang][noun][n === 1 ? 0 : 1]}`;

const EN = {
  // --- generator panel
  'd.summary': 'Data in this work',
  'd.intro': 'Attach a spreadsheet or another data file. It becomes text inside the work (readable by people and machines, with a checksum), or it is sealed with a key and the work stays as it is. Everything happens in this browser; nothing is uploaded.',
  'd.choose': 'Choose a file …', 'd.drop': 'or drop it here', 'd.types': 'Excel, CSV, TSV, JSON, Markdown, YAML, XML, iCalendar, vCard',
  'd.sampleLead': 'Try it with a sample:', 'd.sampleCsv': 'Bakery orders (CSV)', 'd.sampleXlsx': 'Bakery orders (Excel)',
  'd.reading': 'Reading {name} …', 'd.remove': 'Remove', 'd.previewTitle': 'What the file holds',
  'd.sheetLine': 'Sheet “{name}” · {cols} × {rows} · {header}', 'd.hasHeader': 'has a header', 'd.noHeader': 'no header', 'd.hiddenSheet': 'hidden',
  'd.more': '… {n} more rows', 'd.moreCols': '+ {n} more columns', 'd.noValue': '(no value)', 'd.sheets': 'Sheets',
  'd.space': 'Space', 'd.spaceOf': '{used} of {cap} characters · type about {mm} mm on A4',
  'd.fitsOk': 'Fits comfortably.', 'd.fitsTight': 'Fits, but the letters become small: about {mm} mm. Use fewer sheets or rows to make them bigger.',
  'd.fitsOver': 'This does not fit on one page.', 'd.fitsOverBody': 'The data needs {x} times the space of a page (about 600,000 characters). Leave out sheets or rows, or seal it: a sealed record does not have to fit in the picture.',
  'd.lost': 'Not carried over: {list}.', 'd.lostDetails': 'Details', 'd.types2': 'Types in each column',
  'd.choice': 'How should the data go into the work?',
  'd.optText': 'Put it into the work’s text', 'd.optTextHelp': 'The picture is then formed by the data text. People see the picture; a machine reads the table back out of the text, with a checksum.',
  'd.optSeal': 'Seal it (encrypted)', 'd.optSealHelp': 'AES-256-GCM. The work’s text stays as it is. You get a key and a sealed record; only the key opens it, and only together with this exact work.',
  'd.afterText': 'Add it after my text', 'd.dataOnly': 'Use only the data', 'd.lead': 'Title or short lead-in (optional)', 'd.leadHint': 'Placed before the data. The picture is formed from the whole text.',
  'd.attach': 'Also keep the original file inside the work (+33 %)', 'd.plain': 'Write all characters as they are (readable, but not guaranteed exact for rare scripts)',
  'd.pad': 'Hide the exact size', 'd.pad0': 'no padding', 'd.padN': 'round up to {n} KiB', 'd.deflate': 'Compress before sealing',
  'd.write': 'Write the data into the work', 'd.seal': 'Seal the data', 'd.working': 'Working …',
  'd.written': '✔ The data is in the work’s text now ({chars} characters). Checked: it comes back out of the text exactly (sha256 {sum}).', 'd.removed': 'The data is no longer part of the work.', 'd.removeFromWork': 'Remove the data from the work',
  'd.checkFailTitle': 'The data does not read back from this work', 'd.checkFailBody': 'The text the page produced does not decode to the data ({message}). The work is not a reliable carrier for this file as it is.', 'd.checkFailRetry': 'Write all characters as \\u codes and try again',
  'd.sealed': 'Sealed. Key: {k} characters, record: {r} characters. The work’s text was not changed.',
  'd.keyReminder': 'The key is shown only here and is not stored anywhere. Copy it now: if it is lost, nobody can open the data.',
  'd.keyLabel': 'Key', 'd.recordLabel': 'Sealed record', 'd.copyKey': 'Copy key', 'd.copyRecord': 'Copy record', 'd.downloadRecord': 'Download record (.tgs)', 'd.clearKey': 'Clear key',
  'd.keyCopied': 'Key copied.', 'd.recordCopied': 'Record copied.', 'd.copyFail': 'Could not copy: select the text and copy it by hand.', 'd.keyCleared': 'The key is cleared from this page.', 'd.recordSaved': 'Record saved.',
  'd.sealStale': 'The work’s text changed after you sealed. This key no longer opens it with the new text. Seal again.',
  'd.sealNeedWork': 'There is no work yet: type a text and wait until the picture is set, then seal.',
  'd.sealWhy': 'A key fits exactly one work: save or export the work as it is now, and keep the key with it. Open it on the Machine page of the work.',
  'd.warnScripts': 'Some cells contain characters from scripts such as Chinese, Japanese kanji, Arabic or Hebrew. They are written as \\u codes so that they come back exactly. The data stays complete, but is harder to read as plain text.',
  'd.warnFormulas': '{n} cells hold formulas. Formula and last calculated value are both kept.',
  'd.warnLongCell': 'One cell has {n} characters. It fits, but the table gets hard to read.',
  'd.warnProse': 'The data block sits after your text and counts toward the space above.',
  'd.warnHidden': 'Hidden sheets are included.',
  // --- errors under the choose button (generator)
  'e.format': ['This file type is not supported', '{name} is not one of: Excel, CSV, TSV, JSON, Markdown, YAML, XML, iCalendar, vCard.'],
  'e.encoding': ['The file is not in UTF-8', 'Text files from older programs are often Windows-1252 or ISO-8859-1. Choose the encoding and read the file again.'],
  'e.syntax': ['The file could not be read', '{message}'],
  'e.zip': ['This Excel file looks damaged or unsafe', 'It was not read. {message}'],
  'e.limit': ['The file is too large', '{message} A work holds about 600,000 characters of data on one A4 page.'],
  'e.empty': ['The file holds no data', 'No cells, rows or entries were found.'],
  'e.unknown': ['The file could not be read', 'Something unexpected happened ({message}). The file was not used.'],
  'e.fileTooBig': ['The file is too large', 'The file has {size} MiB; this page reads at most {max} MiB. A work holds about 600,000 characters of data on one A4 page.'],
  'e.readAgain': 'Read again', 'e.encodingLabel': 'Encoding',
  // --- errors of a data block (work page)
  'b.checksum': ['The data in this work was changed or is damaged', 'The checksum stored in the data block does not match its content. This happens when the text was edited, cut off, or read wrongly from a PDF. The data is not shown, because it cannot be trusted.'],
  'b.unterminated': ['The data block is cut off', 'The block starts at character {offset} but has no end. The text was probably shortened.'],
  'b.version': ['This data needs a newer reader', 'This page reads TGD version 1. {message}'],
  'b.syntax': ['The data block is not valid', '{message}'],
  'b.limit': ['The data is too large for this page', '{message} Reading it here could freeze your browser.'],
  'b.none': ['This work carries no data', 'No TGD data block was found in its text.'],
  'b.format': ['This data cannot be written as {format}', '{message}'],
  'b.zip': ['This file looks damaged or unsafe', '{message}'],
  'b.unknown': ['The data could not be shown', '{message}'],
  // --- errors of opening sealed data (all appear under the Open button)
  'o.no-key': 'Paste the key first. It starts with “tgx2.” (older keys: “tgx1.”).',
  'o.bad-prefix': 'This is not a key. A key starts with “tgx2.”, “tgx1.”, “tg2.” or “tg1.”.',
  'o.bad-record': 'This is not a sealed record. A record starts with “tgs1.”.',
  'o.checksum': 'The key has a typing error. Copy it again in full.',
  'o.damaged': 'The key or the record is damaged or incomplete. Copy it again in full.',
  'o.wrong-work': 'This key belongs to a different work, or the text was changed. Open the work the key was made for.',
  'o.work-required': 'This key is tied to a work. Open the work first (or choose its file below).',
  'o.no-record': 'This key does not contain the data. Paste the sealed record too (it starts with “tgs1.”).',
  'o.auth-failed': 'The key does not open this record, or the record was changed. Check that the key and the record belong together.',
  'o.too-large': 'The data is too large to open here.',
  'o.unsupported-compression': 'This record uses a compression your browser cannot read. Open it with tg-crypt.',
  'o.need-password': 'This record is sealed with a password, not a key. Open it with tg-crypt.',
  'o.version': 'This key or record was made by a newer version. Open it with the current tg-crypt.',
  'o.not-tgd': 'The record opened, but what is inside is not valid structured data.',
  'o.unterminated': 'A sealed block in this work starts but does not end. The text was probably shortened.',
  'o.unknown': 'The record could not be opened.',
  'o.title': 'Could not open', 'o.opened': 'Opened. The data block is intact (sha256 {sum}).', 'o.openedText': 'Opened. The record holds a message, not a data block:',
  // --- work page cards
  'r.data': 'Data', 'r.verified': 'Verified', 'r.verifiedLong': 'The data below is exactly what was stored in this work.', 'r.created': 'created {date}',
  'r.tabTable': 'Table', 'r.tabModel': 'Model', 'r.tabText': 'Text', 'r.sheets': 'Sheets', 'r.hidden': 'hidden',
  'r.counts': '{rows} · {cols}', 'r.merged': 'merged: {list}', 'r.comments': 'comments: {list}', 'r.moreRows': 'Show more rows', 'r.rowsShown': '{shown} of {total} rows shown',
  'r.csvSheet': 'Sheet for CSV and TSV', 'r.openedBytes': 'Opened. The record holds a file of {n} bytes.', 'r.saveFile': 'Save the file', 'r.download': 'Download', 'r.downloadModel': '.tgd.json (model)', 'r.formulas': 'write formulas (only for data you trust)', 'r.copy': 'Copy', 'r.copyBlock': 'Block text', 'r.copyModel': 'Model as JSON',
  'r.copied': 'Copied.', 'r.copyFail': 'Could not copy: select the text and copy it by hand.', 'r.copySum': 'Copy checksum', 'r.downloaded': 'Downloaded {name}.',
  'r.guard': '{n} cells starting with = + - @ got a leading ’ so that a spreadsheet shows them as text.', 'r.guardOff': 'Download without the guard', 'r.guardOffConfirm': 'Only do this for data you trust.', 'r.guardOffYes': 'Yes, download without the guard',
  'r.lost': 'Not carried over: {list}.', 'r.inRead': 'Data: {name} · open in Machine', 'r.showBlock': 'Show the block text', 'r.downloadBlock': 'Download the block text', 'r.code': 'Code: {code}',
  'r.structure': 'Structure', 'r.types': 'Types',
  'r.sealedH': 'Sealed data', 'r.sealedHelp': 'Paste the key and, if it is not inside the key or this work, the sealed record. The key stays in this page: it is not sent anywhere, not put into the address and not stored.',
  'r.keyLabel': 'Key (starts with tgx2. or tgx1.)', 'r.recordLabel': 'Sealed record (starts with tgs1.)', 'r.open': 'Open', 'r.clearKey': 'Clear key', 'r.keyCleared': 'The key is cleared from this page.',
  'r.recordFile': 'Load a record file (.tgs)', 'r.recordFromWork': 'The record was found in this work’s text.', 'r.working': 'Opening …',
  'r.localH': 'Open a work file from your computer', 'r.localHelp': 'A work you saved (.svg, .html or .pdf) can be read here without uploading it: its text is read in this browser, and any data in it is shown below.',
  'r.localChoose': 'Choose a work file …', 'r.localLoaded': 'Read {name}: {chars} characters.', 'r.localFail': 'This file could not be read as a work ({message}).', 'r.noWorkTitle': 'Open a work file', 'r.noWorkBody': 'No work was given in the address. Choose a work file below to see the data in it.',
  'r.noData': 'This work carries no data block.',
  'r.openedMessage': 'Message:',
};
const DE = {
  'd.summary': 'Daten in diesem Werk',
  'd.intro': 'Hänge eine Tabelle oder eine andere Datendatei an. Sie wird zu Text im Werk (für Menschen und Maschinen lesbar, mit Prüfsumme), oder sie wird mit einem Schlüssel versiegelt und das Werk bleibt, wie es ist. Alles geschieht in diesem Browser; nichts wird hochgeladen.',
  'd.choose': 'Datei wählen …', 'd.drop': 'oder hierher ziehen', 'd.types': 'Excel, CSV, TSV, JSON, Markdown, YAML, XML, iCalendar, vCard',
  'd.sampleLead': 'Mit einem Beispiel ausprobieren:', 'd.sampleCsv': 'Bäckerei-Bestellungen (CSV)', 'd.sampleXlsx': 'Bäckerei-Bestellungen (Excel)',
  'd.reading': '{name} wird gelesen …', 'd.remove': 'Entfernen', 'd.previewTitle': 'Das steht in der Datei',
  'd.sheetLine': 'Blatt „{name}“ · {cols} × {rows} · {header}', 'd.hasHeader': 'mit Kopfzeile', 'd.noHeader': 'ohne Kopfzeile', 'd.hiddenSheet': 'ausgeblendet',
  'd.more': '… {n} weitere Zeilen', 'd.moreCols': '+ {n} weitere Spalten', 'd.noValue': '(kein Wert)', 'd.sheets': 'Blätter',
  'd.space': 'Platz', 'd.spaceOf': '{used} von {cap} Zeichen · Schrift etwa {mm} mm auf A4',
  'd.fitsOk': 'Passt bequem.', 'd.fitsTight': 'Passt, aber die Buchstaben werden klein: etwa {mm} mm. Mit weniger Blättern oder Zeilen werden sie größer.',
  'd.fitsOver': 'Das passt nicht auf eine Seite.', 'd.fitsOverBody': 'Die Daten brauchen das {x}-fache einer Seite (etwa 600 000 Zeichen). Blätter oder Zeilen weglassen, oder versiegeln: Ein versiegelter Datensatz muss nicht ins Bild passen.',
  'd.lost': 'Nicht übernommen: {list}.', 'd.lostDetails': 'Einzelheiten', 'd.types2': 'Typen je Spalte',
  'd.choice': 'Wie sollen die Daten in das Werk?',
  'd.optText': 'In den Text des Werks schreiben', 'd.optTextHelp': 'Das Bild entsteht dann aus dem Datentext. Menschen sehen das Bild; eine Maschine liest die Tabelle mit Prüfsumme aus dem Text zurück.',
  'd.optSeal': 'Versiegeln (verschlüsseln)', 'd.optSealHelp': 'AES-256-GCM. Der Text des Werks bleibt, wie er ist. Du erhältst einen Schlüssel und einen versiegelten Datensatz; nur der Schlüssel öffnet ihn, und nur zusammen mit genau diesem Werk.',
  'd.afterText': 'Nach meinem Text anhängen', 'd.dataOnly': 'Nur die Daten verwenden', 'd.lead': 'Titel oder kurze Einleitung (optional)', 'd.leadHint': 'Steht vor den Daten. Das Bild entsteht aus dem ganzen Text.',
  'd.attach': 'Die Originaldatei zusätzlich im Werk aufbewahren (+33 %)', 'd.plain': 'Alle Zeichen unverändert schreiben (lesbar, aber bei seltenen Schriften nicht garantiert exakt)',
  'd.pad': 'Genaue Größe verbergen', 'd.pad0': 'ohne Auffüllen', 'd.padN': 'auf {n} KiB aufrunden', 'd.deflate': 'Vor dem Versiegeln komprimieren',
  'd.write': 'Daten in das Werk schreiben', 'd.seal': 'Daten versiegeln', 'd.working': 'Wird bearbeitet …',
  'd.written': '✔ Die Daten stehen jetzt im Text des Werks ({chars} Zeichen). Geprüft: Sie kommen aus dem Text exakt zurück (sha256 {sum}).', 'd.removed': 'Die Daten sind nicht mehr Teil des Werks.', 'd.removeFromWork': 'Daten aus dem Werk entfernen',
  'd.checkFailTitle': 'Die Daten lassen sich aus diesem Werk nicht zurücklesen', 'd.checkFailBody': 'Der Text, den die Seite erzeugt hat, ergibt nicht die Daten ({message}). Das Werk ist so kein verlässlicher Träger für diese Datei.', 'd.checkFailRetry': 'Alle Zeichen als \\u-Codes schreiben und erneut versuchen',
  'd.sealed': 'Versiegelt. Schlüssel: {k} Zeichen, Datensatz: {r} Zeichen. Der Text des Werks wurde nicht verändert.',
  'd.keyReminder': 'Der Schlüssel wird nur hier angezeigt und nirgends gespeichert. Jetzt kopieren: Geht er verloren, kann niemand die Daten öffnen.',
  'd.keyLabel': 'Schlüssel', 'd.recordLabel': 'Versiegelter Datensatz', 'd.copyKey': 'Schlüssel kopieren', 'd.copyRecord': 'Datensatz kopieren', 'd.downloadRecord': 'Datensatz laden (.tgs)', 'd.clearKey': 'Schlüssel löschen',
  'd.keyCopied': 'Schlüssel kopiert.', 'd.recordCopied': 'Datensatz kopiert.', 'd.copyFail': 'Kopieren nicht möglich: Text markieren und von Hand kopieren.', 'd.keyCleared': 'Der Schlüssel ist von dieser Seite gelöscht.', 'd.recordSaved': 'Datensatz gespeichert.',
  'd.sealStale': 'Der Text des Werks hat sich nach dem Versiegeln geändert. Dieser Schlüssel öffnet es mit dem neuen Text nicht mehr. Bitte neu versiegeln.',
  'd.sealNeedWork': 'Es gibt noch kein Werk: Text eingeben und warten, bis das Bild gesetzt ist, dann versiegeln.',
  'd.sealWhy': 'Ein Schlüssel passt zu genau einem Werk: Das Werk so speichern oder exportieren, wie es jetzt ist, und den Schlüssel dazu aufbewahren. Geöffnet wird auf der Maschinen-Seite des Werks.',
  'd.warnScripts': 'Einige Zellen enthalten Zeichen aus Schriften wie Chinesisch, japanischen Kanji, Arabisch oder Hebräisch. Sie werden als \\u-Codes geschrieben, damit sie exakt zurückkommen. Die Daten bleiben vollständig, sind als Klartext aber schwerer lesbar.',
  'd.warnFormulas': '{n} Zellen enthalten Formeln. Formel und zuletzt berechneter Wert bleiben beide erhalten.',
  'd.warnLongCell': 'Eine Zelle hat {n} Zeichen. Sie passt, aber die Tabelle wird schwer lesbar.',
  'd.warnProse': 'Der Datenblock steht nach deinem Text und zählt zum Platz oben.',
  'd.warnHidden': 'Ausgeblendete Blätter sind enthalten.',
  'e.format': ['Dieser Dateityp wird nicht unterstützt', '{name} ist keiner von: Excel, CSV, TSV, JSON, Markdown, YAML, XML, iCalendar, vCard.'],
  'e.encoding': ['Die Datei ist nicht in UTF-8', 'Textdateien aus älteren Programmen sind oft Windows-1252 oder ISO-8859-1. Wähle die Kodierung und lies die Datei erneut.'],
  'e.syntax': ['Die Datei konnte nicht gelesen werden', '{message}'],
  'e.zip': ['Diese Excel-Datei wirkt beschädigt oder unsicher', 'Sie wurde nicht gelesen. {message}'],
  'e.limit': ['Die Datei ist zu groß', '{message} Ein Werk fasst etwa 600 000 Zeichen Daten auf einer A4-Seite.'],
  'e.empty': ['Die Datei enthält keine Daten', 'Es wurden keine Zellen, Zeilen oder Einträge gefunden.'],
  'e.unknown': ['Die Datei konnte nicht gelesen werden', 'Es ist etwas Unerwartetes passiert ({message}). Die Datei wurde nicht verwendet.'],
  'e.fileTooBig': ['Die Datei ist zu groß', 'Die Datei hat {size} MiB; diese Seite liest höchstens {max} MiB. Ein Werk fasst etwa 600 000 Zeichen Daten auf einer A4-Seite.'],
  'e.readAgain': 'Erneut lesen', 'e.encodingLabel': 'Kodierung',
  'b.checksum': ['Die Daten in diesem Werk wurden verändert oder sind beschädigt', 'Die im Datenblock gespeicherte Prüfsumme passt nicht zum Inhalt. Das passiert, wenn der Text bearbeitet, abgeschnitten oder aus einem PDF falsch gelesen wurde. Die Daten werden nicht angezeigt, weil man ihnen nicht trauen kann.'],
  'b.unterminated': ['Der Datenblock ist abgeschnitten', 'Der Block beginnt bei Zeichen {offset}, hat aber kein Ende. Der Text wurde wahrscheinlich gekürzt.'],
  'b.version': ['Diese Daten brauchen ein neueres Leseprogramm', 'Diese Seite liest TGD Version 1. {message}'],
  'b.syntax': ['Der Datenblock ist ungültig', '{message}'],
  'b.limit': ['Die Daten sind für diese Seite zu groß', '{message} Sie hier zu lesen könnte deinen Browser einfrieren.'],
  'b.none': ['Dieses Werk enthält keine Daten', 'Im Text wurde kein TGD-Datenblock gefunden.'],
  'b.format': ['Diese Daten lassen sich nicht als {format} schreiben', '{message}'],
  'b.zip': ['Diese Datei wirkt beschädigt oder unsicher', '{message}'],
  'b.unknown': ['Die Daten konnten nicht angezeigt werden', '{message}'],
  'o.no-key': 'Zuerst den Schlüssel einfügen. Er beginnt mit „tgx2.“ (ältere Schlüssel: „tgx1.“).',
  'o.bad-prefix': 'Das ist kein Schlüssel. Ein Schlüssel beginnt mit „tgx2.“, „tgx1.“, „tg2.“ oder „tg1.“.',
  'o.bad-record': 'Das ist kein versiegelter Datensatz. Ein Datensatz beginnt mit „tgs1.“.',
  'o.checksum': 'Der Schlüssel enthält einen Tippfehler. Bitte noch einmal ganz kopieren.',
  'o.damaged': 'Der Schlüssel oder der Datensatz ist beschädigt oder unvollständig. Bitte noch einmal ganz kopieren.',
  'o.wrong-work': 'Dieser Schlüssel gehört zu einem anderen Werk, oder der Text wurde verändert. Das Werk öffnen, für das der Schlüssel erzeugt wurde.',
  'o.work-required': 'Dieser Schlüssel gehört zu einem Werk. Zuerst das Werk öffnen (oder unten seine Datei wählen).',
  'o.no-record': 'Dieser Schlüssel enthält die Daten nicht. Den versiegelten Datensatz auch einfügen (er beginnt mit „tgs1.“).',
  'o.auth-failed': 'Der Schlüssel öffnet diesen Datensatz nicht, oder der Datensatz wurde verändert. Prüfen, ob Schlüssel und Datensatz zusammengehören.',
  'o.too-large': 'Die Daten sind zu groß, um sie hier zu öffnen.',
  'o.unsupported-compression': 'Dieser Datensatz nutzt eine Kompression, die dein Browser nicht lesen kann. Mit tg-crypt öffnen.',
  'o.need-password': 'Dieser Datensatz ist mit einem Passwort versiegelt, nicht mit einem Schlüssel. Mit tg-crypt öffnen.',
  'o.version': 'Dieser Schlüssel oder Datensatz stammt aus einer neueren Version. Mit dem aktuellen tg-crypt öffnen.',
  'o.not-tgd': 'Der Datensatz hat sich geöffnet, aber der Inhalt sind keine gültigen strukturierten Daten.',
  'o.unterminated': 'Ein versiegelter Block in diesem Werk beginnt, endet aber nicht. Der Text wurde wahrscheinlich gekürzt.',
  'o.unknown': 'Der Datensatz konnte nicht geöffnet werden.',
  'o.title': 'Öffnen nicht möglich', 'o.opened': 'Geöffnet. Der Datenblock ist unversehrt (sha256 {sum}).', 'o.openedText': 'Geöffnet. Der Datensatz enthält eine Nachricht, keinen Datenblock:',
  'r.data': 'Daten', 'r.verified': 'Geprüft', 'r.verifiedLong': 'Die Daten unten sind genau das, was in diesem Werk gespeichert wurde.', 'r.created': 'erstellt {date}',
  'r.tabTable': 'Tabelle', 'r.tabModel': 'Modell', 'r.tabText': 'Text', 'r.sheets': 'Blätter', 'r.hidden': 'ausgeblendet',
  'r.counts': '{rows} · {cols}', 'r.merged': 'verbunden: {list}', 'r.comments': 'Kommentare: {list}', 'r.moreRows': 'Mehr Zeilen zeigen', 'r.rowsShown': '{shown} von {total} Zeilen gezeigt',
  'r.csvSheet': 'Blatt f\u00fcr CSV und TSV', 'r.openedBytes': 'Ge\u00f6ffnet. Der Datensatz enth\u00e4lt eine Datei mit {n} Bytes.', 'r.saveFile': 'Datei speichern', 'r.download': 'Herunterladen', 'r.downloadModel': '.tgd.json (Modell)', 'r.formulas': 'Formeln mitschreiben (nur für vertrauenswürdige Daten)', 'r.copy': 'Kopieren', 'r.copyBlock': 'Blocktext', 'r.copyModel': 'Modell als JSON',
  'r.copied': 'Kopiert.', 'r.copyFail': 'Kopieren nicht möglich: Text markieren und von Hand kopieren.', 'r.copySum': 'Prüfsumme kopieren', 'r.downloaded': '{name} geladen.',
  'r.guard': '{n} Zellen, die mit = + - @ beginnen, haben ein vorangestelltes ’, damit eine Tabellenkalkulation sie als Text zeigt.', 'r.guardOff': 'Ohne Schutz herunterladen', 'r.guardOffConfirm': 'Tu das nur bei Daten, denen du vertraust.', 'r.guardOffYes': 'Ja, ohne Schutz herunterladen',
  'r.lost': 'Nicht übernommen: {list}.', 'r.inRead': 'Daten: {name} · in „Maschine“ öffnen', 'r.showBlock': 'Blocktext zeigen', 'r.downloadBlock': 'Blocktext herunterladen', 'r.code': 'Code: {code}',
  'r.structure': 'Aufbau', 'r.types': 'Typen',
  'r.sealedH': 'Versiegelte Daten', 'r.sealedHelp': 'Füge den Schlüssel ein und, falls er nicht im Schlüssel oder in diesem Werk steckt, den versiegelten Datensatz. Der Schlüssel bleibt in dieser Seite: Er wird nirgends hin gesendet, nicht in die Adresse geschrieben und nicht gespeichert.',
  'r.keyLabel': 'Schlüssel (beginnt mit tgx2. oder tgx1.)', 'r.recordLabel': 'Versiegelter Datensatz (beginnt mit tgs1.)', 'r.open': 'Öffnen', 'r.clearKey': 'Schlüssel löschen', 'r.keyCleared': 'Der Schlüssel ist von dieser Seite gelöscht.',
  'r.recordFile': 'Datensatz-Datei laden (.tgs)', 'r.recordFromWork': 'Der Datensatz wurde im Text dieses Werks gefunden.', 'r.working': 'Wird geöffnet …',
  'r.localH': 'Eine Werkdatei von deinem Rechner öffnen', 'r.localHelp': 'Ein gespeichertes Werk (.svg, .html oder .pdf) lässt sich hier lesen, ohne es hochzuladen: Sein Text wird in diesem Browser gelesen, und enthaltene Daten erscheinen unten.',
  'r.localChoose': 'Werkdatei wählen …', 'r.localLoaded': '{name} gelesen: {chars} Zeichen.', 'r.localFail': 'Diese Datei konnte nicht als Werk gelesen werden ({message}).', 'r.noWorkTitle': 'Eine Werkdatei öffnen', 'r.noWorkBody': 'In der Adresse wurde kein Werk angegeben. Wähle unten eine Werkdatei, um die Daten darin zu sehen.',
  'r.noData': 'Dieses Werk enthält keinen Datenblock.',
  'r.openedMessage': 'Nachricht:',
};
export const DICT = { en: EN, de: DE };

/** The text for `key` in `lang`, `{name}` placeholders filled from `vars`. A pair entry (title, body) gives an array. */
export function T(lang, key, vars = {}) {
  const v = (DICT[lang] || EN)[key] ?? EN[key];
  const fill = (s) => String(s).replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? `{${k}}` : String(vars[k])));
  return Array.isArray(v) ? v.map(fill) : v === undefined ? key : fill(v);
}

/** Sets the text of every element under `root` that has data-d="key" (and placeholder / title / aria-label from data-d-ph / -title / -aria). */
export function applyLang(root, lang) {
  root.querySelectorAll('[data-d]').forEach((el) => { el.textContent = T(lang, el.dataset.d); });
  root.querySelectorAll('[data-d-ph]').forEach((el) => { el.placeholder = T(lang, el.dataset.dPh); });
  root.querySelectorAll('[data-d-title]').forEach((el) => { el.title = T(lang, el.dataset.dTitle); });
  root.querySelectorAll('[data-d-aria]').forEach((el) => el.setAttribute('aria-label', T(lang, el.dataset.dAria)));
}

// ---- what a format loses, in the person's language ---------------------------------------------------------------
const LOSSY_DE = [
  [/^styles, fonts, colours, borders and number formats/, () => 'Stile, Schriften, Farben, Rahmen und Zahlenformate (Datum und Uhrzeit werden erkannt und bleiben erhalten)'],
  [/^column widths, row heights/, () => 'Spaltenbreiten, Zeilenhöhen, ausgeblendete Zeilen und Spalten, fixierte Bereiche'],
  [/^data validation, conditional formatting/, () => 'Datenüberprüfung, bedingte Formatierung, Filter, Tabellen, Pivot-Tabellen'],
  [/^charts, images, drawings, macros/, () => 'Diagramme, Bilder, Zeichnungen, Makros'],
  [/^shared formulas: (\d+)/, (m) => `geteilte Formeln: ${m[1]} Zellen behalten nur ihren Wert (die erste Zelle jeder Gruppe behält die Formel)`],
  [/^array formulas: (\d+)/, (m) => `Matrixformeln: ${m[1]} bleiben als Einzelzellen-Formeln erhalten`],
  [/^(\d+) date-formatted cells/, (m) => `${m[1]} als Datum formatierte Zellen enthalten Zahlen, die kein Datum sind (zum Beispiel der 29.02.1900); sie bleiben Zahlen`],
  [/^date and time values are rounded/, () => 'Datums- und Zeitwerte werden auf die Millisekunde gerundet und tragen keine Zeitzone (Excel speichert keine)'],
  [/^types: every cell is text/, () => 'Typen: Jede Zelle ist Text'],
  [/^quoting style/, () => 'Anführungszeichen: Felder werden nur dort in Anführungszeichen gesetzt, wo es nötig ist'],
  [/^an empty quoted field/, () => 'Ein leeres Feld in Anführungszeichen ("") und ein leeres Feld sind dasselbe'],
  [/^mixed line endings/, () => 'Gemischte Zeilenenden werden auf die erste Art vereinheitlicht'],
  [/^formatting: indentation/, () => 'Formatierung: Einrückung, Abstände und Zeilenumbrüche'],
  [/^byte order mark/, () => 'Byte-Order-Mark'],
  [/^block syntax is normalised/, () => 'Die Blocksyntax wird vereinheitlicht (Aufzählungszeichen, Überschriftenstil, Codeblöcke, Tabellenausrichtung)'],
  [/^blank-line layout/, () => 'Leerzeilen zwischen den Blöcken'],
  [/^link reference definitions/, () => 'Link-Definitionen und Fußnoten bleiben Absatztext'],
  [/^front matter is kept/, () => 'Kopfdaten (Front Matter) bleiben Text und werden nicht gedeutet'],
  [/^tabs in indentation/, () => 'Tabulatoren in Einrückungen werden zu Leerzeichen'],
  [/^comments$/, () => 'Kommentare'],
  [/^formatting and quoting style/, () => 'Formatierung und Anführungsstil'],
  [/^text like 007/, () => 'Text wie 007, 0x1F und yes/no bleibt Text und wird nicht umgewandelt'],
  [/^comments and processing instructions/, () => 'Kommentare und Verarbeitungsanweisungen'],
  [/^the XML declaration/, () => 'Die XML-Deklaration und die Kodierung (die Ausgabe ist UTF-8)'],
  [/^CDATA boundaries/, () => 'CDATA-Grenzen (der Text bleibt erhalten)'],
  [/^whitespace between elements/, () => 'Leerraum zwischen Elementen'],
  [/^a DOCTYPE is refused/, () => 'Eine DOCTYPE-Angabe wird abgelehnt, nicht übernommen'],
  [/^folding of long lines/, () => 'Zeilenumbruch langer Zeilen (wird neu bei 75 Oktetten gesetzt)'],
  [/^blank lines/, () => 'Leerzeilen'],
  [/^comments and blank lines/, () => 'Kommentare und Leerzeilen'],
];
/** The encoder's `lossy` list in the person's language (English entries pass through; unknown entries stay English). */
export function lossyText(list, lang) {
  if (lang !== 'de') return [...list];
  return list.map((s) => { for (const [re, f] of LOSSY_DE) { const m = re.exec(s); if (m) return f(m); } return s; });
}

/** Warnings that are not about lost features: [{ id, level: 'warn'|'info', text }]. */
export function warningsFor({ summary, model, lang, withProse = false, over = false }) {
  const out = [];
  if (summary.formulas) out.push({ id: 'formulas', level: 'info', text: T(lang, 'd.warnFormulas', { n: intFmt(summary.formulas, lang) }) });
  if (summary.longestCell > 5000) out.push({ id: 'longCell', level: 'warn', text: T(lang, 'd.warnLongCell', { n: intFmt(summary.longestCell, lang) }) });
  if (summary.sheets?.some((s) => s.hidden)) out.push({ id: 'hidden', level: 'info', text: T(lang, 'd.warnHidden') });
  if (hasEscapedScripts(model)) out.push({ id: 'scripts', level: 'info', text: T(lang, 'd.warnScripts') });
  if (withProse && !over) out.push({ id: 'prose', level: 'info', text: T(lang, 'd.warnProse') });
  return out;
}

/** True if a text cell holds a letter that TGD must write as a \u escape (the measured-safe set does not include it). */
export function hasEscapedScripts(model, limit = 200000) {
  let seen = 0;
  const go = (x) => {
    if (seen++ > limit) return false;
    if (typeof x === 'string') {
      for (const ch of x) if (/\p{L}/u.test(ch) && !keepLiteral(ch.codePointAt(0))) return true;
      return false;
    }
    if (Array.isArray(x)) return x.some(go);
    if (x && typeof x === 'object') return Object.values(x).some(go);
    return false;
  };
  return go(model);
}

// ---- errors, mapped to a message that says what to do ------------------------------------------------------------
const GEN_MAP = { format: 'e.format', encoding: 'e.encoding', syntax: 'e.syntax', shape: 'e.syntax', zip: 'e.zip', 'zip-slip': 'e.zip', limit: 'e.limit', empty: 'e.empty', none: 'e.empty', fileTooBig: 'e.fileTooBig' };
const GEN_ACTIONS = { format: ['chooseOther'], encoding: ['encoding'], syntax: ['chooseOther'], shape: ['chooseOther'], zip: ['chooseOther'], 'zip-slip': ['chooseOther'], limit: ['chooseOther'], empty: ['chooseOther'], none: ['chooseOther'], fileTooBig: ['chooseOther'], unknown: ['chooseOther'] };
/** An error from reading a file in the generator: { title, body, code, actions[] } (actions are ids the panel turns into buttons). */
export function generatorError(err, lang, ctx = {}) {
  const code = err?.code && GEN_MAP[err.code] ? err.code : ctx.code || 'unknown';
  const [title, body] = T(lang, GEN_MAP[code] || 'e.unknown', { name: ctx.name ?? '', message: err?.message ?? '', size: ctx.size ?? '', max: ctx.max ?? '' });
  return { title, body, code: err?.code || code, actions: GEN_ACTIONS[code] || ['chooseOther'] };
}

const BLOCK_MAP = { checksum: 'b.checksum', unterminated: 'b.unterminated', version: 'b.version', syntax: 'b.syntax', shape: 'b.syntax', limit: 'b.limit', none: 'b.none', format: 'b.format', zip: 'b.zip', 'zip-slip': 'b.zip' };
const BLOCK_ACTIONS = { checksum: ['showBlock', 'downloadBlock'], unterminated: ['showBlock'], version: ['showBlock', 'downloadBlock'], syntax: ['showBlock'], shape: ['showBlock'], limit: ['downloadBlock'], none: [], format: [], zip: [], 'zip-slip': [] };
/** An error of a data block (damaged, cut off, too large, a format it cannot be written as): { title, body, code, actions[] }. */
export function blockError(err, lang, ctx = {}) {
  const key = BLOCK_MAP[err?.code] || 'b.unknown';
  const [title, body] = T(lang, key, { offset: err?.offset ?? '?', message: err?.message ?? '', format: ctx.format ?? '' });
  return { title, body, code: err?.code || 'unknown', actions: BLOCK_ACTIONS[err?.code] || [] };
}

const OPEN_MAP = {
  'no-key': 'o.no-key', 'bad-prefix': 'o.bad-prefix', checksum: 'o.checksum', damaged: 'o.damaged', 'wrong-work': 'o.wrong-work', 'work-required': 'o.work-required',
  'no-record': 'o.no-record', 'auth-failed': 'o.auth-failed', 'too-large': 'o.too-large', 'unsupported-compression': 'o.unsupported-compression',
  'need-password': 'o.need-password', 'need-key': 'o.auth-failed', version: 'o.version', 'not-tgd': 'o.not-tgd', unterminated: 'o.unterminated',
};
/**
 * An error from opening sealed data: { title, body, code }. The text never contains the key, the password or the record:
 * it is a constant per code (the library message is not echoed, because it could quote what the person typed).
 */
export function openError(err, lang, ctx = {}) {
  let code = err?.code;
  // A key-looking record and a record-looking key are the same mistake: a wrong prefix. Say which one it was.
  if (code === 'bad-prefix' && ctx.field === 'record') code = 'bad-record';
  const key = code === 'bad-record' ? 'o.bad-record' : OPEN_MAP[code] || 'o.unknown';
  return { title: T(lang, 'o.title'), body: T(lang, key), code: err?.code || 'unknown' };
}

/** Which field a "bad prefix" error is about: the key if it is filled in and does not start like a key, else the record. */
export const badPrefixField = (key, record) => (String(key ?? '').trim() && !/^(tgx2|tgx1|tg2|tg1)\./.test(String(key).trim()) ? 'key' : record ? 'record' : 'key');
