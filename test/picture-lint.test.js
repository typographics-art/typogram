// Visual-lie guard (docs/verification.md §6): the identity hash and signature cover the TEXT, so a signed work whose text is
// intact but whose PAINT was changed must not verify. Each case edits only the picture layer of a signed fixture — the text
// (and so the hash and the signature) stays byte-identical, which is exactly what a text-only check cannot see.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pictureLayerProblems } from '../src/picture-lint.js';
import { verifyTypogram } from '../src/verify-web.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SIGNED = readFileSync(join(ROOT, 'test', 'fixtures', 'bundle', '01-overview.svg'), 'utf8');
const keyfile = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'bundle-keys', 'test.example.json'), 'utf8'));
const verify = (svg) => verifyTypogram(svg, { fetchKeyfile: async () => keyfile });
const end = (svg, add) => svg.slice(0, svg.lastIndexOf('</svg>')) + add + '</svg>';
const bgOf = (svg) => /<rect[^>]*fill="(rgb\([^"]*\))"/.exec(svg)[1];

test('the untouched signed fixture has a clean picture layer and still verifies', async () => {
  assert.deepEqual(pictureLayerProblems(SIGNED), []);
  assert.equal((await verify(SIGNED)).state, 'VERIFIED');
});

test('every SVG this repo generates has a clean picture layer (no false alarms)', () => {
  const dirs = readdirSync(join(ROOT, 'examples'), { withFileTypes: true }).filter((d) => d.isDirectory());
  let n = 0;
  for (const d of dirs) {
    let svg; try { svg = readFileSync(join(ROOT, 'examples', d.name, 'onepage.svg'), 'utf8'); } catch { continue; }
    assert.deepEqual(pictureLayerProblems(svg), [], d.name); n++;
  }
  assert.ok(n >= 3, `checked ${n} one-pagers`);
});

const CASES = {
  'a white rectangle painted over the words': (s) => end(s, '<rect x="0" y="0" width="100%" height="100%" fill="#fff"/>'),
  'words drawn as paths over the text': (s) => end(s, '<path d="M40 40h600v60H40z" fill="#000"/>'),
  'an image laid over the picture': (s) => end(s, '<image href="data:image/png;base64,AAAA" width="100%" height="100%"/>'),
  'a foreignObject with other words': (s) => end(s, '<foreignObject width="100%" height="100%"><p>void</p></foreignObject>'),
  'the whole picture faded out (root style)': (s) => s.replace('<svg ', '<svg style="opacity:0" '),
  'the glyphs hidden by a stylesheet rule': (s) => s.replace('<style>', '<style>text{fill-opacity:0}'),
  'the text block faded (style)': (s) => s.replace(/<text ([^>]*?)style="/, '<text $1style="opacity:0;'),
  'the font size set to zero': (s) => s.replace(/(<text [^>]*?)font-size="[^"]*"/, '$1font-size="0"'),
  'one glyph faded with its own style': (s) => s.replace('<tspan ', '<tspan style="opacity:0" '),
  'a glyph moved with a transform': (s) => s.replace('<tspan ', '<tspan transform="translate(900,0)" '),
  'a glyph moved off the page': (s) => s.replace(/<tspan x="[^"]*"/, '<tspan x="-9999"'),
  'a <style> with attributes that restyles the glyphs': (s) => end(s, '<style type="text/css">text,tspan{opacity:0}</style>'),
  'a nested <svg> with its own opacity': (s) => end(s, '<svg opacity="0"><rect width="100%" height="100%"/></svg>'),
  'a glyph with fill none': (s) => s.replace(/<tspan x=/, '<tspan fill="none" x='),
  'a glyph with fill transparent': (s) => s.replace(/<tspan x=/, '<tspan fill="transparent" x='),
  'a glyph with fill rgba (transparent)': (s) => s.replace(/<tspan x=/, '<tspan fill="rgba(1,2,3,0)" x='),
  'a position list that moves later glyphs': (s) => s.replace(/<tspan x="([^"]*)"/, '<tspan x="$1 -5000 -5000"'),
  'the text colour equal to the background': (s) => s.replace(/(<text [^>]*?)fill="[^"]*"/, `$1fill="${bgOf(s)}"`),
  'a comment hiding a cover from a naive data-layer strip': (s) => '<!-- <metadata> -->'.length && s.replace(/<metadata>/, '<!-- <metadata> --><rect width="100%" height="100%" fill="#fff"/><metadata>'),
  'a ">" inside an attribute value hiding a later attribute': (s) => s.replace(/(<text [^>]*?)font-family="/, '$1font-family="a>b" opacity="0" data-x="'),
  'a DOCTYPE with an entity': (s) => '<!DOCTYPE svg [<!ENTITY a "b">]>' + s,
  'an entity-encoded semicolon hiding a declaration in a style': (s) => s.replace(/(<text [^>]*?style=")/, '$1font-kerning:none&#59;opacity:0&#59;font-variant-ligatures:'),
  'an entity-encoded fill value': (s) => s.replace(/<tspan x=/, '<tspan fill="rgb(1,2,3&#41;" x='),
  'a CDATA closed early so a shape sits in the data layer block': (s) => s.replace(']]></tgart:source>', ']]><rect width="100%" height="100%" fill="#fff"/><![CDATA[]]></tgart:source>'),
  'a missing viewBox (positions unmeasurable)': (s) => s.replace(/ viewBox="[^"]*"/, ''),
  'a glyph recoloured to the background': (s) => s.replace(/<tspan x="([^"]*)" y="([^"]*)"/, `<tspan fill="${bgOf(s)}" x="$1" y="$2"`),
  'a fake signed seal that is really a cover': (s) => end(s, '<g id="tgart-signed-seal"><rect width="100%" height="100%" fill="#fff"/></g>'),
};
for (const [name, tamper] of Object.entries(CASES)) {
  test(`visual lie caught: ${name}`, async () => {
    const lie = tamper(SIGNED);
    assert.notEqual(lie, SIGNED, 'the case must change the file');
    assert.ok(pictureLayerProblems(lie).length > 0, 'lint flags it');
    const r = await verify(lie);
    assert.equal(r.state, 'TAMPERED', JSON.stringify(r));
  });
}
