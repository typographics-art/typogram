// Option vocabulary shared by the library and the web app.

/**
 * Legibility levels limit how far a glyph may drift from plain text.
 * weights: allowed weight-step indices (0..9), sizes: allowed size factors relative to the
 * line's base size, grays: allowed lightening towards the paper (gray mode only),
 * maxInk: in photo-color mode, how close an ink color may get to the paper (0..1).
 */
export const LEGIBILITY = {
  high: { weights: [3, 4, 5, 6, 7, 8], sizes: [1, 0.92, 0.85], grays: [0, 0.15, 0.3], maxInk: 0.55 },
  medium: { weights: [1, 2, 3, 4, 5, 6, 7, 8, 9], sizes: [1, 0.9, 0.8, 0.7, 0.6], grays: [0, 0.2, 0.4, 0.55], maxInk: 0.72 },
  free: { weights: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], sizes: [1, 0.85, 0.7, 0.58, 0.48], grays: [0, 0.25, 0.5, 0.7], maxInk: 0.9 },
};

export const PAPERS = {
  light: { paper: [251, 251, 248], ink: [17, 17, 17] },
  dark: { paper: [17, 18, 22], ink: [240, 238, 232] },
};

export const DEFAULTS = {
  font: 'roboto',
  legibility: 'medium', // high | medium | free
  color: 'photo', // photo | gray | mono
  paper: 'light', // light | dark
  unit: 'char', // char | word
  stretch: false, // also vary the width axis (off: measured no visible gain, +12 % file size)
  shape: true, // weight each glyph's target by where its ink sits in the cell (sharper edges)
  contrast: 1.4,
  brightness: 0,
  edges: 0.4,
  lineSpacing: 1.09, // line height as a multiple of the base font size
  invert: false,
  aspect: null, // height / width; null keeps the image's own aspect ratio
  width: 960, // text block width in px
  margin: 0.025, // paper margin as a fraction of the width
  colorStep: 6, // photo colours are quantised to multiples of this (coarser = smaller files)
  weightCount: null, // at most this many weight steps (null: all the legibility level allows); fewer = fewer fonts in the PDF
  gaps: 'off', // off | auto | on: short texts only where the picture is dark, blank elsewhere (whitespace is layout, not text)
  sizeCount: 1, // type sizes per line; one size gives the sharpest picture (measured), null: all the level allows
};

/** At most n entries of a list, spread evenly over it; a single entry is its middle one. */
const spread = (list, n) => (!n || n >= list.length ? list : n === 1 ? [list[Math.floor(list.length / 2)]]
  : Array.from({ length: n }, (_, i) => list[Math.round((i * (list.length - 1)) / (n - 1))]));

/**
 * The legibility level limited to `weightCount` weights and `sizeCount` sizes, spread evenly over its
 * range. Every weight × width is a separate font in a PDF, and every change of font, size or colour
 * starts a new text run, so both bound the file size.
 */
export function levelFor(o) {
  const level = LEGIBILITY[o.legibility];
  if (!level) return level;
  const sizes = o.sizeCount ? [1, ...spread(level.sizes.slice(1), o.sizeCount - 1)].slice(0, Math.max(1, o.sizeCount)) : level.sizes;
  return { ...level, weights: spread(level.weights, o.weightCount), sizes };
}
