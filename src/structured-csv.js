// CSV, TSV and plain key=value files as TGD models (docs/structured-data.md §Formats).
//
// CSV has no types: every cell is text, an empty field is an empty cell. The dialect (delimiter, line ending,
// final line break, BOM) is recorded so that a CSV in the usual minimal-quoting style comes back byte for byte.
import { TgdError } from './structured-json.js';
import { textOf, hasBom, layoutGrid, gridOf, cellText } from './structured-model.js';

const LIMIT_ROWS = 2_000_000;

/** Splits CSV text into records; quoted fields may hold the delimiter, quotes ("") and line breaks. */
export function parseCsv(text, delimiter, limits = {}) {
  const maxCells = limits.maxCells ?? 20_000_000;
  const rows = [];
  let row = [], field = '', quoted = false, hasField = false, atStart = true, cells = 0, line = 1, i = 0;
  const endField = () => { row.push(field === '' ? null : field); field = ''; if (++cells > maxCells) throw new TgdError('limit', 'Too many cells'); };
  const endRow = () => {
    if (hasField || row.length) endField();
    rows.push(row.length === 1 && row[0] === null ? [] : row);
    row = []; hasField = false; atStart = true;
    if (rows.length > LIMIT_ROWS) throw new TgdError('limit', 'Too many rows');
  };
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } quoted = false; i++; continue; }
      if (c === '\n') line++;
      field += c; i++; continue;
    }
    if (c === '"' && atStart) { quoted = true; hasField = true; atStart = false; i++; continue; }
    if (c === delimiter) { endField(); hasField = true; atStart = true; i++; continue; }
    if (c === '\r' || c === '\n') { endRow(); line++; i += c === '\r' && text[i + 1] === '\n' ? 2 : 1; continue; }
    field += c; hasField = true; atStart = false; i++;
  }
  if (quoted) throw new TgdError('syntax', `A quoted field is not closed (it starts before line ${line})`);
  if (hasField || row.length) endRow();
  return rows;
}

function detectDelimiter(text) {
  const sample = text.slice(0, 20000);
  let best = ',', bestScore = -1;
  for (const d of [',', ';', '\t', '|']) {
    let rows;
    try { rows = parseCsv(sample.slice(0, sample.lastIndexOf('\n') > 0 ? sample.lastIndexOf('\n') : sample.length), d).slice(0, 30); } catch { continue; }
    const widths = rows.filter((r) => r.length).map((r) => r.length);
    if (!widths.length || widths[0] < 2) continue;
    const consistent = widths.filter((w) => w === widths[0]).length / widths.length;
    const score = consistent * 100 + Math.min(widths[0], 50);
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

const stem = (name, fallback) => String(name || fallback).replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '').replace(/[[\]:*?/\\]/g, '_').slice(0, 31) || fallback;

export function readCsv(bytes, { name, encoding, delimiter, limits } = {}) {
  const bom = hasBom(bytes);
  const text = textOf(bytes, encoding);
  const d = delimiter || detectDelimiter(text);
  const rows = parseCsv(text, d, limits);
  const eol = /\r\n/.test(text) ? '\r\n' : text.includes('\n') ? '\n' : text.includes('\r') ? '\r' : '\n';
  const final = /[\r\n]$/.test(text);
  const dialect = { delimiter: d, eol, final, ...(bom ? { bom: true } : {}) };
  const lossy = ['types: every cell is text', 'quoting style: fields are quoted only where needed', 'an empty quoted field ("") and an empty field are the same'];
  if (/\r\n/.test(text) && /(^|[^\r])\n/.test(text.replace(/"[^"]*"/g, ''))) lossy.push('mixed line endings are normalised to the first kind');
  const sheet = { name: stem(name, 'Sheet1'), ...layoutGrid(rows, { trim: false }) };
  return { data: { kind: 'workbook', dialect, sheets: [sheet] }, lossy };
}

const INJECT = /^[=+\-@\t\r]/;
const NUMERIC = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
/** Formula-injection guard for text that a spreadsheet may open: a leading ' makes it text again (OWASP). */
export const guardCell = (s) => (INJECT.test(s) && !NUMERIC.test(s) ? `'${s}` : s);

export function writeCsv(block, { safe = true, sheet: pick, delimiter: forced } = {}) {
  const wb = block.model, name = block.name;
  const sheets = wb.sheets || [];
  const sheet = (pick != null ? sheets.find((s, i) => s.name === pick || String(i + 1) === String(pick)) : sheets[0]);
  if (!sheet) throw new TgdError('shape', pick != null ? `No sheet ${JSON.stringify(pick)}` : 'The workbook has no sheets');
  const dia = wb.dialect || {};
  const d = forced || dia.delimiter || ',', eol = dia.eol || '\r\n';
  let guarded = 0;
  const q = (v) => {
    let s = cellText(v);
    // The guard looks at the FINAL text of every cell, whatever type the model says (text, date, boolean, formula, error).
    // Only text that is entirely a plain decimal number is exempt: a spreadsheet reads that as a number, never as a formula.
    if (safe && guardCell(s) !== s) { s = guardCell(s); guarded++; }
    return s.includes(d) || s.includes('"') || /[\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const grid = gridOf(sheet, { maxDense: 50_000_000 });
  const lines = Array.from(grid, (row) => (row || []).map(q).join(d));
  const body = lines.join(eol) + (dia.final === false ? '' : eol);
  const notes = [];
  if (sheets.length > 1 && pick == null) notes.push(`The workbook has ${sheets.length} sheets; only the first (${sheets[0].name}) was written. Use sheet to choose.`);
  if (guarded) notes.push(`${guarded} cell${guarded === 1 ? '' : 's'} starting with = + - @ got a leading ' so that a spreadsheet shows them as text (use safe:false to keep them as they are).`);
  const out = new TextEncoder().encode((dia.bom ? '\ufeff' : '') + body);
  return { bytes: out, name: `${stem(name, sheet.name)}${d === '\t' ? '.tsv' : '.csv'}`, mime: d === '\t' ? 'text/tab-separated-values' : 'text/csv', notes };
}

// ---- key=value ----------------------------------------------------------------------------------------------------
export function readKv(bytes) {
  const text = textOf(bytes);
  const pairs = [];
  let skipped = 0;
  for (const raw of text.split(/\r\n|\n|\r/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#') || line.startsWith(';') || line.startsWith('//')) { skipped++; continue; }
    const eq = line.indexOf('=');
    if (eq <= 0) throw new TgdError('syntax', `Line without "key=value": ${JSON.stringify(line.slice(0, 40))}`);
    pairs.push([line.slice(0, eq).trim(), line.slice(eq + 1).trim()]);
  }
  return { data: { kind: 'kv', pairs }, lossy: ['comments and blank lines', 'order of blank lines, spacing around "="', ...(skipped ? [] : [])] };
}
export function writeKv(block) {
  const lines = (block.model.pairs || []).map(([k, v]) => `${k}=${v}`);
  return { bytes: new TextEncoder().encode(lines.join('\n') + '\n'), name: 'data.env', mime: 'text/plain' };
}
