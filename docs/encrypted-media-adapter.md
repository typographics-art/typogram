# Encrypted media and the adapter

Typographics Art can seal a file — a picture, a video, a data file — so that it only opens with a key, and an **adapter**
makes the sealed file readable by *any* ordinary player or program, on the fly, without ever writing the plaintext to
disk or sending anything anywhere. This page is the design: the formats, the metadata they carry, the adapter, and what
is and is not promised. The crypto is the same as [encrypted-data.md](encrypted-data.md) (AES-256-GCM, the key model of
[key-management.md](key-management.md)); only the framing is new.

## 1. Why a stream format

A sealed record (`tgs1.`, [encrypted-data.md](encrypted-data.md)) is **one** AES-256-GCM box: it authenticates as a
whole, so you cannot open the middle of it without reading all of it. That is right for a small file, and small enough to
sit in a work's text — about **430 KB of media per A4 page** (a page holds ~600,000 characters of text, and a sealed
record is base64url, ~1.37 characters per byte). A photo of a few hundred KB fits on one page; a larger one spans a few
pages (a "book" of panels).

A video does not: a three-minute phone clip is 30–100 MB, which would be 70–230 pages. A video is sealed as a separate
**stream file** (`tgst1`, below), and the one-pager is its printable **cover** (title, key hint), not the video's bytes.
The stream format is cut into frames so a player can seek and stream: the adapter decrypts only the frames a byte range
touches, each still authenticated.

| Carrier | What for | Lives in |
|---|---|---|
| `tgs1.` sealed record (text) | small image, a data file, a short message | its own `.tgs` file, or a work's text (a one-pager page) |
| `tgst1` stream file (binary) | video, audio, a large image | its own `.tgst` file; the one-pager is the cover |

## 2. Metadata (both carriers)

Sealed `bytes` carried no type or name, so a player could not know what it was handling. Every sealed **file** now
carries a small **metadata envelope**, with the same field names as a TGD `attach` ([structured-data.md](structured-data.md)):

| Field | Meaning | Required |
|---|---|---|
| `media` | the MIME type, e.g. `video/mp4`, `image/jpeg`, `text/csv` | yes |
| `size` | plaintext length in bytes | yes |
| `name` | the original file name | no |
| `created` | ISO-8601 timestamp | no |
| `title` | a human label for a cover or a player | no |
| `sha256` | hex SHA-256 of the plaintext (a stable id, integrity beyond the frame tags) | no |

The envelope is **encrypted** (private): without the key a recipient learns nothing from it — not the name, not even the
type. Only the unavoidable layout numbers (frame size and count) are in the clear, because the adapter needs them to seek
before it has decrypted anything. The envelope is canonical JSON and is authenticated exactly like a data frame.

## 3. The `tgst1` stream file

Binary. A 44-byte clear header, an encrypted metadata frame, then the data frames. Nothing but the layout is in the clear.

```
off  len  field
0    5    magic "TGST1"
5    1    flags            bit0 = bound to a work
6    16   fileSalt         random; part of the key-derivation salt (so the key is unique per file)
22   4    frameSize        u32 BE, plaintext bytes per data frame (default 1 MiB)
26   4    frameCount       u32 BE, number of data frames = ceil(totalSize / frameSize)
34   8    totalSize        u64 BE, plaintext total (the last data frame may be short)
42   2    metaCtLen        u16 BE, ciphertext length of the metadata frame (plaintext ≤ 64 KiB)
44   …    metadata frame   ciphertext || 16-byte GCM tag
…    …    data frames      for i in 0..frameCount-1: ciphertext_i || 16-byte GCM tag
```

- **Key.** `frameKey = HKDF-SHA-256(secret, salt = "tgst1/key" ‖ fileSalt, info = "tgst1/aes-256-gcm" ‖ (bound ? workDigest : ""), 32)`.
  `secret` is the 16/32 bytes of an ordinary `tgx1.`/`tgx2.` key, or a record key from a seed — the same key model as a
  sealed record. The per-file `fileSalt` makes the frame key unique per file.
- **Nonce.** Not stored; recomputed. The data frame `i` uses the 12-byte nonce `0x00000000 ‖ u64BE(i)`; the metadata
  frame uses `0x00000000 ‖ 0xFFFFFFFFFFFFFFFF`. The key is unique per file and each counter is unique within the file, so
  a nonce is never reused.
- **AAD.** Every frame authenticates `clearHeader(0..44) ‖ u64BE(counter)`. So a changed frame size or count, a swapped,
  duplicated, dropped or truncated frame, and a frame moved between files all fail to decrypt. A truncated file has fewer
  bytes than `frameCount` frames and is caught.
- **Random access.** The length of data frame `i` is `frameSize` (`totalSize − (frameCount−1)·frameSize` for the last),
  so the byte offset of any frame is pure arithmetic from the clear header. A reader for byte range `[a, b)` decrypts only
  the frames that range touches.

## 4. The adapter

`tg-adapter` is a **local decrypting gateway**. You give it the key and a sealed source (a `.tgst` or `.tgs` file, or a
one-pager whose text carries a sealed block); it serves the plaintext over `http://127.0.0.1:<port>/…` with the right
`Content-Type` (from the metadata) and **HTTP Range** support. Any player — a browser `<video>`, VLC, mpv — opens the URL
and streams and seeks it. A sealed data file is served as its native format (`…/data.csv`, `.json`, `.xlsx`) so a program
that expects a CSV gets a CSV.

- **On the fly.** A Range request decrypts only the frames it covers; the plaintext is never written to disk.
- **Local only.** The server binds `127.0.0.1`, prints a URL with a one-time path token, and holds the key in memory for
  its lifetime only. Nothing is uploaded; the key never leaves the machine.
- **Any player.** HTTP + Range is what every media player already speaks, so there is nothing to install on the player's
  side. (A later step can mount the same content as an ordinary file via FUSE for programs that take a path, not a URL.)
- **The declared type is untrusted.** The media type in a stream's metadata is set by whoever sealed it, so the adapter
  serves inline, with its own type, only audio, video, images (not SVG) and PDF; anything else (and so any `text/html` or
  `image/svg+xml` a hostile sender might declare) is served as an `application/octet-stream` download. Every response
  carries `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`, so a browser that
  opens the URL never runs script from a crafted file. A sealed data file is served from the project's own writer types
  (`text/csv`, `application/json`, …), always as a download.

## 5. What is and is not promised

- **The key is everything.** No key, no playback and no read; a lost key is lost data; nothing is recoverable. The key
  model, the "a password is never the only secret" rule and the limits are [key-management.md](key-management.md) and
  [passwords-and-keys.md](passwords-and-keys.md).
- **Integrity.** Every frame is authenticated; a changed, reordered or truncated file is refused, not played as garbage.
- **Metadata is private** (section 2), but the **size is not hidden**: the clear header and the file length reveal the
  plaintext size to the byte (frame padding is not yet offered).
- **Not independently audited.** As the rest of the crypto: reviewed internally and adversarially, not by an outside
  cryptographer ([encrypted-data.md](encrypted-data.md) §12).
- **In-memory bound.** The adapter decrypts frame by frame, so memory is one frame, not the whole file; a player that
  asks for the whole range at once still only costs the adapter one frame at a time.
