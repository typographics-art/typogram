// The core of Typographics Art: set a fixed text, glyph by glyph and in order, choosing only
// typographic properties so the page's ink density follows a tone map. Pure and synchronous.
//
// Glyph metrics come from a `metric(ch)` function returning
//   { adv: Float32Array, cov: Float32Array, prof?: Float32Array(4) }
// adv/cov hold one entry per font variant, index v = widthIndex * WEIGHT_STEPS + weightIndex:
// advance width at REF_SIZE px, and ink coverage of the glyph's cell (advance × REF_SIZE/REF_RATIO).
// prof = [left, right, top, bottom]: share of the glyph's ink in each half of its cell.
// See browser.js for how the browser measures them.
import { WEIGHT_STEPS } from './fonts.js';

export const REF_SIZE = 40;
export const REF_RATIO = 0.92;
export const LUT_BINS = 180;
export const LUT_MAX = 0.8;
const LUT_SCALE = (LUT_BINS - 1) / LUT_MAX;
/** Cost of a size jump between neighbouring glyphs; without it small glyphs read like stray capitals. */
export const SIZE_JUMP = 0.004;
/** Cost of leaving the normal width, so width only changes where it buys tone. */
export const STRETCH_COST = 0.0012;
const MID_WEIGHT = 4;

export const normalizeText = (t) => t.replace(/\s+/g, ' ').trim();

// A glyph is a grapheme cluster, not a code point: a letter with its combining accents, an emoji
// sequence or a syllable in scripts like Devanagari must get one style and stay one unit, or the
// marks end up in separate runs that renderers and PDF text layers drop.
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('und', { granularity: 'grapheme' }) : null;
/** The text split into grapheme clusters (falls back to code points where Intl.Segmenter is missing). */
export const graphemes = (t) => (segmenter ? Array.from(segmenter.segment(t), (x) => x.segment) : Array.from(t));
/** Words and single spaces, in order. Joining the tokens gives back the normalised text. */
export const tokenize = (text) => normalizeText(text).split(/( )/).filter(Boolean);

export const effOf = (m, c, covScale) => m.cov[c.v] * covScale * c.s * (1 - c.g);
const costOf = (eff, t, c) =>
  (eff - t) ** 2 + 0.00035 * (1 - c.s) + 0.0002 * c.g + STRETCH_COST * Math.abs(c.st - 1);

/**
 * All (width, weight, size, gray) combinations allowed.
 * @param {object} level  legibility level (weights, sizes, grays)
 * @param {boolean} useGray
 * @param {{wd:number, st:number}[]} [widths]  allowed width variants: index into the font's widths, stretch factor
 */
export function candidates(level, useGray, widths = [{ wd: 0, st: 1 }]) {
  const out = [];
  for (const { wd, st } of widths) {
    for (const wi of level.weights) {
      level.sizes.forEach((s, si) => {
        for (const g of useGray ? level.grays : [0]) out.push({ wi, wd, v: wd * WEIGHT_STEPS + wi, st, s, si, g });
      });
    }
  }
  return out;
}

/**
 * Per character: lookup table (target tone bin × previous size index) → best candidate index.
 * Turns the per-glyph choice into one array read.
 */
export function buildLuts(chars, cands, metric, covScale, sizes) {
  const luts = new Map(), NS = sizes.length;
  for (const ch of chars) {
    if (ch === ' ') continue;
    const m = metric(ch), lut = new Int16Array(LUT_BINS * NS), effs = cands.map((c) => effOf(m, c, covScale));
    for (let b = 0; b < LUT_BINS; b++) {
      const t = b / LUT_SCALE;
      for (let p = 0; p < NS; p++) {
        let bc = Infinity, bi = 0;
        for (let i = 0; i < cands.length; i++) {
          const c = cands[i], cost = costOf(effs[i], t, c) + SIZE_JUMP * Math.abs(c.s - sizes[p]);
          if (cost < bc) { bc = cost; bi = i; }
        }
        lut[b * NS + p] = bi;
      }
    }
    luts.set(ch, lut);
  }
  return luts;
}

/** Average lightest and darkest coverage this text can reach; maps tone 0..1 onto it. */
export function toneRange(text, cands, metric, covScale) {
  let lo = 0, hi = 0, n = 0;
  for (const ch of graphemes(text)) {
    if (ch === ' ') continue;
    const m = metric(ch);
    let a = 1, b = 0;
    for (const c of cands) { const e = effOf(m, c, covScale); if (e < a) a = e; if (e > b) b = e; }
    lo += a; hi += b; n++;
  }
  return n ? { min: lo / n, max: (hi / n) * 0.95 } : { min: 0, max: 0.3 };
}

