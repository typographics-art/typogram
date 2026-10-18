# The Typogram file

A **Typogram** is the file Typographics Art makes. It is **one file**, and it is a **valid SVG**: open it in any viewer, a
browser or an operating system's file preview and you see the one-pager picture — the artwork is the text itself, and the
file's icon/thumbnail is that picture, with no tool of ours involved. The same file also carries, inside it, a **data layer**:
the exact source it was made from and a machine-readable record, so a program reads the content back without OCR — with our
`tg` tool (`cli/tg.mjs`), the stdlib reference (`tools/tg_extract.py`), or one you write yourself. Nothing is split across
companion files: **everything is in the one file.**

```
  open it as a file   →  a picture (the one-pager), everywhere, no tool
  read the data layer →  the exact source (Markdown) and a JSON-LD record, directly
  verify it           →  prove the picture and the source carry the same text (one hash)
```

## 1. Three views of one text

A Typogram guarantees three views, and only the first is needed for it to be a picture:

1. **The image layer** — the visible `<text>…</text>`: the work's text set character for character so it forms the picture.
   A normal SVG, it renders everywhere. The text in it is exact; an extractor reads it back (whitespace is normalised, see
   [technique.md](technique.md), [canonical-text.md](canonical-text.md)).
2. **The data layer** — the exact source and a record, carried losslessly in the same file (§3). The visible artwork
   normalises whitespace (line breaks become single spaces), so Markdown tables, lists and code lose their structure in the
   picture; the data layer keeps them byte for byte.
3. **The identity hash** — the SHA-256 of the canonical text ([canonical-text.md](canonical-text.md)), stored in the data
   layer's JSON-LD (`tgart.hash`). `tg verify` recomputes it from the image layer and requires it to equal both the stored
   hash and the hash of the embedded source: proof that the picture and the readable source say the same thing.

A Typogram may also carry, in the same file, **structured data** (a `TGD1[…]TGD1` block that sits *in the visible text*, see
[structured-data.md](structured-data.md)), **sealed data or small media** (a `tgs1.` record, [encrypted-data.md](encrypted-data.md)),
or **a sealed video** (a `tgst1` stream in a `<tgstream>` element, [encrypted-media-adapter.md](encrypted-media-adapter.md),
so the one SVG holds the whole video and still opens as its cover picture).

## 2. Why an SVG, and why it stays a picture

SVG is XML, and XML ignores elements it does not know. The data layer lives in a `<metadata>` element a renderer does not
draw, so every viewer shows only the artwork. Its source is held in a **CDATA** section (opaque to the XML parser) and its
record is a JSON-LD `<script>` where every `<` is escaped as `<`; readers strip the data layer before scanning the image
layer. So the data layer can contain any text at all — even `<text>`, `</metadata>` or `]]>` — and it can never shift where
the artwork begins or ends: the character-for-character read-back of the picture stays exact whether or not a data layer is
present.

## 3. The data layer

In an **SVG**, the data layer is a `<metadata>` element placed right after the opening `<svg …>`, before `<title>`/`<text>`:

```xml
<metadata>
  <tgart:source xmlns:tgart="https://typographics-art.org/ns/typogram/1" media="text/markdown"><![CDATA[…the exact source…]]></tgart:source>
  <script type="application/ld+json">{ …schema.org DigitalDocument… }</script>
</metadata>
```

The JSON-LD is a schema.org `DigitalDocument` with a `tgart` sub-object:

| Field | Meaning |
|---|---|
| `name`, `author`, `dateCreated`, `inLanguage`, `license`, `description`, `url` | standard schema.org fields (each optional) |
| `tgart.version` | the data-layer version (`1`) |
| `tgart.generator`, `tgart.sourceFormat` | `"typogram"`; the source's MIME type (e.g. `text/markdown`) |
| `tgart.charCount` | the source length in characters |
| `tgart.hash` | the SHA-256 of the canonical text ([canonical-text.md](canonical-text.md)) — the identity hash |

The **HTML** view (`.html`) carries the same data layer as two inert data scripts in `<head>` — `<script type="application/ld+json">`
and `<script type="text/markdown">` (a literal `</script` in the source is written `<\/script` and reversed on read) — next to
the picture (a `<figure role="img">`) and the source rendered to a true `<article>`. The **PDF** view (`.pdf`) carries it as
PDF **attached files** — `source.md` (or `source.txt`) and `metadata.json` — and sets the document Title/Author/Subject and a
Keywords field holding `sha256=<hash>`; the text layer (what a machine reads from the page) is untouched.

## 4. Read it yourself

Everything needed to read a Typogram is public and documented:

- **The picture**: it is an SVG (or the PDF/HTML view); render it.
- **The exact source and the record**: read the data layer — in an SVG the `<tgart:source>` CDATA and the JSON-LD `<script>`;
  in HTML the two `<head>` scripts; in a PDF the `source.*`/`metadata.json` attachments. `tg extract <file> [--markdown|--json|
  --text]` does this for all three; `--from-glyphs` falls back to reading the picture's text instead.
- **The integrity check**: canonicalise the image-layer text ([canonical-text.md](canonical-text.md) §2), SHA-256 it, and
  compare with `tgart.hash` and with the hash of the embedded source. `tg verify <file>` does exactly this; the stdlib
  reference `tools/tg_extract.py` mirrors it and produces the same hash.
- **The visible text / structured data in the picture**: take the characters inside `<text>…</text>`, normalise whitespace,
  and if they contain `TGD1[…]TGD1`, decode that block ([structured-data.md](structured-data.md)).
- **Sealed payload**: a `tgs1.` record or an embedded `tgst1` stream opens only with the key ([encrypted-data.md](encrypted-data.md),
  [key-management.md](key-management.md), [encrypted-media-adapter.md](encrypted-media-adapter.md)). Without the key you still
  have the picture.

## 5. The tools we ship

- `tg verify <file>` / `tg extract <file>` (`cli/tg.mjs`): check a Typogram's three views, or read its data layer, on
  `.svg`, `.html` and `.pdf`. `tools/tg_extract.py` is a standalone Python reference (standard library only; optional `pypdf`
  for PDF).
- `tg-adapter embed <cover.svg> <media>` writes a one-file video Typogram (the cover SVG plus the sealed stream inside it);
  `tg-adapter serve <file>` reads the one file and serves what is inside at `http://127.0.0.1:…` — structured data as its
  native format, sealed media streamed with HTTP Range, the key held in memory, nothing written to disk or uploaded.
  `tg-adapter source <file>` writes the exact source out; `tg-adapter info <file>` prints what a file is without a key.
