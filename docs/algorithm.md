# How the reference implementation works

The pipeline lives in `src/`. Everything except `browser.js` is pure and runs in Node.

## 1. Glyph metrics (`browser.js`)

For every distinct character of the text, at ten weight steps (and, for fonts with a width axis, at 75 %, 100 % and 125 % width) of the chosen variable font:

- **advance**: the width the browser lays the glyph out with, measured in the DOM at 40 px;
- **coverage**: the share of the glyph's cell (advance × line height) covered by ink, measured by rendering it to a canvas and summing alpha;
- **ink profile**: the share of ink in the left/right and top/bottom halves of the cell.

The optical size axis is pinned (`'opsz' 40`), so advances scale linearly with font size. `typeset()` loads the font's stylesheet first if the page does not link it; otherwise the browser would silently measure a fallback font.

## 2. Tone map (`tone.js`)

The image is centre-cropped to the output aspect ratio and reduced to at most 720 px wide. Each pixel becomes an *ink demand* between 0 and 1 (darkness on light paper, brightness on dark paper). Contrast, brightness and an unsharp mask ("emphasise edges") are applied. Summed-area tables make the mean demand and mean colour of any rectangle an O(1) lookup.

## 3. Candidates and lookup tables (`layout.js`)

A legibility level allows a set of weights, size factors and (in grey mode) lightening steps. Each combination is a candidate with an effective coverage

```
eff = coverage(char, weight) × size × (1 − grey) × lineRatio / 0.92
```

For every character, a table maps (target tone, size of the previous glyph) to the cheapest candidate:

```
cost = (eff − target)² + 0.00035·(1 − size) + 0.0002·grey + 0.004·|size − previousSize|
```

A further term `0.0012·|stretch − 1|` lets width change only where it buys tone. The size term keeps neighbouring glyphs at similar sizes; without it, small glyphs next to full-size ones read like stray capitals.

## 4. Setting (`layoutAt`)

Lines are filled word by word. For each glyph, the target is the mapped tone of the area it will cover, plus half of the previous glyph's error, plus the error the line above left in that column (error diffusion). With `shape` on, the target is the tone of the four half-cells weighted by the glyph's ink profile, so a glyph on an edge takes the tone of the side its ink is on. A word is set tentatively; if it does not fit, it moves to the next line and is set again there. In word mode, one candidate is chosen for the whole word from its average coverage.

### Short texts: blank space as layout (`gaps`)

A text of a few thousand characters has too few glyphs to cover a page. The plain layout spreads them thin over the whole sheet (3 000 characters make about 42 lines), the light areas of the picture are filled with pale type, and the title card, which only covers a tenth of the sheet, is a band of six lines: it dissolves into grey noise (measured on the examples, see below).

With `gaps` on, glyphs go only where the picture is dark and the blank sheet carries the light areas:

1. For every line, the band of the picture it covers is scanned in steps of 0.3 font sizes; stretches whose darkness is at least `GAP_INK` (0.25) are *ink segments*. Gaps shorter than 0.6 font sizes are bridged, segments narrower than 1.2 font sizes are dropped.
2. Words fill a segment in reading order. A word that does not fit the rest of its segment moves to the next segment of the line, or to the next line. A word wider than its whole segment is set anyway and spills into the blank (a gap inside a word would be read as a space by PDF text extractors). When a segment is full, its inner spaces widen to use up the slack (at most 2.5 font sizes each), so its right edge is as even as its left one.
3. The first segment of a line is entered by an indent (`text-indent` in HTML, the start x in SVG and PDF), the jump from one segment to the next is carried by the space between the two words (`word-spacing` on that one space).

**Whitespace is layout, not text.** Nothing is inserted: the widened gaps are the source's own spaces, a line starts with its first word, no character is replaced, moved or added, and lines are not justified in this mode. Rule 1 holds exactly as before; the canonical text of the output equals the canonical text of the input (`test/gaps.test.js`; every example is read back from the PDF with MuPDF and compared).

`fit` then searches the largest line height at which the text fits *the ink segments*; it is smaller than in the plain layout (the glyphs get smaller, the page has more rows, so the picture is resolved better). If the text does not fit them even at the smallest line height (for example on a blank picture), the plain layout is kept.

`options.gaps` is `'off'` (library default: photos keep their mid-tones), `'on'` or `'auto'`. One-pagers with a title card use `'auto'`: the gap layout is used when the plain layout has at most `SPARSE_LINES` (100) lines, that is when the picture would be resolved by fewer than a hundred rows; above that the plain layout is already fine and is kept unchanged (measured: PEP 8 with 167 lines and the Grundgesetz are bit-identical before and after). One-pagers with a motif photo always use `'off'`.

Cost: the type is smaller (the one-pager examples of 3 000 characters go from 6.6 mm to about 1.5 to 3 mm line height) and every gap starts a new text run, so the PDF is up to 50 % larger for the shortest texts (see `examples/*/check.json`). The text is still read from the text layer; at this size it is read by zooming, not at print size.

