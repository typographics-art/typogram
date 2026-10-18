// The page script of work.html (a file, not an inline block, so the site's Content-Security-Policy needs no 'unsafe-inline' for scripts).
import { canonicalText, markupText, pdfItemsText, structuredText, sha256Hex, findBlocks, stripBlocks, dataPanel } from '../../src/index.js';
import { mountDataReader } from '../../src/data-reader-ui.js';

const $ = (s) => document.querySelector(s);
const PDFJS = new URL('assets/vendor/pdfjs/', location.href).href; // pdf.js 4.4.168, Apache-2.0, hosted with the project

/* ---------- tiny i18n ---------- */
const DE = {
  'back': 'Zurück', 'tab.art': 'Kunst', 'tab.art.sub': 'erkennen', 'tab.read': 'Lesen', 'tab.read.sub': 'lesen & suchen',
  'tab.machine': 'Maschine', 'tab.machine.sub': 'strukturierter Text', 'art.zoom': 'Zoom',
  'm.copyText': 'Text kopieren', 'm.copyJson': 'JSON kopieren', 'm.dlJson': 'JSON laden', 'm.sectionsH': 'Abschnitte',
  'm.note': 'Die Prüfsumme ist ein SHA-256 über den kanonischen Text: Leerraum auf einzelne Leerzeichen reduziert, unsichtbare Formatzeichen entfernt, Unicode NFC. Derselbe Wert kommt aus HTML, SVG und PDF dieses Werks und aus dem Zurücklesen des Textes aus dem Bild — das bindet die drei Ansichten an eine Quelle.',
  'ft.home': 'Start', 'ft.gallery': 'Galerie', 'ft.examples': 'One-Pager', 'skip': 'Zum Inhalt springen',
};
const UI = {
  en: {
    searchPh: 'Search the text', loading: 'Loading …', badArt: 'The work could not be loaded.',
    failHelp: 'Open one of these instead:', failGallery: 'Gallery', failExamples: 'One-pagers', failApp: 'Make your own', openPdf: 'Open the PDF', noWork: 'No work was given. A link looks like work?example=<id>.',
    noStructure: 'This view shows the text read straight from the artwork. The picture keeps the text in reading order but with whitespace reduced to single spaces, so paragraph and heading breaks are not in it — they live in the source document.',
    fromSource: 'Read from the source document, with its sections and paragraphs. The artwork holds the same text, verified character for character.',
    matches: '{i} / {n}', noMatch: 'no match', typeToSearch: '',
    mChars: 'characters', mWords: 'words', mSections: 'sections', mParas: 'paragraphs',
    kSource: 'Source file', kText: 'Source text', kDoc: 'Document', kUrl: 'Original', kVersion: 'Version', kRetrieved: 'Retrieved',
    kLicence: 'Licence', kPages: 'Source pages', kChecksum: 'Checksum (canonical text)', kFormat: 'Artwork format',
    copied: 'Copied {n} characters.', copiedJson: 'Structured JSON copied.', downloaded: 'JSON downloaded.', copyFail: 'Could not copy — select and copy manually.',
    artZoomHint: 'Drag to pan. The full, searchable text is under “Read”; structured text with the checksum is under “Machine”.',
    artPdfHint: 'The picture is a PDF that carries every character as real text. Open “Read” to read and search it, “Machine” for the structured text and checksum.',
    artImgHint: 'The full text is under “Read” and “Machine”.',
  },
  de: {
    searchPh: 'Text durchsuchen', loading: 'Lädt …', badArt: 'Das Werk konnte nicht geladen werden.',
    failHelp: 'Stattdessen öffnen:', failGallery: 'Galerie', failExamples: 'One-Pager', failApp: 'Selbst gestalten', openPdf: 'PDF öffnen', noWork: 'Es wurde kein Werk angegeben. Ein Link sieht so aus: work?example=<id>.',
    noStructure: 'Diese Ansicht zeigt den Text direkt aus dem Kunstwerk. Das Bild behält den Text in Lesereihenfolge, aber mit Leerraum auf einzelne Leerzeichen reduziert, daher stecken Absatz- und Überschrift-Umbrüche nicht darin — sie liegen im Quelldokument.',
    fromSource: 'Aus dem Quelldokument gelesen, mit seinen Abschnitten und Absätzen. Das Kunstwerk trägt denselben Text, Zeichen für Zeichen geprüft.',
    matches: '{i} / {n}', noMatch: 'kein Treffer', typeToSearch: '',
    mChars: 'Zeichen', mWords: 'Wörter', mSections: 'Abschnitte', mParas: 'Absätze',
    kSource: 'Quelldatei', kText: 'Quelltext', kDoc: 'Dokument', kUrl: 'Original', kVersion: 'Version', kRetrieved: 'Abgerufen',
    kLicence: 'Lizenz', kPages: 'Quellseiten', kChecksum: 'Prüfsumme (kanonischer Text)', kFormat: 'Werkformat',
    copied: '{n} Zeichen kopiert.', copiedJson: 'Strukturiertes JSON kopiert.', downloaded: 'JSON geladen.', copyFail: 'Kopieren nicht möglich — bitte markieren und kopieren.',
    artZoomHint: 'Ziehen zum Verschieben. Der vollständige, durchsuchbare Text steht unter „Lesen“; strukturierter Text mit Prüfsumme unter „Maschine“.',
    artPdfHint: 'Das Bild ist ein PDF, das jedes Zeichen als echten Text trägt. „Lesen“ öffnet es zum Lesen und Suchen, „Maschine“ zeigt strukturierten Text und Prüfsumme.',
    artImgHint: 'Der vollständige Text steht unter „Lesen“ und „Maschine“.',
  },
};
let lang = 'en';
try { lang = localStorage.getItem('tg-art.lang') || ((navigator.language || '').toLowerCase().startsWith('de') ? 'de' : 'en'); } catch { /* default */ }
const EN = new Map([...document.querySelectorAll('[data-i18n]')].map((el) => [el.dataset.i18n, el.textContent]));
const u = (k, v = {}) => (UI[lang][k] || k).replace(/\{(\w+)\}/g, (_, n) => v[n]);
function setLang(l) {
  lang = l; document.documentElement.lang = l;
  document.querySelectorAll('[data-i18n]').forEach((el) => { const v = l === 'de' ? DE[el.dataset.i18n] : EN.get(el.dataset.i18n); if (v != null) el.textContent = v; });
  document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === l)));
  $('#q').placeholder = u('searchPh');
  try { localStorage.setItem('tg-art.lang', l); } catch { /* not remembered */ }
  if (state.ready) {
    if (state.empty) paintEmpty();
    renderReadNote(); renderMachine(); if (state.structured) buildOutline();
    if (reader.names().length) renderRead(); // the "Data: … open in Machine" lines follow the language
    reader.setLang();
  }
}
document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));

