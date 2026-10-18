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
import { markupText } from '../src/work-text.js';
import { canonicalText } from '../src/secret.js';
import { readDataMarkdown, readJsonld, embedStream, readEmbeddedStream } from '../src/typogram.js';

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
// A one-shot server for a small payload already decrypted/decoded in memory. `media` is a native data type from our own
// writer (text/csv, application/json, …), never text/html or svg; it is served as a download (a program's fetch ignores
// the disposition) with nosniff + CSP so a browser never renders it as a page.
function staticServer(body, media, name) {
  const server = createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    res.writeHead(200, { 'Content-Type': media, 'Content-Length': String(body.length), 'Accept-Ranges': 'none',
      'Content-Disposition': `attachment; filename="${asciiName(name, 'data')}"`, ...SECURITY_HEADERS });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  return { server, name, media, size: body.length };
}

/** A decoded TGD block served as its native format (.csv/.json/.xlsx …). */
async function serveTgd(block) {
  const out = await toFile(block);
  return staticServer(Buffer.from(out.bytes), out.mime, out.name);
}

async function serveRecord(recordText, keyString, workText) {
  const opened = await openSealed(workText ?? '', { key: trimKey(keyString), record: recordText });
  // a tgd record holds the inner block (no markers); decode() looks for a full TGD1[…]TGD1, so re-wrap it
  if (opened.kind === 'tgd') return serveTgd(await decode(OPEN + new TextDecoder().decode(opened.bytes) + CLOSE));
  return staticServer(Buffer.from(opened.bytes), 'application/octet-stream', 'data');
}

// ---- serve a Typogram work file (.svg/.html/.txt): extract its data and serve it as the native format ---------------
async function serveWork(text, ext, keyString, workText) {
  const visible = ext === '.svg' ? markupText(text, 'svg') : (ext === '.html' || ext === '.htm') ? markupText(text, 'html') : text;
  const canon = canonicalText(visible);
  if (canon.includes(OPEN)) { // a plain (unsealed) TGD data block sits in the work's visible text
    try { return await serveTgd(await decode(canon)); }
    catch (e) { die(`the data block in this Typogram could not be read: ${e?.message || e}`); }
  }
  const sealed = /tgs1\.[A-Za-z0-9_-]+/.exec(text);
  if (sealed) {
    if (!keyString) die('this Typogram holds sealed data: give the key with --key-file/--key-stdin');
    return serveRecord(sealed[0], keyString, workText ?? visible); // the work's own text binds the key
  }
  const src = readDataMarkdown(text); // the exact source (Markdown, code) from the data layer: formatting the picture normalised away
  if (src) return staticServer(Buffer.from(src.markdown, 'utf8'), src.media, 'source' + (src.media.includes('markdown') ? '.md' : '.txt'));
  die('no data found in this Typogram (it is a picture only)');
}

