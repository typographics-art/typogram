# @typographics-art/keys

The **verified Typographics Art issuer keys** as data — the Ed25519 signing keys (and X25519 sealing keys) you need to
check a signed [Typogram](https://typographics-art.org). Published on npm so an agent that can reach npm but not an
arbitrary website can still verify provenance; **every published version is immutable**, so a key can never be silently
swapped under you.

Only **public** keys are here. Each entry was checked both ways: the key statement self-verifies, and it was confirmed
served at the issuer's own `https://<issuer>/.well-known/tgart-keys.json`.

```js
import { registry, issuers, getIssuer } from "@typographics-art/keys";

issuers();                         // ["typographics-art.org", …]
getIssuer("typographics-art.org"); // { issuer, verifiedAt, verifiedVia, keys: [...] }
registry.spec;                     // "tgart-registry-v1"
```

The raw document is also exported, for any language:

```js
import reg from "@typographics-art/keys/registry.json" with { type: "json" };
```

To verify a work with the `tg` CLI, point `--keys` at the same registry (from the repo, the site or this package):

```sh
tg verify work.tg.svg --keys ./node_modules/@typographics-art/keys/registry.json
```

Full picture, and how to get your own key listed: <https://typographics-art.org/keys> and
[docs/key-registry.md](https://github.com/typographics-art/typogram/blob/main/docs/key-registry.md). MIT.
