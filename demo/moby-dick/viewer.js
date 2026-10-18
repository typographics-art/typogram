// The page script of demo/moby-dick/index.html (a file, not an inline block, so the site's Content-Security-Policy needs no 'unsafe-inline' for scripts).
const T = {
  en: {},
  de: {
    h1: 'Moby-Dick, das ganze Buch, in einem Bild',
    intro: 'Alle 135 Kapitel als ein Poster von 2 × 3 m in drei Feldern. Zoome hinein, bis du jedes Wort lesen kannst, oder klicke irgendwo hin und sieh den Text an dieser Stelle.',
    'nav.make': 'Selbst gestalten', 'nav.gallery': 'Galerie', hint: 'Scrollen oder Ziehen zum Zoomen · Klick zeigt den Text',
    'here.h': 'Text an dieser Stelle', 'here.none': 'Klicke auf das Poster.',
    'here.p': 'Aus den Zeilenpositionen des Kunstwerks gelesen, nicht aus einer separaten Kopie: Was du siehst, steht genau dort.',
    'proof.h': 'Nachweis', 'proof.full': 'Vollständiger Bericht:', 'facts.h': 'Das Poster',
  },
};
const D = {
  en: { pass: (n, m) => `${n} of ${m} tests passed`, line: (l, c, p) => `Line ${l} · ${c} · ${p}`, size: 'Size', chars: 'Characters', lines: 'Lines', type: 'Type size', panels: 'Panels', hash: 'SHA-256', ocr: 'OCR on the image alone' },
  de: { pass: (n, m) => `${n} von ${m} Tests bestanden`, line: (l, c, p) => `Zeile ${l} · ${c} · ${p}`, size: 'Grösse', chars: 'Zeichen', lines: 'Zeilen', type: 'Schriftgrösse', panels: 'Felder', hash: 'SHA-256', ocr: 'Texterkennung nur aus dem Bild' },
};
const EN = new Map([...document.querySelectorAll('[data-i18n]')].map((el) => [el.dataset.i18n, el.textContent]));
let lang = (navigator.language || '').toLowerCase().startsWith('de') ? 'de' : 'en';
try { lang = localStorage.getItem('tg-art.lang') || JSON.parse(localStorage.getItem('tg-art.v1') || '{}').lang || lang; } catch { /* default */ }
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (n) => n.toLocaleString(lang === 'de' ? 'de-CH' : 'en-US');

const [proof, layout, sourceRaw] = await Promise.all([
  fetch('proof.json').then((r) => r.json()), fetch('lines.json').then((r) => r.json()), fetch('source.txt').then((r) => r.text()),
]);
const text = sourceRaw.replace(/\s+/g, ' ').trim();
const starts = [0];
for (const n of layout.lengths) starts.push(starts[starts.length - 1] + n);

let lastLine = null;
function renderAll() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { const v = lang === 'en' ? EN.get(el.dataset.i18n) : T.de[el.dataset.i18n]; if (v != null) el.textContent = v; });
  document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  const ok = proof.tests.filter((t) => t.pass).length;
  document.getElementById('verdict').textContent = D[lang].pass(ok, proof.tests.length);
  document.getElementById('tests').innerHTML = proof.tests.map((t) => `<li><span class="mark ${t.pass ? '' : 'fail'}">${t.pass ? '✓' : '!'}</span><span>${esc(t.name)}</span></li>`).join('');
  const p = proof.poster;
  const rows = [
    [D[lang].size, `${p.widthMm / 1000} × ${p.heightMm / 1000} m`],
    [D[lang].chars, fmt(p.characters)], [D[lang].lines, fmt(p.lines)], [D[lang].type, `${p.fontSizeMm.toFixed(1)} mm`],
    [D[lang].panels, p.sections.map((s) => esc(s.title)).join('<br>')],
    [D[lang].hash, `<code>${proof.source.sha256}</code>`],
  ];
  if (proof.ocr) rows.push([D[lang].ocr, `${(proof.ocr.accuracy * 100).toFixed(1)} %`]);
  document.getElementById('facts').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  if (lastLine !== null) show(lastLine);
}
function show(line) {
  lastLine = line;
  const a = Math.max(0, line - 1), b = Math.min(layout.lengths.length, line + 2);
  const before = text.slice(starts[a], starts[line]), mid = text.slice(starts[line], starts[line + 1]), after = text.slice(starts[line + 1], starts[b]);
  document.getElementById('here').innerHTML = `${esc(before)}<mark>${esc(mid)}</mark>${esc(after)}`;
  const heads = [...text.slice(0, starts[line + 1]).matchAll(/CHAPTER (\d+)\./g)];
  const chapter = heads.length > 135 ? `Chapter ${heads[heads.length - 1][1]}` : (lang === 'de' ? 'Titel und Etymologie' : 'Title and etymology');
  const panel = layout.sections.filter((s) => s.firstLine <= line).pop();
  document.getElementById('hereWhere').textContent = D[lang].line(fmt(line + 1), chapter, panel.title);
}
document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => { lang = b.dataset.lang; renderAll(); }));
renderAll();

const viewer = OpenSeadragon({
  id: 'viewer', tileSources: 'out/zoom/moby-dick.dzi', prefixUrl: '../../assets/vendor/openseadragon/images/',
  showNavigator: true, navigatorPosition: 'TOP_RIGHT', maxZoomPixelRatio: 3, visibilityRatio: 0.6, gestureSettingsMouse: { clickToZoom: false },
});
viewer.addHandler('canvas-click', (e) => {
  if (!e.quick) return;
  const img = viewer.viewport.viewportToImageCoordinates(viewer.viewport.pointFromPixel(e.position));
  const y = img.y / layout.zoomScale - layout.pad;
  const line = Math.floor(y / layout.lineHeight);
  if (line >= 0 && line < layout.lengths.length) show(line);
});
