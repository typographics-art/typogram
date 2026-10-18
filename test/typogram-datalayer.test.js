// The Typogram data layer (requirement A/B/C): raw Markdown in CDATA + a JSON-LD record, placed before the artwork <text>.
// It must survive adversarial content (<text>, </metadata>, ]]>, </tgart:source>, </script>) without disturbing the image
// layer, and round-trip byte-for-byte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDataLayer, readDataMarkdown, readJsonld, stripDataLayer, buildJsonld } from '../src/typogram.js';

const HOSTILE = '# Title\n\nSome <text> and </metadata> and ]]> and </tgart:source> and </script> and <svg>\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- one\n- two\n\n```js\nconst x = 1;\n  indented();\n```\n';
const svgOf = (meta) => `<svg xmlns="http://www.w3.org/2000/svg">${meta}<title>Title</title><desc>note</desc><text id="art">Title Some text ...</text></svg>`;

test('data layer: raw Markdown round-trips byte-for-byte through CDATA, with adversarial content', () => {
  const svg = svgOf(buildDataLayer({ markdown: HOSTILE, jsonld: buildJsonld({ name: 'Title' }) }));
  const r = readDataMarkdown(svg);
  assert.equal(r.media, 'text/markdown');
  assert.equal(r.markdown, HOSTILE, 'the source is byte-identical');
});

test('data layer: JSON-LD round-trips and never breaks out of the script (no literal < in markup)', () => {
  const ld = buildJsonld({ name: 'T', author: 'd0n', dateCreated: '2026-10-18', inLanguage: 'en', license: 'MIT', description: 'a <picture> & more', sourceUrl: 'https://x', charCount: 12, hash: 'deadbeef' });
  const meta = buildDataLayer({ markdown: 'x', jsonld: ld });
  const scriptBody = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(meta)[1];
  assert.ok(!scriptBody.includes('<'), 'no raw < inside the JSON-LD script (all escaped as \\u003c)');
  assert.ok(scriptBody.includes('\\u003c'), 'the < in the description is escaped');
  const j = readJsonld(svgOf(meta));
  assert.equal(j['@type'], 'DigitalDocument');
  assert.equal(j.name, 'T'); assert.equal(j.license, 'MIT'); assert.equal(j.description, 'a <picture> & more');
  assert.equal(j.tgart.hash, 'deadbeef'); assert.equal(j.tgart.version, 1); assert.equal(j.tgart.generator, 'typogram');
});

test('data layer: stripDataLayer removes it CDATA-safely, leaving the artwork <text> as the first <text', () => {
  const svg = svgOf(buildDataLayer({ markdown: HOSTILE, jsonld: buildJsonld({ name: 'Title' }) }));
  const stripped = stripDataLayer(svg);
  assert.ok(!stripped.includes('tgart:source'), 'data layer gone');
  assert.ok(!stripped.includes('<metadata'), 'metadata element gone');
  assert.ok(stripped.includes('<text id="art">'), 'artwork kept');
  assert.equal(stripped.indexOf('<text'), stripped.indexOf('<text id="art">'), 'the first <text is the artwork, not one from the CDATA');
});

test('data layer: tolerant readers return null on absence or breakage', () => {
  assert.equal(readDataMarkdown('<svg><text>x</text></svg>'), null);
  assert.equal(readJsonld('<svg></svg>'), null);
  assert.equal(stripDataLayer('<svg><text>x</text></svg>').includes('<text>x'), true);
});
