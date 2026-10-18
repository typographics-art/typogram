// Typographics Art — public API.
// Pure modules work in Node and the browser; browser.js needs a DOM (fonts, canvas).
export {
  FONTS, WEIGHT_STEPS, STRETCH_KEYWORD, weightSteps, normalWidthIndex, variationsFor, fontStylesheetUrl,
} from './fonts.js';
export { LEGIBILITY, PAPERS, DEFAULTS, levelFor } from './options.js';
export { lorem } from './lorem.js';
export { buildToneMap, cropToAspect, levelsOf, stretchLevels, meanLuminance, DARK_KEY, paperFor } from './tone.js';
export { inkFor, rgbCss, mix } from './color.js';
export {
  REF_SIZE, REF_RATIO, normalizeText, graphemes, tokenize, candidates, buildLuts, toneRange,
  layoutAt, fit, justify, toneFidelity, dynamicRange, quantizeLine, REPEAT_GAP,
} from './layout.js';
export { typesetWith, typesetSections, plainText, isFaithful } from './typeset.js';
export {
  toHtml, toStandaloneHtml, toSvg, svgHead, svgLines, SVG_TAIL, forEachGlyph, escapeXml, GLYPH_CSS, pdfStats, estimatePdfBytes,
} from './render.js';
export { hideSecret, revealSecret, canonicalText } from './secret.js';
export { markupText, pdfItemsText, readWorkFile } from './work-text.js';
export { structuredText, sha256Hex } from './structure.js';
// Data in a work: structured data (TGD, docs/structured-data.md), sealing (docs/encrypted-data.md) and the panels' pure logic.
export { encode, decode, decodeAll, findBlocks, stripBlocks, verify, toFile, modelJson, TgdError } from './structured.js';
export { sealData, openSealed, findSealedBlocks, describeRecord, parseRecord, CryptError } from './crypt.js';
export { sealStream, StreamReader, DEFAULT_FRAME } from './stream.js';
export { writeMeta, readMeta, withMeta, embedStream, readEmbeddedStream, TYPOGRAM_NS, TYPOGRAM_STREAM_NS } from './typogram.js';
export * as dataPanel from './data-panel.js';
