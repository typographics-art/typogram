// One-pagers: the complete text of a document (often many PDF pages) on a single page. The letters
// are tiny and together form the document's title in large type: people see what the page is,
// machines read the whole text from the PDF's text layer.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { normalizeText } from '../src/index.js';

export const PAPERS_MM = { a4: [210, 297], a3: [297, 420], a2: [420, 594], letter: [215.9, 279.4] };
// Invisible format characters (soft hyphens, direction marks, zero-width joiners …) are not carried into
// PDF text layers; the check compares visible characters and reports exact equality separately.
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/gu;
const visible = (t) => t.replace(INVISIBLE, '').replace(/\s/g, '');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const has = (cmd) => spawnSync('which', [cmd]).status === 0;

/** Text of a document: PDFs through MuPDF (exact with the text layer), everything else read as UTF-8. */
export function readDocument(path) {
  if (extname(path).toLowerCase() !== '.pdf') return { text: readFileSync(path, 'utf8'), pages: null, extractor: 'utf-8' };
  if (!has('mutool')) throw new Error('Reading PDFs needs MuPDF (mutool). Install it, e.g. apt install mupdf-tools / brew install mupdf.');
  const text = spawnSync('mutool', ['draw', '-q', '-F', 'txt', '-o', '-', path], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout;
  const info = spawnSync('mutool', ['info', path], { encoding: 'utf8' }).stdout;
  const pages = Number((info.match(/^Pages:\s*(\d+)/m) || [])[1]) || null;
  return { text, pages, extractor: 'mutool draw -F txt' };
}

/**
 * Sets `text` on one page and writes the outputs.
 * @param {object} session  from openSession()
 * @param {object} job  { text, title, subtitle, paper:'a4'|…, options, pdf, preview, previewWidth }
 */
export async function makeOnePage(session, job) {
  const [pw, ph] = PAPERS_MM[job.paper || 'a4'];
  const source = normalizeText(job.text);
  const margin = 0.03;
  // Enough layout pixels for about 26 px² per character, so that lines stay above 3 px even for long texts.
  const outW = Math.max(1800, Math.min(9000, Math.round(Math.sqrt((source.length * 26 * pw) / ph))));
  const width = Math.round(outW / (1 + 2 * margin)), pad = Math.round(width * margin);
  const options = {
    font: 'roboto', legibility: 'free', color: 'gray', paper: 'light', unit: 'char', contrast: 2.6, brightness: 0,
    edges: 0.4, lineSpacing: 1.0, stretch: true, shape: true, margin, ...job.options,
    width, aspect: ((ph / pw) * (width + 2 * pad) - 2 * pad) / width,
  };
  const info = await session.call('tgOnePage', { text: source, title: job.title, subtitle: job.subtitle || '', options });
  if (!info.faithful) throw new Error('Layout does not preserve the text');
  const mmPerPx = pw / info.width;

  if (job.pdf) await session.printPoster(job.pdf, { lines: info.lines, characters: info.characters, mmPerPx });
  if (job.preview) {
    // Render at twice the layout scale: at ~9 px per glyph the browser draws hairlines darker than their ink.
    await session.call('tgBase', Math.min(2, 6000 / info.width));
    const data = await session.call('tgBaseImage', job.previewWidth || 1200, 0.86);
    writeFileSync(job.preview, Buffer.from(data.split(',')[1], 'base64'));
  }

  // Read the page back exactly as a machine would and compare with the source.
  let check = null;
  if (job.pdf && has('mutool')) {
    const back = normalizeText(spawnSync('mutool', ['draw', '-q', '-F', 'txt', '-o', '-', job.pdf], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout);
    const pages = Number((spawnSync('mutool', ['info', job.pdf], { encoding: 'utf8' }).stdout.match(/^Pages:\s*(\d+)/m) || [])[1]);
    check = {
      extractor: 'mutool draw -F txt', pages, exact: back === source, visibleIdentical: visible(back) === visible(source),
      visibleCharacters: visible(source).length, sha256Source: sha(source), sha256ReadBack: sha(back),
    };
  }
  return {
    characters: source.length, words: source.split(' ').length, lines: info.lines, paper: job.paper || 'a4',
    fontSizeMm: +(info.fontSize * mmPerPx).toFixed(3), overflow: info.overflow, toneFidelity: +info.toneFidelity.toFixed(3),
    layoutMs: info.ms, check,
  };
}
