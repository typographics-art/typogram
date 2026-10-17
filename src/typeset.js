// Environment-independent pipeline: text + glyph metrics + image pixels → set sheet.
import { FONTS, weightSteps, normalWidthIndex } from './fonts.js';
import { LEGIBILITY, PAPERS, DEFAULTS } from './options.js';
import { buildToneMap } from './tone.js';
import { inkFor, mix, rgbCss } from './color.js';
import {
  REF_RATIO, normalizeText, tokenize, candidates, buildLuts, toneRange, fit, toneFidelity,
} from './layout.js';

/**
 * @param {object} p
 * @param {string} p.text
 * @param {(ch:string)=>{adv:Float32Array,cov:Float32Array}} p.metric  glyph metrics for p.options.font
 * @param {{width:number,height:number,data:ArrayLike<number>}} p.image  pixels, already cropped to the output aspect
 * @param {object} [p.options]  see DEFAULTS in options.js
 */
export function typesetWith({ text, metric, image, options = {} }) {
  const o = { ...DEFAULTS, ...options };
  const source = normalizeText(text);
  if (!source) throw new Error('Text is empty');
  const font = FONTS[o.font];
  const level = LEGIBILITY[o.legibility];
  const paper = PAPERS[o.paper];
  if (!font || !level || !paper) throw new Error('Unknown font, legibility or paper option');

  const lineRatio = 1 / o.lineSpacing;
  const covScale = lineRatio / REF_RATIO;
  const normalWidth = normalWidthIndex(font);
  const widths = o.stretch
    ? font.widths.map((w, wd) => ({ wd, st: w / 100 }))
    : [{ wd: normalWidth, st: 1 }];
  const cands = candidates(level, o.color === 'gray', widths);
  const luts = buildLuts(new Set(source), cands, metric, covScale, level.sizes);
  const range = toneRange(source, cands, metric, covScale);
  const tone = (d) => range.min + d * (range.max - range.min);

  const W = Math.round(o.width);
  const H = Math.round(W * (o.aspect ?? image.height / image.width));
  const darkPaper = o.paper === 'dark';
  const map = buildToneMap(image, W, H, {
    brightIsInk: darkPaper !== o.invert, contrast: o.contrast, brightness: o.brightness, edges: o.edges,
  });
  const ctx = {
    W, H, dark: map.dark, tone, cands, luts, metric, covScale, lineRatio,
    sizeCount: level.sizes.length, wordMode: o.unit === 'word', wordAvg: new Map(),
    normalWidth, shape: o.shape,
  };
  const result = fit(tokenize(source), ctx);

  let colorOf;
  if (o.color === 'photo') {
    const L = result.L;
    colorOf = (it, i) => rgbCss(inkFor(map.rgb(it.x, i * L, it.x + it.adv, (i + 1) * L), it.eff, paper.paper, level.maxInk, darkPaper));
  } else if (o.color === 'gray') {
    colorOf = (it) => (it.g ? rgbCss(mix(paper.ink, paper.paper, it.g)) : '');
  } else {
    colorOf = () => '';
  }

  const sheetH = Math.max(H, result.lines.length * result.L);
  const pad = Math.round(W * o.margin);
  return {
    text: source, options: o, result, W, H, pad,
    outW: W + 2 * pad, outH: Math.ceil(sheetH) + 2 * pad,
    font, weights: weightSteps(font), paper, colorOf,
    toneFidelity: toneFidelity(result),
  };
}

/** The text exactly as it was set, read back from the layout. */
export function plainText(sheet) {
  return sheet.result.lines.map((ln) => ln.items.map((it) => it.ch).join('')).join('');
}

/** True when the set text equals the source text (whitespace normalised). */
export function isFaithful(sheet, extracted = plainText(sheet)) {
  return normalizeText(extracted) === sheet.text;
}
