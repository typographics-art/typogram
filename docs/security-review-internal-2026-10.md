# Internal security review of the cryptographic code, October 2026

> **What this is, in three lines.** An adversarial review of this repository's cryptographic code and of the parsers that read untrusted files, done by **an AI agent** (a large language model with a shell and this repository, starting with a fresh context). It found and fixed real defects, and it measured many properties. It is **not an independent audit**, it was not done by a cryptographer, and it must not be quoted as one. Section 12 says what it can and cannot show and what a real external review should cover.

Reviewed state: `main` at `6f594be` (Typographics Art 0.1.0). Every fix is a small commit on the branch `security-review`; the commit ids are in section 3 and, in order, in section 13. Language of the code and of this report: English (API terms stay English).

## Contents

1. Summary
2. Scope and method (tools and versions)
3. Findings that were fixed
4. Findings that were not fixed, and why
5. Known-answer tests: the vector table
6. Differential tests
7. The cryptographic checklist, item by item
8. Semgrep
9. Fuzzing
10. Measurements in real browsers
11. What the review did not cover
12. What this is and is not (and what an external review should cover)
13. How to repeat it

## 1. Summary

- **No break of confidentiality or authenticity was found.** The cipher is used as documented; the glue around it (key derivation, domain separation, additional authenticated data, work binding, record layouts, key encodings) agrees byte for byte with independent re-implementations written from the specification text, and every building block reproduces the published test vectors.
- **Real defects were found, none of them in the cryptography itself.** They are in the parsers and in the places where the code meets untrusted or unusual input: quadratic regular expressions (a data file could stall a reader for minutes), an encoder that wrote data blocks the decoder refuses (a sealed record of such a block would never open: silent loss of the data), raw exceptions where a named error belongs, a command-line default that overwrote an earlier sealed record, and a few robustness gaps. 14 items were fixed (4 Medium, 7 Low, 3 Info; none High), and 8 observations were not fixed, each with its reason.
- **Tests:** the suite went from 293 to 365 tests, all green; the browser check from about 110 to 158 checks (48 of them added by this review: 47 hostile-data checks and one on where a key can be found). The regression tests of F1 to F5 and F9 to F13 were run against the code before the fix and failed there; the tests of F8 and F14 and the controls (hostile keys, decompression bombs, small-order points, the hygiene tripwire) pin behaviour that did not change.
- **Fuzzing:** 450 000 deterministic cases on the final code (seeds 301 to 303) plus 17712 hostile run shapes: 0 findings; the slowest ordinary case took 637 ms  the slowest hostile shape 51 ms (earlier runs on earlier code found the defects fixed in section 3).
- **Semgrep:** 512 hits of the local rules, all triaged in section 8 (no defect remains; the rules that fired most are informational by design); 0 Semgrep errors.

## 2. Scope and method

**Scope** (as asked): `src/crypt.js`, `crypt-codec.js`, `crypt-book.js`, `crypt-chain.js`, `keys.js`, `keys-kdf.js`, `keys-seal.js`, `keys-work.js`, `keys-split.js`, `secret.js` (about 1 700 lines), `src/structured*.js` (the parsers of untrusted files), `src/data-ui.js`, `data-panel.js`, `data-panel-ui.js`, `data-reader-ui.js` (what the pages do with decrypted data and keys), `cli/tg-crypt.mjs`, `cli/tg-keys-cmds.mjs`, `cli/tg-data.mjs`, `api/*.mjs` (payment logic had been reviewed before: spot-check only), the vendored `assets/vendor/noble-hashes` (Argon2id; tested, not read line by line), the inline scripts of the HTML pages (because they show decrypted data), `_headers` (the Content-Security-Policy). Specifications read: `docs/encrypted-data.md`, `docs/key-management.md`, `docs/cipher-review.md`, `docs/passwords-and-keys.md`, `docs/key-format.md`.

**Method.** (1) Read the code against the specifications and the checklist of section 7. (2) Known-answer tests of every building block against published vectors (section 5). (3) Differential tests: independent re-implementations written from the specification text with `node:crypto` only, compared in both directions (section 6). (4) Adversarial probes: every size bound, decompression bombs, long runs of one token behind every lead-in of every format, hostile keys. (5) A deterministic fuzzer (section 9). (6) Semgrep with local rules (section 8). (7) Headless Chromium and Firefox for the things only a browser shows (section 10). (8) Fix, with a regression test that fails before and passes after.

**Tools and versions.** Node.js v26.11.1 (V8 14.6, ICU 78.3, Unicode 17.0); Semgrep 1.155.0 with **local rules** only (`scripts/semgrep-js-security.yml`: the registry packs need the network, and nothing is cached here; Semgrep also needed `EIO_BACKEND=posix` to start in this environment); Chromium 154.0.8037.97 and Firefox 157.0.1 (headless); `@noble/hashes` 2.4.0 as vendored (its `SHA256SUMS` verified: all files OK); Python 3 only for editing. No network service was contacted except for downloading public standards documents, see section 5.

**Time and effort.** One working session of an AI agent; there was no measurement of effort in person-days, which is why section 12 gives an estimate for a human review instead.

## 3. Findings that were fixed

Severity scale: **High** = confidentiality or authenticity can be broken; **Medium** = data can be lost or a reader can be stalled by a crafted file, reachable in normal use; **Low** = robustness (a raw error, a crash of one view) or defence in depth; **Info** = hardening. Nothing High or Critical was found.

