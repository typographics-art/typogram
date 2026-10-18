// A Typogram file is a valid SVG: it opens as the one-pager picture in any viewer (and thumbnails as that picture), and it
// also carries a documented metadata block, so the data or media inside can be read by our adapter — or by one you write
// yourself. The metadata lives in a standard <metadata> element, after the artwork's </text>, as XML-escaped JSON; being
// escaped, it never contains a literal "<text"/"</text>", so it cannot disturb the character-for-character text of the
// work (the read-back stays exact). The full container is docs/typogram-file.md.
import { b64urlEncode, b64urlDecode, deflateRaw, inflateRaw } from './crypt-codec.js';

export const TYPOGRAM_NS = 'https://typographics-art.org/ns/typogram/1';
export const TYPOGRAM_STREAM_NS = 'https://typographics-art.org/ns/typogram-stream/1';
export const TYPOGRAM_SOURCE_NS = 'https://typographics-art.org/ns/typogram-source/1';
const MAX_SOURCE = 64 * 1024 * 1024; // the decompressed source we will read back, bytes
const MAX_META = 256 * 1024; // the metadata JSON we will read from a file, bytes

const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/**
 * The <metadata> element for a Typogram SVG. `meta` is the envelope (title, created, textSha256, kind, media, data,
 * companion, …); `format` and `v` are added. Returns '' for no metadata.
 */
export function writeMeta(meta) {
  if (!meta) return '';
  const json = JSON.stringify({ format: 'typogram', v: 1, ...meta });
  return `<metadata><typogram xmlns="${TYPOGRAM_NS}">${escapeXml(json)}</typogram></metadata>`;
}

/** The Typogram metadata of an SVG (or any text that holds the element), or null. Tolerant: a missing or broken block is null. */
export function readMeta(text) {
  if (typeof text !== 'string') return null;
  const m = /<typogram\b[^>]*>([\s\S]{0,262144}?)<\/typogram>/.exec(text);
  if (!m) return null;
  try { const o = JSON.parse(unescapeXml(m[1])); return o && o.format === 'typogram' ? o : null; } catch { return null; }
}

const METADATA_RE = /<metadata>\s*<typogram\b[\s\S]*?<\/typogram>\s*<\/metadata>/;
/** Replaces (or adds) the Typogram metadata of an SVG, keeping it one file and a valid picture. */
export function withMeta(svgText, meta) {
  const block = writeMeta(meta);
  const stripped = svgText.replace(METADATA_RE, '');
  const i = stripped.lastIndexOf('</svg>');
  if (i < 0) throw new Error('not an SVG');
  return stripped.slice(0, i) + block + stripped.slice(i);
}

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

// ---- the exact source (lossless formatting) --------------------------------------------------------------------------
// The visible artwork text normalises whitespace (runs become one space), which keeps the picture and the prose but loses
// Markdown tables, lists and code structure. A Typogram can ALSO carry the exact source bytes — deflate-compressed, base64url
// — so a reader restores the original formatting from the source while a plain viewer still sees the picture. The source is
// authoritative: the visible text equals it after whitespace normalisation (the build checks that).
const mediaAttr = (m) => String(m || 'text/plain').replace(/[^\w.+/\-;= ]/g, '');

/** Adds the exact source to an SVG as a `<tgsource>` element (deflate + base64url). `media` is its MIME type. */
export async function embedSource(svgText, bytes, { media = 'text/plain' } = {}) {
  const packed = b64urlEncode(await deflateRaw(bytes));
  const el = `<tgsource xmlns="${TYPOGRAM_SOURCE_NS}" media="${mediaAttr(media)}" encoding="base64url" compression="deflate-raw">${packed}</tgsource>`;
  const i = svgText.lastIndexOf('</svg>');
  if (i < 0) throw new Error('not an SVG');
  return svgText.slice(0, i) + el + svgText.slice(i);
}

/** The exact source of a Typogram SVG as `{ bytes, media }`, or null. */
export async function readSource(text) {
  if (typeof text !== 'string') return null;
  const m = /<tgsource\b([^>]*)>([A-Za-z0-9_\-=\s]*?)<\/tgsource>/.exec(text);
  if (!m) return null;
  const media = (/\bmedia="([^"]*)"/.exec(m[1]) || [])[1] || 'text/plain';
  const clean = m[2].replace(/\s+/g, '');
  try { return { bytes: await inflateRaw(b64urlDecode(clean, clean.length + 4), MAX_SOURCE), media }; } catch { return null; }
}
