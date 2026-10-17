// YAML, as a deliberately small, strict subset (docs/structured-data.md §YAML). YAML 1.2 is a very large language
// (anchors and aliases that can expand exponentially, tags that construct objects, implicit typing that has changed
// between versions); a data standard that must decode the same everywhere cannot take all of it. The subset:
//   block mappings and sequences (spaces only), plain / 'single' / "double" quoted scalars, one-line flow
//   collections, literal (|) and folded (>) block scalars with - and + chomping, comments, one leading ---.
// Refused with a line number: anchors, aliases, tags, merge keys, multiple documents, directives, complex keys,
// tabs as indentation, duplicate keys. Typing follows the YAML 1.2 core schema with two deliberate narrowings:
// only canonical number spellings are numbers ("007", "0x1F", "+1", ".5" stay text), and yes/no/on/off are text.
import { TgdError, Dec, numberFromLiteral, quote } from './structured-json.js';
import { textOf, hasBom, jsonToModel, modelToJson } from './structured-model.js';

const RESERVED = /^(?:null|Null|NULL|~|true|True|TRUE|false|False|FALSE|y|Y|n|N|yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF)$/;
const NUMBERLIKE = /^[-+]?(?:\d[\d_]*\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$|^[-+]?\.(?:inf|Inf|INF)$|^\.(?:nan|NaN|NAN)$|^0[xXoObB][\da-fA-F_]+$/;

function typed(text) {
  if (text === '' || text === '~' || /^(?:null|Null|NULL)$/.test(text)) return null;
  if (/^(?:true|True|TRUE)$/.test(text)) return true;
  if (/^(?:false|False|FALSE)$/.test(text)) return false;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text)) return numberFromLiteral(text);
  return text;
}

