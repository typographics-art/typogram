// A Typogram file is a valid SVG: it opens as the one-pager picture in any viewer (and thumbnails as that picture), and it
// also carries a documented DATA LAYER, so the exact source and its metadata can be read by our tooling — or by one you
// write yourself. The data layer is a standard <metadata> element placed right after the opening <svg …>, before the
// artwork's <text>. It holds (a) the raw source (Markdown) in a CDATA section — byte for byte, directly usable — and (b) a
// schema.org JSON-LD record with the identity hash. Being CDATA/escaped, its content never disturbs the character-for-
// character text of the work (the read-back stays exact; readers strip the data layer first). The full container is
// docs/typogram-file.md; the hash and canonical form are docs/canonical-text.md.
import { b64urlEncode, b64urlDecode } from './crypt-codec.js';

export const TYPOGRAM_NS = 'https://typographics-art.org/ns/typogram/1';
export const TYPOGRAM_STREAM_NS = 'https://typographics-art.org/ns/typogram-stream/1';
const MAX_SOURCE = 64 * 1024 * 1024; // the exact source we will read back from a file, bytes
const MAX_META = 256 * 1024; // the JSON-LD record we will read from a file, bytes

/**
 * Embeds a sealed media stream (`tgst1` bytes, src/stream.js) inside the SVG as base64url, so the one file holds the whole
 * video and still opens as the cover picture (a renderer ignores the unknown element). The base64url alphabet has no "<",
 * so it can never disturb the artwork's text or this element's own end tag.
 */
export function embedStream(svgText, bytes) {
  const el = `<tgstream xmlns="${TYPOGRAM_STREAM_NS}" encoding="base64url">${b64urlEncode(bytes)}</tgstream>`;
  const i = svgText.lastIndexOf('</svg>');
  if (i < 0) throw new Error('not an SVG');
  return svgText.slice(0, i) + el + svgText.slice(i);
}

/** The embedded `tgst1` stream bytes of a Typogram SVG, or null. */
export function readEmbeddedStream(text) {
  if (typeof text !== 'string') return null;
  const m = /<tgstream\b[^>]*>([A-Za-z0-9_\-=\s]*?)<\/tgstream>/.exec(text);
  if (!m) return null;
  const clean = m[1].replace(/\s+/g, '');
  try { return b64urlDecode(clean, clean.length + 4); } catch { return null; }
}

