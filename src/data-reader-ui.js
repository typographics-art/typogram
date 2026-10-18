// The work page's data section (work.html, Machine view): shows the TGD data blocks of the work's text as cards (table preview
// with sheet tabs, types, checksum status, downloads, copy) and opens sealed data with a key. Decisions live in
// src/data-panel.js (tested in Node). The key goes into one text box, is sent nowhere, is never put into the address and is
// never stored; every error appears directly under the button that caused it.
import { decodeAll, toFile, TgdError } from './structured.js';
import { openSealed, findSealedBlocks } from './crypt.js';
import { readWorkFile } from './work-text.js';
import { canonicalText } from './secret.js';
import {
  T, applyLang, summarize, summaryLine, exportFormats, downloadName, blockError, openError, badPrefixField, lossyText, blockJson, intFmt,
} from './data-panel.js';
import { h, errorBox, noteBox, showError, clearSlot, sheetViewer, outlineView, copyText, saveBlob, injectStyles } from './data-ui.js';

const MAX_MODEL_CHARS = 2_000_000;
let cardCount = 0;

/**
 * @param {object} ctx  root: the section element, lang(): 'en'|'de', work(): the canonical text of the work (''), onLocalWork({ name, canonical }):
 *   called when the person opens a work file from their computer
 * @returns {{update():Promise<void>, setLang():void, json():object[]}}
 */
