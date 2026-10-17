# TGD: structured data inside a Typographics Art work

Version 1.0 of the standard, with its reference implementation (`src/structured*.js`), command line tool (`cli/tg-data.mjs`) and conformance suite (`test/fixtures/conformance/vectors.json`). The user interface design is in [structured-data-ui.md](structured-data-ui.md).

**Status.** The standard, the reference implementation, the CLI and the tests are built and measured. The integration into `app.html`, `work.html`, `cli/onepage.mjs` and the paid API is **designed only** (§12): those files were not touched.

## 0. Summary

An Excel sheet, a CSV, a JSON document, a Markdown file, a YAML file, an XML file, a calendar or a contact list becomes **a block of ordinary text**. The block goes through a work unchanged as visible text, survives the work's whitespace collapse, invisible-character stripping and NFC, can be read back out of the finished PDF, SVG or HTML (or out of the canonical text alone), and decodes to the original data model and, where possible, back to a file of the original format. A person or a language model can read it.

Name: **TGD** ("Typographics Data"), a block is `TGD1[ … ]TGD1`.

Example, `test/fixtures/people.csv` (four people: a 20-digit ID, a quoted newline, an emoji, a leading `=`), exactly as the encoder writes it (`node cli/tg-data.mjs encode test/fixtures/people.csv`, with a fixed creation time):

```
TGD1[{"tgd":"1.0",
"sum":"3fe8bc2ff73f1c9007176e5a8c90868ea39013882bc37b09a65ea39137feaba1",
"format":"csv",
"name":"people.csv",
"created":"2026-10-17T12:00:00Z",
"by":"tg-data/1.0",
"read":"TGD·1:·JSON,·each·middle·dot·stands·for·one·space,·\\uXXXX·is·one·character.",
"lossy":["types:·every·cell·is·text","quoting·style:·fields·are·quoted·only·where·needed","an·empty·quoted·field·(\"\")·and·an·empty·field·are·the·same"],
"data":{"kind":"workbook",
"dialect":{"delimiter":",",
"eol":"\r\n",
"final":true},
"sheets":[{"name":"people",
"rows":[["Name","Age","City","ID","Note"],
["Alice·Müller","34","Zürich","00742","said·\"hi\",·left"],
["Bob\nSmith","41",null,"12345678901234567890",null],
["Zoë·😀",null,"Wien","=SUM(A1)","+41·79·123"]]}]}}]TGD1
```

What the design is, in five sentences:

1. The data is **JSON text** (RFC 8259) in a *transport form* that **does not depend on whitespace at all**: a decoder first deletes every whitespace and invisible character. A space inside a string is written as the middle dot `·` (U+00B7), so `Alice·Müller` means `Alice Müller`.
2. Everything canonicalisation or text extraction could change (control characters, combining marks, invisible characters, and every character outside a *measured-safe set*) is written as a JSON `\uXXXX` escape, so the text layer holds plain, exact characters.
3. Numbers that a double cannot carry exactly (`12345678901234567890`, `1.10`, `1E-3`), dates, times, errors and formulas are **typed values** `{"$":"n","v":"1.10"}`, so a plain JSON parser in any language does not round them.
4. The block carries a **SHA-256 of its own text**, with the checksum field counted as 64 zeros, so the envelope can contain its own checksum without circularity.
5. The block is found by its markers `TGD1[` and `]TGD1` in the canonical text of a work, wherever it sits among prose; the frame markers cannot occur inside the payload.

## 1. The problem, measured

A Typographics Art work keeps its text as one flow. [text-fidelity.md](text-fidelity.md) defines the guarantee at the level of the *canonical text*: `canonicalText` (`src/secret.js`) is NFC of the text with default-ignorable code points removed and every run of whitespace collapsed to one space. Newlines, tabs, indentation and repeated spaces therefore do not survive a work. That alone rules out any format that depends on layout (CSV rows are lines; Markdown is lines; YAML is indentation).

Measuring a real round trip showed three more problems that are not in the existing documentation. Everything below was measured with `scripts/structured-data-experiments.mjs`: a text is set with `makeOnePage` (the real layout, 1 page A4, Chrome and MuPDF as in `cli/onepage.mjs`), read back with MuPDF (`mutool draw -F txt`) and with **pdf.js 4.4.168** (the version `work.html` loads from cdnjs; it is not vendored, so the script takes an unpacked `pdfjs-dist@4.4.168` with `--pdfjs`; text items are joined with `pdfItemsText` from `src/work-text.js`, the same as the site), and both are compared after `canonicalText`.

### 1.1 Spaces are not reliable next to some glyphs

| Text around the space | MuPDF 1.28.5 | pdf.js 4.4.168 |
|---|---|---|
| Latin, accents (Zürich Genève Köln) | exact | exact |
| Cyrillic | exact | exact |
| middle dot `a·b·c d·e·f` | exact | exact |
| CJK `Tokyo 東京 Osaka 大阪` | **spaces lost or added** | **text changes**: 大 (U+5927) comes back as ⼤ (U+2F24, a Kangxi radical) |
| emoji `ok 😀 fine` | spaces lost | exact |
| arrows `a → b → c`, box drawing `a │ b` | spaces lost | exact |
| Hebrew | spaces lost | **letters reordered** (right-to-left runs) |

Cause: when a glyph comes from a fallback font, MuPDF reports no space next to it; pdf.js maps a glyph to one code point, and when two code points share a glyph in the font (an ideograph and its radical twin, µ and Greek μ) only one of them is in the PDF. A single plain space is therefore **not safe as a data character**, and neither is "the space after the comma". (`scripts/structured-data-experiments.mjs spaces`.)

### 1.2 A long token is cut by the layout, and the cut becomes whitespace

A word longer than a line is broken between two characters (`docs/technique.md`, rule 1). A text extractor reports a line break there, and the canonical text then has a space inside the token:

| Characters in the work | Characters per line | Longest token that stayed exact | First length that was cut |
|---|---|---|---|
| 150 | 14 | 12 | 16 |
| 400 | 24 | 20 | 24 |
| 1,000 | 35 to 39 | 32 | 48 |
| 3,000 | 52 to 68 | 48 | 64 |
| 10,000 | 109 to 125 | 64 (largest tried) | none |
| 40,000 | 238 to 252 | 64 (largest tried) | none |

(`scripts/structured-data-experiments.mjs tokens`: tokens of random letters and digits separated by single spaces, 6 sizes of work, 8 token lengths. The numbers are the largest length that read back exact; results near the limit are noisy because the tone planner changes the line length from run to run.) Lines hold about 1.2·√N characters, so no fixed token length is safe for every work. A decoder must therefore treat a space **anywhere** as insignificant, including inside a token.

### 1.3 Characters that the font or the extractor changes

Measured one character at a time (chunk of one character, each between ASCII sentinels, whitespace ignored, NFC applied as `canonicalText` does):

