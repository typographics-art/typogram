#!/usr/bin/env node
// tg-crypt: encrypted structured data (and messages) tied to a Typographics Art work, compact book-cipher keys, and a
// Needs Node 20+, and MuPDF for PDF works. (An experimental publish/fetch flow against a fake chain exists for the
// draft in docs/drafts/chain-anchoring.md; it is hidden unless TG_CRYPT_EXPERIMENTAL=1 and never talks to a real chain.)
//
// Suggested package.json bin line (not added here):  "tg-crypt": "cli/tg-crypt.mjs"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { sealData, sealBytes, sealMessage, openSealed, describeRecord, parseRecord, CryptError } from '../src/crypt.js';
import { hideCompact, revealAny } from '../src/crypt-book.js';
import { FakeChain, FakeChainAdapter, ChainAdapter, recordCid, publishSealed, openFromChain } from '../src/crypt-chain.js';
import { encode, toFile, modelJson, TgdError } from '../src/structured.js';
import { FORMATS } from '../src/structured-formats.js';
import { markupText } from '../src/work-text.js';
import { b64urlEncode, sha256, toHex } from '../src/crypt-codec.js';
import { KEY_COMMANDS, KEY_NO_TARGET, KEY_OPTIONS, KEY_HELP, isKeyInvocation, runKeyCommand, writeSecretFile } from './tg-keys-cmds.mjs';
import { assertPublishable, openAny } from '../src/keys-work.js';

const HELP = `Usage:
  tg-crypt seal    <work> (--data <file> | --message <text> | --message-file <f>) [-o record.tgs] [options]   prints the KEY; the sealed record goes to a file
  tg-crypt open    <work> [--key-file <f> | --key-stdin | --password-file <f> | --password-stdin] [--record <file>] [-o out] [--format <f>]
  tg-crypt inspect <record.tgs>                                                           what a record shows without a key
  tg-crypt hide    <work> --secret <text> [--near <K>]                                    compact book-cipher key (tg2.; obfuscation, not encryption)
  tg-crypt reveal  <work> [--key-file <f> | --key-stdin]                                  tg1. or tg2. key

<work> is a .pdf (needs MuPDF), .svg, .html or .txt. With --no-bind use "-" instead of a work.

seal options
  --data <file>        a data file (${Object.keys(FORMATS).join(', ')}); it becomes a TGD block first, then it is sealed
  --raw                seal the file's bytes as they are (any file), not as a TGD block
  --message <text>     seal a text message instead
  --strength <128|256> secret length in bits (default 256)
  --inline             the key carries the record too (one string holds everything; at most 32 KiB of record)
  --no-bind            the key fits any work (use "-" as the work)
  --password-file <f>  seal with the password in the file (also --password-stdin, --password-env TG_CRYPT_PASSWORD); no key string results
  --iterations <n>     PBKDF2 iterations with a password (default 600000)
  --pad <n>            pad up to a multiple of n bytes (hides the exact size)
  --compress <m>       deflate (default), brotli (smaller, not readable in every browser), none
Secrets never go on the command line (the process list and the shell history would show them). There is no --key option and no
--password option. A key comes from, in this order:  --key-file <path>,  --key-stdin,  the environment variable TG_CRYPT_KEY.
A password comes from:  --password-file <path>,  --password-stdin,  the environment variable TG_CRYPT_PASSWORD
(on seal, password mode is chosen by giving one of --password-file, --password-stdin or --password-env TG_CRYPT_PASSWORD).
Messages and secrets to hide can be given as --message-file / --secret-file (or --message / --secret for text that is not sensitive).
Only one of --key-stdin, --password-stdin may be used. seal and hide print the key to standard output and nothing else there;
messages about progress go to standard error and never contain a key, a password or a message.
${KEY_HELP}`;

const { values, positionals } = (() => {
  try {
    return parseArgs({ allowPositionals: true, options: {
      data: { type: 'string' }, raw: { type: 'boolean' }, message: { type: 'string' }, strength: { type: 'string' }, inline: { type: 'boolean' }, 'no-bind': { type: 'boolean' },
      'password-env': { type: 'string' }, 'password-file': { type: 'string' }, 'password-stdin': { type: 'boolean' }, 'key-stdin': { type: 'boolean' }, 'message-file': { type: 'string' }, 'secret-file': { type: 'string' }, iterations: { type: 'string' }, pad: { type: 'string' }, compress: { type: 'string' }, 'key-file': { type: 'string' },
      record: { type: 'string' }, out: { type: 'string', short: 'o' }, format: { type: 'string' }, secret: { type: 'string' }, near: { type: 'string' }, chain: { type: 'string' },
      store: { type: 'string' }, ...KEY_OPTIONS, hint: { type: 'string' }, 'no-mine': { type: 'boolean' }, confirmations: { type: 'string' }, help: { type: 'boolean', short: 'h' },
    } });
  } catch (e) {
    // never echo the text of the command line: it may hold a secret that was typed in the wrong place
    const name = /Unknown option '(-{1,2}[A-Za-z0-9-]+)/.exec(e.message)?.[1];
    console.error(name ? `Unknown option ${name} (see --help). Keys and passwords are not accepted on the command line: use --key-file, --key-stdin or TG_CRYPT_KEY.` : 'The command line could not be read (see --help)');
    process.exit(1);
  }
})();
const [command, target, extra] = positionals;
const EXPERIMENTAL = process.env.TG_CRYPT_EXPERIMENTAL === '1';
const COMMANDS = ['seal', 'open', 'inspect', 'hide', 'reveal', ...(EXPERIMENTAL ? ['publish', 'fetch', 'verify'] : []), ...KEY_COMMANDS];
if (values.help || !COMMANDS.includes(command) || (!target && !KEY_NO_TARGET.includes(command))) { process.stdout.write(HELP); process.exit(values.help ? 0 : 1); }

