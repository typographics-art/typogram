// Corpus guard for the one-pager "three views": every published example must ship a source text that
// (1) is bound to its artwork by the recorded canonical checksum, and (2) yields citable structure —
// stable section slugs and locatable passages. This is the retrieval/citation guarantee as a test:
// what publish-sources.mjs verifies against the artwork PDFs, locked in here without needing Chrome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { structuredText, canonicalText, sha256Hex } from '../src/index.js';

const EX = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const index = JSON.parse(readFileSync(join(EX, 'index.json'), 'utf8'));
const withText = index.filter((e) => e.text && e.textSha256);

test('examples: published source texts exist and carry a bound checksum', () => {
  assert.ok(withText.length >= 1, 'at least one example publishes a source text');
});

for (const e of withText) {
  test(`examples/${e.id}: source text is checksum-bound and citable`, async () => {
    const raw = readFileSync(join(EX, e.id, e.text), 'utf8');

    // (1) Binding: the canonical checksum recorded in index.json (equal to the artwork read-back,
    // per scripts/publish-sources.mjs) must match the published source text character for character.
    assert.equal(await sha256Hex(canonicalText(raw)), e.textSha256, 'canonical checksum matches the record');
    assert.equal(e.textMatchesArt, true, 'recorded as matching the artwork');

    // (2) Citable structure: stable slug sections, and a sampled passage is locatable in the source.
    const st = structuredText(raw);
    assert.ok(st.headings >= 1, 'has at least one titled section');
    const titled = st.sections.filter((s) => s.title);
    for (const s of titled) assert.match(s.id, /^[a-z0-9][a-z0-9-]*$/, `stable slug id (${s.id})`);

    const sample = titled
      .flatMap((s) => s.paragraphs)
      .filter((p) => p.length >= 40)
      .sort((a, b) => b.length - a.length)[0];
    if (sample) assert.ok(canonicalText(raw).includes(canonicalText(sample)), 'a sampled passage is retrievable from the source');
  });
}
