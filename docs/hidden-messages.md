# Hidden messages

A Typographics Art work can carry a message that only the holder of a key can read. The work itself is not changed: it contains exactly its public text, nothing invisible, no extra characters. The message lives only in the key.

## How it works

It is a book cipher over the work's public text.

1. **The public text** is taken the way a machine reads the work: whitespace normalised, invisible format characters (soft hyphens, direction marks) removed, split into grapheme clusters (`canonicalText` in `src/secret.js`). The same text comes out of the HTML, the SVG and the PDF (read with MuPDF).
2. **Hiding:** for every character of the secret, all its occurrences in the public text are collected and one is chosen at random (Web Crypto, without modulo bias). The key is the list of chosen positions.
3. **Fingerprint:** the key starts with the first 8 bytes of the SHA-256 of the public text. Revealing with another work, or with a changed text, is detected and refused instead of producing garbage.
4. **Revealing:** the characters at the listed positions, joined, are the secret.

## The key

`tg1.` followed by base64url of: 8 bytes text fingerprint, then the positions as variable-length integers (about 3 bytes per character for texts of up to two million characters). A 30-character secret gives a key of about 140 characters.

## Use

```sh
node cli/tg-secret.mjs hide   work.pdf --secret "Meet at the harbour, 6 pm."   # prints the key
node cli/tg-secret.mjs reveal work.pdf --key tg1.…                             # prints the message
```

The CLI reads PDF (via MuPDF), SVG, HTML and plain text. In the [web generator](https://typographics-art.org/app), the panel *Hidden message* does the same for the current work. In code: `hideSecret(publicText, secret)` and `revealSecret(publicText, key)` from `src/index.js`.

## What it protects, and what it does not

- **The work reveals nothing.** Without the key it is an ordinary work; there is no hidden layer to find, because there is none.
- **The key is the secret.** Whoever has the key and the work can read the message. Share the key over another channel and keep it like a password.
- **Random positions:** the same secret gives a different key every time, and repeated letters of the secret point to different places, so the key does not show which letters repeat.
- **Not a replacement for encryption** where the message must stay secret even from someone who may get the key: then encrypt the message first and hide the ciphertext's characters, or use proper encryption.

## Limits

- A character that does not occur in the public text cannot be hidden; the tool names the missing characters. Longer texts contain more characters; digits and rare symbols may be absent from short ones.
- The key fits exactly one text. Re-setting the same text into a new picture keeps the key valid (the text is the same); changing even one character of the text makes it invalid.
- One PDF quirk: after a character drawn from a fallback font (for example "→"), MuPDF may read a following space as missing; such a work's PDF text then differs from its source and the key made from the source does not fit the PDF (see `docs/ai-readability.md`).

## Honesty

This does not touch the [rules of the technique](technique.md): the work contains its declared text and nothing else. Tiny or invisible text must never be used to hide anything inside a work.
