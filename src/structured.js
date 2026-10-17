// TGD: structured data inside a Typographics Art work (docs/structured-data.md).
//
// A work keeps its text as one flow of canonical text: whitespace collapsed, invisible characters stripped, NFC.
// Extractors (MuPDF, pdf.js) also add, drop and move spaces next to some glyphs. TGD therefore writes data as a
// JSON text that does not depend on whitespace at all:
//   - the decoder deletes every whitespace and invisible character first;
//   - a space inside a string is written as the middle dot U+00B7, a real middle dot as ·;
//   - everything canonicalisation or extraction could change (controls, combining marks, characters outside a
//     measured-safe set) is written as a \uXXXX escape, so the text layer stays plain, exact characters;
//   - a block is TGD1[ ... ]TGD1, and carries SHA-256 of its own text (the checksum field counted as zeros).
// Pure; browser and Node 20+ (Web Crypto).
import { TgdError, Dec, parseJson, fromPlain, toPlain, stringifyJson } from './structured-json.js';
import { sha256Hex } from './structure.js';
import { FORMATS, formatFor, detectFormat } from './structured-formats.js';

export { TgdError, Dec };
export const TGD_VERSION = '1.0';
export const OPEN = 'TGD1[';
export const CLOSE = ']TGD1';
export const MARKER = '\u00b7';
export const MEDIA_TYPE = 'application/vnd.tgart.tgd+json';
export const TOOL = 'tg-data/1.0';
const READ_NOTE = 'TGD 1: JSON, each middle dot stands for one space, \\uXXXX is one character.';

export const DEFAULT_LIMITS = { maxInputBytes: 16 * 1024 * 1024, maxBlockChars: 64 * 1024 * 1024, maxBlocks: 64 };

// ---- text helpers -----------------------------------------------------------------------------------------------
// The normative set of characters a decoder deletes before parsing (docs/structured-data.md §Transport form): whitespace,
// invisible format characters and controls, as ranges, so that the set cannot drift with a Unicode update.
const STRIP_CLASS = '[\\u0000-\\u0020\\u007f-\\u00a0\\u00ad\\u034f\\u061c\\u115f\\u1160\\u1680\\u17b4\\u17b5\\u180b-\\u180f\\u2000-\\u200f\\u2028-\\u202f\\u205f-\\u206f\\u3000\\u3164\\ufe00-\\ufe0f\\ufeff\\uffa0\\ufff0-\\ufff8\\u{1bca0}-\\u{1bca3}\\u{1d173}-\\u{1d17a}\\u{e0000}-\\u{e0fff}]';
export const STRIP_RE = new RegExp(STRIP_CLASS, 'gu');
const STRIP_ONE = new RegExp(`^${STRIP_CLASS}$`, 'u');
export const stripText = (t) => String(t).replace(STRIP_RE, '');

/** The characters that may stand literally in a TGD payload, by mode: 'safe' (default), 'plain', 'ascii'. */
const SAFE_RANGES = [
  [0x21, 0x7e], [0xa1, 0xff], [0x100, 0x2af], [0x370, 0x3ff], [0x400, 0x4ff], [0x1e00, 0x1eff], [0x2010, 0x2027], [0x2030, 0x205e],
  [0x20a0, 0x20bf], [0x2100, 0x218f], [0x2190, 0x23ff], [0x2500, 0x27bf], [0x3041, 0x3096], [0x30a1, 0x30fa], [0xac00, 0xd7a3],
  [0x1f300, 0x1f64f], [0x1f680, 0x1f6ff], [0x1f900, 0x1f9ff],
];
const NEVER = new Set([0x22, 0x5c, 0xad, 0xb5, 0xb7]); // quote, backslash, soft hyphen, micro sign (pdf.js folds it to Greek mu), the space marker
const GRAPHIC = /^[\p{L}\p{N}\p{P}\p{S}]$/u;
const NOT_PLAIN = /^[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{C}\p{M}\p{Emoji_Modifier}]$/u;

export function keepLiteral(cp, mode = 'safe') {
  if (cp < 0x21 || NEVER.has(cp) || (cp >= 0xd800 && cp <= 0xdfff)) return false;
  if (mode === 'ascii') return cp <= 0x7e;
  const ch = String.fromCodePoint(cp);
  if (ch.normalize('NFC') !== ch) return false;
  if (mode === 'plain') return !NOT_PLAIN.test(ch);
  if (!GRAPHIC.test(ch) || cp >= 0x1f3fb && cp <= 0x1f3ff) return false;
  for (const [lo, hi] of SAFE_RANGES) if (cp >= lo && cp <= hi) return true;
  return false;
}

