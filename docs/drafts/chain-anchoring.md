# Draft: anchoring a sealed record on a blockchain (not offered, not announced, not linked)

This text was moved out of [encrypted-data.md](../encrypted-data.md) on 2026-10-18. The owner decided that the project does not mention a blockchain at all for now. The code it describes (`src/crypt-chain.js`: a `ChainAdapter` interface with an in-memory fake chain, the `TGA1` anchor payload, a fee estimate; the hidden `publish`/`fetch`/`verify` commands of `cli/tg-crypt.mjs`, reachable only with `TG_CRYPT_EXPERIMENTAL=1`) stays in the repository as an experiment with its tests; nothing in it talks to a real chain, nothing in the website or the public documents refers to it, and nothing may be offered before (a) the legal position of a commitment to encrypted personal data on a public chain is clarified, (b) the code has had an external review, and (c) the owner decides to announce it.

## The plain answer that was removed from the public page

**Can I store it on the blockchain and say that nobody can get at the data?** No, and the design does not claim it. What can truthfully be said is: *the record cannot be read without the key, as far as today's cryptography is known*. Specifically:

- Only a **commitment** (a SHA-256 of the sealed record, 37 to 80 bytes) goes on the chain. The data stays off chain, so the chain proves *that this exact record existed and has not changed*, not that anybody can still fetch it. If every copy is deleted, the data is gone (the chain does not keep it).
- If you put the sealed record itself on a chain (possible, many transactions, expensive), it is **public and permanent**: it cannot be withdrawn, re-keyed or erased, and anyone can copy it and try to break it for ever. Today that is safe with a random 256-bit key; it stops being safe if the key ever leaks, or if cryptography breaks in the future (AES-256 keeps 128 bits against a quantum computer, a 128-bit secret would keep 64).
- The chain still shows **metadata**: the time, the funding address and its history, the record's size unless padded, and any hint you add.
- Putting a commitment to encrypted *personal* data on a public chain may conflict with erasure rights; that is a legal question this project does not answer. Get advice before doing it.


## Open decisions that were deferred with it

- Profile A (a commitment anchor) or B (a real DigiAsset with IPFS) first: A needs only `getrawtransaction`, a key path and a store; B needs issuance and IPFS, which nothing here has.
- Whose address pays the anchor and is therefore linkable to the record: the user's own wallet (recommended, the user decides about their own linkability) or a platform key.
- Legal view of a commitment to encrypted personal data on a public chain (erasure rights): advice is needed before anything is offered.


## 7. DigiAssets on the DigiByte blockchain

### 7.1 What a host application needs on the chain side (assumptions, nothing transacted here)

The reference implementation talks to no chain. A host that wants to anchor records has to bring the following, and the design is written so that none of it is part of this repository:

- **A way to write one OP_RETURN output.** A transaction with one data output and a change output, built with `createrawtransaction`, signed and sent with `sendrawtransaction`. The payload limit of a standard OP_RETURN output is 80 bytes, which is why the anchor (section 7.3) is 37 to 80 bytes and carries a hash, not data.
- **Signing without a node wallet.** A node that runs without a wallet cannot sign; the host signs with its own key (`signrawtransactionwithkey`) or a key held elsewhere. Whose address pays is a decision with a privacy consequence (section 7.6).
- **A way to read a transaction.** `getrawtransaction <txid> true` on a node with `txindex=1` returns the outputs and the confirmations; `gettransaction` needs a wallet and is not enough.
- **Fees.** DigiByte's default minimum relay fee is 0.001 DGB per kB (100 satoshi per byte). `src/crypt-chain.js` estimates `size × relay fee × 2`, never below 10 000 satoshi, with size = 10 + 148 per input + outputs: **a 37-byte anchor is 48 000 satoshi = 0.00048 DGB; an 80-byte anchor is 56 600 satoshi = 0.000566 DGB**. Multiply by the day's DGB price; no price is assumed here.

### 7.2 What DigiAssets are (public documentation, not verified by running anything here)

A DigiAsset is issued by a DigiByte transaction whose OP_RETURN holds an encoded issuance (protocol header, amount, divisibility, lock status, and a pointer to metadata). The metadata (name, description, free data, URLs) is **not on chain**: the classic scheme points at it with a SHA-2 hash and a torrent hash; DigiAsset v3 stores metadata and binaries on IPFS and puts the CID in the transaction. The asset id derives from a transaction output (locked assets) or an address (unlocked ones). This document relies on exactly one fact of that design: **a DigiAsset's data lives off chain behind a hash or content id, and the chain proves what that hash was and when.** The exact byte layout of the issuance OP_RETURN was not checked against the specification; any real adapter must follow the DigiAsset Core / issuance-encoder specification, not this text.

