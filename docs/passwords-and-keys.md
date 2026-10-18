# Passwords, keys and seeds: how it works here, and what we do not promise

This page is for people who want to know whether they can trust the way Typographics Art protects data, without reading the cryptography papers. It explains the design in plain words, gives the reasons, and says plainly what is **not** covered. Everything is open source; every number below was measured or is marked as an estimate or a citation, and the last section shows how to check it yourself. The technical documents behind it are [encrypted-data.md](encrypted-data.md), [key-management.md](key-management.md) and [cipher-review.md](cipher-review.md). A German version of this page: [passwords-and-keys.de.md](passwords-and-keys.de.md).

## 1. In one minute

- **The lock is strong.** Sealed data uses AES-256-GCM, a standard cipher that your browser or Node provides. We did not invent a cipher, and we looked at the alternatives (section 7): none is worth the risk of adding code.
- **A password is the weak point of every lock like this, so a password never stands alone.** For anything public or permanent, the real protection is a long random secret that nobody types. A password can only be an *additional* factor mixed with it. The tools refuse to publish a record that is protected by a password only.
- **You hold the key; we cannot recover it.** The page does its work in your browser and does not send your data, key, seed or password anywhere (the site loads nothing from third parties, and the browser enforces that with a content security policy). That also means: if you lose the key, the data is gone, and nobody can help you.
- **It is not independently audited.** The cipher is standard; the code around it (formats, binding, key handling) was written for this project, tested, and reviewed by automated tools, but no outside cryptographer has reviewed it. If losing or leaking the data would really hurt, get a review first.
- **A blockchain does not make data unreadable for ever.** See [encrypted-data.md](encrypted-data.md), "Plain answers": a chain would hold a hash, and a record that is public for ever can be attacked for ever.

## 2. The secrets, and what each one is for

| Secret | What it is | Typed by a person? | Used for |
|---|---|---|---|
| **Random key** (`tgx1.…`, `tgx2.…`) | 256 random bits, shown as about 60 characters | No: copy and paste, or a file | Opens one sealed record. This is the default protection. |
| **Seed** (12, 18 or 24 recovery words, or hex) | The one backup from which a **master key** and one **key per record** are derived | Words are written down and typed rarely | Opens everything that was sealed from it; a single record key can be given away without exposing the rest. |
| **Password / passphrase** | Something a person remembers | Yes | Only as an *extra* factor (never alone for public data). |
| **Share** (`tgsh1.…`) | One piece of a key split in several pieces | No | A key that needs several pieces from different hands (any k of n). |
| **Passkey** (WebAuthn, the phone or a security key) | A hardware-bound secret that cannot be guessed | No: the device does it | One factor of a 2-of-3 vault; works in a test browser with a virtual passkey, **not yet checked on real devices** (you can check yours: `/passkey-check`). |

## 3. Why a password is the weak point

A cipher with a 256-bit key is, for all practical purposes, impossible to break by guessing. A password is not a 256-bit key; it is something a human invented. What matters is how many guesses an attacker needs, and how fast they can guess.

If your sealed record is **public**, anyone can copy it and try guesses **offline, for ever**, at whatever speed their hardware allows; nobody can slow them down or notice. The table shows how long it takes to try *every* secret of a given strength. Speeds: the first column is measured on the development machine (a slow, deliberately expensive key derivation, about 10 guesses per second per core, 32 cores, projected linearly); the other two are **estimates**, not measurements.

| Strength of the secret | This machine | A GPU farm (estimate) | A state-scale effort (estimate) |
|---|---|---|---|
| 28 bits (a typical human password) | 9 days | 45 minutes | 27 seconds |
| 40 bits (a *good* human password) | 102 years | 127 days | 1.3 days |
| 50 bits | 100 000 years | 357 years | 3.6 years |
| 66 bits (6 random words) | 7·10^9 years | 2.3·10^7 years | 2.3·10^5 years |
| 88 bits (8 random words) | 3·10^16 years | 10^14 years | 10^12 years |
| 128 bits (a random key) | 3·10^28 years | 10^26 years | 10^24 years |
| 256 bits (our default) | 10^67 years | 10^65 years | 10^63 years |

