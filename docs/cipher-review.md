# Cipher review: is there something better than AES-256-GCM?

Companion of [encrypted-data.md](encrypted-data.md) and [key-management.md](key-management.md). Everything marked **measured** was run on this machine (Node 26.11.1 with OpenSSL 3.6.5, 32 cores; Chromium 154 and Firefox 153 headless; `node scripts/cipher-probe.mjs` reproduces the tables, `node --test test/key-management*.test.js` the tests). Everything marked **cited** comes from a standard or from public documentation and was not run here. Everything marked **unverified** could not be tried here and says so.

## 0. The verdict, in one paragraph

**Keep AES-256-GCM. The cipher is not the weak point; the password is.** The answer to "choose an encryption in which the password is not the problem" is a rule, and the code now enforces it: **a human-chosen password is never the only secret protecting a record that is public or permanent.** The default protection is a random 256-bit secret (a random key, or a record key derived from a seed). A password or passphrase is only an additional factor: it is mixed with the random secret, or it wraps one share of a k-of-n vault, so that guessing it alone gets an attacker nowhere. Password-only sealing of a record that could be published is refused by the CLI (`--accept-password-only` for a local file only, and `publish` refuses such records regardless), and `assertPublishable()` is the library form of the same rule.

### 0.1 The password rule, with the numbers

A password-only record is attackable offline, for ever, by anyone who copies it, at a rate set by the attacker's hardware and nothing else. The **full space** of an `n`-bit secret, by guesses per second (measured single-core cost on this machine: PBKDF2-SHA256 with 600 000 iterations, the old `tgs1.` password mode, takes 94 ms = about 10.6 guesses/s per core):

| secret strength | 340 guesses/s (this machine, 32 cores, projected linearly) | 10^5/s (a GPU farm, **estimate**, unverified) | 10^7/s (a state-scale effort, **estimate**) |
|---|---|---|---|
| 28 bits (a typical human password) | 9 days | 45 minutes | 27 seconds |
| 40 bits (a good human password) | 102 years | 127 days | 1.3 days |
| 50 bits | 100 000 years | 357 years | 3.6 years |
| 66 bits (6 random words) | 7·10^9 years | 2.3·10^7 years | 2.3·10^5 years |
| 88 bits (8 random words) | 3·10^16 years | 10^14 years | 10^12 years |
| 128 bits (a random key, or 12 random words) | 3·10^28 years | 10^26 years | 10^24 years |
| 256 bits (our default secret) | 10^67 years | 10^65 years | 10^63 years |

Two facts decide the design. First, **humans do not choose random words**: what people call a strong password is 28 to 40 bits, and those rows fall in days to years. Second, even a password that is truly random and long is a secret that a person types into pages, keyloggers and phishing sites, writes on paper and says aloud; a 256-bit key is something nobody types. So a published record's safety must not depend on a human secret staying unguessed. The rule costs nothing: a key (or a seed) is needed anyway, and a password can still be added where memorable access matters ([key-management.md](key-management.md) section 7).

Honest side note on passphrases: **8 random words from the BIP-39 list are 88 bits**, which the table shows is out of reach for any attacker today even alone. The reasons not to rely on it alone for a permanent public record are not the arithmetic: (a) 88 bits is not 128; Grover-type quantum search is no practical threat to a serial memory-hard KDF today, but the margin of a permanent record is measured in decades, and 12 words (132 bits) would be needed to match a 128-bit key and 24 words a 256-bit one; (b) the words must be *generated*, not chosen (our `generatePassphrase` draws them uniformly: 11 bits each, chi-square tested); a person who "picks 8 random-looking words" is back in the 30 to 50 bit rows; (c) a passphrase is a single point of failure that can be observed, whereas a factor is not. So: passphrase generator yes, passphrase alone for public data no.

## 1. What "better than AES-256" can mean

There are six different things people mean. Each gets a measured or cited answer.

