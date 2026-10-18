// Key-management commands of tg-crypt (docs/key-management.md section 10): master, derive, recipient, split, join, and
// `seal --to` / `seal --record-id` / `open` with the new key forms. Secrets come from files, standard input or the
// environment, never from arguments; stdout carries the result only; progress goes to stderr and never holds a secret.
import { readFileSync, writeFileSync, openSync, writeSync, closeSync, unlinkSync, fchmodSync } from 'node:fs';
import { basename } from 'node:path';
import { mnemonicToSeed, seedFromHex, masterFromSeed, formatMaster, parseMaster, recordKey, recipientSecret } from '../src/keys.js';
import { formatKey2, sealWithSecret, openWithSecret } from '../src/keys-work.js';
import { workDigest } from '../src/crypt.js';
import { newRecipient, parsePublic, parseSecret, formatSecret, formatPublic, publicFromSecret, sealTo, openFrom, RECORD_PREFIX as RP } from '../src/keys-seal.js';
import { splitXor, splitShamir, joinShares } from '../src/keys-split.js';
import { encode } from '../src/structured.js';
import { toHex, fail } from '../src/crypt-codec.js';

/**
 * Writes a file that holds a secret (a secret key, a share, decrypted data): created with O_CREAT|O_EXCL and mode 0600, so an
 * existing file or a symlink (even a dangling one) is refused and never followed. With `force` the old path is unlinked first
 * (unlink removes a symlink itself, not its target) and then created the same way. The mode is set again on the open
 * descriptor, so a permissive umask cannot widen it. Throws CryptError('file-exists') naming the path.
 */
