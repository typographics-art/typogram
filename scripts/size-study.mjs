#!/usr/bin/env node
// Which settings cost file size, and which ones can be seen? Builds one-pagers of real examples with one
// setting changed at a time, measures the PDF (after qpdf) and how much the picture changes against the
// full-quality version, and writes docs/file-size-study.json. docs/file-size.md explains the results.
//
//   node scripts/size-study.mjs                      # all examples of the study
//   node scripts/size-study.mjs ch-bundesverfassung
//
// Two picture measures, both on pages rendered with MuPDF at 50 dpi and blurred to about 1.5 mm (a page
// seen as a whole, at reading distance):
// - visibleChange: mean absolute difference to the full-quality version, in percent of the full scale;
// - likeness: how closely the text block follows the picture it was set to (the title or motif card),
//   as Pearson correlation of brightness and, for colour, the mean over the R, G and B channels.
// `--evaluate` measures the PDFs of a previous run again without printing. Needs Chrome, MuPDF and qpdf.
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSession } from '../cli/core.mjs';
import { readDocument, makeOnePage, motifSource } from '../cli/onepage-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'examples', '.cache', 'size-study');
mkdirSync(OUT, { recursive: true });
const EXAMPLES = ['ch-bundesverfassung', 'de-grundgesetz'];
const DPI = 50, BLUR_MM = 1.5;

// One setting changed at a time; `full` is the reference with every variant allowed.
const VARIANTS = [
  ['full', 'all weights, widths and sizes, colour step 6, tagged PDF', { colorStep: 6 }, true],
  ['current', 'as published so far (colour step 24)', {}, true],
  ['untagged', 'without accessibility tags', {}, false],
  ['no-widths', 'one width (no condensed/expanded)', { stretch: false }, false],
  ['weights-4', '4 weights, one width', { stretch: false, weightCount: 4 }, false],
  ['weights-2', '2 weights, one width', { stretch: false, weightCount: 2 }, false],
  ['weights-1', '1 weight, one width (a single font)', { stretch: false, weightCount: 1 }, false],
  ['sizes-2', '2 sizes, one width', { stretch: false, sizeCount: 2 }, false],
  ['sizes-1', '1 size, one width', { stretch: false, sizeCount: 1 }, false],
  ['color-48', 'colour step 48, one width', { stretch: false, colorStep: 48 }, false],
  ['color-96', 'colour step 96, one width', { stretch: false, colorStep: 96 }, false],
  ['w2-s1', '2 weights, 1 size, one width', { stretch: false, weightCount: 2, sizeCount: 1 }, false],
  ['w1-s2', '1 weight, 2 sizes, one width', { stretch: false, weightCount: 1, sizeCount: 2 }, false],
  ['w1-s1', '1 weight, 1 size, one width: only colour or grey is left', { stretch: false, weightCount: 1, sizeCount: 1 }, false],
];

/** A page rendered as greyscale-or-RGB pixels via MuPDF (PNM output, parsed here). */
function raster(pdf) {
  const r = spawnSync('mutool', ['draw', '-q', '-r', String(DPI), '-c', 'rgb', '-F', 'pnm', '-o', '-', pdf], { maxBuffer: 1 << 28 });
  const b = r.stdout;
  let pos = 0;
  const token = () => {
    while (/\s/.test(String.fromCharCode(b[pos]))) pos++;
    const start = pos;
    while (!/\s/.test(String.fromCharCode(b[pos]))) pos++;
    return b.toString('latin1', start, pos);
  };
  if (token() !== 'P6') throw new Error('unexpected raster format');
  const w = +token(), h = +token();
  token();
  return { w, h, px: b.subarray(pos + 1, pos + 1 + w * h * 3) };
}

/** Box blur (three passes ≈ Gaussian) of one channel, radius in pixels. */
function blur(ch, w, h, r) {
  let a = Float32Array.from(ch), t = new Float32Array(a.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) { s += a[y * w + k]; n++; }
      t[y * w + x] = s / n;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) { s += t[k * w + x]; n++; }
      a[y * w + x] = s / n;
    }
  }
  return a;
}

function blurred(pdf) {
  const { w, h, px } = raster(pdf), r = Math.max(1, Math.round((BLUR_MM / 25.4) * DPI / 2));
  return { w, h, ch: [0, 1, 2].map((c) => blur(Array.from({ length: w * h }, (_, i) => px[i * 3 + c]), w, h, r)) };
}

function difference(a, b) {
  // Pages assembled from a different number of print strips can round to one pixel row more or less.
  if (Math.abs(a.w - b.w) > 2 || Math.abs(a.h - b.h) > 2) throw new Error('pages differ in size');
  const w = Math.min(a.w, b.w), h = Math.min(a.h, b.h);
  let s = 0;
  for (let c = 0; c < 3; c++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) s += Math.abs(a.ch[c][y * a.w + x] - b.ch[c][y * b.w + x]);
  return +((100 * s) / (3 * w * h * 255)).toFixed(2);
}

