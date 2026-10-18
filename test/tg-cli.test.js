// The `tg` CLI (cli/tg.mjs) and the Python reference (tools/tg_extract.py): verify proves the picture, the embedded source and
// the stored hash carry one text; extract reads the data layer (or the glyphs). Covers the canonical normalisation + hash,
// a positive verify, a tampered data layer, a tampered image layer, the title lint, and JS/Python parity. Deterministic —
// fixtures are built with the library, no browser. (PDF is covered by the adapter/onepage paths; this file stays browserless.)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { typesetWith, toSvg, toStandaloneHtml, canonicalText, sha256Hex, buildJsonld } from '../src/index.js';
import { fakeMetric, image, TEXT } from './helpers.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'cli', 'tg.mjs');
const PY = join(ROOT, 'tools', 'tg_extract.py');
const dir = mkdtempSync(join(tmpdir(), 'tg-cli-test-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const run = (cmd, ...args) => spawnSync('node', [CLI, cmd, ...args], { encoding: 'utf8' });
const py = (cmd, ...args) => spawnSync('python3', ['-I', PY, cmd, ...args], { encoding: 'utf8' });
const hasPython = () => spawnSync('python3', ['--version']).status === 0;

const MD = '# A Picture\n\n' + TEXT + '\n\n- one\n- two\n';
let hash, svgFile, htmlFile;

before(async () => {
  const sheet = typesetWith({ text: canonicalText(MD), metric: fakeMetric, image: image(40, 40, () => [128, 128, 128]), options: { width: 400 } });
  hash = await sha256Hex(canonicalText(MD));
  const jsonld = buildJsonld({ name: 'A Picture', author: 'd0n', license: 'MIT', sourceFormat: 'text/markdown', charCount: MD.length, hash });
  svgFile = join(dir, 'fix.svg');
  htmlFile = join(dir, 'fix.html');
  writeFileSync(svgFile, toSvg(sheet, { description: 'A Picture', markdown: MD, media: 'text/markdown', jsonld }));
  writeFileSync(htmlFile, toStandaloneHtml(sheet, { description: 'A Picture', markdown: MD, jsonld }));
});

test('canonical: normalisation collapses whitespace, strips invisibles, trims; hash is stable', async () => {
  assert.equal(canonicalText('  a\t b\n\nc  '), 'a b c');
  assert.equal(canonicalText('x­y​z'), 'xyz'); // soft hyphen and zero-width space removed
  assert.equal(await sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('tg verify: a good SVG and HTML pass, and share one hash', () => {
  for (const f of [svgFile, htmlFile]) {
    const r = run('verify', f);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /OK/);
    assert.match(r.stdout, new RegExp(hash));
  }
});

test('tg extract: reads the data layer (markdown / json / text) and the glyphs', () => {
  assert.match(run('extract', svgFile, '--markdown').stdout, /^# A Picture/);
  const j = JSON.parse(run('extract', svgFile, '--json').stdout);
  assert.equal(j.tgart.hash, hash);
  assert.equal(j.name, 'A Picture');
  assert.ok(!run('extract', svgFile, '--text').stdout.startsWith('#'), '--text strips the heading marker');
  assert.match(run('extract', htmlFile, '--markdown').stdout, /- one/);
  assert.match(run('extract', svgFile, '--from-glyphs', '--text').stdout, /A Picture Shall I compare/);
  assert.equal(run('extract', svgFile, '--json', '--from-glyphs').status, 1, 'no JSON-LD in the glyphs');
});

test('tg verify: a tampered data layer (wrong stored hash) fails', () => {
  const bad = join(dir, 'bad-data.svg');
  writeFileSync(bad, readFileSync(svgFile, 'utf8').replace(/"hash":"[0-9a-f]+"/, '"hash":"0000000000000000000000000000000000000000000000000000000000000000"'));
  const r = run('verify', bad);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /stored hash/);
});

test('tg verify: a tampered image layer (one changed glyph) fails and locates the divergence', () => {
  const bad = join(dir, 'bad-image.svg');
  const svg = readFileSync(svgFile, 'utf8').replace(/(<tspan[^>]*>)([A-Za-z])/, (m, a, c) => a + (c === 'z' ? 'y' : 'z'));
  writeFileSync(bad, svg);
  const r = run('verify', bad);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /first differ at character/);
});

test('tg verify: a visible title that contradicts the data layer heading fails the lint', async () => {
  const sheet = typesetWith({ text: canonicalText(MD), metric: fakeMetric, image: image(40, 40, () => [128, 128, 128]), options: { width: 400 } });
  const jsonld = buildJsonld({ name: 'A Picture', sourceFormat: 'text/markdown', charCount: MD.length, hash });
  const bad = join(dir, 'bad-title.svg');
  writeFileSync(bad, toSvg(sheet, { description: 'Something Else Entirely', markdown: MD, media: 'text/markdown', jsonld }));
  const r = run('verify', bad);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /visible title/);
});

test('tg_extract.py: the Python reference agrees with the JS tool (same hash, byte-identical source)', { skip: hasPython() ? false : 'python3 not available' }, () => {
  const v = py('verify', svgFile);
  assert.equal(v.status, 0, v.stderr);
  assert.match(v.stdout, new RegExp(hash));
  assert.equal(py('extract', svgFile, '--markdown').stdout, run('extract', svgFile, '--markdown').stdout, 'markdown byte-identical');
  assert.equal(py('verify', htmlFile).status, 0);
});
