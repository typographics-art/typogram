# Encrypted structured data in a work, key length, and DigiAssets

Specification, rationale and design of three connected things: (1) structured data ([TGD](structured-data.md)) that is **sealed** with a key so that a work carries only its public text and the key carries the data, (2) the length of such keys and how to shorten them without loss, (3) publishing a sealed record on the DigiByte blockchain as a DigiAsset-style record that anybody can fetch and only the key holder can open. Companion: [key-format.md](key-format.md) (formats side by side, grammar, all size tables).

Every number was measured with `node scripts/crypt-measure.mjs` on Node 26.11 with the code in `src/crypt*.js`; the conformance vectors are in `test/fixtures/conformance/crypt-vectors.json`; 36 tests cover the code (`test/encrypted-data.test.js`). Where a statement is not measured here it says so.

## Plain answers

**Is the encryption secure?** The cipher is. Sealed data uses AES-256-GCM from the platform's Web Crypto (Node's `crypto` behaves the same), with a random 256-bit secret, HKDF-SHA-256 to derive the key, and the record's header authenticated, so a wrong key, a wrong work and any changed byte are detected instead of decoded to garbage. Nothing here invents a cipher. What is *not* established:

- The code around the cipher (formats, work binding, bounds, compression, key encoding) was written for this project and tested (36 tests, conformance vectors, a review by an automated security tool that found and led to fixes). It has **not been independently audited**. For secrets whose loss would hurt, have it reviewed first.
- The security is the secrecy of the key. Whoever has the key (and the work, if the key is bound to it) opens the data. A lost key means lost data; there is no recovery.
- A **password** is much weaker than a random key (about 10 guesses per second per core at the default 600 000 PBKDF2 iterations, far more on a GPU), and a record on a public chain can be attacked for ever. `publishSealed` therefore refuses password-only records unless you explicitly accept that.
- The hidden messages of the generator (the book cipher, keys `tg1.`/`tg2.`) are **obfuscation, not encryption**: use sealed data for anything that must stay secret.

**Can I store it on the blockchain and say that nobody can get at the data?** No, and the design does not claim it. What can truthfully be said is: *the record cannot be read without the key, as far as today's cryptography is known*. Specifically:

- Only a **commitment** (a SHA-256 of the sealed record, 37 to 80 bytes) goes on the chain. The data stays off chain, so the chain proves *that this exact record existed and has not changed*, not that anybody can still fetch it. If every copy is deleted, the data is gone (the chain does not keep it).
- If you put the sealed record itself on a chain (possible, many transactions, expensive), it is **public and permanent**: it cannot be withdrawn, re-keyed or erased, and anyone can copy it and try to break it for ever. Today that is safe with a random 256-bit key; it stops being safe if the key ever leaks, or if cryptography breaks in the future (AES-256 keeps 128 bits against a quantum computer, a 128-bit secret would keep 64).
- The chain still shows **metadata**: the time, the funding address and its history, the record's size unless padded, and any hint you add.
- Putting a commitment to encrypted *personal* data on a public chain may conflict with erasure rights; that is a legal question this project does not answer. Get advice before doing it.

## 0. Status: implemented, designed only

