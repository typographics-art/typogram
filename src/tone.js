// Turns an image into fast area lookups: mean "ink demand" (0..1) and mean colour
// over any rectangle, both via summed-area tables. Pure: works on any ImageData-like
// object { width, height, data: RGBA bytes }, in the browser and in Node.

/**
 * @param {{width:number,height:number,data:ArrayLike<number>}} img  image already cropped to the output aspect
 * @param {number} outW  width of the text block the lookups are queried in (px)
 * @param {number} outH  height of the text block (px)
 * @param {object} o
 * @param {boolean} o.brightIsInk  true on dark paper: bright image areas need more (light) ink
 * @param {number} [o.contrast=1]
 * @param {number} [o.brightness=0]
 * @param {number} [o.edges=0]  unsharp-mask strength
 * @param {boolean} [o.autoLevels=false]  per-image levels: clip `levelsClip` of the pixels at each end and stretch
 *        the rest over 0..1 before contrast and brightness, so every picture uses the whole coverage band the text can reach
 * @param {number} [o.levelsClip=0.01]
 */
export function buildToneMap(img, outW, outH, { brightIsInk = false, contrast = 1, brightness = 0, edges = 0, autoLevels = false, levelsClip = 0.01 } = {}) {
  const MW = img.width, MH = img.height, d = img.data;
  const N = (MW + 1) * (MH + 1);
  const K = new Float32Array(MW * MH);
  for (let p = 0, q = 0; q < K.length; p += 4, q++) {
    const lum = (0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) / 255;
    K[q] = brightIsInk ? lum : 1 - lum;
  }
  const S = new Float64Array(N);
  const sat = (A, T) => {
    for (let y = 0; y < MH; y++) {
      let row = 0;
      for (let x = 0; x < MW; x++) {
        row += A[y * MW + x];
        T[(y + 1) * (MW + 1) + x + 1] = T[y * (MW + 1) + x + 1] + row;
      }
    }
  };
  const box = (T, x0, y0, x1, y1) =>
    T[y1 * (MW + 1) + x1] - T[y0 * (MW + 1) + x1] - T[y1 * (MW + 1) + x0] + T[y0 * (MW + 1) + x0];

  sat(K, S);
  if (edges > 0) {
    // Unsharp mask: push each pixel away from its neighbourhood mean.
    const r = Math.max(2, Math.round(MW / 110));
    const K2 = new Float32Array(K.length);
    for (let y = 0; y < MH; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(MH, y + r + 1);
      for (let x = 0; x < MW; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(MW, x + r + 1);
        const m = box(S, x0, y0, x1, y1) / ((x1 - x0) * (y1 - y0));
        K2[y * MW + x] = K[y * MW + x] + edges * (K[y * MW + x] - m);
      }
    }
    K.set(K2);
  }
  if (autoLevels) {
    // Text can ink at most about a third of a cell, so the reachable tones are few; a picture that uses only
    // part of them dissolves into grey (measured: a dark portrait sat in 0.15..0.43 of the coverage scale).
    // Stretching each image's own range over 0..1 gives it every tone there is; contrast and brightness
    // then work on the stretched picture.
    const [lo, hi] = levelsOf(K, levelsClip);
    if (hi - lo > 0.02) { const s = 1 / (hi - lo); for (let q = 0; q < K.length; q++) K[q] = (K[q] - lo) * s; }
  }
  for (let q = 0; q < K.length; q++) {
    const k = (K[q] - 0.5) * contrast + 0.5 + brightness;
    K[q] = k < 0 ? 0 : k > 1 ? 1 : k;
  }
  S.fill(0);
  sat(K, S);

  const SR = new Float64Array(N), SG = new Float64Array(N), SB = new Float64Array(N);
  for (let y = 0; y < MH; y++) {
    let r = 0, g = 0, b = 0;
    for (let x = 0; x < MW; x++) {
      const p = (y * MW + x) * 4, q = (y + 1) * (MW + 1) + x + 1, u = y * (MW + 1) + x + 1;
      r += d[p]; SR[q] = SR[u] + r;
      g += d[p + 1]; SG[q] = SG[u] + g;
      b += d[p + 2]; SB[q] = SB[u] + b;
    }
  }

  const sx = MW / outW, sy = MH / outH;
  const rect = (x0, y0, x1, y1) => {
    let X0 = Math.floor(x0 * sx), X1 = Math.ceil(x1 * sx), Y0 = Math.floor(y0 * sy), Y1 = Math.ceil(y1 * sy);
    X0 = Math.max(0, Math.min(MW - 1, X0)); Y0 = Math.max(0, Math.min(MH - 1, Y0));
    X1 = Math.max(X0 + 1, Math.min(MW, X1)); Y1 = Math.max(Y0 + 1, Math.min(MH, Y1));
    return [X0, Y0, X1, Y1];
  };
  return {
    /** Mean ink demand 0..1 over a rectangle in output px. */
    dark(x0, y0, x1, y1) {
      const [a, b, e, f] = rect(x0, y0, x1, y1);
      return box(S, a, b, e, f) / ((e - a) * (f - b));
    },
    /** Mean RGB (0..255) of the unadjusted image over a rectangle in output px. */
    rgb(x0, y0, x1, y1) {
      const [a, b, e, f] = rect(x0, y0, x1, y1), n = (e - a) * (f - b);
      return [box(SR, a, b, e, f) / n, box(SG, a, b, e, f) / n, box(SB, a, b, e, f) / n];
    },
  };
}

