#!/usr/bin/env node
// Print-on-demand masters for the gallery works. Each gallery/<id>.svg is the exact, signed artwork; this
// renders it to a 300-DPI raster suitable for posters, mugs, shirts and the like, without re-rendering or
// re-signing it (the picture and its signature stay untouched — a print is just a higher-resolution view).
//
// Why Chrome then MuPDF: a Typogram sets each glyph at its own weight and width (Roboto Flex variable axes).
// Only Chrome renders those axes faithfully (the whole project is built around that), so a plain SVG
// rasteriser (librsvg/ImageMagick) would flatten every glyph to one weight and ruin the picture. Chrome
// prints the SVG to a one-page PDF at the physical print size; MuPDF (mutool), which the project already
// trusts to rasterise Chrome's Type-3 glyph PDFs, draws that page at 300 DPI. ImageMagick then stamps the
// PNG's resolution so a print shop reads the right physical size.
//
//   node scripts/build-prints.mjs            # every work in gallery/works.json
//   node scripts/build-prints.mjs great-wave mona-lisa   # only these
//
// Writes prints/<id>.png (gitignored — production artifacts, not source) and prints/manifest.json.
// Spec: long side 7200 px = 24 inches at 300 DPI; short side follows each work's aspect ratio.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, statSync, existsSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome } from '../cli/core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'prints');
const LONG_SIDE_PX = 7200; // 24 inches at 300 DPI
const DPI = 300;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const has = (cmd) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd]).status === 0;

for (const t of ['mutool', 'magick']) if (!has(t)) { console.error(`${t} is required.`); process.exit(1); }

/** Minimal DevTools client over one page target — enough to set a document and print it to PDF. */
async function openChrome() {
  const chrome = findChrome();
  if (!chrome) throw new Error('No Chrome or Chromium found. Install one or set CHROME_PATH.');
  const profile = mkdtempSync(join(tmpdir(), 'tg-prints-'));
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank'];
  if (process.getuid?.() === 0 || process.env.CHROME_NO_SANDBOX) args.unshift('--no-sandbox', '--disable-dev-shm-usage');
  // Own process group (detached), so the whole Chrome tree can be killed at once. A graceful SIGTERM lets
  // Chrome keep flushing its profile while we delete it (ENOTEMPTY) and leaves a renderer child behind;
  // SIGKILL on the group, then waiting for exit, then a retrying rmSync, removes the dir cleanly.
  const proc = spawn(chrome, args, { stdio: 'ignore', detached: true });
  const exited = new Promise((res) => proc.once('exit', res));
  const kill = async () => {
    try { process.kill(-proc.pid, 'SIGKILL'); } catch { try { proc.kill('SIGKILL'); } catch { /* already gone */ } }
    await Promise.race([exited, sleep(2000)]);
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  };
  let port = null;
  for (let i = 0; i < 300 && !port; i++) { await sleep(100); try { port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { /* not yet */ } }
  if (!port) { await kill(); throw new Error('Chrome did not start'); }
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('Could not connect to Chrome')); });
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const fail = () => { for (const a of pending.values()) a({ error: { message: 'Chrome closed the connection' } }); pending.clear(); };
  ws.onclose = fail; ws.onerror = fail;
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result))); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable');
  const frameId = (await send('Page.getFrameTree')).frameTree.frame.id;
  return { send, frameId, close: async () => { try { ws.close(); } catch { /* already closed */ } await kill(); } };
}