| ID | Severity | Finding | Fixed in | Regression test |
|---|---|---|---|---|
| F1 | Medium | Five quadratic regular expressions (YAML, Markdown ×2, XML declaration, text structure): one line with a long run of spaces stalled the reader | `ea0807b` | `security-regression-redos` |
| F10 | Medium | The encoder wrote blocks the decoder refuses (nesting, 4 M values, 8 M-character text): a sealed record of one never opens | `9319a36` | `security-regression-robustness` (F10) |
| F11 | Medium | `sealData` sealed any block text without checking that it can be read back | `852a0fb` | (F11) |
| F13 | Medium | `tg-crypt seal` / `fetch` replaced an existing record file silently: the key printed earlier then opened nothing | `1dd6c5a` | `security-regression-controls` (F13) |
| F2 | Low | A damaged `.xlsx` ended in a raw `TypeError` (relationship without `Target`, missing comments part) | `ca5434f` | (F2) |
| F3 | Low | `hideSecret` overflowed the call stack for secrets above about 40 000 characters | `ca5434f` | (F3) |
| F4 | Low | A sparse sheet with a cell in row 1 048 576 stalled the column summary for 3.4 s and overflowed the stack (and a workbook with 200 000 sheets did too) | `ca5434f` | (F4) |
| F5 | Low | A writer meeting a model of an unexpected shape raised a `TypeError` instead of a named error | `ca5434f` | (F5) |
| F12 | Low | A data block in a work whose model has an unexpected shape (anyone can put one there, no key needed) made the Machine view throw for the whole work | `8cb61e0` | (F12) |
| F9 | Low | The generator page put an error message into `innerHTML` unescaped (no path from file data found; defence in depth) | `ca5434f` | (F9, tripwire) |
| F14 | Low | Base58 conversion at the maximum key length (a key carrying a 32 KiB record) took 3.3 s to parse | `95f5eac` | `known-answer` (base58, large sizes) |
| F8 | Info | Check values were compared with an early exit; now constant time | `15287a4` | (F8) |
| T1 | Info | The Semgrep weak-cipher rule did not apply its mode filter; fs-path rule likewise (tooling) | `78641c5`, `adde6f9` | – |
| T2 | Info | Test and tool sources kept invisible characters as raw characters; now escapes | `9319a36` | – |

**F1, quadratic regular expressions.** The sites: `structured-yaml.js` `s.replace(/\s+#.*$/, '')` and `…replace(/\s*#.*$/, '')` (comments); `structured-md.js` the ATX heading expression, `para.at(-1).replace(/[ \t]+$/, '')` (end of a paragraph); `structured-xml.js` `/^<\?xml\s+([^?]*)\?>/` (two overlapping loops); `structure.js` `/^(#{1,6})\s+(.+?)\s*#*$/` (the section splitter of the Read view). Measured before the fix (Node 26, run alone): 80 000 spaces in a YAML value: 2.6 s; in a Markdown heading: 5.9 s; `<?xml ` plus 60 000 spaces: 1.6 s; the time grows with the square, so a 1 MB line would take on the order of 15 minutes (extrapolated, not measured). The data panel runs the readers in a worker (the page stays responsive), the command line simply hangs. After the fix every one of these takes a few milliseconds. The replacements are linear functions with the **same results**: `cutComment` was compared with the old expressions on all 2 015 539 strings up to length 8 over `{space, tab, #, a, newline, U+2028}`, the heading matcher on all 488 281 lines up to length 8, the text-structure heading on 348 502. A sweep of 17 712 hostile shapes (section 9) found no further slow case. One suspicion did **not** hold: the sheet-name expression `/^'+|'+$/g` in `structured-xlsx.js` is not quadratic in V8 (measured with 300 000 apostrophes: 86 ms), and was left alone.

**F10 and F11, blocks that cannot be read back.** `parseJson` refuses nesting deeper than 64, more than 4 000 000 values and a string longer than 8 000 000 characters; `decodeAll` refuses a block longer than 64 000 000 characters. The encoder knew none of these limits. Measured before the fix: XML nested 63 or more deep, JSON nested 63 and 64 deep, Markdown lists nested 21 to 32 deep (140 of the depths 1 to 120 tried over ten shapes gave a block that did not decode), a CSV with 5 million cells and a CSV with one 9-million-character cell were all encoded without error and the result did not decode. For a *written* work the panel's read-back check catches that; for a **sealed** record there is no check, so the key and the record were handed over, and opening them later reported `not-tgd`: the data was gone if the original file was gone. Fix: `seal()` in `structured.js` now counts depth, values and string length on the finished model exactly as `parseJson` counts them and refuses with the code `limit` and a message that says why; `sealData` additionally decodes the block it is given before it seals it. Checked: for xml, json, markdown and yaml, at every depth from 1 to 120 either the encoder refuses or the block decodes (no gap).

**F13, silent overwrite.** `tg-crypt seal -` run twice with the default output (`message.tgs`, or `<data>.tgs`) replaced the first record, while the key printed for it stays in the user's notes. The existing test even did exactly that, by accident. Now the record file is created exclusively (`O_EXCL`; a symlink is refused too), `--force` replaces it, and no key is printed for a record that was not written. `fetch -o` behaves the same.

**F4 and the data panel.** `columnTypes` built a grid of a million rows for a sparse sheet and then used `Math.max(...rows)`; now only the first rows are looked at and the maximum is a loop. The same spread pattern in the summary of a workbook with many sheets is replaced too.

## 4. Findings that were not fixed, and why