const SHORT = { '"': '\\"', '\\': '\\\\' };
const u4 = (n) => '\\u' + n.toString(16).padStart(4, '0');
function quoteT(str, unicode) {
  let out = '"';
  for (const ch of String(str)) {
    const cp = ch.codePointAt(0);
    if (cp === 0x20) out += MARKER;
    else if (SHORT[ch]) out += SHORT[ch];
    else if (cp === 0x0a) out += '\\n';
    else if (cp === 0x09) out += '\\t';
    else if (cp === 0x0d) out += '\\r';
    else if (keepLiteral(cp, unicode)) out += ch;
    else if (cp > 0xffff) out += u4(0xd800 + ((cp - 0x10000) >> 10)) + u4(0xdc00 + ((cp - 0x10000) & 0x3ff));
    else out += u4(cp);
  }
  // The frame markers must never occur inside a payload: break one letter of them with an escape.
  return out.replace(/TGD1/g, '\\u0054GD1') + '"';
}

/**
 * The transport text of an AST. `layout`: 'rows' (default: a line break between records, for people reading the
 * source text), 'cells' (also a space after every comma, for an even flow of short words) or 'compact' (none).
 * Whitespace is never significant, so the choice changes looks and nothing else.
 */
export function emit(ast, { layout = 'rows', unicode = 'safe' } = {}) {
  const parts = [];
  const comma = (records) => (layout === 'compact' ? ',' : layout === 'cells' ? (records ? ',\n' : ', ') : records ? ',\n' : ',');
  const go = (v) => {
    if (v === null) parts.push('null');
    else if (typeof v === 'boolean') parts.push(String(v));
    else if (typeof v === 'string') parts.push(quoteT(v, unicode));
    else if (typeof v === 'number') parts.push(String(v));
    else if (v instanceof Dec) parts.push(`{"$":"n","v":${quoteT(v.lit, unicode)}}`);
    else if (Array.isArray(v)) {
      parts.push('[');
      const records = v.length > 1 && v.every((x) => Array.isArray(x) || x instanceof Map);
      v.forEach((x, i) => { if (i) parts.push(comma(records)); go(x); });
      parts.push(']');
    } else if (v instanceof Map) {
      parts.push('{');
      let i = 0;
      for (const [k, x] of v) { if (i++) parts.push(comma(true)); parts.push(quoteT(k, unicode), ':'); go(x); }
      parts.push('}');
    } else throw new TgdError('syntax', `Cannot write a ${typeof v}`);
  };
  go(ast);
  return parts.join('');
}

// ---- blocks inside a text -----------------------------------------------------------------------------------------
/**
 * Finds the TGD blocks in a text, ignoring whitespace anywhere (an extractor may put a space inside "TGD1[").
 * Pass the canonical text of a work (src/secret.js canonicalText). Offsets refer to the text you pass in.
 * @returns {{start:number, end:number, body:string}[]}  start/end: the span of the whole block in the text; body: its stripped transport text
 */
export function findBlocks(text, { maxBlocks = DEFAULT_LIMITS.maxBlocks } = {}) {
  const src = String(text);
  let view = '';
  const at = []; // at[k] = UTF-16 offset in src of view[k]
  for (let i = 0; i < src.length;) {
    const cp = src.codePointAt(i), ch = String.fromCodePoint(cp);
    if (!STRIP_ONE.test(ch)) { for (let u = 0; u < ch.length; u++) { view += ch[u]; at.push(i + u); } }
    i += ch.length;
  }
  const blocks = [];
  for (let from = view.indexOf(OPEN); from >= 0;) {
    const close = view.indexOf(CLOSE, from + OPEN.length);
    if (close < 0) throw new TgdError('unterminated', `A TGD block starts at character ${at[from]} but does not end (no "${CLOSE}")`, { offset: at[from] });
    if (blocks.length >= maxBlocks) throw new TgdError('limit', `More than ${maxBlocks} data blocks`);
    blocks.push({ start: at[from], end: at[close + CLOSE.length - 1] + 1, body: view.slice(from + OPEN.length, close) });
    from = view.indexOf(OPEN, close + CLOSE.length);
  }
  return blocks;
}

