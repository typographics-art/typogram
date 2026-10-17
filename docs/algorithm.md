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

## 5. Fitting (`fit`)

A binary search finds the largest line height at which the whole text fits the area. If the text does not fit even at 3 px, the sheet grows downwards instead of dropping characters.

## 6. Colour (`color.js`)

In photo-colour mode, each glyph's ink is chosen so that ink and visible paper average to the photo colour of its cell:

```
ink = paper + (target − paper) / coverage
```

If that leaves the RGB cube, the vector towards the paper is shortened as a whole, which keeps the hue. A legibility cap keeps ink colours apart from the paper.

## 7. Output (`render.js`)

Lines are justified by distributing the remaining width over their inner spaces. HTML uses one span per run of equally styled glyphs; SVG uses `tspan`s that are positioned explicitly after every space. Both keep the characters in reading order, which is what makes rule 2 of the technique hold.

## PDF

The CLI loads the standalone HTML in headless Chrome and calls `Page.printToPDF` with the sheet's exact size. Chrome embeds the fonts and keeps every glyph as text, so `pdftotext` returns the source.

## Measuring quality

- **Fidelity**: `isFaithful(sheet)` compares the set text with the source.
- **Tone fidelity**: Pearson correlation between target tone and achieved coverage over all glyphs (`toneFidelity`). Error diffusion lowers it locally on purpose, so treat it as a rough indicator.
