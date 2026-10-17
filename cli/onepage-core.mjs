// One-pagers: the complete text of a document (often many PDF pages) on a single page. The letters
// are tiny and together form the document's title in large type: people see what the page is,
// machines read the whole text from the PDF's text layer.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { normalizeText } from '../src/index.js';
import { visibleText, TOOL_TIMEOUT_MS } from './core.mjs';

export const PAPERS_MM = { a4: [210, 297], a3: [297, 420], a2: [420, 594], letter: [215.9, 279.4] };
const sha = (s) => createHash('sha256').update(s).digest('hex');
const has = (cmd) => spawnSync('which', [cmd]).status === 0;

/** Text of a document: PDFs through MuPDF (exact with the text layer), everything else read as UTF-8. */
export function readDocument(path) {
  if (extname(path).toLowerCase() !== '.pdf') return { text: readFileSync(path, 'utf8'), pages: null, extractor: 'utf-8' };
  if (!has('mutool')) throw new Error('Reading PDFs needs MuPDF (mutool). Install it, e.g. apt install mupdf-tools / brew install mupdf.');
  const read = spawnSync('mutool', ['draw', '-q', '-F', 'txt', '-o', '-', path], { encoding: 'utf8', maxBuffer: 1 << 28, timeout: TOOL_TIMEOUT_MS });
  // A killed, failed or over-full run would otherwise return a truncated text without a word.
  if (read.error) throw new Error(`MuPDF could not read the document: ${read.error.code === 'ENOBUFS' ? 'its text is larger than 256 MB' : read.error.message}`);
  if (read.status !== 0) throw new Error(`MuPDF could not read the document: ${String(read.stderr || '').trim().split('\n')[0] || 'is it a PDF?'}`);
  const text = read.stdout;
  const info = spawnSync('mutool', ['info', path], { encoding: 'utf8', timeout: TOOL_TIMEOUT_MS }).stdout;
  const pages = Number((info.match(/^Pages:\s*(\d+)/m) || [])[1]) || null;
  return { text, pages, extractor: 'mutool draw -F txt' };
}

/**
 * Sets `text` on one page and writes the outputs.
 * @param {object} session  from openSession()
 * @param {object} job  { text, title, subtitle, paper:'a4'|…, options, pdf, preview, previewWidth }
 */
// Motif for the picture one-pager: an image file becomes a data URL; `recipe:<name>` (a drawing from
// gallery/recipes.js) is passed through.
export function motifSource(spec) {
  if (spec.startsWith('recipe:')) return spec;
  const type = { '.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png', '.webp': 'webp' }[extname(spec).toLowerCase()];
  if (!type) throw new Error(`Motif must be a JPEG, PNG or WebP image: ${spec}`);
  return `data:image/${type};base64,${readFileSync(spec).toString('base64')}`;
}

export async function makeOnePage(session, job) {
  const [pw, ph] = PAPERS_MM[job.paper || 'a4'];
  const source = normalizeText(job.text);
  const margin = 0.03;
  // Enough layout pixels for about 26 px² per character, so that lines stay above 3 px even for long texts.
  const outW = Math.max(1800, Math.min(9000, Math.round(Math.sqrt((source.length * 26 * pw) / ph))));
  const width = Math.round(outW / (1 + 2 * margin)), pad = Math.round(width * margin);
  const options = {
    font: 'roboto', legibility: 'free', color: 'gray', paper: 'light', unit: 'char', contrast: 2.6, brightness: 0,
    // One type size and no width variants (measured in docs/file-size.md): on a photo motif the page follows the
    // picture more closely (likeness 0.963 instead of 0.940) at a third of the size; title cards look the same.
    edges: 0.4, lineSpacing: 1.0, stretch: false, sizeCount: 1, shape: true, gaps: job.motif ? 'off' : 'auto', margin, colorStep: 24, ...job.options,
    width, aspect: ((ph / pw) * (width + 2 * pad) - 2 * pad) / width,
  };
  const info = await session.call('tgOnePage', { text: source, title: job.title, subtitle: job.subtitle || '', options, motif: job.motif || null });
  if (!info.faithful) throw new Error('Layout does not preserve the text');
  const mmPerPx = pw / info.width;

  let printed = null;
  if (job.pdf) printed = await session.printPoster(job.pdf, { lines: info.lines, characters: info.characters, mmPerPx, tagged: !!job.tagged });
  if (job.preview) {
    // Render at twice the layout scale: at ~9 px per glyph the browser draws hairlines darker than their ink.
    await session.call('tgBase', Math.min(2, 6000 / info.width));
    const data = await session.call('tgBaseImage', job.previewWidth || 1200, 0.86);
    writeFileSync(job.preview, Buffer.from(data.split(',')[1], 'base64'));
  }

  // Read the page back exactly as a machine would and compare with the source.
  let check = null;
  if (job.pdf && has('mutool')) {
    const back = normalizeText(spawnSync('mutool', ['draw', '-q', '-F', 'txt', '-o', '-', job.pdf], { encoding: 'utf8', maxBuffer: 1 << 28, timeout: TOOL_TIMEOUT_MS }).stdout || '');
    const pages = Number((spawnSync('mutool', ['info', job.pdf], { encoding: 'utf8', timeout: TOOL_TIMEOUT_MS }).stdout.match(/^Pages:\s*(\d+)/m) || [])[1]);
    check = {
      extractor: 'mutool draw -F txt', pages, exact: back === source, visibleIdentical: visibleText(back) === visibleText(source),
      visibleCharacters: visibleText(source).length, sha256Source: sha(source), sha256ReadBack: sha(back),
    };
  }
  return {
    characters: source.length, words: source.split(' ').length, lines: info.lines, paper: job.paper || 'a4',
    fontSizeMm: +(info.fontSize * mmPerPx).toFixed(3), overflow: info.overflow, toneFidelity: +info.toneFidelity.toFixed(3),
    layoutMs: info.ms, check,
    pdfBytes: printed ? printed.bytesAfter : null, pdfBytesUnoptimized: printed ? printed.bytesBefore : null,
    printStrips: printed ? printed.strips : null, reprints: printed ? printed.reprints : null, pdfStats: info.pdf,
  };
}
