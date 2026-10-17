# Notice: third-party materials and credits

Typographics Art is published under the [MIT licence](LICENSE). That covers:

- the code (`src/`, `cli/`, `api/`, `scripts/`, `test/`, the HTML pages),
- the project's own texts (the documentation, the instruction texts written for this repository in `examples/`, the agent library),
- the project's own motifs (for example `examples/motifs/eu-ai-act-network.png`, drawn for the project) and `assets/` (wordmark, logo, social image),
- the code-generated gallery and example files, as far as they are the project's own output. They contain third-party texts and are not a licence for those texts: see below.

Artworks submitted through the issue template (`.github/ISSUE_TEMPLATE/artwork.yml`) are shown on typographics-art.org under **CC BY 4.0**, as the submitter agrees when sending them.

Everything below keeps its own licence.

## Software and fonts shipped with the site

| Material | Version | Licence | Where |
|---|---|---|---|
| Roboto Flex (variable font) | current Google Fonts release | SIL Open Font License 1.1, Copyright the Roboto Flex Project Authors | `assets/fonts/` (self-hosted); embedded in generated PDFs |
| IBM Plex Mono | current Google Fonts release | SIL Open Font License 1.1, Copyright IBM Corp. | `assets/fonts/` (self-hosted); used in the website's interface |
| pdf.js | 4.4.168 | Apache-2.0 | reading PDF text in the browser (page `work.html`, `src/work-text.js`) |
| OpenSeadragon | 4.1.0 | BSD-3-Clause | zoom viewer of the Moby-Dick poster (`demo/moby-dick/`) |

The fonts' own licence texts, with their exact copyright lines, are the files in `assets/fonts/`; they are authoritative where they differ from the short lines above. The SIL Open Font License allows use, embedding and redistribution, including in PDFs and SVG/HTML exports, but not selling the fonts on their own.

## Tools used, not shipped

These programs are called as separate programs by the scripts and the CLI. They are not part of this repository and are not linked into it.

| Tool | Licence | Used for |
|---|---|---|
| Chromium / Google Chrome | BSD-3-Clause and others (Chromium); Chrome: proprietary | rendering and printing (`cli/`) |
| MuPDF (`mutool`) | AGPL-3.0 or commercial | reading PDF text, assembling print strips |
| qpdf | Apache-2.0 (earlier versions Artistic-2.0) | lossless repacking of PDFs |
| Tesseract | Apache-2.0 | OCR measurements (`scripts/ai-benefit.mjs`) |

## Photographs and paintings of the gallery

The originals behind the 15 gallery works are public domain. Credits and Wikimedia Commons record for every file: [gallery/photos/README.md](gallery/photos/README.md).

## Texts

- **Gallery works:** every text is a contiguous passage of a public-domain work (sources named in [gallery/works.config.json](gallery/works.config.json)), except the Universal Declaration of Human Rights, which is set in full for *The Blue Marble*. It is a United Nations text that the OHCHR states is freely reproducible; it is not in the public domain in the strict sense. The King James Bible (*Earthrise*) is public domain in the United States; in the United Kingdom it is under a Crown patent.
- **One-pager examples:** the source documents are laws, declarations and technical documents with their own licence terms. The licence of each is listed in the table of [examples/README.md](examples/README.md) and in [samples/index.json](samples/index.json); the source texts are published in each example's folder.
- **Moby-Dick** (`demo/moby-dick/source.txt`): Herman Melville, *Moby-Dick* (1851), from Project Gutenberg eBook #2701, public domain; the Project Gutenberg header and licence boilerplate are stripped.
- **Sample texts for the generator** (`samples/`): copies of the gallery texts and example sources above, with the same licences; `samples/index.json` gives source and licence for each.
- **Motifs of the one-pagers:** sources and licences in [examples/motifs/README.md](examples/motifs/README.md).
