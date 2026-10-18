#!/usr/bin/env node
// End-to-end check of data in the browser (app.html "Data in this work", work.html Machine view) in a real headless Chrome.
//
//   node scripts/check-web-data.mjs [--site <dir>] [--verbose] [--only <word>] [--shots <dir>]
//
// What it does: stages the website (the same files scripts/build-site.mjs copies; --site uses a built _site instead), serves it
// from a tiny static server that sends the response headers of _headers (so the real Content-Security-Policy is enforced),
// drives Chrome through the DevTools Protocol (no dependency: Node's WebSocket, see cli/core.mjs), and checks the whole way
// round: attach a file, preview, write into the work or seal, save the work, open it in work.html, read the data, break it.
// Every run also asserts: no request leaves the origin, no CSP violation, no script error, no horizontal scroll at 390 px,
// and every control of the panels can be reached with the keyboard.
// Exit code: 0 all checks passed, 1 a check failed, 2 no Chrome/Chromium found (the test suite skips then).
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { findChrome } from '../cli/core.mjs';
import { encode, decode, decodeAll, toFile, verify, canonicalText, markupText, sealData } from '../src/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { values: args } = parseArgs({ options: { site: { type: 'string' }, verbose: { type: 'boolean' }, only: { type: 'string' }, shots: { type: 'string' } } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => { if (args.verbose) console.error('  ·', ...a); };

// ---- results ----------------------------------------------------------------------------------------------------------
let passed = 0, failed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`ok - ${name}`); } else { failed++; failures.push(name); console.log(`not ok - ${name}${detail ? `\n    ${String(detail).split('\n').join('\n    ')}` : ''}`); }
}

// ---- the site: staged copy + headers from _headers ------------------------------------------------------------------------
function stageSite() {
  if (args.site) return { dir: args.site, cleanup: () => {} };
  const dir = mkdtempSync(join(tmpdir(), 'tg-art-site-'));
  for (const f of ['index.html', 'app.html', 'work.html', '404.html', 'favicon.svg', 'robots.txt', '_headers']) cpSync(join(ROOT, f), join(dir, f));
  for (const d of ['src', 'assets', 'samples']) cpSync(join(ROOT, d), join(dir, d), { recursive: true, filter: (p) => !p.endsWith('brand.html') });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function parseHeaders(text) {
  const rules = [];
  let cur = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { cur = { re: new RegExp('^' + line.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'), headers: [] }; rules.push(cur); }
    else if (cur) { const i = line.indexOf(':'); cur.headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]); }
  }
  return rules;
}
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.csv': 'text/csv; charset=utf-8', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};

async function serve(dir) {
  const rules = parseHeaders(readFileSync(join(dir, '_headers'), 'utf8'));
  const works = new Map(); // /__work/<name>: works the check saved from the generator, served back to work.html
  const seen = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let path;
    try { path = decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end(); return; }
    seen.push(path);
    const send = (body, type) => {
      const h = { 'content-type': type };
      for (const r of rules) if (r.re.test(path)) for (const [k, v] of r.headers) h[k] = v;
      res.writeHead(200, h);
      res.end(body);
    };
    if (path.startsWith('/__work/')) { const w = works.get(path.slice(8)); if (w) return send(w, TYPES[extname(path)] || 'application/octet-stream'); res.writeHead(404); res.end(); return; }
    let rel = normalize(path).replace(/^([/\\])+/, '');
    let file = join(dir, rel);
    if (!(file + sep).startsWith(dir + sep) && file !== dir) { res.writeHead(403); res.end(); return; }
    if (!rel || (existsSync(file) && statSync(file).isDirectory())) file = join(file, 'index.html');
    else if (!extname(file) && existsSync(file + '.html')) file += '.html';
    if (!existsSync(file)) { res.writeHead(404); res.end(); return; }
    send(readFileSync(file), TYPES[extname(file)] || 'application/octet-stream');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return { port, origin: `http://127.0.0.1:${port}`, works, seen, close: () => server.close() };
}

// ---- Chrome over the DevTools Protocol ---------------------------------------------------------------------------------------
async function startChrome(chrome, downloads) {
  const profile = mkdtempSync(join(tmpdir(), 'tg-art-chrome-'));
  const flags = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--lang=en-US', 'about:blank'];
  if (process.getuid?.() === 0 || process.env.CHROME_NO_SANDBOX) flags.unshift('--no-sandbox', '--disable-dev-shm-usage');
  const proc = spawn(chrome, flags, { stdio: 'ignore' });
  let port = null;
  for (let i = 0; i < 300 && !port; i++) { await sleep(100); try { port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { /* not yet */ } }
  if (!port) { proc.kill(); throw new Error('Chrome did not start'); }
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const browser = await connect(version.webSocketDebuggerUrl);
  await browser.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  return {
    browser, port,
    async newPage() {
      const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
      return new Page(await connect(`ws://127.0.0.1:${port}/devtools/page/${targetId}`), targetId, browser);
    },
    async close() { try { browser.close(); } catch { /* gone */ } proc.kill(); await sleep(150); rmSync(profile, { recursive: true, force: true }); },
  };
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('Could not connect to Chrome')); });
  let id = 0, gone = false;
  const pending = new Map(), handlers = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method) for (const f of handlers.get(m.method) || []) f(m.params);
  };
  const failAll = () => { gone = true; for (const a of pending.values()) a({ error: { message: 'Chrome closed the connection' } }); pending.clear(); };
  ws.onclose = failAll;
  return {
    send: (method, params = {}) => new Promise((resolve, reject) => {
      if (gone) return reject(new Error(`${method}: Chrome closed the connection`));
      const i = ++id;
      pending.set(i, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
      ws.send(JSON.stringify({ id: i, method, params }));
    }),
    on: (method, f) => { if (!handlers.has(method)) handlers.set(method, []); handlers.get(method).push(f); },
    close: () => ws.close(),
  };
}

