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
- Print-ready PDFs at physical size: `--print-width <mm>` on the CLI, always one page (up to 5.08 m per side). Large sheets are printed in strips and assembled onto one page with MuPDF (`cli/pdf-assemble.js`); the Moby-Dick poster is a single 2000 × 2979 mm page.
- Line heights are multiples of 1/64 px, so browsers place every line exactly where the layout puts it.
- One-pagers (`cli/onepage.mjs`): a whole PDF or text file on one page, its title formed by the text; ten examples in `examples/` (laws of CH, DE, US and the EU, the UDHR, PEP 8, AI agent instructions), each read back and checked.
- Fix: glyphs are grapheme clusters, not code points. Letters with combining accents, emoji sequences and syllables of complex scripts stay one unit; before, separate marks could be dropped from PDF text layers (found with PEP 8's "Zalgo" example).
- Visible-character checks ignore all Unicode default-ignorable characters (soft hyphens, direction marks), which PDF text layers do not carry; exact equality is still reported separately.
- Picture one-pagers: `--motif <image>` forms a picture above the title (Swiss constitution with the 1874 lithograph, US Constitution with Hintermeister's 1925 painting, EU AI Act with a motif drawn for the project); the original images are in `examples/motifs/` with sources and licences.
- Smaller PDFs: every printed PDF is repacked losslessly with qpdf when that makes it smaller (Basic Law one-pager 7.1 → 1.4 MB); colours can be rounded with the `colorStep` option (one-pagers: 24).
- File sizes are published honestly: `examples/README.md` lists original and one-pager size for every example and explains why one-pagers grow.
- Fix: glyphs take tone and colour where they are drawn. Justification widens the spaces after a line is set, which moved letters up to 5 % of the width (median 1.5 em) away from where their tone was taken; vertical edges frayed and colours slipped at line ends. Each finished line is now re-chosen at its justified positions (`settle` in `src/layout.js`), with a test.
- Fix: repeated letters keep at least 0.12 em distance. MuPDF (and so PyMuPDF) drops a glyph as "fake bold" when it repeats the previous character closer than 0.1 em; a tiny "l" before a large "l" lost a letter in extraction. Test included.
- Fix: Chrome sometimes leaves single glyphs out of a large print job (measured with Chrome 154, depending on the text printed before them in the same job). Every print strip is now read back and compared; a strip that lost anything is split and printed again.
- Smaller PDFs without visible change: glyph outlines rounded to whole units (`cli/pdf-slim.js`, −22 %), Chrome's accessibility tags left out (they were one empty `/NonStruct` element per style run, −9 %).
- Font cuts: `weightCount` and `sizeCount` options, the slider "Font cuts" in the app and `--weights` in `cli/onepage.mjs` limit the number of weights; the app shows the expected PDF size (`pdfStats`, `estimatePdfBytes`, within 3 % on 18 measured pages). Measurements in `docs/file-size.md` (`scripts/size-study.mjs`, now with a likeness measure against the target picture).
- One-pagers use one type size and no width variants by default. Measured: Chrome embeds a font per weight × width × size, and mixed sizes made streaks; with one size the Swiss constitution follows its picture more closely (likeness 0.963 instead of 0.940) at 1.65 MB instead of 4.54 MB.
- Gallery: seven works from public-domain photos and paintings (Earthrise, The Blue Marble, The Starry Night, The Great Wave, Lincoln, Mona Lisa, Darwin) with matching texts and no filler; every work can be switched to its original image.
- Gallery: the five early procedural works are replaced by photo works; now 15 public-domain images with matching texts (new: Pillars of Creation · H. G. Wells, The Wanderer · Nietzsche, Red Fuji · Lafcadio Hearn, Frederick Douglass, Mark Twain, Edgar Allan Poe, Nikola Tesla, John Herschel), no filler; `node cli/build-gallery.mjs <id>` rebuilds single works.
- README: new intro picture (works with their originals as insets, `scripts/build-intro.py`) and a wordmark made with our own image model (Qwen-Image 2.1), light and dark.
- Everything about the project in one file for AI assistants: `about/typographics-art.md` (also `/llms-full.txt`) and the same text as a one-pager `about/typographics-art.pdf` (`scripts/build-about.mjs`); download box on the website.
- Agent library (German): a knowledge and task library for AI agents in `examples/agent-library/` — knowledge guide, eight rule files, ten task families with 49 prompts in a fixed eight-field format — and 21 one-pagers of it, including the whole library (226 524 characters) on one page.
- One typeface: Roboto Flex only (operator decision). The font menu, the width checkbox and `--font` are gone; defaults are one type size and no width variants, all weights. The gallery is re-rendered with it and is sharper.
- Fix (web generator): line ends wandered by up to 15 px in desktop browsers at small type, which round glyph widths at tiny sizes; the view is now laid out at about the measuring size (40 px) and scaled down for display.
- Hidden messages: a key (book cipher over the work's public text, random positions, SHA-256 text fingerprint) hides a message without changing the work; `cli/tg-secret.mjs hide|reveal` for PDF/SVG/HTML/text, panel *Hidden message* in the web generator, `hideSecret`/`revealSecret` in the library.
- Paid one-pager API (`api/`, live at api.typographics-art.org): document plus DigiByte transaction hash, no API key; picture from our image model.
- CI: tests run by file glob; Node 22 took `node --test test/` as a module path.
- Fix: pypdf read only 56 % of the EU AI Act one-pager: it stops at 2 000 000 tokens per content stream. Print strips are now split until every stream stays below 1 800 000 (`cli/pdf-tokens.js`).
- Fix: one-pagers have their exact paper size (A4 = 210 × 297 mm; before 209.89 × 293.9–297.0 mm). The last strip reaches the sheet's full height and every PDF is assembled by MuPDF, which is now required for PDF output.
- Main domain: typographics-art.org.
- Finding (corrected): Poppler's `pdftotext` keeps only the first 50 000 characters smaller than 3 × 3 units per page (its "tiny chars" limit) and drops the rest; one-pagers above that lose most of their text with it, `-r 600` raises the threshold. Earlier this was blamed on Chrome's Type 3 fonts, which was wrong. MuPDF, PyMuPDF, pdfminer.six and pypdf read all ten examples completely (`scripts/extractor-check.py`).
- Definition of the technique in `docs/technique.md`.
