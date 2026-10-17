# What "the text is preserved" means, exactly

Typographics Art keeps the text. That claim is worth stating precisely, because a picture made of justified lines cannot carry *everything* about a source — and saying exactly what it keeps, and what it does not, is what makes the claim checkable.

## The two texts

- **The source text** is what you put in: with its line breaks, blank lines between paragraphs, multiple spaces, tabs and any invisible formatting characters.
- **The canonical text** is what the work carries and what a machine reads back out of it. It is the source text with:
  - every run of whitespace (spaces, tabs, line breaks) reduced to a **single space**, and leading/trailing whitespace trimmed;
  - **invisible format characters removed** — soft hyphens, zero-width joiners, direction marks and other default-ignorable code points, which PDF text layers do not carry reliably;
  - Unicode **NFC** normalisation, so that stacked accents have one canonical order (different PDF readers order them differently otherwise).

Everything else is kept: **every visible character, every word, in reading order**, grapheme by grapheme (a letter with its accents, an emoji sequence, or a syllable in scripts like Devanagari stays one unit).

So the guarantee is at the level of the **canonical text**: what is preserved 1:1 is the sequence of characters and words. What is **not** preserved inside the artwork is the source's own layout — its line breaks, paragraph breaks and runs of spaces. That layout lives in the source document, which is why the [Read and Machine views](../work.html) take their paragraphs and sections from the source, while the artwork carries the same text as one normalised flow.

## Declared filler

For a finer picture you can pad a short text with Lorem ipsum. Filler is only ever appended after your text, it is always declared, and it is counted separately in every report (`filler` / `characters`). Your text comes first and is never changed.

## The checksum ties it together

Each work has a SHA-256 over its canonical text. The same value comes out of:

- the work's **HTML**, its **SVG** and its **PDF**, and
- **reading the text back out of the picture** (with MuPDF, `pdf.js`, or by selecting and copying).

When all of these agree, the three views — Art, Read, Machine — provably come from one source. That is the number shown in the Machine view and in each one-pager's check.

## Verify it yourself

```sh
# read the text back out of a work and hash it
node cli/tg-secret.mjs --help           # the reader used below is cli/onepage-core.mjs (MuPDF)
mutool draw -F txt work.pdf | tr -s '[:space:]' ' '    # ≈ the canonical text

# the one-pager checks record sha256Source and sha256ReadBack; they are equal when the text survives
cat examples/<id>/check.json
```

See also [ai-readability.md](ai-readability.md) for how well the text survives OCR and vision models when only a *picture* of the work is shared (share the HTML, SVG or PDF and it is exact), and [prior-art.md](prior-art.md) for how this differs from calligrams, micrography and ASCII art.