// ---- the data layer: the exact source (Markdown) in CDATA + a JSON-LD record (docs/typogram-file.md, canonical-text.md) --
// The data layer is a <metadata> element placed right after <svg>. It holds (a) the raw source in a CDATA section — byte for
// byte, directly usable, nothing escaped except the CDATA terminator "]]>" — and (b) a schema.org JSON-LD record. Both can
// contain any text (even "<text", "</metadata>", "]]>"): CDATA keeps the Markdown opaque, the JSON-LD escapes "<" as <,
// and the readers below are CDATA-aware, so arbitrary content never disturbs the image layer's text extraction.
const DOC_NS = TYPOGRAM_NS;
const mediaAttr = (m) => String(m || 'text/plain').replace(/[^\w.+/\-;= ]/g, '');
const cdataEscape = (s) => s.replace(/]]>/g, ']]]]><![CDATA[>');          // split the terminator; concatenated CDATA re-forms it
const cdataUnescape = (s) => s.replace(/]]]]><!\[CDATA\[>/g, ']]>');
const jsonForScript = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c'); // no "</script>" or "<text" escapes into markup

/** The <metadata> data-layer block: raw Markdown in CDATA + a JSON-LD record. `jsonld` is the full object (see buildJsonld). */
export function buildDataLayer({ markdown = '', media = 'text/markdown', jsonld = null } = {}) {
  const doc = `<tgart:source xmlns:tgart="${DOC_NS}" media="${mediaAttr(media)}"><![CDATA[${cdataEscape(String(markdown))}]]></tgart:source>`;
  const ld = jsonld ? `<script type="application/ld+json">${jsonForScript(jsonld)}</script>` : '';
  return `<metadata>${doc}${ld}</metadata>`;
}

/** The exact source Markdown of a Typogram, CDATA-aware, or null. @returns {{markdown:string, media:string}|null} */
export function readDataMarkdown(text) {
  if (typeof text !== 'string') return null;
  const open = /<tgart:source\b([^>]*)>\s*<!\[CDATA\[/.exec(text);
  if (!open) return null;
  const start = open.index + open[0].length; // the first <tgart:source> is the real one (right after <svg><metadata>)
  const end = text.indexOf(']]></tgart:source>', start); // the only unescaped terminator (content's "]]>" was split)
  if (end < 0 || end - start > MAX_SOURCE) return null;
  const media = (/\bmedia="([^"]*)"/.exec(open[1]) || [])[1] || 'text/plain';
  return { markdown: cdataUnescape(text.slice(start, end)), media };
}

// The trusted markup region to read the JSON-LD record from — never from inside the attacker-controlled source block, so a
// fake <script type="application/ld+json"> hidden in the source cannot spoof tgart.hash/issuer/signature.
//  - SVG: the record sits AFTER the raw-Markdown CDATA (]]></tgart:source>) and before </metadata>; the CDATA Markdown,
//    which precedes it, is attacker-controlled, so it is excluded.
//  - HTML: the record sits in <head>, BEFORE the <script type="text/markdown"> that carries the (attacker) source, so read
//    only up to that block.
//  - No source block to hide a fake behind (a bare SVG/HTML): the whole text.
function jsonldRegion(text) {
  const meta = text.indexOf('<metadata>');
  if (meta >= 0) {
    const term = ']]></tgart:source>';
    const cdata = text.indexOf(term, meta);
    const from = cdata >= 0 ? cdata + term.length : meta + '<metadata>'.length;
    const close = text.indexOf('</metadata>', from);
    return close < 0 ? null : [from, close];
  }
  const md = text.indexOf('<script type="text/markdown"');
  if (md >= 0) return [0, md];
  return [0, text.length];
}

/** The JSON-LD record of a Typogram, read only from the data-layer markup (not from the CDATA Markdown), or null. */
export function readJsonld(text) {
  if (typeof text !== 'string') return null;
  const region = jsonldRegion(text);
  if (!region) return null;
  const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(text.slice(region[0], region[1]));
  if (!m || m[1].length > MAX_META) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/** Removes the data-layer <metadata> block (CDATA-safe), so the remaining text can be scanned for the image layer. */
export function stripDataLayer(text) {
  if (typeof text !== 'string') return text;
  const meta = text.indexOf('<metadata>');
  if (meta < 0) return text;
  const cdataEnd = text.indexOf(']]></tgart:source>', meta); // skip past the opaque CDATA before looking for </metadata>
  const from = cdataEnd >= 0 ? cdataEnd : meta;
  const close = text.indexOf('</metadata>', from);
  if (close < 0) return text;
  return text.slice(0, meta) + text.slice(close + '</metadata>'.length);
}

/** A schema.org DigitalDocument record for a Typogram. Unset fields are omitted. */
export function buildJsonld({ name, author, dateCreated, inLanguage, license, description, sourceUrl, sourceFormat = 'text/markdown', charCount, hash, generator = 'typogram' } = {}) {
  const r = { '@context': 'https://schema.org', '@type': 'DigitalDocument' };
  if (name != null) r.name = String(name);
  if (author != null) r.author = String(author);
  if (dateCreated != null) r.dateCreated = String(dateCreated);
  if (inLanguage != null) r.inLanguage = String(inLanguage);
  if (license != null) r.license = String(license);
  if (description != null) r.description = String(description);
  if (sourceUrl != null) r.url = String(sourceUrl);
  r.tgart = { version: 1, generator, sourceFormat, ...(charCount != null ? { charCount } : {}), ...(hash != null ? { hash } : {}) };
  return r;
}