| Meaning of "better" | Answer | Verdict |
|---|---|---|
| Bigger key | AES-256 already has 256-bit keys; nothing larger is standardised for AES. Grover's algorithm reduces a brute-force search over `2^256` keys to about `2^128` quantum steps; NIST's post-quantum security categories rate AES-256 at category 5, the highest, and NIST's analysis counts the depth limits that make Grover far more expensive than `2^128` in practice (cited). | **keep** |
| Safer against nonce mistakes | See 1.1 and 1.2: with one key per record the 96-bit nonce limit never comes near. | **keep** (per-record keys) |
| Misuse-resistant mode (AES-GCM-SIV, XChaCha20-Poly1305) | Not in Web Crypto anywhere we could test. See 1.2. | **optional**, not needed |
| A different cipher family (ChaCha20-Poly1305) | Same security class; not in browsers' Web Crypto (measured: Chromium 154, Firefox 153: no). Equal speed here. See 1.3. | **keep** AES; ChaCha optional |
| Two ciphers in a row (cascade) | See 1.4: almost nothing gained, real cost. | **no** |
| Resistant to quantum computers | Symmetric AES-256 is fine. Only the asymmetric part (`tgr1.`, ECDH on X25519) has a quantum problem. See 1.6. | **keep** symmetric; hybrid **optional** later |
| A password that is hard to guess | The real weakness. See section 0 and 1.5. | **change** (rule + Argon2id for the extra factor) |

### 1.1 Random 96-bit nonces under one key

NIST SP 800-38D (cited) allows random 96-bit IVs only while one key encrypts at most `2^32` messages (collision probability then at most `2^-32`). In this project **every record has its own key**: a fresh random secret per `tgs1.` record, a fresh ephemeral key per `tgr1.` record, and a record key derived from the seed per record id. A key therefore encrypts exactly one message, or a handful when the same record id is sealed again under its derived key. Quantified: re-sealing the same id `2^32 = 4 294 967 296` times would be needed before the bound is reached; at one sealing per second that is 136 years. The limit is irrelevant. The other GCM limit, 64 GiB per message, is far above our 16 MiB cap.

### 1.2 Nonce-misuse resistance and the availability, tested

| Primitive | Node 26 `crypto.subtle` | Node `node:crypto` | Chromium 154 | Firefox 153 | Safari/WebKit |
|---|---|---|---|---|---|
| AES-256-GCM | yes | yes | yes | yes | yes (cited) |
| AES-GCM-SIV | **no** | yes (`aes-256-gcm-siv`, OpenSSL) | **no** | **no** | unverified (WebKit could not be driven headless here) |
| AES-OCB | yes (experimental warning) | yes | **no** | **no** | unverified |
| ChaCha20-Poly1305 | yes (experimental warning) | yes | **no** | **no** | unverified |
| XChaCha20-Poly1305 | no | no | no | no | no |
| X25519 | yes | yes | yes | yes | yes since Safari 17 (cited, unverified here) |
| Argon2id | yes (experimental) | yes (`argon2Sync`) | **no** | **no** | unverified |
| ML-KEM-768 | yes (experimental) | – | **no** | **no** | unverified |

(All **measured** except the Safari column and the citation marks. The Web Crypto "modern algorithms" proposal that would add ChaCha20-Poly1305, AES-OCB, Argon2 and ML-KEM is being implemented in Node first; browsers lag.) Consequence: AES-GCM-SIV and XChaCha20-Poly1305 are available to a browser only through a JavaScript library. Because our keys are single-use, the property they add (surviving an accidentally repeated nonce) protects against a mistake that cannot happen here. **Not worth a dependency.**

One real property that AES-GCM lacks: it is not *key-committing* (a ciphertext can be crafted that opens under two different keys). For this project an attacker would have to choose both keys, which contradicts a single owner's own key; a published SHA-256 of the record commits to the record bytes, not to a plaintext. It matters for designs where several parties hold keys to the same record (the hand-out of a record key, section 6 of [key-management.md](key-management.md)). Open question for the owner: add an explicit key-check output to a new record version (cheap: one more HKDF output compared in constant time). Not done, because it changes the record format.

