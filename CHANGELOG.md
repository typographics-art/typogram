# Changelog

## 0.1.0 (unreleased)

First public version.

- Library: glyph measurement, tone map, error-diffused setting with lookup tables, size coherence, word mode, photo colour with hue-preserving gamut mapping, dark paper.
- Output: HTML, SVG (text kept as characters), PNG.
- App at typographics-art.org: presets, four variable fonts, Lorem ipsum filler up to 60 000 characters, photo overlay, English and German.
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
- Demonstrator: the complete *Moby-Dick* as a 2 × 3 m poster in three panels, with SVG master, print PDF as a single page, zoom viewer with "text at this spot", and a generated proof report (`demo/moby-dick/`).
- Print-ready PDFs at physical size: `--print-width <mm>` on the CLI, always one page (up to 5.08 m per side). Large sheets are printed in strips and assembled onto one page with MuPDF (`cli/pdf-assemble.js`); the Moby-Dick poster is a single 2000 × 2981 mm page.
- Line heights are multiples of 1/64 px, so browsers place every line exactly where the layout puts it.
- One-pagers (`cli/onepage.mjs`): a whole PDF or text file on one page, its title formed by the text; ten examples in `examples/` (laws of CH, DE, US and the EU, the UDHR, PEP 8, AI agent instructions), each read back and checked.
- Fix: glyphs are grapheme clusters, not code points. Letters with combining accents, emoji sequences and syllables of complex scripts stay one unit; before, separate marks could be dropped from PDF text layers (found with PEP 8's "Zalgo" example).
- Visible-character checks ignore all Unicode default-ignorable characters (soft hyphens, direction marks), which PDF text layers do not carry; exact equality is still reported separately.
- Picture one-pagers: `--motif <image>` forms a picture above the title (Swiss constitution with the 1874 lithograph, US Constitution with Hintermeister's 1925 painting, EU AI Act with a motif drawn for the project); the original images are in `examples/motifs/` with sources and licences.
- Smaller PDFs: every printed PDF is repacked losslessly with qpdf when that makes it smaller (Basic Law one-pager 7.1 → 1.4 MB); colours can be rounded with the `colorStep` option (one-pagers: 24).
- File sizes are published honestly: `examples/README.md` lists original and one-pager size for every example and explains why one-pagers grow.
- Main domain: typographics-art.org.
- Finding: Poppler's `pdftotext` drops letters from Chrome's Type 3 fonts in light passages of large PDFs; MuPDF extracts the same files exactly. The proof uses MuPDF.
- Definition of the technique in `docs/technique.md`.
