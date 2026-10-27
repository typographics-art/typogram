# AI readability: method and results

Typographics Art claims that its works stay readable for machines. This page shows how that was measured, so anyone can repeat it and improve the numbers.

Measured on 2026-10-17 with the reference implementation (v0.1.0), Chromium headless, Tesseract 5.5.3 (`eng`), Poppler `pdftotext` 26.08.

## What a model reads

A Typogram has two views of one text. A **human** sees the *image layer*: the artwork, the text set character for character so
it forms the picture. A **machine** should read the *data layer*: the exact source (Markdown, with its headings, tables, lists
and code) and a JSON-LD record, carried losslessly inside the same file ([typogram-file.md](typogram-file.md)). The data layer
is read directly — not OCR'd from the pixels — so it is exact and cheap:

```sh
tg extract work.svg --markdown   # the exact source, byte for byte (also .html, .pdf)
tg extract work.svg --json       # the JSON-LD record (title, author, the hash, …)
```

The numbers below measure the **fallback**: what survives when only a *picture* of the work travels (a screenshot, a social
post) and the data layer is gone. That is the hard case, and it is why the image layer is engineered to read back at all. When
the file itself travels, a model reads the data layer and gets the source perfectly, structure and all.

**The two views are bound by a hash.** The JSON-LD stores the SHA-256 of the canonical text ([canonical-text.md](canonical-text.md));
`tg verify work.svg` recomputes it from the glyphs and requires it to equal both the stored hash and the hash of the embedded
source. If the three agree, the readable source and the picture demonstrably say the same thing.

**The prompt-injection objection.** "A file that hands a model its own ready-made text could carry *different* text from what a
person sees, and smuggle instructions past the human." The hash is the answer: `tg verify` fails the moment the data layer and
the image layer diverge, and its lint flags a visible title that does not match the source. A model (or an agent framework)
should **verify before trusting** the data layer, and fall back to the glyphs (`tg extract --from-glyphs`) if it will not, or
cannot. The honesty rule for authors is the same in both directions: the visible title must name the document, and the tiny
text must never hide instructions from the people who see the page.

## Setup

- **Text:** Shakespeare's Sonnet 18 (620 characters), filled with declared Lorem ipsum to 3 000 characters. The filler contains words like *officia*, which matters for ligatures (see below).
- **Image:** a red disc above a dark green band on a light background, 640 × 800 px.
- **Settings:** legibility *high*, *medium*, *free* × unit *char* (per letter) and *word* (per word); Roboto Flex, photo colours, light paper, width 900 px, width axis and shape awareness on.
- **Reference:** the text in the SVG output (all `<text>` content, whitespace normalised). The test suite separately asserts that this equals the source.

## What was measured

| Channel | Tool | Metric |
|---|---|---|
| HTML / SVG | DOM `innerText`, XML text content | exact equality with the source |
| PDF, stored order | `pdftotext -raw` | exact equality with the SVG text |
| PDF, layout reconstruction | `pdftotext` (default) | exact equality; word-order similarity |
| Image only | `tesseract` on a PNG rendered at 2× | share of source words recovered in order (word accuracy), character similarity |

Word accuracy is the number of words in the longest common subsequences between source and OCR output (Python `difflib`), divided by the number of source words.

## Results

| Legibility · unit | HTML/SVG | PDF raw | PDF layout | OCR words | OCR characters |
|---|---|---|---|---|---|
| high · char | exact | exact | exact | 98.9 % | 99.8 % |
| high · word | exact | exact | exact | 99.6 % | 99.9 % |
| medium · char | exact | exact | 97.0 % word order | 88.7 % | 96.9 % |
| medium · word | exact | exact | 97.3 % word order | 92.7 % | 98.0 % |
| free · char | exact | exact | 97.9 % word order | 82.3 % | 94.1 % |
| free · word | exact | exact | 99.1 % word order | 68.8 % | 72.8 % |

## Vision-language model (first sample)

Classic OCR knows only letter shapes. A vision-language model also knows language, so it should cope better with strong size and weight changes.

- **Model:** Claude (Anthropic, Opus 5.5), reading images directly.
- **Material:** one crop of five full lines per legibility level (*high*, *medium*, *free*; letter mode), cut from the 2× PNG, taken from the Lorem ipsum part so the word order cannot be known in advance. Medium and free were re-rendered with a different Lorem sequence after it turned out that the first medium crop repeated words already seen in the high crop; that reading was discarded.
- **Procedure:** transcription written down first, then compared with the ground truth from the SVG.

