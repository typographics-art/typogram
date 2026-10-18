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
 */
export function buildToneMap(img, outW, outH, { brightIsInk = false, contrast = 1, brightness = 0, edges = 0 } = {}) {
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
