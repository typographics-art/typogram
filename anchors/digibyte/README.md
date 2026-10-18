# DigiByte anchor — wanted, a good first contribution

This is an **open task**: a `digibyte` anchor plugin for Typogram key statements. It is not built in, and it has no special
status over any other chain — the format treats every anchor the same (see [`../README.md`](../README.md)). If you like
DigiByte, or want a worked example of adding a chain anchor, this is a clean, self-contained place to start.

## What it does

Anchoring writes the SHA-256 of a signed key statement into a public, append-only place, so that later anyone can prove the
key existed at a point in time and was not quietly swapped. For DigiByte that place is an `OP_RETURN` output in a transaction:
small, permanent, and readable by any DigiByte node or explorer.

## The contract to implement

Your module must export exactly this (the shape every anchor shares):

```js
export const type = 'digibyte';
export const title = 'DigiByte';

// Write the 64-hex digest to the chain; return a compact, self-describing reference string to store in the key statement.
export async function anchor(digestHex) { /* … */ return reference; }

// Check the reference proves `digestHex` was written; return { ok, time, detail? }. `time` is ISO 8601 (the block time) or null.
export async function verify(digestHex, reference) { /* … */ return { ok, time, detail }; }
```

Suggested design (change it if you have a better one, and say why in your PR):

- **`anchor(digestHex)`** builds a transaction with one `OP_RETURN` output carrying `tgart:` + the 32 raw digest bytes
  (well under the 80-byte `OP_RETURN` limit), signs it with a funded DigiByte wallet, broadcasts it, and returns the
  `reference` — at least the `txid`, and ideally a compact SPV-style proof (the `OP_RETURN` script + the Merkle branch to the
  block header) so `verify` needs no full node.
- **`verify(digestHex, reference)`** resolves the transaction, confirms an `OP_RETURN` output commits to `digestHex`, and
  returns the block's time. State plainly in the README what a verifier must trust: a DigiByte node they run, or an explorer
  API they pick. A `reference` that carries its own Merkle proof is strongest, because then only a block header is trusted.

## Honest limits (please keep these in your README)

- Unlike the built-in `rekor` and `opentimestamps` anchors, writing to DigiByte **costs a small network fee** and needs a
  funded wallet. That is why it is opt-in, not default.
- An anchor proves **existence and time**, never the **domain binding** — "this key is typographics-art.org's" still comes
  from the signed key statement and the issuer list, not from any chain.
- No own cryptography: use DigiByte's standard transaction format and a maintained library; do not roll your own signing.

## Acceptance

`node --test anchors/digibyte/digibyte.test.js` turns the skipped specs into real tests: stamp a known digest on DigiByte
testnet, then verify the returned reference resolves to an `OP_RETURN` committing to that digest with a block time, and that a
wrong digest fails. Keep it on **testnet** in tests so no real coin is spent.

Questions or a design you want to discuss first? Open an issue. See [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) and the
[code of conduct](../../CODE_OF_CONDUCT.md).