| Part | State |
|---|---|
| Sealed records (`tgs1.`) and keys (`tgx1.`), AES-256-GCM, work binding, password option, compression, padding | **implemented**, tested, conformance vectors |
| Compact book-cipher key `tg2.` (bit-packed, Rice, checksum), reading of `tg1.` and `tg2.` through one function | **implemented**, tested |
| `TGS1[ … ]TGS1` blocks inside a work's text | **implemented** (`findSealedBlocks`); the work page finds such a block and offers its record in the *Sealed data* form; the generator does **not** write one (a key bound to a work cannot open a record that sits in that same text, because the record changes the text it is bound to) |
| On-chain anchor payload (`TGA1`), OP_RETURN script, fee estimate, IPFS CID derivation | **implemented** and tested as pure functions |
| `ChainAdapter` interface, in-memory `FakeChain`, `FakeStore`, `FakeChainAdapter`, whole publish/fetch/verify/open flow | **implemented** against the fake chain only |
| CLI `cli/tg-crypt.mjs` (seal, open, inspect, hide, reveal, publish, fetch, verify) | **implemented**; the bin line is `"tg-crypt": "cli/tg-crypt.mjs"` (package.json not edited) |
| Integration into `app.html`, `work.html`, `src/index.js`, README | **in the web: done** (see below); `src/index.js` exports `sealData`, `openSealed`, `findSealedBlocks`, `describeRecord`, `parseRecord`, `CryptError` |
| Web: seal in the generator panel *Data in this work* (`app#data`): random 256-bit key bound to the work, deflate, optional padding, key shown once with Copy and Clear, record with Copy and Download (.tgs); open on the work page (*Sealed data*: key, record or `.tgs` file, errors under **Open**); a saved work file can be opened from the computer | **implemented**, checked in headless Chrome (`scripts/check-web-data.mjs`: right key, wrong key of the same work, key of another work, typing error, changed record, no key, wrong prefixes, German) |
| **Still command line only**: passwords, compact book key `tg2.` in the generator, `inline` keys, brotli, a `TGS1` block written into a work, `publish`/`fetch`/`verify` on a chain | not in the web; the web never talks to a chain |
| A real DigiByte adapter, DigiAsset issuance, IPFS pinning (and any chain button in the web) | **designed only**; needs the host application (section 7.8); nothing here talks to a chain |
| Word-level book cipher, preset deflate dictionary, brotli in the generator | **designed only** (measured, rejected or deferred: key-format.md section 4.3) |

## 1. What was asked and what was decided

| Wish | Decision | Evidence |
|---|---|---|
| Encrypted structured data, built like the hidden messages, "the key just needs a clear rule" | A TGD block is **sealed** with AES-256-GCM. The key (`tgx1.`, 64 characters) holds a random secret tied to the work's text fingerprint; the ciphertext (`tgs1.`) is a separate public record, or travels inside the key, or inside the work as a `TGS1[ … ]TGS1` block. The rule is in section 5. | sections 3 and 4 |
| Key length and lossless compression | Keys do not grow with the data (64 characters for a one-word message and for a 200-row sheet). The data is deflated before encrypting: a 200-row sheet shrinks from 18 205 to 4 153 bytes (-77 %). The book-cipher key shrinks 13 to 23 % losslessly (`tg2.`), 58 to 71 % with a loss of unpredictability (opt-in). | key-format.md |
| DigiAssets | The chain carries a **commitment** (37 bytes: `TGA1`, flags, SHA-256 of the record) in one OP_RETURN; the record lives off chain at a content-addressed place. The adapter is three functions. | section 7 |

## 2. Threat models

Four holders, two designs. "Book cipher" means `tg1.`/`tg2.`; "sealed" means `tgx1.` + `tgs1.`.

| Attacker has | Book cipher | Sealed (AES-256-GCM, random key) | Sealed with a password |
|---|---|---|---|
| **the work only** (it is public) | learns nothing: no hidden layer exists in the work | learns nothing | learns nothing |
| **the record only** (public: a file, a chain store) | there is no record | learns size, whether it is bound to a work, whether compressed (padding hides the size); nothing else | the same, plus salt and iteration count |
| **the key only** (no work) | sees positions; **no integrity**; learns the frequency class of letters with `near K`; with a repeated letter and few occurrences also repeats | holds the secret but not the work text: if the key is bound, decryption needs the work's SHA-256, so the attacker must have or guess the text. For a public work this is no protection: **the work is a second factor only when it is not public** | there is no key string |
| **key and work** | reads the message (that is the design) | opens the data (that is the design) | opens it |
| **can try keys** (online or offline guessing) | any position list "decodes" to something: there is no check that it is the right message, only the fingerprint; guessable, not authenticated | a 256-bit secret: 2^256 guesses; every wrong key fails the GCM tag, never decodes to garbage | per guess cost 96 ms of PBKDF2 at 600 000 iterations on this machine (about 10 guesses per second per core); a low-entropy password falls to an offline attack on a public record |
| **can forge** | anybody with the work can build a key that "reveals" any message they like (no authentication) | cannot forge a record without the key; the GCM tag and the authenticated header detect any change to any byte (tested: every byte flipped, every truncation, every key character changed) | the same |
| **a future attacker with a quantum computer** | irrelevant: nothing to break | AES-256 keeps 128 bits against Grover; 128-bit secrets (`strength: 128`) would keep 64: a record on a blockchain is permanent, so 256 is the default | depends on the password |

