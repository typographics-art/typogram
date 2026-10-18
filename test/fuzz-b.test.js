// The deterministic subset of the review's fuzzer (scripts/fuzz-crypto-b.mjs --quick): about 2 000 decoder calls over every
// prefix, record, share, vault, mnemonic, TGD block and file format, with mutated and checksum-forged inputs. The only
// acceptable outcomes are a result or a named CryptError / TgdError inside the time bound; the script exits 1 otherwise.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('fuzz: every decoder refuses hostile input cleanly (deterministic subset, seed tg-fuzz-b)', { timeout: 60000 }, () => {
  const r = spawnSync(process.execPath, [new URL('../scripts/fuzz-crypto-b.mjs', import.meta.url).pathname, '--quick'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /0 findings/);
  assert.match(r.stdout, /refused cleanly/);
  console.log('# ' + r.stdout.trim().split('\n').pop());
});