| ID | Severity | Observation | Why it is not fixed here |
|---|---|---|---|
| N1 | Low–Medium | **Content-Security-Policy.** `_headers` sends `script-src 'self' 'unsafe-inline'`, so the policy does not contain an HTML injection (the pages use inline scripts). The policy is delivered through `_headers`, which Cloudflare honours; the GitHub Pages alternative named in `scripts/build-site.mjs` ignores it. There is no `frame-ancestors`. | A fix means moving the inline scripts to files or generating script hashes per page in the build, and a decision about which host is the real one; both are the owner's. I found no injection (sections 7 and 10), so this is defence in depth only. Estimate: 1 to 2 days. |
| N2 | Low | **Cost of hostile key-derivation parameters.** A vault or half key may ask for Argon2id with 256 MiB, 10 passes, 4 lanes: measured 15.6 s and 321 MiB in Node (a browser is expected to be slower; not measured). The parameters cannot be authenticated before the KDF runs. The accepted lower bounds (8 MiB, 1 pass; PBKDF2 100 000) are below OWASP's minimum, but a changed parameter changes the derived key, and in a vault the parameters are in the AAD, so a modified record cannot be downgraded into something the sealer did not choose. Defaults are 64 MiB × 3. | Raising the minimum would break vaults and tests made with small parameters; lowering the maximum is a product choice. Owner decision. |
| N3 | Low | **Memory of a large `.xlsx`.** A 4.6 MB workbook with 1 million rows took 5.6 s and 1.3 GB of resident memory (measured in Node; in the browser this runs in a worker). The ratio limit (300:1) stops every high-ratio bomb tried (250 MB of spaces, 5 million empty cells, a 60 MB text node: all refused at once); a legitimate-looking sheet near the limits is expensive. | The limits are generous on purpose (spreadsheets of a few million cells); a lower default for the browser is the owner's call. |
| N4 | Info | **Shares are not authenticated.** A forged share with a valid 4-byte check gives a wrong secret when exactly *k* shares are combined; the reconstructed secret then fails the AEAD of the record it should open. With more than *k* shares an inconsistent one is detected. | Property of Shamir's scheme without verification; the vault's check value covers the vault. Documented here. |
| N5 | Info | **Compression before encryption** leaks the compressed length; `pad` rounds the length up. No chosen-plaintext oracle exists (sealing is local), so this matters only to someone who sees records of related data. | By design; `pad` is the remedy and is documented. |
| N6 | Info | **Book-cipher keys** (`tg1.`, `tg2.`) are obfuscation, as the documents say; `secret.js` raises plain `Error`s that carry a `code` instead of `CryptError` (`revealAny` wraps them). | By design and documented; cosmetic. |
| N7 | Info | **The file-reading worker has no time limit and no cancel.** `data-panel-ui.js` starts a worker per file and terminates it only when it answers; a file that keeps it busy (the bounded-but-slow cases above) keeps burning CPU after the person has chosen another file, and `worker.onerror` falls back to running the same work on the page's own thread. | A UI decision (a time limit, terminating the old worker when a new file is chosen); no unbounded case is known after F1. |
| N8 | Info | **The claim-by-hash race of the paid API** (a public transaction hash can be submitted by whoever is first) | Already documented in `api/README.md`; payment logic was out of this review's depth. |

## 5. Known-answer tests: the vector table

`test/known-answer.test.js` (25 tests). The vectors are **extracted from the standards documents by `scripts/extract-kat-vectors.mjs`**, not typed by hand; `test/fixtures/known-answer-vectors.json` records the SHA-256 of each source document. Sources: the RFCs from `rfc-editor.org`; NIST CAVP `gcmtestvectors.zip` from `csrc.nist.gov` (SHA-256 `f9fc479e134cde29…`); **SLIP-0021 and the BIP-39 reference vectors were fetched from `raw.githubusercontent.com`** (the SLIP document and the Trezor `python-mnemonic` `vectors.json`), outside the two hosts the task named: read-only downloads of public specification files, nothing was sent. **No vector failed.**

| Building block | Vectors | Source | Result |
|---|---|---|---|
| SHA-256 | "", "abc", the 448-bit message | FIPS 180-4 examples | pass |
| AES-256-GCM | 12 cases, with and without plaintext and AAD (0 to 720 bits AAD); encrypt, decrypt, flipped tag bit, flipped ciphertext bit, changed AAD, truncated tag | NIST CAVP `gcmEncryptExtIV256.rsp` (Keylen 256, IV 96, Tag 128) | pass |
| HKDF-SHA-256 | A.1, A.2, A.3 (incl. empty salt and info; PRK too) | RFC 5869 appendix A | pass |
| HMAC-SHA-256, HMAC-SHA-512 | test cases 1 to 7 (131-byte key, truncation) | RFC 4231 section 4 | pass |
| HMAC with an empty key | the project's one-zero-byte substitute equals the empty key | `node:crypto` | pass |
| PBKDF2-HMAC-SHA-256 | c=1 and c=80 000, 64 bytes | RFC 7914 section 11 | pass |
| PBKDF2-HMAC-SHA-512 | 24 BIP-39 seeds (2048 rounds); the project KDF at 100 000 rounds vs `node:crypto` | BIP-39 vectors; `pbkdf2Sync` | pass |
| X25519 | two scalar-multiplication vectors (one with the top bit of *u* set); 1 and 1 000 iterations; Alice/Bob DH; the project's public-key helper | RFC 7748 sections 5.2 and 6.1 | pass (1 000 000 iterations **not run**) |
| Argon2id | the vector with secret and associated data, against vendored `@noble/hashes` (async and sync) and `node:crypto` `argon2Sync`; the project KDF against Node at 8 MiB/1 pass and 16 MiB/2 passes/2 lanes, two derivations at once | RFC 9106 section 5.3 | pass |
| BIP-39 | all 24 English vectors: entropy→mnemonic, mnemonic→entropy, mnemonic+"TREZOR"→seed; bad checksum and unknown word refused | Trezor reference vectors | pass |
| SLIP-0021 | the four published keys (master, "SLIP-0021", "Master encryption key", "Authentication key"); the project's path function refuses every path not starting with `tgart` | SLIP-0021 test vectors | pass |
| GF(2^8), Shamir | all 65 536 products against a bitwise multiplication modulo 0x11b; FIPS-197 products {57}·{83}={c1}, {57}·{13}={fe}; every inverse; {53}⁻¹={ca}; the AES S-box (FIPS-197 figure 7, 64 entries) as affine map of the project inverse and, for all 256 inputs, against an independently generated S-box; a hand-computed polynomial | FIPS-197 | pass |
| base58 | 15 Bitcoin Core vectors (leading zeros), 4 000 random strings and every length 0 to 70 against a BigInt reference, four sizes up to 8 000 bytes | Bitcoin Core `base58_encode_decode.json` (recalled and cross-checked against the BigInt reference) | pass |
| base64url | RFC 4648 section 10 vectors, URL alphabet, 2 000 random strings against `Buffer`, strict decoder (padding, standard alphabet, non-canonical trailing bits refused) | RFC 4648 | pass |
| LEB128 varint | 0, 127, 128, 624 485 = `e5 8e 26`, round trips to 2⁴⁸ | LEB128 definition | pass |

