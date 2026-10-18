# Key management: one seed, a key per record, sealing to a recipient, splitting

Design and reference for `src/keys*.js` and the new commands of `cli/tg-crypt.mjs`. Companions: [encrypted-data.md](encrypted-data.md) (threat models), [key-format.md](key-format.md) (existing formats), [cipher-review.md](cipher-review.md) (is AES-256-GCM enough; the numbers behind the password rule). Everything below was built and tested unless the heading says **designed only**. "Measured" means run on this machine (Node 26.11.1, Chromium 154, Firefox 153).

## 0. Principles

1. **A human-chosen password is never the only secret of a record that is public or permanent.** The default secret is random (256 bits); a password or passphrase can be an *additional* factor. Enforced: password-only sealing needs `--accept-password-only` (local files), `publish` refuses password-only records, `assertPublishable()` is the library check. Numbers in [cipher-review.md](cipher-review.md) section 0.
2. **A public book stores nothing and protects nothing.** In the book cipher the data is in the key and the book is a lookup table; "which book" is security by obscurity worth `log2(number of candidate books)`, about 17 to 20 bits for public corpora. Not a protection; not built.
3. **Derive, never reuse.** Keys come from a seed by a *separate* derivation. The wallet's signing key (DigiByte is BIP-44 coin type 20, `m/44'/20'/0'/0/i`) is never used, and the derivation cannot reach it (section 2.3).
4. **One key per message.** Nonce limits and key-compromise damage stay tiny.
5. **Secrets only in files, standard input, environment or memory; never in arguments, URLs, logs, error messages, storage.** Error messages never quote a word, key or share (tested).
6. **Honest scope.** What is built, what is designed only, and what each construction does *not* protect are stated in each section.

## 1. State

| Part | State |
|---|---|
| BIP-39 words to seed (PBKDF2-HMAC-SHA512, 2048), checksum validation of 12/15/18/21/24 words, English list as a data file (MIT) | **implemented**, tested (the Trezor vector) |
| SLIP-21 symmetric derivation, master secret, per-record keys (HKDF-SHA-256) | **implemented**, tested (the four published SLIP-21 keys) |
| Sealing to a recipient (X25519 ECIES, `tgp1.`/`tgq1.`/`tgr1.`) | **implemented**, tested |
| Hidden work binding (`tgx2.`) | **implemented**, tested, opens through `openAny` and `tg-crypt open` |
| XOR n-of-n and Shamir k-of-n shares (`tgsh1.`) | **implemented**, tested (exhaustive uniformity proof on one byte) |
| Password mixing (`tgxm1.` half key), Argon2id and PBKDF2-SHA512 | **implemented**, tested |
| Vault, default `tgv2.` (V = the master: the seed alone recovers everything; passkey + passphrase as 2-of-2 convenience wrappers) and strict `tgv1.` (random V, the seed one of k-of-n shares), passkey (WebAuthn PRF) and seed as factors | **implemented**, tested (frozen vectors for both modes; Chromium with a virtual passkey); real authenticators **unverified** |
| Passphrase generator from the word list | **implemented** |
| Browser module API (the same modules; Chromium and Firefox equal Node on the vectors) | **implemented**, tested |
| CLI: `master`, `derive`, `recipient`, `split`, `join`, `seal --to`, `seal --record-id`, `open`, `vault create`, `vault open`, `vault inspect` | **implemented**, tested |
| Panels in `app.html` / `work.html` | **designed only** (section 9; another agent builds the panels) |
| `tgx2.` in the generator (`app.html` writes `tgx2.`; `work.html` and the CLI open `tgx1.` and `tgx2.`) | **implemented**, checked in headless Chrome (`scripts/check-web-data.mjs`) |
| Post-quantum hybrid `tgr2.`, key-committing record version | **designed only** |
| CLI for password mixing | **designed only** (library works; the command is not added) |

## 2. Master key and per-record keys

### 2.1 From the seed to the master secret

Input is a **BIP-39 mnemonic** (12, 15, 18, 21 or 24 English words, with an optional BIP-39 passphrase) or, for people without the word list, a **hex seed** of 16 to 64 bytes.

```
seed   = PBKDF2-HMAC-SHA512( NFKD(words, single spaces, lower case), "mnemonic" + NFKD(bip39 passphrase), 2048 iterations ) -> 64 bytes
node   = HMAC-SHA512( key = "Symmetric key seed", seed )                              SLIP-21 master node (chain code = bytes 0..31, key = bytes 32..63)
child  = HMAC-SHA512( key = parent chain code, 0x00 || label )                          SLIP-21 child
master = key of the node  m / "tgart" / "master" / "v1"                                 32 bytes
```

The mnemonic is checked (word list, count, 4 to 8 bit checksum) *before* a seed is made; a typo is refused, not turned into a different seed. The checksum is short: one wrong word in sixteen still passes it (tested: at most a quarter of single-word substitutions slip through; by design of BIP-39), so write the words carefully and test once by deriving a key you already know.

**Seed as hex** is accepted exactly because the word list is optional for users; a hex seed gives the same tree with no checksum at all, so a typo yields a valid but different master. The CLI and the module accept both.

`formatMaster(master)` writes the master as `tgmk1.` + base58(version 1, 32 bytes, 2-byte check), 53 characters. This text is as secret as the seed.

### 2.2 Record keys

```
K_i = HKDF-SHA-256( ikm  = master,
                    salt = "tgart/hkdf/v1",
                    info = "tgart/record-key/v1" 0x00 varint(len id) id varint(len context) context,
                    length 32 )