## 5. Fitting (`fit`)

A binary search finds the largest line height at which the whole text fits the area, then rounds it down to a multiple of 1/64 px (stepping further down in the rare case where the rounded height does not fit, because glyph widths follow the chosen weights). If the text does not fit even at 3 px, the sheet grows downwards instead of dropping characters.

## 6. Colour (`color.js`)

In photo-colour mode, each glyph's ink is chosen so that ink and visible paper average to the photo colour of its cell:

```
ink = paper + (target − paper) / coverage
```

If that leaves the RGB cube, the vector towards the paper is shortened as a whole, which keeps the hue. A legibility cap keeps ink colours apart from the paper.

## 7. Output (`render.js`)

Lines are justified by distributing the remaining width over their inner spaces. That moves every glyph after the first space to the right, at the end of a line by a median 1.5 em and up to 5 % of the width (measured on the Swiss constitution one-pager). So once a line's words are fixed, its glyphs are chosen again at their justified positions, twice because the new widths change the spacing slightly, and the line's error is passed on from those positions (`settle` in `src/layout.js`). Without this, vertical edges frayed by several letters and colours slipped at the ends of lines.

A repeated character starts at least 0.12 of its own size after the previous one (`REPEAT_GAP`). PDF extractors treat a glyph that repeats the previous character closer than 0.1 em as a "fake bold" duplicate and drop it (MuPDF, `stext-device.c`); a tiny *l* followed by a large *l* lost a letter that way. HTML uses one span per run of equally styled glyphs; SVG uses `tspan`s that are positioned explicitly after every space. Both keep the characters in reading order, which is what makes rule 2 of the technique hold.

## PDF at physical size, always one page

The CLI prints the sheet as HTML in headless Chrome (`Page.printToPDF`) at its physical size. Chrome embeds the variable-font instances as Type 3 fonts and keeps every glyph as text.

Chrome prints a few hundred thousand glyphs per page in about a minute, but did not finish a 1.2-million-glyph page within 50 minutes. Large sheets are therefore printed in strips of at most about 220 000 glyphs and assembled onto **one page** by `cli/pdf-assemble.js` (a MuPDF script): each strip becomes a Form XObject at its offset, vectors, fonts and text layer unchanged, strips in reading order. PDF pages may be up to 5080 mm per side.

Details that keep the result exact:

- Chrome rounds page sizes (measured up to 0.22 mm off, and 210 mm became 209.89 mm). Each strip is printed 2 mm taller than its content, and the assembly keeps exactly the content height, placed at the exact cumulative offset; every PDF goes through the assembly, so an A4 one-pager is 210 × 297 mm. The last strip reaches down to the sheet's full height even when the text ends a few lines higher.
- Every strip is read back with MuPDF before it is used. Chrome (measured with version 154) sometimes leaves single glyphs out of a large print job, depending on the text printed before them in the same job; a strip that lost anything is split in half and printed again, down to single lines.
- No content stream may have more than 1 800 000 tokens: pypdf, behind many AI document loaders, stops reading a stream at 2 000 000 and silently drops the rest. Strips above that are split as well (`cli/pdf-tokens.js`).
- Line heights are rounded down to a multiple of 1/64 px, the unit browsers store layout positions in, so no renderer has to round them.

Checked on a 1 m poster printed once directly and once from four assembled strips: same page size, identical text layer (SHA-256). The images agree within less than a millimetre per line; the remaining difference was measured but not fully explained.

Read the text back with MuPDF (`mutool draw -F txt`). Poppler's `pdftotext` keeps only 50 000 characters smaller than 3 × 3 units per page at its default resolution (see `docs/ai-readability.md`).

Afterwards the PDF is made smaller without visible change: `cli/pdf-slim.js` rounds the Type 3 glyph outlines to whole units of their 1000-unit grid, and qpdf repacks the file. Chrome's accessibility tags are left out: they were one empty `/NonStruct` element per style run. Measurements in `docs/file-size.md`.

## Measuring quality

`scripts/legibility.mjs` + `scripts/legibility.py` measure how well the title of a one-pager can be read: the preview is shrunk to 300 px, compared with the title card it was set to (Pearson correlation of brightness, sharp and blurred 1.2 px), and tesseract tries to read the title from a thumbnail. Correlation is a rough proxy: it improves from about 0.45 to 0.62 (blurred 0.65 to 0.85) for the short examples; OCR on thumbnails reads the title in some, not all, cases, so look at the images too.

- **Fidelity**: `isFaithful(sheet)` compares the set text with the source.
- **Tone fidelity**: Pearson correlation between target tone and achieved coverage over all glyphs (`toneFidelity`). Error diffusion lowers it locally on purpose, so treat it as a rough indicator.