/** The text without its TGD blocks (what a reader of the prose sees); blocks are replaced by `replacement`. */
export function stripBlocks(text, replacement = '') {
  let out = '', pos = 0;
  for (const b of findBlocks(text)) { out += text.slice(pos, b.start) + replacement; pos = b.end; }
  return out + text.slice(pos);
}

const SUM = /"sum":"([0-9a-f]{64})"/;
const ZEROS = '0'.repeat(64);
const sumOf = (body) => sha256Hex(body.replace(SUM, `"sum":"${ZEROS}"`));

// ---- envelope ---------------------------------------------------------------------------------------------------
const get = (m, k) => (m instanceof Map ? m.get(k) : undefined);

/**
 * Wraps a data model in an envelope and returns the finished block text.
 * @param {{kind:string,[k:string]:any}|Map} data  the model (see docs/structured-data.md §Models), as AST or plain object
 * @param {object} meta  { format, name, created, by, lossy, attach:[{name,media,bytes}] }
 */
export async function seal(data, meta = {}, opts = {}) {
  const env = new Map();
  env.set('tgd', TGD_VERSION);
  env.set('sum', ZEROS);
  if (meta.format) env.set('format', meta.format);
  if (meta.name) env.set('name', safeName(meta.name));
  if (meta.created !== false && meta.created !== undefined) env.set('created', meta.created instanceof Date ? meta.created.toISOString().replace(/\.\d+Z$/, 'Z') : String(meta.created));
  env.set('by', meta.by || TOOL);
  env.set('read', READ_NOTE);
  if (meta.lossy?.length) env.set('lossy', [...meta.lossy]);
  env.set('data', fromPlain(data));
  if (meta.attach?.length) env.set('attach', await Promise.all(meta.attach.map(attachment)));
  const text = emit(env, opts);
  const body = stripText(text);
  if (body.includes(OPEN) || body.includes(CLOSE)) throw new TgdError('syntax', 'Internal error: a frame marker leaked into the payload');
  const sum = await sumOf(body);
  return OPEN + text.replace(`"sum":"${ZEROS}"`, `"sum":"${sum}"`) + CLOSE;
}

const safeName = (n) => String(n).replace(/^.*[\\/]/, '').replace(/\p{Cc}/gu, '').slice(0, 255);

