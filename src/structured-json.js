// A strict JSON reader and writer for the structured-data standard (TGD, docs/structured-data.md).
//
// Why not JSON.parse: it turns 12345678901234567890 into 12345678901234567000, it loses the order of integer-like
// keys, it silently keeps the last of two equal keys, and it accepts a lone surrogate without telling. A data
// standard must not do any of that, so this reader keeps every number as written, keeps key order, and refuses
// duplicate keys (RFC 7493 "I-JSON": names must be unique; interoperable JSON has none).
//
// AST: null | boolean | string | number (a finite double that prints back as written) | Dec (any other number,
// kept as its literal) | Array | Map (objects: insertion order, string keys). Pure; Node 20+ and browsers.

export class TgdError extends Error {
  /** @param {string} code  stable machine-readable code, see docs/structured-data.md §Errors */
  constructor(code, message, detail = {}) { super(message); this.name = 'TgdError'; this.code = code; Object.assign(this, detail); }
}

/** A number kept as its decimal literal, for everything a double cannot carry exactly (long IDs, "1.10", "1E+21"). */
export class Dec {
  constructor(lit) {
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(lit)) throw new TgdError('syntax', `Not a decimal number: ${JSON.stringify(String(lit).slice(0, 40))}`);
    this.lit = lit;
  }
  toString() { return this.lit; }
}

export const DEFAULT_JSON_LIMITS = { maxDepth: 64, maxNodes: 4_000_000, maxStringChars: 8_000_000 };
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/** A number literal as an AST value: a plain number if it prints back exactly as written, else a Dec. */
export const numberFromLiteral = (lit) => {
  const n = Number(lit);
  return Number.isFinite(n) && String(n) === lit && !(n === 0 && lit.startsWith('-')) ? n : new Dec(lit);
};

/**
 * @param {boolean} [marker]  TGD transport: a raw middle dot inside a string stands for a space
 * @returns the AST of one JSON text (RFC 8259); throws TgdError('syntax'|'limit') with the offset.
 */
export function parseJson(text, { marker = false, ...limits } = {}) {
  const L = { ...DEFAULT_JSON_LIMITS, ...limits };
  const s = String(text);
  let i = 0, nodes = 0;
  const fail = (msg, at = i) => { throw new TgdError('syntax', `${msg} (at character ${at})`, { offset: at }); };
  const ws = () => { while (i < s.length && (s[i] === ' ' || s[i] === '\n' || s[i] === '\r' || s[i] === '\t')) i++; };
  const count = () => { if (++nodes > L.maxNodes) throw new TgdError('limit', `More than ${L.maxNodes} values`); };

  function string() {
    const start = i;
    i++; // opening quote
    let out = '';
    for (;;) {
      let j = i;
      while (j < s.length && s[j] !== '"' && s[j] !== '\\' && s.charCodeAt(j) >= 0x20) j++;
      out += marker ? s.slice(i, j).replaceAll('\u00b7', ' ') : s.slice(i, j); i = j;
      if (out.length > L.maxStringChars) throw new TgdError('limit', 'A string is too long');
      if (i >= s.length) fail('Unterminated string', start);
      const c = s[i];
      if (c === '"') { i++; return out; }
      if (c !== '\\') fail('A control character inside a string must be escaped');
      const e = s[i + 1];
      const simple = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }[e];
      if (simple !== undefined) { out += simple; i += 2; continue; }
      if (e === 'u') {
        const hex = s.slice(i + 2, i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('Bad \\u escape');
        out += String.fromCharCode(parseInt(hex, 16)); i += 6; continue;
      }
      fail('Bad escape');
    }
  }

  function value(depth) {
    if (depth > L.maxDepth) throw new TgdError('limit', `Nesting deeper than ${L.maxDepth}`);
    ws();
    const c = s[i];
    count();
    if (c === '"') return string();
    if (c === '{') {
      i++; ws();
      const map = new Map();
      if (s[i] === '}') { i++; return map; }
      for (;;) {
        ws();
        if (s[i] !== '"') fail('Expected a key');
        const at = i, k = string();
        if (map.has(k)) fail(`Duplicate key ${JSON.stringify(k.slice(0, 40))}`, at);
        ws();
        if (s[i] !== ':') fail('Expected ":"');
        i++;
        map.set(k, value(depth + 1)); ws();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === '}') { i++; return map; }
        fail('Expected "," or "}"');
      }
    }
    if (c === '[') {
      i++; ws();
      const arr = [];
      if (s[i] === ']') { i++; return arr; }
      for (;;) {
        arr.push(value(depth + 1)); ws();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === ']') { i++; return arr; }
        fail('Expected "," or "]"');
      }
    }
    if (s.startsWith('true', i)) { i += 4; return true; }
    if (s.startsWith('false', i)) { i += 5; return false; }
    if (s.startsWith('null', i)) { i += 4; return null; }
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(s);
    if (!m) fail(c === undefined ? 'Unexpected end of data' : `Unexpected character ${JSON.stringify(c)}`);
    i += m[0].length;
    return numberFromLiteral(m[0]);
  }

  const v = value(0);
  ws();
  if (i < s.length) fail('Extra data after the end of the value');
  return v;
}

