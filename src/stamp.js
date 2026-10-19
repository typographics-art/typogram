// A visible "signed" seal drawn INTO a signed Typogram's image: a green corner with a white check, top-right, so the work
// is recognizable as signed at a glance — opened in a viewer or seen as a file thumbnail/icon, not only on the website.
//
// It is a decorative overlay — a polygon and a stroked path, NOT text — so it does not change the canonical text or the
// identity hash: a stamped work still passes `tg verify`. Idempotent: re-stamping replaces any existing seal. The same
// geometry (a corner 14% of the shorter side) is used for the raster previews (scripts/stamp-raster.mjs) so the file
// icon matches the work.
export const SEAL_ID = 'tgart-signed-seal';
export const SEAL_GREEN = '#1f8a4c';
export const SEAL_FRACTION = 0.14; // corner size as a fraction of the shorter side

/** Geometry of the corner for a W×H canvas: the triangle points and the check-mark path, in that coordinate space. */
export function sealGeometry(W, H) {
  const S = Math.round(Math.min(W, H) * SEAL_FRACTION);
  const x0 = +(W - S).toFixed(2);
  // Check mark centred near the triangle's centroid (right-angle corner side), not its hypotenuse: the earlier placement
  // pushed the short arm + its stroke past the diagonal edge onto the background. Up (cy) and smaller (u) keep the whole
  // stroked mark clear of the hypotenuse with margin.
  const cx = W - S * 0.38, cy = S * 0.33, u = S * 0.115;
  const check = `M ${(cx - 1.5 * u).toFixed(1)} ${(cy - 0.1 * u).toFixed(1)} L ${(cx - 0.4 * u).toFixed(1)} ${(cy + 1.0 * u).toFixed(1)} L ${(cx + 1.6 * u).toFixed(1)} ${(cy - 1.2 * u).toFixed(1)}`;
  return { S, x0, W, H, triangle: `${x0},0 ${W},0 ${W},${S}`, check, stroke: Math.max(2, Math.round(S * 0.085)) };
}

/** Add (or replace) the signed seal in an SVG string. Returns the SVG unchanged if it has no size to work from. */
export function stampSvg(svg) {
  svg = svg.replace(new RegExp(`<g id="${SEAL_ID}"[\\s\\S]*?</g>`), '');
  const vb = /viewBox="\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)\s*"/.exec(svg);
  let W, H;
  if (vb) { W = parseFloat(vb[3]); H = parseFloat(vb[4]); }
  else {
    const w = /\bwidth="([\d.]+)/.exec(svg), h = /\bheight="([\d.]+)/.exec(svg);
    if (!w || !h) return svg;
    W = parseFloat(w[1]); H = parseFloat(h[1]);
  }
  if (!(W > 0 && H > 0)) return svg;
  const g = sealGeometry(W, H);
  const seal = `<g id="${SEAL_ID}" aria-label="signed Typogram">`
    + `<path d="M ${g.triangle.split(' ').map((p) => p.replace(',', ' ')).join(' L ')} Z" fill="${SEAL_GREEN}"/>`
    + `<path d="${g.check}" fill="none" stroke="#fff" stroke-width="${g.stroke}" stroke-linecap="round" stroke-linejoin="round"/></g>`;
  const i = svg.lastIndexOf('</svg>');
  return i < 0 ? svg : svg.slice(0, i) + seal + svg.slice(i);
}

/** True if the SVG already carries the seal. */
export const isStamped = (svg) => svg.includes(`id="${SEAL_ID}"`);
