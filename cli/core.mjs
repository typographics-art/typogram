// Drives a headless Chrome/Chromium through the DevTools Protocol to render artworks outside the
// browser UI. No dependencies: Node's http server serves the repository, Node's WebSocket talks to Chrome.
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, normalize, extname, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css' };
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
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    const file = join(ROOT, path);
    if (!(file + sep).startsWith(ROOT + sep) && file !== ROOT) { res.writeHead(403); res.end(); return; }
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
  if (process.getuid?.() === 0) args.unshift('--no-sandbox');
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
        const pdf = await cdp.send('Page.printToPDF', {
          paperWidth: meta.width / 96, paperHeight: meta.height / 96, printBackground: true, preferCSSPageSize: true,
          marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
        });
        return { meta, data: Buffer.from(pdf.data, 'base64') };
      }
      if (format === 'png' || format === 'jpg') return { meta, data: Buffer.from(data.split(',')[1], 'base64') };
      return { meta, data };
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

export const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.svg': 'image/svg+xml' };
