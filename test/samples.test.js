// The generator's sample texts: every manifest entry points at a real file, and its recorded character set is
// exactly the one the hidden-message tool would find in that text (the app trusts it to suggest matching texts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalText, graphemes, hideSecret } from '../src/index.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'samples');
const manifest = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8'));

test('samples: manifest is not empty and ids are unique', () => {
  assert.ok(manifest.length >= 20);
  assert.equal(new Set(manifest.map((m) => m.id)).size, manifest.length);
});

for (const m of manifest) {
  test(`samples/${m.id}: file, rights and character set are consistent`, async () => {
    assert.ok(existsSync(join(DIR, `${m.id}.txt`)), 'text file exists');
    assert.ok(['works', 'laws', 'tech', 'ai'].includes(m.group), 'known group');
    assert.ok(m.title && m.source && m.licence, 'title, source and licence are stated');
    const text = readFileSync(join(DIR, `${m.id}.txt`), 'utf8');
    const canon = canonicalText(text);
    assert.equal(m.characters, canon.length, 'recorded length');
    assert.equal(m.has, [...new Set(graphemes(canon))].sort().join(''), 'recorded characters');
    // The promise behind "has": any message made only of those characters can be hidden in this text.
    const word = [...new Set(graphemes(canon))].filter((c) => /\p{L}/u.test(c)).slice(0, 12).join('');
    assert.match(await hideSecret(text, word), /^tg1\./);
  });
}
