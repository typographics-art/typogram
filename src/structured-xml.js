// A small, strict XML reader and writer. Elements become JsonML: ["tag", {attributes}?, ...children], children being
// strings or elements. Used for the XML format and, inside, for the parts of an .xlsx file.
//
// Safety: a DOCTYPE is refused (no external entities, no entity expansion: "billion laughs" cannot happen because only
// the five built-in entities and numeric references exist), nesting, node count and text size are limited.
// Dropped, and declared in the envelope: comments, processing instructions, the DOCTYPE (refused), CDATA boundaries,
// whitespace between elements, the prolog, the order of namespace declarations relative to other attributes is kept.
import { TgdError } from './structured-json.js';

export const DEFAULT_XML_LIMITS = { maxDepth: 256, maxNodes: 6_000_000, maxText: 64 * 1024 * 1024 };
const NAME = /[A-Za-z_:\u00c0-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd\u{10000}-\u{effff}][\w:.\u00b7\u00c0-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd\u{10000}-\u{effff}-]*/uy;
const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
// XML 1.0 Char: #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF]
const BAD_CHAR = /[^\t\n\r -\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u;

export const xmlTag = (n) => n[0];
export const xmlAttrs = (n) => (n[1] && typeof n[1] === 'object' && !Array.isArray(n[1]) ? n[1] : null);
export const xmlKids = (n) => (xmlAttrs(n) ? n.slice(2) : n.slice(1));
export const xmlElems = (n, tag) => xmlKids(n).filter((k) => Array.isArray(k) && (!tag || k[0] === tag));
export const xmlText = (n) => xmlKids(n).map((k) => (typeof k === 'string' ? k : xmlText(k))).join('');
export const xmlAttr = (n, name) => xmlAttrs(n)?.[name];

function decodeRefs(s, fail) {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z][\w.-]*);/g, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!(cp === 9 || cp === 10 || cp === 13 || (cp >= 0x20 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff))) fail(`Character reference ${m} is not an XML character`);
      return String.fromCodePoint(cp);
    }
    if (!(e in ENT)) fail(`Unknown entity &${e}; (only lt, gt, amp, quot, apos are allowed)`);
    return ENT[e];
  });
}

