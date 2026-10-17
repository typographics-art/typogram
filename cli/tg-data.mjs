#!/usr/bin/env node
// tg-data: structured data inside a Typographics Art work (TGD, docs/structured-data.md).
// Needs Node 20+, and MuPDF (mutool) to read a PDF work.
import { readFileSync, writeFileSync } from 'node:fs';
import { extname, basename } from 'node:path';
import { parseArgs } from 'node:util';
import { encode, decodeAll, toFile, verify, modelJson, TgdError } from '../src/structured.js';
import { FORMATS } from '../src/structured-formats.js';
import { canonicalText } from '../src/secret.js';
import { markupText } from '../src/work-text.js';
import { readDocument } from './onepage-core.mjs';

const HELP = `Usage:
  tg-data encode <file> [-o out.txt] [options]   turn a file into a TGD data block (text)
  tg-data decode <work> [-o file] [options]      read the data block out of a work and write it back
  tg-data verify <work>                          check every data block of a work (exit 1 if one is damaged or none is found)

<file> is one of: ${Object.keys(FORMATS).join(', ')} (by extension, else by content).
<work> is a .pdf (needs MuPDF), .svg, .html or .txt: anything the block text can be read from.

encode options
  -o, --out <file>        write the block text to a file (default: standard output)
  --unicode <mode>        safe (default: measured-safe characters stay readable, the rest is \\u-escaped),
                          plain (all characters literal; verify the finished work), ascii (everything but ASCII escaped)
  --layout <mode>         rows (default), cells or compact: how the text is broken into lines. Looks only.
  --attach                also carry the original file (base64) inside the block
  --encoding <label>      text encoding of a CSV/XML file that is not UTF-8 (for example windows-1252)
  --no-date               leave out the creation time (same file -> same block, byte for byte)

decode options
  --format <name>         model (default, the TGD model as JSON), or a file format: ${Object.keys(FORMATS).join(', ')}
  -o, --out <file>        write the result to a file (required for xlsx)
  --block <n>             which block, starting at 1 (default 1)
  --sheet <name|number>   which sheet of a workbook to write as CSV/TSV (default: the first)
  --raw                   CSV: do not guard cells that start with = + - @ (default guards them, see the spec)
  --formulas              XLSX: write formulas, not only their values (only for data you trust)
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', short: 'o' }, unicode: { type: 'string' }, layout: { type: 'string' }, attach: { type: 'boolean' }, encoding: { type: 'string' },
    'no-date': { type: 'boolean' }, format: { type: 'string' }, block: { type: 'string' }, sheet: { type: 'string' }, raw: { type: 'boolean' }, formulas: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});
const [command, file] = positionals;
if (values.help || !file || !['encode', 'decode', 'verify'].includes(command)) { process.stdout.write(HELP); process.exit(values.help ? 0 : 1); }

/** The text of a work as a machine reads it. */
function workText(path) {
  const ext = extname(path).toLowerCase();
  if (ext === '.pdf') return readDocument(path).text;
  const raw = readFileSync(path, 'utf8');
  if (ext === '.svg') return markupText(raw, 'svg');
  if (ext === '.html' || ext === '.htm') return markupText(raw, 'html');
  return raw;
}

const fail = (m) => { console.error(m); process.exit(1); };

try {
  if (command === 'encode') {
    if (values.unicode && !['safe', 'plain', 'ascii'].includes(values.unicode)) fail('--unicode takes safe, plain or ascii');
    if (values.layout && !['rows', 'cells', 'compact'].includes(values.layout)) fail('--layout takes rows, cells or compact');
    const r = await encode({ bytes: new Uint8Array(readFileSync(file)), name: basename(file) }, {
      unicode: values.unicode, layout: values.layout, attach: values.attach, encoding: values.encoding, created: values['no-date'] ? false : new Date(),
    });
    if (values.out) writeFileSync(values.out, r.text + '\n'); else process.stdout.write(r.text + '\n');
    console.error(`${basename(file)} -> ${r.format}: ${r.stats.inputBytes} bytes became ${r.stats.characters} characters${values.out ? ` in ${values.out}` : ''}`);
    for (const w of r.warnings) console.error(`warning: ${w}`);
    console.error('not carried over: ' + r.lossy.join('; '));
  } else if (command === 'verify') {
    const v = await verify(canonicalText(workText(file)));
    if (!v.blocks.length) fail(`${file}: no TGD data block found`);
    v.blocks.forEach((b, i) => console.log(b.ok ? `block ${i + 1}: ok, ${b.format || '?'} ${b.name || ''} sha256 ${b.sum.slice(0, 16)}…` : `block ${i + 1}: DAMAGED (${b.code}): ${b.message}`));
    process.exit(v.ok ? 0 : 1);
  } else {
    const all = await decodeAll(canonicalText(workText(file)));
    if (!all.length) fail(`${file}: no TGD data block found`);
    const n = Number(values.block || 1);
    const b = all[n - 1];
    if (!b) fail(`${file}: there is no block ${n} (found ${all.length})`);
    if (b.error) fail(`${file}: block ${n} is damaged (${b.error.code}): ${b.error.message}`);
    const fmt = values.format || 'model';
    if (fmt === 'model') {
      const out = modelJson({ data: new Map([['tgd', b.version], ['format', b.format], ['name', b.name], ['sum', b.sum], ['data', b.data]]) });
      if (values.out) writeFileSync(values.out, out + '\n'); else process.stdout.write(out + '\n');
    } else {
      if (!FORMATS[fmt]) fail(`Unknown --format ${fmt}`);
      const f = await toFile(b, fmt, { safe: !values.raw, formulas: values.formulas, sheet: values.sheet });
      if (!values.out && fmt === 'xlsx') fail('An .xlsx file is binary: give -o <file>');
      if (values.out) writeFileSync(values.out, f.bytes); else process.stdout.write(f.bytes);
      for (const note of f.notes || []) console.error(`note: ${note}`);
      console.error(`block ${n} verified (sha256 ${b.sum.slice(0, 16)}…)${values.out ? `, ${f.bytes.length} bytes written to ${values.out}` : ''}`);
    }
  }
} catch (e) {
  if (e instanceof TgdError || e.code === 'ENOENT') { console.error(e.code === 'ENOENT' ? `File not found: ${file}` : e.message); process.exit(1); }
  throw e;
}
