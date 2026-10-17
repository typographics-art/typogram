# Proof: Moby-Dick as Typographic Art

Generated 2026-10-17 by `node demo/moby-dick/build.mjs`. Every number here is computed by that script.

## Source

- Moby-Dick; or, The Whale, Herman Melville, 1851 (public domain), Project Gutenberg eBook #2701: https://www.gutenberg.org/cache/epub/2701/pg2701.txt
- Download SHA-256: `b5e88b71a1cda068e9ab1d94344c9d932338ba6da1a66def97a1aecd9cfcc87d`
- Source text (`source.txt`, Gutenberg header and footer removed by `prepare.mjs`): 1,218,974 characters, 135 chapters plus epilogue
- SHA-256 of `source.txt`: `b8d4a465cfb1eb0c7c8a3bd597f0af7666d00caa5d3a40aa52f7af9819e31d7b`

## Poster

- 2 × 3 m, 887 lines, 1,214,967 characters (whitespace normalised)
- Type size 3.26 mm (Roboto Flex, weights 100–1000, widths 75–125 %), colours from the motifs, tone fidelity 0.90

| Panel | Text | Motif | Height |
|---|---|---|---|
| Part I – Ashore and out to sea | from Etymology, 409,272 characters | harbour | 102 cm |
| Part II – The whaling voyage | from Chapter 42, 400,736 characters | hunt | 90 cm |
| Part III – The white whale | from Chapter 86, 404,957 characters | whiteWhale | 96 cm |

## Tests on the text read back from the artwork

| | Test | Result |
|---|---|---|
| T1 | Full text from the SVG equals the source (SHA-256) | **pass** |
| T2 | Every visible character of the print PDF equals the source (MuPDF) | **pass** |
| T3 | 100 random 160-character passages are found at their original position | **pass** |
| T4 | Chapter structure intact (table of contents and 135 chapters, in order) | **pass** |
| T5 | Opening and closing of the book intact | **pass** |
| T6 | Word frequencies (top 25) identical | **pass** |
| T7 | Question set: every answer has its evidence in the extracted text | **pass** |

T1 compares SHA-256 hashes: source `744a89261a75f10e4f5da3f37fd59eb8618c859147b902584f08dadf3ab69028`, extracted `744a89261a75f10e4f5da3f37fd59eb8618c859147b902584f08dadf3ab69028`.
T2 reads the print PDF with MuPDF and compares every visible character. The PDF text layer does not carry the two invisible right-to-left marks that surround the one Hebrew word in the etymology; that is the only difference.
Poppler's `pdftotext -raw`, a common alternative, loses letters in light passages of this PDF (Chrome stores variable fonts as Type 3 fonts): 97.9 % of its words are words of the source. The text is complete in the file, as MuPDF shows; extraction tools differ.

T7 uses the question set in `ai-tests.json`: questions about the book whose answers must be grounded in the extracted text, the precondition for any AI system to answer them from the artwork.

## Reading the picture alone

Classic OCR (Tesseract, English, single-line mode) on 16 lines spread over the whole poster, each cut at word boundaries into 8 segments with their own ground truth, rendered at 2 px per mm (a photo of about 4 000 × 6 000 px per square metre): **73.6 %** of 3,922 words recognised in order. The poster mixes weights 200–1000, widths 75–125 % and sizes 60–100 % with light ink colours in bright areas; that is hard for an engine that only knows letter shapes.

A vision-language model reads the same images far better. Claude (Anthropic, Opus 5.5), reading the segment images directly, 3 of the segments where Tesseract did worst (146 words): **100.0 %** read correctly, against 4.8 % for Tesseract on the same segments. Method: The three segments with the lowest Tesseract scores were stacked into one image without looking at their ground truth; the transcription was written down before comparing. Cut-off fragments of neighbouring words at the left edge were left out; a cut-off letter at the right edge was transcribed as seen. The transcriptions are in `vision-sample.json`; this is a small manual sample.

This channel matters only when nothing but a photo of the poster travels; the files themselves carry the text exactly (T1, T2).

## Reproduce

```sh
curl -L -o pg2701.txt https://www.gutenberg.org/cache/epub/2701/pg2701.txt
node demo/moby-dick/prepare.mjs pg2701.txt   # must print sha256 b8d4a465cfb1eb0c7c8a3bd597f0af7666d00caa5d3a40aa52f7af9819e31d7b
node demo/moby-dick/build.mjs
```
