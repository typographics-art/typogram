// The public text of a finished work file, read the way a machine reads it: for hidden messages, whose key fits
// exactly this text (src/secret.js). SVG and HTML: the text without markup. PDF: pdf.js in the browser
// (readWorkFile), MuPDF in the CLI; both give the same canonical text (measured on all 31 example PDFs).

const PDFJS = new URL('../assets/vendor/pdfjs/', import.meta.url).href; // pdf.js 4.4.168, Apache-2.0, hosted with the project

const ENTITIES = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
const decodeEntities = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|quot|apos|amp);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e.toLowerCase()]);

/** Text of an SVG or HTML work (`kind` 'svg' or 'html'), without tags, scripts and styles. */
export function markupText(raw, kind) {
  const end = raw.lastIndexOf('</text>');
  const body = kind === 'svg'
    ? raw.slice(Math.max(0, raw.indexOf('<text')), end < 0 ? raw.length : end)
    : raw.replace(/<(script|style|title|head)\b[\s\S]*?<\/\1>/gi, '');
  return decodeEntities(body.replace(/<[^>]+>/g, ''));
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