```

`id` is a non-empty string of at most 512 bytes (NFC, UTF-8), `context` a string of at most 256 bytes, empty by default (a work digest, a purpose label). The length framing means `("ab","c")` and `("a","bc")` cannot collide (tested). The limits keep `info` under 1024 bytes because **Node's Web Crypto refuses longer HKDF info (measured: `OperationError`)**, so the same call works in both engines. `K_i` is used as the 32-byte secret of an ordinary `tgx1.`/`tgx2.` key; `sealWithSecret` puts it in a record and `openWithSecret` / `openAny` open it.

Recipient key pairs come from the same master under another HKDF domain (`"tgart/recipient/v1" 0x00 varint(index)`), see section 3. Versioning: `v1` is part of every label and info string; a future `v2` is a new string beside it; nothing old changes.

### 2.3 Tested properties and the rules enforced

- Different ids (300 tested) give different, unrelated keys: pairwise Hamming distance 90 to 166 of 256 bits. Context separates, `é` equals `é` (NFC).
- **The master never appears in any output**: not in a key, a sealed record, a share, a vault or a recipient key (tested by scanning outputs for the master as hex and as text). A single `K_i` reveals neither the master nor another record's key (HKDF is one-way); it opens exactly one record (tested).
- **The wallet's signing key is never used.** The derivation enters only the SLIP-21 tree, whose root HMAC key is `"Symmetric key seed"`, not BIP-32's `"Bitcoin seed"`, so the trees are domain-separated by construction (the test compares the master with every part of the BIP-32 master of the same seed). `slip21Path` refuses any label path that does not start with `"tgart"`; no function accepts a `m/44'/20'/...` path or exports a BIP-32 value; a test greps the modules for `Bitcoin seed`, `secp256k1` and `44'`.
- Seed input accepts hex and words only.

### 2.4 Consequences, stated plainly

- **One seed backup opens everything** derived from it. That is the point, and also the risk: whoever holds the seed holds all records. Treat the seed like the wallet's.
- **If the platform's wallet seed is the user's seed, theft of the wallet seed opens the data.** The platform's wallet is watch-only (an extended public key) and its seed is held by the operator; for **private user data the seed must stay with the user**. If the same words are used for the DigiByte wallet and for this tree, losing or leaking them loses both funds and data. Recommendation: use a seed (or a BIP-39 passphrase on the same words) for data that is separate from the funds' seed.
- **A lost seed loses the data.** There is no recovery. The vault (section 7) is the way to make loss survivable without weakening anything.
- **A hardware wallet usually cannot do this.** Trezor implements SLIP-21 for its own purposes (the standard was written by SatoshiLabs); Ledger and most others expose no symmetric derivation to a web page. With a hardware wallet the practical route is a *separate* seed for data, or the passkey factor of section 7.
- A seed typed into a web page is at the mercy of the page and the device (section 9). **The CLI is preferred for the seed**: it reads the words from a file, standard input or the environment, derives, prints the master key and nothing else, and no page script, extension or analytics sees it. The master key (not the words) can then be used for everything below.

## 3. Sealing to the owner of a public key

"Seal for the owner of a public key without knowing anything secret", for example a record that only the platform's recipient or a friend can open.

### 3.1 The three candidates

| Option | For | Against |
|---|---|---|
| **X25519 ECIES** (Web Crypto) | In Node 20+ and every current browser: **measured: Node 26, Chromium 154, Firefox 153 have it; Safari 17+ cited, unverified here**. No dependency. 32-byte keys. | Not the wallet's curve. |
| secp256k1 ECIES | Same curve as the DigiByte wallet; one key for both would be "elegant". | **Not in Web Crypto**; needs a vendored library; and reusing the wallet's signing key for encryption is exactly what principle 3 forbids. |
| **A separate X25519 key derived from the master** | One seed backup still covers it; keys disjoint from the wallet; no dependency. | Same as option 1. |

**Chosen: X25519, with the recipient key either random (`tgq1.` secret file) or derived from the master (`recipientSecret(master, index)`).** It works wherever the page runs, uses only available primitives, and keeps wallet and data separate.

### 3.2 Construction (`tgr1.`)