**Plain statement: the book cipher is obfuscation, not encryption.** It hides a message from someone who looks at the work and the key without knowing the scheme, and from nobody else. [hidden-messages.md](hidden-messages.md) already says it is no replacement for encryption; this document makes the rule: **data that must stay secret is sealed, never book-ciphered.** The sealed design is encryption in the usual sense, with the usual caveats (the key is the secret; a lost key means lost data; compression before encryption leaks the compressed size, which padding hides).

## 3. Three designs compared

**(a) Book cipher over the serialised TGD text.** Every character of the TGD text becomes a position in the work.

- Size: 3 bytes (`tg1.`) or 20 bits (`tg2.`) per character. A 200-row sheet is 17 760 characters of TGD text: about 60 600 characters of key at best (`tg2.`, 600k-character work), about 71 000 with `tg1.`; the key is longer than the data it hides.
- It **cannot work for most works**: the characters of a TGD block (`{`, `}`, the middle dot, `@`, `è`, …) must all occur in the work. Measured for the 72 distinct characters of the sheet: absent from a 3 000-character work 13, from a 50 000-character work 4, from a 600 000-character work 5 (`{`, `}`, `·`, `@`, `è`). A character that does not occur cannot be hidden, so the sheet cannot be hidden at all.
- It is obfuscation (section 2): a forged key reveals anything; nothing detects a changed or wrong key but the fingerprint.

**(b) Authenticated encryption.** AES-256-GCM (Web Crypto, `node:crypto` not needed), content key `HKDF-SHA256(secret, info = "tgx1/aes-256-gcm" ‖ SHA-256(canonical text))`, header authenticated.

- The key does not depend on the data size (64 characters). The record is the compressed data plus 32 bytes.
- Wrong key, wrong work, any changed byte: detected by the tag, named (`wrong-work` from the fingerprint in the key, `auth-failed` otherwise), never decoded to garbage.
- The ciphertext can be separate (public, `tgs1.`), inside the key (`inline`, one string), or inside the work as text.

**(c) Hybrid: positions index a small secret, the data is encrypted.** Hide the 32-byte secret as 64 hexadecimal characters of the work with the book cipher; encrypt the data with it.

