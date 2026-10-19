# Anchors — make a key or a signature provable long after the domain is gone

A Typogram's authenticity rests on an **issuer key**: a small, self-contained, signed statement that says *"this public key
belongs to this domain, valid from this date, replacing this earlier key."* Because the statement is signed with the key
itself (and, on rotation, with the key it replaces), it stays provable wherever it travels — on the domain, in this repo, in
an archive, or attached to a Typogram. See [`docs/issuers.md`](../docs/issuers.md).

An **anchor** adds one more thing the statement cannot give itself: *independent proof that it existed at a point in time, in a
public, append-only place that the issuer does not control.* With an anchor, a silent key swap is detectable and an old
signature stays checkable even if the issuer's site disappears.

The file format keeps this deliberately open. A Typogram or a key statement carries:

```json
"tgart": { "anchors": [ { "type": "opentimestamps", "reference": "…" }, { "type": "rekor", "reference": "…" } ] }
```

The format defines **only** `type` and `reference`. It does not pick a chain or a log. Each anchor type is a small plugin,
and `tg verify` checks each one against the log *the verifier* chooses to trust. Nobody has to trust ours.

## The plugin contract

An anchor plugin is an ES module that exports:

| Export | Shape | What it does |
|---|---|---|
| `type` | `string` | the id used in `tgart.anchors[].type` (e.g. `"opentimestamps"`) |
| `title` | `string` | a human name for `tg verify` output |
| `anchor` | `async (digestHex) => reference` | submit the 64-hex digest to the log/chain; return a compact `reference` string to store |
| `verify` | `async (digestHex, reference) => { ok, time, detail? }` | check the reference proves the digest was logged; return whether it holds and the attested time (ISO 8601, or `null` if pending) |

`digestHex` is the SHA-256 (lowercase hex) of the thing being anchored — usually the signed key statement, so the anchor pins
the key, its validity and its own signature together. `reference` must be self-contained enough to verify later (for a chain
proof, that means the proof itself, base64url-encoded — not a URL that can rot).

A plugin must do **no own cryptography** and must be **reproducible** — anyone can verify a `reference` from public data,
without an account. The planned free anchors (`archive`, `rekor`, `opentimestamps`) need no token; a chain anchor that costs
a small network fee, like DigiByte, is welcome as an opt-in plugin for those who want it.

> **Status (2026-10): none is live yet.** The format (`tgart.anchors`) and this plugin contract are defined; `digibyte/` is
> a sketch. No key or work carries an anchor today, and `tg verify` does not yet check anchors. The table below is the plan.

## Anchor types

| Type | Status | Notes |
|---|---|---|
| `archive` | planned | would submit the key statement to Software Heritage + the Internet Archive — not a timestamp, but near-free durability |
| `rekor` | planned | [Sigstore Rekor](https://docs.sigstore.dev/logs/overview/), the Linux Foundation transparency log used by npm, PyPI and Kubernetes |
| `opentimestamps` | planned | would anchor a hash in **Bitcoin**, free, no token, batched; mature libraries exist |
| **`digibyte`** | **sketch — [start here](digibyte/)** | a DigiByte `OP_RETURN` anchor; same contract, no special status. A great first contribution. |
| *(your chain)* | wanted | any other append-only log or chain, as long as it is free and needs no account |

## Contributing a new anchor

1. Copy `digibyte/` to `anchors/<your-type>/` and implement `anchor` and `verify` against the contract above.
2. Add a `README.md` saying what log it uses, what the `reference` contains, and what a verifier must trust.
3. Make the acceptance tests pass (`node --test anchors/<your-type>/*.test.js`) — they stamp a known hash and verify it.
4. Open a pull request. See [`../CONTRIBUTING.md`](../CONTRIBUTING.md) and the [code of conduct](../CODE_OF_CONDUCT.md).

New anchor types are welcome. The whole point of this folder is that provenance should not depend on any single company,
chain or domain — including ours.