const die = (m) => { console.error(m); process.exit(1); };

async function workText(path) {
  if (path === '-') return null;
  const ext = extname(path).toLowerCase();
  if (ext === '.pdf') { const { readDocument } = await import('./onepage-core.mjs'); return readDocument(path).text; }
  const raw = readFileSync(path, 'utf8');
  if (ext === '.svg') return markupText(raw, 'svg');
  if (ext === '.html' || ext === '.htm') return markupText(raw, 'html');
  return raw;
}
if (values['key-stdin'] && values['password-stdin']) die('Only one of --key-stdin and --password-stdin can read standard input');
let stdinText;
const readStdin = () => (stdinText ??= readFileSync(0, 'utf8'));
const readSecretFile = (path) => { try { return readFileSync(path, 'utf8'); } catch (e) { return die(e.code === 'ENOENT' ? `File not found: ${path}` : `Cannot read ${path}`); } };
const trimEnd = (t) => t.replace(/[\r\n]+$/, ''); // a trailing newline from echo or an editor is not part of a password
const keyFromArgs = () => {
  if (values['key-file']) return readSecretFile(values['key-file']).trim();
  if (values['key-stdin']) return readStdin().trim();
  return process.env.TG_CRYPT_KEY?.trim();
};
/** The password for open (any source, the environment included) or seal (only when asked for explicitly). */
const passwordFromArgs = (forSeal = false) => {
  if (values['password-file']) return trimEnd(readSecretFile(values['password-file']));
  if (values['password-stdin']) return trimEnd(readStdin());
  if (values['password-env']) return process.env[values['password-env']] ?? die(`Environment variable ${values['password-env']} is not set`);
  return forSeal ? undefined : process.env.TG_CRYPT_PASSWORD;
};
const textArg = (inline, fileOpt) => (values[fileOpt] ? trimEnd(readSecretFile(values[fileOpt])) : inline);

// ---- the fake chain on disk -------------------------------------------------------------------------------------
function loadChain(path) { return existsSync(path) ? FakeChain.fromJSON(JSON.parse(readFileSync(path, 'utf8'))) : new FakeChain(); }
const saveChain = (chain, path) => writeFileSync(path, JSON.stringify(chain, null, 1) + '\n');
class DirStore {
  constructor(dir) { this.dir = dir; mkdirSync(dir, { recursive: true }); }
  async put(bytes) { const loc = toHex(await sha256(bytes)); writeFileSync(join(this.dir, loc), bytes); return loc; }
  async get(loc) { if (!/^[0-9a-f]{64}$/.test(loc)) return null; const p = join(this.dir, loc); return existsSync(p) ? new Uint8Array(readFileSync(p)) : null; }
}
function chainTools() {
  if (!values.chain || !values.store) die('--chain <file> and --store <dir> are needed (this is the fake chain; nothing real is touched)');
  const chain = loadChain(values.chain);
  return { chain, adapter: new FakeChainAdapter(chain, new DirStore(values.store), { minConfirmations: Number(values.confirmations || 0) }) };
}

