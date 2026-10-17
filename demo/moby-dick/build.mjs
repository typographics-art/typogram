#!/usr/bin/env node
// Builds the Moby-Dick demonstrator: a 2 × 3 m poster in three panels, plus the proof that the
// whole book survives inside it.
//
//   node demo/moby-dick/build.mjs            # everything
//   node demo/moby-dick/build.mjs svg proof  # only some steps: svg pdf zoom ocr proof
//
// Large outputs go to demo/moby-dick/out/ (not in git): poster SVG, print PDF, zoom tiles.
// Small outputs stay next to this file and are committed: proof.json, proof.md, preview.jpg.
import { readFileSync, writeFileSync, mkdirSync, createWriteStream, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSession } from '../../cli/core.mjs';
import { normalizeText } from '../../src/index.js';

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT = join(DIR, 'out');
const steps = new Set(process.argv.slice(2).length ? process.argv.slice(2) : ['svg', 'pdf', 'zoom', 'lines', 'ocr', 'proof']);
const meta = JSON.parse(readFileSync(join(DIR, 'sections.json'), 'utf8'));
const sha = (s) => createHash('sha256').update(s).digest('hex');
const has = (cmd) => spawnSync('which', [cmd]).status === 0;
mkdirSync(OUT, { recursive: true });

