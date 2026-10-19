# Bundles, sealed Typograms and handoff packages — plan (Phase I)

Status: **I1 (bundles) BUILT** (2026-10-19): `tg bundle` / `tg verify <folder>`, `cli/bundle.mjs`, [docs/bundles.md](bundles.md),
deterministic tests. **I2 (sealed Typograms) BUILT** (2026-10-19): `tg seal` / `tg open` / `tg seal-keygen`, `cli/seal.mjs`
(age via `vendor/age-encryption.mjs`), `tgart.mode="sealed"` + `SEALED VERIFIED/UNSIGNED/TAMPERED` in `tg verify`,
sign-before-decrypt, [docs/sealed.md](sealed.md), tests `test/seal.test.js` + `test/seal-cli.test.js` + a committed signed
fixture. **Deferred within I2** (not yet built, called out in docs/sealed.md): the `--inline-limit` + data-layer
attachment for payloads over 64 KB (payload is inline-only today), the envelope table of contents, and the browser
generator's seal flow with its cleartext-title warning. **Still needed for the LIVE issuer:** an X25519 sealing key in
`typographics-art.org`'s key file via the ceremony (`tg seal-keygen` → store the private identity in Infisical →
publish the `alg:"X25519"` entry). **I3 (handoff) still PLANNED.** Comes **after Phase H** (signing / issuers / seal),
because it reuses H2 (signature over the canonical hash), H3 (the visible seal block) and H4 (the embedded
verify-instructions), and the issuer key file H introduces. **Operator decision 18.10.: Phase I ships _before_ the public
launch**, as part of the first public release — so the launch now gates on the three-view core (B–G) + Phase H + Phase I.

This file is the specification of record (Rule 0: docs before code). The operator's spec is captured faithfully below;
anything added here beyond it is marked **[plan]** and is a recommendation, not a commitment.

## I1 — Bundle (a folder as a collection)

- `tg bundle <folder> -o <target>` turns a folder of Markdown files into a directory containing: `manifest.json`,
  `index.tg.{svg,html}` (the index Typogram) and one signed Typogram per document.
- `manifest.json`: `version`, `issuer`, `created`, and per document
  `{ path, title, summary (one line), hash, tokens, role (overview|core|reference|appendix|rules),
  origin (human|ai-summary|ai-generated), readOrder, relations: [{ type: supersedes|requires|extends, hash }] }`.
- The **index Typogram** is the manifest as readable text (title, purpose, the list of documents with a short hash,
  the reading order, the seal). It is signed like any document; because it carries every document hash, signing it
  seals the whole folder.
- `tg verify <folder>` checks the index signature, every document, and that every manifest hash matches its file.
  A missing or an extra file is an error.
- Ordering in the index and the manifest follows `readOrder`, not the file name.

## I2 — Sealed Typogram (encrypted mode)

- Encryption uses **age** (X25519, hybrid). The recipient key is an entry in that recipient's
  `.well-known/tgart-keys.json`: `{ kid, alg: "X25519", publicKey }`. Several recipients are allowed. No own crypto.
- A sealed Typogram is **always two parts in one text, in this order**:
  1. **Envelope, cleartext**: title, sender (`issuer`), recipient(s) (`issuer`/`kid`), date, a title-level table of
     contents (count and titles of the enclosed documents, optional), the note "sealed, age v1", and a seal block as
     in H3.
  2. **Payload**: the ciphertext as Base64 (age ASCII armor).
- The image layer is set from envelope + payload. **Limit:** if the payload exceeds 64 KB, the image layer shows the
  envelope plus the first 64 KB of the ciphertext; the full ciphertext is additionally carried as an attachment in the
  data layer. The hash always covers the full text. The limit is configurable (`--inline-limit`).
- Signature as in H2, over the canonical hash of the whole text (envelope + full ciphertext). **The signature is
  checked before decrypting; decryption happens only on VERIFIED.**
- The image title is visible in cleartext. The generator warns about this when sealing.
- Data-layer marking: `tgart.mode = "sealed"`, `tgart.recipients = [{ issuer, kid }]`, `tgart.cipher = "age-v1"`.
  `tg verify` reports `SEALED+VERIFIED` / `SEALED+TAMPERED` for sealed files.
- For bundles: "sealed bundle" = envelope + an encrypted zip of the bundle directory as payload. After opening, I1
  applies to the contents.
