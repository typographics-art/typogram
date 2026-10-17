// Drives a headless Chrome/Chromium through the DevTools Protocol to render artworks outside the
// browser UI. No dependencies: Node's http server serves the repository, Node's WebSocket talks to Chrome.
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, statSync, renameSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, normalize, extname, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const mac = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'];
  for (const p of mac) if (existsSync(p)) return p;
  for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome']) {
    const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim().split('\n')[0];
  }
  return null;
}

/** Serves the repository read-only on a random local port. */
function serveRoot() {
  const server = createServer(async (req, res) => {
    let path;
    try { path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, ''); } catch { res.writeHead(400); res.end(); return; } // a malformed %-escape must not end the process
    const file = join(ROOT, path);
    if (!(file + sep).startsWith(ROOT + sep) && file !== ROOT) { res.writeHead(403); res.end(); return; }
    // The pages render from src/, cli/ and the fonts; nothing else of the repository has to be reachable.
    if (/^(\.|api[/\\]|test[/\\]|node_modules[/\\])/.test(path)) { res.writeHead(403); res.end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('Could not connect to Chrome')); });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  return { send, close: () => ws.close() };
}

/** Starts Chrome and the file server; returns a session that can render many artworks. */
export async function openSession({ chrome = findChrome() } = {}) {
  if (typeof WebSocket === 'undefined') throw new Error('The CLI needs Node.js 22 or newer (global WebSocket).');
  if (!chrome) throw new Error('No Chrome or Chromium found. Install one or set CHROME_PATH.');
  const server = await serveRoot();
  const profile = mkdtempSync(join(tmpdir(), 'tg-art-'));
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank'];
  // Containers without user namespaces (e.g. the paid API in Kubernetes) cannot run Chrome's sandbox,
  // and their /dev/shm is small.
  if (process.getuid?.() === 0 || process.env.CHROME_NO_SANDBOX) args.unshift('--no-sandbox', '--disable-dev-shm-usage');
  const proc = spawn(chrome, args, { stdio: 'ignore' });
  let port = null;
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(100);
    try { port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { /* not written yet */ }
  }
  if (!port) { proc.kill(); server.close(); throw new Error('Chrome did not start'); }
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const cdp = await connect(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/cli/render.html` });
  for (let i = 0; i < 100; i++) {
    const r = await cdp.send('Runtime.evaluate', { expression: 'window.tgReady === true', returnByValue: true });
    if (r.result.value) break;
    await sleep(100);
  }

  return {
    /**
     * @param {string} text
     * @param {string} image  data URL, or "recipe:<name>" for a built-in procedural image
     * @param {object} options  library options plus fill (Lorem ipsum target length) and scale (PNG)
     * @param {'svg'|'html'|'png'|'jpg'|'pdf'} format
     * @returns {Promise<{meta:object, data:Buffer|string}>}
     */
    async render(text, image, options, format) {
      const call = `window.tgRender(${JSON.stringify(text)}, ${JSON.stringify(image)}, ${JSON.stringify(options)}, ${JSON.stringify(format)})`;
      const r = await cdp.send('Runtime.evaluate', { expression: call, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      const { meta, data } = r.result.value;
      if (format === 'pdf') {
        const file = join(profile, 'out.pdf');
        const size = await this.printPoster(file, { lines: meta.lines, characters: meta.characters, mmPerPx: meta.mmPerPx, glyphsPerStrip: options.glyphsPerStrip });
        const data = readFileSync(file);
        rmSync(file, { force: true });
        return { meta: { ...meta, pageMm: [size.widthMm, size.heightMm], strips: size.strips }, data };
      }
      if (format === 'png' || format === 'jpg') return { meta, data: Buffer.from(data.split(',')[1], 'base64') };
      return { meta, data };
    },
    /** Calls window[name](...args) in the render page and returns its (JSON) result. */
    async call(name, ...args) {
      const expr = `window[${JSON.stringify(name)}](...${JSON.stringify(args)})`;
      const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    /**
     * Prints the current page to ONE PDF page of the given size in millimetres (no margins, backgrounds on).
     * PDF allows up to 5080 mm per side, so posters of several metres stay a single page for the print shop.
     */
    // Chrome's tagged-PDF structure is one /NonStruct element per style run under a single /Document
    // (measured): no headings or paragraphs, only bytes (−9 % without it). The text layer and its order
    // are the same either way, so tagging is off unless asked for.
    async pdf(widthMm, heightMm, { tagged = false } = {}) {
      if (widthMm > 5080 || heightMm > 5080) throw new Error(`PDF pages are limited to 5080 mm per side (asked for ${widthMm.toFixed(0)} × ${heightMm.toFixed(0)} mm)`);
      const r = await cdp.send('Page.printToPDF', {
        paperWidth: widthMm / 25.4, paperHeight: heightMm / 25.4, printBackground: true, preferCSSPageSize: true,
        marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, transferMode: 'ReturnAsBase64', generateTaggedPDF: tagged,
      });
      return Buffer.from(r.data, 'base64');
    },
    /**
     * Prints the current poster (set by tgRender, tgPoster or tgOnePage) as ONE PDF page at physical size.
     * Chrome prints a few hundred thousand glyphs per page quickly but stalls on a million, so large posters
     * are printed in strips of at most `glyphsPerStrip` glyphs and assembled onto one page with MuPDF
     * (cli/pdf-assemble.js), keeping vectors and the text layer. Returns { widthMm, heightMm, strips }.
     */
    async printPoster(file, opts) {
      const size = await this.printPosterRaw(file, opts);
      return { ...size, ...optimizePdf(file) };
    },
    async printPosterRaw(file, { lines, characters, mmPerPx, glyphsPerStrip = 220000, tagged = false }) {
      if (!has('mutool')) throw new Error('Printing a PDF needs MuPDF (mutool): it checks every strip and assembles the page at its exact size.');
      const dir = mkdtempSync(join(tmpdir(), 'tg-art-strips-'));
      // Chrome (measured with 154) sometimes leaves single glyphs out of a large print job, depending on the
      // text printed before them in the same job. Every strip is therefore read back and compared with its
      // lines; a strip that lost anything, or whose content stream has more tokens than pypdf reads, is
      // split in half and printed again, down to single lines.
      const n = Math.max(1, Math.ceil(characters / glyphsPerStrip)), per = Math.ceil(lines / n);
      const todo = [];
      for (let from = 0; from < lines; from += per) todo.push([from, Math.min(lines, from + per)]);
      const done = [];
      let reprints = 0;
      while (todo.length) {
        const [from, to] = todo.shift();
        const size = await this.call('tgPrintStrip', from, to, mmPerPx);
        const f = join(dir, `strip-${from}-${to}.pdf`);
        // Chrome rounds page sizes (measured: up to 0.22 mm, and 210 mm became 209.89 mm). Print each strip
        // 2 mm taller than its content; the assembly keeps exactly the content height at the exact offset and
        // gives the page its exact size, so even a single strip goes through it.
        writeFileSync(f, await this.pdf(size.widthMm, size.heightMm + 2, { tagged }));
        const want = visibleText((await this.call('tgLineTexts', from, to)).join(''));
        const got = visibleText(spawnSync('mutool', ['draw', '-q', '-F', 'txt', '-o', '-', f], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout);
        const tokens = Number(spawnSync('mutool', ['run', join(ROOT, 'cli', 'pdf-tokens.js'), f], { encoding: 'utf8' }).stdout);
        if (got !== want || tokens > MAX_STREAM_TOKENS) {
          if (to - from === 1) throw new Error(`Line ${from} does not read back from the PDF even when printed on its own`);
          const mid = Math.floor((from + to) / 2);
          todo.unshift([from, mid], [mid, to]);
          reprints++;
          continue;
        }
        done.push({ from, f, size });
      }
      done.sort((a, b) => a.from - b.from);
      const parts = [];
      let topPt = 0, widthPt = 0;
      for (const { f, size } of done) {
        const contentPt = (size.heightMm * 72) / 25.4;
        parts.push(f, String(topPt), String(contentPt));
        topPt += contentPt; widthPt = (size.widthMm * 72) / 25.4;
      }
      const r = spawnSync('mutool', ['run', join(ROOT, 'cli', 'pdf-assemble.js'), file, String(widthPt), String(topPt), ...parts], { encoding: 'utf8' });
      rmSync(dir, { recursive: true, force: true });
      if (r.status !== 0) throw new Error(`Assembling the PDF failed: ${r.stderr || r.stdout}`);
      return { widthMm: (widthPt * 25.4) / 72, heightMm: (topPt * 25.4) / 72, strips: done.length, reprints };
    },
    /** Screenshot of a repository page (path relative to the repo root) at the given viewport size. */
    async screenshot(path, width, height) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await cdp.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/${path}` });
      for (let i = 0; i < 100; i++) {
        const r = await cdp.send('Runtime.evaluate', { expression: 'window.tgReady === true && [...document.images].every((i) => i.complete)', returnByValue: true });
        if (r.result.value) break;
        await sleep(100);
      }
      await sleep(300); // background images
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 } });
      return Buffer.from(shot.data, 'base64');
    },
    async close() {
      cdp.close(); proc.kill(); server.close();
      await sleep(200);
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

const has = (cmd) => spawnSync('which', [cmd]).status === 0;
// pypdf, behind many AI document loaders, stops reading a content stream after 2 000 000 tokens and drops
// the rest of its text silently; strips stay below this, with a margin.
const MAX_STREAM_TOKENS = 1800000;
// Invisible format characters (soft hyphens, direction marks, zero-width joiners …) are not carried into
// PDF text layers, and extractors place spaces their own way: compare what remains.
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/gu;
export const visibleText = (t) => t.replace(INVISIBLE, '').replace(/\s/g, '');

/**
 * Chrome writes PDFs with weak compression and verbose glyph outlines. Two lossless-to-the-eye steps:
 * cli/pdf-slim.js rounds the Type 3 outline coordinates to whole units (measured −22 %, no visible change
 * at 600 dpi), then qpdf repacks (object streams, recompressed streams; measured 7.5 MB -> 1.5 MB for a
 * grey one-pager). The text layer is unchanged. Each step is skipped when its tool is missing; the result
 * is kept only if smaller. Returns { bytesBefore, bytesAfter, optimized }.
 */
export function optimizePdf(file) {
  const before = statSync(file).size;
  let current = file;
  const tmp = [];
  // Round Chrome's Type 3 glyph outlines to whole units (cli/pdf-slim.js), then repack with qpdf.
  if (has('mutool')) {
    const slim = file + '.slim';
    if (spawnSync('mutool', ['run', join(ROOT, 'cli', 'pdf-slim.js'), current, slim]).status === 0) { tmp.push(slim); current = slim; }
  }
  if (has('qpdf')) {
    const packed = file + '.qpdf';
    const r = spawnSync('qpdf', ['--object-streams=generate', '--compress-streams=y', '--recompress-flate', '--compression-level=9', current, packed]);
    if (r.status === 0 || r.status === 3) { tmp.push(packed); current = packed; }
  }
  const after = current === file ? before : statSync(current).size;
  if (after < before) renameSync(current, file);
  for (const f of tmp) rmSync(f, { force: true });
  return { bytesBefore: before, bytesAfter: Math.min(before, after), optimized: after < before };
}

export const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.svg': 'image/svg+xml' };
