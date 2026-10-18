# self-extractor

A Rust workspace for the planned `tgst1` self-extractor (`docs/self-extractor-plan.md`). **This round only ships the
crypto core** (`tgx-crypto`), reviewed and conformance-tested against the JavaScript implementation
(`src/stream.js`). It decrypts a `tgst1` encrypted-stream file: the clear 44-byte header, the HKDF-SHA-256 frame key,
and AES-256-GCM per frame with an AAD-authenticated header+counter.

**Not built yet (future rounds):** the packer, the player/GUI, the native stub binaries, and the Argon2id
password/key-file path (`docs/self-extractor-plan.md` §2–§4). `tgx-crypto` only reimplements the *read* path of
`src/stream.js`'s `StreamReader` — `sealStream` (writing a `tgst1` file) is not needed by a player and is not
reimplemented here.

## What's here

```
self-extractor/
├── Cargo.toml              workspace manifest
└── tgx-crypto/
    ├── Cargo.toml
    ├── src/
    │   ├── lib.rs           public exports
    │   ├── error.rs         TgxError (no panics on malformed input)
    │   ├── header.rs        the 44-byte clear header: parse + validate
    │   ├── meta.rs          the decrypted metadata envelope (media, size, name, …)
    │   └── reader.rs        StreamReader: HKDF key derivation + AES-256-GCM per frame
    └── tests/
        └── conformance.rs   runs every vector in ../../test/fixtures/conformance/stream-vectors.json
```

## Running it

```sh
cd self-extractor
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test
```

`cargo test` runs the conformance test, which reads `test/fixtures/conformance/stream-vectors.json` (built by
`scripts/build-stream-vectors.mjs` from the real JS `sealStream`/`StreamReader`) and, for every vector, decrypts the
metadata and every data frame and checks them byte-for-byte and field-for-field against what the JS side produced.
It also covers: an unbound stream opening without a work digest, a bound stream refusing to open without one, a
wrong secret failing the GCM tag check instead of panicking, and a truncated file being rejected at header-parse
time instead of panicking or reading out of bounds.

## Format notes (ground truth: `src/stream.js`, not this file)

- Header is 44 bytes: `magic(5) flags(1) fileSalt(16) frameSize(4) frameCount(4) reserved(4) totalSize(8)
  metaCtLen(2)`. The 4 bytes at offset 30..34 are written as zero by the sealer and are not interpreted on read —
  this is the gap between `HEADER=44` and the field widths quoted in `src/stream.js`'s own comment, which only
  describes them as `totalSize8` immediately after `frameCount4`.
- `frameKey = HKDF-SHA-256(secret, salt = "tgst1/key" || fileSalt, info = "tgst1/aes-256-gcm" || (bound ?
  workDigest : ""), 32)`.
- Nonce per frame: `0x00000000 || u64BE(counter)` (12 bytes). The metadata frame's counter is `u64::MAX`; data
  frame `i`'s counter is `i`.
- AAD per frame: the 44-byte clear header, followed by the 8-byte big-endian counter.
- Every ciphertext frame on disk is `ciphertext || 16-byte GCM tag` (consistent with how Web Crypto and
  `aes-gcm`'s allocating API both represent an AEAD box).

## Dependencies

Exact-pinned, minimal RustCrypto set: `aes-gcm` (AES-256-GCM only, `default-features = false` — no RNG features,
since a reader never generates a key or nonce), `hkdf` + `sha2` (key derivation), `serde` + `serde_json` (the
metadata envelope). `hex` is a dev-dependency, used only by the conformance test to decode the fixture.
