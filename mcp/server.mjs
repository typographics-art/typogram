#!/usr/bin/env node
// A Model Context Protocol server for Typographics Art, so an AI agent that speaks MCP can verify a signed work, read
// what it carries, and look up a verified issuer key — the core "can a machine check provenance" use case. Dependency
// free: a minimal newline-delimited JSON-RPC stdio server that shells out to the `tg` CLI for verify/extract and reads
// the key registry directly. Only READ-ONLY tools are exposed here; the private-key operations (seal, handoff, open) are
// deliberately NOT MCP tools yet — they involve a secret key and a human confirmation that an agent must not auto-answer.
//
//   node mcp/server.mjs            # speaks MCP over stdio
import { createInterface } from 'node:readline';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const TG = join(ROOT, 'cli', 'tg.mjs');
const REGISTRY = join(ROOT, 'keys', 'registry.json');
export const SERVER_INFO = { name: 'typographics-art', version: '0.1.0' };
const PROTOCOL = '2024-11-05';

const guessExt = (content, format) => (format === 'html' || format === 'svg' ? format : /<!doctype html|<html\b/i.test(content) ? 'html' : 'svg');

/** Run `tg` on a throwaway file holding `content` (the token "@FILE" in args is replaced by its path). */
function runTg(args, content, ext) {
  const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'tg-mcp-'));
  try {
    const f = join(dir, 'work.' + ext);
    writeFileSync(f, content);
    const r = spawnSync('node', [TG, ...args.map((a) => (a === '@FILE' ? f : a))], { encoding: 'utf8', maxBuffer: 1 << 27 });
    return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

export const TOOLS = [
  {
    name: 'tg_verify',
    description: 'Verify a Typographics Art work (an SVG or HTML Typogram, given as text) against the verified-issuer key registry. Returns VERIFIED / UNSIGNED / TAMPERED (and SEALED for an encrypted work), with the issuer, key id and identity hash.',
    inputSchema: { type: 'object', properties: { content: { type: 'string', description: 'The Typogram file as text (SVG or HTML).' }, format: { type: 'string', enum: ['svg', 'html'], description: 'Optional; inferred otherwise.' } }, required: ['content'] },
  },
  {
    name: 'tg_extract',
    description: 'Read what a Typogram carries: its exact embedded source (markdown), its JSON-LD record (json), or the plain text. Does not verify — pair with tg_verify.',
    inputSchema: { type: 'object', properties: { content: { type: 'string' }, format: { type: 'string', enum: ['svg', 'html'] }, mode: { type: 'string', enum: ['markdown', 'json', 'text'], description: 'Default markdown.' } }, required: ['content'] },
  },
  {
    name: 'tg_keys',
    description: 'Look up verified Typographics Art issuer signing keys from the registry. With an issuer, returns that issuer\'s entry; without, lists all issuers. These are public keys used to verify signed works.',
    inputSchema: { type: 'object', properties: { issuer: { type: 'string', description: 'A hostname, e.g. typographics-art.org. Omit to list all.' } } },
  },
];

const text = (s, isError = false) => ({ content: [{ type: 'text', text: String(s) }], isError });

export async function callTool(name, args = {}) {
  if (name === 'tg_verify') {
    if (typeof args.content !== 'string') return text('tg_verify needs a "content" string.', true);
    const r = runTg(['verify', '@FILE', '--keys', REGISTRY], args.content, guessExt(args.content, args.format));
    return text((r.stdout + r.stderr).trim() || 'no output', r.status === 1);
  }
  if (name === 'tg_extract') {
    if (typeof args.content !== 'string') return text('tg_extract needs a "content" string.', true);
    const mode = args.mode === 'json' ? '--json' : args.mode === 'text' ? '--text' : '--markdown';
    const r = runTg(['extract', '@FILE', mode], args.content, guessExt(args.content, args.format));
    return text((r.stdout || r.stderr).trim() || 'no output', r.status !== 0);
  }
  if (name === 'tg_keys') {
    let reg; try { reg = JSON.parse(readFileSync(REGISTRY, 'utf8')); } catch { return text('the key registry is unavailable.', true); }
    if (args.issuer) {
      const e = (reg.issuers || []).find((x) => x.issuer === args.issuer);
      return e ? text(JSON.stringify(e, null, 2)) : text(`no verified keys for ${args.issuer}. Known: ${(reg.issuers || []).map((x) => x.issuer).join(', ') || '(none)'}`, true);
    }
    return text(JSON.stringify({ spec: reg.spec, updated: reg.updated, issuers: (reg.issuers || []).map((x) => ({ issuer: x.issuer, verifiedAt: x.verifiedAt, keys: x.keys.map((k) => `${k.alg || 'Ed25519'}:${k.kid}`) })) }, null, 2));
  }
  return text(`unknown tool: ${name}`, true);
}

/** Handle one JSON-RPC message; returns the response object, or null for a notification. */
export async function handleMessage(msg) {
  const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: msg.id, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0') return msg && msg.id != null ? fail(-32600, 'invalid request') : null;
  switch (msg.method) {
    case 'initialize': return reply({ protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
    case 'tools/list': return reply({ tools: TOOLS });
    case 'tools/call': {
      const { name, arguments: args } = msg.params || {};
      try { return reply(await callTool(name, args || {})); } catch (e) { return reply(text(`error: ${e.message}`, true)); }
    }
    case 'ping': return reply({});
    default:
      if (msg.id == null) return null;                      // an unknown notification
      return fail(-32601, `method not found: ${msg.method}`);
  }
}

// stdio loop: one JSON-RPC message per line (MCP stdio transport).
if (import.meta.url === `file://${process.argv[1]}`) {
  const rl = createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    const s = line.trim(); if (!s) return;
    let msg; try { msg = JSON.parse(s); } catch { return; }
    const res = await handleMessage(msg);
    if (res) process.stdout.write(JSON.stringify(res) + '\n');
  });
}
