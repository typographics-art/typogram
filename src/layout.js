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
/**
 * A repeated character must start at least this many of its own font sizes after the previous one.
 * PDF text extractors drop a glyph as "fake bold" when it repeats the previous character closer than that
 * (MuPDF: 0.1 em, stext-device.c FAKE_BOLD_MAX_DIST) — a tiny "l" followed by a large "l" lost a letter.
 */
export const REPEAT_GAP = 0.12;
/** Cost of leaving the normal width, so width only changes where it buys tone. */
export const STRETCH_COST = 0.0012;
const MID_WEIGHT = 4;
/**
 * Up to this many lines a plain layout is too coarse to form a picture (measured: the title of a 3 000 character
 * text is a band of 6 lines): blank space then becomes layout material (options.gaps 'auto', see layoutAt).
 */
export const SPARSE_LINES = 100;
/** Darkness (0..1) of a stretch of a line from which on it may carry type when gaps are used. */
export const GAP_INK = 0.25;

export const normalizeText = (t) => t.replace(/\s+/g, ' ').trim();

// A glyph is a grapheme cluster, not a code point: a letter with its combining accents, an emoji
// sequence or a syllable in scripts like Devanagari must get one style and stay one unit, or the
// marks end up in separate runs that renderers and PDF text layers drop.
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('und', { granularity: 'grapheme' }) : null;
/** The text split into grapheme clusters (falls back to code points where Intl.Segmenter is missing). */
export const graphemes = (t) => (segmenter ? Array.from(segmenter.segment(t), (x) => x.segment) : Array.from(t));
/**
 * Words and single spaces, in order. Joining the tokens gives back the normalised text.
 * Cut along grapheme clusters, the same units the metrics are measured for: a space followed by a combining
 * mark (Thai sara am, a lone accent) is one cluster, not a space and a mark, and stays inside its word.
 */
export const tokenize = (text) => {
  const out = [];
  let word = '';
  for (const g of graphemes(normalizeText(text))) {
    if (g === ' ') { if (word) out.push(word); word = ''; out.push(' '); } else word += g;
  }
  if (word) out.push(word);
  return out;
};

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
 *        normalWidth (width index of the font's normal width), shape (boolean),
 *        mask: { thr, stretch } | null }
 * With `mask`, glyphs are set only where the picture is dark (darkness >= thr): each line is cut into ink
 * segments, words fill a segment (its spaces widen to use it up, by at most `stretch` font sizes each) and the
 * rest of the line stays blank. The blank is pure layout: a space between two words gets extra width
 * (item.extra), a line's first segment is entered by an indent (line.indent). No character is added, removed
 * or moved, and only spaces grow, so the normalised text is the source text. See docs/algorithm.md.
 */
