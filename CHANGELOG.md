# Changelog

## 0.1.0 (unreleased)

First public version.

- Library: glyph measurement, tone map, error-diffused setting with lookup tables, size coherence, word mode, photo colour with hue-preserving gamut mapping, dark paper.
- Output: HTML, SVG (text kept as characters), PNG.
- App at tg-art.org: presets, four variable fonts, Lorem ipsum filler up to 60 000 characters, photo overlay, English and German.
- Width axis as an extra control (Roboto Flex), measured −6 % edge error on a hard-edged test image.
- Shape-aware targets: each glyph's target tone weighted by where its ink sits in the cell.
- PDF: print dialog in the app; the CLI writes PDFs with a real text layer.
- Command line tool `cli/tg-art.mjs` (SVG, HTML, PDF, PNG, JPEG) driving headless Chrome without dependencies.
- Gallery with five reproducible works (`npm run gallery`).
- `typeset()` now loads the font stylesheet itself; before, pages without it measured a fallback font silently.
- Ligatures and kerning switched off in all outputs: Chrome's PDF text layer turned "officia" into "offcia".
- Word mode gets the same size-coherence cost as letter mode.
- Measured AI readability (text layer, PDF extraction, OCR) in `docs/ai-readability.md`.
- Two more fonts with a width axis: Archivo (75–125 %) and Noto Serif (75–100 %). Width variants now also set `font-stretch`, because Google Fonts serves them as separate faces.
- "What the AI reads" panel in the app: shows the text exactly as machines receive it.
- First vision-language-model measurement (Claude, 217 words, 100 %).
- Brand assets: wordmark and social preview (`npm run assets`), Open Graph tags, press kit.
- Panels: `typesetSections` sets one continuous text across several images (one picture per part) at a single type size.
- Demonstrator: the complete *Moby-Dick* as a 2 × 3 m poster in three panels, with SVG master, print PDF in strips, zoom viewer with "text at this spot", and a generated proof report (`demo/moby-dick/`).
- Finding: Poppler's `pdftotext` drops letters from Chrome's Type 3 fonts in light passages of large PDFs; MuPDF extracts the same files exactly. The proof uses MuPDF.
- Definition of the technique in `docs/technique.md`.
