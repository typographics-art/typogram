# Internal adversarial review of the sealed-data and key-management code, October 2026 (review 2)

**What this is:** an internal adversarial review by an AI agent (Claude, model Fable 5.1) with a fresh context, the repository, and tools (Node, headless Chromium, semgrep, curl to rfc-editor.org and the NIST sites), run on 2026-10-18 in a separate worktree (branch `security-review-2`) without reading the parallel first review. **What it is not:** an independent audit, a formal verification, a review by a human cryptographer, or a measurement of side channels on hardware. It must never be cited as "audited". Section 11 says what remains unproven; section 13 what a real external review should cover.

Base: `main` at `4757fd5`, merged with `e028943` during the review. Every number below was measured on this machine (Node 26.11.1 with OpenSSL 3.6.5, ICU 78.3, Unicode 17.0; Chromium 154.0.8037.97; semgrep 1.155.0) and is reproducible with the commands given; where something is an estimate it says so.

## 1. Scope

Read in full: `src/crypt.js`, `src/crypt-codec.js`, `src/crypt-book.js`, `src/keys.js`, `src/keys-kdf.js`, `src/keys-seal.js`, `src/keys-work.js`, `src/keys-split.js`, `src/secret.js`, `src/structured*.js` (all parsers of untrusted files), `src/data-panel.js`, `src/data-panel-ui.js`, `src/data-reader-ui.js`, `src/data-ui.js`, `src/data-worker.js`, `src/work-text.js`, the inline module scripts of `app.html`, `work.html` and `passkey-check.html`, `cli/tg-crypt.mjs`, `cli/tg-keys-cmds.mjs`, `cli/tg-data.mjs`, `api/*.mjs` (spot check only; the payment logic was reviewed earlier), `assets/vendor/noble-hashes`. Specs read: `docs/encrypted-data.md`, `docs/key-management.md`, `docs/key-format.md`, `docs/cipher-review.md`, `docs/passwords-and-keys.md`, parts of `docs/structured-data.md`.

Not in scope and not reviewed: the typesetting pipeline (`src/layout.js`, `src/typeset.js`, `src/render.js`, …) except where the sealed-data pages call it, the website build, the PDF tooling (`cli/onepage*.mjs`, MuPDF), pdf.js (vendored 4.4.168, loaded with `disableFontFace: true`; its version is after the font-rendering code execution fix of 4.2.67, but the library itself was not reviewed).

## 2. Method

1. Reading every file above line by line against the specs, with a checklist (section 6).
2. **Known-answer tests** (`test/known-answer-b.test.js`): every primitive the glue relies on, against vectors copied from text fetched during the review (section 7).
3. **Differential tests** (`test/differential-b.test.js`): the formats re-implemented from the spec with `node:crypto`, `node:zlib` and `BigInt` only, compared with the project on the frozen fixtures and on fresh random inputs, in both directions where possible (section 8).
4. **Static analysis** with semgrep: the registry rulesets and a hand-written rule file for this code's sinks (section 9).
5. **Fuzzing** of every decoder of untrusted input with a deterministic, time- and memory-bounded fuzzer (section 10).
6. **Measurements** where a claim needed one: timing of regexes and of base58, Unicode normalisation in Node against Chromium, memory of the fuzzer.
7. Every real finding was fixed in the worktree with a regression test that fails before the fix and passes after, in small commits (section 4).

Not done: formal verification, side-channel measurement, review of the platform primitives themselves (Web Crypto, OpenSSL, V8), real-hardware passkey tests, a browser other than headless Chromium, a comparison of the vendored Argon2 files with the npm tarball (section 5, I-10).

## 3. Findings by severity

Severity is the reviewer's judgement of impact in this project's threat model (a public sealed record, a key held by the user, hostile files and works opened in the browser or the CLI). No finding affects the secrecy or integrity of sealed records: **the cipher glue (tgs1/tgx1/tgx2/tgr1, the vault, shares, the KDFs) came through the vectors, the differential tests and the fuzzer without a difference or a crash.** The defects are in the readers of untrusted *files and works* around it.