## 6. Differential tests

`test/differential-crypto.test.js` (21 tests). For each format the test contains a reader or writer written **from the specification text with `node:crypto` and `node:zlib` only**, never with a function of the project, and compares in both directions:

- `tgs1.` records and `tgx1.` keys: the project seals, the reference opens (key derived with `hkdfSync`, AES-256-GCM with `createDecipheriv`); the reference seals with a fixed nonce and the project's output for the same secret and nonce is **byte for byte identical** (bound and unbound, deflate and none, padded and not); password mode (PBKDF2-HMAC-SHA-256, NFC password); inline keys.
- `tgx2.` keys (the 4-byte tag HMAC-SHA-256(secret, "tgx2/work" ‖ SHA-256(work))), `tgmk1.` master keys with the SLIP-21 path by hand, record keys and recipient secrets by `hkdfSync` (NFC ids, empty and non-empty context, framing).
- `tgr1.` records: ECDH with `diffieHellman` and HKDF with salt = ephemeral ‖ recipient public key and the framed context; sealed by the reference and opened by the project, and the reverse.
- Shamir and XOR shares, `tgxm1.` half keys (Argon2id and PBKDF2 variants), `tgv1.` vaults (layout parsed by hand, wrap keys, AAD, Shamir recombination with an independent GF(256) implementation, check tag), `tg1.` and `tg2.` book keys (fixed-width and Rice-coded positions decoded independently).
- Tamper tests: every single-bit change of a `tgs1.` and of a `tgr1.` record (all positions), every truncation, every one-character change of a key, every bit change of a vault: all refused.
- Properties: 120 random seal/open round trips over kind, size 0 to 20 000, content, binding, strength, compression, padding and inline keys, each with a wrong work, a damaged record and the independent reader as a second opinion; 150 round trips through `tgx2`, `sealWithSecret`, `tgr1` (with and without context) and shares; 2 000 seals under one key never repeated a 96-bit nonce.

The glue agreed everywhere. The tests found no cryptographic mistake.

## 7. The cryptographic checklist, item by item

Line numbers are those of the reviewed branch tip.