### 7.3 The design: commitment on chain, sealed record off chain

```
 holder of the key                         chain                       anybody
 seal(TGD block, work) -> key + record
 record --sha256--> commitment
 store.put(record)  ---------------------------------------> content-addressed store (file, IPFS, the work itself)
 anchor(commitment) -----> OP_RETURN "TGA1" flags sha256 [hint]  (37 to 80 bytes)
                                  assetId = chain + txid:vout
                                                         fetch(assetId): read anchor from chain, get record by commitment,
                                                         check sha256(record) = commitment, then (only with the key) open
```

Two profiles share this:

- **Profile A, plain anchor.** One OP_RETURN transaction like the host's existing anchors. The asset id is the output (`dgb:tx:<txid>:<vout>`). Implementable with what the host has plus `getrawtransaction`.
- **Profile B, a real DigiAsset.** Issue a DigiAsset (amount 1, locked) whose metadata JSON carries the sealed record (`data.tgs1`) or its commitment; the asset's own metadata CID is then the commitment, the asset id is the DigiAsset id, and wallets and explorers show it. Needs DigiAsset issuance and IPFS, neither of which the host has. Owning the asset gives the right to *fetch* the record, **not** to open it: the key travels separately.

The record's commitment is the SHA-256 of the record bytes. With IPFS raw leaves and one block (up to 256 KiB), the record's CID is derived from it: `recordCid(commitment)` (`bafkrei…`, derived by the multiformats rules, not tested against a real IPFS node here), so no pointer needs to be stored: the commitment *is* the address. The optional hint (up to 43 bytes) names an extra place (a short URL).

### 7.4 What a reader does

1. Take the asset id; read the anchor from the chain (`getrawtransaction`, parse `TGA1`). Refuse a payload that is not ours (`bad-anchor`) or fewer confirmations than wanted (`unconfirmed`).
2. Get the record from any place that has it: the store derived from the commitment, a hint, the work's own `TGS1` block, a file somebody sent.
3. Compute SHA-256; refuse if it differs from the commitment (`commitment-mismatch`: the copy is damaged or replaced; this holds even if the store is malicious).
4. Open with the key and the work (`openSealed`). The key never touches the chain, the store or the adapter.

`verify(assetId, record)` does steps 1 and 3 only: "does the chain commit to exactly this record, and how deep is it".

### 7.5 Privacy: what the chain shows, what it does not

- Shown: a commitment (a SHA-256 of ciphertext: reveals nothing about the data), the time, the funding address and its history (pseudonymous, but linkable to a person if the wallet is), and the optional hint (never put anything sensitive in it).
- Not shown: the key, the work, the data, the data's size (unless the store is public: then the record size is visible; use `pad`).
- Strongest consequence: a record that is public for ever can be attacked offline for ever. A random 256-bit key makes that infeasible; **a password does not** (about 10 guesses per second per core at 600 000 iterations here, orders of magnitude more on a GPU). Therefore `publishSealed` refuses a password-only record unless `allowPassword` is set.

### 7.6 Guarantees and non-guarantees

| Guaranteed (if the key stays secret and AES-256-GCM and SHA-256 hold) | Not guaranteed |
|---|---|
| The record cannot be read without the key | **Availability.** A hash anchor does not keep the data alive: if every copy of the record is deleted, the data is gone for ever (tested: `unavailable`). Keep copies: in the work, in a pin, in a backup |
| The record cannot be changed without detection (commitment on chain, tag in the record) | **Erasure.** The commitment can never be removed from the chain. Whether a commitment to encrypted personal data counts as personal data, and what that means for erasure rights, is a legal question this document does not answer; do not publish personal data without advice |
| The anchor proves that this exact record existed when the transaction confirmed | **Authorship or truth.** Anybody can anchor any hash; the chain says nothing about who sealed it or whether the data is right |
| A different work or a wrong key is told apart from a damaged record | **Future-proof secrecy.** Today's cryptography may break; a public record keeps being collected |
| | **Cost stability.** Fees depend on the node's relay fee and the price of DGB |

### 7.7 Cost