/** Correlation of two equally long arrays. */
function pearson(a, b) {
  let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  const n = a.length;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; saa += a[i] * a[i]; sbb += b[i] * b[i]; sab += a[i] * b[i]; }
  return (n * sab - sa * sb) / Math.sqrt((n * saa - sa * sa) * (n * sbb - sb * sb));
}

/** Likeness of the page's text block to the target picture (see the header). */
function likeness(page, target, geo) {
  const { w, h } = page, r = Math.max(1, Math.round((BLUR_MM / 25.4) * DPI / 2));
  const x0 = Math.round(w * geo.pad / geo.outW), y0 = Math.round(h * geo.pad / geo.outH);
  const cw = Math.round(w * (geo.outW - 2 * geo.pad) / geo.outW), ch = Math.round(h * (geo.outH - 2 * geo.pad) / geo.outH);
  const crop = (c) => Float32Array.from({ length: cw * ch }, (_, i) => c[(y0 + Math.floor(i / cw)) * w + x0 + (i % cw)]);
  const pc = page.ch.map(crop);
  const tgt = Buffer.from(target(cw, ch), 'base64');
  const tc = [0, 1, 2].map((c) => blur(Array.from({ length: cw * ch }, (_, i) => tgt[i * 3 + c]), cw, ch, r));
  const lum = (C) => C[0].map((v, i) => 0.2126 * v + 0.7152 * C[1][i] + 0.0722 * C[2][i]);
  return { brightness: +pearson(lum(pc), lum(tc)).toFixed(3), colour: +((pearson(pc[0], tc[0]) + pearson(pc[1], tc[1]) + pearson(pc[2], tc[2])) / 3).toFixed(3) };
}

/** Composition of the PDF: fonts and their glyphs, text runs. */
function anatomy(pdf) {
  const info = spawnSync('mutool', ['info', pdf], { encoding: 'utf8', maxBuffer: 1 << 26 }).stdout;
  return { pdfFonts: Number((info.match(/^Fonts \((\d+)\)/m) || [])[1] || 0) };
}

const all = JSON.parse(readFileSync(join(ROOT, 'examples', 'sources.json'), 'utf8'));
const evaluateOnly = process.argv.includes('--evaluate');
const only = process.argv.slice(2).filter((a) => a !== '--evaluate');
const previous = evaluateOnly ? JSON.parse(readFileSync(join(ROOT, 'docs', 'file-size-study.json'), 'utf8')).results : [];
const results = [];
const session = await openSession();
try {
  for (const id of only.length ? only : EXAMPLES) {
    const ex = all.find((e) => e.id === id);
    const doc = readDocument(ex.local ? join(ROOT, 'examples', ex.local) : join(ROOT, 'examples', '.cache', ex.file));
    const motif = ex.motif ? motifSource(ex.motif.startsWith('recipe:') ? ex.motif : join(ROOT, 'examples', ex.motif)) : null;
    let ref = null, geo = null;
    const target = (w, h) => session.call('tgOnePageTargetRgb', w, h);
    for (const [key, label, opts, tagged] of VARIANTS) {
      const pdf = join(OUT, `${id}-${key}.pdf`);
      const t0 = Date.now();
      const job = { text: doc.text, title: ex.title, subtitle: ex.subtitle, paper: ex.paper || 'a4', motif, options: { ...(ex.color ? { color: ex.color } : {}), ...opts } };
      const r = await makeOnePage(session, evaluateOnly ? job : { ...job, pdf, tagged });
      if (!geo) geo = await session.call('tgLinesInfo');
      const img = blurred(pdf);
      if (!ref) ref = img;
      const cw = Math.round(img.w * (geo.outW - 2 * geo.pad) / geo.outW), ch = Math.round(img.h * (geo.outH - 2 * geo.pad) / geo.outH);
      const targetRgb = await target(cw, ch);
      const like = likeness(img, () => targetRgb, geo);
      const base = evaluateOnly ? previous.find((p) => p.example === id && p.variant === key) : {
        example: id, variant: key, label, bytes: statSync(pdf).size, bytesBeforeQpdf: r.pdfBytesUnoptimized,
        readBackExact: !!(r.check && r.check.exact), reprints: r.reprints, ...anatomy(pdf), seconds: Math.round((Date.now() - t0) / 1000),
      };
      const row = { ...base, ...r.pdfStats, visibleChange: difference(ref, img), likeness: like };
      results.push(row);
      console.log(`${id} ${key.padEnd(10)} ${(row.bytes / 1048576).toFixed(2)} MB  change ${row.visibleChange.toFixed(2)} %  likeness brightness ${like.brightness} colour ${like.colour}  pdf fonts ${row.pdfFonts}`);
    }
  }
} finally {
  await session.close();
}
writeFileSync(join(ROOT, 'docs', 'file-size-study.json'), JSON.stringify({ dpi: DPI, blurMm: BLUR_MM, results }, null, 2) + '\n');
