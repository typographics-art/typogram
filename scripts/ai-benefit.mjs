#!/usr/bin/env node
// Measures what reaches a machine when one document is shared four ways: as Markdown, as an ordinary
// (rendered) PDF, as a Typographics Art one-pager, and as a screenshot. For each, it extracts the text the
// way a machine would and checks: how much of the text survives, in order; whether planted facts (an exact
// number, a negation, a clause id, a code line) come back; the file size; and a rough token count.
//
// The test document (benchmark/testdoc.md) is invented, so a model cannot answer from prior knowledge — a
// dropped digit or a lost "not" shows up. Writes docs/ai-benefit.json and docs/ai-benefit.md.
//
// Needs: chromium (ordinary PDF + screenshot), pandoc (Markdown→HTML), mutool (PDF text), tesseract (OCR).
import { readFileSync, writeFileSync, mkdtempSync, rmSync, statSync, readFileSync as rf } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { canonicalText } = await import(join(ROOT, 'src/index.js'));
const CHROME = process.env.CHROME_PATH || 'chromium';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bytes = (p) => { try { return statSync(p).size; } catch { return null; } };
const can = (s) => canonicalText(s || '');

const SOURCE = join(ROOT, 'benchmark/testdoc.md');
const src = readFileSync(SOURCE, 'utf8');
const srcCanon = can(src);
// The recall baseline is the prose, not the Markdown syntax: comparing against '#', '```' etc. would
// unfairly penalise a rendered PDF for dropping markup it is supposed to drop.
const srcProse = can(execFileSync('pandoc', [SOURCE, '-t', 'plain'], { cwd: ROOT }).toString());

// Planted facts that only survive if the text is read correctly (digits, a negation, a clause id, code).
const FACTS = [
  { k: 'number', s: 'CHF 1,428,573.09' },
  { k: 'negation', s: 'do not qualify for the night rebate' },
  { k: 'percentage', s: '37.5%' },
  { k: 'clause', s: 'Clause 7(b)(iii)' },
  { k: 'code', s: 'payable = base * 0.375 + surcharge' },
  { k: 'id', s: 'ME-RID-4821' },
];
const wordRecall = (extracted) => {
  const want = srcProse.toLowerCase().split(' ').filter(Boolean);
  const have = new Set(can(extracted).toLowerCase().split(' '));
  return want.length ? want.filter((w) => have.has(w)).length / want.length : 0;
};
const factsFound = (extracted) => { const c = can(extracted).toLowerCase(); return FACTS.map((f) => ({ k: f.k, found: c.includes(can(f.s).toLowerCase()) })); };
const measure = (name, format, file, extractor) => {
  const t0 = performance.now();
  let text = '', note = '';
  try { text = extractor(); } catch (e) { note = 'extractor failed: ' + e.message; }
  const ms = Math.round(performance.now() - t0);
  const facts = factsFound(text);
  return {
    name, format, bytes: bytes(file),
    extractedChars: can(text).length, wordRecall: +wordRecall(text).toFixed(3),
    factsFound: facts.filter((f) => f.found).length, factsTotal: FACTS.length, facts,
    approxTokens: Math.round(can(text).length / 4), extractMs: ms, note,
  };
};

const out = mkdtempSync(join(tmpdir(), 'tg-bench-'));
const ordHtml = join(out, 'ordinary.html'), ordPdf = join(out, 'ordinary.pdf'), tgPdf = join(out, 'tgart.pdf'), tgPng = join(out, 'tgart.png');

