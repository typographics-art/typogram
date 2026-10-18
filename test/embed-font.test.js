// Embedding the font makes a Typogram SVG self-contained (scripts/embed-font.mjs). Needs pyftsubset + brotli (a venv); where
// that is not available the test skips, like the browser tests. Run locally: node --test test/embed-font.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedFontInSvg, isSelfContained } from '../scripts/embed-font.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PYFTSUBSET = process.env.FONT_SUBSET_BIN || join(process.env.HOME || '', '.cache', 'tg-fontenv', 'bin', 'pyftsubset');
const GALLERY_SVG = join(HERE, '..', 'gallery', 'blue-marble.svg');

test('embed-font: replaces the @import web font with an inline, subsetted data-URI font (self-contained)', (t) => {
  if (!existsSync(PYFTSUBSET)) return t.skip('pyftsubset not found (set FONT_SUBSET_BIN or create the font venv)');
  if (!existsSync(GALLERY_SVG)) return t.skip('no gallery SVG to test with');
  const before = readFileSync(GALLERY_SVG, 'utf8');
  const after = embedFontInSvg(before);
  if (/@import url\(/.test(before)) {
    assert.ok(!/@import url\(/.test(after), 'the @import is gone');
    assert.match(after, /@font-face\{[^}]*src:url\(data:font\/woff2;base64,/, 'an inline data-URI woff2 @font-face is present');
    assert.ok(isSelfContained(after), 'no external font reference remains');
    assert.match(after, /unicode-range:/, 'the subset keeps its unicode-range');
    assert.ok(after.length > before.length, 'the embedded font adds bytes');
  } else {
    assert.ok(isSelfContained(before), 'already self-contained');
  }
});

test('embed-font: isSelfContained flags an external @import', () => {
  assert.equal(isSelfContained("<svg><style>@import url('https://x/fonts.css');</style></svg>"), false);
  assert.equal(isSelfContained('<svg><style>@font-face{src:url(data:font/woff2;base64,AAAA)}</style></svg>'), true);
});