| # | Question | Answer | Evidence |
|---|---|---|---|
| 1 | Nonces from a CSPRNG only, never reused under one key, right length? | **Yes** (12 bytes, `crypto.getRandomValues`). Each record has a fresh random secret (or a fresh PBKDF2 salt), so its content key is unique and a 96-bit random nonce is never reused under it. Exception to note: `sealWithSecret` with a derived per-record key reuses that key for every seal of the same record id; the nonce is still random (collision probability about 2⁻³³ at 2³² seals; none in 2 000). | `crypt.js:63,107,111,115`; `keys-seal.js:84,90,95`; `keys-split.js:213,225`; `keys-work.js:72` (`sealWithSecret`); test "nonces never repeat" |
| 2 | AAD binds header, version, work binding and recipient? | **Yes, by two routes.** `tgs1`: AAD = `"tgs1"` ‖ version ‖ flags ‖ (salt ‖ iterations); the work binding is in the HKDF info (full SHA-256), so another work gives another key. `tgr1`: AAD = `"tgr1"` ‖ version ‖ flags ‖ ephemeral key ‖ framed context; both public keys are in the HKDF salt. Vault: AAD = `"tgv1"` ‖ header (k, n, check) ‖ entry head (name, x, KDF parameters, salt). | `crypt.js:51-56,116,255`; `keys-seal.js:62-65,96,131`; `keys-split.js:226,288`; every-bit-flip tests |
| 3 | Distinct HKDF info/salt per purpose, no key used for two purposes, SLIP-21 restriction, ECDH output never raw? | **Yes**, with one note. Salts/infos: `tgx1/salt` + `tgx1/aes-256-gcm`; `tgart/hkdf/v1` + `tgart/record-key/v1`, `…/recipient/v1`, `…/factor/passkey/v1`, `…/factor/seed/v1` (none is a prefix of another); `tgv1/wrap` + name; `tgxm1/hkdf` + `tgxm1/key`; `tgr1` as above. Note: a `tgx2` secret is both the HMAC key of the 4-byte tag and the HKDF input; the roles are separated by the message strings and the outputs are independent PRF outputs. ECDH: only through HKDF; the all-zero result is refused. SLIP-21: `slip21Path` requires the first label `tgart`; the lower-level `slip21Master`/`slip21Child` are exported but called only by it. | `keys.js:93-94,131-140`; `keys-seal.js:62-73`; `keys-work.js:19-22`; `keys-split.js:134,173-181,186-189` |
| 4 | KDF parameters bounded below and above, and authenticated? | **Yes, with the note of N2.** Records: iterations 100 000 to 5 000 000, refused as `damaged` otherwise; they are in the head (AAD) and in the PBKDF2 input. `keys-kdf.js`: Argon2id memory 8 MiB to 256 MiB, passes 1 to 10, lanes 1 to 4. A record that claims 1 iteration is refused. In a vault the parameters are in the AAD; in a half key they are KDF inputs. | `crypt.js:29-30,89,211`; `keys-kdf.js:11-46` |
| 5 | Tag length fixed, no truncated tags, malleability? | **Yes.** `tagLength: 128` everywhere; a record shorter than head + nonce + 16 + 1 is refused; truncations and bit flips refused (tests). base64url and base58 decoders are strict and canonical (one text per byte string), varints are bounded to 7 bytes. | `crypt.js:116,255`; `crypt-codec.js:63-82,86-152`; known-answer and differential tests |
| 6 | Canonicalisation: two works with the same canonical text; Unicode differences? | **By design** the binding is to the canonical text (NFC, no default-ignorable characters, single spaces), not to the bytes of the file or to the picture: two files with the same text share keys. NFC, Default_Ignorable_Code_Point and white space were **compared over all code points**: identical in Node 26.11 (Unicode 17), Chromium 154 and Firefox 157. Not measured: Safari/WebKit and older engines (a character assigned later could canonicalise differently: the key then fails closed with `wrong-work`). | `secret.js:17`; section 10 |
| 7 | Error oracles, timing? | **No exploitable oracle found.** The AEAD is verified before any plaintext is parsed; one message for wrong key, other work (unbound mismatch) and changed record; `wrong-work` is reported only from the key's own fingerprint/tag, i.e. to the key holder; structural errors concern public bytes. Check values are compared in constant time since F8; no secret is compared against attacker input remotely. | `crypt.js:227-262`; `crypt-codec.js:36-42` |
| 8 | Key-check values: what do they leak? | The 2-byte key check is a truncated SHA-256 of the key text (typing errors only): to someone who already has the key text it reveals nothing. A `tgx1.` key carries 8 bytes of SHA-256 of the **work's** text (public): a candidate list identifies the work. A `tgx2.` key carries a 4-byte HMAC keyed by the secret: only the key holder can test a candidate work, with false positive 2⁻³²; it reveals at most 32 bits of a PRF output. Neither reveals bits of the secret that make a search easier than 2¹²⁸. | `crypt.js:160-190`; `keys-work.js:19-60` |
| 9 | What does a key alone reveal about the work? | `tgx1.`: which work (among candidates), 64 bits; `tgx2.`: nothing but a 32-bit test of a candidate; `tg1.`/`tg2.`: the fingerprint and the length of the secret, and the work text (public) opens it: obfuscation by design. | docs; `secret.js`, `crypt-book.js` |
| 10 | Every decoder bounded before work? | **Yes** after the fixes. Keys: `MAX_KEY_CHARS` 44 817 (base58 is quadratic: 1.5 s at the maximum since F14); records 24 MiB, inline 32 KiB; inflate and brotli capped at 16 MiB while unpacking (a 1 GiB deflate bomb and a 1 GiB brotli bomb are refused as `too-large`, +134 MB resident at most); varints 7 bytes; Rice runs `N+2`, at most 2 048 symbols; ZIP: 4 096 entries, 256 MiB per entry, 384 MiB total, ratio 300:1, no ZIP64, no encryption, names with `..`, `\`, drive letters refused, duplicates refused, CRC checked; XML: no DOCTYPE, five built-in entities only (no billion laughs), depth 256, 6 M elements; YAML: anchors, aliases and merge keys refused, depth 32; JSON: depth 64, 4 M values, 8 M characters, duplicate keys refused; Markdown depth 32; TGD blocks 64 per work, 64 M characters. Prototype pollution is not possible (objects are `Map`s; plain models use `defineProperty`; measured with `__proto__`, `constructor`, `prototype` keys in five formats). Formula injection: CSV/TSV export puts a `'` in front of cells starting `= + - @`, TAB or CR unless the cell is a plain number; the xlsx writer writes formulas only on request. Regex backtracking: five sites found and fixed (F1); a sweep of 17 712 hostile shapes: slowest case 58–69 ms. | `crypt.js:25-35`; `crypt-codec.js:184-229`; `structured-*.js`; sections 3, 9 |
| 11 | Memory handling in the browser panels | **Good, with JavaScript's limits.** Keys live only in the value of their `<textarea>`; in a browser check no other element carries the key in an attribute or text; nothing is written to `localStorage`, `sessionStorage`, the URL or the history (the generator stores its settings and the work's *public* text); no `console` call in these files (tripwire test); clipboard only from a button handler; error messages built from templates contain constants, counts and version bytes only (all 40 hits triaged). Not possible in JavaScript: wiping a string, a `Uint8Array` that was copied, the clipboard history, a hostile extension. Only the ephemeral X25519 secret is zeroed. | `data-ui.js:102-114`; `data-reader-ui.js`; `keys-seal.js:93`; check-web-data |
| 12 | XSS from a spreadsheet, a TGD block or a decrypted record | **No path found, tested.** One element builder, `textContent` only (`data-ui.js:7-20`); no `innerHTML` in scope (tripwire); `work.html` escapes everything it puts into markup; 45 browser checks load hostile cells, keys, names and file names (`<img onerror>`, `<script>`, `javascript:`, `"><svg onload>`, formula and template-injection text) through the file chooser, as a block in a work, and as a sealed record, in every format: nothing ran, no element was created from the data, with the real CSP enforced. The test was shown to fail when `textContent` is replaced by `innerHTML`. | `data-ui.js`; `scripts/check-web-data.mjs` scenario 4b |
| 13 | Share handling: ids, mixing, duplicates, k−1, tampering | Different splits are refused as `share-set` (random 4-byte set id); a repeated share as `share-duplicate`; too few as `share-too-few`; lengths must agree; with more than *k* shares an inconsistent one is refused; a changed character is caught by the 4-byte check (every single change in the tests); a forged share with a valid check is not detected with exactly *k* shares (N4). | `keys-split.js:93-121` |
| 14 | Randomness only from `crypto.getRandomValues`, no `Math.random` | **Yes.** `Math.random` does not occur in `src`, `cli`, `api`, `scripts` or the pages (grep, Semgrep rule, tripwire test). `seededRandom` (xorshift) is exported from `crypt-codec.js` for test vectors and the `random` option of the sealers accepts any function: neither is reachable from the pages or the CLI. | `crypt-codec.js:18-27`; `crypt.js:63` |
| 15 | Zeroisation | Only the ephemeral secret is wiped; the rest is not, and cannot be made reliable in JavaScript. | `keys-seal.js:93` |

