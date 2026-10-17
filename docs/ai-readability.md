# AI readability: method and results

Typographic Art claims that its works stay readable for machines. This page shows how that was measured, so anyone can repeat it and improve the numbers.

Measured on 2026-10-17 with the reference implementation (v0.1.0), Chromium headless, Tesseract 5.5.3 (`eng`), Poppler `pdftotext` 26.08.

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

## Recommendations

- **To hand a work to an AI, use HTML or SVG.** The text is exact at every setting. PDF is exact too when read in stored order; with legibility *high* it is exact for layout-reconstructing tools as well.
- **If only an image will travel** (screenshot, social media), use legibility *high*: even pure OCR recovers about 99 % of the words.
- **PDF extraction:** prefer tools that keep the stored order (`pdftotext -raw`, PDF.js text content). Tools that rebuild the visual layout can move line fragments when sizes vary a lot.

## Not measured yet

- More vision-language models, larger samples and whole pages instead of crops.
- Other OCR engines, scripts beyond Latin, and very fine works (tens of thousands of characters, where glyphs are a few pixels high).

Contributions with reproducible numbers are very welcome; open an issue or pull request.
