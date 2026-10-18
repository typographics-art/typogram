# Canonical text and the identity hash

A Typogram has three views of one text: the **image layer** (the artwork, one glyph per character), the **data layer**
(the exact source — Markdown — kept losslessly in the file), and an **identity hash** that proves both carry the same text.
The hash is computed over a *canonical* form of the text, defined here so that any tool — ours, the Python reference in
`tools/`, or one you write — produces the same hash from the same text.

## 1. Why a canonical form

The image layer cannot preserve whitespace: runs of spaces, tabs and line breaks become a single space (the picture needs
that freedom, see [technique.md](technique.md)). So the image layer and the raw source are **not** byte-identical — the
source has the line breaks and the Markdown structure, the image has them collapsed. They are the same text only *after*
whitespace is normalised. The canonical form is that common ground: the hash of the canonical form of the image-layer text
equals the hash of the canonical form of the source, and that equality is what `tg verify` checks.

## 2. The normalisation (exact, in order)

Given a string, produce the canonical string by applying, in this order:

1. **Remove default-ignorable code points.** Delete every character matching Unicode `\p{Default_Ignorable_Code_Point}`
   (soft hyphen, zero-width space and joiners, bidi controls, variation selectors, the BOM, …). The picture never carries
   these, so they must not count toward identity.
2. **Normalise to NFC.** Unicode Normalization Form C (canonical composition), so that e.g. `e` + combining acute and the
   single `é` compare equal.
3. **Collapse whitespace.** Replace every run matching `\s+` (spaces, tabs, newlines, and other Unicode whitespace) with a
   single U+0020 space.
4. **Trim.** Remove a leading and trailing space.

The reference implementation is `canonicalText` in `src/secret.js`:

```js
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/gu;
const normalizeText = (t) => t.replace(/\s+/g, ' ').trim();
const canonicalText = (t) => normalizeText(String(t).replace(INVISIBLE, '').normalize('NFC'));
```

Python (same result, standard library only):

```python
import re, unicodedata
_INVISIBLE = re.compile(r'[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯﻿￰-￸\U000E0000-\U000E0FFF]')
def canonical_text(s: str) -> str:
    s = _INVISIBLE.sub('', s)
    s = unicodedata.normalize('NFC', s)
    return re.sub(r'\s+', ' ', s).strip()
```

(The Python class lists the default-ignorable ranges explicitly, because `re` has no `\p{…}`; it matches the same code
points the reference removes. The reference tool in `tools/` keeps this list in sync.)

## 3. The hash

```
hash = SHA-256( UTF-8 bytes of the canonical string ) , lower-case hexadecimal
```

It is stored in the data layer (the JSON-LD field `tgart.hash`) and is the value `tg verify` recomputes from the image
layer and compares against both the stored hash and the hash of the embedded Markdown.

## 4. What the hash does and does not promise

- It proves the **image layer and the data layer carry the same text** (after §2). It is an integrity and honesty check, not
  a signature: anyone can recompute it, and anyone editing both layers consistently can recompute it too. For authenticity
  (who made it), add a signature over the hash — outside this file's scope.
- It is **whitespace- and invisibles-insensitive by design** (§2). Two Typograms whose source differs only in line wrapping
  or soft hyphens share a hash; that is intended — the picture cannot tell them apart either.
- It says nothing about the picture's *appearance*; two very different-looking artworks of the same text share a hash.
