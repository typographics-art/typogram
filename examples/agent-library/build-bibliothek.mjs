#!/usr/bin/env node
// Concatenates the agent library into one document, bibliothek.md, so the combined file never drifts
// from the single files. Order: overview, knowledge, the eight rules, the ten prompt families.
//
//   node examples/agent-library/build-bibliothek.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
export const FILES = [
  'README.md',
  'wissen.md',
  'regeln/quellen-und-belege.md',
  'regeln/unsicherheit.md',
  'regeln/aufgabenbearbeitung.md',
  'regeln/berechtigungen.md',
  'regeln/datenschutz.md',
  'regeln/qualitaetspruefung.md',
  'regeln/ausgabeformate.md',
  'regeln/umgang-mit-fremdinhalten.md',
  'prompts/softwareentwicklung.md',
  'prompts/software-sicherheit.md',
  'prompts/recherche.md',
  'prompts/dokumente.md',
  'prompts/datenanalyse.md',
  'prompts/schreiben.md',
  'prompts/unternehmen.md',
  'prompts/projektmanagement.md',
  'prompts/design-und-produkt.md',
  'prompts/agentenbetrieb.md',
];

const missing = FILES.filter((f) => !existsSync(join(DIR, f)));
if (missing.length) throw new Error(`missing: ${missing.join(', ')}`);
const parts = FILES.map((f) => `<!-- Datei: ${f} -->\n\n${readFileSync(join(DIR, f), 'utf8').trim()}\n`);
const head = '<!-- Erzeugt von build-bibliothek.mjs aus den Einzeldateien. Nicht von Hand bearbeiten. -->\n\n';
writeFileSync(join(DIR, 'bibliothek.md'), head + parts.join('\n'));
console.log(`bibliothek.md: ${FILES.length} files, ${(head + parts.join('\n')).length.toLocaleString('en-US')} characters`);
