#!/usr/bin/env node
// Builds samples/: texts the generator offers as "sample text", with a manifest that records, for each text,
// exactly which characters it contains. That is what hidden messages need: a message can only be hidden in a
// text that has every one of its characters, so the app can say "this text has no y" and suggest texts that do.
//
// Sources (all rights stated in the manifest): the gallery's public-domain texts (gallery/works.config.json)
// and chosen texts of examples/ (laws and declarations, PEP 8, this project's own instructions).
// Run after changing either source: node scripts/build-samples.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalText, graphemes } from '../src/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'samples');
const json = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

// Small stop-word vote: enough to tell German, English, French and Italian apart for the label.
const STOP = {
  de: ['der', 'die', 'das', 'und', 'nicht', 'ist', 'ein', 'mit', 'zu', 'den', 'von', 'sich', 'auf'],
  en: ['the', 'and', 'of', 'to', 'in', 'that', 'is', 'was', 'for', 'with', 'as', 'his', 'which'],
  fr: ['le', 'la', 'les', 'des', 'et', 'est', 'une', 'que', 'dans', 'pour', 'qui', 'du'],
  it: ['il', 'di', 'che', 'e', 'la', 'per', 'un', 'non', 'con', 'del', 'le', 'gli'],
};
const language = (text) => {
  const words = text.toLowerCase().match(/\p{L}+/gu) || [];
  const score = Object.fromEntries(Object.keys(STOP).map((l) => [l, 0]));
  for (const w of words.slice(0, 4000)) for (const l of Object.keys(STOP)) if (STOP[l].includes(w)) score[l]++;
  return Object.entries(score).sort((a, b) => b[1] - a[1])[0][0];
};

const samples = [];
const add = (s) => {
  const text = s.text.replace(/\r\n?/g, '\n').trim() + '\n';
  const canon = canonicalText(text);
  samples.push({
    id: s.id, title: s.title, group: s.group, language: language(text), characters: canon.length,
    source: s.source, licence: s.licence,
    // Every distinct character as the hidden-message tool counts it (case-sensitive graphemes of the canonical text).
    has: [...new Set(graphemes(canon))].sort().join(''),
    text,
  });
};

// 1. Public-domain works of the gallery.
for (const w of json('gallery/works.config.json')) {
  add({ id: `gallery-${w.id}`, title: `${w.title}`, group: 'works', text: w.text, source: w.source, licence: w.licence || 'Public domain' });
}

// 2. Chosen texts of the examples (their raw source text is published next to each one-pager).
const examples = new Map(json('examples/sources.json').map((e) => [e.id, e]));
// [example id, group, short title]. Titles are in the language of the document.
const CHOSEN = [
  ['ch-bundesverfassung', 'laws', 'Bundesverfassung'], ['de-grundgesetz', 'laws', 'Grundgesetz'],
  ['us-constitution', 'laws', 'US Constitution'], ['un-human-rights', 'laws', 'Universal Declaration of Human Rights'],
  ['pep-8', 'tech', 'PEP 8: Style Guide for Python Code'],
  ['agents-md', 'ai', 'AGENTS.md'], ['code-review-agent', 'ai', 'Code review agent'], ['support-assistant', 'ai', 'Support assistant'],
  ['research-assistant', 'ai', 'Research assistant'],
  ['agent-library-wissen', 'ai', 'Agenten-Bibliothek: Wissen'], ['agent-regel-quellen', 'ai', 'Agenten-Regel: Quellen'],
  ['agent-regel-datenschutz', 'ai', 'Agenten-Regel: Datenschutz'], ['agent-prompts-sec', 'ai', 'Agenten-Prompts: Sicherheit'],
];
for (const [id, group, title] of CHOSEN) {
  const e = examples.get(id);
  add({
    id: `example-${id}`, title, group,
    text: readFileSync(join(ROOT, 'examples', id, 'source.txt'), 'utf8'),
    source: e.url || 'Typographics Art', licence: e.licence,
  });
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const s of samples) writeFileSync(join(OUT, `${s.id}.txt`), s.text);
writeFileSync(join(OUT, 'index.json'), JSON.stringify(samples.map(({ text, ...meta }) => meta), null, 1) + '\n');

for (const s of samples) {
  const missing = [...'abcdefghijklmnopqrstuvwxyz'].filter((c) => !s.has.includes(c));
  console.log(`${s.id.padEnd(40)} ${s.language} ${String(s.characters).padStart(7)}  no: ${missing.join('') || '-'}`);
}
console.log(`\n${samples.length} samples written to samples/`);
