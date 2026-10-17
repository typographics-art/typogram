// Serialises a set sheet to HTML or SVG. Both keep every glyph as a real character in reading
// order, so the source text can be extracted again (copy/paste, screen readers, AI models).
//
// A sheet is { result, W, pad, outW, outH, font, weights, paper, colorOf } — see browser.js.
import { justify } from './layout.js';
import { googleFontsUrl, normalWidthIndex, variationsFor } from './fonts.js';
import { rgbCss } from './color.js';

/**
 * Every glyph must stay its own character: ligatures would merge "ffi" into one glyph (Chrome's PDF
 * text layer then drops the "i"), and both ligatures and kerning would break the per-glyph metrics.
 */
export const GLYPH_CSS = 'font-variant-ligatures:none;font-kerning:none;font-feature-settings:"liga" 0,"clig" 0,"kern" 0';

export const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Inner HTML: one block per line, one span per run of identically styled glyphs. */
export function toHtml(sheet) {
  const { result, W, colorOf, weights, font } = sheet, { lines, L, fs } = result;
  const nw = normalWidthIndex(font);
  let html = '';
  lines.forEach((ln, i) => {
    const { ws } = justify(ln, i === lines.length - 1, W, fs);
    html += `<div style="height:${L.toFixed(2)}px;line-height:${L.toFixed(2)}px;font-size:${fs.toFixed(2)}px;white-space:pre;word-spacing:${ws.toFixed(2)}px">`;
    let run = '', key = null, style = '';
    const flush = () => { if (run) html += `<span style="${style}">${escapeXml(run)}</span>`; run = ''; };
    for (const it of ln.items) {
      const col = it.ch === ' ' ? '' : colorOf(it, i);
      const k = it.wi + '|' + it.wd + '|' + it.s + '|' + col;
      if (k !== key) {
        flush(); key = k;
        style = `font-size:${(fs * it.s).toFixed(2)}px;font-weight:${weights[it.wi]}` +
          (it.wd !== nw ? `;font-stretch:${font.widths[it.wd]}%;font-variation-settings:${variationsFor(font, font.widths[it.wd])}` : '') +
          (col ? `;color:${col}` : '');
      }
      run += it.ch;
    }
    flush();
    html += '</div>';
  });
  return html;
}

/** Self-contained HTML snippet including the font link and the paper. */
export function toStandaloneHtml(sheet) {
  const { outW, outH, pad, font, paper } = sheet;
  const q = (s) => s.replace(/'/g, '&quot;');
  return `<link rel="stylesheet" href="${googleFontsUrl(font)}">\n` +
    `<div style="box-sizing:border-box;width:${outW}px;height:${outH}px;padding:${pad}px;overflow:hidden;` +
    `background:${rgbCss(paper.paper)};color:${rgbCss(paper.ink)};font-family:${q(font.css)};font-variation-settings:${q(font.variations)};${q(GLYPH_CSS)}">` +
    toHtml(sheet) + '</div>';
}

/** Calls fn(item, x, baselineY, lineIndex) for every glyph, in reading order, in sheet coordinates. */
export function forEachGlyph(sheet, fn) {
  const { result, W, pad } = sheet, { lines, L, fs } = result;
  lines.forEach((ln, i) => {
    const { ws, lastInner } = justify(ln, i === lines.length - 1, W, fs);
    const y = pad + i * L + L * 0.5 + fs * 0.35;
    let x = pad;
    ln.items.forEach((it, q) => {
      fn(it, x, y, i);
      x += it.adv + (it.ch === ' ' && q <= lastInner ? ws : 0);
    });
  });
}

export function toSvg(sheet) {
  const { outW, outH, font, paper, colorOf, weights, result } = sheet, fs = result.fs;
  const nw = normalWidthIndex(font);
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="0 0 ${outW} ${outH}">` +
    `<style>@import url('${escapeXml(googleFontsUrl(font))}');</style>` +
    `<rect width="100%" height="100%" fill="${rgbCss(paper.paper)}"/>` +
    `<text xml:space="preserve" font-family="${escapeXml(font.css)}" style="font-variation-settings:${escapeXml(font.variations)};${escapeXml(GLYPH_CSS)}" fill="${rgbCss(paper.ink)}">`;
  let open = false, key = null, needX = true;
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
  });
  if (open) out += '</tspan>';
  return out + '</text></svg>';
}
