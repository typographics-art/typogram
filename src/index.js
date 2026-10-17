// Typographics Art — public API.
// Pure modules work in Node and the browser; browser.js needs a DOM (fonts, canvas).
export {
  FONTS, WEIGHT_STEPS, STRETCH_KEYWORD, weightSteps, normalWidthIndex, variationsFor, fontStylesheetUrl,
} from './fonts.js';
export { LEGIBILITY, PAPERS, DEFAULTS, levelFor } from './options.js';
export { lorem } from './lorem.js';
export { buildToneMap, cropToAspect } from './tone.js';
export { inkFor, rgbCss, mix } from './color.js';
export {
  REF_SIZE, REF_RATIO, normalizeText, graphemes, tokenize, candidates, buildLuts, toneRange,
  layoutAt, fit, justify, toneFidelity, quantizeLine, REPEAT_GAP,
} from './layout.js';
export { typesetWith, typesetSections, plainText, isFaithful } from './typeset.js';
export {
  toHtml, toStandaloneHtml, toSvg, svgHead, svgLines, SVG_TAIL, forEachGlyph, escapeXml, GLYPH_CSS, pdfStats, estimatePdfBytes,
} from './render.js';
export { hideSecret, revealSecret, canonicalText } from './secret.js';
export { markupText, pdfItemsText, readWorkFile } from './work-text.js';
export { structuredText, sha256Hex } from './structure.js';