### 1.3 ChaCha20-Poly1305

Strong, simple, fast in software without AES instructions. **Measured here** with AES instructions: AES-256-GCM 1143 MB/s, ChaCha20-Poly1305 1114 MB/s through Node's Web Crypto, a tie. It is not in browsers' Web Crypto, so using it in a page needs a JavaScript implementation. `@noble/ciphers` 2.4.0 (MIT, 548 kB unpacked with type files, from the same author as the Argon2 code we vendor) is the obvious audited candidate, and the npm registry integrity of any file you vendor can be checked as was done for `@noble/hashes` ([assets/vendor/noble-hashes/README.md](../assets/vendor/noble-hashes/README.md)). **Recommendation: no.** There is no security gain over AES-256-GCM for this use, a new dependency adds supply-chain risk, and the project's strength is that the cipher is the browser's own. Should the owner want it later for devices without AES hardware, it fits as a new record version beside the old one.

### 1.4 Cascade encryption (AES, then ChaCha)

What it buys: if one primitive were broken, the other still protects. What it costs: a dependency (above), two keys and nonces, a larger and more complex format, more code that is not independently audited, and a longer attack surface for implementation bugs. Public cryptanalysis of AES in 25 years has found nothing that approaches a practical attack on the full cipher (best known: key recovery with about `2^254.4` operations for AES-256, a factor of 3 better than brute force, cited). The realistic risks sit elsewhere (the key, the password, the code around the cipher, metadata). **No.**

### 1.5 Password stretching: PBKDF2 against Argon2id

The password only ever enters through a KDF that makes each guess expensive. Measured on this machine, one core, one guess:

| KDF and parameters | ms per guess | memory per guess | where it runs |
|---|---|---|---|
| PBKDF2-HMAC-SHA256, 600 000 iterations (the old `tgs1.` password mode) | 94 | a few kB | everywhere (Web Crypto) |
| PBKDF2-HMAC-SHA512, 600 000 iterations | 308 | a few kB | everywhere (Web Crypto) |
| scrypt N=2^17, r=8, p=1 | 334 | 128 MiB | Node only (`node:crypto`); not in browsers |
| **Argon2id, 64 MiB, 3 passes, 1 lane (our default)** | **134** native | **64 MiB** | Node native; **JavaScript everywhere else** |
| Argon2id 19 MiB, 2 passes (the OWASP minimum) | 22 | 19 MiB | as above |