| Block (all assigned letters, digits, punctuation, symbols, NFC-stable) | Characters | MuPDF exact | pdf.js 4.4.168 exact |
|---|---|---|---|
| Basic Latin | 92 | 92/92 | 92/92 |
| Latin-1 | 93 | 93/93 | 92/93 |
| Latin Extended-A | 128 | 128/128 | 128/128 |
| Latin Extended-B | 208 | 208/208 | 208/208 |
| Latin Extended Additional (Vietnamese) | 256 | 256/256 | 256/256 |
| Greek | 132 | 132/132 | 132/132 |
| Cyrillic | 249 | 249/249 | 249/249 |
| Hebrew | 27 | 27/27 | 27/27 |
| Arabic | 43 | layout refuses or crashes | – |
| Devanagari | 54 | 54/54 | 52/54 |
| Thai | 50 | layout refuses or crashes | – |
| Hangul Syllables (sample) | 401 | 401/401 | 401/401 |
| Hiragana | 86 | 86/86 | 86/86 |
| Katakana | 90 | 90/90 | 90/90 |
| CJK Unified (sample) | 801 | 801/801 | 787/801 |
| General Punctuation | 71 | 71/71 | 71/71 |
| Currency Symbols | 32 | 32/32 | 32/32 |
| Letterlike Symbols | 77 | 77/77 | 77/77 |
| Number Forms | 60 | 60/60 | 60/60 |
| Arrows | 112 | 112/112 | 112/112 |
| Mathematical Operators | 256 | 256/256 | 256/256 |
| Box Drawing | 128 | 128/128 | 128/128 |
| Geometric Shapes | 96 | 96/96 | 96/96 |
| Misc Symbols | 256 | 256/256 | 256/256 |
| Dingbats | 192 | 192/192 | 192/192 |
| Emoji (Misc Symbols and Pictographs) | 763 | 763/763 | 763/763 |
| Emoji (Emoticons) | 80 | 80/80 | 80/80 |
| Control Pictures | 39 | 39/39 | 39/39 |
| CJK Unified (all) | 20992 | 20992/20992 | 20718/20992 |
| Hangul Syllables (all) | 11172 | 11172/11172 | 11172/11172 |
| CJK Symbols and Punctuation | 57 | layout refuses or crashes | – |
| Fullwidth Forms | 94 | 94/94 | 91/94 |
| Emoji (Transport and Map) | 119 | 119/119 | 119/119 |
| Emoji (Supplemental Symbols) | 256 | 256/256 | 256/256 |
| Misc Technical | 254 | 254/254 | 254/254 |
| IPA Extensions | 96 | 96/96 | 96/96 |

The 274 CJK ideographs pdf.js changes are the ones whose glyph is shared with a CJK radical (一 U+4E00 comes back as ⼀ U+2F00); the 3 fullwidth forms, µ (U+00B5 comes back as Greek μ U+03BC) and Devanagari U+0908 and U+0910 are the same kind of problem. The measurement is of this environment's fonts: another font can share other glyphs, which is why the creation-time read-back check exists (§12).

Also: U+0085 and the C0 controls (U+001E/U+001F as record/unit separators) are refused by the layout's own read-back check ("Line 0 does not read back from the PDF"). `canonicalText` removes U+2063 (invisible separator), U+200B, U+00AD and every other default-ignorable character, and turns U+00A0 and U+2028 into spaces.

### 1.4 Findings that outside this feature are worth knowing

- `src/layout.js` crashes (`Cannot read properties of undefined (reading 'adv')`) on text in which a combining spacing mark follows a space, for example Thai U+0E33 and emoji skin-tone modifiers: the metrics are measured on `graphemes(wholeText)`, where " ำ" is **one** cluster, while the layout looks up `graphemes(token)`, where "ำ" is its own cluster (`src/browser.js:117`, `cli/render.html:66`, `src/layout.js:217`). TGD never writes such characters literally (they are escapes), but ordinary text with them cannot be set. Not changed here (another change is editing the layout).
- **Blank-space layout and data.** Since the layout for short texts (`gaps: 'auto'` in `cli/onepage-core.mjs`, used up to `SPARSE_LINES` lines) sets glyphs only where the picture is dark, a data block of about 1,400 characters made `makeOnePage` fail with `Line 36 does not read back from the PDF even when printed on its own` (reproduced on `test/fixtures/people.csv` with a one-sentence prefix; with `options: { gaps: 'off' }` the same text is set and decodes). Data one-pagers therefore pass `gaps: 'off'` (§12.2); the cause inside the gap layout is in code that another change is editing and was not touched. TGD blocks are not "short texts" in the sense of that feature: their text is the carrier of the data, not of a motif.
- Roboto Flex is loaded from Google Fonts; in an environment without network the page falls back to a system font. The measurements here were made in that environment. TGD's safety net against any difference is the read-back check at creation (§12) and the checksum.

## 2. Design questions and the evidence

### 2.1 Which serialisation is whitespace-insensitive by construction

The first design, before the measurements, was a typed table with explicit visible delimiters and single-space semantics. The experiments of §1 changed it: **no design in which a space means something can be exact**, so whitespace must carry no meaning at all, and the single space inside a string needs a visible stand-in.

Candidates for delimiters, each tested in all positions data uses it (between words, before and after a space, doubled, alone), 2 runs through the real layout with different tone targets:

| Character | Name | Stays in `canonicalText` | MuPDF exact runs | pdf.js exact runs |
|---|---|---|---|---|
| U+007C | VERTICAL LINE | kept | 2/2 | 2/2 |
| U+00A6 | BROKEN BAR | kept | 2/2 | 2/2 |
| U+2016 | DOUBLE VERTICAL LINE | kept | 2/2 | 2/2 |
| U+00B6 | PILCROW | kept | 2/2 | 2/2 |
| U+003B | SEMICOLON | kept | 2/2 | 2/2 |
| U+002C | COMMA | kept | 2/2 | 2/2 |
| U+23CE | RETURN SYMBOL | kept | 0/2 | 2/2 |
| U+241E | SYMBOL FOR RECORD SEPARATOR | kept | 0/2 | 2/2 |
| U+241F | SYMBOL FOR UNIT SEPARATOR | kept | 0/2 | 2/2 |
| U+240A | SYMBOL FOR LINE FEED | kept | 0/2 | 2/2 |
| U+2063 | INVISIBLE SEPARATOR | removed or changed | 1/2 | 2/2 |
| U+2064 | INVISIBLE PLUS | removed or changed | 2/2 | 2/2 |
| U+001E | RECORD SEPARATOR | kept | refused | - |
| U+001F | UNIT SEPARATOR | kept | refused | - |
| U+200B | ZERO WIDTH SPACE | removed or changed | 1/2 | 2/2 |
| U+2028 | LINE SEPARATOR | removed or changed | 2/2 | 2/2 |
| U+0085 | NEXT LINE | kept | refused | - |
| U+00A0 | NO-BREAK SPACE | removed or changed | 2/2 | 2/2 |
| U+00B7 | MIDDLE DOT | kept | 2/2 | 2/2 |
| U+2022 | BULLET | kept | 2/2 | 2/2 |
| U+00A7 | SECTION SIGN | kept | 2/2 | 2/2 |
| U+00A4 | CURRENCY SIGN | kept | 2/2 | 2/2 |
| U+00AC | NOT SIGN | kept | 2/2 | 2/2 |
| U+2192 | RIGHTWARDS ARROW | kept | 0/2 | 2/2 |
| U+21B5 | DOWNWARDS ARROW WITH CORNER LEFTWARDS | kept | 0/2 | 2/2 |
| U+25AA | BLACK SMALL SQUARE | kept | 0/2 | 2/2 |
| U+2219 | BULLET OPERATOR | kept | 0/2 | 2/2 |
| U+2502 | BOX DRAWINGS LIGHT VERTICAL | kept | 0/2 | 2/2 |
| U+007E | TILDE | kept | 2/2 | 2/2 |
| U+005E | CIRCUMFLEX | kept | 2/2 | 2/2 |
| U+0060 | GRAVE | kept | 2/2 | 2/2 |
| U+005C | BACKSLASH | kept | 2/2 | 2/2 |
| U+0022 | QUOTATION MARK | kept | 2/2 | 2/2 |
| U+0027 | APOSTROPHE | kept | 2/2 | 2/2 |
| U+007B | BRACE | kept | 2/2 | 2/2 |
| U+007D | BRACE | kept | 2/2 | 2/2 |
| U+005B | BRACKET | kept | 2/2 | 2/2 |
| U+005D | BRACKET | kept | 2/2 | 2/2 |
| U+003C | LESS-THAN | kept | 2/2 | 2/2 |
| U+003E | GREATER-THAN | kept | 2/2 | 2/2 |
| U+0026 | AMPERSAND | kept | 2/2 | 2/2 |
| U+003A | COLON | kept | 2/2 | 2/2 |
| U+002F | SOLIDUS | kept | 2/2 | 2/2 |
| U+0023 | NUMBER SIGN | kept | 2/2 | 2/2 |
| U+003D | EQUALS | kept | 2/2 | 2/2 |
| U+005F | LOW LINE | kept | 2/2 | 2/2 |
| U+002D | HYPHEN-MINUS | kept | 2/2 | 2/2 |
| U+002E | FULL STOP | kept | 2/2 | 2/2 |
| U+00AD | SOFT HYPHEN | removed or changed | 1/2 | 2/2 |