| id | severity | where | what | state |
|---|---|---|---|---|
| B-2 | **medium** (denial of service of the reader) | `src/structured-md.js` (seven regexes), `src/structured-yaml.js` (two) | A line with a long run of spaces (or a fence info string) made the Markdown and YAML readers backtrack quadratically: 60 000 spaces cost 1.5 to 3.5 s per regex, 100 000 cost 3.8 to 8.3 s; a 16 MiB file (the input limit) would take minutes, in the generator's worker or the CLI. | **fixed** `acf58dd`, test B-2 |
| B-3 | **medium** (denial of service of the work page and CLI) | `src/work-text.js` `markupText` | `/<[^>]+>/g` and the script/style/title/head regex were quadratic in the file size when a `<` is never closed: an SVG of 1 000 000 characters `a<` took **230 s**, 100 000 unclosed `<script>` openers 12.6 s. Reachable from "open a work file from your computer" on the work page and from `tg-data`/`tg-crypt` on an `.svg`/`.html` work. | **fixed** `b1250f9`, test B-3 |
| B-1 | **low** (wrong output instead of an error, obfuscation layer only) | `src/secret.js` `readVarints` | A `tg1.` key whose varint has more than 7 continuation bytes overflowed the position to `NaN`; `clusters[NaN]` is `undefined` and the key "revealed" a shorter or different message with no error (reproduced: a crafted key revealed `"u"` instead of failing). `tg1`/`tg2` keys are obfuscation by design and carry no authentication; this is purely about structurally invalid keys being refused as `damaged`, which they now are. Valid keys and the conformance vectors are unchanged. | **fixed** `1eae671`, test B-1 |
| B-6 | **low** (crash on a hostile file; found by the fuzzer) | `src/structured-xlsx.js:178` | A sheet relationship naming a comments part that is not in the archive made `readXlsx` read `.root` of `null`: a `TypeError`, not a named `TgdError` (the page shows "something unexpected", the CLI prints a stack). | **fixed** `a56c9d6`, test B-6 |
| B-5 | **low** (silent data loss) | `src/structured-xlsx.js:100,178` | A defined name or a comment keyed `__proto__` was assigned to a plain object and therefore dropped silently (not a prototype pollution: the value is a string). | **fixed** `664961b`, test B-5 |
| B-4 | hardening | `src/crypt-codec.js:36` `equalBytes` | Comparisons of checksums, the tgx1 fingerprint, the tgx2 tag and the vault's verify value stopped at the first differing byte. No comparison leaked a secret the caller does not already hold (section 6, "timing"), so this closes a question rather than a leak. | **done** `cbe321b`, test B-4 |

