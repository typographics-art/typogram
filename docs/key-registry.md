# The verified-issuer key registry

Signatures only help if the verifier can get the signer's public key. For a person a browser fetches
`https://<issuer>/.well-known/tgart-keys.json`; the [`/v`](https://typographics-art.org/v) page does exactly that. But
some verifiers are **automated agents that cannot reach an arbitrary website** — a code sandbox or coding agent with a
fixed allowlist (which almost always includes GitHub, `raw.githubusercontent.com`, npm and PyPI), or a chat assistant's
web tool that only loads a page it first found in a search. So the keys are also published where those agents *can* read
them: as one file in this GitHub repo and as an immutable npm package.

## What "verified" means here

An issuer is listed only when both hold:

1. **Cryptographically consistent** — every Ed25519 key statement self-verifies (`verifyKeyStatement`): the self-signature,
   the predecessor chain and the validity window all check out, and the statement names the issuer it is filed under.
2. **Domain control** — the exact same key was fetched from `https://<issuer>/.well-known/tgart-keys.json` when it was
   added. Whoever controls that domain's HTTPS published it. The registry records `verifiedAt` and `verifiedVia`.

The registry never contains a private key. It carries public signing keys (`alg: "Ed25519"`) and public sealing
recipients (`alg: "X25519"`); the secrets that match them stay with each issuer.

## Where it lives

| Source | URL | Notes |
|---|---|---|
| GitHub (raw) | `https://raw.githubusercontent.com/typographics-art/typogram/main/keys/registry.json` | for GitHub-allowlisted agents |
| Website | `https://typographics-art.org/keys/registry.json` and the page `/keys` | indexed, linked from the site |
| npm | `@typographics-art/keys` (`registry.json` + a tiny ESM index) | **immutable** per version |
| PyPI | `tgart-keys` (`import tgart_keys` → `registry`, `issuers()`, `get_issuer()`) | **immutable** per version; for Python sandboxes |
| Per issuer | `https://<issuer>/.well-known/tgart-keys.json` | the source of truth each entry is checked against |

## Verify a work against the registry

```sh
tg verify work.tg.svg --keys keys/registry.json     # picks the issuer the work names
```

The `--keys` argument accepts the registry file, a single `{ issuer, keys }` file, or a directory of them.

## Get listed (the submission flow)

1. **Make your key** (once): `tg keygen --issuer <your-domain> --private-out <secret>.pem`. Keep the private PEM in a
   secret manager — it is never shared. The command also writes your public `keys/<domain>.json` and
   `.well-known/tgart-keys.json`.
2. **Publish it** at `https://<your-domain>/.well-known/tgart-keys.json`. This is what proves you control the domain.
3. **Submit it**, either:
   - open a GitHub issue with the **Key submission** template (just your domain), or
   - open a pull request adding `keys/<your-domain>.json`, byte-identical to what you serve.
4. **We verify and publish.** A maintainer runs `tg keys add <your-domain>`, which fetches your `.well-known`, checks the
   self-signatures and domain control, writes `keys/<your-domain>.json` and rebuilds `keys/registry.json`
   (`tg keys build` / `tg keys verify` guard it). A new immutable `@typographics-art/keys` is published.

### Rotation and revocation

Publish a new key statement at your `.well-known` (a new `kid`, optionally with `predecessor`/`revokes` per
[docs/issuers.md](issuers.md)), then ask us to re-run `tg keys add <your-domain>`; the registry follows your domain.

## Maintainer commands

```sh
tg keys add <domain> [--from <keyfile.json>]   # verify (served at the domain, or --from a local file) and add
tg keys build                                  # rebuild keys/registry.json from keys/<domain>.json files
tg keys verify                                 # re-check every statement in the registry
tg keys list                                   # issuers, their kids and when each was verified
```

`--from <file>` adds from a local key file without the live domain check (it says so, loudly): use it only when you have
already confirmed the key is served at the domain by other means.
