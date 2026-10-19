# Handoff packages — hand a set of files to another person or agent

A **handoff** is a set of files one person (or their agent) hands to another, as a single sealed, signed
[Typogram](README.md). The files are packed into one archive; that archive is [sealed](sealed.md) to the recipient's
key and signed with the sender's key. So `tg verify` proves who sent it, and `tg open` checks the signature, decrypts
with the recipient's key, and writes the files out — after showing exactly what is inside.

It composes the two pieces already in place: a [sealed Typogram](sealed.md) (the envelope + encrypted payload, verified
before decryption) whose payload is a [bundle](bundles.md)-like archive of files.

## Send

```sh
tg handoff report.md data/ \
  --to recipient.org:seal-2026-10=age1… \
  --key sender-signing-key.pem --issuer sender.org --kid 2026-10 \
  --out handoff.tg.svg
```

Before it builds anything, `tg handoff` **shows the manifest** — every file, its size and its origin — and runs a
**warn-only secret scan**, then stops. It only builds the sealed package when you add `--yes`. Several `--to` recipients
are allowed; any one of their keys can open it.

## Receive

```sh
tg verify handoff.tg.svg --keys ./keys                 # SEALED VERIFIED — who sent it, unchanged
tg open handoff.tg.svg --identity my.age --keys ./keys # shows the manifest, then stops
tg open handoff.tg.svg --identity my.age --keys ./keys --out ./incoming --yes   # writes the files
```

`tg open` verifies the sender's signature **first** and refuses anything that is not VERIFIED, so a tampered package
never reaches the cipher. It then decrypts, checks each file against the manifest hash, shows the manifest, and writes
the files only on `--yes` — never outside the `--out` directory.

## Responsibility

**What goes into a package is decided by you and your agent.** The tool selects nothing, filters nothing silently and
does not abort: it shows every file (path, size, origin) and, by default, warns about anything that looks like a secret
(disable with `--no-scan`). The envelope — title, sender, recipients, date and the file list — is **public**; only the
file contents are encrypted. Do not put a secret in a path or the title.

Every file carries an **origin**, set with `--origin`: `human` for files from a repo or filesystem, `ai-summary` for an
agent's own summary, `ai-generated` otherwise. An agent handing work on should set the origin honestly so the receiver
knows what was written by a model.

## Not yet built

The `tg_handoff` / `tg_open` **MCP tools** (the same steps as a tool a chat agent can call, with the confirmation passed
through to the person, never auto-answered) are planned — see the [plan](bundles-sealed-handoff-plan.md). Today the flow
is the `tg` CLI.