Findings that were **not fixed**, with the reason (section 5): I-1 (base58 is quadratic: a maximal in-bound junk key takes 3.3 s on the main thread; only the user's own paste reaches it), I-2 (the tgx2 tag uses the raw secret as an HMAC key: a design note), I-4 (the passkey test page uses `userVerification: 'preferred'`), I-5 (one `innerHTML` sink in `app.html` takes an error message; no reachable injection found), I-6 (zeroisation is best effort, as documented), I-10 (the vendored Argon2 files were not compared with the npm tarball from here).

## 4. Fixes, commits and tests (for cherry-picking)

All on `security-review-2`, author d0n, each self-contained; `node --test test/` was green (321 tests after the merge of main) at every commit.

| commit | change | regression test |
|---|---|---|
| `1eae671` | `src/secret.js`: a varint of more than 7 bytes is `damaged` | `test/hardening-b.test.js` B-1 |
| `cbe321b` | `src/crypt-codec.js`: `equalBytes` looks at every byte | B-4 |
| `acf58dd` | `src/structured-md.js`, `src/structured-yaml.js`: linear scans replace the quadratic regexes; results identical (old-versus-new on 40 000 random Markdown and 40 000 random YAML documents and on the 19 Markdown/YAML files of the repository: no difference) | B-2 (timing at 150 000 characters, fixed cases, 6 000 random lines against the old regexes, 3 000 random YAML values) |
| `b1250f9` | `src/work-text.js`: two linear scans replace the two regexes; results identical (16 000 random strings against the old regexes) | B-3 |
| `664961b` | `src/structured-xlsx.js`: `defineProperty` for defined names and comments | B-5 |
| `8d3301c` | `test/known-answer-b.test.js` (new) | 12 tests, section 7 |
| `db39af8` | `test/differential-b.test.js`, `scripts/fuzz-crypto-b.mjs`, `test/fuzz-b.test.js`, `scripts/semgrep-rules-b.yaml` (new) | 8 differential tests, 1 fuzz test |
| `a56c9d6` | `src/structured-xlsx.js`: a dangling comments relationship is `TgdError('format')` | B-6 |
| `4212ba1` | merge of `main` (`e028943`) | – |

Backward compatibility: no key, record or conformance vector changed; `test/fixtures/conformance/*.json` and `test/fixtures/key-management-vectors.json` are untouched and still pass. The only behaviour changes are refusals of inputs that were invalid before (B-1, B-6) and the kept `__proto__` entry (B-5).

## 5. Observations not fixed (information, design notes, limits)

- **I-1 base58 is quadratic.** `b58Decode` and `b58Encode` convert digit by digit. The longest key string the reader accepts (`MAX_KEY_CHARS` = 44 817, derived from the 32 KiB inline-record limit) of valid base58 characters that is not a key takes **3.3 s** in `parseKey` (decode, re-encode, then the checksum fails); the 32 KiB inline maximum round-trips in about 3.7 s. Only the person's own paste or file reaches `parseKey`; records that an attacker can place in a work's text are base64url, which is linear. So this is a freeze of the person's own tab, not an attack surface. Not changed because the limit is documented (`docs/encrypted-data.md` section 5.6) and a different converter is a design decision for the owner; a `BigInt` conversion would be about fifty times faster.
- **I-2 one secret, two PRFs.** `tgx2` computes its 4-byte tag as `HMAC-SHA-256(secret, "tgx2/work" || digest)` (`src/keys-work.js:19`) with the same 16/32-byte secret that is the HKDF input of the content key (`src/crypt.js:51-57`). Under the standard PRF assumption on HMAC-SHA-256 this is sound and leaks 32 bits of an unrelated PRF output; a cleaner design derives a separate tag key from the secret by HKDF. Not changed: it is a format change (`tgx2.` keys would change).
- **I-3 key strings are integrity-checked, not authenticated.** Every secret-bearing text (`tgx1.`, `tgx2.`, `tgmk1.`, `tgq1.`, `tgp1.`, `tgsh1.`, `tgxm1.`) carries 2 or 4 bytes of a SHA-256 over its body. That catches typing errors; anybody can forge a well-formed key with any flags. This is by design: a key is a secret, the AEAD tag of the record is the authority, and a forged key never opens anything it was not made for (tested in the differential and fuzz runs). What the 2-byte check does leak: 16 bits of a hash of the secret, which lets an attacker who holds a *partial* key verify guesses of the missing part at 1 in 65 536; only relevant if most of a key leaked.
- **I-4 passkey page: user verification.** `passkey-check.html:176,196` create and use the test credential with `userVerification: 'preferred'`. For a credential that is a *key factor*, `'required'` is the safer setting (a passkey without user verification can be used by whoever holds the unlocked device). The page is a device test, so this is a recommendation for the future vault page rather than a defect.
- **I-5 an error message reaches `innerHTML`.** `app.html:763` writes `e.message` of a failed typesetting run into `#meta` through `chip()`. The only interpolated message on that path is `Font ${font.label} is not available` (`src/browser.js:90`), with a label from a fixed list; browser exceptions carry no user text. No reachable injection was found; `textContent` would remove the question. Everything else that reaches an HTML sink is escaped (`work.html` `esc()`) or constant (`passkey-check.html`), and the data cards build DOM with `textContent` only (`src/data-ui.js:7-18`).
- **I-6 zeroisation.** The only wiped secret is the ephemeral X25519 scalar (`src/keys-seal.js:93`). Parsed secrets, HKDF inputs, decrypted plaintext and the key text in the text box stay in memory until garbage collection; JavaScript strings cannot be wiped at all. `docs/key-management.md` section 9.1 says so honestly. The key fields are cleared on "Clear key" but not on `pagehide`/`visibilitychange` (the spec asks that of the seed page, which is designed and not built).
- **I-7** X25519 private keys are imported `extractable: true` (`src/keys-seal.js:35`) because the public key is read back through a JWK export. The raw bytes are in memory anyway; a non-extractable import for `agree()` would be a small tidy-up.
- **I-8 `openVault` and inherited names.** A hostile vault can name a factor `constructor`; `available['constructor']` then resolves to `Object` and the entry is skipped (measured: `vault-too-few`, 0 of 2). `Object.hasOwn` would be cleaner; no crash and no misuse.
- **I-9 bounds are generous in the browser.** An `.xlsx` may inflate to 384 MiB, with 64 MiB of XML text and 5 million cells, inside a worker. A hostile workbook can make the tab use a lot of memory before a limit trips. The limits are options (`DEFAULT_ZIP_LIMITS`, `DEFAULT_XML_LIMITS`); the web panel could pass smaller ones.
- **I-10 vendored Argon2 (`assets/vendor/noble-hashes`).** The six files match `SHA256SUMS`, which is the repository's own file. The npm tarball could not be fetched under this review's rules, and the only local copies of `@noble/hashes` on this machine are version 2.0.1, so a byte comparison with the published 2.4.0 was **not** possible here. What was checked: the vendored code reproduces the RFC 9106 Argon2id vector (section 7) and equals Node's native `argon2Sync` on three parameter sets, and the diff 2.0.1 → vendored is the upstream BlaMka rewrite (comments citing RFC 9106 figures, no I/O, no network). Supply-chain integrity against the published package remains an owner task (`npm pack @noble/hashes@2.4.0` and `cmp`). *(Checked afterwards, 2026-10-18: `npm pack @noble/hashes@2.4.0` fetched; `argon2.js`, `blake2.js`, `_blake.js`, `_u64.js`, `_md.js`, `utils.js` and `LICENSE` are byte-identical to the vendored copies.)*
- **I-11 mnemonic case.** `mnemonicToSeed` lower-cases the words after NFKD (`src/keys.js:30`), so `ABANDON …` is accepted and gives the lower-case seed; some other tools reject it. The hex-seed path has no checksum, as documented.
- **I-12 Unicode across engines.** NFC and NFKD of all 1 114 112 code points, and grapheme segmentation of 47 texts (the repository's 28 sample texts and 19 synthetic strings with ZWJ emoji, Hangul jamo, Indic clusters, combining marks) are **identical** in Node 26.11.1 (ICU 78.3, Unicode 17) and Chromium 154 (measured with a DevTools script). A future mismatch of Unicode versions between engines could still make a bound key fail with `wrong-work` for a work that contains a newly assigned character; that is availability, not secrecy, and the book-cipher keys (`tg1`/`tg2`) depend on grapheme segmentation as well.
- **I-13** The sealers accept a `random` option (tests, vectors). A caller who passes a weak source gets weak keys; neither page passes it, and `seededRandom` says "TEST VECTORS ONLY" (`src/crypt-codec.js:14-24`).

## 6. Cryptographic checklist (file:line are after the merge)

| item | finding | evidence |
|---|---|---|
| nonce generation | 12 random bytes from `crypto.getRandomValues` per record; AES-GCM keys are single-use (fresh secret per `tgs1.` record, fresh ephemeral per `tgr1.`, fresh vault wrap per entry); the only reuse is a seed-derived record key sealed again under the same id (random nonce; 2^-32 collision after 2^32 records, documented) | `src/crypt.js:62-63,115`, `src/keys-seal.js:84,95`, `src/keys-split.js:225` |
| what the tgs1 AAD binds | `"tgs1" ‖ version ‖ flags ‖ [salt ‖ iterations]`: the whole public header. The work is bound through the key (digest in the HKDF info), the kind and length are inside the authenticated plaintext. **Not** bound: the key text (flags, fingerprint, inline copy: a key is a secret, not a message; a forged key fails the tag) | `src/crypt.js:114-116,251`; differential test 1 |
| tgr1 AAD and salt | AAD `"tgr1" ‖ version ‖ flags ‖ epk ‖ frame(ctx)`; HKDF salt `epk ‖ rpk` binds the recipient, info `"tgr1/aes-256-gcm" 0x00 frame(ctx)` binds the context (never stored) | `src/keys-seal.js:62-65,96,131` |
| vault AAD | `"tgv1" ‖ header(version, k, n, verify) ‖ entry head(name, x, kdf params + salt)` under the wrap key of that factor; the verify value is `HMAC-SHA-256(V, "tgv1/check")[0..4]` | `src/keys-split.js:218-226,288,295-296` |
| domain separation | HKDF salts `tgx1/salt`, `tgart/hkdf/v1`, `tgxm1/hkdf`, `tgv1/wrap`; infos `tgx1/aes-256-gcm`, `tgart/record-key/v1`, `tgart/recipient/v1`, `tgart/factor/seed/v1`, `tgart/factor/passkey/v1`, `tgxm1/key`, `tgr1/aes-256-gcm`, the vault factor name; checksums `SHA-256(domain ‖ 0x00 ‖ body)` with a domain per format; SLIP-21 root key `Symmetric key seed` and the forced first label `tgart`. Record ids and contexts are length-framed (no sliding). | `src/crypt.js:54`, `src/keys.js:78,94,134,140`, `src/keys-split.js:132-134,175,180,187`, `src/keys-seal.js:63`, `src/crypt-codec.js:168` |
| no key used twice | one exception noted (I-2: the tgx2 tag); the master is used only as HKDF input; the vault secret V as HMAC key for the verify value and as a master for record keys (same shape as I-2, 32 bits of a PRF output) | `src/keys-work.js:19`, `src/keys-split.js:221,295` |
| ECDH output | never used raw: HKDF with both public keys in the salt; an all-zero shared secret (low-order point) is refused, confirmed with u = 0, u = 1 and the order-8 point | `src/keys-seal.js:66-73`; KAT X25519 |
| KDF parameters bounded below and above, authenticated | tgs1: 100 000 to 5 000 000 PBKDF2 iterations, in the AAD; Argon2id 8 to 256 MiB, 1 to 10 passes, 1 to 4 lanes; PBKDF2-SHA512 100 000 to 5 000 000; vault: in the entry head (AAD); half key: in the token, not authenticated but part of the key derivation, so a rewrite changes K (a denial of service, not a downgrade). An attacker who rewrites a record cannot lower the cost: the AAD and the derived key change together. | `src/crypt.js:25-31,89,207`, `src/keys-kdf.js:11,16-29`, `src/keys-split.js:139,213-218` |
| tags | 128-bit GCM tags everywhere (`tagLength: 128` explicit), never truncated | `src/crypt.js:116,251`, `src/keys-seal.js:96,131`, `src/keys-split.js:226,288` |
| canonicalisation | `canonicalText` = strip Default_Ignorable code points, NFC, collapse whitespace, trim (`src/secret.js:17`); the digest binds that text, so two works with the same canonical text are the same work for a key (by design, documented); Node and Chromium agree (I-12); `stripText` of TGD removes a normative class of code points (`src/structured.js:30-33`) |
| error oracles | every refusal is a constant `CryptError`/`TgdError` code; the codes reveal only what the public header already shows (bound, password, iterations) or what the key holder knows (fingerprint/tag mismatch = `wrong-work`); the pages map codes to constant texts and never echo input (`src/data-panel.js:561-575`); the CLI refuses secrets on the command line without echoing them (`cli/tg-crypt.mjs:59-60`) |
| timing | secret-dependent comparisons: GCM tags inside Web Crypto (constant time by the platform); the fingerprint, tgx2 tag, checksums and the vault verify value are compared with `equalBytes` (now full-length, `src/crypt-codec.js:36`); in every case the party that could measure already holds the compared value, so no oracle was found. Not measured on hardware. |
| what a 2- or 4-byte value leaks | checksums: 16/32 bits of a hash of the token body (I-3); vault verify: 32 bits of HMAC(V); tgx2 tag: 32 bits of HMAC(secret, work) — lets the key holder test candidate works, nobody else; `tg2` fingerprint: 32 or 64 bits of SHA-256 of the work (identifies the work) |
| what a key alone reveals | `tgx1.`: the secret, strength, whether bound, and 8 bytes of SHA-256 of the work (identifies a public work); `tgx2.`: the same without the work identity; a record alone: size (unless padded), bound/password flags, compression method, salt and iterations (`describeRecord`, `src/crypt.js:292-295`) |
| decoder bounds | key strings ≤ 44 817 characters (`MAX_KEY_CHARS`), tgx2 similar, `tg2` ≤ 11 212, `tg1` ≤ 400 000, records ≤ 33 554 441 characters / 24 MiB, inline record ≤ 32 KiB, plaintext ≤ 16 MiB with the inflate cap checked chunk by chunk, varints ≤ 7 bytes, Rice unary bounded by the text length, ≤ 64 sealed blocks; shares ≤ 700 characters, vault ≤ 4 096, half key ≤ 160, master/recipient keys ≤ 128; zip: 4 096 entries, 256 MiB per entry, 384 MiB total, ratio 300, CRC checked, ZIP64/encryption refused, names with `..`/`\`/drive/NUL refused; XML: no DOCTYPE (no entities beyond the five built-in, no expansion), depth 256, 6 M nodes, 64 MiB text; JSON: depth 64, 4 M nodes, 8 M characters per string, duplicate keys refused; YAML: no anchors/aliases/tags, depth 64, 2 M nodes; CSV: 20 M cells, 2 M rows; TGD: 16 MiB input, 64 MiB block | `src/crypt.js:25-35,157-160,186-188`, `src/crypt-codec.js:62-63,108,130-138,159-163,171-187`, `src/crypt-book.js:14-18`, `src/keys-split.js:51,145,244`, `src/structured-zip.js:11,58-61,67-118`, `src/structured-xml.js:10,61,85`, `src/structured-json.js:25,85`, `src/structured-yaml.js:24,36-40`, `src/structured-csv.js:8,12` |
| ReDoS | the quadratic regexes found are fixed (B-2, B-3); every other regex that sees untrusted input was read and the suspicious ones timed (section 10): linear | `test/hardening-b.test.js` |
| formula injection on export | CSV/TSV: cells starting with `= + - @ TAB CR` get a leading `'` unless the person confirms "without the guard" twice; XLSX: formulas are written only with `formulas: true`, off by default, labelled "only for data you trust" | `src/structured-csv.js:70-73,83-89`, `src/data-reader-ui.js:142-165`, `src/structured-xlsx.js:217,248` |
| prototype pollution | parsers build `Map`s; `toPlain` and XML attributes use `defineProperty`; the two plain-object writes in the xlsx reader now do too (B-5); hostile keys such as `__proto__`/`constructor` were fuzzed through the TGD round trip | `src/structured-json.js:126`, `src/structured-xml.js:129`, `src/structured-xlsx.js:100,179` |
| browser pages: where a secret goes | the key only into the text box (`value`, never an attribute or markup); not into `localStorage` (only the language and generator settings are stored, `app.html:642`), not into the URL or history (`work.html:531,644` write view names only), not into `console` (no `console.*` in `src/`), not into error texts, not into the clipboard without a click (`src/data-ui.js:102-104`); the record file download is a blob URL revoked after 30 s | `src/data-reader-ui.js:31,61-101`, `src/data-panel-ui.js:225-295` |
| HTML sinks fed with data | every `innerHTML` in `work.html` goes through `esc()`; the data cards, previews and messages use `textContent` (`src/data-ui.js`); `passkey-check.html` writes constants, numbers and a hex fingerprint; the work SVG is parsed with `DOMParser` and sanitised (scripts, `foreignObject`, `animate`/`set`, event handlers, non-image hrefs removed) before `importNode`; exception: I-5 | `work.html:278-305`, `src/data-ui.js:7-18` |
| hostile cells | `<img src=x onerror=…>`, `javascript:` URLs, RTL overrides, zero-width characters and formula-like cells were run through the fuzzer and the TGD round trip; they are shown as text (`textContent`), the invisible characters are stripped from the transport form, and formulas are guarded on export | section 10 |
| shares | XOR needs k = n (parsed); shares of different sets refused (`share-set`); duplicates refused; k − 1 refused with the numbers; an extra Shamir share off the polynomial refused (`share-inconsistent`); 4-byte check catches every single changed character; the index is 1..n (x = 0 impossible) | `src/keys-split.js:48-64,93-121` |
| randomness | `crypto.getRandomValues` only (`Math.random` does not occur in `src/`, `cli/`, `api/`); the passphrase generator masks 16 random bits to 11 (exactly uniform); the book cipher uses rejection sampling | `src/keys-split.js:15-16,162-166`, `src/crypt-book.js:22-25` |
| passkey page | PRF outputs stay in a closure and are discarded; the result block holds no key and no credential id (`passkey-check.html:154`); the credential id is shown only in its own field; `rpId` = `location.hostname` for create and get; on a non-secure origin `isSecureContext` is false and both buttons are disabled with a message; only the language is stored. See I-4. | `passkey-check.html:157-167,169-220` |
| CLI secrets | never on the command line (`--key`, `--password`, `--master`, `--mnemonic` are refused without echo); from a file, stdin or the environment; files with secrets are created `O_EXCL`, mode 0600, `fchmod` on the descriptor, symlinks refused; `--force` unlinks the path, not the target | `cli/tg-crypt.mjs:52-66,85-98`, `cli/tg-keys-cmds.mjs:20-28` |
| api/ spot check | job tokens compared with `timingSafeEqual`; the ledger is append-only by trigger; SQL uses placeholders; settings are validated at start-up; no new finding | `api/server.mjs:135-139`, `api/store.mjs:27-28`, `api/config.mjs` |

## 7. Known-answer vectors (`test/known-answer-b.test.js`, all pass)

| primitive | what is tested | vectors | source (fetched 2026-10-18) | result |
|---|---|---|---|---|
| SHA-256 | `sha256()` (crypt-codec), `sha256Hex()` (structure.js) | TEST1 "abc", TEST2_1, TEST3 (10^6 × "a"), TEST4 | RFC 6234 section 8.5, rfc-editor.org | pass |
| HMAC-SHA-256 / -512 | `hmac()` (keys.js), including the empty-key convention against node:crypto | test cases 1 to 7 (5 truncated, 6 and 7 with 131-byte keys) | RFC 4231 sections 4.2 to 4.8 | pass |
| HKDF-SHA-256 | `hkdf()` (keys.js) | A.1, A.2 (80-byte inputs, 82-byte output), A.3 (empty salt and info) | RFC 5869 appendix A | pass |
| PBKDF2-HMAC-SHA512, BIP-39 | `mnemonicToSeed`, `mnemonicToEntropy`, `entropyToMnemonic`, the checksum; `stretch()` against node:crypto | the "abandon … about" seed with "TREZOR", "all × 12", four entropy↔words pairs | Trezor `python-mnemonic` vectors, taken from the repository fixture (github.com was not fetched); they agree with the reviewer's recollection and with an independent PBKDF2 in the differential test | pass |
| SLIP-21 | `slip21Master`, `slip21Child` | the master node and the three published child keys of the "all × 12" seed | satoshilabs/slips `slip-0021.md`, via the repository fixture (same caveat) | pass |
| X25519 | `publicFromSecret` (= X25519(k, 9)); the agreement in the exact Web Crypto call shape the project uses; low-order inputs refused in `openFrom` | the two function vectors, the iterated vector after 1 and 1 000 iterations, Alice/Bob of 6.1; u = 0, u = 1, the order-8 point | RFC 7748 sections 5.2 and 6.1 | pass |
| Argon2id | the vendored `argon2idAsync` with `key` and `personalization`, and Node's `argon2Sync` with `secret` and `associatedData`; `stretch()` against Node | m = 32 KiB, t = 3, p = 4, the published 32-byte tag | RFC 9106 section 5.3 | pass (both implementations) |
| AES-256-GCM with AAD | the platform in the call shape of `sealItem`/`openSealed` (96-bit IV, 128-bit tag, `ciphertext ‖ tag`) | encrypt: PT 128/AAD 128 (3 cases), PT 256/AAD 160 (2), PT 0/AAD 128 (1); decrypt: 2 passing and 2 FAIL cases | NIST CAVP `gcmtestvectors.zip` (`gcmEncryptExtIV256.rsp`, `gcmDecrypt256.rsp`), csrc.nist.gov | pass, FAIL cases refused |
| GF(2^8) | `gfMul`, `gfInv`, `gfEval`, `gfInterpolate0` | {57}•{01…80} by xtime and {57}•{13} = {fe} (eq. 4.6, 4.7); {53}•{ca} = 1 hand-checked; **all 65 536 products** against shift-and-add reduction by 0x11b; all 255 inverses; Lagrange recovers the constant term | FIPS-197 section 4.2 (nvlpubs.nist.gov) | pass |
| base58 | `b58Encode`, `b58Decode`, refusal of `0 O I l`, 8 KiB round trips | 17 vectors incl. leading zeros, empty, `1111111111` | Bitcoin Core `base58_encode_decode.json`, recalled; every vector re-derived with an independent `BigInt` conversion in the test | pass |
| base64url | `b64urlEncode`, `b64urlDecode`, canonical form | "", f, fo, foo, foob, fooba, foobar; `-_8`; non-canonical `Zh`, `Zm9vYh`, length ≡ 1 mod 4, padding, `+/` refused; every length 0..300 against Node | RFC 4648 section 10 (base64 vectors, URL-safe and unpadded) | pass |
| checksum construction | `checksum(domain, body, n)` = `SHA-256(domain ‖ 0x00 ‖ body)[0..n]` | against node:crypto | the spec (`docs/key-format.md` 2.2, 2.3) | pass |

The HKDF, HMAC, PBKDF2, AES-GCM and X25519 vectors exercise the platform's Web Crypto through the project's wrappers; they cannot find a bug *inside* OpenSSL that the vectors would not show, and they were not run in a browser (the project's own browser test compares the derivations with Node byte for byte).

## 8. Differential tests (`test/differential-b.test.js`, all pass)

The reference side uses `node:crypto` (`hkdfSync`, `pbkdf2Sync`, `argon2Sync`, `createCipheriv('aes-256-gcm')`, `createHmac`, `diffieHellman` with PKCS#8/SPKI-wrapped X25519 keys), `node:zlib` and a `BigInt` base58; no function of `src/` is called on that side.

| format | reference | compared on | result |
|---|---|---|---|
| `tgs1.`/`tgx1.` | parse the key (version, flags, secret, fingerprint, inline, 2-byte check); derive `HKDF-SHA-256(ikm, "tgx1/salt", "tgx1/aes-256-gcm" ‖ digest)`; AES-GCM with AAD `"tgs1" ‖ head`; inner `varint ‖ kind ‖ data ‖ zero padding`; inflate / brotli | the 6 frozen records; 48 fresh seals (bound/unbound, 128/256, deflate/brotli/none, padding, password) opened by the reference; 32 records sealed **by the reference** opened by the project, also inside `TGS1[ ]` with line breaks | no difference |
| record keys, recipient secrets, factors, master | SLIP-21 (`HMAC-SHA-512("Symmetric key seed", seed)`, children `tgart/master/v1`); `HKDF(master, "tgart/hkdf/v1", "tgart/record-key/v1" 0x00 frame(id) frame(ctx))`; recipient and factor infos; BIP-39 by `pbkdf2Sync` | the fixture (5 record keys incl. a 512-character id, 2 recipient secrets, seed and passkey factors, 4 BIP-39 seeds); 20 fresh ids | no difference |
| `tgx2.` | tag = `HMAC-SHA-256(secret, "tgx2/work" ‖ digest)[0..4]`; parse version 2 | the fixture tag and keys; 12 fresh keys (both strengths, inline); records sealed by the reference under the same secret opened with the project's `tgx2.` key | no difference |
| `tgr1.` | X25519 agreement, HKDF salt `epk ‖ rpk`, info with the framed context, AAD, deflate flag | the 2 fixture records (with and without context); 16 fresh records each way; a changed context fails on both sides | no difference |
| Shamir and XOR shares | GF(2^8) by shift-and-add, inverse by b^254, Lagrange at 0; share token layout and 4-byte check | the fixture (3 of 5, any 3; the XOR set); 10 fresh splits by the project joined by the reference and 10 by the reference joined by the project (also with all shares, which triggers the consistency check) | no difference |
| vault | header, entries, wrap key `HKDF(factor, "tgv1/wrap", name)`, AAD, Argon2id/PBKDF2 parameters from the entry, Lagrange, `HMAC(V, "tgv1/check")[0..4]` | the fixture vault with seed + passphrase and with passkey + seed; one factor and a wrong passphrase refused; 4 fresh vaults (both KDFs) | no difference |
| password mixing | `salt = SHA-256("tgxm1/salt" ‖ S)`, `K = HKDF(S ‖ KDF(password), "tgxm1/hkdf", "tgxm1/key")` | the 2 fixture pairs; fresh half keys with both KDFs; a wrong password gives another key | no difference |
| `sealWithSecret` | – | a record key as the secret; the printed `tgx1.` and `tgx2.` keys carry exactly it | no difference |

Two things the differential work turned up that are not defects: the key-management fixture writes a 512-character record id as `x*512` (a notation of the builder), and the `tgx2`/`sealedWithSecret` vectors are bound to the builder's own work text, not the conformance work; the test documents both. **Spec and code agree on every byte layout and derivation that was re-implemented;** no clarification of `docs/key-format.md` or `docs/key-management.md` was needed.

## 9. Static analysis (semgrep 1.155.0)

Run (the registry packs are a read-only rule download; `--metrics=off`; nothing was uploaded):

```
EIO_BACKEND=posix semgrep --config p/javascript --config p/nodejs --config p/security-audit --config p/owasp-top-ten \
  --config p/secrets --config scripts/semgrep-rules-b.yaml --metrics=off --json src cli api scripts <inline scripts>
```

`EIO_BACKEND=posix` was needed because semgrep-core aborted with `io_uring_queue_init: out of memory` on this machine (an environment limit). The inline module scripts of `app.html`, `work.html` and `passkey-check.html` were extracted to files for the scan. 87 files, 369 rules after dedup.

- **Registry rulesets (p/javascript, p/nodejs, p/security-audit, p/owasp-top-ten, p/secrets): 0 findings.** That they do fire was verified on a deliberately vulnerable canary file (3 findings: `detect-child-process`, `code-string-concat`, `direct-response-write`).
- **Hand-written rules (`scripts/semgrep-rules-b.yaml`, 16 rules): 207 findings, all triaged, none a defect:**

| rule | hits | triage |
|---|---|---|
| console output | 127 (api 13, cli 56, scripts 58; none in `src/`) | progress and errors of command-line tools; the key-bearing paths were read: `tg-crypt` prints a key only to stdout and never on stderr (tested by the project's CLI tests); no secret in `api/` logs |
| file write at a computed path | 43 | build scripts and public outputs (records, PDFs); every file that holds a secret goes through `writeSecretFile` (`cli/tg-keys-cmds.mjs:20`); `api/server.mjs:120` writes the uploaded job input under a random UUID directory |
| HTML sink from a variable | 12 (inline pages) | all escaped or constant (section 6); one error-message sink noted as I-5 |
| regex built from data | 7 | fence lengths (a number) and a fixed character, `NAME.source` (constant), two scripts |
| clipboard write | 5 | all inside click handlers |
| browser storage | 4 | language and generator settings only |
| plain-object index write | 4 | computed cell addresses (`addr(r, c)`), the fuzzer |
| URL/history write | 2 | view names only |
| extractable Web Crypto key | 2 | I-7 |
| DOMParser | 1 | the SVG sanitiser |
| code evaluation, shell execution, Math.random, non-AEAD cipher, weak hash, postMessage to `*` | 0 | – |

Limits: semgrep's JavaScript rules know nothing of this project's crypto helpers; the registry rules' silence means "no known bad pattern", not "secure". The custom rules are pattern matches, not taint analysis.

## 10. Fuzzing (`scripts/fuzz-crypto-b.mjs`)

Deterministic (xorshift128 from the printed seed), bounded (1 500 ms per call, 1 GiB RSS), strict (any exception that is not a `CryptError`/`TgdError`, any call over the bound, is a finding). Strategies: random text per prefix; mutated valid tokens (truncation, deletion, insertion, substitution, swaps, duplication, random runs); bodies of random bytes with a **correct checksum** for every base58 format and for vaults (so that the parsers behind the checksum are reached); records with a valid header and random ciphertext opened with the right key, a wrong key and a password; crafted inner plaintexts; share mixtures, duplicates, k − 1 and forged shares; mnemonics and hex seeds; sealed blocks in text; KDF descriptors; every file format on random bytes, truncated and byte-flipped fixtures, mutated TGD blocks, mutated zip archives. The frozen conformance vectors are opened first so that the fuzzer never runs on a broken build.

- Full campaign: `node scripts/fuzz-crypto-b.mjs --seconds 150 --seed tg-fuzz-b-2026-10-18`: **757 275 calls** in 150 s (35 429 results, 721 825 clean refusals), slowest call 51 ms, peak RSS 188 MB; **21 findings, all the same crash** (`TypeError` in `readXlsx` on a dangling comments relationship) → fixed as B-6. The same campaign after the fix (same seed): **750 241 calls, 0 findings**, slowest call 57 ms (a PBKDF2 half key), peak RSS 189 MB.
- Suite subset (`test/fuzz-b.test.js`, `--quick`, seed `tg-fuzz-b`): 2 001 calls in about 0.6 s, 0 findings.
- Targeted adversarial inputs timed by hand (section 3): long runs of spaces, unclosed `<`, nested brackets, quote runs, entity runs, deep JSON, zip bombs (the project's own tests cover the inflate bomb).

What the fuzzer does not do: coverage guidance, structure-aware generation of valid XML/YAML/Markdown beyond mutation of the fixtures, or runs longer than minutes. A longer, coverage-guided campaign (section 13) could still find crashes in the file parsers; the crypto parsers are small and were exercised with forged checksums, so their coverage is more complete.

## 11. What was not covered, what remains unproven

- The platform primitives (Web Crypto in Node/OpenSSL, V8, the browser engines) were trusted; the vectors show they produce the standard answers for the shapes used, no more.
- No side channels were measured. The argument in section 6 that no comparison leaks a secret is reasoning, not measurement.
- No formal proof of the constructions. The HKDF/AEAD/ECIES/Shamir/vault designs are standard compositions and were checked against their specs, not proven.
- The browser pages were read and the project's headless-Chromium checks ran; the pages were not driven with hostile inputs in a real browser beyond those checks, and Firefox and Safari were not run here.
- Real authenticators (security keys, platform passkeys on phones, Windows Hello) were not tested; the project says so too.
- The vendored Argon2 files were not compared with the npm tarball (I-10).
- `api/` was spot-checked only.
- The first review's findings were not seen; agreement or disagreement between the two reviews is for the owner to compare.

## 12. Decisions for the owner

1. Cherry-pick the fixes (section 4) and the new tests; they are backward compatible.
2. I-1: accept base58's 3-second worst case on a pasted junk key, or replace the converter.
3. I-2: keep the tgx2 tag construction (sound under standard assumptions) or plan a separate tag key for a future key version.
4. I-4: require user verification for passkey factors in the future vault page.
5. I-10: compare `assets/vendor/noble-hashes` with `npm pack @noble/hashes@2.4.0` once, from a machine that may reach the registry, and record the result.
6. Whether to lower the browser-side zip/XML/cell limits for the web panel (I-9).
7. Whether `app.html:763` should use `textContent` (I-5).

## 13. Recommended scope and effort for a real external review (an estimate)

Scope: `src/crypt.js`, `src/crypt-codec.js`, `src/keys*.js` (about 1 100 lines), the two browser panels that hold keys (`src/data-panel-ui.js`, `src/data-reader-ui.js`, `src/data-ui.js`), `passkey-check.html`, the CLI key paths (`cli/tg-crypt.mjs`, `cli/tg-keys-cmds.mjs`), and the specs `docs/key-format.md`, `docs/key-management.md`, `docs/encrypted-data.md`. Ask for: a design review of the compositions (HKDF usage, the tgx2 tag, the vault's k-of-n with a passphrase factor, nonce and key-reuse arguments, the missing key commitment of GCM when records are shared between holders), a code review of the parsers with their bounds, a browser review of where secrets live, and a look at the two open design items (post-quantum hybrid for `tgr1.`, key-committing record version). The file parsers (`src/structured*.js`) are a second, separable engagement (parser security, with a longer coverage-guided fuzz).

Effort, estimated: 4 to 6 person-days for the cryptographic part by one experienced reviewer, 2 to 3 days for the parsers, plus 1 day for the write-up; a short re-review after fixes. This estimate is the reviewer's judgement from the size and shape of the code, not a quote.

## 14. How to reproduce

```
node --test test/                       # 321 tests (after the merge of main), including the review's files
node --test test/known-answer-b.test.js test/differential-b.test.js test/hardening-b.test.js test/fuzz-b.test.js
node scripts/fuzz-crypto-b.mjs --seconds 150 --seed tg-fuzz-b-2026-10-18
EIO_BACKEND=posix semgrep --config scripts/semgrep-rules-b.yaml --metrics=off src cli api scripts
```
