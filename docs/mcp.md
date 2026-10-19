# MCP server — let an AI agent check provenance

[`mcp/server.mjs`](../mcp/server.mjs) is a [Model Context Protocol](https://modelcontextprotocol.io) server, so an agent
that speaks MCP can **verify a signed [Typogram](technique.md), read what it carries, and look up a verified issuer key** as
tool calls. It is dependency-free (a small newline-delimited JSON-RPC stdio server) and exposes only **read-only** tools.

## Tools

| Tool | What it does |
|---|---|
| `tg_verify` | Verify a Typogram (SVG or HTML text) against the [verified-issuer registry](key-registry.md): VERIFIED / UNSIGNED / TAMPERED (SEALED for an encrypted work), with issuer, key id and identity hash. |
| `tg_extract` | Read what a Typogram carries — the exact embedded source (`markdown`), the JSON-LD record (`json`), or the plain text. |
| `tg_keys` | Look up verified issuer signing keys. With an `issuer`, returns that entry; without, lists all issuers. Public keys only. |

The private-key operations — `tg seal`, `tg handoff`, `tg open` — are **not** MCP tools: they use a secret key and a
human confirmation that an agent must not auto-answer. Run them from the [CLI](handoff.md). (The `tg_handoff` / `tg_open`
MCP tools, with the confirmation passed through to the person, are planned — see the [plan](bundles-sealed-handoff-plan.md).)

## Add it to a client

Point your MCP client at the server over stdio. For a Claude Desktop-style config:

```json
{
  "mcpServers": {
    "typographics-art": {
      "command": "node",
      "args": ["/path/to/typogram/mcp/server.mjs"]
    }
  }
}
```

Installed from npm (`npm i -g typogram`), the command is `tg-mcp` with no args.

## Try it over stdio

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"tg_keys","arguments":{}}}' \
  | node mcp/server.mjs
```