/* ---------- parameters ---------- */
const P = new URLSearchParams(location.search);
const state = { ready: false, canonical: '', structured: null, meta: {}, artKind: '', svg: null };
window.__tg = state; // for the headless test harness

async function fetchText(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.text();
}
const fmt = (n) => n.toLocaleString(lang === 'de' ? 'de-CH' : 'en-US');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// All parameters come from the URL, so a crafted link must not become script. Work files must be
// same-origin relative paths (no scheme, no //), the external source link must be http(s), and the
// artwork SVG is sanitised before it touches the DOM.
function sameOrigin(p) {
  if (!p || typeof p !== 'string' || /^[a-z][a-z0-9+.-]*:/i.test(p) || p.startsWith('//')) return null;
  try { const url = new URL(p, location.href); return url.origin === location.origin ? url.href : null; } catch { return null; }
}
function httpUrl(p) {
  try { const url = new URL(p, location.href); return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null; } catch { return null; }
}
function sanitizeSvg(raw) {
  const doc = new DOMParser().parseFromString(raw, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) return null;
  // Elements that run code, load documents or can set an attribute (animate/set can turn an href into javascript:).
  svg.querySelectorAll('script,foreignObject,iframe,object,embed,animate,set,animateMotion,handler,listener').forEach((n) => n.remove());
  svg.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase();
      if (n.startsWith('on')) { el.removeAttribute(a.name); continue; }
      if (n === 'href' || n === 'xlink:href' || n === 'src' || n === 'data' || n === 'action' || n === 'formaction') {
        // Browsers ignore tabs, newlines and other control characters inside a scheme ("java&#9;script:"): test without them.
        const v = a.value.replace(/[\u0000-\u0020\u007f-\u009f]+/g, '');
        if (!(v.startsWith('#') || /^https?:/i.test(v) || /^data:image\/(png|jpe?g|gif|webp);/i.test(v))) el.removeAttribute(a.name);
      }
    }
    // The page already has the fonts; an @import in the artwork's own style would fetch them again (and a content security policy would refuse it).
    if (el.localName === 'style') el.textContent = el.textContent.replace(/@import[^;]*;?/gi, '').replace(/expression\s*\(|javascript:/gi, '');
  });
  return document.importNode(svg, true);
}

