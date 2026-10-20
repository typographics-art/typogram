// Picture-layer lint for SVG Typograms (docs/verification.md §6). The identity hash and the signature cover the TEXT, so a
// text-only check cannot see a "visual lie": the signed text is intact while what is PAINTED differs — a shape drawn over
// words, a glyph recoloured to the background, the whole picture faded out. The generator's picture layer is tiny and fixed:
// one background <rect>, one <text> of <tspan x y [size weight width fill]>, and (when signed) the corner seal. Everything
// else can only be there to change what a reader SEES, so it is reported. Pure (no browser, no I/O), so `tg verify` stays
// cheap. The scan is deliberately strict and anchored (not a general SVG parser): anything it does not recognise is a
// problem, never skipped — a parser that skips what it cannot read is the very gap this check exists to close.
import { SEAL_ID, SEAL_GREEN, sealGeometry } from './stamp.js';

const ROOT_ATTRS = new Set(['xmlns', 'width', 'height', 'viewBox']);
const TEXT_ATTRS = new Set(['xml:space', 'font-family', 'font-weight', 'font-size', 'style', 'fill']);
// per-glyph size, weight and width are the technique itself (mixed-size works); style is limited to type features like on <text>
const TSPAN_ATTRS = new Set(['x', 'y', 'font-weight', 'font-size', 'font-stretch', 'style', 'fill']);
const RECT_ATTRS = new Set(['width', 'height', 'fill']);
// the only declarations the generator puts on a style attribute: type features that do not change what is painted
const STYLE_OK = /^(?:\s*(?:font-variation-settings|font-variant-ligatures|font-kerning|font-feature-settings)\s*:[^;<>{}]*;?)+\s*$/;
const NUM = /^-?\d+(?:\.\d+)?$/;
const OPAQUE = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/; // the generator only ever writes opaque rgb(); none/transparent/rgba/names hide glyphs
const MIN_FONT_SIZE = 1; // user units; the smallest type the generator makes is ~4 (docs/ai-readability.md)