class Page {
  constructor(cdp, targetId, browser) {
    this.cdp = cdp; this.targetId = targetId; this.browser = browser;
    this.errors = []; this.requests = []; this.csp = [];
    cdp.on('Runtime.exceptionThrown', (p) => this.errors.push(`exception: ${p.exceptionDetails.exception?.description || p.exceptionDetails.text}`));
    cdp.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') this.errors.push(`console.error: ${p.args.map((a) => a.value ?? a.description).join(' ')}`); });
    cdp.on('Log.entryAdded', (p) => { if (p.entry.level === 'error') this.errors.push(`log: ${p.entry.text} ${p.entry.url || ''}`); });
    cdp.on('Network.requestWillBeSent', (p) => this.requests.push(p.request.url));
  }
  async init() {
    await this.cdp.send('Page.enable'); await this.cdp.send('Runtime.enable'); await this.cdp.send('Network.enable'); await this.cdp.send('Log.enable'); await this.cdp.send('DOM.enable');
    // English unless a scenario says otherwise (the pages read the site's language key; the machine's own language must not matter)
    await this.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('tg-art.lang', 'en'); } catch (e) {}` });
    await this.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));` });
    return this;
  }
  async goto(url) { const loaded = this.waitEvent('Page.loadEventFired'); await this.cdp.send('Page.navigate', { url }); await loaded; }
  waitEvent(method, ms = 30000) {
    return new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), ms); this.cdp.on(method, (p) => { clearTimeout(t); resolve(p); }); });
  }
  async js(expression) {
    const r = await this.cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}\n${expression.slice(0, 200)}`);
    return r.result.value;
  }
  async waitFor(expression, { ms = 30000, what = expression } = {}) {
    const end = Date.now() + ms;
    for (;;) {
      let v; try { v = await this.js(expression); } catch { v = false; }
      if (v) return v;
      if (Date.now() > end) throw new Error(`timeout (${ms} ms) waiting for: ${what}${this.errors.length ? `\n  page errors: ${this.errors.join(' | ')}` : ''}`);
      await sleep(80);
    }
  }
  click(sel) { return this.js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('no element ${sel.replace(/'/g, '')}'); e.click(); return true; })()`); }
  text(sel) { return this.js(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`); }
  visible(sel) { return this.js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && !e.hidden && e.getClientRects().length > 0; })()`); }
  async setValue(sel, value) {
    return this.js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  }
  async setFile(sel, path) {
    const { root } = await this.cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await this.cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
    await this.cdp.send('DOM.setFileInputFiles', { nodeId, files: [path] });
  }
  async viewport(width, height = 900, mobile = false) { await this.cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }); }
  async key(key, code = key, extra = {}) {
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: { Tab: 9, Enter: 13 }[key] || 0, ...extra });
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: { Tab: 9, Enter: 13 }[key] || 0, ...extra });
  }
  /** With --shots <dir>: a screenshot of the whole page (for looking at the result; no check depends on it). */
  async shot(name) {
    if (!args.shots) return;
    mkdirSync(args.shots, { recursive: true });
    const m = await this.cdp.send('Page.getLayoutMetrics');
    const r = await this.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: m.cssContentSize.width, height: Math.min(m.cssContentSize.height, 6000), scale: 1 } });
    writeFileSync(join(args.shots, `${name}.png`), Buffer.from(r.data, 'base64'));
  }
  async close() { this.cdp.close(); await this.browser.send('Target.closeTarget', { targetId: this.targetId }).catch(() => {}); }
}

// ---- helpers shared by the scenarios -----------------------------------------------------------------------------------------
const hostOf = (u) => { try { return new URL(u); } catch { return null; } };
async function waitDownload(dir, ext, before = new Map(), ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    // new, or saved again under the same name (the app always says typographics-art.svg)
    const files = readdirSync(dir).filter((f) => f.endsWith(ext) && !f.endsWith('.crdownload') && (!before.has(f) || statSync(join(dir, f)).mtimeMs > before.get(f)));
    if (files.length) { await sleep(150); return join(dir, files[0]); }
    if (Date.now() > end) throw new Error(`no ${ext} download appeared in ${ms} ms (folder: ${readdirSync(dir).join(', ')})`);
    await sleep(100);
  }
}
const listDir = (dir) => new Map(readdirSync(dir).map((f) => [f, statSync(join(dir, f)).mtimeMs]));

/**
 * Presses Tab through a panel and returns which of its focusable controls were reached. A radio group counts once (arrow
 * keys move inside it, as in every browser); controls inside a closed <details> are not on the page yet.
 */
async function keyboardReach(page, rootSel, { start }) {
  const ID = `(e) => (e.type === 'radio' ? 'radio:' + e.name : e.id || e.tagName + ':' + (e.textContent || '').trim().slice(0, 20))`;
  const focusables = [...new Set(await page.js(`(() => {
    const id = ${ID};
    const root = document.querySelector(${JSON.stringify(rootSel)});
    const open = (e) => { for (let d = e.closest('details'); d; d = d.parentElement?.closest('details')) { if (!d.open && !(e.tagName === 'SUMMARY' && e.parentElement === d)) return false; } return true; };
    return [...root.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]')].filter((e) => !e.disabled && e.tabIndex >= 0 && e.type !== 'hidden' && !e.closest('[hidden]') && open(e) && (e.getClientRects().length > 0 || e.classList.contains('sr'))).map(id);
  })()`))];
  await page.js(`document.querySelector(${JSON.stringify(start)}).focus()`);
  const reached = new Set();
  for (let i = 0; i < focusables.length * 2 + 30; i++) {
    reached.add(await page.js(`(${ID})(document.activeElement)`));
    await page.key('Tab');
  }
  return { focusables, missing: focusables.filter((f) => !reached.has(f)) };
}

