// The page script of examples.html (a file, not an inline block, so the site's Content-Security-Policy needs no 'unsafe-inline' for scripts).
const T = {
  en: { law: 'Laws', declaration: 'Declarations', 'ai-instructions': 'AI instructions', 'agent-library': 'Agent library', pages: 'pages', words: 'words', chars: 'characters', type: 'type', pdf: 'Open PDF', original: 'Original', orig: 'original', motif: 'Motif', views: 'Three views', ok: '✓ text read back identical', okv: '✓ every visible character identical', bad: '✗ differs' },
  de: { law: 'Gesetze', declaration: 'Erklärungen', 'ai-instructions': 'KI-Anweisungen', 'agent-library': 'Agenten-Bibliothek', pages: 'Seiten', words: 'Wörter', chars: 'Zeichen', type: 'Schrift', pdf: 'PDF öffnen', original: 'Original', orig: 'Original', motif: 'Motiv', views: 'Drei Ansichten', ok: '✓ Text identisch zurückgelesen', okv: '✓ jedes sichtbare Zeichen identisch', bad: '✗ weicht ab',
    skip: 'Zum Inhalt springen', 'nav.make': 'Selbst gestalten', 'nav.gallery': 'Galerie', h1: 'Ganze Dokumente auf einer Seite',
    lead: 'Jeder One-Pager enthält den vollständigen Text eines Dokuments. Die Buchstaben sind winzig und bilden zusammen den Titel oder ein Bild darüber (die Originalbilder sind als „Motiv“ verlinkt). Jede Seite unten wurde mit MuPDF zurückgelesen und mit ihrer Quelle verglichen. Ein One-Pager ist grösser als seine Quelldatei; jede Karte nennt beide Grössen.',
    warn: 'Teile das PDF, nicht ein Bild davon: In dieser Grösse ist ein reines Bild für Texterkennung und Bildmodelle nur graue Textur. Der Text steckt in der Textebene des PDFs.', 'make.h': 'Selbst erstellen' },
};
const EN = new Map([...document.querySelectorAll('[data-i18n]')].map((el) => [el.dataset.i18n, el.textContent]));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
let lang = (navigator.language || '').toLowerCase().startsWith('de') ? 'de' : 'en', items = [];
try { lang = localStorage.getItem('tg-art.lang') || lang; } catch { /* default */ }
const t = (k) => T[lang][k] ?? T.en[k];
const fmt = (n) => n.toLocaleString(lang === 'de' ? 'de-CH' : 'en-US');
const size = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(2)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
function render() {
  let html = '';
  for (const cat of ['law', 'declaration', 'ai-instructions', 'agent-library']) {
    const list = items.filter((x) => x.category === cat);
    if (!list.length) continue;
    html += `<h2>${t(cat)}</h2><div class="grid">` + list.map((x) => `
      <article class="card">
        <a class="pic" href="work.html?example=${encodeURIComponent(x.id)}&back=examples"><img src="examples/${esc(x.id)}/thumb.jpg${x.rev ? `?v=${esc(x.rev)}` : ''}" alt="${esc(x.title)}" width="560" height="792" loading="lazy" decoding="async"></a>
        <div class="body">
          <h3><a class="title" href="work.html?example=${encodeURIComponent(x.id)}&back=examples">${esc(x.document)}</a></h3>
          <div class="facts">${x.sourcePages ? `<span>${x.sourcePages} ${t('pages')} → 1</span>` : ''}<span>${fmt(x.words)} ${t('words')}</span><span>${fmt(x.characters)} ${t('chars')}</span><span>${t('type')} ${x.fontSizeMm} mm</span></div>
          <div class="ok">${x.readBack && x.readBack.visibleIdentical ? (x.readBack.exact ? t('ok') : t('okv')) : t('bad')}</div>
          ${x.pdfBytes ? `<div class="facts"><span>PDF ${size(x.pdfBytes)}</span><span>${t('orig')} ${size(x.sourceBytes)}</span></div>` : ''}
          <div class="lic">${esc(x.licence)}${x.motifCredit ? ` · ${t('motif')}: ${esc(x.motifCredit)}` : ''}</div>
          <div class="links"><a href="work.html?example=${encodeURIComponent(x.id)}&back=examples">${t('views')}</a><a href="examples/${esc(x.id)}/onepage.pdf">${t('pdf')}</a>${x.url ? `<a href="${esc(x.url)}">${t('original')}</a>` : ''}${x.motifFile ? `<a href="examples/${esc(x.motifFile)}">${t('motif')}</a>` : ''}</div>
        </div>
      </article>`).join('') + '</div>';
  }
  document.getElementById('list').innerHTML = html;
}
function setLang(l) {
  lang = l; document.documentElement.lang = l;
  document.querySelectorAll('[data-i18n]').forEach((el) => { const v = l === 'de' ? T.de[el.dataset.i18n] : EN.get(el.dataset.i18n); if (v != null) el.textContent = v; });
  document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === l)));
  try { localStorage.setItem('tg-art.lang', l); } catch { /* not remembered */ }
  render();
}
document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
// Revalidate the catalogue (it is cached a day by `_headers`): a changed poster's new `rev` must be seen at once, not
// after the cache expires. The ETag makes this a cheap 304 when nothing changed.
items = await (await fetch('examples/index.json', { cache: 'no-cache' })).json();
setLang(lang);