/** @returns {{ root: Array, declaration: {version:string, encoding?:string, standalone?:string}|null }} */
export function parseXml(input, limits = {}) {
  const L = { ...DEFAULT_XML_LIMITS, ...limits };
  const s = String(input).replace(/^\ufeff/, '');
  let i = 0, nodes = 0, textBytes = 0;
  const line = (at) => 1 + (s.slice(0, at).match(/\n/g) || []).length;
  const fail = (msg, at = i) => { throw new TgdError('syntax', `XML: ${msg} (line ${line(at)})`, { offset: at }); };
  const bad = BAD_CHAR.exec(s);
  if (bad) fail(`character U+${bad[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} is not allowed in XML`, bad.index);
  let declaration = null;
  const decl = /^<\?xml\s+([^?]*)\?>/.exec(s);
  if (decl) {
    declaration = {};
    for (const m of decl[1].matchAll(/(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) declaration[m[1]] = m[2] ?? m[3];
    i = decl[0].length;
  }
  const stack = [];
  let root = null;
  const text = s.replace(/\r\n?/g, '\n');
  const src = text;
  const skipMisc = () => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src.startsWith('<!--', i)) { const e = src.indexOf('-->', i + 4); if (e < 0) fail('Unterminated comment'); i = e + 3; continue; }
      if (src.startsWith('<?', i)) { const e = src.indexOf('?>', i + 2); if (e < 0) fail('Unterminated processing instruction'); i = e + 2; continue; }
      if (src.startsWith('<!DOCTYPE', i) || src.startsWith('<!doctype', i)) throw new TgdError('syntax', 'XML: a DOCTYPE declaration is refused (it can pull in external files and expand entities)');
      return;
    }
  };
  const addText = (t) => {
    if (!t) return;
    textBytes += t.length;
    if (textBytes > L.maxText) throw new TgdError('limit', 'XML text is too large');
    const top = stack.at(-1);
    if (!top) { if (t.trim()) fail('Text outside the root element'); return; }
    const k = top.kids;
    if (typeof k.at(-1) === 'string') k[k.length - 1] += t; else k.push(t);
  };
  skipMisc();
  while (i < src.length) {
    if (src[i] !== '<') {
      const e = src.indexOf('<', i);
      const raw = src.slice(i, e < 0 ? src.length : e);
      if (raw.includes(']]>')) fail('"]]>" is not allowed in text');
      addText(decodeRefs(raw, fail)); i = e < 0 ? src.length : e; continue;
    }
    if (src.startsWith('<!--', i)) { const e = src.indexOf('-->', i + 4); if (e < 0) fail('Unterminated comment'); i = e + 3; continue; }
    if (src.startsWith('<![CDATA[', i)) { const e = src.indexOf(']]>', i + 9); if (e < 0) fail('Unterminated CDATA section'); addText(src.slice(i + 9, e)); i = e + 3; continue; }
    if (src.startsWith('<?', i)) { const e = src.indexOf('?>', i + 2); if (e < 0) fail('Unterminated processing instruction'); i = e + 2; continue; }
    if (src.startsWith('<!', i)) throw new TgdError('syntax', 'XML: a DOCTYPE or other <! declaration is refused');
    if (src[i + 1] === '/') {
      NAME.lastIndex = i + 2;
      const m = NAME.exec(src);
      const top = stack.pop();
      if (!m || !top || m[0] !== top.tag) fail(`Closing tag does not match${top ? ` <${top.tag}>` : ''}`);
      i = NAME.lastIndex;
      while (/\s/.test(src[i] || '')) i++;
      if (src[i] !== '>') fail('Expected ">"');
      i++;
      const node = [top.tag, ...(top.attrs ? [top.attrs] : []), ...clean(top.kids)];
      if (stack.length) stack.at(-1).kids.push(node); else { root = node; i = skipTail(); }
      continue;
    }
    // start tag
    if (root) fail('More than one root element');
    NAME.lastIndex = i + 1;
    const m = NAME.exec(src);
    if (!m) fail('Bad element name');
    if (++nodes > L.maxNodes) throw new TgdError('limit', `XML has more than ${L.maxNodes} elements`);
    if (stack.length >= L.maxDepth) throw new TgdError('limit', `XML nesting is deeper than ${L.maxDepth}`);
    i = NAME.lastIndex;
    let attrs = null;
    for (;;) {
      const before = i;
      while (/\s/.test(src[i] || '')) i++;
      if (src[i] === '>' || (src[i] === '/' && src[i + 1] === '>')) break;
      if (i === before) fail('Expected a space before an attribute');
      NAME.lastIndex = i;
      const a = NAME.exec(src);
      if (!a) fail('Bad attribute name');
      i = NAME.lastIndex;
      while (/\s/.test(src[i] || '')) i++;
      if (src[i] !== '=') fail('Expected "="');
      i++;
      while (/\s/.test(src[i] || '')) i++;
      const q = src[i];
      if (q !== '"' && q !== "'") fail('Attribute values must be quoted');
      const e = src.indexOf(q, i + 1);
      if (e < 0) fail('Unterminated attribute value');
      const rawVal = src.slice(i + 1, e);
      if (rawVal.includes('<')) fail('"<" is not allowed in an attribute value');
      attrs ||= {};
      if (Object.prototype.hasOwnProperty.call(attrs, a[0])) fail(`Duplicate attribute ${a[0]}`);
      Object.defineProperty(attrs, a[0], { value: decodeRefs(rawVal.replace(/[\t\n]/g, ' '), fail), enumerable: true, writable: true, configurable: true });
      i = e + 1;
    }
    const selfClose = src[i] === '/';
    i += selfClose ? 2 : 1;
    if (selfClose) {
      const node = [m[0], ...(attrs ? [attrs] : [])];
      if (stack.length) stack.at(-1).kids.push(node); else { root = node; i = skipTail(); }
    } else stack.push({ tag: m[0], attrs, kids: [] });
  }
  function skipTail() { skipMisc(); if (i < src.length) fail('Content after the root element'); return i; }
  if (stack.length) fail(`Element <${stack.at(-1).tag}> is not closed`);
  if (!root) fail('No root element');
  return { root, declaration };
}

