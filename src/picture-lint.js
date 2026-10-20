// Picture-layer lint for SVG Typograms (docs/verification.md §6). The identity hash and the signature cover the TEXT, so a
// text-only check cannot see a "visual lie": the signed text is intact while what is PAINTED differs — a shape drawn over
// words, a glyph recoloured to the background, the whole picture faded out. The generator's picture layer is tiny and fixed:
// one background <rect>, one <text> of <tspan x y [font-weight] [fill]>, and (when signed) the corner seal. Everything else
// can only be there to change what a reader SEES, so it is reported. Pure (no browser, no I/O), so `tg verify` stays cheap.
import { stripDataLayer } from './typogram.js';
import { SEAL_ID, SEAL_GREEN, sealGeometry } from './stamp.js';

const ROOT_ATTRS = new Set(['xmlns', 'width', 'height', 'viewBox']);
const TEXT_ATTRS = new Set(['xml:space', 'font-family', 'font-weight', 'font-size', 'style', 'fill']);
// per-glyph size, weight and width are the technique itself (mixed-size works); style is limited to type features like on <text>
const TSPAN_ATTRS = new Set(['x', 'y', 'font-weight', 'font-size', 'font-stretch', 'style', 'fill']);
const RECT_ATTRS = new Set(['width', 'height', 'fill']);
// the only declarations the generator puts on <text style>: type features that do not change what is painted
const TEXT_STYLE_OK = /^(?:\s*(?:font-variation-settings|font-variant-ligatures|font-kerning|font-feature-settings)\s*:[^;]*;?)+\s*$/;

const attrsOf = (s) => [...s.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((m) => [m[1], m[2] ?? m[3]]);
const rgb = (v) => { const m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(String(v || '').trim()); return m ? [+m[1], +m[2], +m[3]] : null; };

/**
 * Problems that mean the painted picture may not show the signed text. Empty for everything this tool generates.
 * @param {string} svgText the whole SVG file
 * @returns {string[]}
 */
export function pictureLayerProblems(svgText) {
  const out = [];
  const add = (p) => { if (out.length < 8 && !out.includes(p)) out.push(p); };
  // the data layer is opaque to the picture (it never paints); fonts are @font-face only
  let s = stripDataLayer(String(svgText));
  s = s.replace(/<style>([\s\S]*?)<\/style>/g, (_, css) => {
    if (css.replace(/@font-face\s*\{[^{}]*\}/g, '').replace(/@import\s+url\(\s*(['"]?)https:\/\/[^'")\s]+\1\s*\)\s*;?/g, '').trim() !== '') add('the picture layer carries a stylesheet that restyles the glyphs (only @font-face / an https font @import is expected)');
    return '<style/>';
  });
  s = s.replace(/<title>[\s\S]*?<\/title>/g, '<title/>').replace(/<!--[\s\S]*?-->/g, '');

  const root = /<svg\b([^>]*)>/.exec(s);
  if (!root) return ['not an SVG picture layer'];
  for (const [k] of attrsOf(root[1])) if (!ROOT_ATTRS.has(k)) add(`the root <svg> carries "${k}", which can change how the whole picture is painted`);
  const vb = /viewBox\s*=\s*"\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)\s*"/.exec(root[1]);

  // the seal is the one allowed non-text overlay: it must be byte-for-byte what the stamper draws, and last
  const sealAt = s.indexOf(`<g id="${SEAL_ID}"`);
  if (sealAt >= 0) {
    const close = s.indexOf('</g>', sealAt);
    const seal = close < 0 ? '' : s.slice(sealAt, close + 4);
    let ok = false;
    if (vb && seal && s.slice(close + 4).trim() === '</svg>') {
      const g = sealGeometry(parseFloat(vb[3]), parseFloat(vb[4]));
      const want = `<g id="${SEAL_ID}" aria-label="signed Typogram">`
        + `<path d="M ${g.triangle.split(' ').map((p) => p.replace(',', ' ')).join(' L ')} Z" fill="${SEAL_GREEN}"/>`
        + `<path d="${g.check}" fill="none" stroke="#fff" stroke-width="${g.stroke}" stroke-linecap="round" stroke-linejoin="round"/></g>`;
      ok = seal === want;
    }
    if (!ok) add('the signed-seal corner is not the one the signer draws (a shape of that name can cover words)');
    s = s.slice(0, sealAt) + s.slice(close < 0 ? sealAt : close + 4);
  }

  let bg = null, rects = 0, texts = 0, afterText = false;
  for (const m of s.matchAll(/<\/?([a-zA-Z][\w:-]*)\b([^>]*)>/g)) {
    const [whole, tag, rest] = m;
    if (whole.startsWith('</')) { if (tag === 'text') afterText = true; continue; }
    const attrs = attrsOf(rest);
    if (tag === 'svg' || tag === 'title' || tag === 'style') continue;
    if (tag === 'rect') {
      rects++;
      if (rects > 1 || texts > 0) add('a second shape is drawn in the picture layer (it can cover or fake words)');
      for (const [k, v] of attrs) if (!RECT_ATTRS.has(k)) add(`the background rectangle carries "${k}"`);
      const w = attrs.find(([k]) => k === 'width'), h = attrs.find(([k]) => k === 'height');
      if (!w || !h || w[1] !== '100%' || h[1] !== '100%') add('the background rectangle is not the full page');
      bg = rgb((attrs.find(([k]) => k === 'fill') || [])[1]);
    } else if (tag === 'text') {
      texts++;
      if (texts > 1) add('more than one <text> block in the picture layer');
      for (const [k, v] of attrs) {
        if (!TEXT_ATTRS.has(k)) add(`the <text> block carries "${k}", which can move, hide or fade the glyphs`);
        if (k === 'font-size' && !(parseFloat(v) > 0)) add('the <text> block has no visible font size');
        if (k === 'style' && !TEXT_STYLE_OK.test(v.replace(/&quot;/g, '"'))) add('the <text> style changes more than type features (opacity, visibility, transform … can hide words)');
      }
    } else if (tag === 'tspan') {
      if (texts === 0 || afterText) add('a glyph run sits outside the <text> block');
      let fill = null;
      for (const [k, v] of attrs) {
        if (!TSPAN_ATTRS.has(k)) add(`a glyph carries "${k}", which can move, hide or fade it`);
        if (k === 'fill') fill = rgb(v);
        if (k === 'font-size' && !(parseFloat(v) > 0)) add('a glyph has no visible font size');
        if (k === 'style' && !TEXT_STYLE_OK.test(v.replace(/&quot;/g, '"'))) add('a glyph style changes more than type features (opacity, visibility, transform … can hide it)');
        // a glyph placed outside the canvas is not on the picture (the text still reads back, the reader sees nothing)
        if (vb && (k === 'x' || k === 'y')) { const n = parseFloat(v), lim = parseFloat(vb[k === 'x' ? 3 : 4]); if (!(n >= 0 && n <= lim)) add('a glyph sits outside the page, so the text reads back but is not on the picture'); }
      }
      if (bg && fill && fill[0] === bg[0] && fill[1] === bg[1] && fill[2] === bg[2]) add('a glyph has exactly the background colour: that character is invisible');
    } else {
      add(`<${tag}> in the picture layer paints something that is not a glyph (a shape, image or script can cover or fake words)`);
    }
  }
  if (rects === 0) add('the picture layer has no background rectangle');
  if (texts === 0) add('the picture layer has no <text> block');
  return out;
}