export function parseYaml(input, limits = {}) {
  const maxDepth = limits.maxDepth ?? 64, maxNodes = limits.maxNodes ?? 2_000_000;
  const lines = String(input).replace(/^\ufeff/, '').split(/\r\n|\n|\r/);
  let nodes = 0;
  const fail = (msg, n) => { throw new TgdError('syntax', `YAML: ${msg} (line ${n + 1})`, { line: n + 1 }); };
  const count = () => { if (++nodes > maxNodes) throw new TgdError('limit', 'YAML has too many values'); };
  let pos = 0;
  if (/^---\s*(#.*)?$/.test(lines[0] || '')) pos = 1;
  const indentOf = (l, n) => { const m = /^( *)/.exec(l)[1].length; if (/^ *\t/.test(l)) fail('a tab cannot be used as indentation', n); return m; };
  const blank = (l) => /^\s*(#.*)?$/.test(l);
  const skipBlank = () => { while (pos < lines.length && blank(lines[pos])) pos++; };

  function checkRefused(text, n) {
    if (/^[&*!]/.test(text)) fail('anchors, aliases and tags are not supported', n);
    if (/^<<\s*:/.test(text)) fail('merge keys are not supported', n);
    if (text === '---' || text === '...' || /^%/.test(text)) fail('only one document and no directives are supported', n);
    if (/^\?(\s|$)/.test(text)) fail('complex keys are not supported', n);
  }

  function quoted(s, n) {
    const q = s[0];
    let i = 1, out = '';
    for (; i < s.length; i++) {
      const c = s[i];
      if (q === "'") { if (c === "'") { if (s[i + 1] === "'") { out += "'"; i++; continue; } return { value: out, end: i + 1 }; } out += c; continue; }
      if (c === '"') return { value: out, end: i + 1 };
      if (c !== '\\') { out += c; continue; }
      const e = s[++i];
      const map = { n: '\n', t: '\t', r: '\r', '0': '\0', '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', e: '\x1b', ' ': ' ', a: '\x07', v: '\v', N: '\u0085', _: '\u00a0', L: '\u2028', P: '\u2029' };
      if (e in map) { out += map[e]; continue; }
      const len = e === 'x' ? 2 : e === 'u' ? 4 : e === 'U' ? 8 : 0;
      if (!len || !/^[0-9a-fA-F]+$/.test(s.slice(i + 1, i + 1 + len)) || s.slice(i + 1, i + 1 + len).length !== len) fail('bad escape in a double-quoted string', n);
      out += String.fromCodePoint(parseInt(s.slice(i + 1, i + 1 + len), 16)); i += len;
    }
    return fail('a quoted string is not closed on its line', n);
  }

  /** A scalar or one-line flow value from text; returns the value. */
  function inline(text, n, depth = 0) {
    count();
    if (depth > maxDepth) throw new TgdError('limit', 'YAML nesting is too deep');
    text = text.trim();
    checkRefused(text, n);
    if (text[0] === '"' || text[0] === "'") {
      const { value, end } = quoted(text, n);
      const rest = text.slice(end).trim();
      if (rest && !rest.startsWith('#')) fail('unexpected text after a quoted string', n);
      return value;
    }
    if (text[0] === '[' || text[0] === '{') { const { value, end } = flow(text, 0, n, depth); if (text.slice(end).replace(/\s*#.*$/, '').trim()) fail('unexpected text after a flow collection', n); return value; }
    if (text[0] === '|' || text[0] === '>') fail('a block scalar must start a value, not stand inside a flow', n);
    const plain = text.replace(/\s+#.*$/, '');
    return typed(plain);
  }

  function flow(s, i, n, depth) {
    const skip = () => { while (/\s/.test(s[i] || '')) i++; };
    const open = s[i];
    i++;
    skip();
    const close = open === '[' ? ']' : '}';
    const arr = [], map = new Map();
    if (s[i] === close) return { value: open === '[' ? arr : map, end: i + 1 };
    for (;;) {
      skip();
      let item;
      if (s[i] === '[' || s[i] === '{') { const r = flow(s, i, n, depth + 1); item = r.value; i = r.end; }
      else if (s[i] === '"' || s[i] === "'") { const r = quoted(s.slice(i), n); item = r.value; i += r.end; }
      else { let j = i; while (j < s.length && !(s[j] === ',' || s[j] === close || (open === '{' && s[j] === ':' && (s[j + 1] === ' ' || s[j + 1] === undefined || s[j + 1] === ',' || s[j + 1] === '}')))) j++; item = typed(s.slice(i, j).trim()); i = j; if (typeof item === 'string') checkRefused(item, n); }
      skip();
      if (open === '[') { arr.push(item); }
      else {
        if (s[i] !== ':') fail('expected ":" in a flow mapping', n);
        i++; skip();
        let val;
        if (s[i] === '[' || s[i] === '{') { const r = flow(s, i, n, depth + 1); val = r.value; i = r.end; }
        else if (s[i] === '"' || s[i] === "'") { const r = quoted(s.slice(i), n); val = r.value; i += r.end; }
        else { let j = i; while (j < s.length && s[j] !== ',' && s[j] !== close) j++; val = typed(s.slice(i, j).trim()); i = j; }
        if (map.has(String(item))) fail(`duplicate key ${JSON.stringify(String(item))}`, n);
        map.set(String(item), val); skip();
      }
      if (s[i] === ',') { i++; skip(); if (s[i] === close) return { value: open === '[' ? arr : map, end: i + 1 }; continue; }
      if (s[i] === close) return { value: open === '[' ? arr : map, end: i + 1 };
      fail('expected "," or the closing bracket', n);
    }
  }

  function blockScalar(head, parentIndent, n) {
    const m = /^([|>])([+-]?)(\d?)\s*(#.*)?$/.exec(head);
    if (!m) fail('bad block scalar header', n);
    const body = [];
    let blockIndent = m[3] ? parentIndent + Number(m[3]) : null;
    while (pos < lines.length) {
      const l = lines[pos];
      if (/^\s*$/.test(l)) { body.push(''); pos++; continue; }
      const ind = indentOf(l, pos);
      if (blockIndent === null) { if (ind <= parentIndent) break; blockIndent = ind; }
      if (ind < blockIndent) break;
      body.push(l.slice(blockIndent)); pos++;
    }
    let trailing = 0;
    while (body.length && body.at(-1) === '') { body.pop(); trailing++; }
    let text;
    if (m[1] === '|') text = body.join('\n');
    else { text = ''; body.forEach((l, k) => { if (k === 0) { text = l; return; } const prev = body[k - 1]; text += (l === '' || prev === '' || /^\s/.test(l) || /^\s/.test(prev) ? '\n' : ' ') + l; }); }
    if (!body.length) return '';
    if (m[2] === '-') return text;
    if (m[2] === '+') return text + '\n'.repeat(trailing + 1);
    return text + '\n';
  }

  function splitKey(content, n) {
    checkRefused(content, n);
    if (content[0] === '"' || content[0] === "'") {
      const { value, end } = quoted(content, n);
      const rest = content.slice(end).trimStart();
      if (rest[0] !== ':' || (rest[1] !== undefined && rest[1] !== ' ')) return null;
      return { key: value, rest: rest.slice(1).trim() };
    }
    const m = /^([^\s#][^#]*?):(?:\s+(.*)|$)/.exec(content);
    if (!m || /^[[{]/.test(content)) return null;
    return { key: m[1].trim(), rest: (m[2] ?? '').trim() };
  }

  function value(rest, parentIndent, n, depth, allowSameIndentSeq = false) {
    if (depth > maxDepth) throw new TgdError('limit', 'YAML nesting is too deep');
    if (rest === '' || rest.startsWith('#')) {
      skipBlank();
      if (pos >= lines.length) return null;
      const ind = indentOf(lines[pos], pos);
      if (ind > parentIndent) return block(ind, depth + 1);
      if (allowSameIndentSeq && ind === parentIndent && /^-(\s|$)/.test(lines[pos].trim())) return block(ind, depth + 1);
      return null;
    }
    if (rest[0] === '|' || rest[0] === '>') return blockScalar(rest, parentIndent, n);
    return inline(rest, n, depth);
  }

  function block(indent, depth) {
    skipBlank();
    const n = pos, content = lines[pos].trim();
    if (/^-(\s|$)/.test(content)) {
      const arr = [];
      while (pos < lines.length) {
        skipBlank();
        if (pos >= lines.length || indentOf(lines[pos], pos) !== indent || !/^-(\s|$)/.test(lines[pos].trim())) break;
        const ln = pos, after = lines[pos].trim().slice(1).trim();
        count();
        pos++;
        const kv = after && !/^[|>[{"'&*!#]/.test(after) ? splitKey(after, ln) : null;
        if (kv) { // "- key: value" starts a mapping whose keys align after the dash
          const sub = indent + (lines[ln].indexOf(after) - indent);
          pos = ln; lines[pos] = ' '.repeat(sub) + after;
          arr.push(block(sub, depth + 1));
        } else arr.push(value(after, indent, ln, depth + 1));
      }
      return arr;
    }
    if (!splitKey(content, n)) { pos++; return inline(content, n, depth); }
    const map = new Map();
    while (pos < lines.length) {
      skipBlank();
      if (pos >= lines.length) break;
      const ind = indentOf(lines[pos], pos);
      if (ind < indent) break;
      if (ind > indent) fail('unexpected indentation', pos);
      const ln = pos, kv = splitKey(lines[pos].trim(), ln);
      if (!kv) fail('expected "key: value"', ln);
      if (map.has(kv.key)) fail(`duplicate key ${JSON.stringify(kv.key)}`, ln);
      count();
      pos++;
      map.set(kv.key, value(kv.rest, indent, ln, depth + 1, true));
    }
    return map;
  }

  skipBlank();
  if (pos >= lines.length) return null;
  const result = block(indentOf(lines[pos], pos), 0);
  skipBlank();
  if (pos < lines.length) { const t = lines[pos].trim(); if (t === '---' || t === '...') fail('only one document is supported', pos); fail('unexpected content', pos); }
  return result;
}

// ---- writer -------------------------------------------------------------------------------------------------------
const KEEP = (cp) => cp >= 0x20 && cp !== 0x7f && !(cp >= 0x80 && cp <= 0x9f) && cp !== 0x2028 && cp !== 0x2029 && cp !== 0xfeff;
const plainSafe = (s) => s !== '' && /^[A-Za-z_\u00a1-\uffff][\w\u00a1-\uffff ./@+()-]*$/u.test(s) && !/^\s|\s$| #|: /.test(s) && !RESERVED.test(s) && !NUMBERLIKE.test(s) && !/^[\p{Cc}]/u.test(s) && !/[\p{Cc}\u2028\u2029\ufeff]/u.test(s);
const scalar = (s) => (plainSafe(s) ? s : quote(s, KEEP));

export function stringifyYaml(ast) {
  const out = [];
  const isLeaf = (v) => !(Array.isArray(v) ? v.length : v instanceof Map ? v.size : false);
  const leaf = (v) => {
    if (v === null) return 'null';
    if (typeof v === 'boolean') return String(v);
    if (typeof v === 'string') return scalar(v);
    if (typeof v === 'number' || v instanceof Dec) return String(v);
    if (Array.isArray(v)) return '[]';
    if (v instanceof Map) return '{}';
    throw new TgdError('syntax', 'YAML: cannot write this value');
  };
  const go = (v, ind) => {
    const sp = ' '.repeat(ind);
    if (Array.isArray(v) && v.length) {
      for (const x of v) {
        if (isLeaf(x)) out.push(`${sp}- ${leaf(x)}`);
        else { out.push(`${sp}-`); go(x, ind + 2); }
      }
    } else if (v instanceof Map && v.size) {
      for (const [k, x] of v) {
        if (isLeaf(x)) out.push(`${sp}${scalar(k)}: ${leaf(x)}`);
        else { out.push(`${sp}${scalar(k)}:`); go(x, ind + 2); }
      }
    } else out.push(sp + leaf(v));
  };
  go(ast, 0);
  return out.join('\n') + '\n';
}

export function readYaml(bytes) {
  const bom = hasBom(bytes);
  const ast = parseYaml(textOf(bytes));
  return { data: { kind: 'json', value: jsonToModel(ast) }, lossy: ['comments, anchors are refused', 'formatting and quoting style', 'text like 007, 0x1F and yes/no is kept as text, not converted', ...(bom ? ['byte order mark'] : [])].map((s) => s.replace('comments, anchors are refused', 'comments')) };
}
export function writeYaml(block) {
  const d = block.data;
  const ast = d.get('kind') === 'json' ? modelToJson(d.get('value')) : null;
  if (ast === null && d.get('kind') !== 'json') throw new TgdError('shape', 'Only JSON-like data can be written as YAML');
  return { bytes: new TextEncoder().encode(stringifyYaml(ast)), name: String(block.name || 'data').replace(/\.[^.]*$/, '') + '.yaml', mime: 'application/yaml' };
}