// one whole tag, attribute-aware: a ">" or "<" inside a quoted value cannot end or split it
const ATTR = String.raw`\s+[\w:.-]+\s*=\s*(?:"[^"<>]*"|'[^'<>]*')`;
const TAG = new RegExp(String.raw`<(/?)([a-zA-Z][\w:-]*)((?:${ATTR})*)\s*(/?)>`, 'y');
// attribute values are checked as written, so an entity ("&#59;" for ";") could disguise a value from every check: the
// only entity the generator writes in an attribute is &quot; (inside a style), anything else is refused outright
const attrsOf = (s) => [...s.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((m) => [m[1], m[2] ?? m[3]]);
const hasEntity = (v) => /&/.test(String(v).replace(/&quot;/g, ''));
const colour = (v) => { const m = OPAQUE.exec(String(v || '').trim()); if (!m) return null; const c = [+m[1], +m[2], +m[3]]; return c.every((n) => n <= 255) ? c : null; };

/**
 * Problems that mean the painted picture may not show the signed text. Empty for everything this tool generates.
 * @param {string} svgText the whole SVG file
 * @returns {string[]}
 */
export function pictureLayerProblems(svgText) {
  const out = [];
  const add = (p) => { if (out.length < 8 && !out.includes(p)) out.push(p); };
  const src = String(svgText);

  // 1. markup the scan could be steered by: declarations and processing instructions
  if (/<!DOCTYPE|<!ENTITY|<\?(?!xml\s)/i.test(src)) add('a DOCTYPE, entity or processing instruction (they can redefine what the markup means)');

  // 2. the root, then the data layer — which must be the generator's block, directly after the root, ended at its real end
  const root = /^\s*(?:<\?xml[^>]*\?>\s*)?<svg((?:\s+[\w:.-]+\s*=\s*(?:"[^"<>]*"|'[^'<>]*'))*)\s*>/.exec(src);
  if (!root) return [...out, "not the generator's SVG picture layer (root element)"];
  if (attrsOf(root[1]).some(([, v]) => hasEntity(v))) add('an entity inside an attribute value (it can disguise the value from the check)');
  for (const [k] of attrsOf(root[1])) if (!ROOT_ATTRS.has(k)) add(`the root <svg> carries "${k}", which can change how the whole picture is painted`);
  // fail closed: the page box every position check below is measured against must be the generator's `0 0 W H`
  const vb = /\bviewBox\s*=\s*"0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(root[1]);
  if (!vb) return [...out, 'the picture has no viewBox of the form "0 0 W H" (every glyph position is measured against it)'];
  vb.splice(1, 0, '0', '0'); // keep the vb[3]/vb[4] = width/height indexing used below
  let rest = src.slice(root[0].length);
  const meta = /^<metadata><tgart:source\b[^>]*><!\[CDATA\[/.exec(rest);
  if (!meta) return [...out, 'the data layer is not the first thing in the picture (it may hide markup from the check)'];
  // the CDATA ends at the FIRST "]]>" (as in an XML parser); the generator splits a "]]>" in the source into "]]]]><![CDATA[>",
  // so the only thing that may follow one is a re-opened CDATA or the end of the source element. Anything else is rejected.
  let pos = meta[0].length, cdataEnd = -1;
  for (let guard = 0; guard < 1e6; guard++) {
    const e = rest.indexOf(']]>', pos);
    if (e < 0) break;
    const after = e + 3;
    if (rest.startsWith('<![CDATA[', after)) { pos = after + 9; continue; }
    if (rest.startsWith('</tgart:source>', after)) cdataEnd = e;
    break;
  }
  if (cdataEnd < 0) return [...out, 'the data layer does not end the way the generator writes it (markup after its CDATA can hide shapes)'];
  const metaEnd = rest.indexOf('</metadata>', cdataEnd);
  if (metaEnd < 0) return [...out, 'the data layer is not closed'];
  // between the source and </metadata> only the JSON-LD record may sit (a <script> never paints)
  const tail = rest.slice(cdataEnd + ']]></tgart:source>'.length, metaEnd);
  if (tail !== '' && !/^<script type="application\/ld\+json">[^<]*<\/script>$/.test(tail)) add('the data layer carries more than the source and its JSON-LD record');
  rest = rest.slice(metaEnd + '</metadata>'.length);

  // 3. the picture proper, tag by tag. Text between tags is only allowed inside the glyph runs.
  let bg = null, rects = 0, texts = 0, closedText = 0, titles = 0, sealSeen = false, inText = false, inTspan = false;
  let i = 0;
  const n = rest.length;
  while (i < n) {
    const lt = rest.indexOf('<', i);
    const chunk = rest.slice(i, lt < 0 ? n : lt);
    if (chunk.trim() !== '' && !inTspan) add('text outside the glyph runs in the picture layer');
    if (lt < 0) break;
    // <title> and <style> have opaque bodies: read them whole, check them, move on
    const t = /^<(title|style)>/.exec(rest.slice(lt, lt + 8));
    if (t) {
      const close = rest.indexOf(`</${t[1]}>`, lt);
      if (close < 0) { add(`an unclosed <${t[1]}>`); break; }
      const body = rest.slice(lt + t[0].length, close);
      if (t[1] === 'title') { titles++; if (titles > 1) add('more than one <title>'); if (/[<>]/.test(body)) add('markup inside <title>'); }
      else if (body.replace(/@font-face\s*\{[^{}]*\}/g, '').replace(/@import\s+url\(\s*(['"]?)https:\/\/[^'")\s<>]+\1\s*\)\s*;?/g, '').trim() !== '') add('the picture layer carries a stylesheet that restyles the glyphs (only @font-face / an https font @import is expected)');
      i = close + t[1].length + 3;
      continue;
    }
    TAG.lastIndex = lt;
    const m = TAG.exec(rest);
    if (!m) { add('markup the check cannot read in the picture layer (a malformed tag, comment or CDATA can hide a shape)'); break; }
    i = TAG.lastIndex;
    const [, closing, tag, rawAttrs, selfClose] = m;
    const attrs = attrsOf(rawAttrs);
    if (attrs.some(([, v]) => hasEntity(v))) add('an entity inside an attribute value (it can disguise the value from the check)');
    if (closing) {
      if (tag === 'text') { inText = false; closedText++; } else if (tag === 'tspan') inTspan = false;
      continue;
    }
    if (tag === 'svg') add('a nested <svg> in the picture layer (it can carry its own opacity, clip or content)');
    else if (tag === 'g' && attrs.some(([k, v]) => k === 'id' && v === SEAL_ID)) {
      // the seal is the one allowed non-text overlay: it must be byte-for-byte what the stamper draws, and last
      const close = rest.indexOf('</g>', lt);
      const seal = close < 0 ? '' : rest.slice(lt, close + 4);
      let ok = false;
      if (seal && !sealSeen && rest.slice(close + 4).trim() === '</svg>') {
        const g = sealGeometry(parseFloat(vb[3]), parseFloat(vb[4]));
        ok = seal === `<g id="${SEAL_ID}" aria-label="signed Typogram">`
          + `<path d="M ${g.triangle.split(' ').map((p) => p.replace(',', ' ')).join(' L ')} Z" fill="${SEAL_GREEN}"/>`
          + `<path d="${g.check}" fill="none" stroke="#fff" stroke-width="${g.stroke}" stroke-linecap="round" stroke-linejoin="round"/></g>`;
      }
      sealSeen = true;
      if (!ok) add('the signed-seal corner is not the one the signer draws (a shape of that name can cover words)');
      if (close < 0) break;
      i = close + 4;
    } else if (tag === 'rect') {
      rects++;
      if (rects > 1 || texts > 0) add('a second shape is drawn in the picture layer (it can cover or fake words)');
      for (const [k] of attrs) if (!RECT_ATTRS.has(k)) add(`the background rectangle carries "${k}"`);
      const w = attrs.find(([k]) => k === 'width'), h = attrs.find(([k]) => k === 'height');
      if (!w || !h || w[1] !== '100%' || h[1] !== '100%') add('the background rectangle is not the full page');
      bg = colour((attrs.find(([k]) => k === 'fill') || [])[1]);
      if (!bg) add('the background colour is not an opaque rgb()');
    } else if (tag === 'text') {
      texts++;
      if (texts > 1) add('more than one <text> block in the picture layer');
      inText = !selfClose;
      for (const [k, v] of attrs) {
        if (!TEXT_ATTRS.has(k)) add(`the <text> block carries "${k}", which can move, hide or fade the glyphs`);
        else if (k === 'style' && !STYLE_OK.test(v.replace(/&quot;/g, '"'))) add('the <text> style changes more than type features (opacity, visibility, transform … can hide words)');
        else if (k === 'font-size' && !(NUM.test(v) && parseFloat(v) >= MIN_FONT_SIZE)) add('the <text> block has no visible font size');
        else if (k === 'fill' && !colour(v)) add('the <text> colour is not an opaque rgb() (none, transparent or rgba hide the glyphs)');
        else if (k === 'fill' && bg && colour(v).every((c, j) => c === bg[j])) add('the glyph colour of the <text> block is exactly the background colour: all unpainted glyphs are invisible');
      }
    } else if (tag === 'tspan') {
      if (!inText) add('a glyph run sits outside the <text> block');
      inTspan = !selfClose;
      for (const [k, v] of attrs) {
        if (!TSPAN_ATTRS.has(k)) { add(`a glyph carries "${k}", which can move, hide or fade it`); continue; }
        if (k === 'x' || k === 'y') {
          // one plain number: a list (x="1 2 3") would move the glyphs after the first, and off-page glyphs are not on the picture
          const lim = parseFloat(vb[k === 'x' ? 3 : 4]);
          if (!NUM.test(v) || !(parseFloat(v) >= 0 && parseFloat(v) <= lim)) add('a glyph position is not one number on the page, so the text reads back but is not on the picture');
        } else if (k === 'font-size') { if (!(NUM.test(v) && parseFloat(v) >= MIN_FONT_SIZE)) add('a glyph has no visible font size'); }
        else if (k === 'style') { if (!STYLE_OK.test(v.replace(/&quot;/g, '"'))) add('a glyph style changes more than type features (opacity, visibility, transform … can hide it)'); }
        else if (k === 'fill') {
          const c = colour(v);
          if (!c) add('a glyph colour is not an opaque rgb() (none, transparent or rgba hide it)');
          else if (bg && c.every((x, j) => x === bg[j])) add('a glyph has exactly the background colour: that character is invisible');
        }
      }
    } else {
      add(`<${tag}> in the picture layer paints something that is not a glyph (a shape, image or script can cover or fake words)`);
    }
  }
  if (rects === 0) add('the picture layer has no background rectangle');
  if (texts === 0) add('the picture layer has no <text> block');
  else if (closedText !== texts) add('the <text> block is not closed');
  return out;
}
