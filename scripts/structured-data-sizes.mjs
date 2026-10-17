// Size, token and picture studies for docs/structured-data.md (run through scripts/structured-data-experiments.mjs).
import { seal, emit, stripText } from '../src/structured.js';
import { fromPlain } from '../src/structured-json.js';
import { lorem } from '../src/lorem.js';

// A deterministic, typed sample sheet: names with accents, categories that repeat, integers, decimals, long IDs, ISO dates.
export function sampleSheet(rowsN = 200) {
  let x = 42;
  const rnd = () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const names = ['Müller AG', 'Zoë Fischer', 'Anna Keller', 'Bäckerei Frei', 'Chantal Dubois', 'Émile Roux', 'Hans Meier', 'Laura Rossi'];
  const regions = ['Zürich', 'Genève', 'Basel', 'Bern', 'Lausanne', 'Luzern'];
  const header = ['Name', 'Region', 'Units', 'Price', 'Order ID', 'Date'];
  const rows = [header];
  for (let i = 0; i < rowsN; i++) {
    const day = 1 + Math.floor(rnd() * 28), month = 1 + Math.floor(rnd() * 12);
    rows.push([names[Math.floor(rnd() * names.length)], regions[Math.floor(rnd() * regions.length)], 1 + Math.floor(rnd() * 90),
      Math.round(rnd() * 99000) / 100, String(10 ** 15 + Math.floor(rnd() * 1e15)).padStart(16, '0'), `2025-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`]);
  }
  return rows;
}

const csvOf = (rows) => rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(',')).join('\r\n') + '\r\n';
const sp = (s) => String(s).replace(/ /g, '\u00b7');
const tokens = (s) => (s.match(/[A-Za-z]+|\d{1,3}|[^\sA-Za-z\d]/gu) || []).length;

/** Candidate encodings of the same sheet, all whitespace-independent (a space is written \u00b7), for the size comparison. */
export function candidates(rows) {
  const [head, ...body] = rows;
  const cell = (v) => (typeof v === 'number' ? String(v) : JSON.stringify(sp(v)));
  const out = {};
  out['A  TGD: rows as arrays (the chosen design), compact'] = JSON.stringify(rows.map((r) => r.map((v) => (typeof v === 'number' ? v : sp(v)))));
  out['B  JSON: one object per row (JCS-like, compact)'] = JSON.stringify(body.map((r) => Object.fromEntries(r.map((v, i) => [sp(head[i]), typeof v === 'number' ? v : sp(v)]))));
  out['C  JSON Lines: one array per line + header line'] = rows.map((r) => `[${r.map(cell).join(',')}]`).join('\n');
  out['D  delimiter table: | between cells, \u00b6 ends a row (untyped)'] = rows.map((r) => r.map((v) => sp(String(v)).replace(/[|\u00b6\\]/g, '\\$&')).join('|')).join('\u00b6');
  const counts = new Map();
  for (const r of body) for (const v of r) if (typeof v === 'string') counts.set(v, (counts.get(v) || 0) + 1);
  const dict = [...counts].filter(([v, n]) => n >= 3 && v.length >= 5).map(([v]) => v);
  const idx = new Map(dict.map((v, i) => [v, i]));
  out['E  A + value dictionary (repeated strings as {"$":"r","i":n})'] = JSON.stringify({ dict: dict.map(sp), rows: rows.map((r) => r.map((v) => (idx.has(v) ? { $: 'r', i: idx.get(v) } : typeof v === 'number' ? v : sp(v)))) });
  return out;
}

export async function sizeStudy() {
  const report = [];
  for (const n of [20, 200, 2000]) {
    const rows = sampleSheet(n);
    const csv = csvOf(rows);
    const srcBytes = new TextEncoder().encode(csv).length;
    const line = { rows: n, sourceCsvBytes: srcBytes, sourceTokens: tokens(csv), candidates: {} };
    for (const [name, text] of Object.entries(candidates(rows))) line.candidates[name] = { chars: text.length, vsCsv: +(text.length / srcBytes).toFixed(2), tokens: tokens(text), tokensVsCsv: +(tokens(text) / tokens(csv)).toFixed(2) };
    const sheet = { name: 'Sales', header: true, rows: rows.map((r) => r.map((v) => v)) };
    for (const layout of ['compact', 'rows', 'cells']) {
      const text = await seal({ kind: 'workbook', sheets: [sheet] }, { format: 'csv', name: 'sales.csv', created: false }, { layout });
      line.candidates[`TGD block, full envelope, layout ${layout}`] = { chars: text.length, vsCsv: +(text.length / srcBytes).toFixed(2), tokens: tokens(text), tokensVsCsv: +(tokens(text) / tokens(csv)).toFixed(2), withoutWhitespaceChars: stripText(text).length };
    }
    const b64 = Math.ceil((srcBytes * 4) / 3);
    line.candidates['base64 of the CSV file (not readable, for comparison)'] = { chars: b64, vsCsv: +(b64 / srcBytes).toFixed(2) };
    line.capacityRowsPerA4At600kChars = Math.floor(600000 / ((await seal({ kind: 'workbook', sheets: [sheet] }, { created: false }, { layout: 'compact' })).length / n));
    report.push(line);
  }
  console.log(JSON.stringify(report, null, 1));
}

export async function visualStudy(session, out, makeOnePage) {
  const rows = sampleSheet(160);
  const sheet = { name: 'Sales', header: true, rows };
  const variants = {};
  for (const layout of ['compact', 'rows', 'cells']) variants[`tgd-${layout}`] = await seal({ kind: 'workbook', sheets: [sheet] }, { format: 'csv', name: 'sales.csv', created: false }, { layout });
  const n = variants['tgd-rows'].length;
  variants.prose = lorem(n).slice(0, n);
  const report = {};
  for (const [name, text] of Object.entries(variants)) {
    const r = await makeOnePage(session, { text, title: 'DATA', paper: 'a4', pdf: `${out}/${name}.pdf`, preview: `${out}/${name}.png` });
    report[name] = { characters: r.characters, lines: r.lines, fontSizeMm: r.fontSizeMm, toneFidelity: r.toneFidelity, pdfBytes: r.pdfBytes, exact: r.check?.exact, visibleIdentical: r.check?.visibleIdentical };
  }
  console.log(JSON.stringify(report, null, 1));
}
void emit; void fromPlain;
