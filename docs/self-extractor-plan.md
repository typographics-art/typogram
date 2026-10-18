# Plan: the self-extracting encrypted file (an optional tool)

**Status: plan only, not built.** This is an additional tool we would offer, separate from the library and the adapter.
It turns one sealed Typogram payload into a native double-clickable program (Windows `.exe`, macOS, Linux) that asks for
the key, decrypts **in RAM only**, and plays exactly that one picture or video — nothing else, nothing to disk.

## 1. What the user gets

- A single file per target OS. Double-click it.
- It asks for the **key**: a **password**, or a **key file** (any file; we hash its bytes to a key).
- Right key → the picture shows / the video plays, in a window. Wrong key → it says so and quits.
- The plaintext is only ever in memory. The program does one thing: open its own embedded payload. It is not a general
  player and cannot open anything else.

## 2. How it is made (no per-file compilation)

A self-extractor is a **prebuilt Rust stub** with the sealed payload appended, exactly how self-extracting archives work:

```
[ stub executable (fixed, per OS) ][ sealed payload ][ footer ]
```

- The **stub** is one small Rust binary per target (`x86_64`/`aarch64` × win/mac/linux), built once in CI. It never changes
  per file.
- The **packer** (a new `tg-pack`, or a `tg-adapter pack` subcommand) takes the sealed payload and the chosen stub and
  writes `stub ‖ payload ‖ footer`. No compiler on the user's machine, no compile per file.
- The **footer** (read from the end of its own file at startup) carries: a magic, a version, the **per-file random salt**,
  the KDF parameters, the payload offset and length, and the media kind. Each pack run draws a fresh salt.

The payload is the **same `tgst1` stream** (or `tgs1.` record) as everywhere else ([encrypted-media-adapter.md](encrypted-media-adapter.md)),
so one sealed media can be delivered three ways from the same bytes and the same key: a Typogram SVG, a raw `.tgst`, or a
self-extractor. The Rust side reimplements the small, fully specified crypto (AES-256-GCM, HKDF-SHA-256, Argon2id, the
frame scheme) against our test vectors.

## 3. The key

- **Password** → Argon2id(password, salt, params) → 32-byte key. Same KDF and the same "a password is never the only secret
  of a *public* record" caution ([passwords-and-keys.md](passwords-and-keys.md)); here the recipient is typically given the
  password out of band, so a password is the normal case, but the warning and the Argon2id cost still apply.
- **Key file** → hash the file's bytes (Argon2id over them, salted) → 32-byte key. Any file works as a key.
- **Per-file random salt** in the footer, fresh for every pack. Shown and enforced like the rest of the KDF code.

## 4. The hard part: "in RAM, never to disk" — a real decision

Showing an **image** in RAM is straightforward: decode in memory, draw in a window (`winit` + `softbuffer`/`pixels`, or
`egui`). Playing a **video** with sound, in memory, without a temp file, across three OSes, is the hard part. Two routes:

| Route | How | Binary | Codecs | Truly no disk? |
|---|---|---|---|---|
| **A. Own decoder** | bundle an in-process decoder (`ffmpeg`/`libav` via `ffmpeg-next`, or `symphonia`+a video decoder) and render to our own window + `cpal` audio | large (tens of MB) | what we bundle | **Yes** — we control every byte |
| **B. In-memory server + OS webview** | the stub runs a localhost server (like our adapter) serving the decrypted stream from RAM with Range, and opens an embedded webview (`wry`) with `<video>` | small | everything the OS plays | **Mostly** — the OS media stack may cache to disk; we cannot fully guarantee it |

Route A keeps the "never to disk" promise honestly but is a heavy binary and real decoder work. Route B is small and plays
anything, but the honest claim becomes "we never write it; the OS might cache it." **Decided (operator, 2026-10-18): the
hybrid** — images and a common video codec (H.264/AAC in MP4) go through an own in-process decoder so the no-disk promise
holds; exotic formats fall back to Route B, clearly labelled as "the OS may cache this one."

RAM-only hardening either way: `mlock` the key and plaintext buffers (best effort), zeroize on exit, disable core dumps.
Honest limits to state plainly: OS **swap** can page RAM to disk under memory pressure (mitigated by `mlock`, not fully on
all OSes); decoded video frames pass through the GPU/compositor; and Route B's OS media cache. We will not claim more than
is true.

## 5. Distribution and trust (operator cost)

- A double-clickable downloaded executable is exactly the shape of malware, so:
  - **Code signing** is needed or the OS blocks it: Windows **Authenticode** (an EV/OV certificate, a yearly cost), macOS
    **notarization** (an Apple Developer account, $99/yr) and a hardened runtime, Linux (no central gate; ship a checksum
    and ideally a signature).
  - **Antivirus false positives** are likely for a self-extracting binary; signing and reputation reduce them, not remove.
- **Decided (operator, 2026-10-18): unsigned, checksums only.** We do not sign; we ship a SHA-256 and a detached
  signature, and users click through the OS warning (SmartScreen "more info → run anyway", macOS right-click → open). This
  is cheap and avoids certificate costs; the trade-off is more friction and a higher chance of antivirus false positives,
  stated plainly on the download page.

## 6. Threat model (stated honestly)

Protects the media **at rest and in transit**: without the key, the file is ciphertext. It does **not** protect against a
compromised machine (malware, a privileged process reading the stub's RAM, a stolen unlocked device), it does not stop a
determined recipient who has the key from capturing what they can already watch, and "never to disk" is bounded by OS swap
and, in Route B, the OS media cache. Same honesty as the rest of the project.

## 7. Shape and phases

- A Rust workspace `self-extractor/` with `tgx-stub` (the per-OS player) and the packer (`tg-pack`, or `tg-adapter pack`).
- Crypto crate reimplementing `tgst1`/`tgs1` to our vectors; a conformance test in CI that the Rust decrypt matches the JS.
- CI matrix builds the stubs for the 6 targets; the packer ships with them (or downloads them).
- **Phase 1:** image + any file **+ MP4 (H.264/AAC) through the own decoder** (truly RAM), password and key-file, per-file
  salt, the footer format, the packer, the JS↔Rust conformance test, checksums + a detached signature. **Phase 2:** the
  webview fallback for other codecs (labelled) and more targets. **Phase 3:** polish and the download page. (No GSD phase
  numbers here — this is the tg-art repo; its own planning.)

## 8. Open decisions for the operator

1. ~~Video playback route~~ — **decided: hybrid** (own decoder for image + H.264/AAC MP4, webview fallback for the rest).
2. ~~Signing~~ — **decided: unsigned, checksums + a detached signature only.**
3. **Scope of phase 1** — proposed: image + file + MP4 (H.264/AAC) through the own decoder (the hybrid core), since the
   point of the tool is an encrypted video you can double-click; the webview fallback and more codecs come in phase 2.
