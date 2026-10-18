# Press kit

Everything you need to write about Typographics Art. Texts on this page may be quoted freely.

## Name

- **Typographics Art**, short **TG Art**. Website: [typographics-art.org](https://typographics-art.org).
- Please write it with two capitals: *Typographics Art*. Lowercase is fine for the general technique ("a piece of typographics art").

## Tagline

> **Stationery for the AI age.** A document a person recognises at a glance, and a machine reads exactly as shown.

## One sentence

Typographics Art is a document format where a person sees at a glance what something is and who it is from, and a machine provably reads exactly what the person sees.

## Short description (about 60 words)

Letterhead, a signature and a seal have shown for centuries what a paper is and who it is from. Typographics Art brings that to the AI age: a real text, kept character for character and in order, is set so that it also forms a picture — a document a person recognises at a glance, and a machine reads exactly as shown. Free, in the browser, open source (MIT).

## Long description (about 150 words)

Most things we publish for machines are either a picture that hides its words or a wall of text with no face. Typographics Art is both at once, in three layers. The **document**: a real text — a poem, a law, agent instructions — kept character for character and in order, as Markdown with a few required fields, stable sections, hashes and a version chain. The **provenance**: keys on domains, signatures and a visible seal, with a verify tool, so a reader can check who issued a text and that it is unchanged; keys will be anchored in public transparency logs, optionally in Bitcoin via OpenTimestamps (shipping in this release). The **picture**: each letter's typography is tuned until the page becomes a photo, so a person recognises the document without reading the spec — a seal on an envelope needs no explanation.

It is a possibility, not a guarantee, and no replacement for PDF; but letterhead, signature and seal, translated into a format a machine can check, did not exist before. Free, in the browser, open source.

## Facts

| | |
|---|---|
| Launched | 2026 |
| Licence | MIT (code), SIL Open Font License (fonts); third-party credits in [NOTICE.md](../NOTICE.md) |
| Privacy | text and photo are processed in the browser and never uploaded; the site loads no third-party resources. Exported SVG/HTML files reference the font stylesheet on typographics-art.org; PDFs embed their fonts. The paid API is the one place where a document is uploaded |
| Font | One variable font: Roboto Flex, weights 100–1000 (one family keeps PDFs small; weight carries the picture) |
| Outputs | HTML, SVG, PDF (text stays text), PNG, JPEG |
| Scale | in the app up to 60 000 characters; the CLI has no fixed limit (the Moby-Dick poster has 1.2 million) |
| Languages | English, German |

## Measured machine readability

From [docs/ai-readability.md](ai-readability.md), measured 17 October 2026:

- HTML and SVG: the text comes back **100 % exact** at every setting.
- PDF text layer in stored order: **100 % exact**.
- Only the image, classic OCR (Tesseract 5.5): **about 99 %** of the words at the highest legibility.
- Only the image, a vision-language model (first sample, 217 words): **100 %**, even at the most artistic setting.

## Demonstrator

The complete text of *Moby-Dick* (1.2 million characters) set as one 2 × 3 m poster in three panels, with a generated proof that every character survives and can be read back: https://typographics-art.org/demo/moby-dick/ (report: `demo/moby-dick/proof.md`).

## Images

| File | Use |
|---|---|
| [`assets/social.png`](../assets/social.png) (1280 × 640) | header image, link preview |
| [`assets/logo.png`](../assets/logo.png) (1200 × 300) | wordmark; each letter set in a heavier weight, the technique in one word |
| [`gallery/*.jpg`](../gallery) | the 15 works: Earthrise, The Blue Marble, The Starry Night, The Great Wave, Cooper Institute, La Gioconda, Endless forms, The Star, The Wanderer, Fuji-no-Yama, Learning to Read, The Boys' Ambition, The House of Usher, My Inventions, Preliminary Discourse |
| [`gallery/*.svg`](../gallery) | the same works as real text |
| [`demo/moby-dick/preview.jpg`](../demo/moby-dick/preview.jpg) | the Moby-Dick poster |

Credit: *Typographics Art, typographics-art.org*. The gallery works are set from public-domain texts over public-domain photographs and paintings (see [gallery/photos/README.md](../gallery/photos/README.md)) and may be reproduced.

## Contact

d0n, creator of Typographics Art: **d0n@typographics-art.org**

## Links

- Website and tool: https://typographics-art.org
- Gallery: https://typographics-art.org/gallery.html
- Source code: https://github.com/typographics-art/typogram
- Definition of the technique: [docs/technique.md](technique.md)
