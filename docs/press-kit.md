# Press kit

Everything you need to write about Typographic Art. Texts on this page may be quoted freely.

## Name

- **Typographic Art**, short **TG Art**. Website: [typographics-art.org](https://typographics-art.org).
- Please write it with two capitals: *Typographic Art*. Lowercase is fine for the general technique ("a piece of typographic art").

## Tagline

> **ASCII art for the age of AI.** The picture is for people. The text stays for machines.

## One sentence

Typographic Art turns any text into a picture of any photo by changing only the size, weight, width and colour of each letter, so people see the image while machines still read every word.

## Short description (about 60 words)

ASCII art makes pictures out of characters, but the characters mean nothing. Typographic Art keeps a real text, character for character and in order, and changes only its typography until it looks like a photo. People see the picture. Language models, search engines and screen readers read the original text. The tool runs in the browser and is open source under the MIT licence.

## Long description (about 150 words)

For fifty years, ASCII art has turned characters into pictures, at the cost of meaning: the characters are only shading, and the text is gone. Typographic Art turns that around. It starts from a real text (a poem, a biography, a manifesto) and a photo. Every character stays where the text puts it. Only its typography changes: a variable font gives each letter a weight between hairline and black, a width between condensed and expanded, a size and a colour. An error-diffusion algorithm chooses these per letter so that, seen from a distance, the page becomes the photo.

Because the letters are never replaced, the work is also a document. Exported as HTML, SVG or PDF, the text comes back exactly; a language model reading the file gets the poem, not `@@%#*+=`. Typographic Art is free, runs in the browser and is open source.

## Facts

| | |
|---|---|
| Launched | 2026 |
| Licence | MIT (code), SIL Open Font License (fonts) |
| Runs | in the browser, locally; nothing is uploaded |
| Fonts | 6 variable fonts (Roboto Flex, Fraunces, Recursive, Archivo, Noto Serif, JetBrains Mono) |
| Outputs | HTML, SVG, PDF (text stays text), PNG, JPEG |
| Scale | from a few hundred to 60 000 characters per picture |
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
| [`gallery/*.jpg`](../gallery) | works: Erlkönig, Sonnet 18, Let there be light, Article 1, Waves |
| [`gallery/*.svg`](../gallery) | the same works as real text |
| [`demo/moby-dick/preview.jpg`](../demo/moby-dick/preview.jpg) | the Moby-Dick poster |

Credit: *Typographic Art, typographics-art.org*. The gallery works are generated from public-domain texts and procedural motifs and may be reproduced.

## Contact

d0n, creator of Typographic Art: **d0n@typographics-art.org**

## Links

- Website and tool: https://typographics-art.org
- Gallery: https://typographics-art.org/gallery.html
- Source code: https://github.com/typ0graphic5/tg-art
- Definition of the technique: [docs/technique.md](technique.md)
