// Picture-layer lint for PDF Typograms — the counterpart of src/picture-lint.js (see there and docs/verification.md §6).
// The hash and signature cover the text layer; a PDF can keep that text intact and still PAINT something else: a shape
// drawn over the words (measured: an appended white rectangle left `tg verify` at VERIFIED on a blank page), an image,
// a soft mask or transparency, invisible-render-mode text, a glyph in the paper colour. MuPDF's `mutool trace` lists every
// draw operation with its device-space transform, which is enough to check the generator's invariant: the page paints
// glyphs and, BEFORE them, the paper — and afterwards only the signer's corner seal. Streamed (a poster traces to 300 MB).
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { SEAL_FRACTION } from '../src/stamp.js';

const SEAL_COLOR = '.122 .541 .298'; // SEAL_GREEN #1f8a4c as MuPDF prints it
const FORBIDDEN = new Set(['fill_image', 'fill_image_mask', 'fill_shade', 'clip_text', 'clip_stroke_text', 'clip_stroke_path', 'ignore_text', 'stroke_text', 'begin_mask', 'begin_tile', 'begin_layer']);
const CELL = 8; // points; glyph origins are bucketed on this grid so "any glyph under this shape?" is a few lookups

const num = (s) => s.split(/\s+/).map(Number);
const attr = (line, name) => { const m = new RegExp(`\\b${name}="([^"]*)"`).exec(line); return m ? m[1] : null; };
const apply = (t, x, y) => [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]];

/**
 * @param {string} file path of the PDF
 * @returns {Promise<string[]>} problems (empty for everything this tool generates)
 */
