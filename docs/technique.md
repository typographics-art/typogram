# Typographics Art: definition

**Typographics Art** (short **TG Art**) is the technique of forming a picture from a given text by setting that text character for character, in its original order, and varying only the typographic properties of each character.

It is the counterpart of ASCII art. ASCII art chooses *which character* fills each cell of a grid. Typographics Art keeps the characters the text dictates and chooses *how each one is set*.

## Rules

A work is Typographics Art when it follows all three rules.

### 1. Fidelity

- Every character of the source text appears exactly once, in reading order.
- No character is replaced, inserted, reordered or dropped.
- Whitespace may be normalised: runs of spaces, tabs and line breaks become a single space, and line breaks may fall at any space.
- Whitespace is layout, not text: a work may leave areas blank and widen the gap at a space (or indent a line) so that glyphs stand only where the picture needs ink. Only an existing space may grow; no character, not even a space, is inserted, and the normalised text stays identical.
- A word longer than a line may be broken between two characters. No hyphen is added.
- **Filler** (for example Lorem ipsum to reach a higher resolution) is allowed only when it is declared: it follows the source text, and the work states how many characters are filler.

### 2. Text stays text

- The work is published in a format that keeps the characters as text: HTML, SVG, or a PDF with a text layer.
- Extracting the text, by copy and paste, a screen reader or a program, yields the source text (rule 1 applies after whitespace normalisation).
- A raster export (PNG, JPEG) is a reproduction of the work, not the work itself.

### 3. Only typography varies

Per character, a work may vary:

- font size,
- font weight and other axes of a variable font (width, optical size, slant),
- typeface,
- colour and opacity,
- horizontal spacing (letter and word spacing), including wide gaps at spaces and indents that leave parts of the page blank.

It may not add shapes, strokes, backgrounds behind individual characters, or images. A single uniform paper colour is allowed.

## Legibility

The technique does not require every character to be legible to the eye at viewing size. Very fine works (tens of thousands of characters) are read by zooming in or by machines. Implementations should offer a legibility setting that limits how thin, small or faint a character may become.

## Hidden messages

A work may be paired with a key that selects characters of its public text in a secret order (a book cipher, `src/secret.js`). This does not touch the rules above: the work still contains exactly its declared text and nothing invisible; the message lives only in the key. Tiny or invisible text must never be used to hide anything in the work itself.

## Naming

- Technique: *Typographics Art*, short *TG Art*.
- A work: *a Typographics Art work*, *a TG Art piece*.
- German: *Typographics Art*, short *TG-Art*.