"Refused": the layout's own read-back check rejects the text ("Line 0 does not read back from the PDF"). "Removed or changed": `canonicalText` deletes or rewrites the character (so it cannot carry data); the run counts then only compare the text after that.

Reading the table: every ASCII punctuation character and every Latin-1 symbol survives both extractors exactly. The symbols from other blocks (⏎ ␞ ␟ ␊ → ↵ ▪ ∙ │) survive in pdf.js but MuPDF drops the spaces around them, which only matters for formats with meaningful spaces (the first design). The invisible separators, U+200B and the soft hyphen are removed by `canonicalText` (they cannot be data). The controls are refused by the layout. The choice: **only ASCII structure characters** (`[ ] { } , : "`), so the structure needs nothing from the font at all.

Encodings compared on the same typed sample sheet (6 columns: name, region, units, price, 16-digit order ID, ISO date; 200 rows; 11,710 bytes as CSV). All variants write a space as `·` so they are all whitespace-independent; "tokens" is a rough proxy (words, groups of up to three digits, and every punctuation character counted once; **an estimate, not a real tokenizer**):

| Encoding of the 200-row sheet | Characters | Times the CSV | Tokens (estimate) | Times the CSV |
|---|---|---|---|---|
| A  TGD: rows as arrays (the chosen design), compact | 13,337 | 1.14 | 7,544 | 1.47 |
| B  JSON: one object per row (JCS-like, compact) | 23,285 | 1.99 | 12,716 | 2.48 |
| C  JSON Lines: one array per line + header line | 13,335 | 1.14 | 7,342 | 1.43 |
| D  delimiter table: \| between cells, ¶ ends a row (untyped) | 11,321 | 0.97 | 5,528 | 1.08 |
| E  A + value dictionary (repeated strings as {"$":"r","i":n}) | 15,345 | 1.31 | 11,471 | 2.24 |
| TGD block, full envelope, layout compact | 13,649 | 1.17 | 7,719 | 1.51 |
| TGD block, full envelope, layout rows | 13,858 | 1.18 | 7,719 | 1.51 |
| TGD block, full envelope, layout cells | 14,863 | 1.27 | 7,719 | 1.51 |
| base64 of the CSV file (not readable, for comparison) | 15,614 | 1.33 | – | – |

The same at 20 and 2,000 rows differs by less than 0.02 in every ratio, except the fixed envelope (about 310 characters), which is 40 % of a 20-row sheet and 0.2 % of a 2,000-row one.

Decision: **A, rows as arrays inside JSON syntax**.

- B (one object per row, the JCS-like canonical JSON of RFC 8785 without sorting) repeats every key on every row: 2.0 times the CSV size and 2.5 times its tokens. The keys are the header; arrays say it once.
- C (JSON Lines) is the same size as A, but its line breaks are exactly what the work destroys; it needs a row terminator character to be whitespace-independent, and then it is A.
- D (a delimiter table with `|` and `¶`) is the smallest (0.97) but **untyped**: `007`, `7`, `true`, a date and a formula would all be text, a cell containing `|` or `¶` needs its own escape, and a decoder needs a bespoke parser. Every language has a JSON parser.
- E (a dictionary of repeated strings) is **larger** than A (1.31 against 1.14): a reference `{"$":"r","i":12}` costs 15 characters, and the strings of this sheet (4 to 14 characters) are shorter. It only pays for repeated strings longer than about 15 characters, and every row would then need the dictionary to be read. Compression of this kind is not part of 1.0 (§9.3).
- Base64 of the whole file is 1.33 times the size, tokenises badly and cannot be read: only an optional attachment (§4.8).

### 2.2 The space marker

One character must stand for the space inside strings. Requirements: survives all four filters (§1), is rare in data, recognisable. `_` and `~` are common in identifiers and URLs and would need escaping in every key (`first_name`). The middle dot U+00B7 is in Latin-1 (every Latin font has it), measured exact in both extractors (§2.1), and typographically *is* a visible space (it is how editors show spaces). A real middle dot in data (Catalan *l·l*, chemistry) is written `·`, so the transform is exact. A model reading `Alice·Müller` understands it, and the envelope's `read` member says so in the first line of the block.

### 2.3 Escapes: what may stand literally

The encoder writes a character literally only if **all** of these hold, otherwise as `\uXXXX` (a surrogate pair for characters above U+FFFF, the standard JSON way):