/**
 * Sets all words at line height L. Returns { ok:false } if they do not fit into H.
 * ctx: { W, H, dark, tone, cands, luts, metric, covScale, lineRatio, sizeCount, wordMode, wordAvg,
 *        normalWidth (width index of the font's normal width), shape (boolean) }
 */
export function layoutAt(words, L, ctx, unbounded = false) {
  const {
    W, H, dark, tone, cands, luts, metric, covScale, lineRatio, sizeCount: NS, wordMode, wordAvg,
    normalWidth = 0, shape = false,
  } = ctx;
  const fs = L * lineRatio, k = fs / REF_SIZE, maxLines = unbounded ? Infinity : Math.floor(H / L);
  if (maxLines < 1) return { ok: false };
  const mid = normalWidth * WEIGHT_STEPS + MID_WEIGHT;
  const space = { wi: MID_WEIGHT, wd: normalWidth, v: mid, st: 1, s: 1, si: -1, g: 0 };
  const next = new Float32Array(W), below = new Float64Array(W + 1);
  const lines = [];
  let line = null, x = 0, carry = 0, lastSi = 0, lastS = 1;
  const cl = (v) => (v < 0 ? 0 : v > W ? W : v);
  const clampErr = (e) => (e > 0.2 ? 0.2 : e < -0.2 ? -0.2 : e);

  function newLine() {
    if (line) { // error left by the finished line feeds the next one (prefix sums for fast spans)
      below[0] = 0;
      for (let i = 0; i < W; i++) below[i + 1] = below[i] + next[i];
      next.fill(0);
    }
    if (lines.length >= maxLines) return false;
    line = { items: [], w: 0 };
    lines.push(line); x = 0; carry = 0;
    return true;
  }
  // Mapped tone of the area a glyph will cover. With shape on, the four halves of the cell are
  // weighted by where the glyph actually has its ink, so a glyph on an edge takes the tone of its ink.
  function region(cx, ew, prof) {
    const li = lines.length - 1, y0 = li * L, y1 = Math.min(H, (li + 1) * L);
    const x0 = Math.floor(cl(cx)), x1 = Math.max(x0 + 1, Math.ceil(cl(cx + ew)));
    const bel = x1 <= W ? (below[x1] - below[x0]) / (x1 - x0) : 0;
    if (!(y1 > y0 && x0 < W)) return { base: tone(0), bel };
    const xr = Math.min(x1, W);
    if (!shape || !prof || xr - x0 < 2 || y1 - y0 < 2) return { base: tone(dark(x0, y0, xr, y1)), bel };
    const xm = (x0 + xr) / 2, ym = (y0 + y1) / 2, [pl, pr, pt, pb] = prof;
    const d = pt * (pl * dark(x0, y0, xm, ym) + pr * dark(xm, y0, xr, ym)) +
      pb * (pl * dark(x0, ym, xm, y1) + pr * dark(xm, ym, xr, y1));
    return { base: tone(d), bel };
  }
  // Sets a token tentatively from x = sx without changing state.
  function trial(str, sx) {
    const items = [];
    let cx = sx, cin = carry;
    if (wordMode && str !== ' ') {
      let ew = 0;
      const glyphs = graphemes(str);
      for (const ch of glyphs) ew += metric(ch).adv[mid] * k;
      const { base, bel } = region(sx, ew, null), t = base + cin + bel;
      let avg = wordAvg.get(str);
      if (!avg) {
        const n0 = metric(glyphs[0]).cov.length;
        avg = new Float32Array(n0);
        let n = 0;
        for (const ch of glyphs) { const m = metric(ch); for (let v = 0; v < n0; v++) avg[v] += m.cov[v]; n++; }
        for (let v = 0; v < n0; v++) avg[v] /= n;
        wordAvg.set(str, avg);
      }
      let bc = Infinity, best = cands[0];
      for (const c of cands) {
        const cost = costOf(avg[c.v] * covScale * c.s * (1 - c.g), t, c) + SIZE_JUMP * Math.abs(c.s - lastS);
        if (cost < bc) { bc = cost; best = c; }
      }
      const err = clampErr(t - avg[best.v] * covScale * best.s * (1 - best.g));
      for (const ch of glyphs) {
        const m = metric(ch), adv = m.adv[best.v] * k * best.s;
        items.push({ ch, wi: best.wi, wd: best.wd, s: best.s, si: best.si, g: best.g, eff: effOf(m, best, covScale), adv, err, base, x: cx });
        cx += adv;
      }
      return { items, width: cx - sx };
    }
    let ps = lastSi;
    for (const ch of graphemes(str)) {
      const m = metric(ch), { base, bel } = region(cx, m.adv[mid] * k, m.prof), t = base + cin + bel;
      let c;
      if (ch === ' ') c = space;
      else {
        let bi = Math.round(t * LUT_SCALE);
        bi = bi < 0 ? 0 : bi >= LUT_BINS ? LUT_BINS - 1 : bi;
        c = cands[luts.get(ch)[bi * NS + ps]];
        ps = c.si;
      }
      const eff = ch === ' ' ? 0 : effOf(m, c, covScale), err = clampErr(t - eff), adv = m.adv[c.v] * k * c.s;
      items.push({ ch, wi: c.wi, wd: c.wd, s: c.s, si: c.si, g: c.g, eff, adv, err, base, x: cx });
      cx += adv; cin = err * 0.5;
    }
    return { items, width: cx - sx };
  }
  function commit(items) {
    for (const it of items) {
      line.items.push(it); line.w += it.adv; x += it.adv; carry = it.err * 0.5;
      if (it.si >= 0) { lastSi = it.si; lastS = it.s; }
      const a = Math.floor(cl(it.x)), b = Math.ceil(cl(it.x + it.adv)), e = it.err * 0.5;
      for (let i = a; i < b && i < W; i++) next[i] += e;
    }
  }

  if (!newLine()) return { ok: false };
  let pending = null, wi = 0;
  while (pending !== null || wi < words.length) {
    const tok = pending !== null ? pending : words[wi];
    if (tok === ' ') { commit(trial(' ', x).items); pending = null; wi++; continue; }
    const r = trial(tok, x);
    if (x + r.width <= W + 0.5) { commit(r.items); pending = null; wi++; continue; }
    if (line.items.length === 0) { // word longer than a line: break between characters
      let n = 0, w = 0;
      while (n < r.items.length && w + r.items[n].adv <= W) { w += r.items[n].adv; n++; }
      if (n === 0) n = 1;
      commit(r.items.slice(0, n));
      const rest = graphemes(tok).slice(n).join('');
      pending = rest || null;
      if (!rest) wi++;
    }
    if (!newLine()) return { ok: false };
  }
  return { ok: true, lines, L, fs };
}

