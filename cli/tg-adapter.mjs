#!/usr/bin/env node
// tg-adapter — a local decrypting gateway (docs/encrypted-media-adapter.md). It makes a sealed file readable by ANY
// ordinary player or program, on the fly: give it the key and a sealed source, and it serves the plaintext over
// http://127.0.0.1:<port>/… with the right Content-Type and HTTP Range, decrypting only the frames a byte range touches.
// Nothing is written to disk, nothing is uploaded, the key stays in memory for the server's lifetime.
//
//   tg-adapter seal  <file> [--work <f>] [-o out.tgst] [--type <mime>] [--frame <bytes>]     seal media as a stream; prints the KEY
//   tg-adapter serve <sealed> (--key-file <f> | --key-stdin | TG_CRYPT_KEY) [--work <f>] [--port <n>]
//
// <sealed> is a .tgst stream file (video, large media) or a tgs1. sealed record (a small file, a data file). The key is a
// tgx1./tgx2. key string; a bound source also needs --work (the work's text file).
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, openSync, writeSync, closeSync } from 'node:fs';
import { extname, basename } from 'node:path';
import { parseArgs } from 'node:util';
import { sealStream, StreamReader } from '../src/stream.js';
import { openSealed, parseKey, workDigest, CryptError } from '../src/crypt.js';
import { parseKey2, formatKey2 } from '../src/keys-work.js';
import { decode, toFile, OPEN, CLOSE } from '../src/structured.js';

const MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime', '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.oga': 'audio/ogg', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.opus': 'audio/opus',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
};
const mimeByName = (name) => MIME[extname(name).toLowerCase()] || 'application/octet-stream';
const die = (m) => { console.error(`tg-adapter: ${m}`); process.exit(1); };

// The metadata (media type, name) of a sealed stream is set by whoever sealed it, so it is untrusted. A browser that
// navigates to the served URL would run script if we echoed e.g. text/html or image/svg+xml as the Content-Type. So only
// media that a browser renders without executing anything is served inline with its own type; everything else is served
// as an octet-stream download. nosniff stops the browser from guessing a different type, and the CSP neutralises any
// document that is shown directly.
const SAFE_INLINE = (m) => /^(audio|video)\//.test(m) || (/^image\//.test(m) && m !== 'image/svg+xml') || m === 'application/pdf';
const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'no-store' };
const asciiName = (name, fallback) => (name || fallback).replace(/[^\w.\- ]/g, '_');
/** Content-Type and Content-Disposition for a (possibly untrusted) media type: render it inline only if it is safe. */
function presentation(media, name, fallback) {
  const safe = SAFE_INLINE(media);
  return {
    'Content-Type': safe ? media : 'application/octet-stream',
    'Content-Disposition': `${safe ? 'inline' : 'attachment'}; filename="${asciiName(name, fallback)}"`,
  };
}

function readText(opt, env, values) {
  if (values[`${opt}-file`]) return readFileSync(values[`${opt}-file`], 'utf8');
  if (values[`${opt}-stdin`]) return readFileSync(0, 'utf8');
  if (env && process.env[env]) return process.env[env];
  return null;
}
const trimKey = (s) => (s || '').replace(/\s+/g, '');

/** The 16/32-byte secret of a tgx1./tgx2. key (for a stream), and whether the KEY says it is bound. */
async function keyToSecret(keyString) {
  const k = trimKey(keyString);
  if (k.startsWith('tgx2.')) { const p = await parseKey2(k); return { secret: p.secret, bound: p.bound }; }
  if (k.startsWith('tgx1.')) { const p = await parseKey(k); return { secret: p.secret, bound: p.bound }; }
  throw new CryptError('bad-prefix', 'The key starts with "tgx1." or "tgx2."');
}

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start, end;
  if (m[1] === '') { start = Math.max(0, size - Number(m[2])); end = size - 1; }       // suffix: last N bytes
  else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(size - 1, Number(m[2])); }
  if (start > end || start >= size) return { invalid: true };
  return { start, end };
}

// ---- serve a stream (video, large media): Content-Type + Range, frames decrypted on demand -------------------------
async function serveStream(file, keyString, workText, port) {
  const reader = new StreamReader(file);
  const { secret } = await keyToSecret(keyString);
  const wd = reader.bound ? await workDigest(workText ?? die('this stream is tied to a work: pass --work <file>')) : null;
  const meta = await reader.open(secret, wd); // throws bad-key on a wrong key
  const name = meta.name || 'stream';
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
      const range = parseRange(req.headers.range, reader.size);
      if (range?.invalid) { res.writeHead(416, { 'Content-Range': `bytes */${reader.size}` }).end(); return; }
      const start = range ? range.start : 0, end = range ? range.end : reader.size - 1;
      res.writeHead(range ? 206 : 200, {
        ...presentation(meta.media, meta.name, 'stream'), 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes',
        ...SECURITY_HEADERS, ...(range ? { 'Content-Range': `bytes ${start}-${end}/${reader.size}` } : {}),
      });
      if (req.method === 'HEAD' || reader.size === 0) { res.end(); return; }
      // stream frame by frame: one frame in memory at a time, each still authenticated
      const first = Math.floor(start / reader.frameSize), last = Math.floor(end / reader.frameSize);
      for (let i = first; i <= last; i++) {
        const plain = await reader.frame(i), base = i * reader.frameSize;
        const a = Math.max(start, base) - base, b = Math.min(end + 1, base + plain.length) - base;
        if (!res.write(Buffer.from(plain.subarray(a, b)))) await new Promise((r) => res.once('drain', r));
      }
      res.end();
    } catch (e) { if (!res.headersSent) res.writeHead(e?.code === 'bad-key' ? 403 : 500).end(String(e?.message || e)); else res.destroy(); }
  });
  return { server, name, media: meta.media, size: reader.size };
}

