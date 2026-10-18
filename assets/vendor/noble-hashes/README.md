# @noble/hashes 2.4.0 (vendored subset)

Argon2id (RFC 9106) in pure JavaScript, for browsers and Node, used by `src/keys-kdf.js`.

- Upstream: https://github.com/paulmillr/noble-hashes , npm package `@noble/hashes@2.4.0`, licence MIT (file `LICENSE`).
- Integrity: the npm tarball `https://registry.npmjs.org/@noble/hashes/-/hashes-2.4.0.tgz` has
  `sha512-X5XaVWZIBCT7HHZGm5I7ZQXDwLG+bGXuSrMQAW+7Zvl87h1kmc1ZB1VSRJcpUfoUrGQp4Fkoxm5kZ+Ms+aW+eA==` (the value npm publishes in its registry
  metadata; recomputed with `openssl dgst -sha512 -binary | base64` on 2026-10-18: identical).
- Files: the transitive closure of `argon2.js` (argon2.js, blake2.js, _blake.js, _u64.js, _md.js, utils.js), copied byte for byte from the
  tarball (`package/<name>`). `test/key-management.test.js` checks their SHA-256 against `SHA256SUMS` here.
- Not modified. To update: download the new tarball, verify its integrity against the registry, copy the same files, update this file and `SHA256SUMS`.
