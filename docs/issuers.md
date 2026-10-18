# Issuers and keys

An **issuer** is a domain — `example.org` — that signs Typograms with an **Ed25519** key. Verification (see
[verification.md](verification.md)) needs the issuer's *public* key; this file defines how that key is stated, published,
rotated and revoked, so a reader or an agent can trust it without asking anyone.

## The key statement

An issuer's public key is not published bare — it is a small, **self-contained, signed statement**. That is the real point: the
proof travels *with* the key, so the statement stays checkable wherever it is found — on the domain, in a repo, in an archive, or
attached to a Typogram.

```json
{
  "spec": "tgart-key-v1",
  "issuer": "example.org",
  "kid": "2026-01",
  "alg": "Ed25519",
  "publicKey": "XRu2mLhQPwPKdsX9OIZPABnvmbs75lBMY5bZpxDaDc0",
  "created": "2026-01-01",
  "expires": null,
  "predecessor": null,
  "revokes": [],
  "sig": { "by": "self", "signature": "<base64url>" },
  "anchors": []
}
```

- The **signed core** is the fields `spec, issuer, kid, alg, publicKey, created, expires, predecessor, revokes`. The signature
  covers `"tgart-key-v1" LF <canonical-json-of-the-core>`, where the canonical JSON sorts object keys recursively (so two
  implementations sign the same bytes). `sig.by: "self"` means the key signs its own statement with its private key.
- `anchors`, `sig` and `prevSig` are **outside** the signed core, so adding an anchor later never invalidates the signature.
- `kid` is a short key id (`[A-Za-z0-9._-]{1,64}`), e.g. a month. `expires` is an ISO date or `null`.

## The key file

The statements for an issuer live together in a key file:

```json
{ "issuer": "example.org", "keys": [ <key statement>, <key statement>, … ] }
```

published at **`https://example.org/.well-known/tgart-keys.json`** and mirrored in a repository as **`keys/example.org.json`**.
`tg verify --keys` reads either; a verifier may also keep a curated `keys/known-issuers.json`. The file may also hold `X25519`
recipient keys (`alg: "X25519"`, `use: "seal"`) for encrypted sends — tools pick a key by `alg`, so signing and sealing keys
coexist.

## Rotation

To replace a key, publish a new statement whose `predecessor` names the old one and which is signed by **both** keys:

```json
{
  "spec": "tgart-key-v1", "issuer": "example.org", "kid": "2026-07", "alg": "Ed25519",
  "publicKey": "<new>", "created": "2026-07-01",
  "predecessor": { "kid": "2026-01", "publicKey": "<old>" },
  "sig":     { "by": "self",     "signature": "<new key signs>" },
  "prevSig": { "by": "2026-01",  "signature": "<old key signs the same message>" }
}
```

The old key's endorsement (`prevSig`) lets anyone who trusted `2026-01` extend that trust to `2026-07`, even for a statement found
far from the domain. Keep old statements in the key file so signatures made under them still verify.

## Revocation

A statement's `revokes` lists the `kid`s it cancels. A verifier collects the `revokes` of every valid statement in the key file
and **rejects** any signature whose `kid` appears there. Use it when a key is lost or compromised:

```json
{ "spec": "tgart-key-v1", "issuer": "example.org", "kid": "2026-07", "alg": "Ed25519",
  "publicKey": "<current>", "created": "2026-07-01", "revokes": ["2026-01"], "sig": { "by": "self", "signature": "…" } }
```

## Tools

```
tg keygen --issuer example.org [--kid 2026-01] [--out <dir>] [--private-out key.pem]
    # generate an Ed25519 key as a self-signed statement; writes keys/<issuer>.json and .well-known/tgart-keys.json,
    # and the PRIVATE key to key.pem (mode 600) or stdout. Keep the private key secret; it is never in the key file.

tg sign <file> --key key.pem --issuer example.org --kid 2026-01 [--out <file>]
    # sign a Typogram's identity hash and write the signature into its data layer (SVG/HTML).

tg verify <file> [--keys <dir|file>]
    # VERIFIED (0) / UNSIGNED (2) / TAMPERED (1); see verification.md.
```

The reproducible test vectors for a key statement are in [verification.md](verification.md) §5.
