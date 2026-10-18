# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Security

- **Two internal adversarial reviews of the cryptographic code** by two different AI models, blind to each other (not independent audits): [docs/security-review-internal-2026-10.md](docs/security-review-internal-2026-10.md) and [docs/security-review-internal-2026-10-b.md](docs/security-review-internal-2026-10-b.md). Known-answer tests of every building block (`test/known-answer.test.js`), differential tests against independent re-implementations, a deterministic fuzzer (`scripts/fuzz-crypto.mjs`), local Semgrep rules, hostile-data checks in the browser test. Fixed: quadratic regular expressions in the YAML, Markdown, XML and text-structure readers; the encoder wrote data blocks the decoder refused (a sealed record of one never opened); damaged workbooks, unknown model shapes, long `tg1.` secrets and sparse sheets failed with raw errors; an error message went into markup on the generator page.

## [0.1.0] - 2026-10-18

First public version.

### Added

- **Library** (`src/`): glyph measurement, tone map, error-diffused setting with lookup tables, size coherence, letter and word mode, photo colour with hue-preserving gamut mapping, light and dark paper, shape-aware targets, panels (`typesetSections`: one continuous text across several images at a single type size). Output as HTML, SVG (text kept as characters) and PNG. Ligatures and kerning are switched off in every output, so PDF text layers stay exact. One typeface, Roboto Flex; the width axis is an optional extra and off by default.
- **Command line** (`cli/`): `tg-art.mjs` renders SVG, HTML, PDF (with a real text layer), PNG and JPEG through headless Chrome, without dependencies; `--print-width <mm>` makes print-ready single-page PDFs up to 5.08 m per side. Every printed strip is read back and compared; PDFs are assembled by MuPDF to their exact paper size and repacked losslessly with qpdf when that makes them smaller.
- **Generator** at typographics-art.org (`app.html`): presets, Lorem ipsum filler up to 60 000 characters, 28 sample texts, photo overlay, a "what the AI reads" panel, a font-cuts slider with the expected PDF size, English and German. Text and photo stay in the browser.
- **Hidden messages**: a key (a book cipher over the work's public text, random positions, SHA-256 text fingerprint) hides a message without changing the work. `cli/tg-secret.mjs hide|reveal` for PDF, SVG, HTML and text; the panel *Hidden message* in the generator, with suggestions of sample texts that contain the needed characters; `hideSecret` and `revealSecret` in the library. Documented in `docs/hidden-messages.md`.
- **Structured data** (`cli/tg-data.mjs`, [docs/structured-data.md](docs/structured-data.md)): spreadsheets and data files become TGD 1.0, a whitespace-proof text block that goes through a work and decodes back with a checksum. **Sealed data** (`cli/tg-crypt.mjs`, [docs/encrypted-data.md](docs/encrypted-data.md)): AES-256-GCM with a key that fits one work, and compact lossless key formats.
- **Data in the browser** (`app#data`, `work.html`): the generator's panel *Data in this work* attaches an `.xlsx`, `.csv`, `.tsv`, `.json`, `.md`, `.yaml`, `.xml`, `.ics` or `.vcf` file (file button, drag and drop, or one of two samples in `samples/data/`), previews it, warns about what the format loses and how much of a page it takes, and writes it into the work's text (read back and checked) or seals it (key and `tgs1.` record, copy and download); *Save SVG* and *Save HTML* download the work. The Machine view shows data blocks as tables with sheet tabs, column types and a verified checksum, downloads them as the original format, `.csv`, `.json` or `.xlsx` (formula guard on by default), and opens sealed data with a key; a work file can be opened from the computer. Every error is shown under the action that caused it, in English and German. Nothing is uploaded; end-to-end check: `scripts/check-web-data.mjs`.
- **Passwords explained** ([docs/passwords-and-keys.md](docs/passwords-and-keys.md), German [docs/passwords-and-keys.de.md](docs/passwords-and-keys.de.md)): the password rule with the numbers, three recommended setups, what is not promised, how to check it.
- **Key management** (`src/keys*.js`, [docs/key-management.md](docs/key-management.md), [docs/cipher-review.md](docs/cipher-review.md)): master and per-record keys from one seed (BIP-39, SLIP-21), recipient sealing (X25519), hidden work binding, XOR and Shamir splitting, a 2-of-3 vault, Argon2id (vendored `@noble/hashes`). A password is never the only secret of a public record; AES-256-GCM is kept.
- **Three views of a work** (`work.html`): *Art* to recognise the picture, *Read* to read and search the full text, *Machine* for structured text with source, sections and a checksum over the canonical text.
- **One-pagers** (`cli/onepage.mjs`): a whole PDF or text file on one page, its title (or, with `--motif`, a picture above it) formed by the text. 31 examples in `examples/` (laws of Switzerland, Germany, the US and the EU, the Universal Declaration of Human Rights, PEP 8, AI agent instructions, an agent library), each with its published source text, each read back and compared with the source. One type size and no width variants by default; `--weights 2` makes them smaller still.
- **Gallery** of 15 works from public-domain photographs and paintings, each set from a matching public-domain text (the Universal Declaration of Human Rights, a UN text, in full), without filler; every work can be switched to its original image. Reproducible with `npm run gallery`; submissions through an issue template.
- **Moby-Dick poster** (`demo/moby-dick/`): the complete novel (1.2 million characters) as a 2 × 3 m poster in three panels, with SVG master, print PDF as a single page, zoom viewer with "text at this spot" and a generated proof report.
- **Paid one-pager API** (`api/`, live at api.typographics-art.org): send a document and the hash of a DigiByte transaction, no account and no API key; the picture is drawn by an image model. This is the only place where a document is uploaded.
- **AI readability, measured** (`docs/ai-readability.md`, `docs/ai-benefit.md`): text recovery from HTML, SVG and PDF text layers, OCR, a first vision-language-model sample, and which PDF extractors read a one-pager completely (`scripts/extractor-check.py`). Poppler's `pdftotext` keeps only the first 50 000 characters smaller than 3 × 3 units per page; MuPDF, PyMuPDF, pdfminer.six and pypdf read all ten core examples completely.
- **File size, measured** (`docs/file-size.md`): where the bytes of a PDF go and what can be removed without visible change: glyph outlines rounded to whole units (−22 %), Chrome's empty accessibility tags left out (−12 % and −16 % on two examples), lossless qpdf repack.
- **For AI assistants**: `about/typographics-art.md` (also served as `/llms-full.txt`), the same text as a one-pager `about/typographics-art.pdf`, `llms.txt` and `AGENTS.md`.
- Definition of the technique (`docs/technique.md`), algorithm (`docs/algorithm.md`), text fidelity (`docs/text-fidelity.md`), prior art, press kit, English and German README.
- Tests with Node's built-in runner (`npm test`), no dependencies.

### Fixed

Defects found while measuring, all fixed before this release:

- Ligatures dropped letters in Chrome's PDF text layer ("officia" became "offcia").
- Glyphs are grapheme clusters, not code points: letters with combining accents, emoji sequences and syllables of complex scripts stay one unit.
- Justification moved letters away from where their tone was taken; each finished line is now re-chosen at its justified positions.
- Repeated letters keep at least 0.12 em distance; MuPDF drops a glyph that repeats the previous character closer than 0.1 em.
- Chrome sometimes leaves single glyphs out of a large print job; a print strip that lost anything is split and printed again.
- pypdf reads at most 2 000 000 tokens per content stream; print strips are split until every stream stays below 1 800 000.
- One-pagers have their exact paper size (A4 = 210 × 297 mm).
- Line ends in the web generator no longer wander at small type sizes.