async function attachment(a) {
  const bytes = a.bytes instanceof Uint8Array ? a.bytes : new Uint8Array(a.bytes);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return new Map([['name', safeName(a.name)], ['media', a.media || 'application/octet-stream'], ['size', bytes.length],
    ['sha256', [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')], ['base64', toBase64(bytes)]]);
}

export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export const fromBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/**
 * Reads one block body (the stripped text between the markers).
 * @returns {Promise<Block>} { version, sum, verified:true, format, name, created, by, lossy, data (AST), model (plain), attach }
 * @throws {TgdError} codes: syntax, checksum, version, shape, limit
 */
export async function openBody(body) {
  const m = SUM.exec(body);
  let ast;
  try { ast = parseJson(body, { marker: true }); } catch (e) { if (e instanceof TgdError) throw e; throw new TgdError('syntax', String(e.message)); }
  if (!(ast instanceof Map)) throw new TgdError('shape', 'The block does not hold an object');
  const version = get(ast, 'tgd');
  if (typeof version !== 'string' || !/^1\.\d+$/.test(version)) throw new TgdError('version', `This is TGD version ${JSON.stringify(version)}; this reader understands 1.x`);
  const sum = get(ast, 'sum');
  if (!m || m[1] !== sum) throw new TgdError('shape', 'The envelope has no valid "sum" member (64 hexadecimal digits)');
  const actual = await sumOf(body);
  if (actual !== sum) throw new TgdError('checksum', 'The checksum does not match: the data block was changed or is damaged', { expected: sum, actual });
  const data = get(ast, 'data');
  if (!(data instanceof Map) || typeof get(data, 'kind') !== 'string') throw new TgdError('shape', 'The envelope has no "data" object with a "kind"');
  assertCanonicalNumbers(ast);
  const attach = (get(ast, 'attach') || []).map((a) => ({ name: get(a, 'name'), media: get(a, 'media'), size: get(a, 'size'), sha256: get(a, 'sha256'), base64: get(a, 'base64') }));
  return {
    version, sum, verified: true, format: get(ast, 'format') ?? null, name: get(ast, 'name') ?? null, created: get(ast, 'created') ?? null,
    by: get(ast, 'by') ?? null, lossy: get(ast, 'lossy') ?? [], data, model: toPlain(data), attach, envelope: ast,
  };
}

function assertCanonicalNumbers(v) {
  if (v instanceof Dec) throw new TgdError('syntax', `The number ${v.lit} is not in canonical form; a number that is not a plain double must be written {"$":"n","v":"${v.lit}"}`);
  if (Array.isArray(v)) v.forEach(assertCanonicalNumbers);
  else if (v instanceof Map) v.forEach(assertCanonicalNumbers);
}

/**
 * Decodes the TGD blocks in a text (canonical text of a work, or the encoder's output).
 * @returns {Promise<Array<Block|{error:TgdError, start:number, end:number}>>} one entry per block, damaged ones as { error }
 */
export async function decodeAll(text, opts = {}) {
  const canonical = String(text).normalize('NFC');
  const out = [];
  for (const b of findBlocks(canonical, opts)) {
    if (b.body.length > (opts.maxBlockChars ?? DEFAULT_LIMITS.maxBlockChars)) { out.push({ error: new TgdError('limit', 'The data block is too large'), start: b.start, end: b.end }); continue; }
    try { out.push({ ...(await openBody(b.body)), start: b.start, end: b.end }); } catch (e) { if (!(e instanceof TgdError)) throw e; out.push({ error: e, start: b.start, end: b.end }); }
  }
  return out;
}

/** Decodes the first block (or `index`); throws the TgdError of a damaged one, 'none' if the text holds no block. */
export async function decode(text, { index = 0, ...opts } = {}) {
  const all = await decodeAll(text, opts);
  if (!all.length) throw new TgdError('none', 'No TGD data block found in this text');
  const b = all[index];
  if (!b) throw new TgdError('none', `There is no data block number ${index + 1} (found ${all.length})`);
  if (b.error) throw b.error;
  return b;
}

/** @returns {Promise<{ok:boolean, blocks:Array}>} a report per block; never throws for damaged blocks. */
export async function verify(text, opts = {}) {
  const all = await decodeAll(text, opts);
  return {
    ok: all.length > 0 && all.every((b) => !b.error),
    blocks: all.map((b) => (b.error ? { ok: false, code: b.error.code, message: b.error.message, start: b.start, end: b.end } : { ok: true, name: b.name, format: b.format, sum: b.sum, start: b.start, end: b.end })),
  };
}

// ---- encode / decode to files -------------------------------------------------------------------------------------
/**
 * Turns a file into a TGD block.
 * @param {{bytes?:Uint8Array, text?:string, name?:string, format?:string}} input
 * @param {{layout?:string, unicode?:'safe'|'plain'|'ascii', created?:Date|string|false, attach?:boolean, encoding?:string, limits?:object}} [opts]
 * @returns {Promise<{text:string, block:object, format:string, lossy:string[], warnings:string[], stats:object}>}
 */
export async function encode(input, opts = {}) {
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };
  const bytes = input.bytes ?? new TextEncoder().encode(input.text ?? '');
  if (bytes.length > limits.maxInputBytes) throw new TgdError('limit', `The file is larger than ${limits.maxInputBytes} bytes`);
  const format = input.format || detectFormat(input.name, bytes);
  if (!format) throw new TgdError('format', `Unknown file type${input.name ? ` (${input.name})` : ''}. Supported: ${Object.keys(FORMATS).join(', ')}`);
  const f = formatFor(format);
  const r = await f.read(bytes, { name: input.name, encoding: opts.encoding, limits });
  const attach = opts.attach ? [{ name: input.name || `data.${format}`, media: f.mime, bytes }] : [];
  const text = await seal(r.data, { format, name: input.name, created: opts.created === undefined ? new Date() : opts.created, lossy: r.lossy, attach }, opts);
  return { text, format, lossy: r.lossy, warnings: r.warnings || [], stats: { inputBytes: bytes.length, characters: text.length } };
}

/**
 * Writes a decoded block back to a file of `format` (default: the source format).
 * @returns {Promise<{bytes:Uint8Array, name:string, mime:string, notes?:string[]}>}
 */
export async function toFile(block, format = block.format, opts = {}) {
  const f = formatFor(format);
  return await f.write(block, { safe: opts.safe !== false, formulas: !!opts.formulas, sheet: opts.sheet, indent: opts.indent, delimiter: opts.delimiter });
}

/** The decoded model as pretty JSON (the `.tgd.json` form). */
export const modelJson = (block, indent = 2) => stringifyJson(block.data, { indent });
