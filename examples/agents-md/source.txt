# AGENTS.md: instructions for AI coding agents working on Typographics Art

This file tells AI agents (and humans) how to work in this repository. Read it before changing anything.

## The project in one paragraph

Typographics Art sets a given text, character for character and in order, so that only the typography of each glyph (weight, width, size, colour) changes and the page forms a picture. The text must stay real, extractable text. The three rules in `docs/technique.md` are the contract of the project; no change may break them.

## Layout

- `src/`: the library. Pure modules (`layout.js`, `tone.js`, `color.js`, `render.js`, `typeset.js`, `fonts.js`, `options.js`, `lorem.js`) run in Node and browsers. `browser.js` needs a DOM: font measurement, image reading, PNG output.
- `index.html`, `gallery.html`: the web app and gallery for typographics-art.org.
- `cli/`: command-line tools that drive headless Chrome over the DevTools protocol (`core.mjs`, `render.html`), the renderer `tg-art.mjs`, the one-pager `onepage.mjs`, gallery and asset builders.
- `demo/moby-dick/`: the demonstrator (whole book as a poster) with its proof report.
- `examples/`: one-pagers of laws, declarations and AI instructions.
- `test/`: Node's built-in test runner, no dependencies.

## Rules

1. **No runtime dependencies and no build step.** Plain ES modules only. CDN scripts in pages must be pinned to an exact version with a Subresource Integrity hash.
2. **Fidelity is tested, not assumed.** Any change to layout, rendering or export must keep `isFaithful()` true and the text extractable from HTML, SVG and PDF. Add or update a test in `test/` for every behaviour change.
3. **Pure logic stays pure.** New algorithms go into the pure modules with tests that run under `node --test`. Only code that needs a DOM goes into `browser.js`, `cli/render.html` or the pages.
4. **Measure before claiming.** Numbers in the documentation (fidelity, OCR rates, timings) must come from a script or test in this repository. Update them when the code changes.
5. **Keep outputs honest.** Generated reports must state their method and limits. Never hide instructions in tiny text: a one-pager always shows its title, and its full text must be the declared document.
6. **English** for code, comments, commits and documentation; German translations live in `README.de.md` and the app's dictionary.

## Commands

```sh
npm test                               # all tests, under a second
npm run dev                            # app at http://localhost:8080
node cli/tg-art.mjs img.jpg --text t.txt -o out.pdf
node cli/onepage.mjs doc.pdf --title "Title" -o onepage.pdf
npm run gallery                        # re-render gallery (needs Chrome)
node examples/build.mjs                # re-render examples (needs Chrome and MuPDF; qpdf optional, shrinks the PDFs)
```

## Before you open a pull request

- `npm test` passes.
- For visual changes: render at least one gallery work or example and look at it.
- The changelog has an entry if users will notice the change.
- The pull request says what changed and how you checked it.
