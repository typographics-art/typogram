// Browser layer: measures glyphs with the real font, reads image pixels, renders PNG.
import { FONTS, WEIGHT_STEPS, STRETCH_KEYWORD, weightSteps, variationsFor, normalWidthIndex, googleFontsUrl } from './fonts.js';
import { REF_SIZE, REF_RATIO, normalizeText, graphemes } from './layout.js';
import { typesetWith } from './typeset.js';
import { forEachGlyph, GLYPH_CSS } from './render.js';
import { rgbCss } from './color.js';

/** Resolution of the tone map. Keeps memory small even for 2400 px wide sheets. */
export const TONE_MAP_WIDTH = 720;

const metricCache = new Map();
let measureCanvas = null;

/**
 * Measures every character in `chars` for a font, at every width × weight variant:
 * advance via the DOM (exactly what the browser will lay out), ink coverage via canvas, and the
 * ink profile (share of ink in the left/right/top/bottom half of the cell). Cached per font and character.
 */
export function measureGlyphs(fontKey, chars) {
  const font = FONTS[fontKey], weights = weightSteps(font), NV = font.widths.length * WEIGHT_STEPS;
  const todo = [...chars].filter((c) => !metricCache.has(fontKey + '|' + c));
  if (todo.length) {
    const box = document.createElement('div');
    box.style.cssText = `position:absolute;left:-30000px;top:0;visibility:hidden;white-space:pre;` +
      `font-family:${font.css};font-size:${REF_SIZE}px;${GLYPH_CSS}`;
    const spans = [];
    for (const c of todo) for (const w of font.widths) for (const wt of weights) {
      const s = document.createElement('span');
      s.style.fontWeight = wt; s.style.fontStretch = `${w}%`; s.style.fontVariationSettings = variationsFor(font, w); s.textContent = c;
      box.appendChild(s); spans.push(s);
    }
    document.body.appendChild(box);
    const widths = spans.map((s) => s.getBoundingClientRect().width);
    box.remove();

    const cellH = REF_SIZE / REF_RATIO, top = 4;
    if (!measureCanvas) { measureCanvas = document.createElement('canvas'); measureCanvas.width = REF_SIZE * 5; measureCanvas.height = Math.ceil(cellH) + 8; }
    const mx = measureCanvas.getContext('2d', { willReadFrequently: true });
    const nw = normalWidthIndex(font);
    let i = 0;
    for (const c of todo) {
      const adv = new Float32Array(NV), cov = new Float32Array(NV), prof = new Float32Array([0.5, 0.5, 0.5, 0.5]);
      for (let wd = 0; wd < font.widths.length; wd++) for (let wi = 0; wi < WEIGHT_STEPS; wi++) {
        const v = wd * WEIGHT_STEPS + wi, a = widths[i++];
        adv[v] = a;
        if (c === ' ' || a < 0.5) { cov[v] = 0; continue; }
        mx.clearRect(0, 0, measureCanvas.width, measureCanvas.height);
        mx.font = `${weights[wi]} ${STRETCH_KEYWORD[font.widths[wd]] || 'normal'} ${REF_SIZE}px ${font.canvas}`;
        mx.textBaseline = 'alphabetic'; mx.fillStyle = '#000';
        mx.fillText(c, 8, top + cellH * 0.78);
        const cw = Math.min(measureCanvas.width, Math.ceil(a) + 16), ch = measureCanvas.height;
        const d = mx.getImageData(0, 0, cw, ch).data;
        let sum = 0, left = 0, upper = 0;
        const xm = 8 + a / 2, ym = top + cellH / 2;
        for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
          const al = d[(y * cw + x) * 4 + 3];
          if (!al) continue;
          sum += al; if (x < xm) left += al; if (y < ym) upper += al;
        }
        cov[v] = Math.min(1, sum / 255 / (a * cellH));
        if (wd === nw && wi === 4 && sum > 0) prof.set([left / sum, 1 - left / sum, upper / sum, 1 - upper / sum]);
      }
      metricCache.set(fontKey + '|' + c, { adv, cov, prof });
    }
  }
  return (ch) => metricCache.get(fontKey + '|' + ch);
}