- One anchor (profile A): 48 000 to 56 600 satoshi (0.00048 to 0.00057 DGB) per record, independent of the record's size.
- Putting the whole record on chain instead is technically possible with many OP_RETURNs (a 66-byte chunk per 80-byte payload with a 14-byte header): the 4 186-byte record would need 64 transactions, about 3.6 million satoshi (0.036 DGB), for ever on every full node, and cannot be erased. Not recommended and not built.
- Profile B: one issuance transaction of the same order plus dust-sized asset outputs (not measured here), plus IPFS pinning off chain (a service or an own node).

### 7.8 The adapter interface and what a host must provide

```js
class ChainAdapter {
  publish(record /*Uint8Array*/, { hint }) -> { assetId, txid, commitment /*hex*/, feeSat }
  fetch(assetId)            -> { record, commitment, txid, confirmations, hint }   // only returns a record whose SHA-256 equals the commitment
  verify(assetId, record)   -> { ok, reason, confirmations, commitment }           // chain-only
}
```

All three throw `CryptError` with codes `bad-asset`, `not-found`, `bad-anchor`, `unconfirmed`, `unavailable`, `commitment-mismatch`, `payload-too-large`. `publishSealed(adapter, workText, item, opts)` and `openFromChain(adapter, assetId, workText, { key })` are the adapter-agnostic flow; the adapter never sees a key. `tg-art` has no dependency on any host.

**What a host must provide** to implement this:

1. An adapter module with the three functions, registered at run time by the host (no dependency from this repository on the host, none from the host on this repository's code: the interface is the contract).
2. **Anchor writer**: a payload kind of its own: `TGA1` + flags + SHA-256 (+ hint), 37 to 80 bytes, through the same `createrawtransaction` / sign / `sendrawtransaction` path, with the fee from the size × relay fee estimate of section 7.1.
3. **A signing key.** If the node has no wallet, signing goes through the user's own key (`signrawtransactionwithkey`, the user pays the fee) or a key held elsewhere. Decide whose address pays (the privacy section above applies to it).
4. **`getrawtransaction`** (verbose, `txindex=1`) to read an anchor and its confirmations; reject a transaction with more than one data output or a payload that does not parse.
5. **A content-addressed store** with `put(bytes) -> locator` and `get(locator)`, the locator derived from the SHA-256 of the record, and optionally IPFS pinning with the CID of `recordCid`.
6. **Profile B only:** DigiAsset issuance (encoder, UTXO selection, asset-output dust), IPFS metadata upload, and an indexer to resolve an asset id to its metadata CID.
7. A policy line: never publish a password-sealed record without the explicit risk acceptance; surface `confirmations`; show the non-guarantees of section 7.6 before the first publish.

### 7.9 The reference implementation

`src/crypt-chain.js`: `anchorPayload`/`parseAnchorPayload`, `opReturnScript`, `estimateFeeSat`, `recordCid`, `ChainAdapter`, `FakeChain` (blocks, confirmations, JSON persistence, the 80-byte limit enforced), `FakeStore` (content-addressed, with test hooks to delete or replace a record), `FakeChainAdapter`, `publishSealed`, `openFromChain`, `verifyAsset`. The CLI keeps the fake chain in a JSON file and the store in a directory. It reproduces: the flow, wrong key and wrong work on a fetched record, a store that loses or replaces the record, unconfirmed anchors, unrelated outputs, an 80-byte limit refusing a whole record.


## Publishing wording (for a later adapter)


| Element | English | Deutsch |
|---|---|---|
| button | Publish on the blockchain | Auf der Blockchain veröffentlichen |
| confirm title | Publish a sealed record? | Versiegelten Datensatz veröffentlichen? |
| confirm text | Only a fingerprint (sha256) of the encrypted record goes on the chain. The key never does. This cannot be undone and the chain does not keep your data alive: keep a copy of the record. Estimated fee: {fee} DGB. | Nur ein Fingerabdruck (sha256) des verschlüsselten Datensatzes kommt auf die Blockchain, der Schlüssel nie. Das lässt sich nicht rückgängig machen, und die Blockchain bewahrt deine Daten nicht auf: Bewahre eine Kopie des Datensatzes auf. Geschätzte Gebühr: {fee} DGB. |
| refusal (`weak-for-chain`) | This record is protected only by a password. On a public chain anyone can try passwords on it for ever. Seal it with a key instead. | Dieser Datensatz ist nur durch ein Passwort geschützt. Auf einer öffentlichen Blockchain kann es jeder für immer ausprobieren. Versiegle ihn stattdessen mit einem Schlüssel. |

