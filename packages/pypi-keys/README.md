# tgart-keys

The **verified Typographics Art issuer keys** as data, for Python. The Ed25519 signing keys (and X25519 sealing keys)
you need to check a signed [Typogram](https://typographics-art.org). On PyPI so a Python sandbox or agent that can reach
PyPI but not an arbitrary website can still verify provenance; **every published version is immutable**.

Only **public** keys. Each entry self-verifies and was confirmed served at the issuer's own
`https://<issuer>/.well-known/tgart-keys.json`.

```python
import tgart_keys

tgart_keys.issuers()                         # ['typographics-art.org', ...]
tgart_keys.get_issuer("typographics-art.org")  # {'issuer': ..., 'verifiedAt': ..., 'keys': [...]}
tgart_keys.registry["spec"]                  # 'tgart-registry-v1'
```

Full picture and how to get your key listed: <https://typographics-art.org/keys> and
[docs/key-registry.md](https://github.com/typographics-art/typogram/blob/main/docs/key-registry.md). MIT.