/**
 * Centre-crops pixels to height/width = aspect (pure, returns a copy). Lets panels of any size
 * take their slice of an image without the browser re-reading it.
 */
export function cropToAspect(img, aspect) {
  const { width: W, height: H, data } = img;
  let w = W, h = Math.round(W * aspect);
  if (h > H) { h = H; w = Math.max(1, Math.round(H / aspect)); }
  h = Math.max(1, h);
  const x0 = Math.floor((W - w) / 2), y0 = Math.floor((H - h) / 2);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) out.set(data.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0 + w) * 4), y * w * 4);
  return { width: w, height: h, data: out };
}

/**
 * Percentile bounds of values in 0..1: [lo, hi] such that a share `clip` of the values lies below lo and
 * another above hi (clip 0: the exact minimum and maximum). One pass over a 1024-bin histogram, no sorting.
 */
export function levelsOf(values, clip = 0.01) {
  const BINS = 1024, h = new Uint32Array(BINS);
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v !== v) continue; // NaN
    h[v <= 0 ? 0 : v >= 1 ? BINS - 1 : (v * BINS) | 0]++; n++;
  }
  if (!n) return [0, 1];
  const cut = n * clip;
  let acc = 0, lo = 0, hi = 1;
  for (let b = 0; b < BINS; b++) { acc += h[b]; if (acc > cut) { lo = b / BINS; break; } }
  acc = 0;
  for (let b = BINS - 1; b >= 0; b--) { acc += h[b]; if (acc > cut) { hi = (b + 1) / BINS; break; } }
  return [lo, Math.max(hi, lo + 1 / BINS)];
}

/**
 * Auto-levels on pixels (pure, returns a copy): the luminance range between the `clip` percentiles is
 * stretched to 0..255 with the same linear map on every channel, as a Levels tool does. For a motif that
 * is composited into a title card before buildToneMap sees it (one-pagers): the card's own black title and
 * white band would make the tone map's `autoLevels` a no-op, so the motif is stretched on its own first.
 */
export function stretchLevels(img, clip = 0.01) {
  const { width, height, data } = img, n = width * height, L = new Float32Array(n);
  for (let p = 0, q = 0; q < n; p += 4, q++) L[q] = (0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]) / 255;
  const [lo, hi] = levelsOf(L, clip), out = new Uint8ClampedArray(data.length);
  if (!(hi - lo > 0.02)) { out.set(data); return { width, height, data: out }; }
  const s = 1 / (hi - lo), off = lo * 255; // data is in 0..255 units already, lo and hi in 0..1
  for (let p = 0; p < data.length; p += 4) {
    out[p] = (data[p] - off) * s; out[p + 1] = (data[p + 1] - off) * s; out[p + 2] = (data[p + 2] - off) * s; out[p + 3] = data[p + 3];
  }
  return { width, height, data: out };
}

/** Mean Rec. 709 luminance (0..1) of an image's pixels. */
export function meanLuminance(img) {
  const d = img.data, n = img.width * img.height;
  let s = 0;
  for (let p = 0; p < n * 4; p += 4) s += 0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2];
  return n ? s / 255 / n : 0;
}

/**
 * Mean luminance below which a picture is dark-key and is set on dark paper. Text can ink at most about a
 * third of a cell, so on light paper the darkest tone is a medium grey and a dark picture dissolves (measured on
 * a portrait of mean luminance 0.33: dynamic range 0.18 on light paper, 0.55 on dark, where the dark ground is
 * uninked paper). Measured on the gallery photos: portraits on dark grounds are 0.16..0.35, lit scenes 0.44..0.75.
 */
export const DARK_KEY = 0.4;

/** The paper for a picture of mean luminance `lum`: 'dark' below DARK_KEY, otherwise 'light'. */
export const paperFor = (lum) => (lum < DARK_KEY ? 'dark' : 'light');