// Physical format: 2000 × 3000 mm including a 2.5 % margin, at 0.5 mm per poster px.
const POSTER = { widthMm: 2000, heightMm: 3000, mmPerPx: 0.5, margin: 0.025 };
const outW = POSTER.widthMm / POSTER.mmPerPx;
const innerW = Math.round(outW / (1 + 2 * POSTER.margin));
const pad = Math.round(innerW * POSTER.margin);
const OPTIONS = {
  font: 'roboto', legibility: 'medium', color: 'photo', paper: 'light', unit: 'char',
  contrast: 1.9, edges: 0.8, lineSpacing: 1.0, width: innerW,
  aspect: (POSTER.heightMm / POSTER.mmPerPx - 2 * pad) / innerW,
};

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const session = await openSession();
let info;
try {
  log('setting the poster …');
  info = await session.call('tgPoster', {
    sourceUrl: '/demo/moby-dick/source.txt',
    sections: meta.parts.map((p) => ({ from: p.from, to: p.to, motif: p.motif, title: p.title })),
    options: OPTIONS, imageWidth: 1600,
  });
  log(`${info.characters} characters, ${info.lines} lines, font ${info.fontSize.toFixed(2)} px = ${(info.fontSize * POSTER.mmPerPx).toFixed(2)} mm, ` +
    `${info.width}×${info.height} px, layout ${info.ms} ms, faithful ${info.faithful}`);
  if (!info.faithful) throw new Error('Layout does not preserve the text');
  const lineCount = info.lines;

  if (steps.has('svg')) {
    log('writing SVG …');
    const file = createWriteStream(join(OUT, 'moby-dick.svg'));
    file.write(await session.call('tgSvg', 'head'));
    for (let i = 0; i < lineCount; i += 80) file.write(await session.call('tgSvg', 'lines', i, Math.min(lineCount, i + 80)));
    file.write(await session.call('tgSvg', 'tail'));
    await new Promise((r) => file.end(r));
  }

  if (steps.has('pdf')) {
    log('printing PDF strips …');
    const strips = 6, per = Math.ceil(lineCount / strips), files = [];
    mkdirSync(join(OUT, 'strips'), { recursive: true });
    for (let k = 0; k < strips; k++) {
      const from = k * per, to = Math.min(lineCount, from + per);
      const size = await session.call('tgPrintStrip', from, to, POSTER.mmPerPx);
      const f = join(OUT, 'strips', `strip-${k + 1}.pdf`);
      writeFileSync(f, await session.pdf(size.widthMm, size.heightMm));
      files.push(f);
      log(`  strip ${k + 1}/${strips}: ${size.widthMm.toFixed(0)} × ${size.heightMm.toFixed(0)} mm`);
    }
    if (has('pdfunite')) spawnSync('pdfunite', [...files, join(OUT, 'moby-dick-poster.pdf')]);
  }

  if (steps.has('zoom')) {
    log('building zoom tiles …');
    const MAX_SCALE = 2, TILE = 512;
    const fullW = Math.ceil(info.width * MAX_SCALE), fullH = Math.ceil(info.height * MAX_SCALE);
    const maxLevel = Math.ceil(Math.log2(Math.max(fullW, fullH)));
    const root = join(OUT, 'zoom'), files = join(root, 'moby-dick_files');
    rmSync(root, { recursive: true, force: true });
    const save = (level, c, r, dataUrl) => {
      mkdirSync(join(files, String(level)), { recursive: true });
      writeFileSync(join(files, String(level), `${c}_${r}.jpg`), Buffer.from(dataUrl.split(',')[1], 'base64'));
    };
    const dims = (level) => [Math.ceil(fullW / 2 ** (maxLevel - level)), Math.ceil(fullH / 2 ** (maxLevel - level))];
    let tiles = 0;
    for (const level of [maxLevel]) { // drawn from the glyphs
      const [w, h] = dims(level), scale = MAX_SCALE / 2 ** (maxLevel - level);
      for (let r = 0; r * TILE < h; r++) for (let c = 0; c * TILE < w; c++) {
        save(level, c, r, await session.call('tgTile', scale, c * TILE, r * TILE, Math.min(TILE, w - c * TILE), Math.min(TILE, h - r * TILE)));
        tiles++;
      }
    }
    // The rest by halving one rendering at scale 1 (glyphs ~6 px): smaller renderings lose ink to anti-aliasing.
    let [bw, bh] = await session.call('tgBase', MAX_SCALE / 2);
    writeFileSync(join(DIR, 'preview.jpg'), Buffer.from((await session.call('tgBaseImage', 1400)).split(',')[1], 'base64'));
    for (let level = maxLevel - 1; level >= 0; level--) {
      if (level < maxLevel - 1) [bw, bh] = await session.call('tgHalveBase');
      for (let r = 0; r * TILE < bh; r++) for (let c = 0; c * TILE < bw; c++) {
        save(level, c, r, await session.call('tgBaseTile', c * TILE, r * TILE, Math.min(TILE, bw - c * TILE), Math.min(TILE, bh - r * TILE)));
        tiles++;
      }
    }
    writeFileSync(join(root, 'moby-dick.dzi'), `<?xml version="1.0" encoding="UTF-8"?>\n<Image xmlns="http://schemas.microsoft.com/deepzoom/2008" Format="jpg" Overlap="0" TileSize="${TILE}"><Size Width="${fullW}" Height="${fullH}"/></Image>\n`);
    log(`  ${tiles} tiles, ${maxLevel + 1} levels, ${fullW}×${fullH} px at the deepest level`);
  }

  if (steps.has('lines')) { // where each line starts in the normalised text: lets the viewer show the text under the cursor
    const lengths = await session.call('tgLineLengths');
    writeFileSync(join(DIR, 'lines.json'), JSON.stringify({
      lineHeight: info.lineHeight, pad: info.pad, width: info.width, height: info.height, zoomScale: 2,
      sections: info.sections.map((s, i) => ({ title: s.title, firstLine: s.firstLine, lineCount: s.lineCount, motif: meta.parts[i].motif })),
      lengths,
    }) + '\n');
  }

  if (steps.has('ocr') && has('tesseract')) {
    log('OCR samples …');
    const samples = [], LINES = 16, PARTS = 8, SCALE = 4; // 4 px per poster px = 2 px per mm
    rmSync(join(OUT, 'ocr'), { recursive: true, force: true });
    mkdirSync(join(OUT, 'ocr'), { recursive: true });
    for (let k = 0; k < LINES; k++) {
      const line = Math.floor(((k + 0.5) / LINES) * lineCount);
      const segs = await session.call('tgLineSegments', line, PARTS, SCALE);
      for (const [j, sg] of segs.entries()) {
        const png = join(OUT, 'ocr', `line-${line}-${j + 1}.png`);
        writeFileSync(png, Buffer.from(sg.png.split(',')[1], 'base64'));
        const ocr = spawnSync('tesseract', [png, '-', '-l', 'eng', '--psm', '7'], { encoding: 'utf8' }).stdout;
        samples.push({ line, segment: j + 1, truth: normalizeText(sg.truth), ocr: normalizeText(ocr) });
      }
    }
    writeFileSync(join(OUT, 'ocr', 'samples.json'), JSON.stringify(samples, null, 2));
  }
} finally {
  await session.close();
}