try {
  if (isKeyInvocation(command, values)) await runKeyCommand(command, values, positionals, { workText, readStdin, readSecretFile, trimEnd, die });
  else if (command === 'seal') {
    if (!values.data === !(values.message !== undefined || values['message-file'])) die('Give exactly one of --data <file> and --message <text> (or --message-file <path>)');
    const bind = !values['no-bind'];
    const text = bind ? await workText(target) : null;
    if (bind && text === null) die('The work is "-" but --no-bind was not given');
    const compress = { deflate: true, none: false, brotli: 'brotli' }[values.compress ?? 'deflate'];
    if (compress === undefined) die('--compress takes deflate, brotli or none');
    const password = passwordFromArgs(true);
    if (password !== undefined && !values['accept-password-only']) die('A password alone must not protect a record that may be published: a human-chosen password can be guessed offline for ever. Seal with a random key instead (the default), or add --accept-password-only for a local file you will never publish.');
    const o = { bind, inline: values.inline, strength: Number(values.strength || 256), password, pad: Number(values.pad || 0), compress, iterations: values.iterations ? Number(values.iterations) : undefined };
    let sealed;
    if (values.message !== undefined || values['message-file']) sealed = await sealMessage(text, textArg(values.message, 'message-file'), o);
    else {
      const bytes = new Uint8Array(readFileSync(values.data));
      if (values.raw) sealed = await sealBytes(text, bytes, o);
      else sealed = await sealData(text, (await encode({ bytes, name: basename(values.data) })).text, o);
    }
    const out = values.out || (values.data ? `${values.data}.tgs` : 'message.tgs');
    if (!values.inline) writeFileSync(out, sealed.record + '\n');
    if (sealed.key) console.log(sealed.key);
    const s = sealed.stats;
    console.error(`${s.plainBytes} bytes sealed (${s.method}); record ${s.recordBytes} bytes / ${s.recordChars} characters${values.inline ? ' inside the key' : ` in ${out}`}; key ${s.keyChars} characters${sealed.key ? '' : ' (password: no key string)'}`);
    if (sealed.key) console.error('Keep the key like a password: whoever has key and work can open the record.');
  } else if (command === 'open') {
    const record = values.record ? readFileSync(values.record, 'utf8') : undefined;
    const password = passwordFromArgs(), key = password === undefined ? keyFromArgs() : undefined;
    let text = null;
    try { text = target === '-' ? null : await workText(target); } catch (e) { if (e.code !== 'ENOENT') throw e; die(`File not found: ${target}`); }
    const r = await openAny(text, { key, password, record });
    if (r.kind === 'text') process.stdout.write(r.text + '\n');
    else if (r.kind === 'bytes') { if (!values.out) die('The record holds a file: give -o <file>'); writeSecretFile(values.out, r.bytes, { force: values.force }); console.error(`${r.bytes.length} bytes written to ${values.out}`); }
    else {
      const fmt = values.format || 'model';
      if (fmt === 'model') { const o = modelJson({ data: new Map([['tgd', r.block.version], ['format', r.block.format], ['name', r.block.name], ['sum', r.block.sum], ['data', r.block.data]]) }); if (values.out) writeSecretFile(values.out, o + '\n', { force: values.force }); else process.stdout.write(o + '\n'); }
      else {
        if (!FORMATS[fmt]) die(`Unknown --format ${fmt}`);
        const f = await toFile(r.block, fmt, {});
        if (!values.out) die('Give -o <file> for a file format');
        writeSecretFile(values.out, f.bytes, { force: values.force });
      }
      console.error(`opened: TGD block verified (sha256 ${r.block.sum.slice(0, 16)}…)`);
    }
  } else if (command === 'inspect') {
    console.log(JSON.stringify(describeRecord(readFileSync(target, 'utf8')), null, 1));
  } else if (command === 'hide') {
    const secret = textArg(values.secret, 'secret-file');
    if (!secret) die('--secret or --secret-file is missing');
    console.log(await hideCompact(await workText(target), secret, { near: values.near ? Number(values.near) : Infinity }));
  } else if (command === 'reveal') {
    const key = keyFromArgs() ?? die('No key: use --key-file, --key-stdin or TG_CRYPT_KEY');
    console.log(await revealAny(await workText(target), key));
  } else if (command === 'publish') {
    const { chain, adapter } = chainTools();
    const rec = parseRecord(readFileSync(target, 'utf8'));
    assertPublishable(rec.bytes, { acceptPasswordOnly: values['accept-password-only'] });
    const r = await adapter.publish(rec.bytes, { hint: values.hint });
    if (!values['no-mine']) chain.mine(1);
    saveChain(chain, values.chain);
    console.log(r.assetId);
    console.error(`commitment sha256 ${r.commitment}\nIPFS CID the record has when added with raw leaves: ${recordCid(Uint8Array.from(r.commitment.match(/../g), (h) => parseInt(h, 16)))}\nestimated fee ${r.feeSat} satoshi (${(r.feeSat / 1e8).toFixed(8)} DGB)`);
  } else if (command === 'fetch') {
    const { adapter } = chainTools();
    const r = await adapter.fetch(target);
    const text = 'tgs1.' + b64urlEncode(r.record);
    if (values.out) writeFileSync(values.out, text + '\n'); else process.stdout.write(text + '\n');
    console.error(`record verified against the chain (${r.confirmations} confirmations)`);
  } else if (command === 'verify') {
    if (!extra) die('verify needs an asset id and a record file');
    const { adapter } = chainTools();
    const v = await adapter.verify(target, parseRecord(readFileSync(extra, 'utf8')).bytes);
    console.log(v.ok ? `ok: the chain commits to exactly this record (${v.confirmations} confirmations)` : `NOT OK: ${v.reason}`);
    process.exit(v.ok ? 0 : 1);
  }
} catch (e) {
  if (e instanceof CryptError || e instanceof TgdError) { console.error(e.message); process.exit(1); }
  if (e.code === 'ENOENT') { console.error(`File not found: ${e.path}`); process.exit(1); }
  throw e;
}