async function cmdServe(values, positionals) {
  const src = positionals[0] || die('give the file to serve');
  const keyString = readText('key', 'TG_CRYPT_KEY', values); // optional: unsealed data in a Typogram needs no key
  const workText = values.work ? readFileSync(values.work, 'utf8') : null;
  const raw = readFileSync(src);
  const head = Buffer.from(raw.subarray(0, 5)).toString('latin1');
  const ext = extname(src).toLowerCase();
  let built;
  try {
    if (head === 'TGST1') built = await serveStream(new Uint8Array(raw), keyString || die('this stream needs a key: --key-file/--key-stdin'), workText);
    else {
      const txt = raw.toString('utf8');
      const embedded = (ext === '.svg' || txt.includes('<svg')) ? readEmbeddedStream(txt) : null;
      if (embedded) built = await serveStream(embedded, keyString || die('this Typogram holds a sealed stream: give the key with --key-file/--key-stdin'), workText ?? markupText(txt, 'svg'));
      else if (txt.trimStart().startsWith('tgs1.')) built = await serveRecord(txt.trim(), keyString || die('this record needs a key: --key-file/--key-stdin'), workText);
      else if (['.svg', '.html', '.htm', '.txt'].includes(ext) || txt.includes('<svg') || txt.includes(OPEN)) built = await serveWork(txt, ext || '.txt', keyString, workText);
      else die('not a Typogram or sealed source (expected .svg, .tgst or .tgs, or a work holding a data block)');
    }
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
// Prints what a file is and the Typogram metadata it carries — no key needed (the metadata of a sealed stream stays encrypted).
async function cmdInfo(_values, positionals) {
  const src = positionals[0] || die('give the file to inspect');
  const raw = readFileSync(src);
  const head = Buffer.from(raw.subarray(0, 5)).toString('latin1');
  const ext = extname(src).toLowerCase();
  let info;
  if (head === 'TGST1') {
    const r = new StreamReader(new Uint8Array(raw));
    info = { kind: 'tgst1 stream', bound: r.bound, size: r.size, frameSize: r.frameSize, frameCount: r.frameCount, note: 'media type and name are in the encrypted metadata; open with the key to read them' };
  } else {
    const txt = raw.toString('utf8');
    const jsonld = readJsonld(txt);
    const source = readDataMarkdown(txt);
    const visible = ext === '.svg' ? markupText(txt, 'svg') : (ext === '.html' || ext === '.htm') ? markupText(txt, 'html') : txt;
    const hasDataBlock = canonicalText(visible).includes(OPEN), hasSealed = /tgs1\.[A-Za-z0-9_-]+/.test(txt), hasEmbeddedStream = !!readEmbeddedStream(txt);
    const kind = hasEmbeddedStream ? 'typogram (stream)' : hasSealed ? 'typogram (sealed)' : hasDataBlock ? 'typogram (data)'
      : (jsonld || source) ? 'typogram (art)' : txt.trimStart().startsWith('tgs1.') ? 'tgs1 record' : 'unknown';
    info = {
      kind, jsonld, hasDataBlock, hasSealed, hasEmbeddedStream,
      source: source ? { media: source.media, chars: source.markdown.length } : null,
    };
  }
  console.log(JSON.stringify(info, null, 2));
}

// Writes (or prints) the exact source kept inside a Typogram — the original formatting (Markdown tables, lists, code) that
// the visible picture text normalised away.
async function cmdSource(values, positionals) {
  const src = positionals[0] || die('give the Typogram to read the source from');
  const source = readDataMarkdown(readFileSync(src, 'utf8'));
  if (!source) die('this Typogram carries no embedded source');
  const bytes = Buffer.from(source.markdown, 'utf8');
  if (values.out) { const fd = openSync(values.out, 'wx', 0o600); try { writeSync(fd, bytes); } finally { closeSync(fd); } console.error(`tg-adapter: wrote ${bytes.length} bytes of ${source.media} to ${values.out}`); }
  else process.stdout.write(bytes);
}

// Embeds a media file into a cover Typogram SVG as a sealed stream, so the ONE SVG holds the whole video and still opens as
// the picture; prints the key. (docs/typogram-file.md §1: everything in one file.)
async function cmdEmbed(values, positionals) {
  const cover = positionals[0] || die('give the cover Typogram SVG');
  const mediaFile = positionals[1] || die('give the media file to embed');
  const svgText = readFileSync(cover, 'utf8');
  if (!svgText.includes('<svg')) die('the cover must be an SVG Typogram');
  if (readEmbeddedStream(svgText)) die('this cover already holds an embedded stream');
  const bytes = new Uint8Array(readFileSync(mediaFile));
  const media = values.type || mimeByName(mediaFile);
  const workText = values.work ? readFileSync(values.work, 'utf8') : markupText(svgText, 'svg'); // bind to the cover's own text by default
  const digest = await workDigest(workText);
  const secret = new Uint8Array(32); globalThis.crypto.getRandomValues(secret);
  const stream = await sealStream({ secret, workDigest: digest, bytes, media, name: basename(mediaFile), frameSize: values.frame ? Number(values.frame) : undefined });
  // The cover's data layer (its exact source + JSON-LD) stays as it is; the sealed video is appended as <tgstream> before </svg>.
  const out = embedStream(svgText, stream);
  const dest = values.out || cover.replace(/\.svg$/, '') + '.typogram.svg';
  const fd = openSync(dest, 'wx', 0o600); try { writeSync(fd, out); } finally { closeSync(fd); }
  const key = await formatKey2({ secret, digest });
  console.error(`tg-adapter: embedded ${bytes.length} bytes of ${media} into ${dest} (one SVG: picture + video, tied to the cover). The KEY (keep it safe):`);
  console.log(key);
}

const { values, positionals } = parseArgs({ allowPositionals: true, options: OPTIONS });
const cmd = positionals.shift();
if (cmd === 'seal') await cmdSeal(values, positionals);
else if (cmd === 'embed') await cmdEmbed(values, positionals);
else if (cmd === 'serve') await cmdServe(values, positionals);
else if (cmd === 'info') await cmdInfo(values, positionals);
else if (cmd === 'source') await cmdSource(values, positionals);
else die('usage: tg-adapter seal <file> [-o out.tgst] [--work <f>]  |  tg-adapter embed <cover.svg> <media> [-o out.svg] [--work <f>]  |  tg-adapter serve <file.svg|.tgst|.tgs> [--key-file <f>] [--work <f>]  |  tg-adapter source <file.svg> [-o out.md]  |  tg-adapter info <file>');