export function pdfPaintProblems(file) {
  return new Promise((resolve) => {
    const out = [];
    const add = (p) => { if (out.length < 8 && !out.includes(p)) out.push(p); };
    const child = spawn('mutool', ['trace', file], { stdio: ['ignore', 'pipe', 'ignore'] });
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });

    let page = null;                 // { w, h, glyphs: Map(cell -> glyph origins), paper: [{box, color}] }
    let path = null;                 // the path element being read: { kind, t, color, pts }
    let clips = [];                  // stack of device boxes (one per clip_path / group, popped by pop_clip / </group>)
    let pendingClip = null;
    let glyphsTotal = 0;

    const inter = (a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
    const nonEmpty = (b) => b[2] > b[0] && b[3] > b[1];
    const clipBox = () => clips.reduce((acc, c) => (c ? inter(acc, c) : acc), [-1e9, -1e9, 1e9, 1e9]);
    const glyphUnder = (b) => {
      for (let cx = Math.floor(b[0] / CELL); cx <= Math.floor(b[2] / CELL); cx++) {
        for (let cy = Math.floor(b[1] / CELL); cy <= Math.floor(b[3] / CELL); cy++) {
          const pts = page.glyphs.get(cx * 100003 + cy);
          if (pts) for (let i = 0; i < pts.length; i += 2) if (pts[i] > b[0] && pts[i] < b[2] && pts[i + 1] > b[1] && pts[i + 1] < b[3]) return true;
        }
      }
      return false;
    };

    const endPath = () => {
      const p = path; path = null;
      if (!p || !p.pts.length) return;
      const xs = p.pts.map(([x, y]) => apply(p.t, x, y));
      const box = [Math.min(...xs.map((q) => q[0])), Math.min(...xs.map((q) => q[1])), Math.max(...xs.map((q) => q[0])), Math.max(...xs.map((q) => q[1]))];
      if (p.kind === 'clip_path') { pendingClip = box; return; }
      // the signer's corner seal: green fill / white stroke, entirely inside the top-right corner square
      const S = Math.round(Math.min(page.w, page.h) * SEAL_FRACTION);
      const inCorner = box[0] >= page.w - S - 1 && box[2] <= page.w + 1 && box[1] >= -1 && box[3] <= S + 1;
      if (inCorner && ((p.kind === 'fill_path' && p.color === SEAL_COLOR) || (p.kind === 'stroke_path' && p.color === '1 1 1'))) {
        return; // re-signing draws the seal again on the same corner: harmless, and nothing else may use these colours elsewhere
      }
      if (p.kind === 'stroke_path') { add('a stroked line is drawn on the page (it can strike out or fake words)'); return; }
      const eff = inter(box, clipBox());
      if (nonEmpty(eff) && glyphUnder(eff)) add('a shape is painted over words that are already drawn (it covers them; the text layer still reads back)');
      else if (nonEmpty(eff)) page.paper.push({ box: eff, color: p.color });
    };

    rl.on('line', (line) => {
      const m = /^\s*<(\/?)([a-z_]+)\b/.exec(line);
      if (!m) return;
      const [, closing, op] = m;
      if (op === 'page') { page = null; const mb = attr(line, 'mediabox'); if (mb) { const b = num(mb); page = { w: b[2] - b[0], h: b[3] - b[1], glyphs: new Map(), paper: [] }; } clips = []; return; }
      if (!page) return;
      if (FORBIDDEN.has(op)) { add(`<${op}> in the page (${op.includes('text') ? 'invisible or masking text' : 'an image, shading or mask can cover or fake words'})`); return; }
      if (op === 'group' && !closing) {
        const alpha = attr(line, 'alpha'), blend = attr(line, 'blendmode');
        if (alpha != null && Number(alpha) !== 1) add('a transparency group fades what is under it');
        if (blend != null && blend !== 'Normal') add(`blend mode ${blend} changes how glyphs are painted`);
        clips.push(null); return;
      }
      if (op === 'group' && closing) { clips.pop(); return; }
      if (op === 'pop_clip') { clips.pop(); return; }
      if (op === 'clip_path' && !closing) { path = { kind: 'clip_path', t: num(attr(line, 'transform') || '1 0 0 1 0 0'), color: null, pts: [] }; return; }
      if ((op === 'fill_path' || op === 'stroke_path') && !closing) { path = { kind: op, t: num(attr(line, 'transform') || '1 0 0 1 0 0'), color: attr(line, 'color'), pts: [] }; return; }
      if (path && (op === 'moveto' || op === 'lineto')) { path.pts.push([Number(attr(line, 'x')), Number(attr(line, 'y'))]); return; }
      if (path && op === 'curveto') { for (const [a, b] of [['x1', 'y1'], ['x2', 'y2'], ['x3', 'y3']]) path.pts.push([Number(attr(line, a)), Number(attr(line, b))]); return; }
      if (closing && (op === 'fill_path' || op === 'stroke_path' || op === 'clip_path')) {
        const wasClip = path && path.kind === 'clip_path';
        endPath();
        if (wasClip) { clips.push(pendingClip); pendingClip = null; }
        return;
      }
      if (op === 'fill_text' && !closing) {
        const t = num(attr(line, 'transform') || '1 0 0 1 0 0'), color = attr(line, 'color');
        path = null;
        page.curText = { t, color };
        return;
      }
      if (op === 'g' && page.curText) {
        const [x, y] = apply(page.curText.t, Number(attr(line, 'x')), Number(attr(line, 'y')));
        const key = Math.floor(x / CELL) * 100003 + Math.floor(y / CELL);
        const cell = page.glyphs.get(key); if (cell) cell.push(x, y); else page.glyphs.set(key, [x, y]);
        glyphsTotal++;
        // a glyph in exactly the colour of the paper under it is invisible
        for (let i = page.paper.length - 1; i >= 0; i--) {
          const p = page.paper[i];
          if (x >= p.box[0] && x <= p.box[2] && y >= p.box[1] && y <= p.box[3]) { if (p.color === page.curText.color) add('a glyph has exactly the colour of the paper under it: that character is invisible'); break; }
        }
      }
    });
    child.on('error', () => resolve(['could not run MuPDF to check the painted page']));
    rl.on('close', () => { if (!glyphsTotal) add('the PDF paints no text at all'); resolve(out); });
  });
}
