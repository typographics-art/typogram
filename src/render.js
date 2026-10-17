// Serialises a set sheet to HTML or SVG. Both keep every glyph as a real character in reading
// order, so the source text can be extracted again (copy/paste, screen readers, AI models).
//
// A sheet is { result, W, pad, outW, outH, font, weights, paper, colorOf } — see browser.js.
import { justify } from './layout.js';
import { fontStylesheetUrl, normalWidthIndex, variationsFor } from './fonts.js';
import { rgbCss } from './color.js';

/**
 * Every glyph must stay its own character: ligatures would merge "ffi" into one glyph (Chrome's PDF
 * text layer then drops the "i"), and both ligatures and kerning would break the per-glyph metrics.
 */
export const GLYPH_CSS = 'font-variant-ligatures:none;font-kerning:none;font-feature-settings:"liga" 0,"clig" 0,"kern" 0';

export const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Inner HTML: one block per line, one span per run of identically styled glyphs.
 * `from`/`to` render a range of lines (for very large sheets that are output in parts).
 */
export function toHtml(sheet, from = 0, to = sheet.result.lines.length) {
  const { result, W, colorOf, weights, font } = sheet, { lines, L, fs } = result;
  const nw = normalWidthIndex(font);
  let html = '';
  for (let i = from; i < to; i++) {
    const ln = lines[i];
    const { ws } = justify(ln, i === lines.length - 1, W, fs);
    html += `<div style="height:${L.toFixed(2)}px;line-height:${L.toFixed(2)}px;font-size:${fs.toFixed(2)}px;white-space:pre;word-spacing:${ws.toFixed(2)}px${ln.indent ? `;text-indent:${ln.indent.toFixed(2)}px` : ''}">`;
    let run = '', key = null, style = '';
    const flush = () => { if (run) html += `<span style="${style}">${escapeXml(run)}</span>`; run = ''; };
    for (const it of ln.items) {
      const col = it.ch === ' ' ? '' : colorOf(it, i);
      const k = it.wi + '|' + it.wd + '|' + it.s + '|' + col + (it.extra ? '|' + it.extra : '');
      if (k !== key) {
        flush(); key = k;
        style = `font-size:${(fs * it.s).toFixed(2)}px;font-weight:${weights[it.wi]}` +
          (it.wd !== nw ? `;font-stretch:${font.widths[it.wd]}%;font-variation-settings:${variationsFor(font, font.widths[it.wd])}` : '') +
          (col ? `;color:${col}` : '') + (it.extra ? `;word-spacing:${it.extra.toFixed(2)}px` : '');
      }
      run += it.ch;
    }
    flush();
    html += '</div>';
  }
  return html;
}

/**
 * What a printed PDF of the sheet is made of, counted the way toHtml forms its runs: drawn glyphs,
 * runs (a new one wherever weight, width, size or colour changes; each costs a text block in the PDF),
 * fonts and outlines. Chrome embeds a separate Type 3 font for every weight × width × type size it prints
 * (measured: 10 weights at 5 sizes gave 100 fonts, at one size 20), and every character used in it as a
 * glyph outline, so outlines are distinct weight × width × size × character. Spaces are not drawn.
 * estimatePdfBytes turns these counts into a file size.
 */
export function pdfStats(sheet) {
  const { lines } = sheet.result;
  const outlines = new Set(), fonts = new Set();
  let glyphs = 0, runs = 0;
  lines.forEach((ln, i) => {
    let key = null;
    for (const it of ln.items) {
      if (it.ch === ' ') { key = null; continue; }
      const k = it.wi + '|' + it.wd + '|' + it.s + '|' + sheet.colorOf(it, i);
      if (k !== key) { runs++; key = k; }
      glyphs += it.ch.length;
      outlines.add(it.wi + '|' + it.wd + '|' + it.s + '|' + it.ch);
      fonts.add(it.wi + '|' + it.wd + '|' + it.s);
    }
  });
  return { glyphs, runs, outlines: outlines.size, fonts: fonts.size };
}

