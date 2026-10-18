# The Typogram file

A **Typogram** is the file Typographics Art makes. It is **one file**, and it is a **valid SVG**: open it in any viewer, a
browser or an operating system's file preview and you see the one-pager picture — the artwork is the text itself, and the
file's icon/thumbnail is that picture, with no tool of ours involved. The same file also carries, inside it, the data or
media it was made from, and a documented metadata block, so a program can read the content back — with our adapter
(`cli/tg-adapter.mjs`, [encrypted-media-adapter.md](encrypted-media-adapter.md)) or with one you write yourself. Nothing
is split across companion files: **everything is in the one SVG.**

```
  open it as a file        →  a picture (the one-pager), everywhere, no tool
  read it with an adapter  →  the structured data in its native format, or the media, streamed
```

## 1. What is in the file

A Typogram SVG has three parts, and only the first is needed for it to be a picture:

1. **The artwork** — the visible `<text>…</text>`: the work's text set character for character so it forms the picture.
   This is a normal SVG and renders everywhere. The text in it is exact (an extractor reads the source back; whitespace is
   normalised, see [technique.md](technique.md)).
2. **The payload**, in one of these forms, all inside the same file:
   - **Structured data** — a `TGD1[…]TGD1` block sits *in the visible text* already (it is whitespace-proof text, see
     [structured-data.md](structured-data.md)). Nothing extra to carry.
   - **Sealed data or small media** — a `tgs1.` record ([encrypted-data.md](encrypted-data.md)), carried in the file.
   - **Sealed large media (a video)** — the `tgst1` stream ([encrypted-media-adapter.md](encrypted-media-adapter.md)),
     embedded as base64 in the file (so the one SVG holds the whole video; the picture is its cover). *(Writer/reader:
     building — the format below is the target; today the adapter embeds and reads structured data and a sealed record.)*
3. **The metadata** — a `<metadata>` element (section 3), always present on a generated Typogram.

## 2. Why an SVG, and why it stays a picture

SVG is XML, and XML ignores elements and attributes it does not know. The metadata and any embedded payload live in
elements a renderer does not draw (`<metadata>`, a namespaced `<tg:stream>`), so every viewer shows only the artwork. The
metadata is written as **XML-escaped JSON**, so it can never contain a literal `<text` or `</text>`; that guarantees it
cannot shift where the text begins or ends, and the character-for-character read-back of the artwork stays exact whether or
not metadata is present.

## 3. The metadata block

```xml
<metadata><typogram xmlns="https://typographics-art.org/ns/typogram/1">{…XML-escaped JSON…}</typogram></metadata>
```

The JSON (unescape `&lt; &gt; &amp;` first), with `format: "typogram"` and `v: 1` always present:

| Field | Meaning |
|---|---|
| `format`, `v` | `"typogram"`, version `1` |
| `title` | a human label (optional) |
| `created` | ISO-8601 timestamp (optional) |
| `textSha256` | SHA-256 of the canonical artwork text — a stable id and an integrity check of the picture's text |
| `kind` | `"art"` (picture only), `"data"` (a data block is in the text), `"sealed"` (a `tgs1.` record is inside), `"stream"` (a `tgst1` video is embedded) |
| `media` | for `sealed`/`stream`: the MIME type of the payload (also kept, encrypted, inside the sealed payload itself) |

## 4. Write your own adapter

Everything needed to read a Typogram is public:

- **The picture**: it is an SVG; render it.
- **The text / structured data**: take the characters inside `<text>…</text>`, normalise whitespace (collapse runs to one
  space), and if they contain `TGD1[…]TGD1`, decode that block ([structured-data.md](structured-data.md)); it carries its
  own checksum and types, and `tg-data` / the library turn it back into `.csv`, `.json`, `.xlsx`, ….
- **The metadata**: read the `<metadata><typogram>` element, unescape, `JSON.parse`.
- **Sealed payload**: a `tgs1.` record or an embedded `tgst1` stream opens only with the key — the cipher and key formats
  are [encrypted-data.md](encrypted-data.md), [key-management.md](key-management.md) and
  [encrypted-media-adapter.md](encrypted-media-adapter.md). Without the key you still have the picture.

## 5. The adapter we ship

`tg-adapter serve <file.svg>` reads the one file and serves what is inside at `http://127.0.0.1:…`: structured data as its
native format, sealed media streamed with HTTP Range (only the frames a byte range touches are decrypted), the key held in
memory, nothing written to disk or uploaded. `tg-adapter info <file>` prints what a file is and its metadata without a key.
