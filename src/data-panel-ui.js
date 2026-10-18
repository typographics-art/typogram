// The generator's "Data in this work" panel (app.html, <details id="data">): attach a data file, see what will be written,
// then put the TGD block into the work's text or seal it with a key. The decisions are in src/data-panel.js (tested in
// Node); this file only connects them to the page. Nothing is uploaded, and no key, record or data goes into the address,
// local storage or a log: the key lives in one read-only text box until the person clears it.
import { encode, verify, stripText, TgdError, DEFAULT_LIMITS } from './structured.js';
import { sealData2 } from './keys-work.js';
import { canonicalText } from './secret.js';
import {
  ACCEPT, T, applyLang, detectWebFormat, summarize, summaryLine, isEmptyModel, capacity, composeWork, warningsFor, lossyText, generatorError,
  downloadName, intFmt,
} from './data-panel.js';
import { h, errorBox, noteBox, showError, clearSlot, sheetViewer, outlineView, copyText, saveBlob, injectStyles } from './data-ui.js';

const SAMPLE_FILES = { xlsx: 'samples/data/bakery-orders.xlsx', csv: 'samples/data/bakery-orders.csv' };
const ENCODINGS = ['windows-1252', 'iso-8859-1', 'iso-8859-15', 'windows-1250', 'utf-16le'];

/**
 * What the browser reads at most (the library's defaults are for the command line): a work holds about 600,000 characters of
 * data on one A4 page, so a million cells is already far beyond any work; a 16 MiB .xlsx can hold a million rows, which took
 * 1.3 GB of memory to read in a test, and an archive part is bounded with it.
 */
export const BROWSER_LIMITS = Object.freeze({ maxCells: 1_000_000, maxDense: 2_000_000, zip: { maxEntryBytes: 64 * 1024 * 1024, maxTotalBytes: 96 * 1024 * 1024 } });
/** A read that takes longer than this in the worker is given up (the text 'e.timeout' in data-panel.js names the two minutes). */
const READ_TIME_LIMIT_MS = 120_000;
let reading = null; // the worker of the file being read, so that a newer file stops it

/** Reads a file in a module worker (the page stays responsive); falls back to the page itself where workers are unavailable. */
function encodeOffThread(payload, opts) {
  const created = new Date();
  if (reading) { reading.stop(new TgdError('cancelled', 'A newer file replaced this one')); reading = null; }
  return new Promise((resolve, reject) => {
    const direct = () => encode({ bytes: payload.bytes, name: payload.name, format: payload.format }, { ...opts, created }).then(resolve, reject);
    let worker;
    try { worker = new Worker(new URL('./data-worker.js', import.meta.url), { type: 'module' }); } catch { direct(); return; }
    const done = () => { clearTimeout(timer); worker.terminate(); if (reading?.worker === worker) reading = null; };
    const timer = setTimeout(() => { done(); reject(new TgdError('timeout', `Reading was given up after ${READ_TIME_LIMIT_MS / 1000} seconds`)); }, READ_TIME_LIMIT_MS);
    reading = { worker, stop: (err) => { done(); reject(err); } };
    worker.onmessage = (e) => {
      done();
      if (e.data.ok) resolve(e.data.result);
      else reject(new TgdError(e.data.error.code || 'unknown', e.data.error.message));
    };
    worker.onerror = () => { done(); direct(); };
    worker.postMessage({ ...payload, opts: { ...opts, created: created.toISOString().replace(/\.\d+Z$/, 'Z') } });
  });
}

/**
 * Connects the panel in `root` to the generator.
 * @param {object} ctx  root, lang(): 'en'|'de', prose(): the text box, proseIsSample(): the text box still holds the built-in sample, workCanon(): the canonical text of the work as set,
 *   rerun(): Promise that settles when the work has been set again with the current text
 * @returns {{compose(prose:string):string, setLang():void, afterRun():void, open():void}}
 */