const cspViolations = [];
async function sweep(page) { cspViolations.push(...(await page.js('window.__csp || []').catch(() => []))); }

const SAMPLE_XLSX = join(ROOT, 'samples', 'data', 'bakery-orders.xlsx');
const SAMPLE_CSV = join(ROOT, 'samples', 'data', 'bakery-orders.csv');

// ---- the scenarios ---------------------------------------------------------------------------------------------------------------
async function main() {
  const chrome = findChrome();
  if (!chrome) { console.error('No Chrome or Chromium found (set CHROME_PATH): the browser checks cannot run.'); process.exit(2); }
  if (typeof WebSocket === 'undefined') { console.error('Needs Node.js 22 or newer (global WebSocket).'); process.exit(2); }
  const site = stageSite();
  const web = await serve(site.dir);
  const downloads = mkdtempSync(join(tmpdir(), 'tg-art-dl-'));
  const tmp = mkdtempSync(join(tmpdir(), 'tg-art-files-'));
  const chromeProc = await startChrome(chrome, downloads);
  const pages = [];
  const open = async (viewport) => { const p = await (await chromeProc.newPage()).init(); pages.push(p); if (viewport) await p.viewport(...viewport); return p; };
  const want = (name) => !args.only || name.includes(args.only);
  const expectedSample = await encode({ bytes: new Uint8Array(readFileSync(SAMPLE_XLSX)), name: 'bakery-orders.xlsx' }, { created: false });
  try {
    // ======== 1. generator: Excel through the file chooser, preview, write into the work, every export, reload in work.html ========
    if (want('xlsx')) {
      const app = await open([1280, 900]);
      await app.goto(`${web.origin}/app#data`);
      await app.waitFor(`document.querySelector('#aiText')?.textContent.length > 20`, { what: 'the first work is set' });
      check('app#data opens the Data panel', await app.js(`document.querySelector('#data').open === true`));
      await app.setFile('#dataFile', SAMPLE_XLSX);
      await app.waitFor(`document.querySelector('#dataCard') && !document.querySelector('#dataCard').hidden`, { what: 'the data card' });
      check('xlsx: title line names format, sheets and cells', /^Excel · 2 sheets · \d+ rows · \d+ cells$/.test(await app.text('#dataSummary')), await app.text('#dataSummary'));
      check('xlsx: the file was read in a module worker (the page stays responsive)', await app.js(`performance.getEntriesByType('resource').some((r) => r.name.endsWith('/src/data-worker.js'))`));
      check('xlsx: the file name is shown', (await app.text('#dataName')) === 'bakery-orders.xlsx');
      const rows = await app.js(`document.querySelectorAll('#dataPreview tbody tr').length`);
      check('xlsx: the preview table shows a type row and 8 rows', rows === 9, rows);
      check('xlsx: first cells are the header', (await app.js(`[...document.querySelectorAll('#dataPreview tbody tr')[1].querySelectorAll('td')].slice(0, 3).map((c) => c.textContent).join('|')`)) === 'Order|Date|Customer');
      check('xlsx: two sheet tabs', (await app.js(`document.querySelectorAll('#dataPreview .dui-tabs button').length`)) === 2);
      await app.click('#dataPreview .dui-tabs button:nth-child(2)');
      check('xlsx: the second sheet shows its own rows', (await app.text('#dataPreview .dui-sheetline')).includes('Prices'));
      check('xlsx: the meter and the space text are filled', /characters · type about/.test(await app.text('#dataMeterText')) && (await app.js(`document.querySelector('#dataMeter').value > 0`)));
      check('xlsx: what is not carried over is named', /Not carried over: styles/.test(await app.text('#dataLost')));
      check('xlsx: the sample text box is replaced by the data (placement defaults to "only the data")', await app.js(`document.querySelector('input[name=dataPlace][value=only]').checked`));
      await app.setValue('#dataLead', 'Bakery orders, September');
      await app.click('#dataGo');
      await app.waitFor(`/Checked/.test(document.querySelector('#dataResult').textContent)`, { what: 'the read-back check' });
      await app.shot('app-xlsx-written');
      if (args.verbose) log('faithful chip:', await app.text('#meta .chip'), await app.js(`(() => { const a = document.querySelector('#aiText').textContent, b = document.querySelector('#stage').innerText; return a.length + ' ' + b.length; })()`));
      const plain = await app.js(`document.querySelector('#aiText').textContent`);
      check('write: the work text starts with the lead-in and holds the block', plain.startsWith('Bakery orders, September TGD1[') && plain.includes(']TGD1'));
      check('write: the block in the work decodes to the file (checksum verified)', (await verify(canonicalText(plain))).ok);
      check('write: the green line says checked, with a checksum', /^✔ The data is in the work’s text now \(\d[\d,]* characters\)\. Checked: it comes back out of the text exactly \(sha256 [0-9a-f]{16}…\)\.$/.test(await app.text('#dataResult')), await app.text('#dataResult'));
      check('write: the picture shows the text (stage has glyphs)', (await app.js(`document.querySelector('#stage').innerText.length`)) > 1000);
      const before = listDir(downloads);
      await app.click('#saveSvg');
      const svgFile = await waitDownload(downloads, '.svg', before);
      const svg = readFileSync(svgFile, 'utf8');
      check('export SVG: the saved file holds the data text and verifies', (await verify(canonicalText(markupText(svg, 'svg')))).ok);
      const before2 = listDir(downloads);
      await app.click('#saveHtml');
      const htmlFile = await waitDownload(downloads, '.html', before2);
      check('export HTML: the saved file verifies', (await verify(canonicalText(markupText(readFileSync(htmlFile, 'utf8'), 'html')))).ok);
      await chromeProc.browser.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'], origin: web.origin });
      await app.click('#copyText');
      await app.waitFor(`/copied/i.test(document.querySelector('#copyMsg').textContent)`, { what: 'copy plain text' });
      check('export plain text: the clipboard holds the data text', (await verify(canonicalText(await app.js(`navigator.clipboard.readText()`)))).ok);
      await app.click('#copySvg');
      await app.waitFor(`/SVG copied/.test(document.querySelector('#copyMsg').textContent)`);
      check('export copy SVG: the clipboard holds the SVG', (await app.js(`navigator.clipboard.readText()`)).startsWith('<svg'));
      await app.click('#copyHtml');
      await app.waitFor(`/HTML copied/.test(document.querySelector('#copyMsg').textContent)`);
      const copiedHtml = await app.js(`navigator.clipboard.readText()`);
      check('export copy HTML: the clipboard holds a page', /<html|<!doctype|<div/i.test(copiedHtml), copiedHtml.slice(0, 100));
      await app.click('#makePng');
      check('export PNG: the image appears', await app.waitFor(`!document.querySelector('#png').hidden && document.querySelector('#png').src.startsWith('data:image/png')`, { what: 'png' }));
      const pdf = Buffer.from((await app.cdp.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true })).data, 'base64');
      writeFileSync(join(tmp, 'work.pdf'), pdf);
      check('export print/PDF: Chrome prints the work to a PDF', pdf.length > 5000 && pdf.subarray(0, 5).toString() === '%PDF-', pdf.length);
      const mutool = spawnSync('mutool', ['draw', '-q', '-F', 'txt', '-o', '-', join(tmp, 'work.pdf')], { encoding: 'utf8', maxBuffer: 1 << 28 });
      if (mutool.status === 0) check('export print/PDF: the data comes back out of the PDF text layer and verifies', (await verify(canonicalText(mutool.stdout))).ok);
      else console.log('skip - PDF text layer check (mutool not installed)');

      // reload that work's SVG in work.html
      web.works.set('xlsx-work.svg', readFileSync(svgFile));
      const work = await open([1280, 900]);
      await work.goto(`${web.origin}/work?art=__work/xlsx-work.svg#machine`);
      await work.waitFor(`document.querySelector('#dataSection .dui-card')`, { what: 'the data card on the work page' });
      check('work: Verified badge with the checksum', /Verified/.test(await work.text('.dui-verified')) && /sha256:[0-9a-f]{16}/.test(await work.text('.dui-sum')), await work.text('.dui-verified'));
      check('work: the table shows the decoded sheet (header row, 30 orders)', (await work.js(`document.querySelectorAll('#dataSection .dui-table tbody tr').length`)) >= 9 && (await work.js(`document.querySelector('#dataSection .dui-table tbody tr:nth-child(2)').textContent`)).includes('Customer'));
      check('work: types are shown under the column letters', /date/.test(await work.text('#dataSection .dui-types')));
      check('work: sheet tabs for the workbook', (await work.js(`document.querySelectorAll('#dataSection .dui-sheets .dui-tabs button').length`)) === 2);
      check('work: the Read view cuts the block out and points to Machine', await work.js(`(() => { document.querySelector('#tab-read').click(); const t = document.querySelector('#reading').textContent; return !t.includes('TGD1') && /Data: bakery-orders\\.xlsx/.test(t); })()`));
      await work.click('#tab-machine');
      // downloads in the original and other formats
      const wbefore = listDir(downloads);
      await work.click('#dataSection .dui-opt input[type=checkbox]');
      await work.click('#dataSection [data-format="xlsx"]');
      const xlsxOut = await waitDownload(downloads, '.xlsx', wbefore);
      const back = await encode({ bytes: new Uint8Array(readFileSync(xlsxOut)), name: 'out.xlsx' }, { created: false });
      check('work: the downloaded .xlsx (with formulas) has the same model as the sample', JSON.stringify(back.model.sheets) === JSON.stringify(expectedSample.model.sheets), JSON.stringify(back.model.sheets).slice(0, 300));
      const wbefore2 = listDir(downloads);
      await work.click('#dataSection [data-format="csv"]');
      const csvOut = await waitDownload(downloads, '.csv', wbefore2);
      check('work: the downloaded .csv is the first sheet', readFileSync(csvOut, 'utf8').startsWith('Order,Date,Customer,Item,Qty,Price CHF,Note'));
      const wbefore3 = listDir(downloads);
      await work.click('#dataSection [data-format="json"]');
      const jsonOut = await waitDownload(downloads, '.json', wbefore3);
      check('work: the downloaded .json holds both sheets', Object.keys(JSON.parse(readFileSync(jsonOut, 'utf8'))).join() === 'Orders,Prices');
      await chromeProc.browser.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'], origin: web.origin });
      await work.click('#dataSection [data-copy="model"]');
      await work.waitFor(`/Copied/.test(document.querySelector('#dataSection .dui-copymsg').textContent)`, { what: 'copy JSON' });
      await work.shot('work-xlsx');
      const copied = JSON.parse(await work.js(`navigator.clipboard.readText()`));
      check('work: Copy JSON puts the model on the clipboard', copied.data?.kind === 'workbook' || copied.kind === 'workbook' || JSON.stringify(copied).includes('workbook'));
      await work.click('#dataSection [data-tab="text"]');
      check('work: the Text tab shows the block as stored (middle dots)', (await work.text('#dataSection .dui-pre')).startsWith('TGD1[') && (await work.text('#dataSection .dui-pre')).includes('·'));
      await sweep(work);
      check('work: the page needs no script error and no outside request', work.errors.length === 0, work.errors.join('\n'));
      await sweep(app);
    }

    // ======== 2. generator: CSV by drag and drop, text before the data, byte-exact CSV back, remove, German ========
    if (want('csv')) {
      const app = await open([1280, 900]);
      await app.goto(`${web.origin}/app#data`);
      await app.waitFor(`document.querySelector('#aiText')?.textContent.length > 20`);
      await app.setValue('#text', 'Our September orders, in plain words.');
      await app.waitFor(`document.querySelector('#aiText').textContent.startsWith('Our September')`, { what: 'the typed text is set' });
      await app.js(`(async () => {
        const bytes = await (await fetch('samples/data/bakery-orders.csv')).arrayBuffer();
        const dt = new DataTransfer(); dt.items.add(new File([bytes], 'bakery-orders.csv', { type: 'text/csv' }));
        document.querySelector('#dataDrop').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      })()`);
      await app.waitFor(`!document.querySelector('#dataCard').hidden`, { what: 'the card after a drop' });
      check('csv (dropped): title line', /^CSV · 1 sheet · 31 rows · \d+ cells$/.test(await app.text('#dataSummary')), await app.text('#dataSummary'));
      check('csv: a single sheet has no tabs and the header is recognised', (await app.js(`document.querySelectorAll('#dataPreview .dui-tabs').length`)) === 0 && /has a header/.test(await app.text('#dataPreview .dui-sheetline')));
      check('csv: every cell is text, said so', /Not carried over: types: every cell is text/.test(await app.text('#dataLost')));
      check('csv: with typed text the data goes after it by default', await app.js(`document.querySelector('input[name=dataPlace][value=after]').checked`));
      check('csv: the "text and data" note is shown', /after your text/.test(await app.text('#dataWarn')));
      await app.click('#dataGo');
      await app.waitFor(`/Checked/.test(document.querySelector('#dataResult').textContent)`);
      const plain = await app.js(`document.querySelector('#aiText').textContent`);
      check('csv: the work starts with the typed text, then the block', plain.startsWith('Our September orders, in plain words. TGD1['));
      const blocks = await decodeAll(canonicalText(plain));
      check('csv: the block decodes and gives the original CSV byte for byte', blocks.length === 1 && Buffer.from((await toFile(blocks[0], 'csv')).bytes).equals(readFileSync(SAMPLE_CSV)));
      await app.click('#dataUnwrite');
      await app.waitFor(`/no longer part/.test(document.querySelector('#dataResult').textContent)`);
      await app.waitFor(`!document.querySelector('#aiText').textContent.includes('TGD1')`, { what: 'the data leaves the work' });
      check('csv: "Remove the data from the work" sets the typed text again', (await app.js(`document.querySelector('#aiText').textContent`)) === 'Our September orders, in plain words.');
      await app.click('[data-lang="de"]');
      check('German: panel, summary line and button', (await app.text('#dataGo')) === 'Daten in das Werk schreiben' && /^CSV · 1 Blatt · 31 Zeilen/.test(await app.text('#dataSummary')) && (await app.text('#data summary')) === 'Daten in diesem Werk', `${await app.text('#dataGo')} | ${await app.text('#dataSummary')}`);
      check('German: what is lost is translated', /^Nicht übernommen: Typen: Jede Zelle ist Text/.test(await app.text('#dataLost')), await app.text('#dataLost'));
      await sweep(app); await app.close();
    }

    // ======== 3. generator: errors, each directly under the action that caused it ========
    if (want('errors')) {
      const app = await open([1280, 900]);
      await app.goto(`${web.origin}/app#data`);
      await app.waitFor(`document.querySelector('#aiText')?.textContent.length > 20`);
      const geometry = () => app.js(`(() => { const b = document.querySelector('#dataErr .dui-box'); const d = document.querySelector('#dataDrop').getBoundingClientRect().bottom; const r = b.getBoundingClientRect(); return { gap: r.top - d, focused: document.activeElement === b, role: b.getAttribute('role'), title: b.querySelector('.dui-title').textContent, body: b.querySelector('.dui-body')?.textContent || '', buttons: b.querySelectorAll('button').length, h: r.height }; })()`);
      const expectBox = async (name, file, title, bodyRe) => {
        await app.setFile('#dataFile', file);
        await app.waitFor(`document.querySelector('#dataErr .dui-title')?.textContent.includes(${JSON.stringify(title)})`, { what: `error box for ${name}` });
        const g = await geometry();
        check(`error ${name}: title "${title}"`, g.title.includes(title), g.title);
        check(`error ${name}: body says what to do`, bodyRe.test(g.body), g.body);
        check(`error ${name}: a visible alert box right under the file controls, focused`, g.role === 'alert' && g.focused && g.gap >= 0 && g.gap < 220 && g.h > 40, JSON.stringify(g));
        check(`error ${name}: no data card is shown`, await app.js(`document.querySelector('#dataCard').hidden`));
      };
      writeFileSync(join(tmp, 'virus.exe'), Buffer.from([0x4d, 0x5a, 0x90, 0]));
      await expectBox('unsupported type', join(tmp, 'virus.exe'), 'This file type is not supported', /^virus\.exe is not one of: Excel, CSV/);
      writeFileSync(join(tmp, 'broken.xlsx'), Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.from('this is not a spreadsheet at all, only bytes'.repeat(5))]));
      await expectBox('damaged xlsx', join(tmp, 'broken.xlsx'), 'looks damaged or unsafe', /It was not read\./);
      writeFileSync(join(tmp, 'empty.csv'), '');
      await expectBox('empty file', join(tmp, 'empty.csv'), 'The file holds no data', /No cells, rows or entries/);
      writeFileSync(join(tmp, 'huge.csv'), Buffer.alloc(17 * 1024 * 1024, 'a'));
      await expectBox('file too large', join(tmp, 'huge.csv'), 'The file is too large', /17\.0 MiB.*at most 16 MiB/);
      writeFileSync(join(tmp, 'altes.csv'), Buffer.from('Name;Stadt\nM\xfcller;Z\xfcrich\n', 'latin1'));
      await expectBox('not UTF-8', join(tmp, 'altes.csv'), 'The file is not in UTF-8', /Windows-1252/);
      check('error not UTF-8: an encoding picker and "Read again" are offered', await app.js(`!!document.querySelector('#dataErr select') && [...document.querySelectorAll('#dataErr button')].some((b) => b.textContent === 'Read again')`));
      await app.js(`(() => { const s = document.querySelector('#dataErr select'); s.value = 'windows-1252'; s.dispatchEvent(new Event('change')); [...document.querySelectorAll('#dataErr button')].find((b) => b.textContent === 'Read again').click(); })()`);
      await app.waitFor(`!document.querySelector('#dataCard').hidden`, { what: 'the file reads with the chosen encoding' });
      check('error not UTF-8: with Windows-1252 the file reads and the umlauts are right', (await app.js(`document.querySelector('#dataPreview').textContent`)).includes('Zürich') && await app.js(`document.querySelector('#dataErr').hidden`));
      // too big for one page: text is refused, sealing is offered
      const rowsBig = ['id,name,note'];
      for (let i = 0; i < 30000; i++) rowsBig.push(`${i},row number ${i},some longer words to fill the line ${i * 7}`);
      writeFileSync(join(tmp, 'big.csv'), rowsBig.join('\n'));
      await app.setFile('#dataFile', join(tmp, 'big.csv'));
      await app.waitFor(`document.querySelector('#dataFit .dui-bad')`, { what: 'the red state' });
      check('too big: the red box says it does not fit on one page and what to do', /does not fit on one page/.test(await app.text('#dataFit .dui-title')) && /seal it/.test(await app.text('#dataFit .dui-body')));
      check('too big: writing into the text is disabled, sealing is chosen', await app.js(`document.querySelector('input[name=dataChoice][value=text]').disabled && document.querySelector('input[name=dataChoice][value=seal]').checked`) && (await app.text('#dataGo')) === 'Seal the data');
      await sweep(app); await app.close();
    }

    // ======== 4. seal in the generator, open on the work page: right key, wrong keys, a changed record ========
    if (want('seal')) {
      const app = await open([1280, 900]);
      await app.goto(`${web.origin}/app#data`);
      await app.waitFor(`document.querySelector('#aiText')?.textContent.length > 20`);
      const originalText = await app.js(`document.querySelector('#aiText').textContent`);
      await app.click('#dataSampleXlsx');
      await app.waitFor(`!document.querySelector('#dataCard').hidden`);
      await app.click('input[name=dataChoice][value=seal]');
      check('seal: the options change to padding and compression', await app.js(`!document.querySelector('#dataSealOpts').hidden && document.querySelector('#dataTextOpts').hidden`) && (await app.text('#dataGo')) === 'Seal the data');
      await app.click('#dataGo');
      await app.waitFor(`document.querySelector('#dataKey').value.startsWith('tgx1.')`, { what: 'the key' });
      const key = await app.js(`document.querySelector('#dataKey').value`), record = await app.js(`document.querySelector('#dataRecord').value`);
      check('seal: a key (tgx1.) and a sealed record (tgs1.) are shown', /^tgx1\.[1-9A-HJ-NP-Za-km-z]+$/.test(key) && /^tgs1\.[\w-]+$/.test(record), `${key.slice(0, 12)} ${record.slice(0, 12)}`);
      check('seal: the status names the lengths', /^Sealed\. Key: \d+ characters, record: [\d,]+ characters\./.test(await app.text('#dataResult')), await app.text('#dataResult'));
      check('seal: the key box is read-only and the reminder is visible', await app.js(`document.querySelector('#dataKey').readOnly && document.querySelector('#dataKey').getClientRects().length > 0`) && /not stored anywhere/.test(await app.text('#dataSealOut')));
      check('seal: the work text is untouched (no block, no ciphertext)', (await app.js(`document.querySelector('#aiText').textContent`)) === originalText);
      await chromeProc.browser.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'], origin: web.origin });
      await app.click('#dataCopyKey');
      await app.waitFor(`/Key copied/.test(document.querySelector('#dataResult').textContent)`);
      check('seal: Copy key puts exactly the key on the clipboard', (await app.js(`navigator.clipboard.readText()`)) === key);
      await app.click('#dataCopyRecord');
      await app.waitFor(`/Record copied/.test(document.querySelector('#dataResult').textContent)`);
      check('seal: Copy record puts exactly the record on the clipboard', (await app.js(`navigator.clipboard.readText()`)) === record);
      const b0 = listDir(downloads);
      await app.click('#dataSaveRecord');
      const tgs = await waitDownload(downloads, '.tgs', b0);
      check('seal: Download record saves the record as a .tgs file', readFileSync(tgs, 'utf8').trim() === record);
      const b1 = listDir(downloads);
      await app.click('#saveSvg');
      const svgPath = await waitDownload(downloads, '.svg', b1);
      const svg = readFileSync(svgPath, 'utf8');
      web.works.set('sealed-work.svg', Buffer.from(svg));
      const store = await app.js(`JSON.stringify([localStorage, sessionStorage]) + location.href`);
      check('seal: the key, the record and the data are in no URL and no browser storage', !store.includes(key) && !store.includes(record.slice(6, 40)) && !store.includes('Alpenblick') && !store.includes('tgx1'));
      await app.shot('app-sealed');
      const kb = await keyboardReach(app, '#data', { start: '#data > summary' });
      check('keyboard: every control of the Data panel can be reached with Tab', kb.missing.length === 0, `missing: ${kb.missing.join(', ')} of ${kb.focusables.length}`);
      await app.viewport(390, 844, true);
      await sleep(400);
      check('390 px: the Data panel (sealed) causes no horizontal scroll', await app.js(`document.documentElement.scrollWidth <= 390 && document.body.scrollWidth <= 390`), await app.js(`document.documentElement.scrollWidth`));
      await app.viewport(1280, 900);
      await app.setValue('#text', originalText + ' And a new last sentence.');
      await app.waitFor(`!document.querySelector('#dataStale').hidden`, { what: 'the stale-key warning' });
      check('seal: changing the text afterwards warns that the key no longer fits', /no longer opens it/.test(await app.text('#dataStale')));
      await app.click('#dataClearKey');
      check('seal: Clear key empties the key box', (await app.js(`document.querySelector('#dataKey').value`)) === '' && /cleared/.test(await app.text('#dataResult')));
      await sweep(app);

      // ---- the work page ----
      const work = await open([1280, 900]);
      await work.goto(`${web.origin}/work?art=__work/sealed-work.svg#machine`);
      await work.waitFor(`document.querySelector('#sealedBox')`);
      check('work: a work without data says so', /no data block/.test(await work.text('#dataNone')));
      await work.click('#sealedBox > summary');
      const workText = canonicalText(markupText(svg, 'svg'));
      const block = (await encode({ bytes: new Uint8Array(readFileSync(SAMPLE_XLSX)), name: 'bakery-orders.xlsx' })).text;
      const otherKey = (await sealData(workText, block)).key;           // same work, another secret
      const alienKey = (await sealData('some other work entirely', block)).key; // another work
      const tamperedKey = key.slice(0, -1) + (key.endsWith('2') ? '3' : '2');
      const tamperedRecord = record.slice(0, 40) + (record[40] === 'A' ? 'B' : 'A') + record.slice(41);
      const tryOpen = async (k, r) => {
        await work.setValue('#openKey', k); await work.setValue('#openRecord', r);
        await work.js(`document.querySelectorAll('#openErr .dui-box, #openedData .dui-card').forEach((n) => n.remove())`);
        await work.click('#openGo');
        await work.waitFor(`document.querySelector('#openErr .dui-box') || document.querySelector('#openedData .dui-card')`, { what: 'result of Open' });
        return work.js(`(() => { const e = document.querySelector('#openErr .dui-box'); const b = document.querySelector('#openGo').getBoundingClientRect(); const r = e && e.getBoundingClientRect(); return { err: e ? e.querySelector('.dui-body').textContent : null, gap: r ? r.top - b.bottom : null, alert: e?.getAttribute('role'), focused: !!e && document.activeElement === e, card: !!document.querySelector('#openedData .dui-card'), tables: document.querySelectorAll('#openedData table').length, keyKept: document.querySelector('#openKey').value }; })()`);
      };
      const underOpen = (r) => r.alert === 'alert' && r.focused && r.gap >= 0 && r.gap < 120;
      let r = await tryOpen(otherKey, record);
      check('open: a wrong key (same work) shows a visible error under Open and no data', r.err?.startsWith('The key does not open this record') && underOpen(r) && !r.card && r.tables === 0 && r.keyKept === otherKey, JSON.stringify(r));
      r = await tryOpen(alienKey, record);
      check('open: a key of another work says so', r.err?.startsWith('This key belongs to a different work') && underOpen(r) && !r.card, JSON.stringify(r));
      r = await tryOpen(tamperedKey, record);
      check('open: a key with a typing error says so', r.err?.startsWith('The key has a typing error') && underOpen(r) && !r.card, JSON.stringify(r));
      r = await tryOpen(key, tamperedRecord);
      check('open: one changed character of the record is detected and shown', /^(The key does not open this record|The key or the record is damaged)/.test(r.err || '') && underOpen(r) && !r.card, JSON.stringify(r));
      r = await tryOpen('', record);
      check('open: no key asks for the key', r.err?.startsWith('Paste the key first') && underOpen(r), JSON.stringify(r));
      r = await tryOpen('hello', record);
      check('open: something that is not a key says what a key looks like', r.err?.startsWith('This is not a key') && underOpen(r), JSON.stringify(r));
      r = await tryOpen(key, 'hello');
      check('open: something that is not a record is named as such', r.err?.startsWith('This is not a sealed record') && underOpen(r), JSON.stringify(r));
      r = await tryOpen(key, '');
      check('open: a key that does not carry the data asks for the record', r.err?.startsWith('This key does not contain the data') && underOpen(r), JSON.stringify(r));
      await work.click('[data-lang="de"]');
      check('open: the visible error follows a change of language', (await work.text('#openErr .dui-body')).startsWith('Dieser Schlüssel enthält die Daten nicht'), await work.text('#openErr .dui-body'));
      await work.click('[data-lang="en"]');
      r = await tryOpen(key, record);
      check('open: the right key opens the record: data card, table, verified', r.card && r.tables === 1 && r.err === null, JSON.stringify(r));
      check('open: the status line says the block is intact', /^Opened\. The data block is intact \(sha256 [0-9a-f]{16}…\)\.$/.test(await work.text('#openStatus')), await work.text('#openStatus'));
      check('open: the opened data is the sample (first row)', (await work.js(`document.querySelector('#openedData tbody tr:nth-child(2)').textContent`)).includes('Customer'));
      check('open: a record pasted with line breaks (as saved in a file) opens too', (await tryOpen(key, record.replace(/(.{60})/g, '$1\n') + '\n')).card);
      await work.shot('work-opened');
      const kbw = await keyboardReach(work, '#dataSection', { start: '#sealedBox > summary' });
      check('keyboard: every control of the sealed form and the card can be reached with Tab', kbw.missing.length === 0, `missing: ${kbw.missing.join(', ')} of ${kbw.focusables.length}`);
      const store2 = await work.js(`JSON.stringify([localStorage, sessionStorage]) + location.href + document.title`);
      check('open: the key and the opened data are in no URL and no browser storage', !store2.includes(key) && !store2.includes('Alpenblick'));
      check('open: the page JSON does not contain the opened data', !(await work.js(`JSON.stringify(window.__tg.canonical)`)).includes('Alpenblick'));
      await work.click('#openClear');
      check('open: Clear key empties the key box', (await work.js(`document.querySelector('#openKey').value`)) === '');
      await work.viewport(390, 844, true);
      await sleep(300);
      check('390 px: the work page with an opened data card causes no horizontal scroll', await work.js(`document.documentElement.scrollWidth <= 390 && document.body.scrollWidth <= 390`), await work.js(`document.documentElement.scrollWidth`));
      await sweep(work);
    }

    // ======== (opt-in: --only perf) how long a large data work takes to set, for the docs ========
    if (args.only === 'perf') {
      const app = await open([1280, 900]);
      await app.goto(`${web.origin}/app#data`);
      await app.waitFor(`document.querySelector('#aiText')?.textContent.length > 20`);
      const rows = ['id,name,note'];
      for (let i = 0; i < 1400; i++) rows.push(`${i},row number ${i},some words to fill the line ${i * 7}`);
      writeFileSync(join(tmp, 'perf.csv'), rows.join('\n'));
      await app.setFile('#dataFile', join(tmp, 'perf.csv'));
      await app.waitFor(`!document.querySelector('#dataCard').hidden`);
      const chars = await app.text('#dataMeterText');
      const t0 = Date.now();
      await app.click('#dataGo');
      await app.waitFor(`/Checked/.test(document.querySelector('#dataResult').textContent)`, { ms: 240000 });
      console.log(`perf: ${chars} - set and checked in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }

    // ======== 5. a work whose data was changed, and a work opened from a file on the person's computer ========
    if (want('damaged')) {
      const good = web.works.get('xlsx-work.svg')?.toString('utf8');
      if (!good) throw new Error('the damaged-data scenario needs the work saved by the xlsx scenario: run without --only, or with --only xlsx first');
      // change one digit that sits inside the block (after the first 600 characters of text)
      let done = false, count = 0;
      const bad = good.replace(/>([^<]*)<\/tspan>/g, (m, t) => { count += t.length; if (!done && count > 600 && /\d/.test(t)) { done = true; return `>${t.replace(/\d/, (d) => String((+d + 1) % 10))}</tspan>`; } return m; });
      check('prepared a work with one changed digit', done && bad !== good);
      web.works.set('tampered.svg', Buffer.from(bad));
      const work = await open([1280, 900]);
      await work.goto(`${web.origin}/work?art=__work/tampered.svg#machine`);
      await work.waitFor(`document.querySelector('#dataSection .dui-bad')`, { what: 'the damaged-data box' });
      check('damaged: the title says the data was changed or is damaged', /changed or is damaged/.test(await work.text('#dataSection .dui-bad .dui-title')));
      check('damaged: the data is not shown (no table)', (await work.js(`document.querySelectorAll('#dataSection .dui-table').length`)) === 0);
      check('damaged: two actions, and the code last', (await work.js(`document.querySelectorAll('#dataSection .dui-bad button').length`)) === 2 && /Code: checksum/.test(await work.text('#dataSection .dui-code')));
      await work.click('#dataSection .dui-bad button');
      check('damaged: "Show the block text" shows the block', (await work.js(`document.querySelector('#dataSection .dui-pre').hidden`)) === false && (await work.text('#dataSection .dui-pre')).includes('TGD1['));
      check('damaged: the other views still work (the Art view holds the picture)', await work.js(`(document.querySelector('#tab-art').click(), !!document.querySelector('#artbox svg'))`));
      // a work opened from a file, with no address parameters at all
      const bare = await open([1280, 900]);
      await bare.goto(`${web.origin}/work`);
      await bare.waitFor(`document.querySelector('#localBox')`);
      check('bare work page: says that no work was given and offers a file', /No work was given/.test(await bare.text('#artbox')) && await bare.visible('#view-machine'));
      const goodPath = join(tmp, 'saved-work.svg');
      writeFileSync(goodPath, good);
      await bare.click('#localBox > summary');
      await bare.setFile('#localWorkFile', goodPath);
      await bare.waitFor(`document.querySelector('#dataSection .dui-card')`, { what: 'the data of a local file' });
      check('bare work page: a saved work file opens in the browser and shows its verified data', /Verified/.test(await bare.text('.dui-verified')) && /^Read saved-work\.svg: [\d,]+ characters\.$/.test(await bare.text('#localMsg')), await bare.text('#localMsg'));
      check('bare work page: nothing was uploaded (no request but the page and its own files)', bare.requests.every((u) => hostOf(u)?.origin === new URL(web.origin).origin || u.startsWith('blob:') || u.startsWith('data:')));
      await bare.viewport(390, 844, true);
      await sleep(300);
      check('390 px: the opened local work causes no horizontal scroll', await bare.js(`document.documentElement.scrollWidth <= 390`), await bare.js(`document.documentElement.scrollWidth`));
      await sweep(work); await sweep(bare);
    }
  } finally {
    await chromeProc.close();
    web.close();
    site.cleanup();
    rmSync(downloads, { recursive: true, force: true });
    rmSync(tmp, { recursive: true, force: true });
  }
  // ======== global assertions over every page that was opened ========
  const origin = new URL(web.origin).origin;
  const outside = pages.flatMap((p) => p.requests).filter((u) => { const x = hostOf(u); return x && ['http:', 'https:', 'ws:', 'wss:'].includes(x.protocol) && x.origin !== origin; });
  check('no request leaves the origin', outside.length === 0, outside.join('\n'));
  check('no Content-Security-Policy violation on any page', cspViolations.length === 0, cspViolations.join('\n'));
  check('no script error or console error on any page', pages.every((p) => p.errors.length === 0), pages.flatMap((p) => p.errors).join('\n'));
  console.log(`\n${passed + failed} checks, ${failed} failed`);
  if (failed) { console.log('failed: ' + failures.join('; ')); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
