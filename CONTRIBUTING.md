# Contributing to Typographics Art

Thanks for helping. Contributions of every size are welcome: a typo fix, a translation, a new font, a better algorithm, an artwork for the gallery.

## Ground rules

- Changes must keep the [three rules of the technique](docs/technique.md). The test suite checks fidelity; please keep it green.
- No runtime dependencies and no build step. The library is plain ES modules so anyone can read and run it.
- Pure logic goes into the pure modules (`layout`, `tone`, `color`, `render`, `typeset`) with tests. Only code that needs a DOM goes into `browser.js` or `index.html`.
- English for code, comments, commits and docs. Issues and discussions may also be in German.

## Workflow

1. Open an issue first for anything larger than a small fix, so we can agree on the approach.
2. Fork, create a branch, make your change.
3. Run `npm test` and try the app with `npm run dev`. If you touch rendering, also run `npm run gallery` (needs Chrome/Chromium) and look at the results.
4. Open a pull request using the template. Describe what changed and how you checked it; for visual changes, add a before/after screenshot.

## Ideas we would love help with

- Scripts beyond Latin (CJK, Arabic, Devanagari). Typographics Art sets with one typeface, Roboto Flex (decided 2026-10-17: more families gave larger PDFs and no better picture, see docs/file-size.md); a second family should only come for a script Roboto Flex lacks.
- Width axis: off by default (measured: no visible gain, +12 % file size). A better cost model could make it pay off.
- Stronger shape awareness: the current ink-profile weighting helps little (measured −0.4 % edge error); comparing rendered candidates with the image could do much better.
- PDF export directly in the browser (today: print dialog, or the CLI).
- More gallery motifs and works.
- AI readability benchmarks: more vision-language models, whole pages, other scripts (see docs/ai-readability.md).

## Adding a font

Add an entry to `src/fonts.js` with its CSS family, weight range, variation settings and Google Fonts family string, and add it to the font selector in `index.html`. The font must be available under an open licence.

## Reporting security issues

See [SECURITY.md](SECURITY.md).