/** The gallery SVG, sized to the physical page, printed to a one-page PDF with the background on. */
async function svgToPdf(cdp, svg, widthIn, heightIn) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: ${widthIn}in ${heightIn}in; margin: 0 }
html, body { margin: 0; padding: 0 }
svg { display: block; width: 100%; height: 100%; print-color-adjust: exact; -webkit-print-color-adjust: exact }
</style></head><body>${svg}</body></html>`;
  await cdp.send('Page.setDocumentContent', { frameId: cdp.frameId, html });
  // Wait for the embedded font to be ready, so every glyph is drawn at its own weight/width.
  for (let i = 0; i < 100; i++) {
    const r = await cdp.send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => document.fonts.status === "loaded")', awaitPromise: true, returnByValue: true });
    if (r.result.value) break;
    await sleep(100);
  }
  await sleep(150); // let the last layout settle
  const r = await cdp.send('Page.printToPDF', {
    paperWidth: widthIn, paperHeight: heightIn, printBackground: true, preferCSSPageSize: true,
    marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, transferMode: 'ReturnAsBase64',
  });
  return Buffer.from(r.data, 'base64');
}

const works = JSON.parse(readFileSync(join(ROOT, 'gallery', 'works.json'), 'utf8'));
const args = process.argv.slice(2);
const manifestOnly = args.includes('--manifest'); // rebuild prints/manifest.json from existing masters, no render
const only = args.filter((a) => !a.startsWith('--'));
// The buyer-facing caption (the selling point: the picture is made of this text). Optional, kept as editable data.
const captions = existsSync(join(ROOT, 'gallery', 'captions.json')) ? JSON.parse(readFileSync(join(ROOT, 'gallery', 'captions.json'), 'utf8')) : {};
mkdirSync(OUT, { recursive: true });

/** One catalog-seed entry for a built master. */
const entryFor = (w, realDim) => {
  const [wpx, hpx] = realDim.split('x').map(Number);
  // The rights basis (text + image, per work) is the record in docs/image-rights.md — one consistent pointer, not
  // an inconsistent per-work licence (most works.json entries carry the licence inline in `source` instead).
  return { id: w.id, title: w.title, caption: captions[w.id] || null, source: w.source, rights: 'Public domain — see docs/image-rights.md', file: `prints/${w.id}.png`, pixels: realDim, dpi: DPI, inches: `${(wpx / DPI).toFixed(1)}x${(hpx / DPI).toFixed(1)}` };
};

/** Merge new entries over the previous manifest so building a subset keeps the other works (like build-gallery.mjs). */
function writeManifest(entries) {
  const previous = existsSync(join(OUT, 'manifest.json')) ? JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8')) : [];
  const byId = new Map(entries.map((e) => [e.id, e]));
  const merged = works.map((w) => byId.get(w.id) || previous.find((p) => p.id === w.id)).filter(Boolean);
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(merged, null, 2) + '\n');
  return merged.length;
}

if (manifestOnly) {
  const entries = [];
  for (const w of works) {
    if (only.length && !only.includes(w.id)) continue;
    const png = join(OUT, `${w.id}.png`);
    if (!existsSync(png)) { console.error(`missing master: prints/${w.id}.png (run the full build first)`); process.exitCode = 1; continue; }
    entries.push(entryFor(w, spawnSync('magick', ['identify', '-format', '%wx%h', png], { encoding: 'utf8' }).stdout.trim()));
  }
  console.log(`manifest rebuilt: ${writeManifest(entries)} works → prints/manifest.json`);
  process.exit(process.exitCode || 0);
}

const cdp = await openChrome();
const manifest = [];
let madeBytes = 0;
try {
  for (const w of works) {
    if (only.length && !only.includes(w.id)) continue;
    const svg = readFileSync(join(ROOT, `gallery/${w.id}.svg`), 'utf8');
    const vb = (/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg) || []);
    if (!vb[1]) throw new Error(`${w.id}: no viewBox in the SVG`);
    const vw = Number(vb[1]), vh = Number(vb[2]);
    const scale = LONG_SIDE_PX / Math.max(vw, vh);
    const widthPx = Math.round(vw * scale), heightPx = Math.round(vh * scale);
    const widthIn = widthPx / DPI, heightIn = heightPx / DPI;

    const pdf = await svgToPdf(cdp, svg, widthIn, heightIn);
    const dir = mkdtempSync(join(tmpdir(), 'tg-print-'));
    const pdfFile = join(dir, 'page.pdf'), rawPng = join(dir, 'raw.png');
    writeFileSync(pdfFile, pdf);
    // Rasterise the single page at 300 DPI; -c rgb keeps it opaque (no alpha), which print shops prefer.
    const draw = spawnSync('mutool', ['draw', '-r', String(DPI), '-c', 'rgb', '-o', rawPng, pdfFile], { encoding: 'utf8', timeout: 300000 });
    if (draw.status !== 0) { rmSync(dir, { recursive: true, force: true }); throw new Error(`${w.id}: mutool draw failed: ${draw.stderr || draw.stdout}`); }
    const outPng = join(OUT, `${w.id}.png`);
    // Stamp the physical resolution so a print shop reads 24 in on the long side.
    const stamp = spawnSync('magick', [rawPng, '-units', 'PixelsPerInch', '-density', String(DPI), outPng]);
    rmSync(dir, { recursive: true, force: true });
    if (stamp.status !== 0) throw new Error(`${w.id}: magick stamp failed: ${String(stamp.stderr).trim()}`);

    const realDim = spawnSync('magick', ['identify', '-format', '%wx%h', outPng], { encoding: 'utf8' }).stdout.trim();
    const bytes = statSync(outPng).size;
    madeBytes += bytes;
    manifest.push(entryFor(w, realDim));
    console.log(`${w.id}: ${realDim}px @ ${DPI} DPI (${widthIn.toFixed(1)}x${heightIn.toFixed(1)} in), ${(bytes / 1048576).toFixed(1)} MB`);
  }
} finally {
  await cdp.close();
}
console.log(`\n${writeManifest(manifest)} print masters, ${(madeBytes / 1048576).toFixed(0)} MB in total → prints/`);
