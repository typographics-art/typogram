// The one typeface Typographics Art sets with (operator decision 2026-10-17, measured in docs/file-size.md):
// Roboto Flex — even, very legible, and with weights 100–1000 the widest tonal range of the variable Google
// fonts; weight carries the brightness of the picture. More families gave larger PDFs and no better picture. `variations` pins the optical size so that glyph
// advances scale linearly with font size (measurements are taken at one reference size).

export const FONTS = {
  roboto: {
    label: 'Roboto Flex',
    css: "'Roboto Flex', system-ui, sans-serif",
    canvas: "'Roboto Flex'",
    weights: [100, 1000],
    widths: [75, 100, 125],
    variations: "'opsz' 40",
    googleFamily: 'Roboto+Flex:opsz,wdth,wght@8..144,25..151,100..1000',
  },
};

/** Number of weight steps every font is sampled at. Legibility levels refer to these indices. */
export const WEIGHT_STEPS = 10;

/** The ten concrete weights a font is measured and set at, lightest first. */
export function weightSteps(font) {
  const [lo, hi] = font.weights;
  return Array.from({ length: WEIGHT_STEPS }, (_, i) => Math.round(lo + ((hi - lo) * i) / (WEIGHT_STEPS - 1)));
}

/** CSS keyword per width, for canvas (which takes font-stretch, not variation settings). */
export const STRETCH_KEYWORD = { 75: 'condensed', 100: 'normal', 125: 'expanded' };

/** Index of the font's normal (100 %) width. */
export const normalWidthIndex = (font) => Math.max(0, font.widths.indexOf(100));

/** font-variation-settings for one width of a font. */
export function variationsFor(font, width = 100) {
  const parts = font.variations === 'normal' ? [] : [font.variations];
  if (width !== 100) parts.push(`'wdth' ${width}`);
  return parts.join(', ') || 'normal';
}

export function googleFontsUrl(font) {
  return `https://fonts.googleapis.com/css2?family=${font.googleFamily}&display=swap`;
}
