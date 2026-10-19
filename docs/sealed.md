# Sealed Typograms — a work that is encrypted to named recipients

A normal Typogram is public: anyone who has the file reads the whole text from the picture. A **sealed** Typogram is the
opposite — the document is encrypted, and only a holder of the right private key can read it. What everyone sees is a
short **envelope** (who it is from, who it is for, the date, the seal); the document itself is the **payload**, carried as
ciphertext. The signature covers the envelope *and* the ciphertext, and `tg verify` checks it **before anything is
decrypted**, so a tampered sealed work is caught without ever touching the cipher.

This is a different thing from [sealed structured **data**](encrypted-data.md): that keeps a work's text public and hides
an attached data block (a spreadsheet) behind a key. A **sealed Typogram** hides the whole document. They can be combined
but are separate features (and separate code: sealed data is `src/crypt*.js`, a sealed Typogram is `cli/seal.mjs`).

## The format

A sealed Typogram is one text in two parts, in this order:

1. **Envelope (cleartext).** A title, `From:` (the sender's issuer), `To:` (each recipient as `issuer:kid`), `Date:`,
   the note `Sealed · age v1`, and the seal line. This is set as the picture and is readable by anyone.
2. **Payload (ciphertext).** The document encrypted with [age](https://age-encryption.org) (X25519), as age ASCII armor
   (`-----BEGIN AGE ENCRYPTED FILE-----` … `-----END AGE ENCRYPTED FILE-----`). The armor is Base64, so it sets as
   ordinary glyphs like any other text.

The data-layer record marks it: `tgart.mode = "sealed"`, `tgart.cipher = "age-v1"`, `tgart.recipients = [{issuer, kid}]`
(public key **not** stored). The identity hash and the Phase-H signature cover the whole text — envelope and ciphertext.

> **The envelope is in the open.** The title, sender, recipients and date are cleartext by design (so a person knows
> what they are holding and whom to ask for a key); only the document **body** is encrypted. `tg seal` never takes the
> title from the document body — it uses `--title` if given (and prints a warning that the title is public) or a neutral
> default (`Sealed note`). Do not put a secret in `--title`.

## Keys: an issuer has two

The issuer key file (`keys/<domain>.json` and the served `.well-known/tgart-keys.json`) holds both kinds, told apart by
`alg`:

- `alg: "Ed25519"` — the **signing** key (Phase H). Signs works; `tg verify` checks signatures against it.
- `alg: "X25519"` — the **sealing** key. Its `publicKey` is an age recipient (`age1…`); senders seal *to* it. The
  matching private **identity** (`AGE-SECRET-KEY-1…`) is the secret that opens sealed works — it is never in the key file.

```json
{
  "issuer": "example.org",
  "keys": [
    { "spec": "tgart-key-v1", "alg": "Ed25519", "kid": "2026-10", "publicKey": "…", "sig": { "by": "self", "signature": "…" } },
    { "alg": "X25519", "kid": "seal-2026-10", "publicKey": "age1…", "created": "2026-10-19" }
  ]
}
```

## Commands

```bash
# A recipient makes a sealing key. The public recipient goes into their key file; the private identity opens sealed works.
tg seal-keygen --issuer example.org --kid seal-2026-10 --out . --private-out ~/.config/tgart/example.org.age

# A sender encrypts a document to that recipient and signs it with their own Ed25519 key.
tg seal letter.md \
  --to example.org:seal-2026-10=age1… \
  --key sender-signing-key.pem --issuer sender.org --kid 2026-10 \
  --out letter.sealed.tg.svg

# Anyone checks it. A sealed work reports SEALED VERIFIED / SEALED UNSIGNED / SEALED TAMPERED.
tg verify letter.sealed.tg.svg --keys ./keys           # exit 0 / 2 / 1

# The recipient opens it: the signature is checked first, then the payload is decrypted with their identity.
tg open letter.sealed.tg.svg --identity ~/.config/tgart/example.org.age --keys ./keys   # plaintext to stdout (or --out)
```

`--to` may be repeated for several recipients (any one of their identities opens the work). A recipient is
`[<issuer:kid>=]age1…`; the `issuer:kid` label is only for the envelope — the age public key after `=` is what encrypts.

## What the signature proves (and what it does not)

The signature authenticates **who sealed and sent** this work — the issuer who ran `tg seal` — over the whole text,
envelope and ciphertext. The sender (`From:`), the recipients (`To:`) and the cipher are part of the **signed envelope
text**, so they cannot be changed without breaking the signature, and re-forwarding to someone else requires re-sealing
under the forwarder's own key (their `From:` then shows). `tg verify` reads those fields from the signed envelope, **not**
from the `tgart` JSON record (which is not covered by the signature), and sanitises them before printing.

The signature does **not**, by itself, prove who **wrote the plaintext** inside — only who sealed it. For end-to-end
author provenance, seal a work that is **itself a signed Typogram**: after `tg open`, verify the decrypted content again
with `tg verify`, and you have both who sent the envelope and who signed its contents.

## Guarantees and limits

- **Sign-before-decrypt.** `tg open` refuses anything that is not `VERIFIED`; a tampered ciphertext changes the hash and
  fails the signature, so it is rejected before the cipher runs. (Tested: `test/seal-cli.test.js`.)
- **The SEALED label is signed.** Whether a work is shown as `SEALED` is decided by the age payload in the signed text,
  not by the unsigned `tgart.mode` — the label cannot be added to or stripped from a work without breaking its signature.
- **No own crypto.** Encryption is the vendored [`age-encryption`](../vendor/age-encryption.mjs) library (X25519 +
  ChaCha20-Poly1305); the armor is standard, so the `age` / `rage` CLI can also open the payload.
- **The payload is inline.** The whole ciphertext is set as glyphs. This is fine for letters and notes. A very large
  payload makes a large picture; a `--inline-limit` that moves the bulk of the ciphertext into a data-layer attachment is
  **planned, not yet built** (see the plan), as is the browser generator's seal flow and the `tg handoff` package (I3).

See also: [bundles](bundles.md) (sign a whole folder), [issuers and keys](issuers.md), [verification](verification.md),
and the Phase-I [plan](bundles-sealed-handoff-plan.md).