/**
 * Largest line height at which the whole text fits the block; grows the block if even `minLine` is
 * too big. A narrower [minLine, maxLine] window speeds up refits when the answer is roughly known.
 */
export function fit(words, ctx, minLine = 3, maxLine = ctx.H) {
  let a = minLine, b = Math.min(maxLine, ctx.H), best = null;
  for (let i = 0; i < 26 && b - a >= 0.05; i++) {
    const L = (a + b) / 2, r = layoutAt(words, L, ctx);
    if (r.ok) { best = r; a = L; } else b = L;
  }
  if (best) {
    // Round the line height down to 1/64 px. Glyph widths follow the chosen weights, so the layout is not
    // strictly monotonic: if the rounded height happens not to fit, step down further.
    for (let q = quantizeLine(best.L), k = 0; q >= minLine && k < 64; q -= 1 / 64, k++) {
      if (q === best.L) return { ...best, overflow: false };
      const r = layoutAt(words, q, ctx);
      if (r.ok) return { ...r, overflow: false };
    }
  }
  return { ...layoutAt(words, minLine, ctx, true), overflow: true };
}

/**
 * Line heights are rounded down to a multiple of 1/64 px. Browsers store layout positions in 1/64 px
 * units; an arbitrary line height is rounded on every line, and over a long sheet the error adds up
 * (measured: 0.5 mm on a 1 m poster). With exact multiples, every renderer puts every line where the
 * layout says.
 */
export const quantizeLine = (L) => Math.floor(L * 64) / 64;

/** Justification of one line: extra word spacing for inner spaces, and the index of the last non-space glyph. */
export function justify(line, isLast, W, fs) {
  let j = line.items.length - 1, inner = line.w;
  while (j >= 0 && line.items[j].ch === ' ') { inner -= line.items[j].adv; j--; }
  let spaces = 0;
  for (let q = 0; q <= j; q++) if (line.items[q].ch === ' ') spaces++;
  const ws = !isLast && spaces > 0 ? Math.max(0, Math.min((W - inner) / spaces, fs * 1.5)) : 0;
  return { ws, lastInner: j };
}

/** Pearson correlation between target tone and achieved coverage over all glyphs (1 = perfect). */
export function toneFidelity(result) {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, n = 0;
  for (const ln of result.lines) for (const it of ln.items) {
    if (it.ch === ' ') continue;
    sx += it.base; sy += it.eff; sxx += it.base * it.base; syy += it.eff * it.eff; sxy += it.base * it.eff; n++;
  }
  if (n < 2) return 0;
  return (n * sxy - sx * sy) / Math.sqrt(Math.max(1e-12, (n * sxx - sx * sx) * (n * syy - sy * sy)));
}