async function pdfToText(path) {
  const pdfjs = await import(PDFJS + 'pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs';
  const doc = await pdfjs.getDocument({ url: path, disableFontFace: true }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) pages.push((await (await doc.getPage(p)).getTextContent()).items);
  return { text: pdfItemsText(pages), pages: doc.numPages };
}

/* ---------- load ---------- */
async function load() {
  // Metadata: either from examples/index.json by ?example=<id>, or from explicit params.
  let art = P.get('art'), textPath = P.get('text'), title = P.get('title');
  const meta = {};
  const example = P.get('example');
  if (example) {
    const list = await fetchText('examples/index.json').then(JSON.parse).catch(() => []);
    const e = list.find((x) => x.id === example);
    if (e) {
      art = art || `examples/${e.id}/onepage.pdf`;
      if (e.text) textPath = textPath || `examples/${e.id}/${e.text}`;
      title = title || e.document || e.title;
      Object.assign(meta, { document: e.document, url: e.url, licence: e.licence, pages: e.sourcePages, version: e.version, label: e.title });
    }
  }
  for (const k of ['document', 'version', 'retrieved', 'licence']) if (P.get(k)) meta[k] = P.get(k);
  if (P.get('url')) meta.url = httpUrl(P.get('url'));
  state.meta = meta;
  const artUrl = sameOrigin(art);
  const textUrl = sameOrigin(textPath);
  if (!P.get('art') && !example) { await openEmpty(); return; }
  if (!artUrl) { fail(u('badArt')); return; }
  meta.artFile = art; meta.textFile = textPath && textUrl ? textPath : null;

  document.title = (title || 'work') + ' — Typographics Art';
  $('#title').textContent = title || art.split('/').pop();
  $('#subtitle').textContent = meta.document && meta.document !== title ? meta.document : '';
  const back = sameOrigin(P.get('back')); if (back) $('#back').href = back;

  const ext = art.toLowerCase().split('.').pop();
  state.artKind = ext === 'svg' ? 'svg' : ext === 'pdf' ? 'pdf' : 'img';

  // Art view + the text behind it. The artwork path is same-origin (validated above).
  try {
    if (state.artKind === 'svg') {
      const raw = await fetchText(artUrl);
      renderSvg(raw);
      if (!textUrl) state.canonical = canonicalText(markupText(raw, 'svg'));
      $('#arthint').textContent = u('artZoomHint');
    } else if (state.artKind === 'pdf') {
      const showFrame = () => { const fr = document.createElement('iframe'); fr.src = artUrl + '#view=FitH&navpanes=0'; fr.title = title || 'PDF'; $('#artbox').replaceChildren(fr); };
      // Phones do not show embedded PDFs well: use the preview image next to the PDF when there is one, plus a button.
      if (matchMedia('(pointer: coarse), (max-width: 820px)').matches) {
        const im = new Image(); im.className = 'preview'; im.alt = title || '';
        im.onload = () => {
          const a = document.createElement('a'); a.className = 'pdfopen'; a.href = artUrl; a.textContent = u('openPdf');
          $('#artbox').replaceChildren(im, a);
        };
        im.onerror = showFrame;
        im.src = artUrl.replace(/[^/?#]+\.pdf(?=[?#]|$)/i, 'preview.jpg');
      } else showFrame();
      $('#arthint').textContent = u('artPdfHint');
      if (!textUrl) { const r = await pdfToText(artUrl); state.canonical = canonicalText(r.text); if (!meta.pages) meta.pages = r.pages; }
    } else {
      const im = document.createElement('img');
      im.src = artUrl; im.alt = title || '';
      $('#artbox').replaceChildren(im);
      $('#arthint').textContent = u('artImgHint');
    }
  } catch (e) { $('#artbox').replaceChildren(Object.assign(document.createElement('p'), { className: 'err', style: 'padding:16px', textContent: `${u('badArt')} (${e.message})` })); }

  // Structured source overrides the artwork text where available.
  if (textUrl) {
    const raw = await fetchText(textUrl);
    const sext = textPath.toLowerCase().split('.').pop();
    const src = sext === 'svg' || sext === 'html' || sext === 'htm' ? markupText(raw, sext === 'svg' ? 'svg' : 'html') : raw;
    state.structured = structuredText(withoutBlocks(src));
    state.canonical = canonicalText(src);
  } else if (state.artKind !== 'img' && state.canonical) {
    state.structured = null; // artwork text has no paragraph structure
  }

  state.checksum = state.canonical ? await sha256Hex(state.canonical) : '';
  state.ready = true;
  await reader.update();
  renderRead(); renderMachine();
}

// A work that carries data: the blocks are cut out of the prose (they have their own cards in Machine).
function withoutBlocks(text) { try { return findBlocks(text).length ? stripBlocks(text, ' ') : text; } catch { return text; } }

// No work in the address: the page still reads data out of a work file the person chooses (nothing is uploaded).
function paintEmpty() {
  $('#title').textContent = dataPanel.T(lang, 'r.noWorkTitle');
  const p = document.createElement('p'); p.className = 'note'; p.textContent = dataPanel.T(lang, 'r.noWorkBody');
  $('#artbox').replaceChildren(p);
}
async function openEmpty() {
  state.empty = true; paintEmpty();
  state.ready = true; state.canonical = ''; state.checksum = '';
  await reader.update();
  renderRead(); renderMachine();
  if (!hadView) show('machine');
}
async function onLocalWork({ name, canonical }) {
  state.canonical = canonical; state.checksum = await sha256Hex(canonical); state.structured = null;
  state.meta = { ...state.meta, artFile: name, textFile: null };
  if (state.empty) { state.artKind = /\.pdf$/i.test(name) ? 'pdf' : /\.svg$/i.test(name) ? 'svg' : 'html'; $('#title').textContent = name; }
  await reader.update();
  renderRead(); renderMachine();
}

function fail(msg) {
  $('#title').textContent = 'Typographics Art';
  const box = document.createElement('div'); box.className = 'failbox';
  const p = document.createElement('p'); p.className = 'err'; p.textContent = msg; box.append(p);
  const h = document.createElement('p'); h.textContent = u('failHelp'); h.style.marginTop = '12px'; box.append(h);
  const ul = document.createElement('ul');
  for (const [href, key] of [['gallery', 'failGallery'], ['examples', 'failExamples'], ['app', 'failApp']]) {
    const li = document.createElement('li'), a = document.createElement('a'); a.href = href; a.textContent = u(key); li.append(a); ul.append(li);
  }
  box.append(ul); $('#artbox').replaceChildren(box);
}

/* ---------- Art: svg zoom/pan + line marking ---------- */
function renderSvg(raw) {
  const box = $('#artbox');
  const svg = sanitizeSvg(raw);
  if (!svg) { box.replaceChildren(Object.assign(document.createElement('p'), { className: 'err', style: 'padding:16px', textContent: u('badArt') })); return; }
  box.replaceChildren(svg);
  state.svg = svg;
  const vb = (svg.getAttribute('viewBox') || '').split(/[ ,]+/).map(Number);
  const w = vb[2] || +svg.getAttribute('width') || 1000;
  svg.removeAttribute('width'); svg.removeAttribute('height');
  svg.style.width = '100%';
  $('#artbar').hidden = false;
  const applyZoom = () => { const z = +$('#zoom').value; svg.style.width = z + '%'; $('#zoomV').textContent = z + '%'; };
  $('#zoom').addEventListener('input', applyZoom);
  // Drag to pan when zoomed in.
  let down = null;
  box.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, l: box.scrollLeft, t: box.scrollTop }; });
  box.addEventListener('pointermove', (e) => { if (!down) return; box.scrollLeft = down.l - (e.clientX - down.x); box.scrollTop = down.t - (e.clientY - down.y); });
  addEventListener('pointerup', () => { down = null; });
  buildSvgLines(svg, w);
}

