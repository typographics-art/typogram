# Contributing to Typographics Art

Thanks for helping. Contributions of every size are welcome: a typo fix, a translation, a better algorithm, an artwork for the gallery.

## Ground rules

- Changes must keep the [three rules of the technique](docs/technique.md). The test suite checks fidelity; please keep it green.
- No runtime dependencies and no build step for the library: it is plain ES modules so anyone can read and run it. The website needs `node scripts/build-site.mjs`, but only to deploy it.
- Pure logic goes into the pure modules (`layout`, `tone`, `color`, `render`, `typeset`) with tests. Only code that needs a DOM goes into `browser.js` or the pages (`app.html`).
- English for code, comments, commits and docs. Issues and discussions may also be in German.

## Workflow

1. Open an issue first for anything larger than a small fix, so we can agree on the approach.
2. Fork, create a branch, make your change.
3. Run `npm test` and try the generator with `npm run dev` (needs Python 3; open http://localhost:8080/app.html). If you touch rendering, also run `npm run gallery` (needs Chrome/Chromium) and look at the results. To build the whole website, first make the Moby-Dick zoom tiles with `node demo/moby-dick/build.mjs zoom` (needs Chrome, takes about 4 minutes, makes 522 tiles), then run `node scripts/build-site.mjs`; you only need this to deploy the site.
4. Open a pull request using the template. Describe what changed and how you checked it; for visual changes, add a before/after screenshot.

## Ideas we would love help with

- Scripts beyond Latin (CJK, Arabic, Devanagari). Typographics Art sets with one typeface, Roboto Flex: more families gave larger PDFs and no better picture (see docs/file-size.md). A second family is only accepted for a script Roboto Flex lacks.
- Width axis: off by default (measured: no visible gain, +12 % file size). A better cost model could make it pay off.
- Stronger shape awareness: the current ink-profile weighting helps little (measured −0.4 % edge error); comparing rendered candidates with the image could do much better.
- PDF export directly in the browser (today: print dialog, or the CLI).
- More gallery motifs and works.
- AI readability benchmarks: more vision-language models, whole pages, other scripts (see docs/ai-readability.md).

## Tools

- Node: library >= 20; CLI >= 22 (it needs the global `WebSocket`); API >= 22.5 (`node:sqlite`).
- Chromium or Chrome (`CHROME_PATH` if it is not found), MuPDF (`mutool`), qpdf.
- For specific scripts: pandoc and tesseract (`scripts/ai-benefit.mjs`); Python 3 with pypdf, pymupdf and pdfminer.six (`scripts/extractor-check.py`); Python 3 for `npm run dev`.

## Reporting security issues

See [SECURITY.md](SECURITY.md).