const isMap = (v) => v instanceof Map;

/** Plain JSON-compatible JS value for convenience: Maps become objects, Dec becomes its literal as a string. */
export function toPlain(ast) {
  if (isMap(ast)) { const o = {}; for (const [k, v] of ast) Object.defineProperty(o, k, { value: toPlain(v), enumerable: true, writable: true, configurable: true }); return o; }
  if (Array.isArray(ast)) return ast.map(toPlain);
  if (ast instanceof Dec) return ast.lit;
  return ast;
}

/** AST from an ordinary JS value (objects keep their enumeration order; integer-like keys come first, as in JS). */
export function fromPlain(v) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new TgdError('syntax', 'Not a finite number'); return Object.is(v, -0) ? new Dec('-0') : v; }
  if (v instanceof Dec || isMap(v)) return v;
  if (Array.isArray(v)) return v.map(fromPlain);
  if (typeof v === 'object') { const m = new Map(); for (const [k, x] of Object.entries(v)) if (x !== undefined) m.set(k, fromPlain(x)); return m; }
  throw new TgdError('syntax', `Cannot represent a ${typeof v}`);
}

const ESC = { '"': '\\"', '\\': '\\\\', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t' };
const u4 = (n) => '\\u' + n.toString(16).padStart(4, '0');

/** JSON string literal with the shortest standard escapes; `keep(codePoint)` says which characters may stay literal. */
export function quote(str, keep = (cp) => cp >= 0x20) {
  let out = '"';
  for (const ch of String(str)) {
    const cp = ch.codePointAt(0);
    if (ESC[ch]) out += ESC[ch];
    else if (cp >= 0xd800 && cp <= 0xdfff) out += u4(cp); // a lone surrogate
    else if (!keep(cp)) out += cp > 0xffff ? u4(0xd800 + ((cp - 0x10000) >> 10)) + u4(0xdc00 + ((cp - 0x10000) & 0x3ff)) : u4(cp);
    else out += ch;
  }
  return out + '"';
}

/** The number as JSON text. */
export const numberText = (v) => (v instanceof Dec ? v.lit : String(v));

/** Pretty or compact JSON text of an AST (for files; the transport form of the standard is built in structured.js). */
export function stringifyJson(ast, { indent = 2 } = {}) {
  const pad = (d) => (indent ? '\n' + ' '.repeat(indent * d) : '');
  const go = (v, d) => {
    if (v === null) return 'null';
    if (typeof v === 'boolean') return String(v);
    if (typeof v === 'string') return quote(v, (cp) => cp >= 0x20 && cp !== 0x7f && !(cp >= 0x80 && cp <= 0x9f) && cp !== 0x2028 && cp !== 0x2029);
    if (typeof v === 'number' || v instanceof Dec) return numberText(v);
    if (Array.isArray(v)) return v.length ? '[' + v.map((x) => pad(d + 1) + go(x, d + 1)).join(',') + pad(d) + ']' : '[]';
    if (isMap(v)) return v.size ? '{' + [...v].map(([k, x]) => pad(d + 1) + quote(k) + (indent ? ': ' : ':') + go(x, d + 1)).join(',') + pad(d) + '}' : '{}';
    throw new TgdError('syntax', `Cannot write a ${typeof v}`);
  };
  return go(ast, 0);
}