## 8. Semgrep

Rules: `scripts/semgrep-js-security.yml` (27 local rules, validated). Driver: `scripts/semgrep-scan.mjs`, which scans `src`, `cli`, `api`, `scripts` and the **11 inline script blocks of the 11 HTML pages** (extracted to files first). The registry packs (`p/default` and similar) were **not** used: they need the network and nothing is cached. The local rules are narrower than the registry's, so a clean run proves less. 

| Rule | Hits |
|---|---|
| `tg-child-process-dynamic` | 53 |
| `tg-console-log` | 82 |
| `tg-domparser` | 2 |
| `tg-dynamic-import` | 4 |
| `tg-fs-dynamic-path` | 106 |
| `tg-html-sink` | 19 |
| `tg-http-url` | 12 |
| `tg-json-merge` | 15 |
| `tg-new-regexp-dynamic` | 11 |
| `tg-open-redirect-or-ssrf` | 16 |
| `tg-pbkdf2-low-iterations` | 1 |
| `tg-proto-pollution-assign` | 106 |
| `tg-storage-write` | 7 |
| `tg-throw-secret-in-message` | 40 |
| `tg-unvalidated-json-parse-keys` | 23 |
| `tg-url-sink` | 15 |

Total: 512 hits, 0 Semgrep errors, 11 inline script blocks from 11 pages scanned.

Triage of every rule that fired (all hits read, none is a defect that remains):