Two things decide the design:

1. **People do not pick random passwords.** What people call a strong password is around 28 to 40 bits, and those rows fall within days to years.
2. **A human secret leaks in human ways**: typed into a page that is not ours, caught by a keylogger, written on paper, said aloud. A 256-bit key is something nobody types.

(Full derivation and the exact figures: [cipher-review.md](cipher-review.md), section 0.1.)

## 4. The rule, and what enforces it

> **A human-chosen password is never the only secret protecting a record that is public, permanent or anchored.**

What the code does about it (all tested, see section 9):

- The default protection of a sealed record is a random 256-bit secret, or a record key derived from your seed.
- A password can be mixed in as an additional factor: the secret is then the random part and the stretched password together, so guessing the password alone gets an attacker nowhere.
- `seal` with a password and no random secret is refused unless you add `--accept-password-only`, which is meant for local files you keep to yourself.
- `publish` (and the library check `assertPublishable()`) refuse a record protected by a password only.
- The password factor is stretched with **Argon2id**, a memory-hard function (64 MiB and 3 passes by default, about 1 second in Chromium and 2 in Firefox): every guess costs the attacker memory and time, which blunts GPUs. It makes guessing slower; it does not make a weak password strong.
- In a **vault** (a key kept by several factors, section 5) the passphrase can never open anything alone: the code refuses to build a vault in which a set of factors that opens it contains only passphrases.

## 5. What we recommend instead (three setups)

| Setup | Who it is for | What you keep | If you lose... |
|---|---|---|---|
| **A. A random key, in a password manager or a file** | Most people, most data | One key per record (about 60 characters) | the key: the record is lost |
| **B. One seed, many records** | Someone who seals a lot | The seed (12 to 24 words, written on paper, stored safely). Each record gets its own key derived from it | the seed: everything sealed from it is lost; a thief with the seed opens everything |
| **C. A vault with 2 of 3 factors** | Someone who wants easy access *and* a safety net | Any two of: the seed backup, a passkey, a passphrase | one factor: nothing, the other two still open it; a passphrase alone opens nothing |