```
recipient public key   tgp1.  base58( 0x01, X25519 public key 32 bytes, check 2 )      52 characters
recipient secret key   tgq1.  base58( 0x01, secret 32 bytes, check 2 )                 52 characters
sealing:   esk random (32 bytes), epk = X25519 public of esk          (ephemeral per record)
           shared = X25519( esk, rpk )                                 (an all-zero result is refused)
           key    = HKDF-SHA-256( ikm = shared, salt = epk || rpk,
                                  info = "tgr1/aes-256-gcm" 0x00 varint(len ctx) ctx ) -> AES-256-GCM
           AAD    = "tgr1" || version || flags || epk || varint(len ctx) || ctx
record     tgr1.  base64url( 0x01, flags, epk 32, nonce 12, ciphertext || tag 16 )     flags bit 0 = raw deflate
plaintext  kind(1: tgd, 2: text, 3: bytes) || data
```

The recipient key and the ephemeral key are both in the salt, so the key is bound to this exchange; a **context** (a work digest, a record id) is authenticated but never stored, so a record sealed in the context of one work does not open in another. A record for one byte is 91 characters. The record is authenticated end to end: every byte flipped in a test record is refused (all of them, cleanly).

What it does **not** give: the sender is **not authenticated** (anyone with the public key can seal to it; add a signature if the sender must be known); there is **no forward secrecy for the recipient** (whoever steals the recipient secret opens every record ever sealed to it); and it is **not post-quantum** (section 11).

## 4. Hidden work binding: `tgx2.`

A `tgx1.` key contains the first 8 bytes of the work's SHA-256, so anyone holding a list of candidate works recognises *which work* a key is for. A **`tgx2.`** key contains instead a 4-byte tag:

```
tag = first 4 bytes of HMAC-SHA-256( secret, "tgx2/work" || SHA-256(canonical work text) )
bytes  = 0x02, flags, secret (16 or 32), [tag 4 if bound], [record if inline], check 2        flags as tgx1: bound 1, inline 2, 16-byte secret 4
```

The sealed record (`tgs1.`) is **unchanged**: bound records still derive their content key from the work digest through HKDF, so `tgx2.` is a new key version beside `tgx1.`, not a new record. Opening: the reader derives the tag from the key's own secret and the work, compares, and only then decrypts.

**Lengths (measured):**

| key | `tgx1.` | `tgx2.` |
|---|---|---|
| 256-bit, bound | 64 | **59** |
| 128-bit, bound | 42 | **37** |
| 256-bit, unbound | 53 | 53 |
| 128-bit, unbound | 31 | 32 |
| 256-bit, bound, record inside (one-word message) | 109 | **104** |

It does not grow where it matters (bound keys are 5 characters shorter) and an unbound 128-bit key is one character longer because of the version byte's base58 carry.

**What is hidden:** the key no longer shows which work it belongs to; two keys for the same work have unrelated tags (30 tested); testing a candidate work needs the secret. **Which error distinctions survive and which are lost:**

- Kept: with a `tgx2.` key and the wrong work, the reader says `wrong-work` *before decrypting* (tag mismatch), as with `tgx1.`; a missing work is `work-required`; a wrong key or another record is `auth-failed`; a typo is `checksum`.
- Lost, 1: someone **without** the key can no longer tell which work a key fits. That is the intended change.
- Lost, 2: the tag is 4 bytes, so a wrong work passes it with probability `2^-32`; the reader then says `auth-failed` ("wrong key, a different work, or the record was changed") instead of `wrong-work`. The ciphertext still refuses.
- Lost, 3: a key **derived from the master** (section 2) has no key text, so no tag exists: with a derived key a wrong work is not told apart from a wrong key (both `auth-failed`; tested). With the printed `tgx2.` form of the derived key (`derive --work`), the distinction is back.
- **Not hidden:** the *record* has its "bound" flag in its public header (it shows that it is bound, not to what), and the key text still has its flags (bound, inline, 16 or 32 bytes).

## 5. Splitting and the second factor

A share, a half key or a vault that is public protects nothing **by itself it is not meant to protect**: each is one part of several. **Nothing that is split protects anything if all parts are stored in the same place.** And: a share that is made public is public; the other shares must stay private.

| Construction | Protects against | Does not protect against |
|---|---|---|
| **XOR n-of-n** (`splitXor`, `tgsh1.` type 1) | Loss of any n-1 parts to a thief: n-1 shares give no information at all (a one-time pad of the secret) | Losing any single share destroys the secret (all n are needed) |
| **Shamir k-of-n** (`splitShamir`, type 2, GF(256), AES polynomial) | Theft of up to k-1 shares: no information (proved exhaustively, below); loss of up to n-k shares | k shares stolen; shares kept together |
| **Password mixing** (`tgxm1.` half key + memorised password) | Theft of the half key alone; guessing of the password alone (there is nothing to check a guess against without the record *and* the half key) | Theft of both; a weak password **plus** the record and half key: the attacker then guesses the password offline at the KDF's price (Argon2id by default) |
| **Vault, default** (`tgv2.`, section 7) | Loss of the passkey, the passphrase or the vault file (the seed recovers everything); theft of the vault with one convenience factor; the passphrase alone, always | theft of the seed (it opens everything, section 2.4); theft of passkey *and* passphrase |
| **Vault, strict** (`tgv1.`, section 7) | Theft of any set of factors that is smaller than k, the seed alone included; the passphrase alone, always | k factors; loss of the vault file with fewer than k factors left |

