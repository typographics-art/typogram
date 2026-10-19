// The page script of gallery.html (a file, not an inline block, so the site's Content-Security-Policy needs no 'unsafe-inline' for scripts).
const T = {
  en: { characters: 'characters', filler: 'filler', fidelity: 'tone fidelity', svg: 'Open SVG (text)', preview: 'Preview', original: 'Original', image: 'Image', views: 'Three views', signedBy: 'Signed by typographics-art.org — verify at /v' },
  de: {
    intro: 'Jedes Werk ist echter Text: Öffne das SVG und markiere, kopiere oder durchsuche ihn. Das Bild entsteht nur aus Grösse, Stärke und Farbe der Buchstaben.',
    skip: 'Zum Inhalt springen', 'footer.licence': 'MIT-Lizenz', 'nav.make': 'Selbst gestalten', 'submit.h': 'Zeig dein Werk', 'submit.p': 'Etwas mit Typographics Art gemacht? Reiche das SVG über ein', 'submit.link': 'Werk-Issue ein',
    characters: 'Zeichen', filler: 'Fülltext', fidelity: 'Tontreue', svg: 'SVG öffnen (Text)', preview: 'Vorschau', original: 'Original', image: 'Bild', views: 'Drei Ansichten', signedBy: 'Signiert von typographics-art.org — prüfbar unter /v',
    'view.tg': 'Typographics', 'view.orig': 'Originale', 'view.hint': 'oder ein einzelnes Werk mit dem Knopf auf seinem Bild umschalten',
  },
};
const EN = new Map([...document.querySelectorAll('[data-i18n]')].map((el) => [el.dataset.i18n, el.textContent]));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
let lang = 'en', works = [], allOriginal = false;
const flipped = new Set(); // works shown the other way than the toolbar says
const orig = (w) => allOriginal !== flipped.has(w.id);
const t = (k) => T[lang][k] ?? T.en[k];
const fmt = (n) => n.toLocaleString(lang === 'de' ? 'de-CH' : 'en-US');

function render() {
  document.getElementById('grid').innerHTML = works.map((w) => `
    <article class="card">
      <div class="pic">
        <a class="preview${w.signed && !orig(w) ? ' signed' : ''}"${w.signed && !orig(w) ? ` title="${t('signedBy')}"` : ''} href="${orig(w) ? esc(w.original) : `work.html?art=${encodeURIComponent(w.svg)}&title=${encodeURIComponent(w.title)}&back=gallery`}"><img src="gallery/thumbs/${esc(w.id)}${orig(w) ? '-original' : ''}.jpg${!orig(w) && w.rev ? `?v=${esc(w.rev)}` : ''}" decoding="async" alt="${esc(orig(w) ? t('original') : t('preview'))}: ${esc(w.title)}" loading="lazy">${w.signed && !orig(w) ? `<span class="sr">${t('signedBy')}</span>` : ''}</a>
        <button type="button" class="flip" data-id="${esc(w.id)}" aria-pressed="${orig(w)}">${orig(w) ? 'Typographics' : t('original')}</button>
      </div>
      <div class="body">
        <h2><a class="title" href="work.html?art=${encodeURIComponent(w.svg)}&title=${encodeURIComponent(w.title)}&back=gallery">${esc(w.title)}</a></h2>
        <p class="src">${esc(w.source)}</p>
        ${w.photoCredit ? `<p class="credit">${t('image')}: ${esc(w.photoCredit)}</p>` : ''}
        <div class="facts">
          <span>${fmt(w.meta.characters)} ${t('characters')}</span>
          ${w.meta.filler ? `<span>${fmt(w.meta.filler)} ${t('filler')}</span>` : ''}
          <span>${t('fidelity')} ${w.meta.toneFidelity.toFixed(2)}</span>
        </div>
        <div class="links"><a href="work.html?art=${encodeURIComponent(w.svg)}&title=${encodeURIComponent(w.title)}&back=gallery">${t('views')}</a><a href="${esc(w.svg)}">${t('svg')}</a><a href="${esc(w.original)}">${t('original')}</a></div>
      </div>
    </article>`).join('');
}
function setLang(l) {
  lang = l;
  document.documentElement.lang = l;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const v = l === 'en' ? EN.get(el.dataset.i18n) : T.de[el.dataset.i18n];
    if (v != null) el.textContent = v;
  });
  document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === l)));
  try { localStorage.setItem('tg-art.lang', l); } catch { /* not remembered */ }
  render();
}
document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
document.getElementById('grid').addEventListener('click', (e) => {
  const b = e.target.closest('.flip');
  if (!b) return;
  flipped.has(b.dataset.id) ? flipped.delete(b.dataset.id) : flipped.add(b.dataset.id);
  render();
});
for (const [id, value] of [['show-tg', false], ['show-orig', true]]) {
  document.getElementById(id).addEventListener('click', () => {
    allOriginal = value; flipped.clear();
    document.getElementById('show-tg').setAttribute('aria-pressed', String(!value));
    document.getElementById('show-orig').setAttribute('aria-pressed', String(value));
    render();
  });
}
let initial = (navigator.language || '').toLowerCase().startsWith('de') ? 'de' : 'en';
try { initial = localStorage.getItem('tg-art.lang') || JSON.parse(localStorage.getItem('tg-art.v1') || '{}').lang || initial; } catch { /* default */ }
works = await (await fetch('gallery/works.json')).json();
setLang(initial);
