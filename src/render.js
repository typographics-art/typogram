// Serialises a set sheet to HTML or SVG. Both keep every glyph as a real character in reading
// order, so the source text can be extracted again (copy/paste, screen readers, AI models).
//
// A sheet is { result, W, pad, outW, outH, font, weights, paper, colorOf } — see browser.js.
import { justify } from './layout.js';
import { fontStylesheetUrl, normalWidthIndex, variationsFor } from './fonts.js';
import { rgbCss } from './color.js';
import { buildDataLayer } from './typogram.js';
import { markdownToHtml } from './md-html.js';

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

// Base styles for the standalone HTML document: the two views side by side on wide screens, stacked on a phone. No executable
// script, no external resource except the Google-Fonts stylesheet — the page stays CSP-safe.
const HTML_DOC_CSS =
  ':root{color-scheme:light dark}' +
  'body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.6;color:#1a1a1a;background:#fff}' +
  '@media(prefers-color-scheme:dark){body{color:#e8e8e8;background:#121212}}' +
  '.tg-wrap{display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start;max-width:1400px;margin:0 auto;padding:16px}' +
  '.tg-figure{margin:0;flex:1 1 320px;min-width:0}.tg-figure svg,.tg-figure .tg-pic{max-width:100%;height:auto}' +
  '.tg-pic{display:block}' +
  '.tg-article{flex:1 1 360px;min-width:0;max-width:72ch}' +
  '.tg-article img{max-width:100%;height:auto}' +
  '.tg-article pre{overflow:auto;padding:12px;background:rgba(127,127,127,.12);border-radius:6px}' +
  '.tg-article code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}' +
  '.tg-article table{border-collapse:collapse;width:100%}' +
  '.tg-article th,.tg-article td{border:1px solid rgba(127,127,127,.4);padding:6px 10px}' +
  '.tg-article blockquote{margin:0 0 1em;padding-left:1em;border-left:3px solid rgba(127,127,127,.4);color:inherit;opacity:.85}';

/** The picture of a sheet as an inline HTML block (paper, font, one span per run), scaled to fit its column. */
export function pictureHtml(sheet, { description = '' } = {}) {
  const { outW, outH, pad, font, paper } = sheet;
  const q = (s) => s.replace(/'/g, '&quot;');
  return `<div class="tg-pic"${description ? ` role="img" aria-label="${escapeXml(description)}"` : ''} style="box-sizing:border-box;width:${outW}px;height:${outH}px;padding:${pad}px;overflow:hidden;` +
    `background:${rgbCss(paper.paper)};color:${rgbCss(paper.ink)};font-family:${q(font.css)};font-variation-settings:${q(font.variations)};${q(GLYPH_CSS)}">` +
    toHtml(sheet) + '</div>';
}

/**
 * A standalone HTML Typogram: a full document with two views — the picture as a <figure role="img">, and the real content as
 * an <article> with true headings, paragraphs, tables, code and lists rendered from the data-layer Markdown (src/md-html.js).
 * The JSON-LD record and the exact Markdown ride along as data scripts in <head>, so a machine reads the structured source
 * directly. `description` names the picture for assistive technology. CSP-safe: no executable inline script.
 */
export function toStandaloneHtml(sheet, { description = '', markdown = '', jsonld = null, lang = '' } = {}) {
  const title = (jsonld && jsonld.name) || description || 'Typographics Art';
  const ld = jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>\n` : '';
  // An HTML <script> ends at the first "</script"; split that sequence so the Markdown rides along intact (tg extract reverses it).
  const mdScript = markdown ? `<script type="text/markdown">${String(markdown).replace(/<\/(script)/gi, '<\\/$1')}</script>\n` : '';
  const article = markdown ? `<article class="tg-article">${markdownToHtml(markdown)}</article>` : '';
  return `<!doctype html>\n<html lang="${escapeXml(lang || 'en')}">\n<head>\n<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${escapeXml(title)}</title>\n` +
    `<link rel="stylesheet" href="${fontStylesheetUrl()}">\n` +
    ld + mdScript +
    `<style>${HTML_DOC_CSS}</style>\n</head>\n<body>\n` +
    `<div class="tg-wrap">\n` +
    `<figure class="tg-figure"${description ? ` role="img" aria-label="${escapeXml(description)}"` : ''}>${pictureHtml(sheet)}</figure>\n` +
    (article ? article + '\n' : '') +
    `</div>\n</body>\n</html>\n`;
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

/**
 * Opening of an SVG document for the sheet (paper, font, the <text> element; a <title> when a description is given).
 * When `markdown` or `jsonld` is given, the data layer (docs/typogram-file.md) goes right after the opening <svg …>,
 * before <title>/<text>: the exact source in CDATA + a JSON-LD record with the identity hash. Being CDATA/escaped it
 * never shifts the text anchors markupText() uses (readers strip it first), so the character-for-character read-back stays
 * exact whether or not a data layer is present.
 */
export function svgHead(sheet, { description = '', markdown, jsonld, media } = {}) {
  const { outW, outH, font, paper } = sheet;
  const data = (markdown != null || jsonld != null)
    ? buildDataLayer({ markdown: markdown ?? '', ...(media ? { media } : {}), jsonld: jsonld ?? null }) : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="0 0 ${outW} ${outH}">` +
    data +
    (description ? `<title>${escapeXml(description)}</title>` : '') +
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

/**
 * A Typogram SVG. `o.description` (what the picture shows) becomes the <title>, its accessible name; `o.markdown`/`o.jsonld`/
 * `o.media` add the data layer (the exact source + a JSON-LD record), placed before <text> by svgHead so the read-back of
 * the artwork text stays exact (src/typogram.js, docs/typogram-file.md).
 */
export function toSvg(sheet, o = {}) {
  return svgHead(sheet, o) + svgLines(sheet) + SVG_TAIL;
}
