// The page script of 404.html (a file, not an inline block, so the site's Content-Security-Policy needs no 'unsafe-inline' for scripts).
const DE = { msg: 'Diese Seite gibt es nicht. Jeder Buchstabe davon wäre trotzdem lesbar, wenn es sie gäbe.', skip: 'Zum Inhalt springen', home: 'Zur Startseite', make: 'Selbst gestalten', gallery: 'Galerie', examples: 'One-Pager', title: 'Seite nicht gefunden – Typographics Art' };
const EN = Object.fromEntries([...document.querySelectorAll('[data-i18n]')].map((el) => [el.dataset.i18n, el.textContent]));
function setLang(l, remember) {
  document.documentElement.lang = l;
  document.title = l === 'de' ? DE.title : 'Page not found – Typographics Art';
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = (l === 'de' ? DE : EN)[el.dataset.i18n]; });
  document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === l)));
  if (remember) { try { localStorage.setItem('tg-art.lang', l); } catch { /* not remembered */ } }
}
let lang = (navigator.language || '').toLowerCase().startsWith('de') ? 'de' : 'en';
try { lang = localStorage.getItem('tg-art.lang') || lang; } catch { /* default */ }
setLang(lang, false);
document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang, true)));
