// Regression for the 2026-10 crypto review M-1: a vault whose parser accepted repeated factor names would run one
// factor's (expensive) KDF once per copy on a single openVault() call, multiplying the per-entry time bound. Both parsers
// must reject a repeated factor as `damaged` before doing any work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVault, openVault, describeVault } from '../src/keys-split.js';
import { masterFromSeed } from '../src/keys.js';
import { b64urlEncode, b64urlDecode, checksum } from '../src/crypt-codec.js';

// Duplicate the first stored entry of a vault string and bump the entry count, with a fresh outer checksum: a hostile
// vault that the honest writer would never produce.
async function duplicateFirstEntry(vaultStr) {
  const prefix = vaultStr.slice(0, 5); // 'tgv1.' or 'tgv2.'
  const raw = b64urlDecode(vaultStr.slice(5));
  const body = raw.slice(0, -4);
  const headerLen = prefix === 'tgv2.' ? 8 : 7; // tgv2 has an extra mode byte
  const nIndex = headerLen - 5; // the n byte sits just before the 4 verify bytes
  const at = headerLen;
  const nl = body[at];
  const kl = body[at + 1 + nl + 1]; // after name and the x byte
  const entryLen = 1 + nl + 1 + 1 + kl + 12 + 48;
  const entry = body.slice(at, at + entryLen);
  const grown = new Uint8Array(body.length + entryLen);
  grown.set(body.slice(0, at + entryLen), 0);
  grown.set(entry, at + entryLen);          // the duplicate
  grown.set(body.slice(at + entryLen), at + 2 * entryLen);
  grown[nIndex] = body[nIndex] + 1;          // one more entry than the honest vault
  const out = new Uint8Array(grown.length + 4);
  out.set(grown, 0); out.set(await checksum(prefix.slice(0, 4), grown, 4), grown.length);
  return prefix + b64urlEncode(out);
}

for (const mode of ['default', 'strict']) {
  test(`vault (${mode}): a repeated factor is refused as damaged, not run once per copy (M-1)`, async () => {
    const master = await masterFromSeed(Uint8Array.from({ length: 32 }, (_, i) => i + 1));
    const factors = mode === 'default'
      ? [{ name: 'seed', master }, { name: 'pka', key: new Uint8Array(32).fill(3) }, { name: 'pkb', key: new Uint8Array(32).fill(4) }]
      : [{ name: 'pka', key: new Uint8Array(32).fill(3) }, { name: 'pkb', key: new Uint8Array(32).fill(4) }, { name: 'pkc', key: new Uint8Array(32).fill(5) }];
    const { vault } = await createVault(factors, { k: 2, mode });
    const hostile = await duplicateFirstEntry(vault);
    await assert.rejects(describeVault(hostile), { code: 'damaged' });
    await assert.rejects(openVault(hostile, { pka: { key: new Uint8Array(32).fill(3) } }), { code: 'damaged' });
    // the honest vault still opens (the duplicate check does not break a valid vault)
    const opened = mode === 'default'
      ? await openVault(vault, { pka: { key: new Uint8Array(32).fill(3) }, pkb: { key: new Uint8Array(32).fill(4) } })
      : await openVault(vault, { pka: { key: new Uint8Array(32).fill(3) }, pkb: { key: new Uint8Array(32).fill(4) } });
    assert.equal(opened.secret.length, 32);
  });
}
