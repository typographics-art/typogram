// A Typogram file is a valid SVG: it opens as the one-pager picture in any viewer (and thumbnails as that picture), and it
// also carries a documented metadata block, so the data or media inside can be read by our adapter — or by one you write
// yourself. The metadata lives in a standard <metadata> element, after the artwork's </text>, as XML-escaped JSON; being
// escaped, it never contains a literal "<text"/"</text>", so it cannot disturb the character-for-character text of the
// work (the read-back stays exact). The full container is docs/typogram-file.md.
export const TYPOGRAM_NS = 'https://typographics-art.org/ns/typogram/1';
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
