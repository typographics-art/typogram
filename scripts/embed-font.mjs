// Make a Typogram SVG self-contained: replace the `@import` of the web font with the actual font, subsetted to the characters
// the artwork uses, embedded as a data: URI in an inline @font-face. Then the picture renders identically everywhere — offline,
// in a sandboxed renderer, in a mail client, under a strict Content-Security-Policy — with no network fetch. That is what the
// format promises: one independent file. The image layer uses Roboto Flex only; the subset keeps the variable axes
// (opsz/wght/wdth) so the per-glyph weight and width still apply. Build-time only (needs pyftsubset + brotli, see FONT_SUBSET_BIN).
//
// CLI: node scripts/embed-font.mjs <in.svg> [<out.svg>]   (out defaults to in-place)
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { markupText } from '../src/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FONTS = join(ROOT, 'assets', 'fonts');
// pyftsubset from a venv with fonttools + brotli (woff2). Override with FONT_SUBSET_BIN.
const PYFTSUBSET = process.env.FONT_SUBSET_BIN || join(process.env.HOME || '', '.cache', 'tg-fontenv', 'bin', 'pyftsubset');

/** Roboto Flex @font-face entries from fonts.css: { file, range, weight }. The image layer uses this family only. */
function robotoFaces() {
  const css = readFileSync(join(FONTS, 'fonts.css'), 'utf8');
  const faces = [];
  for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = m[1];
    if (!/font-family:\s*['"]Roboto Flex['"]/.test(body)) continue;
    const file = (/src:\s*url\(([^)]+)\)/.exec(body) || [])[1];
    if (!file) continue;
    faces.push({
      file: file.trim().replace(/['"]/g, ''),
      range: (/unicode-range:\s*([^;]+);/.exec(body) || [])[1]?.trim() || null,
      weight: (/font-weight:\s*([^;]+);/.exec(body) || [])[1]?.trim() || '100 1000',
    });
  }
  return faces;
}

/** Does any of the code points fall inside a CSS `unicode-range` like "U+0000-00FF,U+0131,U+0152-0153"? No range → matches all. */
function rangeMatches(range, cps) {
  if (!range) return true;
  const spans = range.split(',').map((s) => {
    const t = s.trim().replace(/^U\+/i, '');
    const [a, b] = t.split('-');
    return [parseInt(a, 16), parseInt(b ?? a, 16)];
  });
  return cps.some((cp) => spans.some(([a, b]) => cp >= a && cp <= b));
}

/**
 * Replace the @import web-font reference in a Typogram SVG with inline @font-face rules carrying the font subsetted to the
 * artwork's own characters, as data: URIs. Returns the self-contained SVG. If subsetting is unavailable or nothing matches,
 * returns the input unchanged (callers may check with `isSelfContained`).
 */
export function embedFontInSvg(svgText) {
  if (typeof svgText !== 'string' || !/<style>@import url\(/.test(svgText)) return svgText;
  if (!existsSync(PYFTSUBSET)) { console.warn(`embed-font: ${PYFTSUBSET} not found — leaving @import (NOT self-contained). Set FONT_SUBSET_BIN or create the font venv.`); return svgText; }
  const text = markupText(svgText, 'svg');
  if (!text) return svgText;
  const cps = [...new Set([...text].map((c) => c.codePointAt(0)))].sort((a, b) => a - b);
  const tmp = mkdtempSync(join(tmpdir(), 'tg-font-'));
  try {
    const textFile = join(tmp, 'text.txt');
    writeFileSync(textFile, text);
    const rules = [];
    for (const face of robotoFaces()) {
      if (!/roboto-flex/i.test(face.file) || !rangeMatches(face.range, cps)) continue;
      const out = join(tmp, face.file.replace(/\.woff2$/, '-sub.woff2'));
      try {
        execFileSync(PYFTSUBSET, [join(FONTS, face.file), `--text-file=${textFile}`, `--output-file=${out}`, '--flavor=woff2'], { stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 1 << 27 });
      } catch (e) { throw new Error(`pyftsubset failed for ${face.file} (is ${PYFTSUBSET} present, with brotli?): ${String(e.message).split('\n')[0]}`); }
      const b64 = readFileSync(out).toString('base64');
      rules.push(`@font-face{font-family:'Roboto Flex';font-style:normal;font-weight:${face.weight};${face.range ? `unicode-range:${face.range};` : ''}src:url(data:font/woff2;base64,${b64}) format('woff2')}`);
    }
    if (!rules.length) return svgText;
    return svgText.replace(/<style>@import url\('[^']*'\);<\/style>/, `<style>${rules.join('')}</style>`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/** True if the SVG has no external font reference left (no @import, no http(s) url in a <style>). */
export function isSelfContained(svgText) {
  return typeof svgText === 'string' && !/@import url\(/.test(svgText) && !/<style>[^<]*url\(https?:/.test(svgText);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [inFile, outFile] = process.argv.slice(2);
  if (!inFile) { console.error('usage: node scripts/embed-font.mjs <in.svg> [<out.svg>]'); process.exit(1); }
  const before = readFileSync(inFile, 'utf8');
  const after = embedFontInSvg(before);
  if (after === before && !isSelfContained(before)) { console.error(`embed-font: nothing embedded in ${inFile}`); process.exit(1); }
  writeFileSync(outFile || inFile, after);
  console.log(`embed-font: ${inFile}${outFile ? ` -> ${outFile}` : ''} (${before.length} -> ${after.length} bytes, self-contained: ${isSelfContained(after)})`);
}