**Before you rely on a passkey, check your device** with the device check at [typographics-art.org/passkey-check](https://typographics-art.org/passkey-check): it tests, in your browser and without sending anything, whether your passkey or security key returns the same secret every time. Not every browser and device supports it, and a synced passkey may behave differently from a hardware key. Keep the seed backup as the way back in either way.

**Use a separate seed for data.** Do not use the seed of a wallet that holds money: whoever steals it would get your data as well, and a lost wallet seed would lose your data. (The platform's own wallet is watch-only and its seed is held by the operator, so it is never a place for private user data.)

**A good passphrase is generated, not invented.** The tools can draw words uniformly from the BIP-39 list (2048 words, 11 bits per word, exactly uniform): 6 words are 66 bits, 8 words 88 bits. Eight generated words are a strong *extra* factor; we still do not advise them as the *only* protection of a permanent public record (88 bits is not 128, and people handle words, not random bytes, with all the leaks of section 3).

## 6. What we do not promise

- **No outside audit.** The cipher is standard, the code around it is ours. Section 9 says what was done; none of it replaces an expert review. We recommend one before anything valuable is sealed on a public chain.
- **A lost key is lost data.** There is no recovery, no reset, no support desk that can open it.
- **A compromised device defeats everything.** A malicious browser extension, malware or a stolen unlocked phone can read what you type and see what the page decrypts. Encryption protects data at rest and in transit, not a machine that is already hostile.
- **Metadata is not hidden.** A sealed record shows its size (unless padded) and, if anchored on a chain, the time and the paying address.
- **The book-cipher hidden messages are not encryption.** They hide a message in a work's public text from someone who does not know the scheme; use sealed data for anything that must stay secret ([hidden-messages.md](hidden-messages.md)).
- **Quantum computers:** AES-256 keeps 128 bits against the best known quantum search, which is still out of reach. The *asymmetric* part (sealing to a public key, `tgr1.`) uses X25519, which a large quantum computer would break; a hybrid with a post-quantum scheme is designed, not built, because browsers do not offer one yet.
- **Not a legal opinion.** Putting even an encrypted commitment to personal data on a public chain may conflict with erasure rights; get advice.

## 7. Why we did not choose something else

| Alternative | What we found | Decision |
|---|---|---|
| A different cipher (ChaCha20-Poly1305, XChaCha20, AES-GCM-SIV) | Not available in the browsers' built-in crypto (measured in Chromium 154 and Firefox 153); the security class is the same; it would mean adding a code library | Keep AES-256-GCM |
| Two ciphers in a row | Almost nothing gained, real cost and more code | No |
| A bigger key | AES-256 is already the largest standard key | Nothing to do |
| Password-only, with a very slow derivation | Slow only multiplies the cost for the attacker by a constant; the password's few bits remain the limit, and the record can be attacked for ever | Refused for public data |
| Keeping your keys on a server "for recovery" | Then the operator can read your data, and so can anyone who breaks in | Not offered: keys stay with you |
| Hiding which "book" a key belongs to as the protection | That is obscurity worth about 17 to 20 bits (a few hundred thousand to a million candidate texts), and an attacker can check each candidate automatically | Used only to avoid *naming* the work in a key (`tgx2.`), never as the protection |

## 8. The practical short list

**Do**
- Let the tool generate the key; store it in a password manager or an offline note.
- Keep a second copy of the key or the seed somewhere separate (a safe, a sealed envelope).
- Use a separate seed for data, not your wallet's.
- Test opening a record before you delete anything else.
- Prefer the file, standard-input or environment ways to give a key to the command line.

**Do not**
- Do not rely on a password alone for anything that is public.
- Do not put a key or seed into a chat, an e-mail, a screenshot or a URL.
- Do not type your seed into a page that is not the one you opened from typographics-art.org, and not on a device you do not trust.
- Do not assume a blockchain makes data private or keeps it alive.

## 9. Check it yourself

Everything here is reproducible from the repository (Node 22 or newer):

```sh
node --test test/                       # the whole suite, including the key and cipher tests
node scripts/cipher-probe.mjs           # which primitives exist in this Node (and, with a browser, there)
node scripts/crypt-measure.mjs          # the key-length and size tables of encrypted-data.md
node cli/tg-crypt.mjs --help            # the commands; secrets only by file, standard input or environment
```

- The conformance vectors (frozen inputs and outputs) are in `test/fixtures/`; the Trezor BIP-39 vector and the published SLIP-21 test keys are among them, so the seed derivation can be compared with other tools.
- The browser and Node produce byte-identical results for the key derivation (checked in headless Chromium and Firefox).
- The vendored Argon2id code (`assets/vendor/noble-hashes/`, MIT) has its integrity checked against the published package; its output equals Node's own Argon2id.
- Every limit is enforced before work is done (a 5 MB "key", a 200 MB record or a compression bomb is refused in well under a second; tested).
- Error messages never contain a key, password or message (tested), and secrets are never accepted as command-line arguments.

If you find a mistake in the design, the code or this page, please say so: see [SECURITY.md](../SECURITY.md) for private reports and [CONTRIBUTING.md](../CONTRIBUTING.md) for the rest. A mistake found and fixed in the open is how this kind of project earns trust.

## 10. Glossary

- **Cipher**: the procedure that scrambles data with a key (here AES-256-GCM).
- **Key**: the secret that opens a sealed record. **Seed**: the backup from which keys are derived. **Share**: one piece of a split key.
- **Record**: the sealed (encrypted) data.
- **KDF** (key derivation function): turns a password into a key; a **memory-hard** KDF such as Argon2id makes every guess expensive.
- **Offline attack**: guessing against a copy of the record, with no server that could slow or stop the attacker.
- **Bits of strength**: a secret of n bits needs about 2^n guesses to find by trial.
- **Audit**: a review of the code by independent experts.
