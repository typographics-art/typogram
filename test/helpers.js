// Synthetic glyph metrics and images so the pipeline can be tested without a browser.

const WIDTHS = [0.75, 1, 1.25]; // matches Roboto Flex's width variants in src/fonts.js

/**
 * Every glyph 0.55 em wide (+3 % per weight step, scaled by width); coverage grows with weight
 * and with the glyph's "ink class". Condensed variants are slightly darker, expanded lighter.
 */
export function fakeMetric(ch) {
  const ink = ch === ' ' ? 0 : /[ilj.,;:'!|]/.test(ch) ? 0.5 : /[mwMW@#]/.test(ch) ? 1.6 : 1;
  const adv = new Float32Array(30), cov = new Float32Array(30);
  WIDTHS.forEach((wf, wd) => {
    for (let w = 0; w < 10; w++) {
      adv[wd * 10 + w] = 40 * (ch === ' ' ? 0.25 : 0.55 * (1 + 0.03 * w)) * wf;
      cov[wd * 10 + w] = ink * (0.04 + 0.04 * w) * (1 + (1 - wf) * 0.4);
    }
  });
  return { adv, cov, prof: new Float32Array([0.5, 0.5, 0.5, 0.5]) };
}

/** RGBA image filled by fn(x, y) → [r, g, b]. */
export function image(width, height, fn) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [r, g, b] = fn(x, y), p = (y * width + x) * 4;
    data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = 255;
  }
  return { width, height, data };
}

export const TEXT = 'Shall I compare thee to a summer\'s day? Thou art more lovely and more temperate: ' +
  'Rough winds do shake the darling buds of May, And summer\'s lease hath all too short a date.';