### 5.1 Share tokens

```
tgsh1.  base58( 0x01, type (1 xor, 2 shamir), set id 4 random bytes, k, n, index 1..n, data, check 4 )
```

The **set id** is random per split: shares of different splits (different secrets, or the same secret split twice) are refused as `share-set`, never combined silently. The 4-byte check catches typos (every single changed character was caught in the test). There is **no check of the secret inside the share**, on purpose: any value derived from the secret in each share would be an oracle for guesses; the check that the result is right is the next step (the AEAD tag of the record).
`joinShares` refuses cleanly: too few shares (`share-too-few`, naming how many are needed), a repeated share, shares of different sets, and a Shamir set where an extra share lies off the polynomial (`share-inconsistent`, tested with a forged but correctly checksummed share).

### 5.2 Why k-1 shares give no information (tested, exhaustively)

The share at x is `s + a1·x + … + a(k-1)·x^(k-1)` with uniformly random coefficients. For one byte over GF(256): for **every secret s (256)** and **every value of one share (256)** exactly one coefficient `a1` produces it (k = 2), and for k = 3, for every secret and every pair of share values `(y1, y2)` exactly one pair of coefficients does (65 536 pairs × 256 secrets, all enumerated in the test). So one or two shares are uniformly distributed and independent of the secret. The real splitter's output for one byte over 25 600 runs passes a chi-square uniformity test.

### 5.3 Password mixing

```
S      random 32 bytes      (kept as the half key  tgxm1. base58( 0x01, kdf parameters, S, check 2 ), 58 or 61 characters)
salt   = SHA-256( "tgxm1/salt" || S )
K      = HKDF-SHA-256( ikm = S || KDF(NFC(password), salt, parameters), salt = "tgxm1/hkdf", info = "tgxm1/key" )  -> 32 bytes
```

`K` is then the secret of an ordinary key (`sealWithSecret`). The KDF is **Argon2id** by default (64 MiB, 3 passes, 1 lane: 0.9 s in Chromium, 1.8 s in Firefox, 0.13 s native; vendored, equal to native in a test) or PBKDF2-HMAC-SHA512 (600 000 iterations); the parameters sit in the half key with bounds (a hostile public value cannot make a reader allocate more than 256 MiB). Guessing the password alone does nothing; losing the half key alone does nothing; the wrong password gives a different `K` and the record refuses it.

## 6. Which key to give to whom

| Situation | Give |
|---|---|
| One record to one person | the record key `K_i` as a `tgx2.` key (`tg-crypt derive <id> --work <work>`); they cannot reach the master or other records |
| Everything to yourself on a new device | the master key `tgmk1.` (or the seed) |
| Something to someone who has a public key | `seal --to <tgp1.>`; they open with their secret key |
| A secret nobody should hold alone | Shamir 2-of-3 or 3-of-5 across people and places |
| Memorable access without weakening anything | the vault, section 7 |

## 7. Recommended structure for memorable access: the vault **(implemented)**

A vault wraps a 32-byte **vault secret V** so that memorable factors open it: a **passkey** (WebAuthn PRF) and a **passphrase**, beside the **seed backup**. `V` then serves as a master: `recordKey(V, id)`. There are two modes; the vault text says which one it holds (the prefix, and in `tgv2.` an authenticated mode byte), decision 13.2:

| | **default** (`tgv2.`, `createVault` without a mode, `tg-crypt vault create`) | **strict** (`tgv1.`, `mode: 'strict'`, `--mode strict`) |
|---|---|---|
| `V` | **the master itself** (section 2) | 32 random bytes |
| the seed | opens everything **without any vault**: `V = master` | one share like the others: alone it opens nothing |
| without the seed | the convenience factors share `V` by Shamir k-of-n, `k = n` unless given: **passkey + passphrase, 2-of-2** | any k of all factors (2 of 3) |
| a passphrase alone | **never** (at most k-1 passphrase factors among the convenience factors) | **never** (at most k-1 passphrase factors) |
| the vault file is lost | nothing is lost: the seed recovers everything | `V` is gone unless k factors remain |
| the seed is stolen | **everything is open**, as everything sealed from it is anyway (section 2.4) | the thief holds one share of k |

```
tgv2.  base64url( 0x02, mode 0x00, k, n, verify 4,  n × [ name, x, kdf descriptor (passphrase only: parameters + 16-byte salt), nonce 12, AES-GCM(wrap key, share) ], check 4 )
       AAD = "tgv2" || header (the mode byte included) || the entry's head;   wrap key = HKDF-SHA-256( factor key, salt "tgv2/wrap", info name )
       verify = first 4 bytes of HMAC-SHA-256( V, "tgv2/check" );   the seed factor is NOT stored: opening with it is openVault(vault, { master }) (checked against verify) or no vault at all
tgv1.  base64url( 0x01, k, n, verify 4,  n × [ the same entry ], check 4 )      AAD = "tgv1" || header || head;   wrap key with "tgv1/wrap";   verify with "tgv1/check"
factor keys:  seed       factorFromMaster(master)   (strict only)   HKDF of the master, domain "tgart/factor/seed/v1"
              passkey    factorFromPrf(PRF output)                  HKDF, domain "tgart/factor/passkey/v1"; input prfInput(label)
              passphrase Argon2id(passphrase) with the parameters in the vault
```

