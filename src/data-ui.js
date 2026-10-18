// DOM pieces shared by the generator's data panel (data-panel-ui.js) and the work page's data cards (data-reader-ui.js):
// a small element builder, the one error box, the sheet viewer (tabs and a real <table>), copy and download helpers, and
// the styles. Text from a file is untrusted: it only ever reaches the page as textContent, never as markup.
import { T, sheetPreview, columnTypes, count, intFmt, outline } from './data-panel.js';

/** Builds an element: h('button', { class: 'x', text: 'Hi', onclick: fn, disabled: true }, child, …). */
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}

/**
 * The one error box (docs/structured-data-ui.md section 3.1): red edge, an icon AND a bold title, the cause and what to do,
 * actions as buttons, the technical code last and small. It is announced (role="alert") and takes focus.
 * @param {{title:string, body:string, code?:string}} info  @param {Array<{label:string, onClick:Function, primary?:boolean}>} actions
 */
export function errorBox(info, actions = [], { lang = 'en', codeLabel } = {}) {
  const box = h('div', { class: 'dui-box dui-bad', role: 'alert', tabindex: '-1' },
    h('p', { class: 'dui-title' }, h('span', { 'aria-hidden': 'true', text: '✖ ' }), info.title),
    info.body ? h('p', { class: 'dui-body', text: info.body }) : null,
    actions.length ? h('div', { class: 'dui-actions' }, actions.map((a) => (a.node ? a.node : h('button', { type: 'button', class: a.primary ? 'primary' : '', text: a.label, onclick: a.onClick })))) : null,
    info.code ? h('p', { class: 'dui-code', text: codeLabel || T(lang, 'r.code', { code: info.code }) }) : null);
  return box;
}

/** A calm box for notes and warnings (not an error): level 'warn' (amber edge) or 'info'. */
export const noteBox = (text, level = 'info') => h('p', { class: `dui-box dui-${level}`, role: level === 'warn' ? 'note' : null },
  h('span', { 'aria-hidden': 'true', text: level === 'warn' ? '⚠ ' : 'ℹ ' }), text);

export function showError(slot, box, focus = true) {
  slot.replaceChildren(box);
  slot.hidden = false;
  if (focus) box.focus();
}
export function clearSlot(slot) { slot.replaceChildren(); slot.hidden = true; }

// ---- sheet viewer -------------------------------------------------------------------------------------------------
function tableOf(preview, sheet, lang) {
  const head = h('tr', {}, h('td', { class: 'dui-corner', 'aria-hidden': 'true' }), preview.columns.map((c) => h('th', { scope: 'col', text: c })));
  const body = preview.rows.map((r) => h('tr', {}, h('th', { scope: 'row', text: String(r.n) }),
    r.cells.map((c) => h('td', { class: `k-${c.kind}`, title: c.full.length > c.text.length ? c.full : null, text: c.text }))));
  const types = columnTypes(sheet);
  const typeRow = types.length ? h('tr', { class: 'dui-types' }, h('th', { scope: 'row', text: T(lang, 'r.types') }),
    preview.columns.map((_, i) => h('td', { text: types[i] ? types[i].main : '' }))) : null;
  return h('div', { class: 'dui-scroll', tabindex: '0', role: 'region', 'aria-label': T(lang, 'd.previewTitle') },
    h('table', { class: 'dui-table' }, h('thead', {}, head), h('tbody', {}, typeRow, body)));
}

/**
 * A viewer for a workbook model: sheet tabs, one real table with column letters, row numbers and a type row, and what was
 * left out. `expandable`: a button shows 200 more rows each time (the work page); otherwise a fixed preview (the generator).
 */