/** Drops whitespace-only text between elements; text that is all there is in an element stays exactly as written. */
function clean(kids) {
  const mixed = kids.some((k) => typeof k === 'string' && k.trim() !== '');
  if (!mixed && kids.some((k) => typeof k !== 'string')) return kids.filter((k) => typeof k !== 'string');
  return kids;
}

const escText = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#13;');
const escAttr = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/\t/g, '&#9;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;');

/** XML text of a JsonML element (indented where an element holds only elements). */
export function writeXmlTree(root, { indent = 2, declaration = true } = {}) {
  const out = [];
  const go = (n, d) => {
    if (!Array.isArray(n) || typeof n[0] !== 'string') throw new TgdError('shape', 'XML: an element must be an array starting with its name');
    if (!new RegExp(`^(?:${NAME.source})$`, 'u').test(n[0])) throw new TgdError('shape', `XML: bad element name ${JSON.stringify(n[0].slice(0, 30))}`);
    const a = xmlAttrs(n), kids = xmlKids(n);
    let open = '<' + n[0];
    if (a) for (const [k, v] of Object.entries(a)) {
      if (!new RegExp(`^(?:${NAME.source})$`, 'u').test(k)) throw new TgdError('shape', `XML: bad attribute name ${JSON.stringify(k.slice(0, 30))}`);
      open += ` ${k}="${escAttr(String(v))}"`;
    }
    if (!kids.length) { out.push(open + '/>'); return; }
    const onlyElems = kids.every((k) => Array.isArray(k));
    if (!onlyElems) { out.push(open + '>'); for (const k of kids) { if (typeof k === 'string') out.push(escText(k)); else go(k, d + 1); } out.push(`</${n[0]}>`); return; }
    out.push(open + '>');
    for (const k of kids) { out.push('\n' + ' '.repeat((d + 1) * indent)); go(k, d + 1); }
    out.push('\n' + ' '.repeat(d * indent) + `</${n[0]}>`);
  };
  go(root, 0);
  const text = out.join('');
  const bad = BAD_CHAR.exec(text);
  if (bad) throw new TgdError('shape', `XML 1.0 cannot hold the character U+${bad[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
  return (declaration ? '<?xml version="1.0" encoding="UTF-8"?>\n' : '') + text + '\n';
}

// ---- the file format ----------------------------------------------------------------------------------------------
function decodeXmlBytes(bytes, encoding) {
  if (typeof bytes === 'string') return bytes;
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  const head = new TextDecoder('latin1').decode(b.subarray(0, 200));
  const label = encoding || /^\s*<\?xml[^?]*encoding\s*=\s*["']([^"']+)["']/.exec(head)?.[1] || 'utf-8';
  try { return new TextDecoder(label, { fatal: true }).decode(b); } catch (e) {
    throw new TgdError('encoding', e instanceof RangeError ? `Unknown XML encoding ${JSON.stringify(label)}` : `The XML file is not valid ${label}`);
  }
}

export function readXml(bytes, { encoding, limits } = {}) {
  const { root } = parseXml(decodeXmlBytes(bytes, encoding), limits);
  return {
    data: { kind: 'xml', root },
    lossy: ['comments and processing instructions', 'the XML declaration and encoding (output is UTF-8)', 'CDATA boundaries (the text is kept)', 'whitespace between elements', 'a DOCTYPE is refused, not kept'],
  };
}
export function writeXml(block, { indent = 2 } = {}) {
  const root = block.model.root;
  return { bytes: new TextEncoder().encode(writeXmlTree(root, { indent })), name: String(block.name || 'data').replace(/\.[^.]*$/, '') + '.xml', mime: 'application/xml' };
}
