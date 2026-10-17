# Does the text reach a machine? A measured comparison

One invented document (`benchmark/testdoc.md`, 1459 characters), shared four ways, then read back the way a machine would. Regenerate with `node scripts/ai-benefit.mjs`. Generated 2026-10-17.

The document is fictional on purpose: a model cannot fill gaps from prior knowledge, so a dropped number or a lost "not" shows up in the planted-fact checks.

| Format | Size | Word recall | Facts kept | ≈ tokens | Read with |
|---|---|---|---|---|---|
| Markdown | 1 KB | 99.6% | 6/6 | 365 | the file itself |
| Ordinary PDF | 43 KB | 98.8% | 6/6 | 355 | MuPDF text layer |
| Typographics Art PDF | 71 KB | 99.6% | 6/6 | 365 | MuPDF text layer |
| Typographics Art as a flat image (OCR) | 219 KB | 21.9% | 0/6 | 62 | Tesseract OCR |

## The planted facts, per format

| Fact | Markdown | Ordinary PDF | Typographics Art PDF | Typographics Art as a flat image (OCR) |
|---|---|---|---|---|
| number | ✓ | ✓ | ✓ | ✗ |
| negation | ✓ | ✓ | ✓ | ✗ |
| percentage | ✓ | ✓ | ✓ | ✗ |
| clause | ✓ | ✓ | ✓ | ✗ |
| code | ✓ | ✓ | ✓ | ✗ |
| id | ✓ | ✓ | ✓ | ✗ |

## What it shows

- **A Typographics Art one-pager reads back like the document.** From the PDF's text layer a machine gets the same words, in order, and the same planted facts — the precise number, the negation, the clause id — as from an ordinary PDF. The picture does not cost the text.
- **What costs the text is flattening the work to a bare image.** The same one-pager, shared as a PNG and read by OCR, loses detail — which is why a Typographics Art work is meant to be shared as the PDF (or HTML/SVG), not as a screenshot. A vision model recovers far more of an image than OCR does; the exact, guaranteed path is still the text layer. See [ai-readability.md](ai-readability.md).
- **The picture costs file size, not words.** Token counts for the text formats are comparable; the Typographics Art PDF is larger than an ordinary one because every letter carries its own typography (see [file-size.md](file-size.md)).

Retrieval and citation by an actual model are a separate, costlier test; the fact checks above are the precondition — a fact that is not in the extracted text cannot be cited correctly. The measurement is reproducible: `node scripts/ai-benefit.mjs`. See also [text-fidelity.md](text-fidelity.md).
