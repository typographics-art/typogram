#!/usr/bin/env node
// Writes test/fixtures/conformance/vectors.json: the conformance suite of the TGD standard (docs/structured-data.md §Conformance).
// A decoder in any language passes if, for every vector, it returns the expected model (compare as JSON) or fails with the expected error code.
import { writeFileSync, mkdirSync } from 'node:fs';
import { seal, decode, TgdError } from '../src/structured.js';

const CREATED = '2026-01-01T00:00:00Z';
const wb = (rows, extra = {}) => ({ kind: 'workbook', sheets: [{ name: 'S', rows, ...extra }] });
const seed = (() => { let x = 99; return () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();

const cases = [
  ['minimal', 'The smallest useful block: one sheet, three cells.', wb([['a', 1, null]])],
  ['spaces-and-middle-dot', 'A space inside a string is a middle dot; a real middle dot is \\u00b7.', wb([['New York', 'l·l', ' lead and  double ']])],
  ['typed-cells', 'Number as exact decimal, date, datetime, time, error, formula with cached value, boolean.', wb([[{ $: 'n', v: '12345678901234567890' }, { $: 'n', v: '1.10' }, { $: 'd', v: '2024-03-05' }, { $: 'dt', v: '2024-03-05T14:30:00' }, { $: 't', v: '09:05:30' }, { $: 'e', v: '#DIV/0!' }, { $: 'f', f: 'SUM(A1:A2)', v: 3 }, true, false, 0.1, -7]])],
  ['unicode-and-escapes', 'Characters outside the safe set are \\u escapes: combining mark, zero width joiner, a CJK character, an emoji (measured safe, stays literal), a character outside the BMP that is escaped as a surrogate pair, a control character, a quote and a backslash.', wb([['é', 'a‍b', '日本', '😀', 'x\u0001y', 'say "hi"', 'back\\slash', 'line1\nline2\ttab']])],
  ['frame-markers-in-data', 'The frame markers inside a string are broken by an escape.', wb([['x]TGD1 and TGD1[ y']])],
  ['sparse-cells', 'The sparse layout: cells by address.', { kind: 'workbook', sheets: [{ name: 'Wide', cells: { A1: 'x', Z100: 'far', AA2: 2 }, merges: ['A1:B1'], comments: { A1: 'a note' } }] }],
  ['json-document', 'A JSON document: key order, a typed big number, the "$" key escape.', { kind: 'json', value: new Map([['b', 1], ['a', [{ $: 'n', v: '12345678901234567890' }, null, true]], ['$$', 'was the key $']]) }],
];

const vectors = [];
for (const [name, about, data] of cases) {
  const text = await seal(data, { format: name === 'json-document' ? 'json' : 'csv', name: `${name}.csv`, created: CREATED, by: 'tg-data/1.0' }, { layout: 'rows' });
  const block = await decode(text);
  vectors.push({ name, about, text, expect: { model: block.model, name: block.name, format: block.format, created: block.created } });
}
// The same block with whitespace noise: a decoder must give the same model.
const noisy = vectors[2].text.replace(/\s/g, '').split('').map((ch) => (seed() < 0.2 ? ch + ' ' : ch)).join('').replace(/^TGD1\[/, 'TGD1 [\n');
vectors.push({ name: 'whitespace-noise', about: 'The typed-cells block with spaces and line breaks inserted at random places (an extractor may do this).', text: noisy, expect: vectors[2].expect });
// Prose around a block; and two blocks.
vectors.push({ name: 'prose-around', about: 'A block inside prose: the decoder finds it.', text: `Intro text. ${vectors[0].text} Closing words.`, expect: vectors[0].expect });
// Damage.
const tampered = vectors[0].text.replace('"a"', '"b"');
vectors.push({ name: 'tampered', about: 'One changed character: the checksum fails.', text: tampered, expect: { error: 'checksum' } });
vectors.push({ name: 'unterminated', about: 'No closing marker.', text: vectors[0].text.slice(0, -5), expect: { error: 'unterminated' } });
vectors.push({ name: 'future-major', about: 'A block of another major version is refused.', text: 'TGD1[{"tgd":"2.0","sum":"' + '0'.repeat(64) + '","data":{"kind":"x"}}]TGD1', expect: { error: 'version' } });
vectors.push({ name: 'no-block', about: 'No block in the text.', text: 'Only prose here.', expect: { error: 'none' } });

mkdirSync(new URL('../test/fixtures/conformance/', import.meta.url), { recursive: true });
writeFileSync(new URL('../test/fixtures/conformance/vectors.json', import.meta.url), JSON.stringify({ standard: 'TGD', version: '1.0', note: 'text -> expect.model (compare as JSON) or expect.error (the code of the failure)', vectors }, null, 1) + '\n');
console.log(`${vectors.length} vectors`);
void TgdError;
