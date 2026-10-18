export const rgbCss = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
export const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const luminance = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

/**
 * Ink colour for one glyph so that ink plus the visible paper average to the photo colour:
 * coverage·ink + (1 − coverage)·paper = target  ⇒  ink = paper + (target − paper) / coverage.
 * When that leaves the RGB cube, the distance to the paper is shortened as a whole instead of
 * clipping each channel, so the hue survives. `maxInk` keeps the ink visibly apart from the paper.
 *
 * @param {number[]} target  photo colour of the glyph's cell, 0..255
 * @param {number} coverage  ink coverage of the glyph in its cell, 0..1
 * @param {number[]} paper
 * @param {number} maxInk   0..1; lower = more contrast to the paper
 * @param {boolean} darkPaper
 * @param {number} [step=6]  colour quantisation: coarser steps let neighbouring glyphs share a run, which keeps
 *        HTML and PDF output small (one-pagers use 24: at sub-millimetre type the difference is invisible)
 * @returns {number[]} RGB, quantised to multiples of `step`
 */
export function inkFor(target, coverage, paper, maxInk, darkPaper, step = 6) {
  const e = Math.max(coverage, 0.05);
  const D = target.map((c, q) => (c - paper[q]) / e);
  let f = 1;
  D.forEach((v, q) => {
    const lim = v > 0 ? 255 - paper[q] : -paper[q];
    if (Math.abs(v) > 1e-6 && v / lim > 0) f = Math.min(f, lim / v);
  });
  let I = D.map((v, q) => paper[q] + v * f);
  const lum = luminance(I);
  if (!darkPaper && lum > maxInk) { const k = maxInk / lum; I = I.map((v) => v * k); }
  if (darkPaper && lum < 1 - maxInk) { const k = maxInk / (1 - lum); I = I.map((v) => 255 - (255 - v) * k); }
  return I.map((v) => Math.max(0, Math.min(255, Math.round(v / step) * step)));
}
