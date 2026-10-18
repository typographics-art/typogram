// The public text of a finished work file, read the way a machine reads it: for hidden messages, whose key fits
// exactly this text (src/secret.js). SVG and HTML: the text without markup. PDF: pdf.js in the browser
// (readWorkFile), MuPDF in the CLI; both give the same canonical text (measured on all 31 example PDFs).

import { stripDataLayer } from './typogram.js';

const PDFJS = new URL('../assets/vendor/pdfjs/', import.meta.url).href; // pdf.js 4.4.168, Apache-2.0, hosted with the project

const ENTITIES = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
const decodeEntities = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|quot|apos|amp);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e.toLowerCase()]);

// The two scans below replace the regexes /<(script|style|title|head)\b[\s\S]*?<\/\1>/gi and /<[^>]+>/g, which were
// quadratic in the file size when a "<" was never closed (minutes for a megabyte); they keep the same results.
const SECTIONS = ['script', 'style', 'title', 'head'];
/** Drops every closed <script>…</script>, <style>, <title>, <head> section (case-insensitive); an unclosed one stays. */
function stripSections(raw) {
  const low = raw.toLowerCase();
  const next = new Map(); // tag -> index of its next usable opener (or -1 once none is left)
  const opener = (tag, from) => {
    let i = low.indexOf('<' + tag, from);
    while (i >= 0 && /\w/.test(low[i + 1 + tag.length] || '')) i = low.indexOf('<' + tag, i + 1); // "<scripts>" is no opener
    return i;
  };
  let out = '', pos = 0;
  for (;;) {
    let best = -1, tag = null;
    for (const t of SECTIONS) {
      if (!next.has(t) || (next.get(t) >= 0 && next.get(t) < pos)) next.set(t, opener(t, pos));
      const i = next.get(t);
      if (i >= 0 && (best < 0 || i < best)) { best = i; tag = t; }
    }
    if (best < 0) break;
    const close = low.indexOf('</' + tag + '>', best);
    if (close < 0) { next.set(tag, -1); continue; } // no closer anywhere after: no later opener of this tag can match either
    out += raw.slice(pos, best);
    pos = close + tag.length + 3;
  }
  return out + raw.slice(pos);
}
/** Drops every "<…>" that holds at least one character; a "<" with no ">" after it stays, as does "<>". */
function stripTags(s) {
  let out = '', i = 0;
  for (;;) {
    const lt = s.indexOf('<', i);
    if (lt < 0) break;
    const gt = s.indexOf('>', lt + 1);
    if (gt < 0) break;
    if (gt === lt + 1) { out += s.slice(i, gt + 1); i = gt + 1; continue; }
    out += s.slice(i, lt); i = gt + 1;
  }
  return out + s.slice(i);
}

/** Text of an SVG or HTML work (`kind` 'svg' or 'html'), without tags, scripts and styles. */
export function markupText(raw, kind) {
  // The data layer (a <metadata> block with a CDATA source that can itself contain "<text"/"</text>") sits before the
  // artwork; strip it first so the image-layer extraction anchors on the real <text>, not on CDATA content.
  if (kind === 'svg') raw = stripDataLayer(raw);
  const end = raw.lastIndexOf('</text>');
  const body = kind === 'svg'
    ? raw.slice(Math.max(0, raw.indexOf('<text')), end < 0 ? raw.length : end)
    : stripSections(raw);
  return decodeEntities(stripTags(body));
}

/**
 * Text of PDF pages from pdf.js text items ({str, hasEOL, transform}[] per page). pdf.js drops some line breaks
 * that MuPDF reports as whitespace; an item that starts on a new line therefore gets one.
 */
export function pdfItemsText(pages) {
  let out = '';
  for (const items of pages) {
    let y = null;
    for (const it of items) {
      const iy = it.transform[5], h = Math.abs(it.transform[3]) || 1;
      if (y !== null && Math.abs(iy - y) > h * 0.5 && !/\s$/.test(out)) out += '\n';
      out += it.str;
      if (it.hasEOL) out += '\n';
      if (it.str) y = iy;
    }
    out += '\n';
  }
  return out;
}

/** Browser: the public text of a work file (File or Blob with a name): .pdf, .svg, .html/.htm, .txt/.md. */
export async function readWorkFile(file) {
  const ext = (file.name || '').toLowerCase().split('.').pop();
  if (ext === 'pdf' || file.type === 'application/pdf') {
    const pdfjs = await import(PDFJS + 'pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs';
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), disableFontFace: true }).promise;
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) pages.push((await (await doc.getPage(p)).getTextContent()).items);
    return pdfItemsText(pages);
  }
  const raw = await file.text();
  if (ext === 'svg') return markupText(raw, 'svg');
  if (ext === 'html' || ext === 'htm') return markupText(raw, 'html');
  return raw;
}