/**
 * Expected size of a PDF printed from Chrome in one piece, from pdfStats. Fitted on 18 one-pagers
 * printed with Chrome 154 (scripts/size-study.mjs, docs/file-size.md): median error 0.5 %, at most
 * 2.7 %. `optimized` gives the size after cli/pdf-slim.js and qpdf (what the command-line tools write;
 * median error 0.7 %, at most 1.5 %). Large sheets printed in several strips by the CLI are bigger, as
 * every strip carries its own fonts.
 */
export function estimatePdfBytes({ outlines, runs, glyphs }, { optimized = false } = {}) {
  return optimized
    ? 328 * outlines + 7.4 * runs + 0.8 * glyphs + 6800
    : 555 * outlines + 7.2 * runs + 0.9 * glyphs + 14400;
}

/** Self-contained HTML snippet including the font link and the paper. */
export function toStandaloneHtml(sheet) {
  const { outW, outH, pad, font, paper } = sheet;
  const q = (s) => s.replace(/'/g, '&quot;');
  return `<link rel="stylesheet" href="${fontStylesheetUrl()}">\n` +
    `<div style="box-sizing:border-box;width:${outW}px;height:${outH}px;padding:${pad}px;overflow:hidden;` +
    `background:${rgbCss(paper.paper)};color:${rgbCss(paper.ink)};font-family:${q(font.css)};font-variation-settings:${q(font.variations)};${q(GLYPH_CSS)}">` +
    toHtml(sheet) + '</div>';
}

/** Calls fn(item, x, baselineY, lineIndex) for every glyph of lines [from, to), in reading order, in sheet coordinates. */
export function forEachGlyph(sheet, fn, from = 0, to = sheet.result.lines.length) {
  const { result, W, pad } = sheet, { lines, L, fs } = result;
  for (let i = from; i < to; i++) {
    const ln = lines[i];
    const { ws, lastInner } = justify(ln, i === lines.length - 1, W, fs);
    const y = pad + i * L + L * 0.5 + fs * 0.35;
    let x = pad + (ln.indent || 0);
    ln.items.forEach((it, q) => {
      fn(it, x, y, i);
      x += it.adv + (it.ch === ' ' && q <= lastInner ? ws : 0);
    });
  }
}

/** Opening of an SVG document for the sheet (paper, font, the <text> element). */
export function svgHead(sheet) {
  const { outW, outH, font, paper } = sheet;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="0 0 ${outW} ${outH}">` +
    `<style>@import url('${escapeXml(fontStylesheetUrl())}');</style>` +
    `<rect width="100%" height="100%" fill="${rgbCss(paper.paper)}"/>` +
    `<text xml:space="preserve" font-family="${escapeXml(font.css)}" style="font-variation-settings:${escapeXml(font.variations)};${escapeXml(GLYPH_CSS)}" fill="${rgbCss(paper.ink)}">`;
}

export const SVG_TAIL = '</text></svg>';

/** The glyphs of lines [from, to) as SVG tspans. Parts concatenate to the same document as toSvg. */
export function svgLines(sheet, from = 0, to = sheet.result.lines.length) {
  const { font, colorOf, weights, result } = sheet, fs = result.fs;
  const nw = normalWidthIndex(font);
  let out = '', open = false, key = null, needX = true;
  forEachGlyph(sheet, (it, x, y, i) => {
    const col = it.ch === ' ' ? '' : colorOf(it, i), k = it.wi + '|' + it.wd + '|' + it.s + '|' + col + '|' + i;
    if (k !== key || needX) {
      if (open) out += '</tspan>';
      out += `<tspan x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${(fs * it.s).toFixed(2)}" font-weight="${weights[it.wi]}"` +
        (it.wd !== nw ? ` font-stretch="${font.widths[it.wd]}%" style="font-variation-settings:${escapeXml(variationsFor(font, font.widths[it.wd]))}"` : '') +
        `${col ? ` fill="${col}"` : ''}>`;
      open = true; key = k; needX = false;
    }
    out += escapeXml(it.ch);
    if (it.ch === ' ') needX = true; // justified lines: position the next run explicitly
  }, from, to);
  if (open) out += '</tspan>';
  return out;
}

export function toSvg(sheet) {
  return svgHead(sheet) + svgLines(sheet) + SVG_TAIL;
}
