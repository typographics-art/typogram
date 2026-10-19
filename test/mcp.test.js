// The MCP server (mcp/server.mjs): the JSON-RPC handshake, the tool list, and the three read-only tools — tg_verify
// (against the registry), tg_extract, and tg_keys. tg_verify/tg_extract shell out to the CLI on a real signed work
// (about/typographics-art.svg, signed by typographics-art.org, which is in the committed registry).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleMessage, callTool, TOOLS } from '../mcp/server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const req = (id, method, params) => handleMessage({ jsonrpc: '2.0', id, method, params });

test('initialize returns the protocol version and server info', async () => {
  const r = await req(1, 'initialize', {});
  assert.equal(r.result.protocolVersion, '2024-11-05');
  assert.equal(r.result.serverInfo.name, 'typographics-art');
  assert.ok(r.result.capabilities.tools);
});

test('tools/list offers the three read-only tools', async () => {
  const r = await req(2, 'tools/list', {});
  assert.deepEqual(r.result.tools.map((t) => t.name).sort(), ['tg_extract', 'tg_keys', 'tg_verify']);
  for (const t of r.result.tools) assert.equal(t.inputSchema.type, 'object');
});

test('tg_keys lists issuers and returns one, and errors on an unknown issuer', async () => {
  const all = await callTool('tg_keys', {});
  assert.match(all.content[0].text, /typographics-art\.org/);
  const one = await callTool('tg_keys', { issuer: 'typographics-art.org' });
  assert.match(one.content[0].text, /"issuer": "typographics-art\.org"/);
  const miss = await callTool('tg_keys', { issuer: 'nope.example' });
  assert.equal(miss.isError, true);
});

test('tg_verify checks a signed work against the registry', { skip: !existsSync(join(ROOT, 'about', 'typographics-art.svg')) }, async () => {
  const content = readFileSync(join(ROOT, 'about', 'typographics-art.svg'), 'utf8');
  const r = await callTool('tg_verify', { content });
  assert.match(r.content[0].text, /VERIFIED/);
  assert.ok(!r.isError);
});

test('tg_extract reads the embedded source of a Typogram', () => {
  const svg = join(ROOT, 'test', 'fixtures', 'seal', 'note.sealed.tg.svg');
  return callTool('tg_extract', { content: readFileSync(svg, 'utf8'), mode: 'markdown' }).then((r) => {
    assert.match(r.content[0].text, /Sealed note|BEGIN AGE ENCRYPTED FILE/);
  });
});

test('tools/call on an unknown tool is an error, and a notification gets no reply', async () => {
  const r = await req(3, 'tools/call', { name: 'nope', arguments: {} });
  assert.equal(r.result.isError, true);
  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});