Rules, **enforced by `createVault`** and tested, in both modes: **at most `k-1` passphrase factors** among the factors that share `V` (`k >= 2` in strict mode; `k >= 1` in default mode, so a single passkey may stand alone without the seed, a single passphrase may not), hence **every set of factors that opens a vault without the seed contains at least one high-entropy factor: a passphrase alone can never open anything**. Refused: a default vault of seed + passphrase only; 1-of-2 of passkey + passphrase; two passphrases with `k = 2`. The default mode needs exactly one master factor `{ name, master }` (never written into the vault) and no convenience factor named `master` (that name is the seed path when opening). Too few factors give `vault-too-few` with the numbers; a wrong factor is skipped, not fatal; a changed character is `checksum`; a changed mode byte with a fresh outer checksum is refused as `version`, never read as the other mode (the header is in every entry's AAD).

Consequences, default mode: losing the passkey (a phone, a reset) or forgetting the passphrase costs nothing, the seed is there; losing the seed paper is survived by passkey + passphrase as long as the vault file exists. The passphrase-wrapped share can be attacked offline if the vault is public, but it is one share of two: it gives the attacker nothing alone. The vault may be stored anywhere (it is encrypted shares), including with the records.

**The trade-off, decided (13.2):** in the default mode **a stolen seed opens everything**, exactly as it opens everything sealed from it anyway (section 2.4); in return the seed alone always recovers everything, with or without the vault, and nothing is lost with the vault file. The strict mode remains for people whose main risk is theft of the written seed: there the seed alone opens nothing, and in return a lost vault file loses `V` unless k factors remain. `tgv1.` vaults made before this decision are strict vaults and read as before.

### 7.1 Passphrases: how many words

`generatePassphrase(words)` draws words uniformly from the 2048-word BIP-39 list: **11 bits per word**, exactly uniform (2048 divides 65 536). 6 words = 66 bits, 8 = 88, 12 = 132, 16 = 176, 24 = 264. The table in [cipher-review.md](cipher-review.md) section 0.1 gives the years. **Rule:** the page offers to *generate*; it never advises "choose random words yourself". Eight generated words is a good factor; it is not recommended as the *only* protection of a permanent public record, because 88 bits is less than 128 and any human weakness in handling it becomes the whole security.

### 7.2 Passkeys (WebAuthn PRF), design

**Check your own device:** [`passkey-check.html`](../passkey-check.html) (on the site: `https://typographics-art.org/passkey-check`) runs exactly this flow on the device in front of you: it creates a test passkey, asks for the PRF secret three times (twice with the same input, once with another), runs a small 2-of-2 vault test (passkey plus a random second factor opens it, the passkey alone does not) and prints a result block to copy. It stores nothing and sends nothing; the result block contains no key and no credential id, only yes/no facts, the browser string and a 4-byte fingerprint. A test with Chromium's virtual authenticator is part of the suite (`test/passkey-check.test.js`); results from **real** devices are what is still missing, and the page exists so that they can be collected.

`prfInput(label)` gives the 32-byte `eval.first` input (SHA-256 of `"tgart/webauthn-prf/v1\0" + label`). Page flow: create the credential with `extensions: { prf: {} }` (learn `prf.enabled`), then `get` with `prf: { eval: { first: input } }`, take `results.first` (32 bytes), pass it to `factorFromPrf`, and discard it. Measured in Chromium with a virtual authenticator: enabled, 32 bytes, deterministic. **Unverified on real hardware, Safari and Windows Hello.** The relying party ID is part of the secret: the factor does not survive a change of domain. Synced passkeys are as strong as the cloud account that syncs them. Recovery: the seed backup and the passphrase remain.

## 8. Threat model per construction

| Construction | Attacker model | Holds against | Fails when |
|---|---|---|---|
| `tgx1.` / `tgx2.` key + `tgs1.` record, random secret | has the public record, even for ever | everything but a key leak (AES-256-GCM, 256-bit random key) | key lost or copied; the work text is also needed if bound |
| `tgx2.` instead of `tgx1.` | has the key and a list of candidate works | cannot tell which work (tag needs the secret) | the secret is also known (then nothing is hidden from them anyway) |
| Record key `K_i` | holds one `K_i` | cannot get the master or other records | the master or seed leaks |
| Master / seed | holds the master | – (it is everything) | any leak; seed kept with the wallet |
| `tgr1.` to a public key | has the record and the public key | cannot open without the secret key | recipient secret leaks (no forward secrecy); quantum computer later (X25519), if the record was published |
| XOR / Shamir shares | holds fewer than the threshold | no information (proved) | threshold reached; shares stored together or in one public place |
| Half key + password (`tgxm1.`) | has the record and the half key | password alone is nothing; half key alone is nothing | weak password **and** record **and** half key: offline guessing at Argon2id cost |
| Vault `tgv2.` (default) | holds the vault and one convenience factor | one factor; the passphrase alone, always | the seed (it is `V`); passkey and passphrase together |
| Vault `tgv1.` (strict, 2 of 3) | holds one factor, or has the public vault | one factor, the seed included; the passphrase alone | any two factors |
| Password only (legacy `tgs1.` password mode) | has a public record | only a very strong, truly random password | any human-chosen password (section 0.1 of the cipher review): **refused for publishing** |
| **All of the above** | a malicious browser extension or a compromised device | nothing: it reads memory and keystrokes | – (section 9) |

## 9. Browser rules and the user interface **(designed; the module is built)**

### 9.1 What the page must do

The same pure modules run in Node and in the browser (Web Crypto only; the browser tests in Chromium 154 and Firefox 153 reproduce the Node result byte for byte, including Argon2id at the default parameters). A page that takes a seed or a master key must:

1. Keep the words, the seed and every derived key **in memory only**: never in `localStorage`, `sessionStorage`, IndexedDB, cookies, the URL (no `?seed=`, no fragment), the DOM beyond the input being typed, logs, `postMessage`, or the clipboard (the page never copies a secret; it offers the user a *download* or an on-screen display of the key, not an automatic copy).
2. **Clear the input** on an explicit button ("Clear seed"), when the page is hidden (`pagehide` and `visibilitychange` to hidden), and after a successful derivation: set the field's value to the empty string, drop references to the typed string and zero any `Uint8Array` it made (`.fill(0)`). JavaScript strings cannot be wiped; this is best effort, and the page must say so.
3. Mark the field `autocomplete="off"`, `autocapitalize="off"`, `autocorrect="off"`, `spellcheck="false"`, `type="password"` (or a masked field with a "show" toggle), `inputmode="text"`, and no `name` that password managers recognise as a login. No third-party script on the page (the site's CSP is strict; the vendored Argon2id is a same-origin module under `assets/vendor/`).
4. Show **errors visibly under the action**, in words, never as an alert and never quoting the input ("A word is not in the list" without the word).
5. Run the KDF in a worker or yield to the event loop: the Argon2id of the vendored module has `argon2idAsync`, which does (about 1 s of work must not freeze the page).
6. Never offer password-only protection for a record that may be published; offer *generate a key* first, and *add a passphrase* as an addition (section 5.3).

**What the page cannot protect against:** a malicious or over-permissioned **browser extension** (it can read any field and the page's memory), a **compromised device** (keylogger, screen capture, malware), a malicious page served in place of this one (verify the address; a self-hosted copy of the repository is the safest), shoulder-surfing, and the user's own backup habits. For the seed, **prefer the CLI**; for high value, prefer an offline machine.

### 9.2 Wording, English

| Place | Text |
|---|---|
| Panel title | Keys from your seed |
| Seed field label | Recovery words (12 to 24) |
| Seed field help | Typed here, kept in this tab's memory only, never saved or sent. Use the command line for important seeds. |
| Button | Make my master key |
| Button | Clear seed now |
| Result | Master key made. Keep it as safe as your seed. It is not stored. |
| Warning | Anyone with these words or this key can open everything made from them. A browser extension or an infected computer can read what you type here. |
| Error, count | A recovery phrase has 12, 15, 18, 21 or 24 words. |
| Error, word | One word is not in the word list. Check the spelling. |
| Error, checksum | These words do not form a valid phrase: a word is wrong or in the wrong place. |
| Error, key typo | The key has a typing error: its check characters do not match. |
| Error, too few shares | 2 shares are needed for this secret; 1 given. |
| Error, other secret | These shares belong to different secrets and cannot be combined. |
| Error, wrong factor | Not enough factors opened the vault: 1 of 2 worked. |
| Passphrase | Choose "Generate" for a passphrase. 8 generated words are a good second factor. They are never enough alone for data that will be public. |
| Password rule | A password alone cannot protect a record that may be published. Add a random key. |
| Sealing | Seal for the owner of a public key: only the matching secret key can open it. You cannot open it yourself. |
| Vault mode, default | Your seed alone always recovers everything, even without this vault. A passkey together with a passphrase opens it without the seed; a passphrase alone never does. Whoever holds your seed holds everything. |
| Vault mode, strict | Any two of seed, passkey and passphrase open the vault; the seed alone does not. Choose this if theft of the written seed is your main risk: if the vault is lost, the seed alone cannot recover it. |

### 9.3 Wording, German

| Stelle | Text |
|---|---|
| Titel des Bereichs | Schlüssel aus Ihrem Seed |
| Beschriftung | Wiederherstellungswörter (12 bis 24) |
| Hilfe | Die Wörter werden nur hier eingegeben, bleiben nur im Speicher dieses Tabs und werden weder gespeichert noch gesendet. Für wichtige Seeds nutzen Sie die Kommandozeile. |
| Schaltfläche | Hauptschlüssel erzeugen |
| Schaltfläche | Seed jetzt löschen |
| Ergebnis | Hauptschlüssel erzeugt. Bewahren Sie ihn so sicher auf wie Ihren Seed. Er wird nicht gespeichert. |
| Warnung | Wer diese Wörter oder diesen Schlüssel besitzt, kann alles öffnen, was daraus entstanden ist. Eine Browser-Erweiterung oder ein infizierter Rechner kann mitlesen, was Sie hier eingeben. |
| Fehler, Anzahl | Eine Wiederherstellungsphrase hat 12, 15, 18, 21 oder 24 Wörter. |
| Fehler, Wort | Ein Wort steht nicht in der Wortliste. Bitte die Schreibweise prüfen. |
| Fehler, Prüfsumme | Diese Wörter ergeben keine gültige Phrase: Ein Wort ist falsch oder steht an der falschen Stelle. |
| Fehler, Tippfehler | Im Schlüssel steckt ein Tippfehler: Die Prüfzeichen stimmen nicht überein. |
| Fehler, zu wenige Teile | Für dieses Geheimnis werden 2 Teile gebraucht; angegeben wurde 1. |
| Fehler, fremdes Teil | Diese Teile gehören zu verschiedenen Geheimnissen und lassen sich nicht zusammensetzen. |
| Fehler, Faktor | Es haben nicht genug Faktoren den Tresor geöffnet: 1 von 2 hat funktioniert. |
| Passphrase | Wählen Sie «Erzeugen». 8 erzeugte Wörter sind ein guter zweiter Faktor. Für Daten, die öffentlich werden, reichen sie allein nie aus. |
| Regel zum Passwort | Ein Passwort allein darf keinen Datensatz schützen, der veröffentlicht werden könnte. Fügen Sie einen zufälligen Schlüssel hinzu. |
| Versiegeln | Für den Besitzer eines öffentlichen Schlüssels versiegeln: Nur der passende geheime Schlüssel kann es öffnen. Sie selbst können es nicht öffnen. |
| Tresor-Modus, Standard | Ihr Seed allein stellt immer alles wieder her, auch ohne diesen Tresor. Ein Passkey zusammen mit einer Passphrase öffnet ihn ohne den Seed; eine Passphrase allein nie. Wer Ihren Seed besitzt, besitzt alles. |
| Tresor-Modus, streng | Zwei beliebige von Seed, Passkey und Passphrase öffnen den Tresor; der Seed allein nicht. Wählen Sie das, wenn der Diebstahl des aufgeschriebenen Seeds Ihr grösstes Risiko ist: Geht der Tresor verloren, kann der Seed allein ihn nicht wiederherstellen. |

## 10. CLI (`cli/tg-crypt.mjs`, additive)

```
tg-crypt master                       --mnemonic-file <f> | --mnemonic-stdin | TG_CRYPT_MNEMONIC        (or --seed-file / --seed-stdin / TG_CRYPT_SEED for hex)
                                      optional BIP-39 passphrase: --bip39-passphrase-file <f> | TG_CRYPT_BIP39_PASSPHRASE        prints tgmk1.
tg-crypt derive <id> [--work <work>]  --master-file <f> | --master-stdin | TG_CRYPT_MASTER                       prints a tgx2. key
tg-crypt derive - --recipient [--index n]                                                                     prints the recipient secret tgq1.
tg-crypt recipient --new -o <file>    new recipient key pair: secret to the file (mode 0600, exclusive), public key printed
tg-crypt recipient --recipient-key-file <f> | --master-file <f> [--index n]                                   prints the public key tgp1.
tg-crypt seal <work> --to <tgp1.> (--message … | --data <file>) [-o record]                                    no key printed: only the owner opens it
tg-crypt seal <work> --record-id <id> --master-file <f> …                                                      the key is derived again when opening
tg-crypt open <work> --record <f> (--recipient-key-file <f> | --recipient-key-stdin | TG_CRYPT_RECIPIENT_KEY | --master-file <f> --index n)
tg-crypt open <work> --record <f> --record-id <id> --master-file <f>
tg-crypt open <work> --key-file <f> --record <f>      also reads tgx2. keys
tg-crypt split (--xor <n> | --shamir <k>:<n>) [-o <prefix>]       key from --key-file / --key-stdin / TG_CRYPT_KEY; shares one per line, or <prefix>.1 …
tg-crypt join <share file>… | --shares-stdin                                                                    prints the secret
tg-crypt vault create [--mode default|strict] [-o <vault file>]   the seed: --seed-file <f> | --seed-stdin | TG_CRYPT_SEED (or a mnemonic as for `master`, or the master key as for `derive`)
                                                                   a passkey: --passkey-file <f> | TG_CRYPT_PASSKEY (the passkey's 32-byte PRF output, hex; the factor is derived here)
                                                                   a passphrase: --passphrase-file <f> | --passphrase-stdin | TG_CRYPT_PASSPHRASE.      prints the vault, or writes it with -o
tg-crypt vault open <vault file> [-o <secret file>]                the same inputs; prints "Vault opened with <factors>", nothing secret; -o writes the secret as a tgmk1. master key
tg-crypt vault inspect <vault file>                                mode, threshold k, factor names and KDF parameters; no secret
```

`vault create` makes the **default** vault (section 7) unless `--mode strict` is given: `vault open --seed-file` (or any seed or master input) opens it by the seed alone, and so do passkey and passphrase together; seed + passphrase only is **refused at creation**, since the passphrase would then open it alone. In strict mode the seed is one share: `open` with the seed alone fails with the numbers, any two factors succeed. `--passkey-file` holds the **PRF output** of the passkey (32 bytes as 64 hex characters, what `passkey-check.html` and `prfInput` produce), not the derived factor: the CLI derives the factor with `factorFromPrf`, as the page does, so the same passkey opens the vault in both. The vault file and the opened secret go through the 0600 exclusive writer below (tested: an existing file and a symlink are refused, `--force` replaces); the opened secret is written as a `tgmk1.` master key, which in the default mode *is* the seed's master key and in strict mode is the vault's own `V` (usable with `--master-file` everywhere).

Secrets only from files, standard input or the environment; **an option that would take a secret as an argument does not exist** (`--master`, `--mnemonic`, `--key` are refused as unknown options without echoing the value; tested). stdout carries the result only; progress goes to stderr and never contains a secret (tested). Files that hold secrets (`recipient --new`, `split -o`, `open -o`) are created with `O_CREAT|O_EXCL` and mode `0600` (and `fchmod` again on the open descriptor, so a permissive umask cannot widen it): **an existing file or a symlink, even a dangling one, is refused with a message naming the path and the target is never touched; `--force` unlinks the path first (a symlink itself, not what it points to) and creates it again** (tested, mode checked with `stat`). `seal --password-*` now needs `--accept-password-only`, and `publish` refuses password-only records (`--accept-password-only` overrides, for a test chain only).

## 11. Migration

- Nothing old breaks: `tgs1.` records, `tgx1.` keys, `tg1.`/`tg2.` book keys and all conformance vectors open as before (the existing 237 tests pass unchanged except one CLI test line that now gives the explicit password-only flag). `src/crypt*.js` were not changed.
- `tgx1.` bound keys can be replaced by `tgx2.` for the **same record** without re-sealing: read the secret and the work, call `formatKey2`. (The `tgx1.` key's fingerprint is not needed.) New records can be sealed with `sealBound2`.
- Records meant to be public: seal with a random key or a derived `K_i`; add a half key if a memorable factor is wanted; never a password alone.
- **Built 2026-10-18:** `tgx2.` in the generator panel (`sealData2`), both key versions on the work page and in the CLI (`openAny`); the default vault `tgv2.` beside the strict `tgv1.`. **Designed only:** the key-committing record version; `tgr2.` post-quantum hybrid (cipher review 1.6).

## 12. What a host must merge (the files that were not touched)

**NOTICE.md** (add to the table "Software and fonts shipped with the site"):

```
| BIP-39 English word list | 2048 words (bitcoin/bips, bip-0039/english.txt) | MIT (BIP-0039) | `src/keys-wordlist-en.js` (derivation of recovery words) |
| @noble/hashes (Argon2id subset: argon2.js, blake2.js, _blake.js, _u64.js, _md.js, utils.js) | 2.4.0 | MIT, Copyright (c) 2022 Paul Miller | `assets/vendor/noble-hashes/` (memory-hard password stretching, `src/keys-kdf.js`) |
```

**package.json:** the `files` list has `src`, `cli`, `assets/vendor/pdfjs` but not `assets/vendor/noble-hashes`; add it, or the published package breaks `src/keys-kdf.js`. Suggested bin line stays `"tg-crypt": "cli/tg-crypt.mjs"`.

**CSP:** `src/keys-kdf.js` imports `../assets/vendor/noble-hashes/argon2.js` from the same origin; no new origin is needed.

## 13. Decisions (2026-10-18)

1. **A separate seed (or BIP-39 passphrase) for data**, never the seed of a wallet that holds money.
2. **The seed alone recovers everything.** The vault's secret is the master itself (`V = master`); passkey and passphrase are convenience wrappers that open it without the seed, and the passphrase alone still never opens anything. The stricter variant (the seed alone does not open the vault) stays available as an option for people whose main risk is theft of the written seed. (Built: `tgv2.` is the default of `createVault` and of `tg-crypt vault create`; the strict variant is `mode: 'strict'` / `--mode strict` and stays `tgv1.`; section 7.)
3. Argon2id stays at 64 MiB × 3 passes until a phone has been measured.
4. **The generator writes `tgx2.` keys** from now on; `tgx1.` stays readable. (Built: `sealData2` in the panel; the work page and the CLI open both through `openAny`.)
5. A vault command line (`vault create`, `vault open`, `vault inspect`) is built (section 10); the post-quantum hybrid and the key-committing record version wait until after the public launch.
6. Real devices: owners test their passkeys with `/passkey-check` and report; the page is live, the documents say the factor is unverified on real devices until then.
7. Done: `assets/vendor/noble-hashes` is in the package `files` list, both NOTICE rows exist.
