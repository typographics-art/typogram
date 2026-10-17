#!/usr/bin/env node
// tg-secret: hide a message in a Typographics Art work, or read it back. The work stays as it is; the key holds
// the positions (a book cipher, see src/secret.js). Needs Node 20+, and MuPDF for PDF works.
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { parseArgs } from 'node:util';
import { hideSecret, revealSecret, markupText } from '../src/index.js';
import { readDocument } from './onepage-core.mjs';

const HELP = `Usage:
  tg-secret hide   <work.pdf|.svg|.html|.txt> --secret "the message"     prints the key
  tg-secret reveal <work.pdf|.svg|.html|.txt> --key tg1.…                prints the message

The work keeps only its public text. The key lists where the message's characters stand in it,
chosen at random. Keep the key like a password: with key and work, anyone can read the message.
`;

const { values, positionals } = parseArgs({ allowPositionals: true, options: { secret: { type: 'string' }, key: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
const [command, file] = positionals;
if (values.help || !file || !['hide', 'reveal'].includes(command)) { process.stdout.write(HELP); process.exit(values.help ? 0 : 1); }

/** The public text of a work, as a machine reads it. */
function workText(path) {
  const ext = extname(path).toLowerCase();
  if (ext === '.pdf') return readDocument(path).text;
  const raw = readFileSync(path, 'utf8');
  if (ext === '.svg') return markupText(raw, 'svg');
  if (ext === '.html' || ext === '.htm') return markupText(raw, 'html');
  return raw;
}

try {
  const text = workText(file);
  if (command === 'hide') {
    if (!values.secret) throw new Error('--secret is missing');
    console.log(await hideSecret(text, values.secret));
  } else {
    if (!values.key) throw new Error('--key is missing');
    console.log(await revealSecret(text, values.key));
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