- The embedded instructions (H4) get an extra section for this mode: check the signature, then decrypt with your own
  key, then verify the decrypted content again as a Typogram / bundle.

## I3 — Handoff package

- `tg handoff <source...> --to <issuer>[:<kid>] [--title ...]`: gathers the named files/folders, builds the manifest,
  shows it, waits for confirmation, builds a sealed bundle, signs with the sender's key.
- `tg open <file>`: checks the sender signature, decrypts with your own key, verifies the enclosed bundle, shows the
  manifest, writes the files only after confirmation (`--yes` skips both confirmations).
- Both commands are also MCP tools (`tg_handoff`, `tg_open`) with the same steps; the confirmation is passed through to
  the user, not answered by the agent.
- **Responsibility:** what goes into a package is decided by the user and their agent. The tool selects nothing,
  silently filters nothing and does not abort. Before signing it shows the manifest (path, size, origin) and by default
  runs a secret scan that only **warns** (disable with `--no-scan`). Document this in `docs/handoff.md` under
  "Responsibility".
- `origin` per document is mandatory: files from the repo / filesystem = `human`, agent-written summaries =
  `ai-summary`, otherwise `ai-generated`. The agent sets the field when creating; `tg handoff` refuses a document with
  no `origin`.

## I4 — Tests and docs

- Tests: build/verify a bundle; a file in the bundle changed; seal then check signature, decrypt, verify the inside;
  wrong recipient; envelope changed; payload over `--inline-limit`.
- `docs/bundles.md`, `docs/sealed.md`, `docs/handoff.md`; a README section "Handing work to another team member" with
  the flow in five sentences.
- Repo example: `examples/handoff/` with a small signed, sealed package for a test issuer (keys for tests only, marked
  as such).

## Dependencies and cross-references into Phase H

- **[plan] The H key file must hold two key kinds from the start.** `.well-known/tgart-keys.json` (and
  `keys/<domain>.json`) already carries the Ed25519 **signing** keys (H). Phase I adds X25519 **recipient** keys in the
  same file (`alg: "X25519"`). Build the H schema as a list of `{ kid, alg, publicKey, created, ... }` so that
  `alg: "Ed25519"` (sign/verify) and `alg: "X25519"` (seal recipient) coexist and `tg verify` / `tg seal` pick by
  `alg`. This avoids reworking the key file when I lands.
- Reuses H2 (`"tgart-sig-v1\n" + hash + ...` signature), H3 (seal block as the last visible line), H4 (embedded
  `verify-instructions.v1.txt`), and `tg verify`'s three-state result, extended with `SEALED+VERIFIED` /
  `SEALED+TAMPERED`.

## Open decisions (operator)

1. **age implementation — [plan] recommend a vendored JS age library (`age-encryption`), not shelling out to the `age`
   CLI.** Basis: sealing is a core feature (unlike PDF, which optionally shells out to MuPDF), the project already
   vendors `noble-hashes` for Argon2id and has an in-process Node+browser crypto story, and a JS implementation keeps
   sealing streamable and dependency-free at runtime. The payload stays standard age ASCII-armor, so the `age`/`rage`
   CLI can still open it — interop, not a dependency. Alternative: shell out to `age` (reference implementation, no JS
   dependency, but a required external binary and no in-process/browser path). Default unless the operator chooses the
   CLI.
2. **Sequencing vs. public — DECIDED (operator, 18.10.): ship Phase I _before_ the public launch**, as part of the
   first public release. The earlier recommendation to defer to 0.2 is superseded. The public launch now gates on:
   three-view (B–G) + Phase H + Phase I.

## Build order (when Phase I starts)

1. Extend the H key file schema for `alg: "X25519"` recipient keys (if not already done in H) + `tg keygen --x25519`.
2. `src/bundle.js` (manifest build/verify, index-Typogram text) + `tg bundle` / `tg verify <folder>`.
3. `src/seal.js` (age seal/open, envelope build/parse, inline-limit + data-layer attachment) + sealed mode in `tg
   verify` (sign-before-decrypt) and the generator's cleartext-title warning.
4. `tg handoff` / `tg open` + the `tg_handoff` / `tg_open` MCP tools (confirmation passed through, never auto-answered).
5. Secret scan (warn-only) + `origin` enforcement.
6. Tests (I4), `docs/bundles.md`, `docs/sealed.md`, `docs/handoff.md`, README section, `examples/handoff/` with a
   test-only issuer.
