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
// ALLOWLIST of the draw-trace elements a generated page contains; any other (images, shadings, masks, tiles, invisible or
// clipping text, clipped images …) is reported by name, so an operator this check has never seen can not slip through
const KNOWN = new Set(['document', 'page', 'set_default_colorspaces', 'group', 'clip_path', 'pop_clip', 'fill_path', 'stroke_path', 'moveto', 'lineto', 'curveto', 'closepath', 'fill_text', 'span', 'g']);
const MIN_GLYPH_PT = 0.5; // effective glyph size on the page; the smallest the generator makes is ~1.4 pt (EU AI Act one-pager)
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
    const child = spawn('mutool', ['trace', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '', exitCode = null, pages = 0, pagesClosed = 0;
    child.stderr.on('data', (d) => { if (stderr.length < 2000) stderr += d; });
    let doneParts = 0;
    const part = () => { if (++doneParts === 2) finish(); };
    child.on('close', (code, sig) => { exitCode = sig ? 'signal' : code; part(); });
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
      if (!KNOWN.has(op)) { add(`<${op}> in the page trace (${/image|shade|mask|tile|layer/.test(op) ? 'an image, shading or mask can cover or fake words' : /text/.test(op) ? 'invisible or clipping text' : 'not something a generated page contains'})`); return; }
      const alpha = attr(line, 'alpha'), blend = attr(line, 'blendmode');
      if (alpha != null && Number(alpha) !== 1) add('transparency (alpha below 1) fades what is under it or the glyphs themselves');
      if (blend != null && blend !== 'Normal') add(`blend mode ${blend} changes how glyphs are painted`);
      if (closing && op === 'page') pagesClosed++;
      if (op === 'page' && !closing) { pages++; page = null; const mb = attr(line, 'mediabox'); if (mb) { const b = num(mb); page = { w: b[2] - b[0], h: b[3] - b[1], glyphs: new Map(), paper: [] }; } clips = []; return; }
      if (!page) return;
      if (op === 'group' && !closing) {
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
      if (op === 'span' && !closing && page.curText) { page.curText.size = Math.abs(num(attr(line, 'trm') || '0 0 0 0')[0]) * Math.abs(page.curText.t[0]); return; }
      if (op === 'g' && page.curText) {
        const [x, y] = apply(page.curText.t, Number(attr(line, 'x')), Number(attr(line, 'y')));
        const key = Math.floor(x / CELL) * 100003 + Math.floor(y / CELL);
        const cell = page.glyphs.get(key); if (cell) cell.push(x, y); else page.glyphs.set(key, [x, y]);
        glyphsTotal++;
        if (!(page.curText.size >= MIN_GLYPH_PT)) add('a glyph is scaled down to nothing (it reads back but is not visible)');
        const cb = clipBox();
        if (x < -1 || y < -1 || x > page.w + 1 || y > page.h + 1) add('a glyph sits outside the page, so the text reads back but is not on it');
        else if (x < cb[0] - 1 || x > cb[2] + 1 || y < cb[1] - 1 || y > cb[3] + 1) add('a clip hides a glyph: it reads back but is cut away on the page');
        // a glyph in exactly the colour of the paper under it is invisible
        for (let i = page.paper.length - 1; i >= 0; i--) {
          const p = page.paper[i];
          if (x >= p.box[0] && x <= p.box[2] && y >= p.box[1] && y <= p.box[3]) { if (p.color === page.curText.color) add('a glyph has exactly the colour of the paper under it: that character is invisible'); break; }
        }
      }
    });
    child.on('error', () => resolve(['could not run MuPDF to check the painted page']));
    // fail closed: a trace that did not finish cleanly, or MuPDF complaining about the page, is not a clean page
    rl.on('close', part);
    const finish = () => {
      if (exitCode !== 0) add('MuPDF could not trace the page cleanly (exit ' + exitCode + ')');
      if (stderr.trim()) add('MuPDF reported problems reading the page: ' + stderr.trim().split('\n')[0].slice(0, 120));
      if (!pages || pagesClosed !== pages) add('the page trace is incomplete');
      if (!glyphsTotal) add('the PDF paints no text at all');
      resolve(out);
    };
  });
}
