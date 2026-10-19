# Verifying a Typogram

A Typogram carries three views of one text — the picture (image layer), the exact source (data layer), and an identity hash
that binds them — and, optionally, a **signature** from an issuer. Verification answers two questions:

1. **Integrity** — do the picture, the embedded source and the stored hash all carry the same text? (Always checkable, by anyone,
   with no keys. See [canonical-text.md](canonical-text.md).)
2. **Authenticity** — was this text published by a specific issuer (a domain), and has it not changed since? (Checkable when the
   Typogram is signed and you have the issuer's public key. See [issuers.md](issuers.md).)

`tg verify <file>` reports one of three results and exits accordingly:

| Result | Exit | Meaning |
|---|---|---|
| `VERIFIED` | 0 | Integrity holds **and** a valid signature from the named issuer covers the text. |
| `UNSIGNED` | 2 | Integrity holds, but there is no signature. The text is consistent; its origin is unproven. |
| `TAMPERED` | 1 | Integrity fails, or a signature is present but does not verify, or the signing key is revoked/expired. |

This is an integrity-and-authenticity check, not a guarantee of honesty: a signature proves *who* signed and that the text is
*unchanged*, not that the signer is truthful — and only if a reader actually runs the check. See the limits at the end.

## 1. The identity hash

The hash is `SHA-256` of the **canonical form** of the text, lower-case hex. The canonical form (remove default-ignorable code
points → NFC → collapse whitespace → trim) and reference implementations are in [canonical-text.md](canonical-text.md). The hash
is stored in the data-layer record as `tgart.hash` and recomputed from the image layer on verify; the two must be equal, and
both must equal the hash of the embedded source.

## 2. The signature

A signature is **Ed25519** over a fixed message — the *signature string* — not over the file bytes, so it is independent of
fonts, rendering and file format (SVG, HTML or PDF):

```
signature string = "tgart-sig-v1" LF <hash> LF <issuer> LF <kid> LF <created>
```

- `LF` is a single newline (`U+000A`); the four fields never contain one (`<hash>` is 64 lower-case hex, `<issuer>` a hostname,
  `<kid>` matches `[A-Za-z0-9._-]{1,64}`, `<created>` is an ISO date `YYYY-MM-DD`).
- The message is UTF-8; the signature is the raw 64 bytes, **base64url** (no padding).

It is written into the data-layer JSON-LD record under `tgart`:

```json
"tgart": {
  "version": 1, "hash": "<hash>",
  "spec": "tgart-sig-v1", "issuer": "example.org", "kid": "2026-01", "created": "2026-01-01",
  "signature": "<base64url>",
  "keys": "https://example.org/.well-known/tgart-keys.json",
  "verify": "https://example.org/v"
}
```

Signing adds only these fields; the picture and the exact source are untouched, so the identity hash does not change.

## 3. Verifying a signature

1. Recompute the identity hash from the image layer and confirm integrity (section 1). If it fails → `TAMPERED`.
2. If there is no `tgart.signature` → `UNSIGNED`.
3. Validate the record's shape: `issuer` is a hostname, `kid` is `[A-Za-z0-9._-]{1,64}`, `created` is `YYYY-MM-DD`. These values
   feed key lookup and output, so a malformed one is rejected as `TAMPERED` (never used to build a path or printed raw).
4. Fetch the issuer's public key for `kid` from its key file (`https://<issuer>/.well-known/tgart-keys.json`, mirrored as
   `keys/<issuer>.json`). The key file entry is itself a signed statement — verify it first (see [issuers.md](issuers.md)); reject
   a key that is revoked, or expired for `created`.
5. Verify the Ed25519 signature over the signature string with that key. Valid → `VERIFIED`; otherwise → `TAMPERED`.

**Where to fetch the key, and checking revocation.** The canonical source is the issuer's domain
(`https://<issuer>/.well-known/tgart-keys.json`). If it is unreachable — some networks sit behind an edge that
challenges non-browser clients — fetch the verified-issuer **registry from GitHub raw**
(`https://raw.githubusercontent.com/typographics-art/typogram/main/keys/registry.json`): it is not behind that edge, is
always reachable, and tracks `main`, so it reflects a revocation as soon as it is published. The npm
(`@typographics-art/keys`) and PyPI (`tgart-keys`) packages are immutable snapshots — ideal for getting a key offline or
in a sandbox, but a revocation published after a package version will not appear until a new version, so prefer the
domain or the GitHub-raw registry for a current revocation check. All four carry the same self-signed key statements, so
the key's authenticity does not depend on which one you reach.

## 4. Anchors

`tgart.anchors` is a list of `{ type, reference }`. Each anchor is a proof that the signed key (or the work) existed in a public,
append-only log at a point in time — so a silent key swap is detectable and an old signature stays checkable even if the issuer's
site disappears. The format fixes only `type` and `reference`; each type is a small plugin and the verifier checks it against the
log *it* trusts. See [`anchors/README.md`](../anchors/README.md).

> **Status (2026-10):** the format and the plugin contract are defined, but anchoring is **not active yet** — no key or work
> carries an anchor today, and `tg verify` does not yet check `tgart.anchors`. It is a designed, pluggable extension.

## 5. Test vectors

Any implementation should reproduce these exactly. The key below is **for testing only — never a real issuer key.** Ed25519
signing is deterministic (RFC 8032), so the signatures are fixed. (Enforced by `test/vectors.test.js`.)

**Fixture key** (PKCS#8 PEM private, raw base64url public):

```
-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIHlvlGcnEOzBB57Kfl4qwWXDuqgUKZDHQRaw4pW4gAWX
-----END PRIVATE KEY-----
public: XRu2mLhQPwPKdsX9OIZPABnvmbs75lBMY5bZpxDaDc0
```

**Identity hash**

```
text (and canonical): "Hello, Typogram."
hash: ae0e6d06855b7d6ba1262802cfd647809b1610543f7639b8ea34fc7d271751b4
```

**Signature** over `{ hash, issuer: "example.org", kid: "2026-01", created: "2026-01-01" }`

```
signature string: "tgart-sig-v1\nae0e6d06855b7d6ba1262802cfd647809b1610543f7639b8ea34fc7d271751b4\nexample.org\n2026-01\n2026-01-01"
signature:        RK2rjedhhgh_JYPgCd3ZcZ3u74km4EPCbjwSRwn6JAe2jFGooWbGjI6x4sj5NKzxoZkYIMLzubArKFWrHvCUDQ
```

**Key statement** self-signature (the statement in [issuers.md](issuers.md), signed by the key itself)

```
sig.signature: CsESxGVwGYddLmBK9otg9XqrExe5PbirsVU2_qESx7-LEMJSBmnrNGoUlLUSao-78GyC_6m4F3oKPZZZ9y1TDg
```

## 6. What it does and does not promise

- It proves the **picture and the source carry one text**, and (when signed) **who published it and that it is unchanged** since
  the signed date. It does **not** prove the signer is honest, nor that any reader or agent actually runs the check.
- It is **whitespace- and invisibles-insensitive by design** (canonical-text.md): two Typograms that differ only in line wrapping
  share a hash and a signature.
- Authenticity depends on the **domain binding** — that key `K` is `example.org`'s — which comes from the key file at the issuer's
  domain (and, over time, from anchors and known-issuer lists), not from the chain alone.