/**
 * Makes sure the font is really available before measuring: adds its Google Fonts stylesheet
 * unless the page already links one for this family, then loads the face. Without this,
 * document.fonts.load() resolves silently and every metric comes from a fallback font.
 */
export async function ensureFont(font) {
  const family = font.googleFamily.split(':')[0];
  const linked = [...document.querySelectorAll('link[rel="stylesheet"]')].find((l) => l.href.includes(`family=${family}:`));
  if (!linked) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = googleFontsUrl(font);
    await new Promise((resolve, reject) => {
      link.onload = resolve;
      link.onerror = () => reject(new Error(`Could not load the font stylesheet for ${font.label}`));
      document.head.appendChild(link);
    });
  } else if (!linked.sheet) {
    await new Promise((resolve) => linked.addEventListener('load', resolve, { once: true }));
  }
  const faces = await document.fonts.load(`400 ${REF_SIZE}px ${font.canvas}`, 'Aa');
  if (!faces.length) throw new Error(`Font ${font.label} is not available`);
}

/** Center-crops an image to height/width = aspect and returns its pixels plus the canvas. */
export function readImage(img, aspect, maxWidth = TONE_MAP_WIDTH) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, r0 = ih / iw;
  const ratio = aspect ?? r0;
  let sx = 0, sy = 0, sw = iw, sh = ih;
  if (ratio > r0) { sw = ih / ratio; sx = (iw - sw) / 2; } else if (ratio < r0) { sh = iw * ratio; sy = (ih - sh) / 2; }
  const MW = Math.min(maxWidth, Math.round(sw)) || 1, MH = Math.max(1, Math.round(MW * ratio));
  const c = document.createElement('canvas'); c.width = MW; c.height = MH;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.fillRect(0, 0, MW, MH);
  g.drawImage(img, sx, sy, sw, sh, 0, 0, MW, MH);
  return { imageData: g.getImageData(0, 0, MW, MH), canvas: c, aspect: ratio };
}

/**
 * One call from text and image to a set sheet.
 * @param {string} text
 * @param {HTMLImageElement|HTMLCanvasElement|ImageBitmap} img
 * @param {object} [options]  see DEFAULTS in options.js
 */
export async function typeset(text, img, options = {}) {
  const fontKey = options.font || 'roboto', font = FONTS[fontKey];
  await ensureFont(font);
  const source = normalizeText(text);
  const metric = measureGlyphs(fontKey, new Set(graphemes(source)));
  const { imageData, canvas, aspect } = readImage(img, options.aspect ?? null);
  const sheet = typesetWith({ text: source, metric, image: imageData, options: { ...options, aspect } });
  sheet.imageCanvas = canvas;
  return sheet;
}

/** Renders the sheet to a PNG (or JPEG) data URL. An image only: the text is no longer extractable. */
export function toPng(sheet, scale = 1, type = 'image/png', quality = 0.88) {
  const { outW, outH, font, paper, colorOf, weights, result } = sheet, fs = result.fs;
  const c = document.createElement('canvas');
  c.width = Math.round(outW * scale); c.height = Math.round(outH * scale);
  const g = c.getContext('2d');
  g.scale(scale, scale);
  g.fillStyle = rgbCss(paper.paper); g.fillRect(0, 0, outW, outH);
  g.textBaseline = 'alphabetic';
  let last = '';
  forEachGlyph(sheet, (it, x, y, i) => {
    if (it.ch === ' ') return;
    const f = `${weights[it.wi]} ${STRETCH_KEYWORD[font.widths[it.wd]] || 'normal'} ${(fs * it.s).toFixed(2)}px ${font.canvas}`;
    if (f !== last) { g.font = f; last = f; }
    g.fillStyle = colorOf(it, i) || rgbCss(paper.ink);
    g.fillText(it.ch, x, y);
  });
  return c.toDataURL(type, quality);
}