export function mountDataPanel(ctx) {
  injectStyles();
  const root = ctx.root;
  const $ = (s) => root.querySelector(s);
  const S = {
    file: null, enc: null, summary: null, sum: null, encoding: undefined, unicode: 'safe', attach: false, placement: 'after', lead: '',
    active: false, sealedFor: null, token: 0, status: null, result: null, genErr: null, goErr: null,
  };
  const L = () => ctx.lang();
  const el = {
    file: $('#dataFile'), drop: $('#dataDrop'), status: $('#dataStatus'), err: $('#dataErr'), card: $('#dataCard'), name: $('#dataName'), summary: $('#dataSummary'),
    remove: $('#dataRemove'), warn: $('#dataWarn'), preview: $('#dataPreview'), meter: $('#dataMeter'), meterText: $('#dataMeterText'), fit: $('#dataFit'),
    lost: $('#dataLost'), lostList: $('#dataLostList'), plain: $('#dataPlain'), attach: $('#dataAttach'), lead: $('#dataLead'), textOpts: $('#dataTextOpts'),
    sealOpts: $('#dataSealOpts'), pad: $('#dataPad'), deflate: $('#dataDeflate'), go: $('#dataGo'), unwrite: $('#dataUnwrite'), goErr: $('#dataGoErr'),
    result: $('#dataResult'), sealOut: $('#dataSealOut'), key: $('#dataKey'), record: $('#dataRecord'), stale: $('#dataStale'), leadRow: $('#dataLeadRow'),
    copyKey: $('#dataCopyKey'), clearKey: $('#dataClearKey'), copyRecord: $('#dataCopyRecord'), saveRecord: $('#dataSaveRecord'),
  };
  el.file.accept = ACCEPT;
  const choice = () => root.querySelector('input[name="dataChoice"]:checked').value;
  const placement = () => root.querySelector('input[name="dataPlace"]:checked').value;

  // ---- messages (kept as keys, so a change of language repaints them) ----
  const say = (slot, msg) => { slot.textContent = msg ? T(L(), msg[0], msg[1] || {}) : ''; slot.className = `hint ${msg?.[2] || ''}`; };
  const setStatus = (key, vars) => { S.status = key ? [key, vars] : null; say(el.status, S.status); };
  const setResult = (key, vars, cls) => { S.result = key ? [key, vars, cls] : null; say(el.result, S.result); };

  const paintErrors = (focus = false) => {
    clearSlot(el.err);
    if (S.genErr) {
      const { err, ctx: c } = S.genErr;
      const info = generatorError(err, L(), c);
      const actions = info.actions.map((a) => (a === 'encoding' ? { node: encodingPicker() } : { label: T(L(), 'd.choose'), onClick: () => el.file.click() }));
      showError(el.err, errorBox(info, actions, { lang: L() }), focus);
    }
    clearSlot(el.goErr);
    if (S.goErr) showError(el.goErr, S.goErr(), focus);
  };
  const encodingPicker = () => h('span', { class: 'dui-row' },
    h('label', { class: 'dui-field-label', for: 'dataEncoding', text: T(L(), 'e.encodingLabel') }),
    h('select', { id: 'dataEncoding', onchange: (e) => { S.encoding = e.target.value; } }, ENCODINGS.map((e) => h('option', { value: e, text: e, selected: e === S.encoding }))),
    h('button', { type: 'button', class: 'primary', text: T(L(), 'e.readAgain'), onclick: () => { S.encoding ||= ENCODINGS[0]; reload(); } }));

  // ---- reading a file ----
  const encodeOptions = () => ({ unicode: S.unicode, attach: S.attach, encoding: S.encoding, layout: 'rows', limits: BROWSER_LIMITS });
  async function loadBytes(name, bytes, size = bytes.length) {
    const token = ++S.token;
    S.file = { name, bytes };
    S.genErr = null; S.goErr = null;
    paintErrors();
    setStatus('d.reading', { name });
    try {
      if (size > DEFAULT_LIMITS.maxInputBytes) {
        throw Object.assign(new TgdError('fileTooBig', 'too big'), { size: (size / 1048576).toFixed(1) });
      }
      const format = detectWebFormat(name, bytes);
      if (!format) throw new TgdError('format', `Unknown file type (${name})`);
      const enc = await encodeOffThread({ bytes, name, format }, encodeOptions());
      if (token !== S.token) return;
      const summary = summarize(enc.model, enc.format);
      if (isEmptyModel(summary)) throw new TgdError('empty', 'No data');
      S.enc = enc; S.summary = summary;
      S.sum = /"sum":"([0-9a-f]{64})"/.exec(stripText(enc.text))?.[1] ?? null;
      if (!S.placementTouched) {
        root.querySelector(`input[name="dataPlace"][value="${ctx.proseIsSample() ? 'only' : 'after'}"]`).checked = true;
        S.placement = placement();
      }
      setStatus(null);
      render();
      if (S.active) await write();
    } catch (err) {
      if (token !== S.token) return;
      setStatus(null);
      S.enc = null; S.summary = null;
      const c = err.code === 'fileTooBig' ? { code: 'fileTooBig', name, size: err.size, max: DEFAULT_LIMITS.maxInputBytes / 1048576 } : { name };
      S.genErr = { err, ctx: c };
      if (S.active) { S.active = false; ctx.rerun(); }
      render();
      paintErrors(true);
    }
  }
  const reload = () => { if (S.file) loadBytes(S.file.name, S.file.bytes); };
  async function takeFile(file) {
    if (!file) return;
    if (file.size > DEFAULT_LIMITS.maxInputBytes) { await loadBytes(file.name, new Uint8Array(0), file.size); return; }
    await loadBytes(file.name, new Uint8Array(await file.arrayBuffer()));
  }
  async function takeSample(kind) {
    try {
      const r = await fetch(SAMPLE_FILES[kind]);
      if (!r.ok) throw new Error(`${r.status}`);
      await loadBytes(SAMPLE_FILES[kind].split('/').pop(), new Uint8Array(await r.arrayBuffer()));
    } catch (err) {
      S.genErr = { err: Object.assign(new Error(err.message), { code: 'unknown' }), ctx: { name: SAMPLE_FILES[kind] } };
      paintErrors(true);
    }
  }

  // ---- drawing the card ----
  const compose = (prose) => (S.active && S.enc ? composeWork({ prose, lead: S.lead, block: S.enc.text, placement: S.placement }) : prose);
  const totalChars = () => composeWork({ prose: ctx.prose(), lead: S.lead, block: S.enc ? S.enc.text : '', placement: S.placement }).length;

  const mmText = (mm) => (mm < 1 ? mm.toFixed(2) : mm.toFixed(1));

  /** The parts that depend on the text of the work (space, fit, warnings): repainted after every setting of the work. */
  function renderSpace() {
    if (!S.enc) return;
    const { summary, enc } = S;
    const cap = capacity(totalChars());
    el.meter.value = Math.min(1, cap.share);
    el.meterText.textContent = T(L(), 'd.spaceOf', { used: intFmt(cap.chars, L()), cap: intFmt(cap.cap, L()), mm: mmText(cap.mm) });
    el.fit.replaceChildren();
    if (cap.state === 'over') el.fit.append(errorBox({ title: T(L(), 'd.fitsOver'), body: T(L(), 'd.fitsOverBody', { x: intFmt(Math.round(cap.share * 10) / 10, L()) }) }));
    else if (cap.state === 'tight') el.fit.append(noteBox(T(L(), 'd.fitsTight', { mm: mmText(cap.mm) }), 'warn'));
    else el.fit.append(h('p', { class: 'hint', text: T(L(), 'd.fitsOk') }));
    root.querySelector('input[name="dataChoice"][value="text"]').disabled = cap.state === 'over';
    if (cap.state === 'over' && choice() === 'text') {
      root.querySelector('input[name="dataChoice"][value="seal"]').checked = true;
      choiceChanged();
    }
    el.warn.replaceChildren(...warningsFor({ summary, model: enc.model, lang: L(), withProse: choice() === 'text' && !!ctx.prose().trim() && placement() === 'after', over: cap.state === 'over' })
      .map((w) => noteBox(w.text, w.level === 'warn' ? 'warn' : 'info')), ...enc.warnings.map((w) => noteBox(w, 'warn')));
  }

  function choiceChanged() {
    el.textOpts.hidden = choice() !== 'text';
    el.sealOpts.hidden = choice() !== 'seal';
    el.go.textContent = T(L(), choice() === 'seal' ? 'd.seal' : 'd.write');
  }

  function render() {
    applyLang(root, L());
    el.card.hidden = !S.enc;
    el.leadRow.hidden = placement() !== 'only';
    const padVal = el.pad.value || '0';
    el.pad.replaceChildren(...[0, 1, 4, 16].map((k) => h('option', { value: String(k * 1024), text: k ? T(L(), 'd.padN', { n: k }) : T(L(), 'd.pad0') })));
    el.pad.value = padVal;
    choiceChanged();
    el.unwrite.hidden = !S.active;
    say(el.status, S.status);
    say(el.result, S.result);
    if (S.enc) {
      const { summary, enc } = S;
      el.name.textContent = S.file.name;
      el.summary.textContent = summaryLine(summary, L());
      el.preview.replaceChildren(h('p', { class: 'dui-field-label', text: T(L(), 'd.previewTitle') }),
        summary.kind === 'workbook' ? sheetViewer(enc.model, summary, { lang: L(), rows: 8 }) : outlineView(enc.model, L()));
      const lost = lossyText(enc.lossy, L());
      el.lost.textContent = T(L(), 'd.lost', { list: lost.slice(0, 4).join('; ') });
      el.lostList.replaceChildren(...lost.map((s) => h('li', { text: s })));
      renderSpace();
    }
    paintErrors();
  }

  // ---- the two actions ----
  const busy = (on) => {
    el.go.disabled = on;
    if (on) setResult('d.working');
    else if (S.result?.[0] === 'd.working') setResult(null);
  };
  async function write() {
    busy(true);
    try {
      S.active = true;
      S.goErr = null;
      await ctx.rerun();
      const rep = await verify(canonicalText(ctx.workCanon()));
      if (rep.ok && rep.blocks.some((b) => b.sum === S.sum)) {
        setResult('d.written', { chars: intFmt(totalChars(), L()), sum: S.sum.slice(0, 16) + '\u2026' }, 'good');
      } else {
        const message = rep.blocks.find((b) => !b.ok)?.message || 'no data block found in the text of the work';
        S.goErr = () => errorBox({ title: T(L(), 'd.checkFailTitle'), body: T(L(), 'd.checkFailBody', { message }) },
          S.unicode === 'ascii' ? [] : [{ label: T(L(), 'd.checkFailRetry'), primary: true, onClick: async () => { S.unicode = 'ascii'; el.plain.checked = false; await loadBytes(S.file.name, S.file.bytes); await write(); } }], { lang: L() });
        paintErrors(true);
      }
    } finally { busy(false); el.unwrite.hidden = !S.active; }
  }
  async function unwrite() {
    S.active = false;
    S.goErr = null;
    el.unwrite.hidden = true;
    clearSlot(el.goErr);
    await ctx.rerun();
    setResult('d.removed');
  }
  async function seal() {
    S.goErr = null;
    clearSlot(el.goErr);
    const work = ctx.workCanon();
    if (!work.trim()) { S.goErr = () => errorBox({ title: T(L(), 'd.seal'), body: T(L(), 'd.sealNeedWork') }, [], { lang: L() }); paintErrors(true); return; }
    busy(true);
    try {
      const r = await sealData2(work, S.enc.text, { pad: Number(el.pad.value) || 0, compress: el.deflate.checked });
      S.sealedFor = canonicalText(work);
      el.key.value = r.key;
      el.record.value = r.record;
      el.sealOut.hidden = false;
      setResult('d.sealed', { k: intFmt(r.key.length, L()), r: intFmt(r.record.length, L()) }, 'good');
      el.key.focus();
      el.key.select();
      afterRun();
    } catch (err) {
      S.goErr = () => errorBox({ title: T(L(), 'o.title'), body: String(err?.message || err), code: err?.code }, [], { lang: L() });
      paintErrors(true);
    } finally { busy(false); }
  }

  // ---- wiring ----
  el.file.addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; takeFile(f); });
  ['dragenter', 'dragover'].forEach((ev) => el.drop.addEventListener(ev, (e) => { e.preventDefault(); el.drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => el.drop.addEventListener(ev, (e) => { e.preventDefault(); el.drop.classList.remove('over'); }));
  el.drop.addEventListener('drop', (e) => takeFile(e.dataTransfer.files[0]));
  $('#dataSampleXlsx').addEventListener('click', () => takeSample('xlsx'));
  $('#dataSampleCsv').addEventListener('click', () => takeSample('csv'));
  el.remove.addEventListener('click', async () => {
    S.token++;
    S.file = null; S.enc = null; S.summary = null; S.genErr = null; S.goErr = null; S.encoding = undefined; S.placementTouched = false;
    const was = S.active;
    S.active = false;
    el.sealOut.hidden = true; el.key.value = ''; el.record.value = ''; S.sealedFor = null;
    setStatus(null); setResult(null);
    render();
    if (was) await ctx.rerun();
    el.file.focus();
  });
  root.querySelectorAll('input[name="dataChoice"]').forEach((r) => r.addEventListener('change', async () => {
    if (choice() === 'seal' && S.active) await unwrite();
    setResult(null);
    choiceChanged();
    renderSpace();
  }));
  root.querySelectorAll('input[name="dataPlace"]').forEach((r) => r.addEventListener('change', async () => { S.placementTouched = true; S.placement = placement(); render(); if (S.active) await write(); }));
  el.lead.addEventListener('change', async () => { S.lead = el.lead.value; if (S.active) await write(); });
  el.plain.addEventListener('change', () => { S.unicode = el.plain.checked ? 'plain' : 'safe'; reload(); });
  el.attach.addEventListener('change', () => { S.attach = el.attach.checked; reload(); });
  el.go.addEventListener('click', () => (choice() === 'seal' ? seal() : write()));
  el.unwrite.addEventListener('click', unwrite);
  el.copyKey.addEventListener('click', async () => {
    const ok = await copyText(el.key.value);
    if (!ok) { el.key.focus(); el.key.select(); }
    setResult(ok ? 'd.keyCopied' : 'd.copyFail', {}, ok ? 'good' : 'bad');
  });
  el.copyRecord.addEventListener('click', async () => {
    const ok = await copyText(el.record.value);
    if (!ok) { el.record.focus(); el.record.select(); }
    setResult(ok ? 'd.recordCopied' : 'd.copyFail', {}, ok ? 'good' : 'bad');
  });
  el.saveRecord.addEventListener('click', () => {
    saveBlob(el.record.value + '\n', downloadName(S.file?.name, 'tgs'), 'text/plain');
    setResult('d.recordSaved', {}, 'good');
  });
  el.clearKey.addEventListener('click', () => {
    el.key.value = '';
    setResult('d.keyCleared', {}, 'good');
    el.go.focus();
  });
  el.key.addEventListener('focus', () => el.key.select());
  el.record.addEventListener('focus', () => el.record.select());

  /** After the work has been set again: is a sealed key still the key of this text? */
  function afterRun() {
    renderSpace();
    clearSlot(el.stale);
    if (S.sealedFor === null) return;
    if (canonicalText(ctx.workCanon()) !== S.sealedFor) {
      el.stale.replaceChildren(noteBox(T(L(), 'd.sealStale'), 'warn'));
      el.stale.hidden = false;
    }
  }
  const open = () => { const d = root; d.open = true; d.scrollIntoView({ block: 'start' }); };
  render();
  return { compose, setLang: render, afterRun, open };
}

