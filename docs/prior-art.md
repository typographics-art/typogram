# Prior art, and what is actually new

Typographics Art did not appear from nothing. Making a picture out of text, and even out of *tiny legible* text, is old. Being precise about that is more honest — and more useful — than a broad claim of novelty. Here is where it stands.

## Ancestors

- **Micrography** (Hebrew *masorah*, from about the 9th century). Whole passages of scripture written in minute script that forms geometric patterns, animals and portraits. This is the closest ancestor: the text forms the picture **and stays readable**. The difference here is mechanical — the picture's tones come from measured per-letter typography computed from a photo, in a normal reading layout, rather than from a scribe hand-steering the text along a drawn shape.
- **Calligrams and concrete / visual poetry** (Apollinaire's *Calligrammes*, 1918, and much older shaped verse). Text is arranged *along a shape*, usually by hand. The outline is the image. Typographics Art keeps the text in an ordinary left-to-right, top-to-bottom block; the image comes from the weight, width, size and colour of each letter, not from the outline the text traces.
- **ASCII and ANSI art.** A grid of cells, each filled with the character that best matches the local tone. The characters are shading; the words are gone. Typographics Art inverts exactly this: the text fixes the characters, and only their typography is chosen. (See [the definition](technique.md).)
- **Typewriter art** and, later, **image-to-ASCII converters** (`jp2a`, `aalib`, …). Same idea as ASCII art, different tools: the output is texture, not text.
- **Microprinting** on banknotes and documents. Tiny lines of real, legible text used as a security feature. It shares the "small but readable" property, but it is a line of text, not a tone-rendered image.
- **Word clouds / Wordle-style layouts.** Words sized by frequency and packed into a shape. The size carries a statistic, not a picture's tone, and the reading order is destroyed. Typographics Art changes only typography and never the order.
- **"Text portraits" in design tools.** Fill a silhouette with text in a vector editor. In practice the text is usually repeated, placeholder, or stretched to fit, the reading order is not preserved, and nothing checks that it can be read back. Those are the properties this project makes central.

## What is new here

Not "a picture made of text" — that is ancient. The contribution is a specific, verifiable combination:

1. **A given text, set once, in reading order.** Not repeated, not placeholder, not reflowed along a shape. Grapheme by grapheme, start to finish.
2. **The picture comes only from per-letter typography** — weight, width, size, colour — fitted to a photo's tone with error diffusion, in a normal reading block.
3. **Machine-readability is verified, not assumed.** Every work is read back and compared to its source by checksum, and the text sits in the standard text layer of HTML, SVG and PDF, so a search engine, a screen reader or a language model receives the words. See [ai-readability.md](ai-readability.md) and [text-fidelity.md](text-fidelity.md).

Micrography already married a readable text to a picture by hand. ASCII art already turned images into glyphs by machine but threw the words away. Typographics Art is the machine version that keeps the words, in standard formats, with the fidelity written down and checkable.

## Honesty

This project does not claim to have invented setting text into a picture. It claims a particular, measured way of doing it for the age of machine readers, and it names its ancestors so you can judge for yourself.