// Group the artwork's tspans into lines by their y, so a search can mark the whole line that holds a hit
// and a click on it can open the same text under Read.
function buildSvgLines(svg, width) {
  try {
    const tspans = [...svg.querySelectorAll('text tspan')];
    const byY = new Map();
    for (const ts of tspans) {
      const y = ts.getAttribute('y'); if (y == null) continue;
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y).push(ts);
    }
    state.lines = [];
    for (const [y, group] of byY) {
      const text = group.map((g) => g.textContent).join('');
      state.lines.push({ y: +y, text, canon: canonicalText(text), group });
    }
    state.lines.sort((a, b) => a.y - b.y);
  } catch { state.lines = null; }
}

function markSvgLines(query) {
  if (!state.svg || !state.lines) return;
  const ns = 'http://www.w3.org/2000/svg';
  state.svg.querySelectorAll('.tgmark').forEach((n) => n.remove());
  state.svg.querySelectorAll('.tghit').forEach((n) => n.classList.remove('tghit'));
  if (!query) return;
  const q = canonicalText(query).toLowerCase();
  if (!q) return;
  let first = null;
  for (const ln of state.lines) {
    if (!ln.canon.toLowerCase().includes(q)) continue;
    const g = ln.group[0]; if (!g) continue;
    try {
      const bb = ln.group.reduce((acc, t) => { const b = t.getBBox(); return acc ? { x: Math.min(acc.x, b.x), y: Math.min(acc.y, b.y), r: Math.max(acc.r, b.x + b.width), bt: Math.max(acc.bt, b.y + b.height) } : { x: b.x, y: b.y, r: b.x + b.width, bt: b.y + b.height }; }, null);
      if (!bb) continue;
      const rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('class', 'tgmark'); rect.setAttribute('x', bb.x - 1); rect.setAttribute('y', bb.y - 1);
      rect.setAttribute('width', bb.r - bb.x + 2); rect.setAttribute('height', bb.bt - bb.y + 2); rect.setAttribute('fill', '#ffd54a'); rect.setAttribute('opacity', '.35');
      state.svg.querySelector('text').before(rect);
      if (!first) first = rect;
    } catch { /* getBBox needs layout; ignore if unavailable */ }
  }
  if (first) first.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

/* ---------- Read ---------- */
function renderReadNote() {
  const n = $('#readnote');
  if (state.structured) { n.hidden = false; n.textContent = u('fromSource'); }
  else if (state.canonical) { n.hidden = false; n.textContent = u('noStructure'); }
  else n.hidden = true;
}
function dataNotes() {
  return reader.names().map((n) => `<p class="note"><a href="#machine" data-goto="machine">${esc(dataPanel.T(lang, 'r.inRead', { name: n }))}</a></p>`).join('');
}
function renderRead() {
  renderReadNote();
  const art = $('#reading');
  if (state.structured) {
    art.innerHTML = dataNotes() + state.structured.sections.map((s) => {
      const h = s.title ? `<h${s.level === 1 ? 2 : 3} id="s-${esc(s.id)}">${esc(s.title)}</h${s.level === 1 ? 2 : 3}>` : '';
      const body = s.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('');
      return h + body;
    }).join('');
    buildOutline();
    $('#readcols').classList.toggle('has-nav', state.structured.headings > 1);
  } else {
    art.innerHTML = `${dataNotes()}<div class="flow">${esc(withoutBlocks(state.canonical || '').replace(/\s+/g, ' ').trim())}</div>`;
    $('#readcols').classList.remove('has-nav');
    $('#outline').innerHTML = '';
  }
}
function buildOutline() {
  if (!state.structured) return;
  $('#outline').innerHTML = state.structured.sections.filter((s) => s.title).map((s) =>
    `<a href="#s-${esc(s.id)}" class="${s.level >= 3 ? 'lvl3' : ''}" data-id="${esc(s.id)}">${esc(s.title)}</a>`).join('');
  $('#outline').querySelectorAll('a').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault(); const el = document.getElementById('s-' + a.dataset.id);
    if (el) { el.scrollIntoView({ block: 'start' }); history.replaceState(null, '', '#read'); }
  }));
}