export function sheetViewer(model, summary, { lang, rows = 8, expandable = false, name }) {
  const root = h('div', { class: 'dui-sheets' });
  let at = 0, shown = rows;
  const draw = () => {
    root.replaceChildren();
    const sheets = model.sheets || [];
    if (sheets.length > 1) {
      root.append(h('div', { class: 'dui-tabs', role: 'group', 'aria-label': T(lang, 'd.sheets') }, sheets.map((s, i) => h('button', {
        type: 'button', 'aria-pressed': String(i === at), text: s.name + (s.state ? ` · ${T(lang, 'r.hidden')}` : ''),
        onclick: () => { at = i; shown = rows; draw(); root.querySelectorAll('.dui-tabs button')[i]?.focus(); },
      }))));
    }
    const sheet = sheets[at], info = summary.sheets[at];
    if (!sheet || !info) return;
    const p = sheetPreview(sheet, { maxRows: shown, noValue: T(lang, 'd.noValue') });
    root.append(h('p', { class: 'dui-sheetline', text: T(lang, 'd.sheetLine', {
      name: info.name, cols: count(lang, 'column', info.cols), rows: count(lang, 'row', info.rows), header: T(lang, info.header ? 'd.hasHeader' : 'd.noHeader') }) }));
    root.append(tableOf(p, sheet, lang));
    const extras = [];
    if (sheet.merges?.length) extras.push(T(lang, 'r.merged', { list: sheet.merges.slice(0, 12).join(', ') + (sheet.merges.length > 12 ? ' \u2026' : '') }));
    if (sheet.comments && Object.keys(sheet.comments).length) extras.push(T(lang, 'r.comments', { list: Object.keys(sheet.comments).slice(0, 12).join(', ') }));
    if (extras.length) root.append(h('p', { class: 'hint', text: extras.join(' \u00b7 ') }));
    const left = [];
    if (p.moreCols) left.push(T(lang, 'd.moreCols', { n: intFmt(p.moreCols, lang) }));
    if (p.moreRows) left.push(T(lang, 'd.more', { n: intFmt(p.moreRows, lang) }));
    if (left.length) root.append(h('p', { class: 'hint', text: left.join(' · ') }));
    if (expandable && p.moreRows) root.append(h('button', { type: 'button', text: T(lang, 'r.moreRows'), onclick: () => { shown += 200; draw(); } }));
  };
  draw();
  return root;
}

/** An indented outline (JSON, XML, Markdown, calendar, contacts) as a list. */
export function outlineView(model, lang) {
  const lines = outline(model, 200);
  return h('div', { class: 'dui-scroll', tabindex: '0', role: 'region', 'aria-label': T(lang, 'r.structure') },
    h('ul', { class: 'dui-outline' }, lines.map((l) => h('li', { style: `padding-left:${l.depth * 14}px`, text: l.text }))));
}