export function writeSecretFile(path, data, { force = false } = {}) {
  if (force) { try { unlinkSync(path); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  let fd;
  try { fd = openSync(path, 'wx', 0o600); } catch (e) {
    if (e.code === 'EEXIST') throw fail('file-exists', `${path} already exists; it was not touched (give --force to replace it)`);
    throw e;
  }
  try { fchmodSync(fd, 0o600); writeSync(fd, data); } finally { closeSync(fd); }
}

export const KEY_COMMANDS = ['master', 'derive', 'recipient', 'split', 'join'];
export const KEY_NO_TARGET = ['master', 'recipient', 'split', 'join'];
export const KEY_OPTIONS = {
  'mnemonic-file': { type: 'string' }, 'mnemonic-stdin': { type: 'boolean' }, 'seed-file': { type: 'string' }, 'seed-stdin': { type: 'boolean' },
  'bip39-passphrase-file': { type: 'string' }, 'master-file': { type: 'string' }, 'master-stdin': { type: 'boolean' },
  'record-id': { type: 'string' }, context: { type: 'string' }, to: { type: 'string' }, index: { type: 'string' }, new: { type: 'boolean' }, work: { type: 'string' }, recipient: { type: 'boolean' },
  'recipient-key-file': { type: 'string' }, 'recipient-key-stdin': { type: 'boolean' }, xor: { type: 'string' }, shamir: { type: 'string' }, 'shares-stdin': { type: 'boolean' },
  'accept-password-only': { type: 'boolean' }, force: { type: 'boolean' },
};
export const KEY_HELP = `
Key management (docs/key-management.md); secrets only from a file, standard input or the environment, never as an argument
  tg-crypt master                                   master key "tgmk1." from a seed:  --mnemonic-file <f> | --mnemonic-stdin | TG_CRYPT_MNEMONIC
                                                    or a hex seed: --seed-file <f> | --seed-stdin | TG_CRYPT_SEED;  optional BIP-39 passphrase:
                                                    --bip39-passphrase-file <f> | TG_CRYPT_BIP39_PASSPHRASE   (prints the master key)
  tg-crypt derive <recordId> [--work <work>]        the key of one record from the master key (--master-file <f> | --master-stdin | TG_CRYPT_MASTER);
                                                    prints a tgx2. key; --work binds it to a work. --recipient [--index n] prints the recipient
                                                    secret "tgq1." instead (recordId is then not used: pass "-")
  tg-crypt recipient (--new -o <secret file> | --recipient-key-file <f> | --master-file <f> [--index n])    prints the PUBLIC key "tgp1."
  tg-crypt seal <work> --to <tgp1.key> (--message ... | --data <file>) [-o record]          seal for the owner of a public key: no key is printed
  tg-crypt seal <work> --record-id <id> (--master-file <f> | --master-stdin | TG_CRYPT_MASTER) ...     seal with the record's derived key
  tg-crypt open <work> --record <f> (--recipient-key-file <f> | --recipient-key-stdin | TG_CRYPT_RECIPIENT_KEY | the master key plus --index n)   for tgr1. records
  tg-crypt open <work> --record <f> --record-id <id> --master-file <f>                      with the derived key
  tg-crypt split  (--xor <n> | --shamir <k>:<n>) [-o <prefix>]    splits the key given with --key-file/--key-stdin/TG_CRYPT_KEY into "tgsh1." shares, one per line
  tg-crypt join   <share file>... | --shares-stdin                 recombines shares; prints the secret
Files with secrets (recipient --new, split -o, open -o) are created with mode 0600 and refused if the path exists or is a symlink; --force replaces the path (unlinks it first).
A password alone never protects a record that others may get: "seal --password-*" needs --accept-password-only (local files only).
`;

export const isKeyInvocation = (command, v) => KEY_COMMANDS.includes(command) || ((command === 'seal' || command === 'open') && (v.to || v['record-id'] || v['recipient-key-file'] || v['recipient-key-stdin'] || v['master-file'] || v['master-stdin'] || process.env.TG_CRYPT_RECIPIENT_KEY));

export async function runKeyCommand(command, v, positionals, h) {
  const { die, readStdin, readSecretFile, trimEnd } = h;
  const stdinFlags = ['key-stdin', 'password-stdin', 'mnemonic-stdin', 'seed-stdin', 'master-stdin', 'recipient-key-stdin', 'shares-stdin'].filter((f) => v[f]);
  if (stdinFlags.length > 1) die('Only one of the --...-stdin options can read standard input');
  const src = (file, stdin, env) => (v[file] ? readSecretFile(v[file]).trim() : v[stdin] ? readStdin().trim() : process.env[env]?.trim());
  const index = v.index !== undefined ? (/^\d{1,10}$/.test(v.index) ? Number(v.index) : die('--index is a whole number')) : 0;
  const masterBytes = async () => parseMaster(src('master-file', 'master-stdin', 'TG_CRYPT_MASTER') ?? die('No master key: use --master-file, --master-stdin or TG_CRYPT_MASTER'));
  const workDigestOf = async (work) => (work && work !== '-' ? workDigest(await h.workText(work)) : null);
  const ctxOf = async (work) => { const d = await workDigestOf(work); return d ? `work:${toHex(d)}` : ''; };
  const recipientSecretBytes = async () => {
    const t = src('recipient-key-file', 'recipient-key-stdin', 'TG_CRYPT_RECIPIENT_KEY');
    if (t) return parseSecret(t);
    return recipientSecret(await masterBytes(), index);
  };

  if (command === 'master') {
    const phrase = src('mnemonic-file', 'mnemonic-stdin', 'TG_CRYPT_MNEMONIC'), hex = src('seed-file', 'seed-stdin', 'TG_CRYPT_SEED');
    if (!phrase === !hex) die('Give exactly one seed: a mnemonic (--mnemonic-file, --mnemonic-stdin, TG_CRYPT_MNEMONIC) or a hex seed (--seed-file, --seed-stdin, TG_CRYPT_SEED)');
    const pass = v['bip39-passphrase-file'] ? trimEnd(readSecretFile(v['bip39-passphrase-file'])) : process.env.TG_CRYPT_BIP39_PASSPHRASE ?? '';
    const seed = phrase ? await mnemonicToSeed(phrase, pass) : seedFromHex(hex);
    console.log(await formatMaster(await masterFromSeed(seed)));
    console.error('Master key made. It opens every record derived from this seed: keep it like the seed itself.');
  } else if (command === 'derive') {
    const m = await masterBytes();
    if (v.recipient) { console.log(await formatSecret(await recipientSecret(m, index))); return; }
    const id = positionals[1] ?? die('derive needs a record id');
    const secret = await recordKey(m, id, v.context ?? '');
    console.log(await formatKey2({ secret, digest: await workDigestOf(v.work) }));
  } else if (command === 'recipient') {
    if (v.new) {
      if (!v.out) die('--new needs -o <file> for the secret key (the public key is printed)');
      const r = await newRecipient();
      writeSecretFile(v.out, r.secret + '\n', { force: v.force });
      console.log(r.public);
      console.error(`The secret key is in ${v.out}; keep it; whoever has it can open what is sealed to the public key.`);
    } else console.log(await formatPublic(await publicFromSecret(await recipientSecretBytes())));
  } else if (command === 'split') {
    const text = src('key-file', 'key-stdin', 'TG_CRYPT_KEY') ?? die('No secret: use --key-file, --key-stdin or TG_CRYPT_KEY');
    if (!v.xor === !v.shamir) die('Give exactly one of --xor <n> and --shamir <k>:<n>');
    const bytes = new TextEncoder().encode(text);
    let shares;
    if (v.xor) shares = await splitXor(bytes, Number(v.xor));
    else { const m = /^(\d{1,3}):(\d{1,3})$/.exec(v.shamir) ?? die('--shamir takes k:n, for example 2:3'); shares = await splitShamir(bytes, Number(m[1]), Number(m[2])); }
    if (v.out) { shares.forEach((s, i) => writeSecretFile(`${v.out}.${i + 1}`, s + '\n', { force: v.force })); console.error(`${shares.length} share files written: ${v.out}.1 ...`); } else console.log(shares.join('\n'));
    console.error('Give each share to a different person or place. A share that is public protects nothing: it must be one part of several.');
  } else if (command === 'join') {
    const texts = v['shares-stdin'] ? readStdin().split(/\s+/).filter(Boolean) : positionals.slice(1).map((f) => readSecretFile(f).trim());
    if (!v['shares-stdin'] && positionals[1] === undefined) die('join needs share files, or --shares-stdin');
    console.log(new TextDecoder().decode(await joinShares(texts)));
  } else if (command === 'seal') {
    const work = positionals[1];
    if (v.password || v['password-file'] || v['password-stdin']) die('Give a recipient key or a record id, not a password');
    if (!v.data === !(v.message !== undefined || v['message-file'])) die('Give exactly one of --data <file> and --message <text> (or --message-file <path>)');
    let item;
    if (v.message !== undefined || v['message-file']) item = { kind: 'text', payload: new TextEncoder().encode((v['message-file'] ? trimEnd(readSecretFile(v['message-file'])) : v.message).normalize('NFC')) };
    else { const b = new Uint8Array(readFileSync(v.data)); item = v.raw ? { kind: 'bytes', payload: b } : { kind: 'tgd', payload: new TextEncoder().encode((await encode({ bytes: b, name: basename(v.data) })).text.replace(/\s+/g, '').slice(5, -5)) }; }
    const out = v.out || (v.data ? `${v.data}.tgs` : 'message.tgs');
    if (v.to) {
      await parsePublic(v.to);
      const r = await sealTo(v.to, item, { context: await ctxOf(work) });
      writeFileSync(out, r.record + '\n');
      console.error(`${r.bytes.length} bytes sealed for the public key; record in ${out}; no key exists: only the owner of the matching secret key can open it`);
    } else {
      const secret = await recordKey(await masterBytes(), v['record-id'], v.context ?? '');
      const text = work && work !== '-' ? await h.workText(work) : null;
      const r = await sealWithSecret(text, item, secret, { bind: text !== null });
      writeFileSync(out, r.record + '\n');
      console.error(`${r.stats.plainBytes} bytes sealed with the key of record "${v['record-id'].slice(0, 40)}"; record in ${out}; derive the key again with the master key`);
    }
  } else if (command === 'open') {
    const work = positionals[1];
    const recordText = v.record ? readFileSync(v.record, 'utf8') : die('--record <file> is needed');
    let r;
    if (recordText.trim().startsWith(RP)) {
      r = await openFrom(await recipientSecretBytes(), recordText, { context: await ctxOf(work) });
    } else {
      const secret = await recordKey(await masterBytes(), v['record-id'] ?? die('--record-id is needed'), v.context ?? '');
      r = await openWithSecret(work && work !== '-' ? await h.workText(work) : null, secret, recordText);
    }
    if (r.kind === 'bytes') { if (!v.out) die('The record holds a file: give -o <file>'); writeSecretFile(v.out, r.bytes, { force: v.force }); console.error(`${r.bytes.length} bytes written to ${v.out}`); } else if (v.out) writeSecretFile(v.out, r.text + '\n', { force: v.force }); else process.stdout.write(r.text + '\n');
  }
}