/* search in Read: highlight, count, next/prev */
let hits = [], hitAt = -1;
function clearHighlights(root) {
  root.querySelectorAll('mark.h').forEach((m) => { const t = document.createTextNode(m.textContent); m.replaceWith(t); });
  root.normalize();
}
function runSearch() {
  const root = $('#reading');
  clearHighlights(root);
  hits = []; hitAt = -1;
  const q = $('#q').value.trim();
  markSvgLines(q);
  if (!q) { $('#qcount').textContent = ''; return; }
  const needle = q.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts = []; let node;
  while ((node = walker.nextNode())) if (node.nodeValue.trim()) texts.push(node);
  for (const tn of texts) {
    const low = tn.nodeValue.toLowerCase();
    let idx = low.indexOf(needle);
    if (idx < 0) continue;
    const frag = document.createDocumentFragment(); let last = 0; const s = tn.nodeValue;
    while (idx >= 0) {
      if (idx > last) frag.appendChild(document.createTextNode(s.slice(last, idx)));
      const m = document.createElement('mark'); m.className = 'h'; m.textContent = s.slice(idx, idx + q.length);
      frag.appendChild(m); hits.push(m); last = idx + q.length;
      idx = low.indexOf(needle, last);
    }
    if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
    tn.replaceWith(frag);
  }
  if (hits.length) { hitAt = 0; focusHit(); } else $('#qcount').textContent = u('noMatch');
}
function focusHit() {
  hits.forEach((m, i) => { m.style.background = i === hitAt ? 'var(--accent)' : ''; m.style.color = i === hitAt ? 'var(--accent-ink)' : ''; });
  const m = hits[hitAt];
  if (m) { m.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); $('#qcount').textContent = u('matches', { i: hitAt + 1, n: hits.length }); }
}
const step = (d) => { if (!hits.length) return; hitAt = (hitAt + d + hits.length) % hits.length; focusHit(); };
let st; $('#q').addEventListener('input', () => { clearTimeout(st); st = setTimeout(runSearch, 160); });
$('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (hits.length) step(e.shiftKey ? -1 : 1); else runSearch(); } });
$('#qnext').addEventListener('click', () => step(1));
$('#qprev').addEventListener('click', () => step(-1));

/* ---------- Machine ---------- */
function renderMachine() {
  if (!state.ready) return;
  const m = state.meta, c = state.canonical;
  const words = c ? c.split(' ').filter(Boolean).length : 0;
  const nSec = state.structured ? state.structured.sections.filter((s) => s.title).length : 0;
  const nPar = state.structured ? state.structured.paragraphs : 0;
  $('#mgrid').innerHTML = [
    [fmt(c.length), u('mChars')], [fmt(words), u('mWords')],
    ...(state.structured ? [[fmt(nSec), u('mSections')], [fmt(nPar), u('mParas')]] : []),
  ].map(([b, s]) => `<div class="mcell"><b>${b}</b><span>${esc(s)}</span></div>`).join('');

  const rows = [];
  const add = (k, v, code) => { if (v != null && v !== '') rows.push(`<tr><th>${esc(u(k))}</th><td>${code ? `<code>${esc(String(v))}</code>` : esc(String(v))}</td></tr>`); };
  add('kFormat', state.artKind === 'svg' ? 'SVG' : state.artKind === 'pdf' ? 'PDF' : state.artKind === 'html' ? 'HTML' : 'image');
  add('kSource', m.artFile, true);
  add('kText', m.textFile, true);
  add('kDoc', m.document);
  if (m.url) rows.push(`<tr><th>${esc(u('kUrl'))}</th><td><a href="${esc(m.url)}" rel="nofollow noopener">${esc(m.url)}</a></td></tr>`);
  add('kVersion', m.version);
  add('kRetrieved', m.retrieved);
  add('kPages', m.pages != null ? fmt(m.pages) : null);
  add('kLicence', m.licence);
  add('kChecksum', state.checksum ? 'sha256:' + state.checksum : null, true);
  $('#kv').innerHTML = rows.join('');

  $('#sections').innerHTML = state.structured
    ? state.structured.sections.filter((s) => s.title).map((s) => `<div><span>${esc(s.title)}</span><code>#${esc(s.id)}</code></div>`).join('')
    : `<div style="color:var(--muted)"><span>${esc(u('noStructure'))}</span></div>`;
}
function machineJson() {
  const m = state.meta;
  return {
    title: $('#title').textContent,
    document: m.document || null, source: m.url || null, version: m.version || null, retrieved: m.retrieved || null,
    licence: m.licence || null, artwork: m.artFile, sourceText: m.textFile || null,
    characters: state.canonical.length, words: state.canonical.split(' ').filter(Boolean).length,
    checksum: state.checksum ? 'sha256:' + state.checksum : null,
    canonicalText: state.canonical,
    data: reader.json(),
    sections: state.structured ? state.structured.sections.filter((s) => s.title).map((s) => ({ id: s.id, title: s.title, level: s.level, text: s.text })) : null,
  };
}
async function clip(text, okKey, okVars) {
  try { await navigator.clipboard.writeText(text); $('#mmsg').textContent = u(okKey, okVars); $('#mmsg').className = 'msg'; }
  catch { $('#mmsg').textContent = u('copyFail'); $('#mmsg').className = 'msg err'; }
}
$('#copyText').addEventListener('click', () => clip(state.canonical, 'copied', { n: fmt(state.canonical.length) }));
$('#copyJson').addEventListener('click', () => clip(JSON.stringify(machineJson(), null, 2), 'copiedJson'));
$('#dlJson').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(machineJson(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = (($('#title').textContent || 'work').replace(/[^\w.-]+/g, '-')) + '.json';
  a.click(); URL.revokeObjectURL(a.href); $('#mmsg').textContent = u('downloaded'); $('#mmsg').className = 'msg';
});

/* ---------- tabs ---------- */
const VIEWS = ['art', 'read', 'machine'];
// `byKeys`: moving between tabs with the arrow keys keeps the focus on the tabs (it must not jump into the search box).
function show(view, byKeys = false) {
  for (const v of VIEWS) {
    $('#tab-' + v).setAttribute('aria-selected', String(v === view));
    $('#tab-' + v).tabIndex = v === view ? 0 : -1; // roving tabindex: one tab stop, arrows move inside the list
    $('#view-' + v).hidden = v !== view;
  }
  if (location.hash.slice(1) !== view) history.replaceState(null, '', '#' + view);
  if (byKeys) $('#tab-' + view).focus();
  else if (view === 'read') $('#q').focus({ preventScroll: true });
}
document.querySelectorAll('[role=tab]').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));
$('.tabs').addEventListener('keydown', (e) => {
  const i = VIEWS.indexOf(document.activeElement?.dataset?.view);
  if (i < 0) return;
  const next = { ArrowRight: (i + 1) % 3, ArrowLeft: (i + 2) % 3, Home: 0, End: 2 }[e.key];
  if (next === undefined) return;
  e.preventDefault(); show(VIEWS[next], true);
});
addEventListener('hashchange', () => { const v = location.hash.slice(1); if (['art', 'read', 'machine'].includes(v)) show(v); });

$('#reading').addEventListener('click', (e) => { const a = e.target.closest('a[data-goto]'); if (a) { e.preventDefault(); show(a.dataset.goto); } });
const reader = mountDataReader({ root: $('#dataSection'), lang: () => lang, work: () => state.canonical, onLocalWork });

/* ---------- go ---------- */
setLang(lang);
const hadView = ['art', 'read', 'machine'].includes(location.hash.slice(1));
const initial = hadView ? location.hash.slice(1) : 'art';
show(initial);
load().catch((e) => fail(u('badArt') + ' ' + e.message));