// ---- clipboard and files ------------------------------------------------------------------------------------------
/** Copies text; false if the browser refuses (the caller then selects the text for a manual copy). */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/** Saves bytes or text as a file through a blob URL (nothing leaves the page). */
export function saveBlob(data, name, mime = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// ---- styles (one place; the pages differ in their variable names, so each is mapped once) ------------------------------
const CSS = `
.dui,.dui-box{--d-fg:var(--fg,var(--ink,#15171c));--d-bg:var(--panel,var(--band,#fff));--d-soft:var(--soft,#f3f5f8);--d-line:var(--line,#d3d8e0);--d-muted:var(--muted,#596070);--d-accent:var(--accent,#b8145a);--d-ok:var(--ok,#1f7a4d);--d-warn:var(--warn,#a4570a)}
.dui{display:flex;flex-direction:column;gap:12px;min-width:0}
.dui [hidden]{display:none!important}
.dui-box{margin:0;padding:10px 12px;border-left:4px solid var(--d-line);background:var(--d-soft);border-radius:6px;color:var(--d-fg);font-size:14px;line-height:1.5;overflow-wrap:anywhere}
.dui-bad{border-left-color:var(--d-warn)}
.dui-warn{border-left-color:var(--d-warn)}
.dui-ok{border-left-color:var(--d-ok)}
.dui-title{margin:0 0 4px;font-weight:700;font-size:15px}
.dui-bad .dui-title{color:var(--d-warn)}
.dui-body{margin:0 0 6px}
.dui-actions{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 4px}
.dui-code{margin:6px 0 0;font:12px var(--f-mono,monospace);color:var(--d-muted)}
.dui-box:focus-visible{outline:2px solid var(--d-accent);outline-offset:2px}
.dui button,.dui label.btn{font:inherit;font-size:14px;font-weight:600;border-radius:6px;padding:7px 12px;cursor:pointer;border:1px solid var(--d-line);background:var(--d-soft);color:var(--d-fg);text-align:center}
.dui button:hover,.dui label.btn:hover{border-color:var(--d-muted)}
.dui button.primary{background:var(--d-accent);border-color:var(--d-accent);color:var(--accent-fg,var(--accent-ink,#fff))}
.dui button:disabled{opacity:.55;cursor:default}
.dui button:focus-visible,.dui select:focus-visible,.dui textarea:focus-visible,.dui input:focus-visible,.dui label.btn:focus-within{outline:2px solid var(--d-accent);outline-offset:2px}
.dui .sr{position:absolute;opacity:0;width:1px;height:1px;overflow:hidden}
.dui-h{margin:22px 0 10px;font-size:17px}
.dui-card{display:flex;flex-direction:column;gap:10px;border:1px solid var(--d-line);border-radius:10px;padding:14px 16px;background:var(--d-bg);min-width:0}
.dui details{background:var(--d-bg);border:1px solid var(--d-line);border-radius:10px;padding:10px 14px}
.dui details>summary{cursor:pointer;font-weight:600}
.dui .hint{font-size:13px;color:var(--d-muted);margin:0}
.dui .hint.good,.dui .good{color:var(--d-ok);font-weight:600}
.dui .hint.bad{color:var(--d-warn);font-weight:600}
@media (pointer:coarse),(max-width:900px){.dui button,.dui label.btn{min-height:44px}}
.dui select,.dui input[type=text],.dui textarea{font:inherit;font-size:14px;color:var(--d-fg);background:var(--d-soft);border:1px solid var(--d-line);border-radius:6px;padding:6px 8px;max-width:100%}
.dui textarea{font:12.5px/1.45 var(--f-mono,monospace)}
.dui-head{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;justify-content:space-between}
.dui-head b{overflow-wrap:anywhere}
.dui-scroll{overflow:auto;max-height:420px;border:1px solid var(--d-line);border-radius:6px;background:var(--d-bg)}
.dui-scroll:focus-visible{outline:2px solid var(--d-accent);outline-offset:2px}
.dui-table{border-collapse:collapse;font:12.5px/1.4 var(--f-mono,monospace);white-space:nowrap;width:max-content;min-width:100%}
.dui-table th,.dui-table td{border-bottom:1px solid var(--d-line);padding:4px 8px;text-align:left;vertical-align:top;max-width:28ch;overflow:hidden;text-overflow:ellipsis}
.dui-table thead th{position:sticky;top:0;background:var(--d-soft);color:var(--d-muted);font-weight:600}
.dui-table tbody th{background:var(--d-soft);color:var(--d-muted);font-weight:400;text-align:right}
.dui-table .k-number{text-align:right}
.dui-table .k-error{color:var(--d-warn);font-weight:700}
.dui-table .k-formula{font-style:italic}
.dui-table .k-date{color:var(--d-accent)}
.dui-types td{color:var(--d-muted);font-size:11.5px;text-transform:uppercase;letter-spacing:.04em}
.dui-tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px}
.dui-tabs button[aria-pressed="true"],.dui-tabs button[aria-selected="true"]{background:var(--d-accent);border-color:var(--d-accent);color:var(--accent-fg,var(--accent-ink,#fff))}
.dui-sheetline{margin:6px 0;font-size:13px;color:var(--d-muted)}
.dui-outline{list-style:none;margin:0;padding:8px 10px;font:12.5px/1.5 var(--f-mono,monospace)}
.dui-outline li{white-space:pre-wrap;overflow-wrap:anywhere}
.dui-pre{margin:0;max-height:300px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 var(--f-mono,monospace);background:var(--d-soft);border:1px solid var(--d-line);border-radius:6px;padding:10px}
.dui-meter{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center}
.dui-meter meter{flex:1 1 140px;min-width:120px;height:14px}
.dui-ok-line{color:var(--d-ok);font-weight:600}
.dui fieldset{border:1px solid var(--d-line);border-radius:8px;padding:10px 12px;margin:0;min-width:0}
.dui fieldset legend{padding:0 6px;font-size:13px;font-weight:700;color:var(--d-fg);text-transform:none;letter-spacing:0}
.dui .dui-opt{display:flex;gap:8px;align-items:flex-start;cursor:pointer;padding:4px 0}
.dui .dui-opt input{margin-top:4px;flex:none}
.dui .dui-opt small{display:block;color:var(--d-muted)}
.dui .dui-sub{margin:2px 0 6px 24px;display:flex;flex-direction:column;gap:6px}
.dui .dui-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.dui .dui-row>*{flex:0 1 auto}
.dui textarea{width:100%;min-height:0}
.dui-field-label{font-size:12.5px;font-weight:600;color:var(--d-muted)}
.dui input[type=text]{width:100%;font-size:14px;color:var(--d-fg);background:var(--d-soft);border:1px solid var(--d-line);border-radius:6px;padding:7px 9px}
@media (max-width:480px){.dui-table{font-size:12px}}
`;
export function injectStyles() {
  if (document.getElementById('dui-styles')) return;
  const s = document.createElement('style');
  s.id = 'dui-styles';
  s.textContent = CSS;
  document.head.append(s);
}
