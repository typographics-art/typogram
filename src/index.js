// Typographic Art — public API.
// Pure modules work in Node and the browser; browser.js needs a DOM (fonts, canvas).
export {
  FONTS, WEIGHT_STEPS, STRETCH_KEYWORD, weightSteps, normalWidthIndex, variationsFor, googleFontsUrl,
} from './fonts.js';
export { LEGIBILITY, PAPERS, DEFAULTS } from './options.js';
export { lorem } from './lorem.js';
export { buildToneMap } from './tone.js';
export { inkFor, rgbCss, mix } from './color.js';
export {
  REF_SIZE, REF_RATIO, normalizeText, tokenize, candidates, buildLuts, toneRange,
  layoutAt, fit, justify, toneFidelity,
} from './layout.js';
export { typesetWith, plainText, isFaithful } from './typeset.js';
export { toHtml, toStandaloneHtml, toSvg, forEachGlyph, escapeXml, GLYPH_CSS } from './render.js';