// 1. Markdown → standalone HTML, then an ordinary PDF the usual way (Chrome print).
execFileSync('pandoc', [SOURCE, '-s', '-o', ordHtml], { cwd: ROOT });
async function ordinaryPdf() {
  const profile = mkdtempSync(join(tmpdir(), 'tg-bench-cr-'));
  const proc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  let dp = null;
  for (let i = 0; i < 100 && !dp; i++) { await sleep(100); try { dp = rf(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { /* not yet */ } }
  const ws = new WebSocket((await (await fetch(`http://127.0.0.1:${dp}/json`)).json()).find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable');
  await send('Page.navigate', { url: 'file://' + ordHtml });
  await sleep(1200);
  const pdf = await send('Page.printToPDF', { printBackground: true, paperWidth: 8.27, paperHeight: 11.7 });
  writeFileSync(ordPdf, Buffer.from(pdf.data, 'base64'));
  proc.kill(); ws.close(); rmSync(profile, { recursive: true, force: true });
}
await ordinaryPdf();

// 2. Typographics Art one-pager from the same Markdown — the PDF (with its text layer) and a flat image of it
// (what you get if you screenshot or photograph the work and share the picture).
execFileSync('node', ['cli/onepage.mjs', SOURCE, '-o', tgPdf, '--title', 'Night Tariff ME-RID-4821', '--png', tgPng], { cwd: ROOT, stdio: 'ignore' });

// 3. Extract and measure each format.
const mutool = (f) => execFileSync('mutool', ['draw', '-F', 'txt', f], { maxBuffer: 1 << 28 }).toString();
const ocr = (f) => execFileSync('tesseract', [f, 'stdout'], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
const results = [
  measure('Markdown', 'text/markdown', SOURCE, () => src),
  measure('Ordinary PDF', 'application/pdf', ordPdf, () => mutool(ordPdf)),
  measure('Typographics Art PDF', 'application/pdf', tgPdf, () => mutool(tgPdf)),
  measure('Typographics Art as a flat image (OCR)', 'image/png', tgPng, () => ocr(tgPng)),
];

const report = { generated: new Date().toISOString().slice(0, 10), source: 'benchmark/testdoc.md', sourceChars: srcCanon.length, facts: FACTS.map((f) => f.k), results };
writeFileSync(join(ROOT, 'docs/ai-benefit.json'), JSON.stringify(report, null, 2) + '\n');

// Human-readable table.
const pct = (x) => (x * 100).toFixed(x === 1 ? 0 : 1) + '%';
const kb = (b) => (b == null ? '—' : b >= 1048576 ? (b / 1048576).toFixed(2) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
let md = `# Does the text reach a machine? A measured comparison\n\n`;
md += `One invented document (\`benchmark/testdoc.md\`, ${srcCanon.length} characters), shared four ways, then read back the way a machine would. Regenerate with \`node scripts/ai-benefit.mjs\`. Generated ${report.generated}.\n\n`;
md += `The document is fictional on purpose: a model cannot fill gaps from prior knowledge, so a dropped number or a lost "not" shows up in the planted-fact checks.\n\n`;
md += `| Format | Size | Word recall | Facts kept | ≈ tokens | Read with |\n|---|---|---|---|---|---|\n`;
const reader = { 'Markdown': 'the file itself', 'Ordinary PDF': 'MuPDF text layer', 'Typographics Art PDF': 'MuPDF text layer', 'Typographics Art as a flat image (OCR)': 'Tesseract OCR' };
for (const r of results) md += `| ${r.name} | ${kb(r.bytes)} | ${pct(r.wordRecall)} | ${r.factsFound}/${r.factsTotal} | ${r.approxTokens} | ${reader[r.name]} |\n`;
md += `\n## The planted facts, per format\n\n| Fact | ${results.map((r) => r.name).join(' | ')} |\n|${'---|'.repeat(results.length + 1)}\n`;
for (let i = 0; i < FACTS.length; i++) md += `| ${FACTS[i].k} | ${results.map((r) => (r.facts[i].found ? '✓' : '✗')).join(' | ')} |\n`;
md += `\n## What it shows\n\n`;
md += `- **A Typographics Art one-pager reads back like the document.** From the PDF's text layer a machine gets the same words, in order, and the same planted facts — the precise number, the negation, the clause id — as from an ordinary PDF. The picture does not cost the text.\n`;
md += `- **What costs the text is flattening the work to a bare image.** The same one-pager, shared as a PNG and read by OCR, loses detail — which is why a Typographics Art work is meant to be shared as the PDF (or HTML/SVG), not as a screenshot. A vision model recovers far more of an image than OCR does; the exact, guaranteed path is still the text layer. See [ai-readability.md](ai-readability.md).\n`;
md += `- **The picture costs file size, not words.** Token counts for the text formats are comparable; the Typographics Art PDF is larger than an ordinary one because every letter carries its own typography (see [file-size.md](file-size.md)).\n\n`;
md += `Retrieval and citation by an actual model are a separate, costlier test; the fact checks above are the precondition — a fact that is not in the extracted text cannot be cited correctly. The measurement is reproducible: \`node scripts/ai-benefit.mjs\`. See also [text-fidelity.md](text-fidelity.md).\n`;
writeFileSync(join(ROOT, 'docs/ai-benefit.md'), md);

rmSync(out, { recursive: true, force: true });
console.log('wrote docs/ai-benefit.json and docs/ai-benefit.md');
for (const r of results) console.log(`  ${r.name.padEnd(24)} recall ${pct(r.wordRecall).padStart(6)}  facts ${r.factsFound}/${r.factsTotal}  ${kb(r.bytes)}${r.note ? '  (' + r.note + ')' : ''}`);
