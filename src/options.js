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
  stretch: true, // also vary the width axis, where the font has one
  shape: true, // weight each glyph's target by where its ink sits in the cell (sharper edges)
  contrast: 1.4,
  brightness: 0,
  edges: 0.4,
  lineSpacing: 1.09, // line height as a multiple of the base font size
  invert: false,
  aspect: null, // height / width; null keeps the image's own aspect ratio
  width: 960, // text block width in px
  margin: 0.025, // paper margin as a fraction of the width
};