export function mountDataReader(ctx) {
  injectStyles();
  const root = ctx.root;
  const L = () => ctx.lang();
  const R = { blocks: [], token: 0, recordFromWork: false, opened: null, openStatus: null, openErr: null, local: null };

  // ---- static skeleton (the sealed form keeps what the person typed across redraws) ----
  root.classList.add('dui');
  const cards = h('div', { class: 'dui', id: 'dataCards' });
  const keyBox = h('textarea', { id: 'openKey', rows: '2', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', 'aria-describedby': 'openHelp' });
  const recBox = h('textarea', { id: 'openRecord', rows: '3', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off' });
  const openBtn = h('button', { type: 'button', class: 'primary', id: 'openGo', 'data-d': 'r.open' });
  const clearBtn = h('button', { type: 'button', id: 'openClear', 'data-d': 'r.clearKey' });
  const recFile = h('input', { type: 'file', id: 'openRecordFile', class: 'sr', accept: '.tgs,.txt,text/plain' });
  const openErr = h('div', { id: 'openErr', hidden: true });
  const openStatus = h('p', { class: 'hint', id: 'openStatus', role: 'status' });
  const opened = h('div', { class: 'dui', id: 'openedData' });
  const recHint = h('p', { class: 'hint', id: 'openFromWork', hidden: true, 'data-d': 'r.recordFromWork' });
  const sealed = h('details', { id: 'sealedBox' },
    h('summary', { 'data-d': 'r.sealedH' }),
    h('div', { class: 'dui' },
      h('p', { class: 'hint', id: 'openHelp', 'data-d': 'r.sealedHelp' }),
      h('label', { class: 'dui-field-label', for: 'openKey', 'data-d': 'r.keyLabel' }), keyBox,
      h('label', { class: 'dui-field-label', for: 'openRecord', 'data-d': 'r.recordLabel' }), recBox, recHint,
      h('div', { class: 'dui-row' }, openBtn, clearBtn, h('label', { class: 'btn', for: 'openRecordFile' }, h('span', { 'data-d': 'r.recordFile' }), recFile)),
      openErr, openStatus, opened));
  const localInput = h('input', { type: 'file', id: 'localWorkFile', class: 'sr', accept: '.svg,.html,.htm,.pdf,.txt,.md' });
  const localErr = h('div', { id: 'localErr', hidden: true });
  const localMsg = h('p', { class: 'hint', id: 'localMsg', role: 'status' });
  const local = h('details', { id: 'localBox' },
    h('summary', { 'data-d': 'r.localH' }),
    h('div', { class: 'dui' }, h('p', { class: 'hint', 'data-d': 'r.localHelp' }),
      h('label', { class: 'btn', for: 'localWorkFile' }, h('span', { 'data-d': 'r.localChoose' }), localInput), localErr, localMsg));
  root.replaceChildren(h('h3', { class: 'dui-h', 'data-d': 'r.data' }), cards, sealed, local);

  // ---- opening sealed data ----
  const say = (slot, key, vars, cls = '') => { slot.textContent = key ? T(L(), key, vars) : ''; slot.className = `hint ${cls}`; };
  const setOpenErr = (e, field) => { R.openArgs = { code: e?.code, field }; R.openErr = openError(e, L(), { field }); };
  const paintOpenErr = (focus) => { clearSlot(openErr); if (R.openErr) showError(openErr, errorBox(R.openErr, [], { lang: L() }), focus); };
  async function openIt() {
    clearSlot(openErr);
    R.openErr = null;
    opened.replaceChildren();
    R.opened = null;
    say(openStatus, 'r.working');
    const key = keyBox.value, record = recBox.value;
    try {
      const r = await openSealed(ctx.work() || null, { key, record: record.trim() ? record : undefined });
      R.opened = r;
      if (r.kind === 'tgd') {
        say(openStatus, 'o.opened', { sum: r.block.sum.slice(0, 16) + '…' }, 'good');
        opened.replaceChildren(blockCard(r.block, { raw: `TGD1[${r.text}]TGD1` }));
      } else if (r.kind === 'text') {
        say(openStatus, 'o.openedText', {}, 'good');
        opened.replaceChildren(h('pre', { class: 'dui-pre', id: 'openedText', text: r.text }));
      } else {
        say(openStatus, 'r.openedBytes', { n: intFmt(r.bytes.length, L()) }, 'good');
        opened.replaceChildren(h('button', { type: 'button', text: T(L(), 'r.saveFile'), onclick: () => saveBlob(r.bytes, 'sealed-file.bin') }));
      }
    } catch (e) {
      say(openStatus, null);
      setOpenErr(e, badPrefixField(key, record));
      paintOpenErr(true);
    }
  }
  openBtn.addEventListener('click', openIt);
  clearBtn.addEventListener('click', () => {
    keyBox.value = '';
    say(openStatus, 'r.keyCleared', {}, 'good');
    keyBox.focus();
  });
  recFile.addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 40 * 1024 * 1024) { setOpenErr({ code: 'too-large' }, ''); paintOpenErr(true); return; }
    recBox.value = await f.text();
    R.recordFromWork = false;
    recHint.hidden = true;
  });

  // ---- opening a work file from the computer ----
  localInput.addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    clearSlot(localErr);
    try {
      const text = canonicalText(await readWorkFile(f));
      R.local = { name: f.name, chars: text.length };
      localMsg.textContent = T(L(), 'r.localLoaded', { name: f.name, chars: intFmt(text.length, L()) });
      localMsg.className = 'hint good';
      ctx.onLocalWork({ name: f.name, canonical: text });
    } catch (err) {
      localMsg.textContent = '';
      showError(localErr, errorBox({ title: T(L(), 'r.localH'), body: T(L(), 'r.localFail', { message: String(err?.message || err) }) }, [], { lang: L() }));
    }
  });

  // ---- one block as a card ----
  function blockCard(block, { raw }) {
    const model = block.model, summary = summarize(model, block.format), lang = L();
    const slot = h('div', { class: 'dui-slot', hidden: true });
    const msg = h('p', { class: 'hint dui-copymsg', role: 'status' });
    const content = h('div', {});
    const state = { tab: 'table', unguard: false };
    const tabBtn = (id, label) => h('button', { type: 'button', 'data-tab': id, 'aria-pressed': String(state.tab === id), text: label, onclick: () => { state.tab = id; paintTabs(); } });
    const tabs = h('div', { class: 'dui-tabs', role: 'group', 'aria-label': T(lang, 'r.data') });
    function paintTabs() {
      tabs.replaceChildren(tabBtn('table', T(lang, 'r.tabTable')), tabBtn('model', T(lang, 'r.tabModel')), tabBtn('text', T(lang, 'r.tabText')));
      if (state.tab === 'table') content.replaceChildren(summary.kind === 'workbook' ? sheetViewer(model, summary, { lang, rows: 50, expandable: true }) : outlineView(model, lang));
      else if (state.tab === 'model') { const j = blockJson(block); content.replaceChildren(h('pre', { class: 'dui-pre', text: j.length > MAX_MODEL_CHARS ? j.slice(0, MAX_MODEL_CHARS) + '\n…' : j })); }
      else content.replaceChildren(h('pre', { class: 'dui-pre', text: raw.length > MAX_MODEL_CHARS ? raw.slice(0, MAX_MODEL_CHARS) + ' …' : raw }));
    }
    paintTabs();

    // downloads
    const formulas = h('input', { type: 'checkbox', id: `formulas-${++cardCount}` });
    const sheetSel = summary.kind === 'workbook' && summary.sheets.length > 1
      ? h('select', { 'aria-label': T(lang, 'r.csvSheet') }, summary.sheets.map((s, i) => h('option', { value: s.name, text: s.name, selected: i === 0 }))) : null;
    async function download(fmt, unguard = false) {
      clearSlot(slot);
      try {
        const f = fmt === 'model' ? { bytes: new TextEncoder().encode(blockJson(block) + '\n'), name: downloadName(block.name, '.tgd.json'), mime: 'application/json', notes: [] }
          : await toFile(block, fmt, { safe: !unguard, formulas: formulas.checked, sheet: sheetSel && ['csv', 'tsv'].includes(fmt) ? sheetSel.value : undefined });
        const ext = /(\.[^.]+)$/.exec(f.name)?.[1] || `.${fmt}`;
        saveBlob(f.bytes, fmt === 'model' ? f.name : downloadName(f.name, ext), f.mime);
        msg.textContent = T(lang, 'r.downloaded', { name: fmt === 'model' ? f.name : downloadName(f.name, ext) });
        for (const note of f.notes || []) {
          const g = /^(\d+) cells? starting with/.exec(note);
          const box = g ? h('div', {}, noteBox(T(lang, 'r.guard', { n: g[1] }), 'info'), h('button', { type: 'button', 'data-guard': 'off', text: T(lang, 'r.guardOff'), onclick: () => confirmUnguard(fmt) })) : noteBox(note, 'info');
          slot.append(box);
          slot.hidden = false;
        }
      } catch (e) {
        if (!(e instanceof TgdError)) throw e;
        showError(slot, errorBox(blockError(e, lang, { format: `.${fmt}` }), [], { lang }));
      }
    }
    function confirmUnguard(fmt) {
      clearSlot(slot);
      slot.append(noteBox(T(lang, 'r.guardOffConfirm'), 'warn'), h('button', { type: 'button', 'data-guard': 'confirm', text: T(lang, 'r.guardOffYes'), onclick: () => download(fmt, true) }));
      slot.hidden = false;
    }
    const downloads = h('div', { class: 'dui-row' }, h('span', { class: 'dui-field-label', text: T(lang, 'r.download') }),
      exportFormats(model.kind, block.format).map((f) => h('button', { type: 'button', 'data-format': f.id, class: f.primary ? 'primary' : '', text: f.label, onclick: () => download(f.id) })),
      h('button', { type: 'button', 'data-format': 'model', text: T(lang, 'r.downloadModel'), onclick: () => download('model') }), sheetSel);
    const copyRow = h('div', { class: 'dui-row' }, h('span', { class: 'dui-field-label', text: T(lang, 'r.copy') }),
      h('button', { type: 'button', 'data-copy': 'block', text: T(lang, 'r.copyBlock'), onclick: async () => { msg.textContent = T(lang, (await copyText(raw)) ? 'r.copied' : 'r.copyFail'); } }),
      h('button', { type: 'button', 'data-copy': 'model', text: T(lang, 'r.copyModel'), onclick: async () => { msg.textContent = T(lang, (await copyText(blockJson(block))) ? 'r.copied' : 'r.copyFail'); } }));
    const lost = lossyText(block.lossy || [], lang);
    return h('div', { class: 'dui-card' },
      h('div', { class: 'dui-head' }, h('div', {}, h('b', { text: block.name || '?' }), ' ',
        h('span', { class: 'hint', text: [summaryLine(summary, lang), block.created ? T(lang, 'r.created', { date: block.created.slice(0, 10) }) : null, block.by].filter(Boolean).join(' · ') }))),
      h('p', { class: 'dui-verified dui-ok-line' }, h('span', { 'aria-hidden': 'true', text: '✔ ' }), T(lang, 'r.verified'), ' ',
        h('code', { class: 'dui-sum', title: `sha256:${block.sum}`, text: `sha256:${block.sum.slice(0, 16)}…` }), ' ',
        h('button', { type: 'button', 'data-copy': 'sum', text: T(lang, 'r.copySum'), onclick: async () => { msg.textContent = T(lang, (await copyText(block.sum)) ? 'r.copied' : 'r.copyFail'); } })),
      h('p', { class: 'hint', text: T(lang, 'r.verifiedLong') }),
      tabs, content,
      lost.length ? h('p', { class: 'hint', text: T(lang, 'r.lost', { list: lost.join('; ') }) }) : null,
      downloads,
      summary.formulas ? h('label', { class: 'dui-opt' }, formulas, ' ', h('span', { text: T(lang, 'r.formulas') })) : null,
      slot, copyRow, msg);
  }

  function damagedCard(entry, rawText) {
    const lang = L();
    const pre = h('pre', { class: 'dui-pre', hidden: true, text: rawText.length > MAX_MODEL_CHARS ? rawText.slice(0, MAX_MODEL_CHARS) + ' …' : rawText });
    const info = blockError(entry.error, lang);
    const actions = info.actions.map((a) => (a === 'showBlock'
      ? { label: T(lang, 'r.showBlock'), onClick: () => { pre.hidden = !pre.hidden; } }
      : { label: T(lang, 'r.downloadBlock'), onClick: () => saveBlob(rawText, 'data-block.txt', 'text/plain') }));
    return h('div', { class: 'dui-card' }, errorBox(info, actions, { lang }), pre);
  }

  // ---- drawing everything from the work's text ----
  function drawCards() {
    const work = ctx.work();
    if (!R.blocks.length) { cards.replaceChildren(h('p', { class: 'hint', id: 'dataNone', text: T(L(), 'r.noData') })); return; }
    cards.replaceChildren(...R.blocks.map((b) => (b.error ? damagedCard(b, work.slice(b.start, b.end)) : blockCard(b, { raw: work.slice(b.start, b.end) }))));
  }

  async function update() {
    const token = ++R.token;
    const work = ctx.work();
    let blocks;
    try { blocks = work ? await decodeAll(work) : []; } catch (e) {
      if (!(e instanceof TgdError)) throw e;
      blocks = [{ error: e, start: 0, end: Math.min(work.length, 4000) }];
    }
    if (token !== R.token) return;
    R.blocks = blocks;
    drawCards();
    // a sealed record that sits in the work's own text is offered in the form
    try {
      const found = work ? findSealedBlocks(work) : [];
      R.recordFromWork = found.length > 0;
      if (found.length) {
        if (!recBox.value.trim()) recBox.value = found[0];
        sealed.open = true;
      }
    } catch (e) { setOpenErr(e); paintOpenErr(false); sealed.open = true; }
    recHint.hidden = !R.recordFromWork;
    applyLang(root, L());
  }

  function setLang() {
    applyLang(root, L());
    drawCards();
    if (R.openErr) {
      // the message is rebuilt from its code, so it follows the language
      R.openErr = openError({ code: R.openArgs.code }, L(), { field: R.openArgs.field });
      paintOpenErr(false);
    }
    if (R.opened?.kind === 'tgd') opened.replaceChildren(blockCard(R.opened.block, { raw: `TGD1[${R.opened.text}]TGD1` }));
  }

  applyLang(root, L());
  return {
    update, setLang,
    /** Names of the data blocks of the work, for the Read view ('?' for a damaged one). */
    names: () => R.blocks.map((b) => (b.error ? '?' : b.name || '?')),
    /** The data blocks for the page's JSON: name, format, checksum and model (sealed data that was opened is not included). */
    json: () => R.blocks.map((b) => (b.error ? { error: b.error.code } : { name: b.name, format: b.format, sum: b.sum, model: b.model })),
  };
}

