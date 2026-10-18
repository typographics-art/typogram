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

The key can also come from a file (--key-file <path>), from standard input (--key-stdin) or from the
environment variable TG_SECRET_KEY. Prefer those over --key: an argument shows up in the process list
and in the shell history, and the key is the secret.

The work keeps only its public text. The key lists where the message's characters stand in it,
chosen at random. Keep the key like a password: with key and work, anyone can read the message.
`;

let values, positionals;
try { ({ values, positionals } = parseArgs({ allowPositionals: true, options: { secret: { type: 'string' }, key: { type: 'string' }, 'key-file': { type: 'string' }, 'key-stdin': { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } })); } catch (e) { console.error(`${e.message.split('\n')[0]} (see --help)`); process.exit(1); }
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
    const key = values['key-file'] ? readFileSync(values['key-file'], 'utf8')
      : values['key-stdin'] ? readFileSync(0, 'utf8')
      : values.key ?? process.env.TG_SECRET_KEY;
    if (!key || !key.trim()) throw new Error('The key is missing: use --key-file, --key-stdin, TG_SECRET_KEY or --key');
    console.log(await revealSecret(text, key));
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
