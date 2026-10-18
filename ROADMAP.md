# Roadmap and open work

Typographics Art is open source (MIT) and meant to be a technique anyone can use and build on, like ASCII art. This page is
the honest list of what works, what is coming, and what you could help with. Issues and pull requests are welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md); security reports go to [SECURITY.md](SECURITY.md).

## Done and shipped

- The **Typogram** file: a valid SVG that opens as the one-pager picture and carries, in the same file, its metadata and its
  payload — structured data in the text, or sealed data and a whole **video** embedded ([docs/typogram-file.md](docs/typogram-file.md)).
- The **adapter** (`tg-adapter`): serves a Typogram's data in its native format and streams embedded sealed media with HTTP
  Range, in RAM, nothing to disk ([docs/encrypted-media-adapter.md](docs/encrypted-media-adapter.md)).
- Structured data (TGD), sealed data and keys, a seed/vault key model, hidden messages — library, CLI, browser, tests.
- One-pagers: a whole document on one page as a picture that a machine reads back exactly.

## Coming soon — and the community could own these

- **The Rust self-extracting client.** A double-clickable `.exe` / `.app` / Linux binary per OS that asks for a password or
  a key file and plays exactly one encrypted picture or video **in RAM, never to disk**. The design is fully written
  ([docs/self-extractor-plan.md](docs/self-extractor-plan.md)) with the decisions made (hybrid in-process decoder for the
  no-disk promise; unsigned with checksums to start). It reuses the `tgst1` crypto, which has a spec and test vectors, so a
  Rust reimplementation can be checked against them. **This is the biggest single piece a contributor could take on.**
- **A FUSE mount** for the adapter, so a Typogram's contents appear as an ordinary file to programs that take a path, not a
  URL.
- **More languages** for the generator UI (today English and German) and more sample texts and example documents.

## Open tasks (good places to start)

- **Picture quality for photos** (in progress): an auto-levels tone map, subject-keyed paper polarity, and a
  dynamic-range metric alongside the correlation one — a solid-set text block only inks ~11–35 % of a cell, so a portrait
  needs the full tonal band and the right paper, not more fonts (measured).
- **Optical-size consistency**: the coverage model and the PNG preview use canvas `ctx.font`, which ignores
  `font-variation-settings`, so the pinned `opsz` shapes the SVG/PDF export but not the measured coverage or the raster
  preview. Make the tone model and the export agree on the optical size.
- **A small sealed image as a `tgs1.` record with its media type** (a `kind:"file"` wrapper), so the adapter serves it
  with the right type without a stream.
- **Constant-memory streaming** of an embedded video: decode the base64url range in place instead of holding the whole
  stream in memory, for very large one-file Typograms.
- **The adapter reading a PDF Typogram** (today: SVG, HTML, text, `.tgst`, `.tgs`).
- **An independent cryptographic audit.** The cipher is standard and the code is tested and reviewed adversarially by AI
  agents, but no outside cryptographer has reviewed it; before anything valuable is sealed and shared, get a review.

## How to help

- Pick a task above, open an issue to say you are on it, and send a pull request.
- Add an example document or an agent-instruction one-pager (see `examples/`), or a gallery work (see `gallery/`).
- Port the technique: a reader or a self-extractor in another language, checked against the test vectors.