- Measured: 236 characters (`tg2.`) or 271 (`tg1.`) against 64 for the `tgx1.` key that holds the same secret directly, so 3.7 to 4.2 times longer.
- Security gained: none. The key holder who has the work reads the secret; the key holder without the work is in the same position as with (b) (needs the work's text). The only difference is that the positions look like a book-cipher key, which is not a protection.
- **Rejected.** (b) with the fingerprint binding gives the same properties at a quarter of the length.

**Decision: (b).** The work is bound by deriving the content key from SHA-256 of its canonical text ([text-fidelity.md](text-fidelity.md)): the same canonical text the hidden messages use, so a key survives exactly what a `tg1.` key survives (re-setting the text into another picture, reading it back from a PDF, NFC differences: tested).

## 4. Measurements

### 4.1 What a book cipher would cost for a sheet

See section 3(a). Script: `node scripts/crypt-measure.mjs payload`.

### 4.2 The payload

200 rows, 6 columns, seeded; details and the full table in key-format.md section 4.1.

| step | bytes |
|---|---|
| source CSV | 14 440 |
| TGD block (whitespace-free body, what is sealed) | 18 205 |
| deflated by `CompressionStream` (what every browser has) | 4 153 |
| the sealed record | 4 186 (33 bytes more: 2 header, 12 nonce, 16 tag, 2 inner length and kind) |
| the record as text (base64url) | 5 587 characters |
| the key | 64 characters |

Compression is lossless and happens **before** encryption (ciphertext does not compress). Brotli would give 3 264 bytes for the record; browsers may lack it, so it is an option and a reader without it says so.

## 5. The rule for structured data

1. **What is sealed.** The TGD *body*: the text between `TGD1[` and `]TGD1` of an encoder-made block, with every whitespace and invisible character removed (`stripText`; whitespace is not significant in TGD, so one block has one canonical sealed text). The profile is whichever the block declares: every TGD 1.x model (workbook, JSON, Markdown, YAML, XML, calendar, contacts). The envelope's own `sum` stays inside, so after opening the block is checked a second time.
2. **How it is sealed.** The body is UTF-8, raw-deflated if that is smaller, prefixed by a `kind` byte (1 = TGD body, 2 = text, 3 = bytes) and a length, padded with zeros to a multiple of `pad` bytes if asked, and encrypted with AES-256-GCM under the content key. 12 random bytes of nonce; the 16-byte tag authenticates the ciphertext and the header (version, flags, salt, iterations).
3. **What the key encodes.** `tgx1.` + base58 of: version, flags, the secret (16 or 32 random bytes), the first 8 bytes of SHA-256(canonical text of the work) when bound, optionally the whole record, and a 2-byte check. The rule is one sentence: *the key is the secret plus the name of the work it opens; the record is the data.*
4. **How the data is recognised after opening.** Not by guessing: the `kind` byte says "TGD body", the body is wrapped in `TGD1[` … `]TGD1` and decoded by the TGD reader, which requires a valid envelope and a matching `sum`. Anything else is a failure (`not-tgd`), not data.
5. **Where the record lives.** Separate file (`.tgs`), inside the key (`inline`, at most 32 KiB), inside the work's text as `TGS1[ … ]TGS1` (the work then carries visible ciphertext, declared and checkable like a TGD block), or at a content-addressed location named by an on-chain commitment (section 7).
6. **Limits.** Sealed data up to 16 MiB unpacked (`LIMITS.maxPlain`), a record up to 24 MiB, a key carries at most 32 KiB of record, at most 64 `TGS1` blocks per text. A key string longer than 44 817 characters, a `tg2.` key longer than 11 212, a `tg1.` key longer than 400 000, and a record string longer than 33 554 441 characters are refused before any decoding. A decoder never inflates more than the limit (measured: a record of 15 328 bytes that inflates to 15 MiB is refused after 16 ms against a 1 MiB limit; opened in full it takes 52 ms). PBKDF2 counts above 5 000 000 or below 100 000 in a record are refused.
7. **Failure messages** (code, message; each is a `CryptError`, nothing else is ever thrown by a reader):

| code | message |
|---|---|
| `no-key` | Paste the key first (it starts with "tgx1.") |
| `bad-prefix` | Not a sealed-data key (it starts with "tgx1.") / Not a sealed record (it starts with "tgs1.") |
| `damaged` | The key is damaged / too short / too long to be a key / The sealed record is damaged |
| `checksum` | The key has a typing error (its check characters do not match) |
| `version` | This key has format version N; this reader understands 1 |
| `work-required` | This key is tied to a work: give the work (its text) |
| `wrong-work` | This key belongs to a different work (or the text was changed) |
| `no-record` | This key does not carry the data: give the sealed record too |
| `auth-failed` | Wrong key, a different work, or the record was changed (password: Wrong password, …) |
| `too-large` | The data is larger than N bytes once unpacked |
| `not-tgd` | The opened data is not a valid TGD block |
| `need-password` / `need-key` | This record is sealed with a password / with a key |
| `unsupported-compression` | This record is compressed with brotli, which this platform cannot read |

8. **What is not promised.** Metadata leak: record size (hidden by padding), "bound or not", "password or key", the compression method. A bound key is not secret from anyone who has the work text. A key shown on screen is as safe as the screen.

## 6. Key length and compression

All tables, the grammar in EBNF and the byte layouts are in [key-format.md](key-format.md). The short version:

- Book-cipher keys grow by 4 characters per message character with `tg1.`, 3.4 with `tg2.`, about 1.2 with `tg2.` and nearest-occurrence choice.
- Lossless: bit packing (-13 to -23 %), base58 instead of base64url (+2.4 %, no chat-markdown trouble), deflating the payload before sealing (-77 % for a sheet).
- Not lossless in security: choosing occurrences near the previous one (`near K`). With K = 8 the encoder's randomness per character falls from 11.2 bits to 3.0 bits and a key-only attacker learns 0.55 of the 4.15 bits of each character; the key is 58 to 71 % shorter. It stays opt-in (`hideCompact(…, { near: K })`) and the UI must say what it costs.
- Sealed keys are fixed-length: 64 characters (256 bit, bound), 42 (128 bit), 53 and 31 unbound.

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

## 8. Integration plan (patch sketches; the web part is built, differences in section 0 and in structured-data-ui.md, Implementation status)

### 8.1 `src/index.js`

```js
+export { sealData, sealMessage, sealBytes, openSealed, parseKey, parseRecord, describeRecord, findSealedBlocks, CryptError } from './crypt.js';
+export { hideCompact, revealCompact, revealAny } from './crypt-book.js';
+export { anchorPayload, parseAnchorPayload, recordCid, ChainAdapter, FakeChain, FakeStore, FakeChainAdapter, publishSealed, openFromChain } from './crypt-chain.js';
```

`crypt.js` imports `structured.js` (all file formats) for the TGD reader; if bundle size matters for the generator, split `decode` of the envelope out of it.

### 8.2 `app.html`: the existing `<details id="secretBox">` ("Hidden message")

```html
 <details id="secretBox">
   <summary data-i18n="secret.summary">Hidden message</summary>
+  <fieldset class="seg" id="secretMode"><legend class="sr" data-i18n="secret.mode">Kind of key</legend>
+    <label><input type="radio" name="secretMode" value="tg2" checked> <span data-i18n="secret.mode.tg2">Short key</span></label>
+    <label><input type="radio" name="secretMode" value="tgx1"> <span data-i18n="secret.mode.tgx1">Sealed (encrypted)</span></label>
+  </fieldset>
+  <p class="hint" id="secretModeHint" role="note"></p>   <!-- text depends on the choice, section 9.1 -->
   ... existing textarea, buttons, key field ...
+  <label class="lbl" for="sealedRecord" data-i18n="secret.record">Sealed record</label>
+  <textarea id="sealedRecord" rows="3" spellcheck="false" readonly></textarea>
+  <div class="row2"><button id="recordCopy">Copy record</button><button id="recordInWork">Add record to the work's text</button></div>
 </details>
```
JS: `secretHide` calls `hideCompact` or `sealMessage(workText, message)` according to the mode; `secretReveal` calls `revealAny` for `tg1.`/`tg2.` and `openSealed` for `tgx1.`; the checks that now say `tg1.` (`secretNoKey`, `secretBadKey`) name the three prefixes. For TGD data: in the data-file card (structured-data-ui.md section 1) a checkbox "Seal the data" adds `sealData(text, block)` after the work is made, and by default the generator then writes **no** TGD block into the work; with "Also add the sealed record to the work's text" it writes `TGS1[ … ]TGS1` instead.

### 8.3 `work.html`: Machine view

A card "Sealed data" under the checksum grid, shown when `findSealedBlocks(canonicalText)` finds blocks (or always collapsed): key field, record field (filled from the first block), **Open**. Result: the TGD model as a table with the same download buttons as the existing data card; error box directly under **Open** (section 9.3). `openSealed(canonicalWorkText, { key, record })` runs in the page; nothing leaves the browser.

### 8.4 CLI and package

`package.json`: `"bin": { …, "tg-crypt": "cli/tg-crypt.mjs" }`, `"files"` already includes `cli`. Secrets: there is **no `--key` or `--password <value>`** (they would show in the process list and the shell history; the parser rejects them and its refusal never echoes the text). A key comes from `--key-file`, `--key-stdin` or `TG_CRYPT_KEY`; a password from `--password-file`, `--password-stdin` or `TG_CRYPT_PASSWORD`; `seal` and `hide` print the key to standard output only, progress goes to standard error and never contains a key, password or message. Tested: option refusal without echo, the three paths, an invalid key's error without the key.

### 8.5 Docs

README and `docs/hidden-messages.md`: one paragraph each pointing here ("for data that must stay secret use sealed data"); `docs/structured-data.md` section 12: a cross-reference to section 5 above. Not edited here (other agents own those files).

## 9. User interface design

API terms stay English (`tgx1`, `tgs1`, `TGD`, `sha256`, `AES-256-GCM`, `.tgs`); the rest is English and German. As in [structured-data-ui.md](structured-data-ui.md): every message is visible (its own box, contrast, an icon that is not the only signal), placed **directly under the action that caused it**, says what to do, and is announced (`role="alert"` for errors, `role="status"` for progress; focus moves to the box when an action fails).

### 9.1 Generator: the Hidden message panel

| Element | English | Deutsch |
|---|---|---|
| mode legend | Kind of key | Art des Schlüssels |
| mode 1 | Short key | Kurzer Schlüssel |
| mode 2 | Sealed (encrypted) | Versiegelt (verschlüsselt) |
| hint, mode 1 | Hides the message from a glance. Anyone who knows how it works and has the key and this work can read it. Not encryption. | Versteckt die Nachricht vor einem flüchtigen Blick. Wer das Verfahren kennt und Schlüssel und dieses Werk hat, kann sie lesen. Keine Verschlüsselung. |
| hint, mode 2 | Encrypts the message with AES-256-GCM. Only the key opens it, and only together with this work. Keep the key like a password: if it is lost, nobody can open the message. | Verschlüsselt die Nachricht mit AES-256-GCM. Nur der Schlüssel öffnet sie, und nur zusammen mit diesem Werk. Bewahre den Schlüssel wie ein Passwort auf: Geht er verloren, kann niemand die Nachricht öffnen. |
| option | Also put the sealed record into the work's text | Versiegelten Datensatz auch in den Text des Werks schreiben |
| option help | The work then contains visible, encrypted text. Without it, keep the record file safe: the key alone does not hold the data. | Das Werk enthält dann sichtbaren, verschlüsselten Text. Ohne diese Option den Datensatz sicher aufbewahren: Der Schlüssel allein enthält die Daten nicht. |
| option | Key carries the data (one string, up to 32 KiB) | Schlüssel enthält die Daten (eine Zeichenkette, bis 32 KiB) |
| made (status) | Sealed. Key: 64 characters, record: {n} characters. | Versiegelt. Schlüssel: 64 Zeichen, Datensatz: {n} Zeichen. |
| made, reminder | The key is shown once and is not stored. Copy it now. | Der Schlüssel wird nur jetzt angezeigt und nicht gespeichert. Jetzt kopieren. |
| buttons | Seal / Open / Copy key / Copy record / Download record (.tgs) | Versiegeln / Öffnen / Schlüssel kopieren / Datensatz kopieren / Datensatz laden (.tgs) |

Data file card (structured-data-ui.md section 1.1), one extra line: `[ ] Seal the data: only the key opens it` / `[ ] Daten versiegeln: nur der Schlüssel öffnet sie`; when ticked the preview stays, the card says "The work will not contain this data. You get a key and a sealed record." / "Das Werk enthält diese Daten nicht. Du erhältst einen Schlüssel und einen versiegelten Datensatz."

### 9.2 Publishing (later, with a real adapter)

| Element | English | Deutsch |
|---|---|---|
| button | Publish on the blockchain | Auf der Blockchain veröffentlichen |
| confirm title | Publish a sealed record? | Versiegelten Datensatz veröffentlichen? |
| confirm text | Only a fingerprint (sha256) of the encrypted record goes on the chain. The key never does. This cannot be undone and the chain does not keep your data alive: keep a copy of the record. Estimated fee: {fee} DGB. | Nur ein Fingerabdruck (sha256) des verschlüsselten Datensatzes kommt auf die Blockchain, der Schlüssel nie. Das lässt sich nicht rückgängig machen, und die Blockchain bewahrt deine Daten nicht auf: Bewahre eine Kopie des Datensatzes auf. Geschätzte Gebühr: {fee} DGB. |
| refusal (`weak-for-chain`) | This record is protected only by a password. On a public chain anyone can try passwords on it for ever. Seal it with a key instead. | Dieser Datensatz ist nur durch ein Passwort geschützt. Auf einer öffentlichen Blockchain kann es jeder für immer ausprobieren. Versiegle ihn stattdessen mit einem Schlüssel. |

### 9.3 Work page: opening sealed data (and every error, under **Open**)

| code | English | Deutsch |
|---|---|---|
| `no-key` | Paste the key first. It starts with “tgx1.”. | Zuerst den Schlüssel einfügen. Er beginnt mit „tgx1.“. |
| `bad-prefix` | This is not a key. A key starts with “tgx1.”, “tg2.” or “tg1.”. | Das ist kein Schlüssel. Ein Schlüssel beginnt mit „tgx1.“, „tg2.“ oder „tg1.“. |
| `checksum` | The key has a typing error. Copy it again in full. | Der Schlüssel enthält einen Tippfehler. Bitte noch einmal ganz kopieren. |
| `damaged` | The key or the record is damaged or incomplete. Copy it again in full. | Der Schlüssel oder der Datensatz ist beschädigt oder unvollständig. Bitte noch einmal ganz kopieren. |
| `wrong-work` | This key belongs to a different work, or the text was changed. Open the work the key was made for. | Dieser Schlüssel gehört zu einem anderen Werk, oder der Text wurde verändert. Das Werk öffnen, für das der Schlüssel erzeugt wurde. |
| `no-record` | This key does not contain the data. Paste the sealed record too (it starts with “tgs1.”). | Dieser Schlüssel enthält die Daten nicht. Den versiegelten Datensatz auch einfügen (er beginnt mit „tgs1.“). |
| `auth-failed` | The key does not open this record, or the record was changed. Check that the key and the record belong together. | Der Schlüssel öffnet diesen Datensatz nicht, oder der Datensatz wurde verändert. Prüfen, ob Schlüssel und Datensatz zusammengehören. |
| `too-large` | The data is too large to open here. | Die Daten sind zu groß, um sie hier zu öffnen. |
| `unsupported-compression` | This record uses a compression your browser cannot read. Open it with tg-crypt. | Dieser Datensatz nutzt eine Kompression, die dein Browser nicht lesen kann. Mit tg-crypt öffnen. |
| success | Opened. The data block is intact (sha256 {sum}). | Geöffnet. Der Datenblock ist unversehrt (sha256 {sum}). |

Rules: the same box for key and record errors, placed under **Open**, never under the field that was not just used; the key field is never cleared on an error; a key is never put into a URL, a log line or an error message.

## 10. Conformance vectors

`test/fixtures/conformance/crypt-vectors.json`, built by `node scripts/build-crypt-vectors.mjs`: sealed records of every mode (bound stored, bound deflate, unbound 128-bit message, inline padded, password, brotli), seven negatives with their error codes, `tg1.`, `tg2.` (fixed, near, short fingerprint) keys, anchor payload, script, fee, CID, and base alphabet vectors. "exact" vectors must be reproduced byte for byte from the seeded random source; "open" vectors (deflate, brotli: compressor output differs between implementations) must only open to the stated plaintext. One complete vector, unbound 128-bit message, stored (not compressed), seeded random `tg-crypt/3`:

```
plaintext  "Meet at the harbour, 6 pm. Zürich 😀"
key        tgx1.phou8J2FseBeEyCKsb3Q2nMxvY
record     tgs1.AQAPo6u5vVvIK6zkXG4Hp2vneVgFzF4l-A3f3R-pHcH_FukJdYV3uVTHUVZzf8SCFg1fsxXbneNcWvQIR0W5v10NIKevO8k
```
Decoding the key: base58 gives version 1, flags 4 (16-byte secret, unbound, no record), 16 secret bytes, 2 check bytes. Decoding the record: version 1, flags 0, 12-byte nonce, ciphertext, 16-byte tag; the content key is `HKDF-SHA256(secret, salt "tgx1/salt", info "tgx1/aes-256-gcm")` (nothing appended as it is unbound), AAD `"tgs1" ‖ 01 00`.

## 11. Hardening notes (from review)

- Every decoder is bounded **before** it does work: key strings by lengths derived from the format's own limits (section 5.6), base58 and base64url decoders take a maximum length, varints read at most 7 bytes, Rice unary runs are bounded by the text length, a message of a compact key by 2 048 characters, inflation by an output cap checked chunk by chunk. Tests: a 5 MB key, a 100 KB key of valid characters, a 200 MB record string, a deflate bomb (15 MiB in 15 KiB) each fail in well under a second with a `CryptError`.
- Secrets never go on a command line (section 8.4).
- Error messages are constants: they never contain the key, password or message (tested for the CLI).

## 12. Open questions for the owner

1. **Chat length.** A bound 256-bit `tgx1.` key is 64 characters; an unbound 128-bit one 31. Is "key only fits one work" worth 11 characters and the wrong-work message? (Default: yes.)
2. **Brotli in the generator?** 22 % smaller records, but not every browser can read them. (Default: deflate; brotli behind an option.)
3. **Profile A or B first for the chain?** A needs only `getrawtransaction`, a key path and a store; B needs DigiAsset issuance and IPFS, which the host does not have.
4. **Whose address pays** and is therefore linkable to the record: the user's own wallet or a platform key?
5. **Should the generator ever write a `TGS1` block into the work by default?** (Default: no; the work stays free of ciphertext unless asked.)
6. **Legal view** of a commitment to encrypted personal data on a public chain (erasure rights): needs advice before profile A or B is offered to the public.
