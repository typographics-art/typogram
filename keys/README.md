# Verified Typographics Art issuer keys

This folder is the **verified-issuer key registry**: the Ed25519 signing keys (and X25519 sealing keys) that
[`tg verify`](../docs/verification.md) needs, published where an automated agent can reach them even when it cannot load
an arbitrary website. Every entry is checked two ways — each key statement **self-verifies**, and it was confirmed
**served at the issuer's own domain** (`https://<issuer>/.well-known/tgart-keys.json`) when it was added.

## Where to fetch it

- **In this repo / on GitHub:** [`keys/registry.json`](registry.json) — all issuers in one file. Raw URL (reachable from
  a code sandbox whose allowlist includes GitHub):
  `https://raw.githubusercontent.com/typographics-art/typogram/main/keys/registry.json`
- **On the website:** `https://typographics-art.org/keys/registry.json` (and the page `https://typographics-art.org/keys`).
- **As an npm package** (immutable — a published version can never be silently changed):
  `npm view @typographics-art/keys` → the registry ships as `registry.json` inside the package.
- **As a PyPI package** (immutable; for Python sandboxes): `pip install tgart-keys` → `import tgart_keys; tgart_keys.registry`.
- **Per issuer, from the source of truth:** `https://<issuer>/.well-known/tgart-keys.json`.

## Use it

```sh
# Verify a signed work against the whole registry (it picks the issuer named in the work):
tg verify work.tg.svg --keys keys/registry.json
```

`tg verify` also accepts a single issuer file or a directory; the registry is just a convenient one-file source.

## Get your key listed

See [docs/key-registry.md](../docs/key-registry.md) for the full flow. In short:

1. Make an issuer key: `tg keygen --issuer <your-domain>`.
2. Publish it at `https://<your-domain>/.well-known/tgart-keys.json` (this proves domain control).
3. Submit it — open an issue with the **Key submission** template, or a pull request adding `keys/<your-domain>.json`
   (byte-identical to what you serve).
4. We verify it with `tg keys add <your-domain>` (self-signature **and** that it is served at your domain), commit it to
   `registry.json`, and publish a new immutable `@typographics-art/keys`.

Nothing here is a secret: these are **public** keys. A private signing key is never in this folder or the registry.