// ---- serve a small sealed record (a data file, or a small media file): decrypt once, serve native format ----------
async function serveRecord(recordText, keyString, workText, port) {
  const opened = await openSealed(workText ?? '', { key: trimKey(keyString), record: recordText });
  let body, media, name;
  if (opened.kind === 'tgd') {
    // the record holds the inner block (no markers); decode() looks for a full TGD1[…]TGD1, so re-wrap it
    const block = await decode(OPEN + new TextDecoder().decode(opened.bytes) + CLOSE);
    const out = await toFile(block); // native format (block.format), e.g. .csv/.json/.xlsx
    body = Buffer.from(out.bytes); media = out.mime; name = out.name;
  } else {
    body = Buffer.from(opened.bytes); media = 'application/octet-stream'; name = 'data';
  }
  const server = createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    // `media` here is a native data type from our own writer (text/csv, application/json, …), never text/html or svg, so
    // the type is safe to keep; it is served as a download (a program's fetch ignores the disposition) with nosniff + CSP
    // so a browser never renders it as a page.
    res.writeHead(200, { 'Content-Type': media, 'Content-Length': String(body.length), 'Accept-Ranges': 'none',
      'Content-Disposition': `attachment; filename="${asciiName(name, 'data')}"`, ...SECURITY_HEADERS });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  return { server, name, media, size: body.length };
}

async function cmdServe(values, positionals) {
  const src = positionals[0] || die('give the sealed file to serve');
  const keyString = readText('key', 'TG_CRYPT_KEY', values) || die('give the key: --key-file <f>, --key-stdin or TG_CRYPT_KEY');
  const workText = values.work ? readFileSync(values.work, 'utf8') : null;
  const raw = readFileSync(src);
  const asText = Buffer.from(raw.subarray(0, 5)).toString('latin1');
  let built;
  try {
    if (asText === 'TGST1') built = await serveStream(new Uint8Array(raw), keyString, workText, values.port);
    else if (raw.toString('utf8', 0, 5) === 'tgs1.') built = await serveRecord(raw.toString('utf8').trim(), keyString, workText, values.port);
    else die('not a sealed source (expected a .tgst stream or a tgs1. record)');
  } catch (e) { die(e?.code === 'bad-key' ? 'the key does not open this file' : e?.message || String(e)); }
  const token = Buffer.from((globalThis.crypto.getRandomValues(new Uint8Array(9)))).toString('base64url');
  const { server, name, media, size } = built;
  await new Promise((r) => server.listen(Number(values.port) || 0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/${token}/${encodeURIComponent(name)}`;
  // one path token: requests to other paths get 404, so a stray local request cannot read the plaintext by guessing
  const inner = server.listeners('request')[0];
  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    if (!req.url.startsWith(`/${token}/`)) { res.writeHead(404).end(); return; }
    req.url = req.url.slice(`/${token}`.length);
    inner(req, res);
  });
  console.error(`tg-adapter: serving ${media} (${size} bytes) at`);
  console.log(base);
  console.error('open that URL in any player (browser <video>, VLC, mpv). Ctrl-C to stop; nothing is written to disk.');
}

async function cmdSeal(values, positionals) {
  const src = positionals[0] || die('give the media file to seal');
  const bytes = new Uint8Array(readFileSync(src));
  const media = values.type || mimeByName(src);
  const workText = values.work ? readFileSync(values.work, 'utf8') : null;
  const digest = workText ? await workDigest(workText) : null;
  const secret = new Uint8Array(32); globalThis.crypto.getRandomValues(secret);
  const file = await sealStream({ secret, workDigest: digest, bytes, media, name: basename(src), frameSize: values.frame ? Number(values.frame) : undefined });
  const out = values.out || `${src}.tgst`;
  const fd = openSync(out, 'wx', 0o600); try { writeSync(fd, Buffer.from(file)); } finally { closeSync(fd); }
  const key = await formatKey2({ secret, digest });
  console.error(`tg-adapter: sealed ${bytes.length} bytes of ${media} -> ${out}${digest ? ' (tied to the work)' : ''}. The KEY (keep it safe):`);
  console.log(key);
}

const OPTIONS = {
  'key-file': { type: 'string' }, 'key-stdin': { type: 'boolean' }, work: { type: 'string' },
  port: { type: 'string' }, out: { type: 'string', short: 'o' }, type: { type: 'string' }, frame: { type: 'string' },
};
const { values, positionals } = parseArgs({ allowPositionals: true, options: OPTIONS });
const cmd = positionals.shift();
if (cmd === 'seal') await cmdSeal(values, positionals);
else if (cmd === 'serve') await cmdServe(values, positionals);
else die('usage: tg-adapter seal <file> [-o out.tgst] [--work <f>] [--type <mime>]  |  tg-adapter serve <sealed> --key-file <f> [--work <f>] [--port <n>]');
