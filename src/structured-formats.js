// The supported file formats of the TGD standard and how a file is recognised (docs/structured-data.md §Formats).
// Every format has read(bytes, opts) -> { data, lossy[], warnings? } and write(block, opts) -> { bytes, name, mime, notes? }.
import { TgdError, parseJson, stringifyJson, fromPlain } from './structured-json.js';
import { textOf, hasBom, jsonToModel, modelToJson } from './structured-model.js';
import { readCsv, writeCsv, readKv, writeKv } from './structured-csv.js';
import { readXlsx, writeXlsx } from './structured-xlsx.js';
import { readMarkdown, writeMarkdown } from './structured-md.js';
import { readXml, writeXml } from './structured-xml.js';
import { readLines, writeLines } from './structured-lines.js';
import { readYaml, writeYaml } from './structured-yaml.js';

// ---- JSON: the model is the document itself; $-keys and big numbers are the only things that need care ----------
function readJson(bytes, { limits } = {}) {
  const bom = hasBom(bytes);
  const ast = parseJson(textOf(bytes), { maxNodes: limits?.maxNodes });
  return { data: { kind: 'json', value: jsonToModel(ast) }, lossy: ['formatting: indentation, spacing and line breaks', ...(bom ? ['byte order mark'] : [])] };
}
function writeJson(block, { indent = 2 } = {}) {
  const d = block.data;
  const kind = d.get('kind');
  let ast;
  if (kind === 'json') ast = modelToJson(d.get('value'));
  else if (kind === 'workbook') ast = fromPlain(workbookAsJson(block.model));
  else ast = fromPlain(block.model);
  return { bytes: new TextEncoder().encode(stringifyJson(ast, { indent }) + '\n'), name: stemOf(block.name, 'data') + '.json', mime: 'application/json' };
}
/** A workbook as plain JSON: sheet name -> array of rows (typed cells reduced to their value). */
function workbookAsJson(wb) {
  return Object.fromEntries((wb.sheets || []).map((s) => [s.name, (s.rows || []).map((r) => r.map((c) => (c && typeof c === 'object' ? (c.$ === 'f' ? c.v ?? null : c.v) : c)))]));
}
const stemOf = (name, fallback) => String(name || fallback).replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '') || fallback;

export const FORMATS = {
  csv: { id: 'csv', ext: ['.csv'], mime: 'text/csv', read: readCsv, write: writeCsv, kinds: ['workbook'] },
  tsv: { id: 'tsv', ext: ['.tsv', '.tab'], mime: 'text/tab-separated-values', read: (b, o) => readCsv(b, { ...o, delimiter: '\t' }), write: (b, o) => writeCsv(b, { ...o, delimiter: '\t' }), kinds: ['workbook'] },
  json: { id: 'json', ext: ['.json'], mime: 'application/json', read: readJson, write: writeJson, kinds: ['json', 'workbook'] },
  xlsx: { id: 'xlsx', ext: ['.xlsx'], mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', read: readXlsx, write: writeXlsx, kinds: ['workbook'] },
  md: { id: 'md', ext: ['.md', '.markdown'], mime: 'text/markdown', read: readMarkdown, write: writeMarkdown, kinds: ['markdown'] },
  yaml: { id: 'yaml', ext: ['.yaml', '.yml'], mime: 'application/yaml', read: readYaml, write: writeYaml, kinds: ['json'] },
  xml: { id: 'xml', ext: ['.xml'], mime: 'application/xml', read: readXml, write: writeXml, kinds: ['xml'] },
  ics: { id: 'ics', ext: ['.ics', '.ical'], mime: 'text/calendar', read: (b, o) => readLines(b, { ...o, type: 'icalendar' }), write: writeLines, kinds: ['icalendar'] },
  vcf: { id: 'vcf', ext: ['.vcf', '.vcard'], mime: 'text/vcard', read: (b, o) => readLines(b, { ...o, type: 'vcard' }), write: writeLines, kinds: ['vcard'] },
  kv: { id: 'kv', ext: ['.env', '.properties', '.kv'], mime: 'text/plain', read: readKv, write: writeKv, kinds: ['kv'] },
};

export function formatFor(id) {
  const f = FORMATS[id];
  if (!f) throw new TgdError('format', `Unknown format ${JSON.stringify(String(id))}. Supported: ${Object.keys(FORMATS).join(', ')}`);
  return f;
}

/** The format of a file by its extension, else by its first bytes (zip -> xlsx, "{"/"[" -> json, BEGIN: -> ics/vcf). */
export function detectFormat(name, bytes) {
  const lower = String(name || '').toLowerCase();
  for (const f of Object.values(FORMATS)) if (f.ext.some((e) => lower.endsWith(e))) return f.id;
  const b = bytes instanceof Uint8Array ? bytes : null;
  if (b && b[0] === 0x50 && b[1] === 0x4b) return 'xlsx';
  const head = b ? new TextDecoder().decode(b.subarray(0, 64)).replace(/^\ufeff/, '').trimStart() : '';
  if (/^[{[]/.test(head)) return 'json';
  if (/^BEGIN:VCALENDAR/i.test(head)) return 'ics';
  if (/^BEGIN:VCARD/i.test(head)) return 'vcf';
  if (/^<\?xml|^<[A-Za-z]/.test(head)) return 'xml';
  return null;
}