export function layoutAt(words, L, ctx, unbounded = false, settleLines = true) {
  const {
    W, H, dark, tone, cands, luts, metric, covScale, lineRatio, sizeCount: NS, wordMode, wordAvg,
    normalWidth = 0, shape = false, mask = null,
  } = ctx;
  const fs = L * lineRatio, k = fs / REF_SIZE, maxLines = unbounded && !mask ? Infinity : Math.floor(H / L);
  if (maxLines < 1) return { ok: false };
  const mid = normalWidth * WEIGHT_STEPS + MID_WEIGHT;
  const space = { wi: MID_WEIGHT, wd: normalWidth, v: mid, st: 1, s: 1, si: -1, g: 0 };
  const minSize = cands.reduce((m, c) => Math.min(m, c.s), 1);
  const next = new Float32Array(W), below = new Float64Array(W + 1);
  const lines = [];
  let line = null, x = 0, carry = 0, lastSi = 0, lastS = 1, lineSi = 0, lineS = 1;
  const cl = (v) => (v < 0 ? 0 : v > W ? W : v);
  let segs = [], segI = 0, segFrom = 0, segHasText = false;
  const clampErr = (e) => (e > 0.2 ? 0.2 : e < -0.2 ? -0.2 : e);

  function newLine() {
    if (line) { // error left by the finished line feeds the next one (prefix sums for fast spans)
      closeSegment();
      if (settleLines && !mask) settle(line);
      below[0] = 0;
      for (let i = 0; i < W; i++) below[i + 1] = below[i] + next[i];
      next.fill(0);
    }
    if (lines.length >= maxLines) return false;
    line = { items: [], w: 0 };
    lines.push(line); x = 0; carry = 0; lineSi = lastSi; lineS = lastS;
    if (mask) {
      line.mask = true;
      segs = inkSegments(lines.length - 1); segI = 0; segFrom = 0; segHasText = false;
      if (segs.length) x = line.indent = segs[0].x0;
    }
    return true;
  }
  // Runs of the line's band where the picture is dark enough to carry type; short gaps are bridged, specks dropped.
  function inkSegments(li) {
    const y0 = li * L, y1 = Math.min(H, (li + 1) * L), step = Math.max(1, fs * 0.3), out = [];
    if (!(y1 > y0)) return out;
    let start = -1;
    for (let sx = 0; sx < W; sx += step) {
      const ink = dark(sx, y0, Math.min(W, sx + step), y1) >= mask.thr;
      if (ink && start < 0) start = sx;
      if (!ink && start >= 0) { out.push({ x0: start, x1: sx }); start = -1; }
    }
    if (start >= 0) out.push({ x0: start, x1: W });
    const merged = [];
    for (const sg of out) {
      const prev = merged[merged.length - 1];
      if (prev && sg.x0 - prev.x1 < fs * 0.6) prev.x1 = sg.x1; else merged.push(sg);
    }
    return merged.filter((sg) => sg.x1 - sg.x0 >= fs * 1.2);
  }
  // Ends the current ink segment: its inner spaces take up the slack, so the segment's right edge is as
  // even as its left one (a space grows by at most mask.stretch font sizes; a lone word leaves the rest blank).
  function closeSegment() {
    if (!mask || !line || segI >= segs.length) return;
    const its = line.items.slice(segFrom);
    let last = its.length - 1;
    while (last >= 0 && its[last].ch === ' ') last--;
    if (last < 0) return;
    const slack = segs[segI].x1 - (its[last].x + its[last].adv);
    const spaces = its.slice(0, last).filter((it) => it.ch === ' ').length;
    if (!(slack > 0) || !spaces) return;
    const per = Math.min(slack / spaces, fs * (mask.stretch ?? 2.5));
    let shift = 0;
    for (let q = 0; q < its.length; q++) {
      const it = its[q];
      it.x += shift;
      if (q < last && it.ch === ' ') { it.adv += per; it.extra = (it.extra || 0) + per; shift += per; }
    }
    x += shift; line.w += shift;
  }
  // Moves on to the next ink segment of the line that still has room; the space before the word carries the gap.
  function nextSegment() {
    closeSegment();
    for (let k = segI + 1; k < segs.length; k++) {
      if (segs[k].x1 <= x + fs) continue;
      const to = Math.max(x, segs[k].x0), tail = line.items[line.items.length - 1];
      if (!tail) { line.indent = to; x = to; }
      else if (tail.ch === ' ') { tail.adv += to - x; tail.extra = (tail.extra || 0) + to - x; line.w += to - x; x = to; }
      else continue;
      segI = k; segFrom = line.items.length; segHasText = false;
      return true;
    }
    return false;
  }
  // Justification widens a finished line's spaces, which moves every glyph after the first space to the
  // right: measured up to 5 % of the width at the end of a line, so tone and colour came from the wrong
  // place there. Re-choose the line's glyphs at their final positions (twice, as new widths change the
  // spacing), keep the result only if the line still fits, then pass its error on from those positions.
  function settle(ln) {
    const tokens = [];
    for (const it of ln.items) {
      if (it.ch === ' ') tokens.push(' ');
      else if (tokens.length && tokens[tokens.length - 1] !== ' ') tokens[tokens.length - 1] += it.ch;
      else tokens.push(it.ch);
    }
    for (let pass = 0; pass < 2; pass++) {
      const { ws, lastInner } = justify(ln, false, W, fs);
      if (ws === 0) break;
      carry = 0; lastSi = lineSi; lastS = lineS;
      const items = [];
      let cx = 0;
      for (const tok of tokens) {
        const r = trial(tok, cx);
        for (const it of r.items) {
          items.push(it); carry = it.err * 0.5;
          if (it.si >= 0) { lastSi = it.si; lastS = it.s; }
        }
        cx += r.width + (tok === ' ' && items.length - 1 <= lastInner ? ws : 0);
      }
      let w = 0, inner = 0;
      for (const it of items) w += it.adv;
      inner = w;
      for (let j = items.length - 1; j >= 0 && items[j].ch === ' '; j--) inner -= items[j].adv;
      if (inner > W + 0.5) break;
      ln.items = items; ln.w = w;
    }
    next.fill(0);
    for (const it of ln.items) {
      const a = Math.floor(cl(it.x)), b = Math.ceil(cl(it.x + it.adv)), e = it.err * 0.5;
      for (let i = a; i < b && i < W; i++) next[i] += e;
    }
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
    let ps = lastSi, prevCh = null, prevAdv = 0;
    for (const ch of graphemes(str)) {
      const m = metric(ch), { base, bel } = region(cx, m.adv[mid] * k, m.prof), t = base + cin + bel;
      let c;
      if (ch === ' ') c = space;
      else {
        let bi = Math.round(t * LUT_SCALE);
        bi = bi < 0 ? 0 : bi >= LUT_BINS ? LUT_BINS - 1 : bi;
        c = cands[luts.get(ch)[bi * NS + ps]];
        if (ch === prevCh && prevAdv < REPEAT_GAP * fs * c.s) {
          let bc = Infinity;
          for (const o of cands) {
            if (prevAdv < REPEAT_GAP * fs * o.s && o.s > minSize) continue;
            const cost = costOf(effOf(m, o, covScale), t, o);
            if (cost < bc) { bc = cost; c = o; }
          }
        }
        ps = c.si;
      }
      const eff = ch === ' ' ? 0 : effOf(m, c, covScale), err = clampErr(t - eff), adv = m.adv[c.v] * k * c.s;
      items.push({ ch, wi: c.wi, wd: c.wd, s: c.s, si: c.si, g: c.g, eff, adv, err, base, x: cx });
      cx += adv; cin = err * 0.5; prevCh = ch; prevAdv = adv;
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
    let r = trial(tok, x);
    if (mask) {
      const seg = segs[segI];
      if (seg && x + r.width <= seg.x1 + 0.5) { commit(r.items); segHasText = true; pending = null; wi++; continue; }
      // a word wider than its whole segment is set anyway: it spills into the blank (a gap inside a word is no option)
      if (seg && !segHasText && r.width > seg.x1 - seg.x0 && x + r.width <= W + 0.5) {
        commit(r.items); segHasText = true; pending = null; wi++; continue;
      }
      if (seg && nextSegment()) continue;
    } else if (x + r.width <= W + 0.5) { commit(r.items); pending = null; wi++; continue; }
    if (line.items.length === 0 && (!mask || r.width > W)) { // word longer than a line: break between characters
      // The room is what is left of the line after its indent. A gap layout has entered the line at the first
      // ink segment (x > 0): filling W from zero ran the piece past the page edge, where PDF text layers drop it.
      // If not even one glyph fits behind the indent, the line starts at the margin instead.
      if (x > 0 && W - x < r.items[0].adv) { delete line.indent; x = 0; r = trial(tok, 0); }
      const room = W - x;
      let n = 0, w = 0;
      while (n < r.items.length && w + r.items[n].adv <= room) { w += r.items[n].adv; n++; }
      if (n === 0) n = 1;
      commit(r.items.slice(0, n));
      const rest = graphemes(tok).slice(n).join('');
      pending = rest || null;
      if (!rest) wi++;
    }
    if (!newLine()) return { ok: false };
  }
  closeSegment();
  return { ok: true, lines, L, fs };
}

/**
 * Largest line height at which the whole text fits the block; grows the block if even `minLine` is
 * too big. A narrower [minLine, maxLine] window speeds up refits when the answer is roughly known.
 */
/**
 * An ordinary word (up to this many graphemes) is never broken between characters: the type size is reduced instead
 * (maxLineForWords). A longer token (a URL, a base64 string, the dot-joined lines of a structured-data block) is wider than any
 * sensible line and may break (docs/technique.md, rule 1).
 */
export const ORDINARY_WORD = 24;
/** The line height above which the widest ordinary word, at its widest candidate style, would be wider than the line (Infinity if there is none). */
export function maxLineForWords(words, ctx) {
  const { W, cands, metric, lineRatio } = ctx;
  let widest = 0;
  for (const w of words) {
    if (w === ' ') continue;
    const g = graphemes(w);
    if (g.length > ORDINARY_WORD) continue;
    let per = 0;
    for (const ch of g) { const m = metric(ch); let a = 0; for (const c of cands) a = Math.max(a, m.adv[c.v] * c.s); per += a; }
    if (per > widest) widest = per;
  }
  return widest > 0 ? (W * REF_SIZE) / (widest * lineRatio) : Infinity;
}

export function fit(words, ctx, minLine = 3, maxLine = ctx.H) {
  let a = minLine, b = Math.min(maxLine, ctx.H), best = null;
  const cap = maxLineForWords(words, ctx); // a short text would otherwise be set so large that an ordinary word breaks mid-word
  if (cap >= minLine && cap < b) b = cap;
  // The search skips re-choosing glyphs at their justified positions (settle in layoutAt), which costs
  // more than half the time and hardly changes where lines break; the final layout below does it.
  for (let i = 0; i < 26 && b - a >= 0.05; i++) {
    const L = (a + b) / 2, r = layoutAt(words, L, ctx, false, false);
    if (r.ok) { best = r; a = L; } else b = L;
  }
  if (best) {
    // Round the line height down to 1/64 px. Glyph widths follow the chosen weights, so the layout is not
    // strictly monotonic: if the rounded height happens not to fit, step down further.
    for (let q = quantizeLine(best.L), k = 0; q >= minLine && k < 64; q -= 1 / 64, k++) {
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
  const ws = !isLast && spaces > 0 && !line.mask ? Math.max(0, Math.min((W - inner) / spaces, fs * 1.5)) : 0;
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
