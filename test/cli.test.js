// The command-line tools refuse bad input with one clear line and a non-zero exit code, before any browser starts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (script, args) => spawnSync(process.execPath, [join(ROOT, 'cli', script), ...args], { encoding: 'utf8', timeout: 20000 });
const IMG = join(ROOT, 'gallery', 'photos', 'tesla.jpg');
const out = join(mkdtempSync(join(tmpdir(), 'tg-cli-')), 'x.svg');

test('tg-art: a number option that is not a number or not positive is refused with its name', () => {
  for (const [args, message] of [[['--width', 'abc'], /--width needs a number above 0, got "abc"/], [['--width', '0'], /--width needs a number above 0/], [['--edges=-1'], /--edges needs a number from 0/], [['--contrast=0'], /--contrast needs a number above 0/]]) {
    const r = run('tg-art.mjs', [IMG, '--string', 'x', '-o', out, ...args]);
    assert.notEqual(r.status, 0, args.join(' '));
    assert.match(r.stderr, message);
    assert.doesNotMatch(r.stderr, /\n\s+at /, 'no stack trace');
  }
});

test('tg-art: an empty text and an unknown option are one-line errors', () => {
  const empty = run('tg-art.mjs', [IMG, '--string', '', '-o', out]);
  assert.notEqual(empty.status, 0);
  assert.match(empty.stderr, /text is empty/);
  const bogus = run('tg-art.mjs', [IMG, '--string', 'x', '-o', out, '--bogus']);
  assert.notEqual(bogus.status, 0);
  assert.match(bogus.stderr, /Unknown option '--bogus'.*\(see --help\)/);
  assert.doesNotMatch(bogus.stderr, /\n\s+at /);
});

test('tg-art: --help works and an unsupported output format is named', () => {
  assert.equal(run('tg-art.mjs', ['--help']).status, 0);
  const r = run('tg-art.mjs', [IMG, '--string', 'x', '-o', join(tmpdir(), 'x.gif')]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Unsupported output format "\.gif"/);
});

test('tg-secret: round trip on a text file, and a wrong key, a missing file and an unknown option fail cleanly', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'tg-cli-')), 'work.txt');
  writeFileSync(file, 'It was the best of times, it was the worst of times, it was the age of wisdom. '.repeat(4));
  const hidden = run('tg-secret.mjs', ['hide', file, '--secret', 'best times']);
  assert.equal(hidden.status, 0);
  const key = hidden.stdout.trim();
  assert.match(key, /^tg1\./);
  assert.equal(run('tg-secret.mjs', ['reveal', file, '--key', key]).stdout.trim(), 'best times');
  assert.notEqual(run('tg-secret.mjs', ['reveal', file, '--key', 'nonsense']).status, 0);
  assert.notEqual(run('tg-secret.mjs', ['hide', join(tmpdir(), 'does-not-exist.txt'), '--secret', 'x']).status, 0);
  const bogus = run('tg-secret.mjs', ['hide', '--bogus']);
  assert.notEqual(bogus.status, 0);
  assert.doesNotMatch(bogus.stderr, /\n\s+at /);
});

test('onepage: a file that is not a PDF is refused by name, not read as an empty document', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tg-cli-'));
  const fake = join(dir, 'fake.pdf');
  writeFileSync(fake, 'this is not a pdf');
  const r = run('onepage.mjs', [fake, '-o', join(dir, 'x.pdf')]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /MuPDF could not read the document|no text/i);
});

test('tg-secret: the key can come from a file, standard input or the environment, not only from an argument', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tg-cli-'));
  const file = join(dir, 'work.txt');
  writeFileSync(file, 'It was the best of times, it was the worst of times, it was the age of wisdom. '.repeat(4));
  const key = run('tg-secret.mjs', ['hide', file, '--secret', 'age of wisdom']).stdout.trim();
  const keyFile = join(dir, 'key.txt');
  writeFileSync(keyFile, key + '\n');
  assert.equal(run('tg-secret.mjs', ['reveal', file, '--key-file', keyFile]).stdout.trim(), 'age of wisdom');
  const viaStdin = spawnSync(process.execPath, [join(ROOT, 'cli', 'tg-secret.mjs'), 'reveal', file, '--key-stdin'], { input: key, encoding: 'utf8' });
  assert.equal(viaStdin.stdout.trim(), 'age of wisdom');
  const viaEnv = spawnSync(process.execPath, [join(ROOT, 'cli', 'tg-secret.mjs'), 'reveal', file], { encoding: 'utf8', env: { ...process.env, TG_SECRET_KEY: key } });
  assert.equal(viaEnv.stdout.trim(), 'age of wisdom');
  const none = run('tg-secret.mjs', ['reveal', file]);
  assert.notEqual(none.status, 0);
  assert.match(none.stderr, /key is missing/);
});
