# Bundles — a folder as one signed collection

A **bundle** turns a folder of Markdown documents into a directory of signed Typograms plus a signed *index* that seals
the whole set. It is Phase I1 of the provenance layer (see [verification.md](verification.md) and [issuers.md](issuers.md)
for signing and keys). Encrypted ("sealed") bundles are a later mode; this page is the plain, signed bundle.

## Make a bundle

```sh
tg bundle <folder> -o <out-dir> --key <private-key.pem> --issuer <domain> --kid <id> [--title "<text>"]
```

Every `*.md` file in `<folder>` becomes a signed Typogram (`<name>.svg`) in `<out-dir>`. The command also writes:

- **`manifest.json`** — `version`, `issuer`, `created`, `title`, and for each document
  `{ path, title, summary, hash, tokens, role, origin, readOrder, relations }`.
- **`index.tg.svg`** — the manifest as a readable, signed Typogram: the title, the issuer and date, and the list of
  documents in reading order with a short hash each, ending in the seal. Because the index carries every document's
  hash, **signing the index seals the whole folder**: change any document and the index no longer matches it.

### Per-document metadata (optional front matter)

A document may start with a small YAML front-matter block; anything omitted is inferred:

```markdown
---
role: overview        # overview | core | reference | appendix | rules   (default: core)
origin: human         # human | ai-summary | ai-generated                (default: human)
summary: One line describing this document.
readOrder: 0          # position in the reading order (default: file order)
relations: [{"type":"requires","hash":"<hash>"}]   # supersedes | requires | extends
---
# Title

Body…
```

`title` comes from the first heading, `summary` from the front matter or the first paragraph, `hash` is the Typogram's
identity hash, and `tokens` is a word count. The manifest and the index are ordered by `readOrder`, not by file name.

## Verify a bundle

```sh
tg verify <folder> [--keys <dir|file>]
```

`tg verify` on a directory checks the **index signature**, then **every document**: its signature verifies against the
issuer's key (the key statement is checked too, as for a single work), its picture and its embedded source are the same
text, and its hash matches the manifest. A **missing** file (in the manifest, not on disk) or an **extra** Typogram (on
disk, not in the manifest) is an error. The result and exit code are the usual three states: **VERIFIED (0)**,
**UNSIGNED (2)**, **TAMPERED (1)**.

The keys are found as for `tg verify <file>`: `--keys <dir>` looks for `<dir>/<issuer>.json`,
`<dir>/keys/<issuer>.json` or `<dir>/.well-known/tgart-keys.json`; by default `keys/<issuer>.json`.

## Notes

- A bundle is a plain directory. It can be zipped, attached or published; `tg verify` works wherever the folder lands,
  as long as the issuer's key file is reachable.
- Sealed (encrypted) bundles and handoff packages (`tg handoff` / `tg open`) build on this; they are specified in
  [bundles-sealed-handoff-plan.md](bundles-sealed-handoff-plan.md) (I2, I3) and ship separately.