| Legibility | Words | Correct |
|---|---|---|
| high | 58 | 100 % |
| medium | 65 | 100 % |
| free | 94 | 100 % |

This is a small sample with one model, on crops rather than whole pages; whole pages at screen resolution are harder. It does show the direction: where Tesseract drops to 82 % at *free*, the language-aware model read everything.

## Findings that changed the code

Measuring found two real defects, both fixed before these results:

1. **Ligatures dropped letters in PDFs.** Chrome set "ffi" in *officia* as one ligature glyph, and its PDF text layer then mapped that glyph to "ff": the extracted text read *offcia*. Ligatures and kerning are now switched off in every output (`GLYPH_CSS` in `src/render.js`). That also keeps the layout exact, because glyphs are measured one by one.
2. **Word mode lacked size coherence.** Neighbouring words jumped between font sizes, and `pdftotext`'s layout mode moved the very first words of the text elsewhere. Word mode now uses the same size-coherence cost as letter mode. That fixed the start of the text, but over the full text layout-reconstructing extraction still moves some line fragments at medium and free legibility (table above). "Word order" is `difflib` similarity of the word sequences.

## Which PDF extractors read a one-pager completely

Measured on the ten core examples (the first ten of the 32 one-pagers in `examples/`) (`scripts/extractor-check.py`, results in `docs/extractor-check.json`; characters counted, exact text equality checked for MuPDF, which every build does):

| Extractor | read completely | notes |
|---|---|---|
| MuPDF (`mutool draw -F txt`), PyMuPDF | 10 of 10 | exact, in reading order |
| pdfminer.six | 10 of 10 | |
| pypdf | 10 of 10 | reads at most 2 000 000 tokens per content stream; the print strips are split until every stream stays below that (before: the EU AI Act lost 44 %) |
| Poppler `pdftotext` (default 72 dpi) | 6 of 10 | keeps only the first **50 000 characters smaller than 3 × 3 units per page** and drops the rest (`TextOutputDev.cc`, "tiny chars limit"); one-pagers above that lose most of their text (10–30 % read). Its default mode also drops a hyphen that ends a line, as for hyphenated words (1–4 characters on the small examples; `-raw` keeps them) |
| Poppler `pdftotext -r 600` | 10 of 10 apart from line-end dashes | the unit shrinks with the resolution, so the limit no longer applies; since one-pagers use one type size (no glyphs below the base size), this holds even for the EU AI Act at 0.5 mm type. With mixed sizes the AI Act reached only 81 % |

A known quirk: Chrome draws a character the font lacks (for example "→" in Roboto Flex) from a fallback font, and MuPDF then reads the following space as missing ("→ erlaubt" becomes "→erlaubt"); pdftotext keeps it. The visible characters are identical; the build reports such a page as not exact. The agent library avoids arrows for that reason.

Earlier versions of this page blamed Poppler's losses on Chrome's Type 3 fonts; that was wrong. A plain page of 120 000 characters in an ordinary font shows the same cut at 50 000.

**Current state (measured 2026-10-27).** The table above is the A4 measurement. The examples are now set on bigger paper, so that their type stays above the 3 × 3 unit limit: A2 for most, A1 for the Swiss constitution and the Basic Law, A0 for the EU AI Act and the agent library (`examples/build.mjs`). With the default `pdftotext`, 24 of 32 examples now read completely. The EU AI Act still misses 13 836 words, and the agent library 2 283, even on A0; for those two use `pdftotext -r 600` or MuPDF. Six small examples miss 2 to 8 words each; the cause is not yet isolated, so they are not claimed as complete.

## Recommendations

- **To hand a work to an AI, use HTML or SVG.** The text is exact at every setting. PDF is exact too when read in stored order; with legibility *high* it is exact for layout-reconstructing tools as well.
- **If only an image will travel** (screenshot, social media), use legibility *high*: even pure OCR recovers about 99 % of the words.
- **PDF extraction:** prefer MuPDF/PyMuPDF, pdfminer.six or pypdf (table above). With Poppler, pass a high resolution (`pdftotext -r 600` or more) for pages with more than 50 000 small characters. Tools that rebuild the visual layout can move line fragments when sizes vary a lot.

## Not measured yet

- More vision-language models, larger samples and whole pages instead of crops.
- Other OCR engines, scripts beyond Latin, and very fine works (tens of thousands of characters, where glyphs are a few pixels high).

Contributions with reproducible numbers are very welcome; open an issue or pull request.