1. it is not whitespace, a default-ignorable code point, a control character, a combining mark, a lone surrogate, `"` or `\`, and not the marker U+00B7, U+00AD or **U+00B5** (pdf.js folds µ to Greek μ);
2. it is its own NFC form;
3. it is in a block that was **measured exact in both extractors**, one character at a time: Basic Latin, Latin-1, Latin Extended-A/B and the IPA block, Latin Extended Additional, Greek, Cyrillic, General Punctuation (U+2010–2027, 2030–205E), currency symbols, letterlike symbols and number forms, arrows to Miscellaneous Technical (U+2190–23FF), box drawing to Dingbats (U+2500–27BF), Hiragana, Katakana, Hangul syllables, and four emoji blocks.

Not on the list: CJK ideographs (274 of the 20,992 in U+4E00–9FFF came back as a different code point from pdf.js), Hebrew and Arabic (reordering, shaping), the Indic scripts and Thai (the layout crash of §1.4 and pdf.js decomposition), fullwidth forms and CJK punctuation (pdf.js and the layout), enclosed alphanumerics (not measured). They are escaped. The mode `unicode:'plain'` (CLI `--unicode plain`) writes them literally for readability and relies on the creation-time read-back check; `unicode:'ascii'` escapes everything above U+007E. The decoder accepts any character in either form.

Consequence worth stating: **a combining mark, a zero-width joiner or a variation selector in a cell survives** because the escape `‍` is ASCII, while in ordinary prose the same character would be deleted by `canonicalText`. (The test "every code point survives a string cell" runs 12,000+ code points, lone surrogates and U+10FFFF through encode, `canonicalText` and decode.)

### 2.4 Checksum without circularity

The existing idea is a SHA-256 over the canonical text. For a block that contains its own checksum: hash the block text with the 64 hexadecimal digits of the `sum` value replaced by 64 `0`, after removing whitespace and invisible characters. The decoder does the same replacement, hashes and compares. The field has a fixed length, so replacing it does not change any offset, and no iteration is needed. The hash covers the whole envelope (format, name, creation time, the `lossy` declaration, unknown future members) and the data. **It is an integrity check against damage, not authentication**: anyone can edit a block and recompute the checksum. Authenticity needs a signature outside the block.

### 2.5 Locating the block among prose

`TGD1[` opens, `]TGD1` closes. They are searched in the text with all whitespace and invisible characters removed (an extractor may put a space inside `TGD1[`), and offsets map back into the text you passed. The markers cannot occur inside the payload: the encoder writes any `TGD1` inside a string as `TGD1`, a transparent escape. Two blocks in one work are two independent blocks; an unterminated block is an error with its offset. Prose before and after is untouched. A text of ordinary prose that happens to contain the letters `TGD1[` would need a matching `]TGD1` and a valid JSON object with a valid checksum to be taken for a block.

## 3. Models

One envelope (§4.2) holds one `data` object with a `kind`. The decoded **model** is exactly the JSON of `data` (what `block.model` and `tg-data decode` return); typed values are the wrapper objects of §3.1. Models in 1.0: `workbook` (Excel, CSV, TSV), `json` (JSON, YAML), `markdown`, `xml`, `icalendar`, `vcard`, `kv`.

### 3.1 Typed values

A typed value is an object whose first key is `"$"`. In 1.0:

| `$` | Meaning | Members | Example |
|---|---|---|---|
| `n` | number kept as its exact decimal literal (not a double that prints back the same) | `v`: the literal, JSON number grammar | `{"$":"n","v":"12345678901234567890"}` |
| `d` | date | `v`: `YYYY-MM-DD` | `{"$":"d","v":"2024-03-05"}` |
| `dt` | date and time, **no time zone** | `v`: `YYYY-MM-DDTHH:MM:SS` with `.mmm` only if not zero | `{"$":"dt","v":"2024-03-05T14:30:00"}` |
| `t` | time of day | `v`: `HH:MM:SS[.mmm]` | `{"$":"t","v":"09:05:30"}` |
| `e` | error value | `v`: the error text | `{"$":"e","v":"#DIV/0!"}` |
| `f` | formula (workbook cells only) | `f`: formula text without `=`; `v`: the cached value (any cell value; absent if none was stored) | `{"$":"f","f":"SUM(A1:A2)","v":3}` |

A plain JSON number in the data is a number whose text is exactly the shortest decimal form of its double (what `JSON.stringify` prints): `0.1`, `34`, `-7` and `1e+21` are plain; `1.10`, `1E+21`, `1E-3` and `12345678901234567890` are not (their text differs), and are written `{"$":"n","v":"1.10"}` and so on. So any JSON parser reads plain numbers exactly, and typed ones are explicit. A decoder must refuse a non-canonical plain number (the reference implementation does, `syntax`).

A JSON document that itself contains objects with a `"$"` key keeps them as data: every object key made only of `$` characters gets one more `$` in the model (`"$"` becomes `"$$"`), and the decoder takes it off again.

### 3.2 `workbook`

```
data      = { "kind":"workbook", ["date1904":true], ["names":{ name: ref }], ["dialect":{…}], "sheets":[ sheet, … ] }
sheet     = { "name":string, ["state":"hidden"|"veryHidden"], ["header":true],
              ( "rows":[ [cell,…], … ] | "cells":{ "A1":cell, … } ), ["merges":["A1:B2",…]], ["comments":{ "A1":string }] }
cell      = null | boolean | number | string | typed value
```

- **Cells.** `null` is an empty cell. Rows are arrays from column A; absent trailing cells are empty (CSV keeps its trailing empty fields as `null`, because a field count is part of CSV). `[]` is an empty row.
- **Dense or sparse.** `rows` lists rows; `cells` lists only used cells by A1 address. The encoder picks the smaller (sparse if it is less than 80 % of dense); a decoder accepts both. A sheet never has both.
- **`header`** is a *hint* set when the first row is all distinct non-empty text and more rows follow. It is not in the source.
- **Types.** Strings are text, never numbers: `"007"` stays `"007"`. A cell value that Excel stores as a number is a number or `{"$":"n"}` from the literal in the file (`<v>`), never from float arithmetic.
- **Dates and time zone.** Excel stores a serial number and a display format, no time zone. A number cell whose format is a date or time format is written as `d`, `dt` or `t` in ISO text **without** a zone: a floating local time. Serials in the 1900 system: 1–59 are 1900-01-01…02-28, 60 is the non-existent 1900-02-29 (kept as the number 60), 61 on is 1900-03-01 on; `date1904:true` marks the 1904 system (serial 0 is 1904-01-01). Values are rounded to the millisecond. A date-formatted number that no date can stand for (60, 0, negative, a duration over 24 hours in a time format) stays a number, and the envelope says so. Format recognition: Excel's built-in date ids (14–22, 27–36, 45–47, 50–58) and custom codes that contain `y`, `d`, `h`, `s` or `m` outside quotes, brackets and escapes (`dateKind` in `src/structured-xlsx.js`; tested on 9 format codes).
- **Formulas.** Both: the formula text and the cached value, because the formula is what the author meant and the cached value is what the sheet showed. A shared formula's followers keep only their value (the first cell of the group keeps the formula text); an array formula is kept as a single-cell formula. Both are declared in `lossy` with counts.
- **Merged cells** (`merges`), **comments** (text of legacy cell comments; threaded comments appear through their legacy fallback text), **hidden sheets** (`state`) and **defined names** (workbook scope, name to reference text; sheet-local names and Excel's own `_xlnm` names are dropped) are kept.
- **Out of scope, declared in every envelope:** styles, fonts, colours, borders, number formats (except date recognition), column widths and row heights, hidden rows and columns, frozen panes, data validation, conditional formatting, filters, tables, pivot tables, charts, images, drawings, macros. Data validation is out because it is behaviour and not data; the others are presentation. (An optional `fmt` member per column is the natural 1.x extension.)
- `dialect` (CSV/TSV only): `delimiter`, `eol` (`"\r\n"`, `"\n"` or `"\r"`), `final` (the file ends with a line break), `bom`.

### 3.3 `json`

`{"kind":"json","value":<any JSON, with the $ rules of §3.1>}`. Key order is kept (an object is written in source order, and the reference implementation reads into `Map`, so integer-like keys such as `"10"`, `"2"` keep their order, which `JSON.parse` would not); **duplicate keys are refused** (RFC 7493, I-JSON: JSON with duplicate names is not interoperable); numbers keep their literal (`1.10` stays `1.10`, `1E+21` stays); lone surrogates in strings are escaped and kept. YAML reads into the same model.

### 3.4 `markdown`

A document model, not raw text: `{"kind":"markdown", ["front":string], "blocks":[ block, … ]}` with

| `t` | Members | Meaning |
|---|---|---|
| `h` | `l` 1–6, `x` | heading; `x` is the inline Markdown of the heading |
| `p` | `x` | paragraph; lines joined by `\n`, leading indentation removed |
| `ul`, `ol` | `items`: array of arrays of blocks; `start` (ol, if not 1); `tight:false` if loose | list |
| `code` | `lang` (optional), `x` | fenced or indented code |
| `quote` | `b`: blocks | block quote |
| `table` | `align`: `"l"`,`"r"`,`"c"` or null per column; `head`: cells; `rows`: rows of cells | GFM table; cells are inline Markdown, `\|` kept |
| `hr` | – | thematic break |
| `html` | `x` | an HTML block, as written |

Inline markup (emphasis, links, code spans, images) is **kept as written** inside `x`, so no inline information is lost and the model needs no inline parser. Front matter (a leading `---` block) is kept as text. The block syntax is normalised on writing (bullets `-`, ATX headings, fences, aligned tables), and the writer is a fixpoint: reading what it wrote gives the same model (tested on `test/fixtures/sample.md`, 13 blocks of 9 kinds, including nested lists, a loose and a tight list, two lists in a row, setext headings, indented code, tables with alignment and a hard break).

### 3.5 `xml`

`{"kind":"xml","root":element}`, `element = [name, {attributes}?, child, …]` (JsonML), a child being a string or an element. Mixed content keeps its spaces; whitespace-only text between elements is dropped when the element has no other text. Namespaces are kept as written (prefixes and `xmlns` attributes are ordinary attributes). Comments, processing instructions, the declaration, CDATA boundaries are dropped (declared); a DOCTYPE is **refused**.

### 3.6 `icalendar`, `vcard`

`{"kind":"icalendar"|"vcard","items":[component,…]}`, `component = {"c":NAME, "p":[ [name, value, [params]?], … ], "k":[component,…]?}`. Values and parameters are kept exactly as written after unfolding (escapes such as `\n` and `\,` are **not** interpreted), so a read and a write give the same lines; the only change is that long lines are folded again at 75 octets (never inside a UTF-8 character).

### 3.7 `kv`

`{"kind":"kv","pairs":[[key,value],…]}` for `KEY=VALUE` files (`.env`, `.properties`): key is the text before the first `=`, trimmed; value is the rest, trimmed, no unquoting, no interpolation. Comments (`#`, `;`, `//`) and blank lines are dropped.

## 4. The standard

### 4.1 Framing and the transport form

A **block** is `TGD1[` *body* `]TGD1` in a text. Between any two characters of a block, including inside the two markers, any number of whitespace or invisible characters may occur. A decoder first **deletes** these characters, in the normative set (Unicode 17; the list is fixed so that it cannot drift with later Unicode versions, and is tested against `White_Space` + `Default_Ignorable_Code_Point` + `Cc`):

```
U+0000-0020, U+007F-00A0, U+00AD, U+034F, U+061C, U+115F-1160, U+1680, U+17B4-17B5,
U+180B-180F, U+2000-200F, U+2028-202F, U+205F-206F, U+3000, U+3164, U+FE00-FE0F, U+FEFF,
U+FFA0, U+FFF0-FFF8, U+1BCA0-1BCA3, U+1D173-1D17A, U+E0000-E0FFF
```

and applies NFC to the text first (an extractor may decompose; the payload has no combining marks, so nothing is composed wrongly). What is left is the **transport text**, which is a JSON text (RFC 8259) with these rules:

- **T1** no whitespace outside strings (there is none after deletion), and none inside strings either: U+00B7 inside a string means U+0020. U+00B7 outside a string is an error.
- **T2** strings escape `"` and `\`, and use `\n \r \t` and `\uXXXX`. An encoder may write a character literally only under §2.3; a decoder accepts any character that is not a control character.
- **T3** a plain number is canonical (§3.1); anything else is a typed value.
- **T4** object keys are unique.
- **T5** the sequences `TGD1[` and `]TGD1` do not occur in the transport text.

EBNF of the frame and the envelope (`json-text` and `string` as in RFC 8259; `ws` never occurs in transport text):

```
block      = "TGD1[" envelope "]TGD1" ;
envelope   = "{" '"tgd":' version "," '"sum":' sum { "," member } "}" ;     (* tgd and sum first, in this order *)
version    = '"1.' digits '"' ;                                            (* major 1; the minor part is informative *)
sum        = '"' 64 * hexdigit-lower '"' ;
member     = '"format":' string | '"name":' string | '"created":' string | '"by":' string
           | '"read":' string | '"lossy":' "[" [ string { "," string } ] "]"
           | '"data":' data | '"attach":' "[" [ attachment { "," attachment } ] "]"
           | string ":" json-value ;                                       (* unknown members: ignore *)
data       = "{" '"kind":' string { "," string ":" json-value } "}" ;
attachment = "{" '"name":' string "," '"media":' string "," '"size":' integer "," '"sha256":' string "," '"base64":' string "}" ;
typed      = "{" '"$":' string { "," string ":" json-value } "}" ;
```

### 4.2 The envelope

| Member | Required | Meaning |
|---|---|---|
| `tgd` | yes | `"1.0"`; a decoder accepts any `1.x` and refuses another major version (`version`) |
| `sum` | yes | 64 lowercase hexadecimal digits: SHA-256 as §4.3 |
| `format` | no | the source format: `xlsx csv tsv json md yaml xml ics vcf kv` (an open set; an unknown value is ignored) |
| `name` | no | the file name, no path (the encoder removes directories and control characters, at most 255 characters) |
| `created` | no | `YYYY-MM-DDTHH:MM:SSZ`, UTC; absent when the encoder was asked for reproducible output |
| `by` | no | the encoder, e.g. `tg-data/1.0` |
| `read` | no | one human sentence that explains the convention to a reader who has never seen TGD |
| `lossy` | no | list of what the source had and the block does not carry (§7) |
| `data` | yes | the model, §3, with `kind` |
| `attach` | no | the original file, §4.8 |

**Forward compatibility.** A decoder MUST ignore envelope members and model members it does not know; they are covered by the checksum. New typed `$` values and new kinds may be added in 1.x; a decoder that meets one it does not know reports `shape` for that kind or value (it must not guess). A change that old decoders cannot read gets a new major version and new markers (`TGD2[`), so old decoders do not see it as a block at all.

### 4.3 The checksum

`sum` = lowercase hex of SHA-256 over the UTF-8 bytes of the transport text of the body (between the markers), in which the 64 digits of the value of the first `"sum":"` are replaced by 64 `0` characters.

### 4.4 Decoding, step by step (for a third party)

1. Apply NFC; delete the strip set; find `TGD1[` and the next `]TGD1`.
2. Compute the checksum as §4.3 over what is between them; compare with the `sum` member (after parsing); on mismatch stop with `checksum`.
3. Replace every U+00B7 with U+0020, parse as JSON (reject duplicate keys; keep numbers as written or check §3.1).
4. Check `tgd` is `1.x`, `data.kind` exists.
5. Interpret the model (§3). Files of the source format are produced by the writers of §5.

In Python the whole decoder up to step 4 is: `t = re.sub(strip_re, '', unicodedata.normalize('NFC', text))`, `body = t[t.index('TGD1[')+5 : t.index(']TGD1')]`, `check sha256`, `json.loads(body.replace('·', ' '), object_pairs_hook=…)`. The conformance suite (§11) checks the details.

### 4.5 Errors

`TgdError.code` is stable; messages are English API text.

| code | Meaning |
|---|---|
| `none` | no block in the text |
| `unterminated` | an opening marker without a closing marker (`offset`) |
| `syntax` | not valid JSON/TGD, or a limit-free structural problem in a source file (`offset`, line numbers for text formats) |
| `checksum` | the checksum does not match (`expected`, `actual`) |
| `version` | another major version |
| `shape` | valid JSON but not a valid envelope or model |
| `limit` | a size, depth, count or ratio limit |
| `encoding` | a source file is not valid in the assumed encoding |
| `format` | unknown file type, or the model cannot be written as the requested format |
| `zip`, `zip-slip` | a damaged or unsafe archive |

### 4.6 Media types and names

| Thing | Name |
|---|---|
| encoded text (a block) | file extension `.tgd`, media type `text/vnd.tgart.tgd` (UTF-8) |
| decoded model | file extension `.tgd.json`, media type `application/vnd.tgart.tgd+json` |
| the standard | "TGD 1.0" |

(These media types are not registered with IANA; they are proposals.)

### 4.7 Layout of the text

Whitespace carries no meaning, so the encoder's choice of line breaks is about people: `layout:'rows'` (default) puts a line break between records (rows, sheets, members of the envelope), `'cells'` also a space after each comma, `'compact'` none. Measured: §6.

### 4.8 Attachment

`opts.attach` / `--attach` stores the original file as base64 in the `attach` member with its SHA-256. It is the only way to carry **binary-only content that the model drops** (styles, images). It costs 1.33 times the file in characters and base64 tokenises about three times worse than text, so it is off by default and the interface shows the cost as a number. The decoder verifies the attachment's SHA-256 against the bytes when it is used.

## 5. Formats

Supported set and why: **xlsx, csv, tsv, json, md, yaml (subset), xml, ics, vcf, kv.** These are the formats in which people keep data, and each has a model that maps without invention. Not supported: `.xls` (a binary format with a long history of parser bugs), `.ods` and `.numbers` (the owner asked for Excel; ODS is the natural next reader because it is also zipped XML), `.docx` (not data), `.parquet` and other binary formats (not text, and a work is for text).

| Format | Reader | Writer back to the format | Guarantee | Lost, declared in `lossy` |
|---|---|---|---|---|
| **xlsx** | own ZIP+XML reader | own writer (valid package; opens in openpyxl, §8) | **semantically exact** for everything in §3.2: model → xlsx → model is the identity on the test workbooks | styles, formats (dates kept), widths, heights, hidden rows/columns, validation, conditional formatting, tables, charts, images, macros; shared formula followers keep values; array formulas become single-cell; date values rounded to the millisecond, no zone |
| **csv** | RFC 4180 with detection of `, ; TAB \|`, UTF-8 (BOM), UTF-16 (BOM), named encodings via `TextDecoder` | RFC 4180 with the recorded dialect | **byte-exact** for CSV in minimal-quoting style, consistent line endings and valid UTF-8 (tested: `people.csv`, `semicolon.csv`, BOM, no final newline); otherwise semantically exact | every cell is text (types), unnecessary quotes, an empty quoted field equals an empty field, a single-column row with an empty value equals an empty line, mixed line endings become the first kind |
| **tsv** | as csv, TAB | as csv | as csv | as csv |
| **json** | strict, own parser | pretty (2 spaces) or compact | **exact for the data**: key order, number literals (`1.10`, `12345678901234567890`, `1E+21`, `-0`), lone surrogates, `$` keys; duplicate keys refused | formatting (indentation, spacing), BOM |
| **md** | block parser, subset of CommonMark/GFM (§3.4) | normalising writer | **model-exact**; writer is a fixpoint; not byte-exact | block syntax normalised, blank-line layout, link reference definitions stay paragraph text, front matter not interpreted, tabs in indentation |
| **yaml** | strict subset (below) | block style | **model-exact** within the subset | comments, quoting style; text such as `007`, `0x1F`, `yes` stays text |
| **xml** | strict, own parser, no DOCTYPE | indented | **element-tree exact** | comments, processing instructions, the declaration, CDATA boundaries, ignorable whitespace, DOCTYPE (refused) |
| **ics**, **vcf** | content lines, own parser | folded at 75 octets, CRLF | **line-exact** apart from folding | folding, blank lines |
| **kv** | `KEY=VALUE` | `KEY=VALUE` | exact for pairs | comments, blank lines, spacing around `=` |

**YAML: a subset on purpose.** YAML 1.2 is a very large language: anchors and aliases (exponential expansion), tags that construct objects, multiple documents, implicit typing that changed between 1.1 and 1.2 (the "Norway problem": `no` is a boolean in 1.1), and no safe small parser. The subset: block mappings and sequences with spaces, plain/single/double-quoted scalars, one-line flow collections, `|` and `>` block scalars with `-`/`+` chomping, comments, one leading `---`. Refused with a line number: anchors, aliases, tags, merge keys, further documents, directives, complex keys, tabs as indentation, duplicate keys. Typing follows the 1.2 core schema with two narrowings: **only canonical numbers are numbers** (`007`, `0x1F`, `+1`, `.5` stay text) and `yes/no/on/off` are text.

**JSON numbers beyond 2^53.** `12345678901234567890` is `{"$":"n","v":"12345678901234567890"}` in the block and `12345678901234567890` in the file written back; the model never passes through a double.

**Locale decimal commas.** `8,7` in a CSV is the string `"8,7"`. Nothing is guessed: CSV has no types, and a locale-dependent guess would change data. (Excel stores real numbers, not text, so xlsx is not affected.)

**Wide and long sheets.** Row and column limits are Excel's (1,048,576 × 16,384); sparse sheets use the sparse layout, and the reader never makes a dense table of a sparse sheet (§8).

## 6. Capacity and layout

One A4 page. Measured on this repository's one-pager (`makeOnePage`, A4, same layout for data and prose):

| Characters in the work | Line height / type size (A4) | Source |
|---|---|---|
| 1,394 | 9.5 mm | measured, `basic.xlsx` |
| 11,169 | 3.2 mm | measured, 160-row sheet |
| ≈ 120,000 | ≈ 1.0 mm | `size_mm ≈ 345/√N`, fitted to the two measurements |
| 600,000 | ≈ 0.45 mm | machine-readable only; `docs/file-size.md` and `examples/index.json` have set 600,000 characters (EU AI Act) on one page |

Data capacity of a page, from the measured block sizes (`scripts/structured-data-experiments.mjs sizes`): the sample sheet (6 columns, 68 characters per row in TGD) gives about 8,800 rows at 600,000 characters, about 1,700 rows at 120,000 characters (1 mm type, still legible with zoom). Wider sheets give proportionally fewer rows.

**More than one page.** The one-pager tool puts one text on one page (`docs/file-size.md`: large sheets are printed in strips and assembled to one page). Data larger than a page is, in 1.0, **split into several works**, each with its own block (a sheet per work, or row ranges of one sheet as `rows` of consecutive blocks with `name` `budget.xlsx (2/3)`); a decoder concatenates blocks of the same `name` only when asked. The envelope has no cross-block reference in 1.0, deliberately: each block verifies on its own. The tool does not do the splitting yet (design only); `encode` already reports the character count so the caller can plan.

**Picture.** Tone planning works on characters, and a data text is punctuation-heavy: quotes, brackets and digits. Measured on the same page, same title, 11,000 characters (`scripts/structured-data-experiments.mjs visual`, `docs/structured-data/*.jpg`):

| Page text | Characters | Lines | Type size | Tone fidelity | Read back exact | Visible text identical |
|---|---|---|---|---|---|---|
| tgd-compact | 11000 | 81 | 3.487 mm | 0.947 | False | True |
| tgd-rows | 11169 | 88 | 3.217 mm | 0.951 | True | True |
| tgd-cells | 11974 | 85 | 3.345 mm | 0.95 | True | True |
| prose | 11167 | 80 | 3.56 mm | 0.978 | True | True |

Images: [`structured-data/tgd-rows.jpg`](structured-data/tgd-rows.jpg) (data) and [`structured-data/prose.jpg`](structured-data/prose.jpg) (Lorem ipsum of the same length), same title and paper. `compact` (no line breaks) reads back with whitespace inside tokens (`exact: false`) and still decodes, because the decoder ignores whitespace; `rows` is the default because it is exact as text, the smallest of the readable layouts and has the best tone fidelity.

The data page forms its picture as well as prose does (tone fidelity 0.95 against 0.98), with heavier quotation marks and brackets and lighter digit runs. A person sees an ordinary Typographics Art page; the text is the data. At about 1,400 characters the picture is coarse, as for any short text (`cli/onepage.mjs --motif` says motifs work from about 20,000 characters); data pages should be at least a few thousand characters if the picture matters.

## 7. What is lost, per format

Every block says what the source had and the block does not carry, in `lossy`, as plain sentences. The lists are in the table of §5 and are produced by the readers, not written by hand, so they cannot drift from what the reader does. The encoder adds counts where it dropped something specific (`N cells keep their value only`).

## 8. Security

All limits are options; these are the defaults.

| Threat | Defence | Test |
|---|---|---|
| **Zip bomb** | refuse a file compressed over 300:1 (above 4 KiB), a file above 256 MiB unpacked, a total above 384 MiB, more than 4,096 entries; inflate with a hard output limit equal to the declared size, so a **lying size header** is caught during inflation; check the CRC-32 | 40 MiB of zeros in a 40 KB archive refused; the same with the size header patched down refused while inflating |
| **Zip slip** | refuse entry names with a `..` segment, a leading `/`, a backslash, a drive letter or NUL (nothing is ever written to disk; a name that cannot be safe is not a spreadsheet); refuse relationship targets that leave the archive; refuse duplicate entries (two readers would choose differently); refuse encrypted and ZIP64 archives | six hostile names, duplicates |
| **Entity expansion, XXE** | a DOCTYPE is refused outright; only the five built-in entities and numeric references exist; depth and element count are limited | billion-laughs and `SYSTEM` examples; in XML and inside an `.xlsx` part |
| **Deep nesting, stack exhaustion** | depth limits: JSON 64, YAML 64 (block **and flow**), XML 256, Markdown 32, iCalendar 16 | 100,000 `[` in YAML and JSON refused |
| **Huge sparse sheets** | the reader counts the dense size from row lengths **before** allocating and writes `cells` instead; the writer refuses a table that would need tens of millions of dense cells | `A1` + `XFD1048576` read fast and small; 10,000 rows with one cell at column 16,000 |
| **Formula injection** | when a model is written as CSV or TSV, the **final text of every cell** is checked, whatever its type (text, date, boolean, formula, error): if it starts with `=`, `+`, `-`, `@`, TAB or CR it gets a leading `'`. The only exemption is text that is **entirely a plain decimal number** (`-5`, `+1.5e3`, `.5`): a spreadsheet reads that as a number, never as a formula. A string cell `"-5"` is therefore not changed, `"-5+cmd"` is. The guard can be switched off (`--raw`); the output then says it did not guard. For xlsx, strings are always written as shared strings (never evaluated), and formulas are written only with `formulas:true` (`--formulas`); the default writes the cached value | hostile cells of every type; every written cell parsed back |
| **Prototype pollution** | JSON objects are read into `Map`, XML attributes with `defineProperty`; no object is merged | key `__proto__` |
| **Checksum is not a signature** | stated above (§2.4); a work whose data must be authentic needs a signature outside the block | – |
| **Untrusted file names** | `name` loses directory parts and control characters; the CLI writes only where `-o` says | – |
| **Resource use in the browser** | the interface reads in a worker and shows the `limit` message before layout (UI doc §4) | – |

## 9. Design decisions that are not obvious

### 9.1 Why JSON and not a table with delimiters

See §2.1: types, any language's parser, and no bespoke escape rules. The price is quotes around strings (one pair per text cell): 1.14 times the CSV size for a typed sheet, not 0.97.

### 9.2 Why the middle dot and not "keep the spaces"

§1.1: a space next to a fallback glyph is dropped by MuPDF and changed by pdf.js; spaces inside long tokens are added by the layout (§1.2). Data cells with emoji, CJK or arrows would silently change. With the marker, **no whitespace anywhere is significant**, which is the only property that all measured failures have in common.

### 9.3 Compression

None in 1.0. Text compression that stays plain text is a dictionary (§2.1, E): measured larger on a typical sheet, and it destroys the property that each row reads on its own. LZ-style compression produces a byte string that must be armoured (base64) and is then no more readable than base64 of the file. The real saving, the repeated keys of an object-per-row layout, is already taken by the array-of-rows design (2.0 → 1.14 times CSV).

### 9.4 What the decoder returns for Excel numbers

`{"$":"n","v":"1E-3"}` for a number written `1E-3`: the **literal** is kept, not a double. A reader that wants doubles converts the literal; a reader that wants exact decimals uses it as is.

## 10. API (reference implementation)

```js
import { encode, decode, decodeAll, findBlocks, stripBlocks, verify, toFile, seal } from './src/structured.js';

const { text, format, lossy } = await encode({ bytes, name: 'budget.xlsx' }, { layout: 'rows', unicode: 'safe', created: new Date(), attach: false });
const blocks = findBlocks(canonicalText(workText));            // [{ start, end, body }]
const block = await decode(canonicalText(workText));           // throws TgdError ('checksum', …); decodeAll() returns damaged blocks as { error }
block.model                                                    // the model (plain JSON); block.data is the same as ordered Maps
const { bytes, name, mime, notes } = await toFile(block, 'csv', { safe: true });   // 'xlsx' | 'csv' | 'tsv' | 'json' | 'md' | 'yaml' | 'xml' | 'ics' | 'vcf' | 'kv'
const report = await verify(canonicalText(workText));          // { ok, blocks: [{ ok, code?, message?, sum?, start, end }] }
```

Pure ES modules, Node 20+ and browsers, no dependency (ZIP through `node:zlib` or `DecompressionStream`/`CompressionStream` behind one adapter; SHA-256 through Web Crypto). Not added to `src/index.js` (the owner decides the public surface); the import path is `./src/structured.js`.

CLI (`cli/tg-data.mjs`; the `bin` line to add to `package.json` is `"tg-data": "./cli/tg-data.mjs"`; it is not registered):

```
tg-data encode <file> [-o out.txt] [--unicode safe|plain|ascii] [--layout rows|cells|compact] [--attach] [--encoding windows-1252] [--no-date]
tg-data decode <work.pdf|.svg|.html|.txt> [--format model|xlsx|csv|tsv|json|md|yaml|xml|ics|vcf|kv] [-o file] [--block n] [--sheet name] [--raw] [--formulas]
tg-data verify <work>        # exit 1 if a block is damaged or there is none
```

Worked through a real PDF (before the merge of the short-text layout, with `onepage.mjs` as it was then): `tg-data encode basic.xlsx -o basic.tgd --no-date`, `onepage.mjs basic.tgd --title Sales -o basic.pdf` (MuPDF read-back identical), `tg-data verify basic.pdf` (`block 1: ok, xlsx basic.xlsx sha256 d448af67…`), `tg-data decode basic.pdf --format xlsx -o back.xlsx`. **With the current `cli/onepage.mjs` the second step fails** (`Line N does not read back`, §1.4) until the patch of §12.2 passes `gaps: 'off'`; the end-to-end test in `test/structured-data.test.js` calls `makeOnePage` with that option and passes (sheet to PDF to MuPDF to decode to the original CSV, byte for byte).

## 11. Conformance

`test/fixtures/conformance/vectors.json` (built by `scripts/build-conformance.mjs`) has 13 vectors: `text` and either `expect.model` (compare as JSON) or `expect.error` (the code). They cover the smallest block, spaces and the middle dot, every typed value, escapes (a combining mark, a zero-width joiner, CJK, a surrogate pair, a control character, quote and backslash), the frame markers inside data, the sparse layout, a JSON document with big numbers and the `$` escape, the same block with random whitespace, a block inside prose, a tampered block, an unterminated block, a block of another major version, and no block. The reference decoder passes all of them, and the reference encoder reproduces the first seven byte for byte (the encoder is deterministic: same model, same meta, same text). A decoder in another language should pass every vector; an encoder should additionally produce text that the reference decoder accepts and that decodes to the same model.

## 12. Integration plan

Not done; the files below were not touched. Each step is independent.

### 12.1 `src/index.js`

```js
export * from './structured.js';   // encode, decode, decodeAll, findBlocks, stripBlocks, verify, toFile, seal, TgdError
```

### 12.2 `cli/onepage-core.mjs` and `cli/onepage.mjs`: data files become one-pagers

`readDocument` is synchronous and reads a non-PDF as UTF-8; `cli/tg-secret.mjs` and `cli/onepage.mjs` call it synchronously, so it stays as it is and a new async function is added next to it:

```js
import { encode } from '../src/structured.js';
import { detectFormat } from '../src/structured-formats.js';

/** Like readDocument, but a data file (xlsx, csv, tsv, json, yaml, xml, ics, vcf, kv) becomes a TGD block. */
export async function readAnyDocument(path, { data = false } = {}) {
  const ext = extname(path).toLowerCase();
  if (ext === '.pdf') return readDocument(path);
  const bytes = new Uint8Array(readFileSync(path));
  const fmt = detectFormat(path, bytes);
  if (fmt && (data || !['.txt', '.md'].includes(ext))) {     // .txt and .md stay prose unless --data says otherwise
    const r = await encode({ bytes, name: basename(path), format: fmt }, { created: new Date() });
    return { text: r.text, pages: null, extractor: `tgd (${fmt})`, data: true, model: r.model };
  }
  return readDocument(path);
}
```

In `onepage.mjs` (which is already top level, so `await readAnyDocument(input)` works there): the default `subtitle` for data becomes `"<file name> · <n> rows"` (not "N words on one page"); add `--data` (treat a `.md`/`.txt` as the format by extension) and `--prose <file>` (text placed before the block). `makeOnePage` is called with `options: { gaps: 'off' }` for data (§1.4). After `makeOnePage`, call `verify(canonicalText(back))` on the text read back with MuPDF and **fail with exit code 2 if the block does not verify** (§12.5 of the UI doc: the safety net). `makeOnePage` is not changed.

### 12.3 `app.html` (generator)

See [structured-data-ui.md](structured-data-ui.md) §1. Technical steps: a `<div class="field" id="dataField">` after `#text`; on a chosen file read `await file.arrayBuffer()`, call `encode` in a module worker (`new Worker('./src/structured-worker.js', { type: 'module' })`, a ten-line wrapper to write), show the preview from `block.model`, put `result.text` into the text used to make the work (`textarea#text` is the prose; the work text is `prose + '\n\n' + block`), after the work is made read it back with `readWorkFile` (`src/work-text.js`), `verify`, and show the result under the download button. No change to `src/layout.js`.

### 12.4 `work.html` (Machine and Read views)

Two small changes at the points where the page builds `state.canonical` (after the `textUrl`/PDF branch, `work.html` around line 328–340) and in `renderMachine` (line 501):

```js
import { findBlocks, stripBlocks, decodeAll, toFile } from './src/structured.js';
…
state.blocks = await decodeAll(state.canonical);                 // [] when the work carries no data
state.prose = state.blocks.length ? stripBlocks(state.canonical, ' ').trim() : state.canonical;
// Read view: structuredText(source) as now, but on the source with the blocks cut out (stripBlocks on the text first)
// Machine view: before #sections add one card per state.blocks entry (UI doc §2), error boxes for { error }
// machineJson(): add  data: state.blocks.map((b) => b.error ? { error: b.error.code } : { name: b.name, format: b.format, sum: b.sum, model: b.model })
```

The checksum of the canonical text that the Machine view already shows stays the SHA-256 of the **whole** canonical text, block included: the checksum ties the three views to one text, and the block is part of that text.

### 12.5 `api/pipeline.mjs` and `api/server.mjs`: the paid one-pager for a data file

An uploaded `.xlsx` is a data one-pager only if the server turns it into text first. `api/server.mjs` lists the accepted content types (`application/pdf`, `text/plain`, `text/markdown`, line 60): add the media types of the formats (`text/csv`, `text/tab-separated-values`, `application/json`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/xml`, `text/calendar`, `text/vcard`, `application/yaml`) with extensions that `readDocument` (12.2) understands. **Important:** `runJob` builds the image prompt from `doc.text.slice(0, 6000)` (the "opening of the document"); for a data block that is JSON, and the image model would be asked to draw JSON. Pass `doc.proseOrName` instead: for data, the file name and the sheet names and header row as a sentence, never the block text:

```js
const promptText = doc.data ? `${name}. ${summary(doc.model)}` : doc.text;   // summary: sheet names, header cells, row counts
const prompt = await imagePrompt(name, promptText, cfg.llm);
```

The API's 20 MB upload limit stays; the TGD limits apply on top (16 MiB input), and the work text of a block over about 600,000 characters is refused with a clear `limit` answer before payment is burned (`api/server.mjs` checks the encoding *before* `store.burn`).

### 12.6 Hidden messages and the Read view

`src/secret.js` indexes the canonical text, block included: the characters of a block are available to the book cipher, and a key made for a text without the block does not fit the text with it (the fingerprint differs). That is correct and needs no change; document it next to the feature. The Read view's `structuredText` runs on the source: pass it `stripBlocks(source)`, otherwise the block is one very long paragraph at the end of the last section.

### 12.7 What a language model sees

Given only the PDF text layer, a model gets the canonical text: prose, then the block as one run of JSON-looking text with `·` for spaces and a first-line explanation in `read`. A model that has never seen TGD reads it correctly because (a) the `read` sentence tells it, (b) rows are arrays under a header row in a format it reads natively, (c) `lossy` tells it what is absent. The page text a model sees has no line breaks inside a record only if the layout puts none; it does not matter, the data does not depend on them.

## 13. Open questions for the owner

1. Name and markers: `TGD`/`TGD1[`…`]TGD1` are free to change before 1.0 is announced.
2. Whether the decoded model may be shown with the `read` explanation also in the Machine view's "Copy JSON" (it is in the block).
3. Splitting across pages is designed only (§6): a decision on `n/m` naming and on whether `onepage` should do it.
4. Whether `unicode: 'plain'` should ever be the default for Chinese, Japanese and Korean ideographs (measured: 1.3 % of the ideographs are altered by pdf.js; escaping makes them 6 times longer but exact).
5. ODS as the next format.
6. Whether to vendor pdf.js 4.4.168 for the test suite (`scripts/structured-data-experiments.mjs` needs it; the unit tests do not).