The JavaScript Argon2id is `@noble/hashes` 2.4.0 vendored at [assets/vendor/noble-hashes](../assets/vendor/noble-hashes/) (MIT, byte-for-byte from the npm tarball whose integrity `sha512-X5XaVWZ…` was recomputed and matches the registry's; the six files and the licence are pinned in `SHA256SUMS`, checked by a test). It is the same algorithm as the native one: **its output equals Node's native Argon2id for three parameter sets (test), and Chromium and Firefox reproduce the Node result for the default parameters (browser tests)**. Cost in a page at the default parameters: **Chromium 154 about 0.9 s, Firefox 153 about 1.8 s** (measured), against PBKDF2-SHA512/600 000 at 0.28 s and 0.7 s. That is a fair price for a step done once per unlock.

Why Argon2id and not just more PBKDF2 iterations: PBKDF2 uses almost no memory, so a GPU or an ASIC runs thousands of guesses in parallel on a small chip. Argon2id needs 64 MiB for every guess in flight; a card with 24 GiB holds a few hundred at once and is bandwidth-bound, which narrows the advantage of specialised hardware from several orders of magnitude to one or two. The attacker model stays: dictionaries first, GPUs for the rest, a public record copied once and attacked offline for ever; a KDF only changes the price per guess, never the need for entropy. **Verdict: adopt Argon2id (vendored, default) for the passphrase factor; keep PBKDF2-SHA512 as the fallback parameter set; keep the old PBKDF2-SHA256 password mode only behind `--accept-password-only`.** The vendored code is a dependency, justified by being the only way to a memory-hard KDF in a browser without WebAssembly of our own; the alternative `hash-wasm` 4.12.0 (MIT, WebAssembly, faster, 1.8 MB unpacked) was not chosen because a pure-JavaScript module is easier to audit and self-host and the speed is enough.

GPU and farm rates in section 0.1 are estimates: not measured, because no GPU benchmark was run for this review.

### 1.6 Post-quantum, for the asymmetric part only

Symmetric keys of 256 bits (`tgx1.`, `tgx2.`, per-record keys, the vault secret) are not threatened by a quantum computer beyond the Grover halving. **What is exposed is `tgr1.`**, a record sealed to a recipient's X25519 public key: if it is published, an attacker can store it today and break the elliptic-curve exchange when a large quantum computer exists ("harvest now, decrypt later"). The standard remedy is a **hybrid**: the shared secret is `HKDF(X25519 secret ‖ ML-KEM-768 secret, …)`, so the record is safe if either holds.

What exists here (measured): Node 26 has ML-KEM-768 in Web Crypto (experimental); Chromium 154 and Firefox 153 do **not** have it in Web Crypto (they use ML-KEM in TLS only, cited). So a hybrid in a browser needs a JavaScript library: `@noble/post-quantum` 0.7.1 (MIT; its version is below 1.0 and it is young: **unverified** whether and by whom it was audited; check the package's own statement before vendoring). **Verdict: optional, designed only.** Design: a new record `tgr2.` beside `tgr1.` with the recipient key `tgp2.` = X25519 public ‖ ML-KEM-768 public (1184 bytes: a long public key, about 1620 characters in base58), the ML-KEM key pair derived deterministically from the master (`ML-KEM.KeyGen` takes a 64-byte seed), the shared secret as above with both ciphertexts and both public keys in the HKDF salt. It would be built when the owner decides that published `tgr1.` records need a margin beyond the next 10 to 15 years. For data sealed with record keys, nothing needs to change.

## 2. Passkeys (WebAuthn PRF) as a factor

A passkey or security key can return a **32-byte secret that never leaves the authenticator**, bound to the credential and to the site's origin (the *relying party ID*): there is no password to guess and the secret cannot be phished onto another site. The extension is called `prf`. The page asks with an input (`eval.first`, our `prfInput(label)`: 32 bytes bound to this application and a label) and receives a pseudo-random 32-byte output that is the same every time for that credential, that input and that relying party. We never use the output directly: `factorFromPrf` runs it through HKDF to a factor key.

What was **measured here**: Chromium 154 and Firefox 153 both report `extension:prf: true` in `PublicKeyCredential.getClientCapabilities()`; Chromium's virtual authenticator (DevTools `WebAuthn.addVirtualAuthenticator`, `hasPrf: true`) returned a 32-byte output; the same input gave the same secret twice and a different input gave a different one; the passkey factor opened a vault together with a seed factor (`test/key-management-browser.test.js`). What is **unverified**, because it needs real hardware or other browsers: Safari/WebKit (cited: supported from Safari 18 with iCloud Keychain passkeys), Windows Hello (cited: depends on the Windows version), Android's credential manager, and security keys (cited: a key needs the CTAP2 `hmac-secret` extension; YubiKey 5 series firmware 5.2 and later has it). Nothing here claims to have run against a physical authenticator.

Honest limits:

- **Synced passkeys** (iCloud Keychain, Google Password Manager) are protected by the cloud account, not by a hardware element; only a hardware security key is "hardware-bound". The factor is as strong as its container.
- The PRF secret is tied to the **origin**. A change of domain, or a different authenticator, gives a different secret. A lost authenticator, a reset phone or a new domain loses the factor.
- Therefore a passkey must never be the only way in: it is one factor among several and **the seed backup stays the recovery path** (section 7 of [key-management.md](key-management.md): the vault rule "any 2 of 3").
- Pattern that works across the browsers tested: `create` with `extensions: { prf: {} }` to learn whether the authenticator supports it, then `get` with `prf.eval.first` to obtain the secret (some authenticators do not return the secret at creation).

## 3. Verdict table

| Item | Verdict | Reason |
|---|---|---|
| AES-256-GCM through Web Crypto for records | **keep** | Strong, standard, in every browser, equal speed to the alternatives (measured). Single-use keys remove the nonce limit. |
| Key size 256 bit | **keep** | Quantum margin 128 bits (category 5, cited). |
| Random per-record keys / seed-derived record keys | **keep, make the default** | One key per message. |
| A password as the only secret of a public record | **change: removed** | Sections 0.1 and 1.5. Refused by the CLI and `assertPublishable`. |
| Password or passphrase as an additional factor | **keep, new** | `tgxm1.` half keys and the `tgv1.` vault. Guessing it alone gets nowhere. |
| Argon2id (vendored `@noble/hashes`) | **adopt** for the additional factor | Memory-hard, equal to native (test), 0.9 s in Chromium, 1.8 s in Firefox. |
| PBKDF2-SHA512, 600 000 | **keep as fallback** | Web Crypto, works everywhere. |
| scrypt | **no** | Node only. |
| WebAuthn PRF passkey as a factor | **adopt as a factor, designed + tested with a virtual authenticator** | Real-hardware behaviour unverified. |
| AES-GCM-SIV, XChaCha20-Poly1305 | **optional, not needed** | Not in browsers' Web Crypto; the failure they cure cannot happen with single-use keys. |
| ChaCha20-Poly1305 | **optional** | No security gain; adds a dependency. |
| Cascade AES + ChaCha | **no** | Almost nothing gained, complexity and dependency cost. |
| Key-committing record (key-check output) | **open question** | Matters only when several parties hold keys to one record. |
| Post-quantum hybrid (X25519 + ML-KEM-768) for `tgr1.` | **optional, designed only** | Only the asymmetric part is exposed; browsers lack ML-KEM in Web Crypto; library audit status unverified. |
| Symmetric part post-quantum | **keep** | AES-256 needs no replacement. |

## 4. Where the realistic weaknesses are

AES-256-GCM through Web Crypto is a conservative, strong choice. The realistic ways to lose data are, in order: **the key or seed being lost or copied** (no recovery by design; the vault gives a recovery path that does not weaken anything); **the password** (section 0); **the code around the cipher** (formats, binding, bounds, compression: written for this project, covered by tests and conformance vectors but **not independently audited**; an outside review is worth more than any change of cipher); **metadata** (record size unless padded, and whatever the place it is shared at records about it); and **the device** (a malicious extension or a compromised computer reads a seed typed into a page: no cipher helps).

## 5. How to reproduce

```bash
node scripts/cipher-probe.mjs                 # algorithm availability in Node, Chromium, Firefox; KDF costs; AES vs ChaCha speed
node --test test/key-management.test.js       # every function with vectors, properties, fuzz, the CLI
node --test test/key-management-browser.test.js   # Chromium and Firefox equal Node; the WebAuthn PRF virtual passkey
node scripts/build-key-vectors.mjs            # prints the vectors that test/fixtures/key-management-vectors.json freezes
```

## 6. Open questions for the owner

1. Accept the rule "a password is never the sole secret of a public record" as written (CLI refusal, `assertPublishable`, no password-only mode for publishing)? It removes a feature that existed in 0.1; local files keep it behind `--accept-password-only`.
2. Argon2id default of 64 MiB, 3 passes (about 1 s in Chromium, 2 s in Firefox): acceptable for unlock, or lower for slow phones (19 MiB, 2 passes is the OWASP minimum)?
3. Key-committing record version: wanted now (breaks nothing old, adds a version) or only when records are shared between several key holders?
4. Post-quantum hybrid `tgr2.`: build it now with a vendored `@noble/post-quantum`, or wait for browsers to ship ML-KEM in Web Crypto?
5. Independent review: commission an outside review of `src/crypt*.js` and `src/keys*.js` before any real value is sealed and made public.
6. Test on real authenticators (a security key, Safari, Windows Hello, Android) before the passkey factor is offered in the page.
