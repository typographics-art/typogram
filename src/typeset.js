// Environment-independent pipeline: text + glyph metrics + image pixels → set sheet.
import { FONTS, weightSteps, normalWidthIndex } from './fonts.js';
import { LEGIBILITY, PAPERS, DEFAULTS } from './options.js';
import { buildToneMap, cropToAspect } from './tone.js';
import { inkFor, mix, rgbCss } from './color.js';
import {
  REF_RATIO, normalizeText, graphemes, tokenize, candidates, buildLuts, toneRange, fit, layoutAt, toneFidelity, quantizeLine,
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
  const luts = buildLuts(new Set(graphemes(source)), cands, metric, covScale, level.sizes);
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
    colorOf = (it, i) => rgbCss(inkFor(map.rgb(it.x, i * L, it.x + it.adv, (i + 1) * L), it.eff, paper.paper, level.maxInk, darkPaper, o.colorStep));
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

/**
 * Several panels stacked top to bottom, one image per panel ("one picture per book"). The text runs
 * on without a break from panel to panel, and every panel uses the same type size: panel heights
 * start proportional to the text length and are evened out until the panels fill the sheet without gaps.
 *
 * @param {object} p
 * @param {{text:string, image:{width:number,height:number,data:ArrayLike<number>}, title?:string}[]} p.sections
 *        images may have any aspect ratio; each panel takes a centred slice
 * @param {(ch:string)=>object} p.metric
 * @param {object} p.options  as typesetWith; `aspect` (height/width of the whole sheet) is required
 */
export function typesetSections({ sections, metric, options = {} }) {
  const o = { ...DEFAULTS, ...options };
  if (!o.aspect) throw new Error('typesetSections needs options.aspect (height / width of the whole sheet)');
  const texts = sections.map((s) => normalizeText(s.text));
  if (texts.some((t) => !t)) throw new Error('Every section needs text');
  const source = texts.join(' ');
  const font = FONTS[o.font], level = LEGIBILITY[o.legibility], paper = PAPERS[o.paper];
  if (!font || !level || !paper) throw new Error('Unknown font, legibility or paper option');

  const lineRatio = 1 / o.lineSpacing, covScale = lineRatio / REF_RATIO;
  const normalWidth = normalWidthIndex(font);
  const widths = o.stretch ? font.widths.map((w, wd) => ({ wd, st: w / 100 })) : [{ wd: normalWidth, st: 1 }];
  const cands = candidates(level, o.color === 'gray', widths);
  const luts = buildLuts(new Set(graphemes(source)), cands, metric, covScale, level.sizes);
  const range = toneRange(source, cands, metric, covScale); // one tone scale for all panels
  const tone = (d) => range.min + d * (range.max - range.min);
  const W = Math.round(o.width), Htotal = Math.round(W * o.aspect), darkPaper = o.paper === 'dark';
  const words = texts.map(tokenize);
  const panel = (i, h) => {
    const H = Math.max(1, Math.round(h));
    const map = buildToneMap(cropToAspect(sections[i].image, H / W), W, H, {
      brightIsInk: darkPaper !== o.invert, contrast: o.contrast, brightness: o.brightness, edges: o.edges,
    });
    const ctx = {
      W, H, dark: map.dark, tone, cands, luts, metric, covScale, lineRatio, sizeCount: level.sizes.length,
      wordMode: o.unit === 'word', wordAvg: new Map(), normalWidth, shape: o.shape,
    };
    return { map, ctx };
  };

  // Even out panel heights: fit each panel, take the smallest line height, then give each panel
  // exactly the lines it needs and scale back up to the sheet height. Converges in a few rounds.
  let heights = texts.map((t) => (Htotal * t.length) / source.length);
  let L = null, lineCounts = null;
  for (let round = 0; round < 4; round++) {
    const fits = heights.map((h, i) => {
      const { ctx } = panel(i, h);
      return L ? fit(words[i], ctx, L * 0.85, L * 1.15).L : fit(words[i], ctx).L;
    });
    L = quantizeLine(Math.min(...fits));
    lineCounts = heights.map((h, i) => {
      const r = layoutAt(words[i], L, panel(i, h).ctx, true);
      return r.lines.length;
    });
    const total = lineCounts.reduce((a, b) => a + b, 0);
    if (total * L <= Htotal && Htotal - total * L < L * sections.length) break;
    heights = lineCounts.map((n) => (Htotal * n) / total);
  }

  // Final layout: each panel exactly lineCount × L tall, all at the same line height.
  const lines = [], parts = [], panels = [];
  let y = 0;
  sections.forEach((sec, i) => {
    const h = lineCounts[i] * L;
    const { map, ctx } = panel(i, h);
    const r = layoutAt(words[i], L, ctx, true);
    const last = r.lines[r.lines.length - 1];
    // Zero-width space after each panel, so the text read back has a space between panels as the source does.
    if (i < sections.length - 1) last.items.push({ ch: ' ', wi: 4, wd: normalWidth, s: 1, si: -1, g: 0, eff: 0, adv: 0, err: 0, base: 0, x: last.w });
    parts.push({ title: sec.title ?? null, firstLine: lines.length, lineCount: r.lines.length, characters: texts[i].length, y, height: r.lines.length * L });
    panels.push({ map, firstLine: lines.length, y });
    lines.push(...r.lines);
    y += r.lines.length * L;
  });
  const fs = L * lineRatio;
  const result = { ok: true, lines, L, fs, overflow: y > Htotal + 0.5 };

  const panelOf = (i) => { let k = panels.length - 1; while (k > 0 && panels[k].firstLine > i) k--; return panels[k]; };
  let colorOf;
  if (o.color === 'photo') {
    colorOf = (it, i) => {
      const pn = panelOf(i), li = i - pn.firstLine;
      return rgbCss(inkFor(pn.map.rgb(it.x, li * L, it.x + it.adv, (li + 1) * L), it.eff, paper.paper, level.maxInk, darkPaper, o.colorStep));
    };
  } else if (o.color === 'gray') {
    colorOf = (it) => (it.g ? rgbCss(mix(paper.ink, paper.paper, it.g)) : '');
  } else {
    colorOf = () => '';
  }

  const pad = Math.round(W * o.margin);
  return {
    text: source, options: o, result, W, H: y, pad, outW: W + 2 * pad, outH: Math.ceil(y) + 2 * pad,
    font, weights: weightSteps(font), paper, colorOf, toneFidelity: toneFidelity(result), sections: parts,
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