if (steps.has('proof')) {
  log('proving …');
  const sourceRaw = readFileSync(join(DIR, 'source.txt'), 'utf8');
  const source = normalizeText(sourceRaw);
  const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const svg = readFileSync(join(OUT, 'moby-dick.svg'), 'utf8');
  const fromSvg = normalizeText(unescape(svg.slice(svg.indexOf('<text'), svg.lastIndexOf('</text>')).replace(/<[^>]+>/g, '')));
  const pdfFile = join(OUT, 'moby-dick-poster.pdf');
  const extract = (cmd, args) => normalizeText(spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout);
  const fromPdf = existsSync(pdfFile) && has('mutool') ? extract('mutool', ['draw', '-q', '-F', 'txt', '-o', '-', pdfFile]) : null;
  const fromPoppler = existsSync(pdfFile) && has('pdftotext') ? extract('pdftotext', ['-raw', pdfFile, '-']) : null;
  // Invisible direction marks (the source has two, around one Hebrew word) are not carried into PDF text layers.
  const BIDI = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
  const visible = (t) => t.replace(BIDI, '').replace(/\s/g, '');

  // Defined tests on the text read back from the artwork (what an AI system would ingest).
  const tests = [];
  const add = (id, name, pass, detail) => tests.push({ id, name, pass, detail });
  add('T1', 'Full text from the SVG equals the source (SHA-256)', sha(fromSvg) === sha(source), { source: sha(source), extracted: sha(fromSvg), characters: fromSvg.length });
  if (fromPdf !== null) {
    add('T2', 'Every visible character of the print PDF equals the source (MuPDF)', visible(fromPdf) === visible(source), {
      extractor: 'mutool draw -F txt', visibleCharacters: visible(fromPdf).length, exact: fromPdf === source,
      bidiMarksInSource: (source.match(BIDI) || []).length, characters: fromPdf.length,
    });
  }
  let poppler = null;
  if (fromPoppler !== null) {
    const srcWords = source.split(' '), seen = new Set(srcWords), w = fromPoppler.split(' ');
    poppler = { exact: fromPoppler === source, characters: fromPoppler.length, wordsInSource: w.filter((x) => seen.has(x)).length / w.length };
  }
  let seed = 2701;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let found = 0;
  const N = 100;
  for (let k = 0; k < N; k++) { const at = Math.floor(rnd() * (source.length - 200)); if (fromSvg.indexOf(source.slice(at, at + 160), at) === at) found++; }
  add('T3', `${N} random 160-character passages are found at their original position`, found === N, { found, of: N });
  const heads = (t) => [...t.matchAll(/CHAPTER (\d+)\./g)].map((m) => Number(m[1]));
  const hs = heads(source), he = heads(fromSvg);
  add('T4', 'Chapter structure intact (table of contents and 135 chapters, in order)', JSON.stringify(hs) === JSON.stringify(he), { headings: he.length });
  add('T5', 'Opening and closing of the book intact', fromSvg.includes('Call me Ishmael.') && fromSvg.endsWith('only found another orphan.'), {});
  const freq = (t) => { const m = new Map(); for (const w of t.toLowerCase().match(/[a-z']+/g)) m.set(w, (m.get(w) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1]).slice(0, 25); };
  add('T6', 'Word frequencies (top 25) identical', JSON.stringify(freq(source)) === JSON.stringify(freq(fromSvg)), { top: freq(fromSvg).slice(0, 8).map(([w, c]) => `${w} ${c}`) });
  const qa = JSON.parse(readFileSync(join(DIR, 'ai-tests.json'), 'utf8'));
  const grounded = qa.filter((q) => fromSvg.includes(q.evidence));
  add('T7', 'Question set: every answer has its evidence in the extracted text', grounded.length === qa.length, { grounded: grounded.length, of: qa.length });

  let ocr = null;
  const ocrFile = join(OUT, 'ocr', 'samples.json');
  if (existsSync(ocrFile)) {
    const samples = JSON.parse(readFileSync(ocrFile, 'utf8'));
    let words = 0, hit = 0;
    for (const s of samples) { const a = s.truth.split(' '), b = s.ocr.split(' '); words += a.length; hit += lcsWords(a, b); }
    ocr = { lines: new Set(samples.map((s) => s.line)).size, segments: samples.length, words, recognised: hit, accuracy: hit / words, pxPerMm: 2 };
  }

  let vision = null; // a manual sample with a vision-language model, scored here against the same ground truth
  const visionFile = join(DIR, 'vision-sample.json');
  if (existsSync(visionFile) && existsSync(ocrFile)) {
    const v = JSON.parse(readFileSync(visionFile, 'utf8'));
    const bySeg = new Map(JSON.parse(readFileSync(ocrFile, 'utf8')).map((x) => [`${x.line}-${x.segment}`, x]));
    const words = (t) => t.replace(/’/g, "'").split(/\s+/).filter(Boolean);
    let total = 0, model = 0, tess = 0;
    for (const sg of v.segments) {
      const ref = bySeg.get(sg.id); if (!ref) continue;
      const a = words(ref.truth);
      total += a.length; model += lcsWords(a, words(sg.transcription)); tess += lcsWords(a, words(ref.ocr));
    }
    vision = { model: v.model, procedure: v.procedure, segments: v.segments.length, words: total, accuracy: model / total, tesseractOnSameSegments: tess / total };
  }

  const proof = {
    generated: new Date().toISOString(),
    source: meta.source,
    poster: { ...POSTER, options: OPTIONS, characters: info.characters, lines: info.lines, fontSizeMm: info.fontSize * POSTER.mmPerPx, toneFidelity: info.toneFidelity,
      sections: info.sections.map((s, i) => ({ ...s, motif: meta.parts[i].motif, firstChapter: meta.parts[i].firstChapter, heightMm: s.height * POSTER.mmPerPx })) },
    tests, ocr, poppler, vision,
  };
  writeFileSync(join(DIR, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
  writeFileSync(join(DIR, 'proof.md'), proofMarkdown(proof));
  for (const t of tests) log(`${t.pass ? 'PASS' : 'FAIL'} ${t.id} ${t.name}`);
  if (ocr) log(`OCR: ${(ocr.accuracy * 100).toFixed(1)} % of ${ocr.words} words in ${ocr.segments} segments of ${ocr.lines} lines`);
  if (tests.some((t) => !t.pass)) process.exitCode = 1;
}

/** Word-level longest common subsequence: how many words were recognised in the right order. */
function lcsWords(a, b) {
  const dp = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) { let prev = 0; for (let j = 1; j <= b.length; j++) { const t = dp[j]; dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]); prev = t; } }
  return dp[b.length];
}

function proofMarkdown(p) {
  const pct = (x) => `${(x * 100).toFixed(1)} %`;
  return `# Proof: Moby-Dick as Typographic Art

Generated ${p.generated.slice(0, 10)} by \`node demo/moby-dick/build.mjs\`. Every number here is computed by that script.

## Source

- ${p.source.title}, ${p.source.author}, ${p.source.year} (${p.source.status}), ${p.source.origin}: ${p.source.url}
- Download SHA-256: \`${p.source.rawSha256}\`
- Source text (\`source.txt\`, Gutenberg header and footer removed by \`prepare.mjs\`): ${p.source.characters.toLocaleString('en-US')} characters, ${p.source.chapters} chapters plus epilogue
- SHA-256 of \`source.txt\`: \`${p.source.sha256}\`

## Poster

- ${p.poster.widthMm / 1000} × ${p.poster.heightMm / 1000} m, ${p.poster.lines.toLocaleString('en-US')} lines, ${p.poster.characters.toLocaleString('en-US')} characters (whitespace normalised)
- Type size ${p.poster.fontSizeMm.toFixed(2)} mm (Roboto Flex, weights 100–1000, widths 75–125 %), colours from the motifs, tone fidelity ${p.poster.toneFidelity.toFixed(2)}

| Panel | Text | Motif | Height |
|---|---|---|---|
${p.poster.sections.map((s) => `| ${s.title} | from ${s.firstChapter}, ${s.characters.toLocaleString('en-US')} characters | ${s.motif} | ${(s.heightMm / 10).toFixed(0)} cm |`).join('\n')}

## Tests on the text read back from the artwork

| | Test | Result |
|---|---|---|
${p.tests.map((t) => `| ${t.id} | ${t.name} | ${t.pass ? '**pass**' : '**FAIL**'} |`).join('\n')}

T1 compares SHA-256 hashes: source \`${p.tests[0].detail.source}\`, extracted \`${p.tests[0].detail.extracted}\`.
T2 reads the print PDF with MuPDF and compares every visible character. The PDF text layer does not carry the two invisible right-to-left marks that surround the one Hebrew word in the etymology; that is the only difference${p.tests[1] && p.tests[1].detail.exact ? ' (here none at all)' : ''}.
${p.poppler ? `Poppler's \`pdftotext -raw\`, a common alternative, loses letters in light passages of this PDF (Chrome stores variable fonts as Type 3 fonts): ${pct(p.poppler.wordsInSource)} of its words are words of the source. The text is complete in the file, as MuPDF shows; extraction tools differ.
` : ''}
T7 uses the question set in \`ai-tests.json\`: questions about the book whose answers must be grounded in the extracted text, the precondition for any AI system to answer them from the artwork.
${p.ocr ? `
## Reading the picture alone

Classic OCR (Tesseract, English, single-line mode) on ${p.ocr.lines} lines spread over the whole poster, each cut at word boundaries into ${p.ocr.segments / p.ocr.lines} segments with their own ground truth, rendered at ${p.ocr.pxPerMm} px per mm (a photo of about 4 000 × 6 000 px per square metre): **${pct(p.ocr.accuracy)}** of ${p.ocr.words.toLocaleString('en-US')} words recognised in order. The poster mixes weights 200–1000, widths 75–125 % and sizes 60–100 % with light ink colours in bright areas; that is hard for an engine that only knows letter shapes.
${p.vision ? `
A vision-language model reads the same images far better. ${p.vision.model}, ${p.vision.segments} of the segments where Tesseract did worst (${p.vision.words} words): **${pct(p.vision.accuracy)}** read correctly, against ${pct(p.vision.tesseractOnSameSegments)} for Tesseract on the same segments. Method: ${p.vision.procedure} The transcriptions are in \`vision-sample.json\`; this is a small manual sample.
` : ''}
This channel matters only when nothing but a photo of the poster travels; the files themselves carry the text exactly (T1, T2).
` : ''}
## Reproduce

\`\`\`sh
curl -L -o pg2701.txt ${p.source.url}
node demo/moby-dick/prepare.mjs pg2701.txt   # must print sha256 ${p.source.sha256}
node demo/moby-dick/build.mjs
\`\`\`
`;
}