- `tg-child-process-dynamic` (the rule matches `.exec(`): all hits are `RegExp.prototype.exec`, or `db.exec` of constant SQL in `api/store.mjs`; the real child-process calls (`cli/core.mjs`, `scripts/`) use argument arrays and no shell. False positives.
- `tg-console-log`: `api/server.mjs` logs job ids and counts; the CLI prints keys to standard output *by design* (documented), everything else goes to standard error without secrets. Accepted.
- `tg-html-sink`: `app.html` (`toHtml` escapes with `escapeXml`; chips carry numbers and translations; the one error message is now escaped: **F9**), `work.html` (every value passes `esc()`; checked line by line), `examples`/`gallery`/`index`/`demo` (same-origin JSON written by the site), `cli/render.html` (constants, numbers, `toHtml`). No hit takes data from a user's file unescaped.
- `tg-domparser`: `work.html` sanitises an SVG (removes `script`, `foreignObject`, `iframe`, animation elements, `on*` attributes, and any `href`/`src` that is not `#`, `http(s)` or an image data URL, after stripping control characters); `index.html` parses a same-origin SVG.
- `tg-url-sink`: data URLs made by the page itself, `blob:` URLs, `sameOrigin()`/`httpUrl()`-checked parameters; one `meta.url` from the site's own `examples/index.json` is not scheme-checked (site-controlled data, Info).
- `tg-fs-dynamic-path`: paths from command-line arguments by design; `api/server.mjs` builds paths from server-made UUIDs matched by `[0-9a-f-]{36}`. No traversal.
- `tg-new-regexp-dynamic`: `structured-md.js` builds a fence expression from `` ` ``/`~` and a length; `structured-xml.js` re-uses its constant name expression; the rest are scripts.
- `tg-pbkdf2-low-iterations`: the 2 048 rounds of BIP-39 (the standard prescribes them). False positive.
- `tg-proto-pollution-assign`: index assignments on arrays and typed arrays, `Object.assign(new Error(), { code })`; the only dictionary keyed by data is `kinds[k]` with a fixed set of kind names; the models are `Map`s (measured, F6 control).
- `tg-storage-write`: the language choice, and the generator's settings and public work text (`tg-art.v1`); confirmed in the browser that no key, record or decrypted datum is stored.
- `tg-throw-secret-in-message`: constants, counts and version bytes only.
- `tg-http-url`, `tg-json-merge`, `tg-unvalidated-json-parse-keys`, `tg-dynamic-import`, `tg-open-redirect-or-ssrf`: XML namespace URIs, option spreads, the user's own chain file, constant import paths, operator-configured or same-origin URLs. Accepted.
- No hit for: `eval`/`new Function`, `Math.random`, MD5/SHA-1, ECB/CBC/RC4/DES, deprecated `createCipher`, hard-coded secrets, `postMessage('*')`, fixed GCM IVs.

## 9. Fuzzing

`scripts/fuzz-crypto.mjs` (deterministic: the seed is printed first and replays the same cases; in a long run it restarts itself as a watched child and reports a hang with the input that caused it). Targets and mutations:

- **keys**: every prefix (`tgx1`, `tgx2`, `tg1`, `tg2`, `tgmk1`, `tgp1`, `tgq1`, `tgxm1`, `tgsh1`, `tgv1`) by byte mutation, text mutation and **checksum-aware mutation** (decode, change the body, recompute the check value, re-encode, so the parser behind the checksum is exercised); mnemonics; share sets;
- **records**: `tgs1.`/`tgr1.` records mutated as bytes (version, flags, salt, iterations, nonce, ciphertext); authenticated records with hostile inner shapes (any kind byte, bad padding, bombs) written by hand with `node:crypto`;
- **structured**: csv, tsv, json, yaml, xml, md, ics, vcf, kv and xlsx files from the fixtures and small seeds, mutated (token insertion, repetition, truncation); every case also checks `decode(encode(x))` equals the encoded model and runs every export and every page summary on the result;
- **tgd**: blocks mutated as text, half of them with the checksum recomputed;
- **xlsx**: ZIP mutated as bytes, and XML parts mutated inside a re-zipped archive (right CRC);
- **models**: decoded blocks whose model has any shape, through the page functions (summary, preview, outline, warnings, JSON view);
- **hostile shapes** (`--hostile`): 10 readers (nine formats and the text-structure splitter) × 71 lead-ins × 41 run tokens × 6 tails = 17 466 cases at 40 000 repetitions, plus 246 cases for the TGD decoder and the key, record and share parsers: 17 712 in all. This finds quadratic expressions.

Acceptable outcomes: a correct result or a `CryptError`/`TgdError` with a string `code`, within 3 s (hostile shapes: 250 ms). 

| Run (final code) | Cases | Time | Slowest case | Findings |
|---|---|---|---|---|
| seed 301 | 150 000 | 85 s | 584 ms | 0 |
| seed 302 | 150 000 | 96 s | 637 ms | 0 |
| seed 303 | 150 000 | 79 s | 544 ms | 0 |
| hostile shapes | 17712 | – | 51 ms | 0 |

Cases per target over the three seeds: keys 180,072, models 31,503, records 161,975, structured 36,054, tgd 22,444, xlsx 17,952. Earlier runs on earlier states of the code (seeds 11, 12, 21 to 23, 31, 41, 42, 51, 101 to 103, 102 again after the fix) are where the findings below came from; the numbers above are the runs on the final code.

What the fuzzer found (each is now a test): the two raw `TypeError`s on damaged workbooks (F2); with the hostile sweep, the XML declaration and the Markdown paragraph expressions (F1); with deep-nesting tokens, nothing new in the parsers but `outline` throwing on a contact/calendar model of the wrong shape (F12); the slow base58 conversion (F14). The fixed-seed subset in the suite (`test/fuzz-crypto.test.js`) runs 6 000 cases and 150 hostile shapes in about 7 seconds.

## 10. Measurements in real browsers

- **Unicode parity.** For every code point from U+0000 to U+10FFFF the NFC form, the Default_Ignorable_Code_Point property and `\s` were computed in Node 26.11.1, headless Chromium 154 and headless Firefox 157: the three lists (5 316 entries) are identical. Safari/WebKit: not measured.
- **Hostile data**, 45 checks in `scripts/check-web-data.mjs` (`--only hostile`), with the real `_headers` policy enforced by the test server: see item 12 of section 7 (47 checks: every format through the file chooser, as a block in a work, and as a sealed record, plus the work with two blocks). After the fix F12 a work with two blocks, one of an unexpected shape, still shows the good one.
- **Where a key can be found**, one check in the sealing scenario: the key is in no element of the page except its own box (no attribute, no text); the existing checks already cover storage, URL and clipboard.
- The full browser check: 158 checks (161 with `mutool` installed), 0 failed.

## 11. What the review did not cover

- **Formal verification** of anything; **side channels** beyond the constant-time comparison (no timing measurement on hardware, no cache or power analysis, no fault injection); the browsers' and Node's implementations of AES-GCM, HKDF, PBKDF2 and X25519 (used through Web Crypto and tested only with published vectors; the 1 000 000-iteration X25519 vector was not run).
- **The vendored Argon2id code** (`@noble/hashes` 2.4.0, 1 150 lines with its BLAKE2): reproduces RFC 9106 and agrees with Node's native Argon2id, but it was not read line by line, and its own audit statements were not verified.
- **The layout engine** (`typeset.js`, fonts, PDF/MuPDF handling) and `cli/core.mjs` beyond what the pages show; one suspect, `lines.push(...r.lines)` in `typeset.js:149` (a call-stack limit for extreme texts), was seen and not measured.
- **The payment API** beyond a spot-check (`api/server.mjs`, `dgb.mjs`, `limit.mjs`, `store.mjs`, `pipeline.mjs` read once: no new issue; the documented claim-by-hash race stands); deployment (Cloudflare, GitHub workflows), the supply chain of any dependency, `npm audit`.
- **Browsers**: Safari/WebKit, mobile browsers, other versions; extensions; a compromised device.
- **Human factors**: whether people keep keys safe, phishing of the pages, social engineering.
- **Completeness of any list here.** A fuzzer, a rule set and a checklist find what they are built to find.

## 12. What this is and is not

**This is an internal adversarial review by an AI agent with a fresh context and tools. It is not an independent audit.** The agent read the code, wrote tests and tools, ran them, and fixed what it could verify. It has no accreditation, no liability, no peer; it can be wrong, it can be fooled by its own assumptions, and it shares the blind spots of the way it was prompted. It could **not** do formal verification, side-channel measurement on hardware, or a review by a human cryptographer, and it **cannot rule out** a flaw in the protocol design, in a dependency, in the platform's cryptography, or in anything listed in section 11. A clean result of every test here means that these tests found nothing, not that nothing is there. The statement in the README stays true: the code around the cipher is **not independently audited**.

What the review is good for: it removed a number of real defects before anything valuable is sealed, it pinned each with a test, it gave the cryptographic glue a second, independent implementation to be compared with, and it left tools (known-answer vectors, a fuzzer, local rules, a hostile-data browser check) that anyone can run again.

**Recommended scope of a real external review** (an estimate, not a quote): two reviewers, one with protocol and applied-cryptography experience and one with web-security experience, about **10 to 15 person-days** for the following, plus the report and a fix-verification round.

1. The protocol and the formats (`docs/key-format.md`, `encrypted-data.md`, `key-management.md`) as a design: the HKDF contexts, the AAD choices, the work binding, the vault, the `tgr1` construction (ECIES without sender authentication), the SLIP-21 use, the key lengths and recovery story. Questions: is any context ambiguous, any key used twice, any downgrade possible, is the vault's threshold property what the text claims? (about 4 days)
2. `src/crypt*.js`, `src/keys*.js`, `src/secret.js` (about 1 700 lines), line by line, with the test vectors of this report as a starting point: nonce and key lifecycle, error handling, canonicalisation, bounds. (about 3 days)
3. The vendored Argon2id code and the decision to vendor it; the Web Crypto usage across browsers (X25519 availability, error behaviour). (about 1 day)
4. The parsers of untrusted files and the pages that show decrypted data (`structured*.js`, `data-*.js`, `work.html`, `app.html`), the CSP and the hosting choice (N1): XSS, denial of service, memory. (about 3 days)
5. Operational questions the code cannot answer: how keys are generated, stored and recovered by real users, what is published on a chain, the legal side of anchoring personal data. (about 1 day, may be a workshop)

## 13. How to repeat it

```bash
node --test test/                                  # the whole suite, including the tests of this review
node --test test/known-answer.test.js              # published vectors (fixture built by scripts/extract-kat-vectors.mjs)
node --test test/differential-crypto.test.js       # independent re-implementations
node scripts/fuzz-crypto.mjs --seed 1 --iterations 150000     # the fuzzer (any seed; ~75 s)
node scripts/fuzz-crypto.mjs --hostile --n 40000               # long runs of one token behind every lead-in (~3 min)
node scripts/semgrep-scan.mjs --list               # local Semgrep rules + the inline scripts of the pages
node scripts/check-web-data.mjs --only hostile     # hostile data in headless Chrome/Chromium
```

Commits, in order (branch `security-review`):

- `5c7f3eb` test: known-answer tests for every cryptographic building block (RFC, NIST, BIP-39, SLIP-0021 vectors)
- `c08bac9` test: differential tests against independent node:crypto re-implementations of tgs1, tgx1/2, tgr1, vault, shares, mixing, book ciphers
- `ea0807b` fix: quadratic regular expressions in the YAML, Markdown, XML and text-structure readers (a data file could stall the reader for minutes)
- `ca5434f` fix: named errors for damaged workbooks and unknown model shapes, no stack overflow for long tg1 secrets or sparse sheets, escape error text on the generator page
- `15287a4` harden: compare check values without an early exit; controls for bombs, prototype keys, small-order points and the hygiene tripwire
- `2b8462d` test: deterministic fuzzer for every decoder and parser, hostile run shapes, and a small fixed-seed subset in the suite
- `af1e419` scripts: local Semgrep rules and a scan driver that includes the inline scripts of the pages
- `b122074` test: hostile-data scenario in the browser check (markup, script and javascript: text in every format, opened from a work and from a sealed record: nothing may run)
- `9319a36` fix: the encoder refuses what the decoder would refuse (nesting, value count, text length, block size), so no block is written that cannot be read back or opened; test sources keep invisible characters as escapes
- `852a0fb` fix: sealData refuses a block that cannot be read back (a sealed record that never opens); the fuzzer writes hostile inner shapes by hand
- `009da9d` test: random round trips over option sets, with the independent reader as a second opinion
- `8cb61e0` fix: a data block with an unexpected model shape no longer takes the Machine view of a work down (outline reads shapes defensively, one bad card does not drop the others)
- `95f5eac` perf: base58 conversion in limbs of two bytes / five characters (a key that carries a 32 KiB record took 3.3 s to parse, now about 1.5 s); same output, checked on 320 000 cases against the old code
- `78641c5` scripts: fix the weak-cipher Semgrep rule (the mode filter did not apply) and add the deprecated createCipher rule
- `adde6f9` scripts: Semgrep fs-path rule applies its literal filter
- `1dd6c5a` fix: tg-crypt seal and fetch no longer replace an existing record file (the key printed for the old record would open nothing); --force replaces
