import { test } from 'node:test';
import assert from 'node:assert/strict';
import { structuredText, sha256Hex, canonicalText } from '../src/index.js';

test('structure: markdown headings make nested sections with slug IDs', () => {
  const { sections, headings } = structuredText('# Title\n\nIntro line.\n\n## Scope\n\nOne.\n\nTwo.\n');
  assert.equal(headings, 2);
  assert.deepEqual(sections.map((s) => s.id), ['title', 'scope']);
  assert.deepEqual(sections.map((s) => s.level), [1, 2]);
  const scope = sections.find((s) => s.id === 'scope');
  assert.deepEqual(scope.paragraphs, ['One.', 'Two.']);
});

test('structure: duplicate headings get unique IDs', () => {
  const { sections } = structuredText('## Notes\n\na\n\n## Notes\n\nb\n');
  assert.deepEqual(sections.map((s) => s.id), ['notes', 'notes-2']);
});

test('structure: chapters, articles and all-caps lines are detected, prose is not', () => {
  const { sections } = structuredText('CHAPTER 1. Loomings.\n\nCall me Ishmael.\n\nArt. 5 Rule of law\n\nThe Confederation shall respect law. This is a long ordinary sentence, not a heading.');
  const titles = sections.filter((s) => s.title).map((s) => s.title);
  assert.ok(titles.includes('CHAPTER 1. Loomings.'));
  assert.ok(titles.some((t) => t.startsWith('Art. 5')));
  assert.ok(!titles.some((t) => t.includes('ordinary sentence')));
});

test('structure: paragraphs collapse internal whitespace but stay separate', () => {
  const { sections, paragraphs } = structuredText('a\nb\n\nc   d\n');
  assert.equal(paragraphs, 2);
  assert.deepEqual(sections[0].paragraphs, ['a b', 'c d']);
});

test('sha256Hex is stable and matches canonical text across equivalent inputs', async () => {
  const a = await sha256Hex(canonicalText('Hello,  world.\n\nSecond.'));
  const b = await sha256Hex(canonicalText('Hello, world. Second.'));
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});
