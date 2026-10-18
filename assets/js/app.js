// The page script of app.html (a file, not an inline block, so the site's Content-Security-Policy needs no 'unsafe-inline' for scripts).
import { lorem, normalizeText, toHtml, toStandaloneHtml, toSvg, pdfStats, estimatePdfBytes, REF_SIZE, hideSecret, revealSecret, escapeXml, canonicalText, sha256Hex, meanLuminance, paperFor, buildJsonld } from '../../src/index.js';
import { typeset, toPng } from '../../src/browser.js';
import { mountDataPanel } from '../../src/data-panel-ui.js';
import { saveBlob } from '../../src/data-ui.js';

const $ = (s) => document.querySelector(s);

/* ---------- Language ---------- */
const I18N = {
  en: {},
  de: {
    'tagline': 'Briefpapier für das KI-Zeitalter. Dein Text wird zu einem Bild, das ein Mensch auf einen Blick erkennt und eine Maschine genau so liest, wie es dasteht.',
    'mode.simple': 'Einfach', 'mode.adv': 'Erweitert',
    'legend.presets': 'Stil', 'preset.ai': 'Hohe Lesbarkeit', 'preset.ai.sub': 'ganze Wörter, hell', 'preset.portrait': 'Porträt', 'preset.portrait.sub': 'fein, 4:5', 'preset.poster': 'Plakat', 'preset.poster.sub': 'dunkel, kräftig',
    'legend.text': 'Text', 'label.text': 'Dein Text', 'btn.loadText': 'Textdatei laden (.txt, .md)', 'label.sample': 'Beispieltext', 'sample.choose': 'Beispieltext wählen …', 'label.fill': 'Mit Lorem ipsum auffüllen auf', 'btn.fill': 'Auffüllen', 'btn.unfill': 'Füllung entfernen',
    'hint.fill': 'Mehr Zeichen ergeben ein feineres Bild. Dein Text steht vorne; Zeilenumbrüche und Leerzeichenfolgen werden zu einem Leerzeichen, sonst ändert sich nichts.',
    'legend.photo': 'Foto', 'drop.sample': 'Beispielbild: Frederick Douglass', 'label.describe': 'Was das Bild zeigt', 'label.describe.sub': '(für Screenreader; kommt als Titel in SVG und HTML)', 'drop.hint': 'Bild wählen oder hierher ziehen', 'label.format': 'Format',
    'fmt.photo': 'Wie das Foto', 'fmt.square': 'Quadrat 1:1', 'fmt.portrait': 'Hochformat 4:5', 'fmt.a': 'A-Format hoch', 'fmt.landscape': 'Querformat 16:9',
    'label.contrast': 'Kontrast', 'label.brightness': 'Helligkeit', 'label.edges': 'Kanten betonen', 'label.invert': 'Helligkeit umkehren',
    'legend.type': 'Schrift und Satz', 'label.font': 'Schriftart', 'label.legibility': 'Lesbarkeit',
    'leg.high': 'Hoch: kleine Spannweite, sicher lesbar', 'leg.medium': 'Mittel: ausgewogen', 'leg.free': 'Frei: maximaler Bildkontrast',
    'label.unit': 'Einheit', 'unit.char': 'Je Buchstabe', 'unit.word': 'Je Wort', 'hint.unit': '„Je Wort“ setzt jedes Wort in einem Stil. Das liest sich ruhiger, das Bild wird gröber.',
    'label.spacing': 'Zeilenabstand', 'legend.color': 'Farbe und Papier', 'label.color': 'Farbe', 'color.photo': 'Farben aus dem Foto', 'color.gray': 'Graustufen', 'color.mono': 'Einfarbig',
    'label.paper': 'Papier', 'paper.auto': 'Automatisch', 'paper.light': 'Hell', 'paper.dark': 'Dunkel', 'legend.output': 'Ausgabe', 'label.width': 'Breite', 'width.auto': 'An das Fenster anpassen', 'btn.set': 'Neu setzen',
    'chip.loading': 'Schrift wird geladen …', 'overlay': 'Foto einblenden', 'export.summary': 'Kopieren & speichern', 'skip': 'Zum Inhalt springen',
    'btn.copyHtml': 'HTML kopieren', 'btn.copySvg': 'SVG kopieren', 'btn.saveSvg': 'SVG speichern', 'btn.saveHtml': 'HTML speichern', 'btn.copyText': 'Klartext kopieren', 'btn.png': 'PNG erzeugen',
    'about.h': 'Was ist Typographics Art?',
    'about.p1': 'Typographics Art (TG Art) formt aus einem gegebenen Text ein Bild. Der Text wird Zeichen für Zeichen in seiner ursprünglichen Reihenfolge gesetzt. Von Buchstabe zu Buchstabe ändern sich nur typografische Eigenschaften: Grösse, Strichstärke, Farbe.',
    'about.vs': 'ASCII-Art wählt für jede Zelle eines Rasters ein Zeichen, der Text geht verloren. Typographics Art dreht das um: Die Zeichen gibt der Text vor, gewählt wird nur ihre Typografie. Damit ist es Briefpapier für das KI-Zeitalter: ein Dokument, das ein Mensch auf einen Blick erkennt und eine Maschine genau so liest, wie es dasteht, jedes Wort.',
    'about.rulesH': 'Drei Regeln',
    'about.r1': 'Der Text wird nie verändert, umgestellt oder gekürzt. Fülltext ist nur erlaubt, wenn er ausgewiesen ist.',
    'about.r2': 'Text bleibt Text: Das Ergebnis lässt sich kopieren, durchsuchen und maschinell lesen und ergibt den Ausgangstext wieder, mit einem Leerzeichen an Stelle jedes Zeilenumbruchs und jeder Leerzeichenfolge.',
    'about.r3': 'Nur die Typografie variiert. Keine Formen, Hintergründe oder Bilder ausser den Buchstaben.',
    'about.ossH': 'Open Source', 'about.oss': 'Verfahren, App und Bibliothek stehen unter der MIT-Lizenz. Ideen, Schriften, Algorithmen und Werke sind willkommen.',
    'footer.license': 'MIT-Lizenz',
    'label.shape': 'Kanten innerhalb der Buchstaben folgen',
    'label.autoLevels': 'Tonwerte automatisch spreizen',
    'btn.pdf': 'Drucken / PDF', 'nav.gallery': 'Galerie',
    'ai.toggle': 'Was die KI liest', 'ai.h': 'Was die KI liest',
    'ai.p': 'Das ist der Text im Bild, direkt aus der Seite gelesen. Ein Sprachmodell, eine Suchmaschine oder ein Screenreader bekommt genau das, in dieser Reihenfolge. ASCII-Art gäbe nur Schattierungszeichen her.',
    'label.cuts': 'Schriftschnitte',
    'secret.summary': 'Versteckte Nachricht', 'secret.p': 'Verstecke eine Nachricht in diesem Werk: Das Werk behält nur seinen öffentlichen Text, und ein Schlüssel merkt sich, wo die Buchstaben der Nachricht darin stehen, zufällig gewählt. Mit Schlüssel und diesem Werk kommt die Nachricht zurück. Bewahre den Schlüssel wie ein Passwort auf.',
    'secret.in': 'Zu versteckende Nachricht', 'secret.hide': 'Schlüssel erzeugen', 'secret.reveal': 'Nachricht aus Schlüssel lesen', 'secret.key': 'Schlüssel', 'secret.copy': 'Schlüssel kopieren',
    'hint.cuts': 'Jede Stärke, Breite und Schriftgrösse wird im PDF eine eigene Schrift. Weniger Stärken geben eine viel kleinere Datei; Grösse und Farbe zeichnen das Bild weiter.',
    'hint.export': 'HTML, SVG und PDF enthalten den Text als echte Zeichen. PNG ist ein reines Bild. Für ein PDF im Druckdialog „Als PDF sichern“ wählen.',
  },
};
const MSG = {
  en: {
    chars: '{n} characters', faithful: 'Every character kept, in order · {n} characters · whitespace collapsed', notFaithful: 'Text differs from the source', filler: 'of which Lorem ipsum <b>{n}</b>',
    cutsN: '{n} weights', cuts1: '1 weight', cutsAll: 'all weights',
    jumpResult: '↓ Result', jumpSettings: '↑ Settings', secretCopied: 'Key copied.', secretCopyFail: 'Could not copy: select the key and copy it by hand.', secretEmpty: 'Type the message to hide first.', secretNoKey: 'Paste the key first (it starts with “tg1.”).', secretBadKey: 'This is not a key: a key starts with “tg1.”.', secretDamaged: 'The key is damaged or incomplete. Copy it again in full.',
    sampleLoaded: 'Sample text loaded: {title}. Source: {source} ({licence}).', sampleBig: 'large, takes a few seconds', sampleNo: 'no {c}', sampleGroupWorks: 'Public-domain works', sampleGroupLaws: 'Laws and declarations', sampleGroupTech: 'Technical', sampleGroupAi: 'AI instructions', secretSuggest: 'Texts that contain it:', secretSuggested: 'Text loaded. Now create the key again.',
    secretMade: 'Key created. It only works with this exact work: save or copy the work too (see “Copy & save”).', secretRead: 'Message read from the key.',
    secretMissing: 'Cannot hide this yet: the text lacks {c}. Use other words, or add a word with it to the text.', secretWrong: 'This key belongs to a different work, or the text was changed.',
    pdfSize: 'PDF ≈ <b>{n} MB</b> · {fonts} fonts', pdfTitle: 'Estimate for a PDF printed from Chrome ({fonts} fonts, {runs} style runs), measured within 3 %. The command-line tool makes the file 20–40 % smaller (measured).',
    lines: '<b>{n}</b> lines', base: 'base size <b>{n}</b> px', fidelity: 'tone fidelity <b>{n}</b>', range: 'dynamic range <b>{n}</b>', paperAuto: 'paper by picture: <b>{p}</b>', overflow: 'Text is longer than the area: the sheet grows',
    tooShort: 'Your text is already as long as the target. Raise the target.', filled: '{n} characters of Lorem ipsum appended.', noFill: 'No filler found that could be removed.',
    unfilled: 'Filler removed.', loaded: '{name} loaded.', copied: '{what} copied ({n} characters).', selected: '{what} is selected: press Ctrl+C or ⌘+C.',
    png: 'PNG created: right-click or long-press the image, then “Save image”.', noText: 'Please enter a text', badImage: 'The image could not be read', scale: 'Preview {n} %',
    saved: '{what} saved.', plain: 'Plain text', aiChip: '{n} words · identical to your text', aiChipBad: 'differs from your text',
  },
  de: {
    chars: '{n} Zeichen', faithful: 'Jedes Zeichen in Reihenfolge erhalten · {n} Zeichen · Leerraum zusammengefasst', notFaithful: 'Text weicht vom Original ab', filler: 'davon Lorem ipsum <b>{n}</b>',
    cutsN: '{n} Stärken', cuts1: '1 Stärke', cutsAll: 'alle Stärken',
    jumpResult: '↓ Ergebnis', jumpSettings: '↑ Einstellungen', secretCopied: 'Schlüssel kopiert.', secretCopyFail: 'Kopieren nicht möglich: Schlüssel markieren und von Hand kopieren.', secretEmpty: 'Zuerst die Nachricht eintippen, die versteckt werden soll.', secretNoKey: 'Zuerst den Schlüssel einfügen (er beginnt mit „tg1.“).', secretBadKey: 'Das ist kein Schlüssel: Ein Schlüssel beginnt mit „tg1.“.', secretDamaged: 'Der Schlüssel ist beschädigt oder unvollständig. Bitte noch einmal ganz kopieren.',
    sampleLoaded: 'Beispieltext geladen: {title}. Quelle: {source} ({licence}).', sampleBig: 'gross, braucht einige Sekunden', sampleNo: 'ohne {c}', sampleGroupWorks: 'Gemeinfreie Werke', sampleGroupLaws: 'Gesetze und Erklärungen', sampleGroupTech: 'Technik', sampleGroupAi: 'KI-Anweisungen', secretSuggest: 'Texte, die ihn enthalten:', secretSuggested: 'Text geladen. Jetzt den Schlüssel noch einmal erzeugen.',
    secretMade: 'Schlüssel erzeugt. Er passt nur zu genau diesem Werk: Das Werk ebenfalls speichern oder kopieren (siehe „Kopieren & speichern“).', secretRead: 'Nachricht aus dem Schlüssel gelesen.',
    secretMissing: 'So noch nicht möglich: Im Text fehlt {c}. Andere Wörter wählen oder ein Wort mit diesem Buchstaben in den Text aufnehmen.', secretWrong: 'Dieser Schlüssel gehört zu einem anderen Werk, oder der Text wurde verändert.',
    pdfSize: 'PDF ≈ <b>{n} MB</b> · {fonts} Schriften', pdfTitle: 'Schätzung für ein aus Chrome gedrucktes PDF ({fonts} Schriften, {runs} Stilwechsel), gemessen auf 3 % genau. Das Kommandozeilen-Werkzeug macht die Datei 20–40 % kleiner (gemessen).',
    lines: '<b>{n}</b> Zeilen', base: 'Grundgrösse <b>{n}</b> px', fidelity: 'Tontreue <b>{n}</b>', range: 'Tonumfang <b>{n}</b>', paperAuto: 'Papier nach Bild: <b>{p}</b>', overflow: 'Text länger als die Fläche: der Bogen wird höher',
    tooShort: 'Dein Text ist schon so lang wie das Ziel. Stell das Ziel höher.', filled: '{n} Zeichen Lorem ipsum angehängt.', noFill: 'Keine Füllung gefunden, die sich entfernen lässt.',
    unfilled: 'Füllung entfernt.', loaded: '{name} geladen.', copied: '{what} kopiert ({n} Zeichen).', selected: '{what} ist markiert: mit Strg+C oder ⌘+C kopieren.',
    png: 'PNG erzeugt: Rechtsklick oder langes Drücken auf das Bild, dann „Bild speichern“.', noText: 'Bitte Text eingeben', badImage: 'Bild konnte nicht gelesen werden', scale: 'Vorschau {n} %',
    saved: '{what} gespeichert.', plain: 'Klartext', aiChip: '{n} Wörter · identisch mit deinem Text', aiChipBad: 'weicht von deinem Text ab',
  },
};
// The start text: the beginning of "Learning to Read" (Frederick Douglass, Narrative of the Life of Frederick Douglass, 1845,
// public domain; the whole sample is samples/gallery-douglass.txt), set into his portrait: a life story that forms the face.
const DOUGLASS = `As to my own treatment while I lived on Colonel Lloyd’s plantation, it was very similar to that of the other slave children. I was not old enough to work in the field, and there being little else than field work to do, I had a great deal of leisure time. The most I had to do was to drive up the cows at evening, keep the fowls out of the garden, keep the front yard clean, and run of errands for my old master’s daughter, Mrs. Lucretia Auld. The most of my leisure time I spent in helping Master Daniel Lloyd in finding his birds, after he had shot them. My connection with Master Daniel was of some advantage to me. He became quite attached to me, and was a sort of protector of me. He would not allow the older boys to impose upon me, and would divide his cakes with me. I was seldom whipped by my old master, and suffered little from any thing else than hunger and cold. I suffered much from hunger, but much more from cold. In hottest summer and coldest winter, I was kept almost naked—no shoes, no stockings, no jacket, no trousers, nothing on but a coarse tow linen shirt, reaching only to my knees. I had no bed. I must have perished with cold, but that, the coldest nights, I used to steal a bag which was used for carrying corn to the mill. I would crawl into this bag, and there sleep on the cold, damp, clay floor, with my head in and feet out. My feet have been so cracked with the frost, that the pen with which I am writing might be laid in the gashes. We were not regularly allowanced. Our food was coarse corn meal boiled. This was called _mush_. It was put into a large wooden tray or trough, and set down upon the ground. The children were then called, like so many pigs, and like so many pigs they would come and devour the mush; some with oyster-shells, others with pieces of shingle, some with naked hands, and none with spoons. He that ate fastest got most; he that was strongest secured the best place; and few left the trough satisfied. I was probably between seven and eight years old when I left Colonel Lloyd’s plantation. I left it with joy. I shall never forget the ecstasy with which I received the intelligence that my old master (Anthony) had determined to let me go to Baltimore, to live with Mr. Hugh Auld, brother to my old master’s son-in-law, Captain Thomas Auld. I received this information about three days before my departure. They were three of the happiest days I ever enjoyed. I spent the most part of all these three days in the creek, washing off the plantation scurf, and preparing myself for my departure. The pride of appearance which this would indicate was not my own. I spent the time in washing, not so much because I wished to, but because Mrs. Lucretia had told me I must get all the dead skin off my feet and knees before I could go to Baltimore; for the people in Baltimore were very cleanly, and would laugh at me if I looked dirty. Besides, she was going to give me a pair of trousers, which I should not put on unless I got all the dirt off me. The thought of owning a pair of trousers was great indeed! It was almost a sufficient motive, not only to make me take off what would be called by pig-drovers the mange, but the skin itself. I went at it in good earnest, working for the first time with the hope of reward. The ties that ordinarily bind children to their homes were all suspended in my case. I found no severe trial in my departure. My home was charmless; it was not home to me; on parting from it, I could not feel that I was leaving any thing which I could have enjoyed by staying.`;
const SAMPLES = { en: DOUGLASS, de: DOUGLASS };
const EN_TEXT = new Map([...document.querySelectorAll('[data-i18n]')].map((el) => [el.dataset.i18n, el.textContent]));
let lang = 'en';
let dataPanel = null;
const t = (key, vars = {}) => MSG[lang][key].replace(/\{(\w+)\}/g, (_, k) => vars[k]);
const fmt = (n) => n.toLocaleString(lang === 'de' ? 'de-CH' : 'en-US');
function setLang(l) {
  const textEl = $('#text');
  if (normalizeText(textEl.value) === normalizeText(SAMPLES[lang])) textEl.value = SAMPLES[l];
  if ($('#describe').value === START_DESCRIPTION[lang]) { $('#describe').value = START_DESCRIPTION[l]; }
  lang = l;
  document.documentElement.lang = l;
  document.title = l === 'de' ? 'Selbst gestalten – Typographics Art' : 'Make your own – Typographics Art';
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const v = l === 'en' ? EN_TEXT.get(el.dataset.i18n) : I18N.de[el.dataset.i18n];
    if (v != null) el.textContent = v;
  });
  document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === l)));
  $('#thumb').alt = l === 'de' ? 'Vorschau des Fotos' : 'Photo preview';
  $('#png').alt = l === 'de' ? 'Gesetzter Text als PNG' : 'Set text as PNG';
  if (typeof buildSampleSelect === 'function') buildSampleSelect();
  if (dataPanel) dataPanel.setLang();
  applyDescription();
}

/* ---------- Start pair: a portrait formed from the sitter's own life story ---------- */
const START_PHOTO = 'assets/start/douglass.jpg'; // Frederick Douglass, c. 1879, photo by George Kendall Warren, public domain (gallery/works.json); under assets/ so it is served wherever the generator is
const START_DESCRIPTION = { en: 'Portrait of Frederick Douglass, formed from his own Narrative', de: 'Porträt von Frederick Douglass, geformt aus seiner eigenen Lebensgeschichte' };
const describe = () => $('#describe').value.trim();
/** The picture's own description (what it shows) names the figure for assistive technology; the set text is read from #srText. */
function applyDescription() { const d = describe(); if (d) $('#sheet').setAttribute('aria-label', d); else $('#sheet').removeAttribute('aria-label'); }

/* ---------- Settings ---------- */
const PRESETS = {
  ai: { legibility: 'high', unit: 'word', color: 'photo', paper: 'light', contrast: 1.8, brightness: 0, edges: 0.5, spacing: 1.12, aspect: 'photo' },
  portrait: { legibility: 'medium', unit: 'char', color: 'photo', paper: 'light', contrast: 1.5, brightness: 0, edges: 0.7, spacing: 1.05, aspect: '1.25' },
  poster: { legibility: 'free', unit: 'char', color: 'photo', paper: 'dark', contrast: 1.9, brightness: 0.05, edges: 1.0, spacing: 0.98, aspect: 'photo' },
};
const CONTROLS = ['legibility', 'color', 'aspect', 'width', 'contrast', 'brightness', 'edges', 'spacing', 'target', 'cuts'];
const CUTS = [1, 2, 3, 4, 6, null]; // weights per width; null: all the legibility level allows
const radio = (n) => document.querySelector(`input[name="${n}"]:checked`).value;
const setRadio = (n, v) => { const el = document.querySelector(`input[name="${n}"][value="${v}"]`); if (el) el.checked = true; };
function showValues() {
  $('#contrastV').textContent = (+$('#contrast').value).toFixed(2);
  const b = +$('#brightness').value; $('#brightnessV').textContent = (b > 0 ? '+' : '') + b.toFixed(2);
  $('#edgesV').textContent = (+$('#edges').value).toFixed(2);
  $('#spacingV').textContent = (+$('#spacing').value).toFixed(2) + ' ×';
  const cuts = CUTS[+$('#cuts').value];
  $('#cutsV').textContent = !cuts ? t('cutsAll') : cuts === 1 ? t('cuts1') : t('cutsN', { n: cuts });
  $('#targetV').textContent = t('chars', { n: fmt(+$('#target').value) });
}
const STORE = 'tg-art.v1';
let fillBase = null;
function save() {
  try {
    const s = { lang };
    CONTROLS.forEach((k) => (s[k] = $('#' + k).value));
    s.invert = $('#invert').checked; s.shape = $('#shape').checked; s.autoLevels = $('#autoLevels').checked; s.describe = $('#describe').value;
    s.unit = radio('unit'); s.paper = radio('paper'); s.mode = radio('mode');
    s.v = 2; // settings version: from 2 on, `paper` may be "auto" and a saved light/dark is a choice
    const txt = $('#text').value;
    if (txt.length < 200000) { s.text = txt; s.fillBase = fillBase; }
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch { /* storage unavailable: settings simply are not remembered */ }
}
function restore() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (!s) return null;
    CONTROLS.forEach((k) => { if (s[k] != null) $('#' + k).value = s[k]; });
    $('#invert').checked = !!s.invert; setRadio('unit', s.unit);
    // Before version 2 "light" was only the default, not a choice: such settings get the automatic paper.
    setRadio('paper', (s.v ?? 1) >= 2 ? s.paper : 'auto');
    if (s.mode) setRadio('mode', s.mode);
    if (s.shape != null) $('#shape').checked = s.shape;
    if (s.autoLevels != null) $('#autoLevels').checked = s.autoLevels;
    if (typeof s.text === 'string') { $('#text').value = s.text; fillBase = s.fillBase ?? null; }
    if (typeof s.describe === 'string') $('#describe').value = s.describe;
    return s;
  } catch { return null; }
}

/* ---------- Setting the sheet ---------- */
let photo = new Image(), photoReady, photoLum = 0.5, running = false, again = false, lastWrap = 0, sheet = null, plain = '', overlayDirty = true;
function loadPhoto(src) {
  photoReady = new Promise((r) => {
    photo = new Image();
    photo.onload = () => { photoLum = lumOf(photo); r(); }; photo.onerror = r; photo.src = src;
  });
  $('#thumb').src = src; overlayDirty = true;
}
/** Mean luminance (0..1) of the photo on a 64 × 64 reduction: with the paper on "auto" it decides light or dark (src/tone.js paperFor). */
function lumOf(img) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, 64, 64);
  return meanLuminance(g.getImageData(0, 0, 64, 64));
}
const chip = (h, c = '') => `<span class="chip ${c}">${h}</span>`;

// The view is laid out at about the size the glyphs were measured at (REF_SIZE) and scaled down for
// display. Desktop browsers round glyph advances to whole pixels at tiny sizes (font hinting): at 6 px
// type that made line ends wander by up to 15 px, while measurement happens at 40 px.
let viewZoom = 1;
function applyScale() {
  if (!sheet) return;
  const f = Math.min(1, $('#wrap').clientWidth / sheet.outW);
  viewZoom = Math.max(1, Math.min(16, REF_SIZE / sheet.result.fs));
  $('#sheet').style.zoom = viewZoom;
  $('#sheet').style.transform = `scale(${f / viewZoom})`;
  $('#scaler').style.width = sheet.outW * f + 'px';
  $('#scaler').style.height = sheet.outH * f + 'px';
  $('#scaleInfo').textContent = f < 1 ? t('scale', { n: Math.round(f * 100) }) : '';
}
function applyOverlay() {
  const v = +$('#overlayR').value, ov = $('#overlay');
  if (v > 0 && sheet && overlayDirty) { ov.src = sheet.imageCanvas.toDataURL('image/jpeg', 0.85); overlayDirty = false; }
  ov.style.opacity = v;
}

async function run() {
  if (running) { again = true; return; }
  running = true;
  const st = $('#stage');
  try {
    showValues();
    await photoReady;
    const proseN = normalizeText($('#text').value);
    const text = normalizeText(dataPanel.compose($('#text').value));
    $('#nchars').textContent = t('chars', { n: fmt(text.length) });
    if (!text || !photo.naturalWidth) { st.innerHTML = ''; $('#meta').innerHTML = chip(!text ? t('noText') : t('badImage'), 'warn'); return; }
    st.classList.add('busy');
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

    const aspectSel = $('#aspect').value;
    const aspect = aspectSel === 'photo' ? photo.naturalHeight / photo.naturalWidth : +aspectSel;
    const wrapW = $('#wrap').clientWidth; lastWrap = wrapW;
    let width;
    if ($('#width').value === 'auto') {
      width = Math.floor(Math.min(wrapW, 1000) / 1.05);
      if (width * aspect > 1300) width = Math.floor(1300 / aspect);
      width = Math.max(200, width);
    } else {
      width = +$('#width').value;
      if (width * aspect > 4000) width = Math.floor(4000 / aspect);
    }
    // Photos: text inks at most about a third of a cell, so a dark picture on light paper can only reach a medium grey
    // and dissolves (measured on a portrait: dynamic range 0.18 on light paper, 0.55 on dark). The paper therefore
    // follows the picture's key unless chosen by hand, every picture is stretched over the whole tonal range (auto
    // levels), and three type sizes give the highlights room (one size: the picture dissolved; five: twice the PDF).
    const paperSel = radio('paper'), paperChoice = paperSel === 'auto' ? paperFor(photoLum) : paperSel;
    sheet = await typeset(text, photo, {
      font: 'roboto', legibility: $('#legibility').value, color: $('#color').value, paper: paperChoice, unit: radio('unit'),
      contrast: +$('#contrast').value, brightness: +$('#brightness').value, edges: +$('#edges').value, lineSpacing: +$('#spacing').value,
      invert: $('#invert').checked, shape: $('#shape').checked, autoLevels: $('#autoLevels').checked, sizeCount: 5, aspect, width,
      weightCount: CUTS[+$('#cuts').value],
    });
    $('#pageSize').textContent = `@page{size:${sheet.outW}px ${sheet.outH}px;margin:0}`;
    overlayDirty = true;

    const { outW, outH, pad, W, H, font, paper } = sheet;
    $('#sheet').style.width = outW + 'px'; $('#sheet').style.height = outH + 'px';
    Object.assign(st.style, {
      width: outW + 'px', height: outH + 'px', padding: pad + 'px',
      background: `rgb(${paper.paper})`, color: `rgb(${paper.ink})`, fontFamily: font.css, fontVariationSettings: font.variations,
    });
    Object.assign($('#overlay').style, { width: W + 'px', height: H + 'px', left: pad + 'px', top: pad + 'px' });
    st.lang = lang;
    st.innerHTML = toHtml(sheet);
    applyScale(); applyOverlay();
    plain = st.innerText;
    $('#export').value = toStandaloneHtml(sheet, { description: describe(), markdown: $('#text').value });
    $('#png').hidden = true;

    // A data block does not depend on whitespace (docs/structured-data.md 1.2): the layout may cut a long token with a space, so the check ignores spaces there.
    const squash = (x) => x.replace(/\s+/g, '');
    const same = normalizeText(plain) === text || (text.includes('TGD1[') && squash(plain) === squash(text));
    $('#aiText').textContent = normalizeText(plain);
    $('#srText').textContent = normalizeText(plain); // what assistive technology reads: the text once, not the styled runs of #stage
    $('#aiChip').textContent = same ? t('aiChip', { n: fmt(text.split(' ').length) }) : t('aiChipBad');
    $('#aiChip').className = 'chip ' + (same ? 'ok' : 'warn');
    const fillN = fillBase !== null && proseN.startsWith(normalizeText(fillBase)) ? proseN.length - normalizeText(fillBase).length : 0;
    $('#meta').innerHTML =
      chip(same ? t('faithful', { n: fmt(text.length) }) : t('notFaithful'), same ? 'ok' : 'warn') +
      (fillN ? chip(t('filler', { n: fmt(fillN) })) : '') +
      chip(t('lines', { n: sheet.result.lines.length })) +
      chip(t('base', { n: sheet.result.fs.toFixed(1) })) +
      chip(t('fidelity', { n: sheet.toneFidelity.toFixed(2) })) +
      chip(t('range', { n: sheet.dynamicRange.toFixed(2) })) +
      (paperSel === 'auto' ? chip(t('paperAuto', { p: lang === 'de' ? (paperChoice === 'dark' ? 'dunkel' : 'hell') : paperChoice })) : '') +
      pdfChip(pdfStats(sheet)) +
      chip(`${fmt(outW)} × ${fmt(outH)} px`) +
      (sheet.result.overflow ? chip(t('overflow'), 'warn') : '');
    save();
    dataPanel.afterRun();
  } finally {
    st.classList.remove('busy');
    running = false;
    if (again) { again = false; run(); } else idleWaiters.splice(0).forEach((r) => r());
  }
}
// The data panel sets the work again and waits until it is done, then reads the text back out of it.
let idleWaiters = [];
const idle = () => new Promise((r) => { if (!running && !again) r(); else idleWaiters.push(r); });
function rerun() {
  run().catch((e) => { const m = $('#meta'), s = document.createElement('span'); s.className = 'chip warn'; s.textContent = e.message || String(e); m.replaceChildren(s); }); // an error message is text, never markup
  return idle();
}

/* ---------- Controls ---------- */
let timer;
const soon = () => { clearTimeout(timer); timer = setTimeout(run, 350); };
$('#form').addEventListener('submit', (e) => { e.preventDefault(); run(); });
['#text', '#contrast', '#brightness', '#edges', '#spacing', '#cuts'].forEach((s) => $(s).addEventListener('input', () => { showValues(); soon(); }));
function pdfChip(stats) {
  const mb = estimatePdfBytes(stats) / 1048576;
  return `<span class="chip" title="${t('pdfTitle', { fonts: stats.fonts, runs: fmt(stats.runs) })}">${t('pdfSize', { n: mb < 0.1 ? mb.toFixed(2) : mb.toFixed(1), fonts: stats.fonts })}</span>`;
}
['#legibility', '#color', '#aspect', '#width', '#invert', '#shape', '#autoLevels'].forEach((s) => $(s).addEventListener('change', soon));
document.querySelectorAll('input[name="unit"],input[name="paper"]').forEach((el) => el.addEventListener('change', soon));
const applyMode = () => { $('#form').classList.toggle('simple', radio('mode') === 'simple'); if (sheet) applyScale(); };
document.querySelectorAll('input[name="mode"]').forEach((el) => el.addEventListener('change', () => { applyMode(); save(); }));
$('#target').addEventListener('input', showValues);
$('#overlayR').addEventListener('input', applyOverlay);
document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => {
  setLang(b.dataset.lang); showValues(); run();
  try { localStorage.setItem('tg-art.lang', b.dataset.lang); } catch { /* not remembered */ } // one key for every page of the site
}));

function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;
  ['legibility', 'color', 'contrast', 'brightness', 'edges', 'spacing', 'aspect'].forEach((k) => ($('#' + k).value = p[k]));
  setRadio('unit', p.unit); setRadio('paper', p.paper); $('#invert').checked = false;
}
document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => { applyPreset(b.dataset.preset); showValues(); run(); }));

$('#fill').addEventListener('click', () => {
  const cur = $('#text').value;
  const base = fillBase !== null && cur.startsWith(fillBase) ? fillBase : cur.trimEnd();
  const need = +$('#target').value - normalizeText(base).length - 1;
  if (need < 20) { $('#fillMsg').textContent = t('tooShort'); return; }
  fillBase = base;
  $('#text').value = base + (base ? '\n\n' : '') + lorem(need, normalizeText(base).length + 7);
  $('#fillMsg').textContent = t('filled', { n: fmt(need) });
  run();
});
$('#unfill').addEventListener('click', () => {
  const cur = $('#text').value;
  if (fillBase === null || !cur.startsWith(fillBase)) { $('#fillMsg').textContent = t('noFill'); return; }
  $('#text').value = fillBase; fillBase = null;
  $('#fillMsg').textContent = t('unfilled'); run();
});

$('#txtfile').addEventListener('change', (e) => {
  const f = e.target.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => { $('#text').value = String(rd.result); fillBase = null; $('#fillMsg').textContent = t('loaded', { name: f.name }); run(); };
  rd.readAsText(f); e.target.value = '';
});
/* ---------- Phones: the result sits far below the settings, a pill jumps between them ---------- */
const jump = $('#jump'), phoneQuery = matchMedia('(max-width: 900px)');
let resultVisible = false;
function showJump() {
  jump.hidden = !phoneQuery.matches;
  jump.textContent = t(resultVisible ? 'jumpSettings' : 'jumpResult');
}
new IntersectionObserver((entries) => { resultVisible = entries.some((e) => e.isIntersecting); showJump(); }, { threshold: 0.25 }).observe($('#sheet'));
jump.addEventListener('click', () => (resultVisible ? $('#form') : $('#result')).scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
phoneQuery.addEventListener('change', showJump);
document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', showJump));

/* ---------- Sample texts (samples/index.json): which characters each one has is recorded, so a hidden message can be matched ---------- */
let SAMPLE_TEXTS = [];
const sampleLabel = (m) => {
  const missing = [...'abcdefghijklmnopqrstuvwxyz'].filter((c) => !m.has.includes(c)).join(' ');
  return [m.title, m.language.toUpperCase(), `${fmt(Math.round(m.characters / 1000))} k`, missing ? t('sampleNo', { c: missing }) : ''].filter(Boolean).join(' · ');
};
function buildSampleSelect() {
  const sel = $('#sampleSel');
  if (!SAMPLE_TEXTS.length) return;
  $('#sampleField').hidden = false;
  const keep = sel.options[0];
  sel.replaceChildren(keep);
  for (const [g, key] of [['works', 'sampleGroupWorks'], ['laws', 'sampleGroupLaws'], ['tech', 'sampleGroupTech'], ['ai', 'sampleGroupAi']]) {
    const og = document.createElement('optgroup'); og.label = t(key);
    for (const m of SAMPLE_TEXTS.filter((x) => x.group === g)) { const o = document.createElement('option'); o.value = m.id; o.textContent = sampleLabel(m); og.append(o); }
    if (og.children.length) sel.append(og);
  }
}
async function loadSample(id) {
  const m = SAMPLE_TEXTS.find((x) => x.id === id); if (!m) return false;
  const r = await fetch(`samples/${encodeURIComponent(id)}.txt`); if (!r.ok) return false;
  $('#text').value = await r.text(); fillBase = null; $('#fillMsg').textContent = '';
  $('#sampleInfo').textContent = t('sampleLoaded', { title: m.title, source: m.source, licence: m.licence }) + (m.characters > 100000 ? ' ' + t('sampleBig') + '.' : '');
  $('#sampleSel').value = id; run(); return true;
}
$('#sampleSel').addEventListener('change', (e) => { if (e.target.value) loadSample(e.target.value); });
// A hidden message needs every one of its characters in the text: offer the sample texts that have them all.
function suggest(missing) {
  const box = $('#secretSuggest'); box.replaceChildren();
  if (!missing || !missing.length) return;
  const fit = SAMPLE_TEXTS.filter((m) => missing.every((c) => m.has.includes(c)))
    .sort((a, b) => (b.language === lang) - (a.language === lang) || a.characters - b.characters).slice(0, 5);
  if (!fit.length) return;
  const lead = document.createElement('span'); lead.className = 'hint'; lead.textContent = t('secretSuggest'); box.append(lead);
  for (const m of fit) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = `${m.title} (${m.language.toUpperCase()})`;
    b.addEventListener('click', async () => { if (await loadSample(m.id)) say(t('secretSuggested'), 'good'); });
    box.append(b);
  }
}
fetch('samples/index.json').then((r) => (r.ok ? r.json() : [])).then((list) => { SAMPLE_TEXTS = list; buildSampleSelect(); }).catch(() => {});

function takeImage(f) {
  if (!f || !f.type.startsWith('image/')) return;
  const rd = new FileReader();
  rd.onload = () => { loadPhoto(rd.result); $('#photoName').textContent = f.name; $('#photoName').removeAttribute('data-i18n'); $('#describe').value = ''; applyDescription(); run(); };
  rd.readAsDataURL(f);
}
$('#photo').addEventListener('change', (e) => takeImage(e.target.files[0]));
const drop = $('#drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => takeImage(e.dataTransfer.files[0]));

async function copy(txt, what) {
  const m = $('#copyMsg'), ta = $('#export');
  ta.value = txt;
  try { await navigator.clipboard.writeText(txt); m.textContent = t('copied', { what, n: fmt(txt.length) }); }
  catch { ta.focus(); ta.select(); m.textContent = t('selected', { what }); }
}
$('#copyHtml').addEventListener('click', async () => { if (sheet) copy(toStandaloneHtml(sheet, await typogramData()), 'HTML'); });
// The data layer of an exported Typogram (docs/typogram-file.md): a JSON-LD record whose tgart.hash binds the image layer
// to the exact source. The exact typed source (its line breaks and any Markdown structure, which the picture normalises
// away) is carried in the same data layer as `markdown`.
async function typogramData() {
  const md = $('#text').value, media = 'text/plain; charset=utf-8';
  const jsonld = buildJsonld({
    name: describe() || undefined, dateCreated: new Date().toISOString(),
    sourceFormat: media, charCount: md.length, hash: await sha256Hex(canonicalText(md)),
  });
  return { description: describe(), markdown: md, media, jsonld };
}
// The SVG Typogram: a valid picture that also carries the data layer (the exact source + a JSON-LD record with the hash).
async function typogramSvg() {
  return toSvg(sheet, await typogramData());
}
$('#copySvg').addEventListener('click', async () => { if (sheet) copy(await typogramSvg(), 'SVG'); });
$('#copyText').addEventListener('click', () => sheet && copy(plain, t('plain')));
$('#makePng').addEventListener('click', () => {
  if (!sheet) return;
  const img = $('#png'); img.src = toPng(sheet); img.hidden = false;
  $('#copyMsg').textContent = t('png');
});

$('#saveSvg').addEventListener('click', async () => { if (sheet) { saveBlob(await typogramSvg(), 'typographics-art.svg', 'image/svg+xml'); $('#copyMsg').textContent = t('saved', { what: 'SVG' }); } });
$('#saveHtml').addEventListener('click', async () => { if (sheet) { saveBlob(toStandaloneHtml(sheet, await typogramData()), 'typographics-art.html', 'text/html'); $('#copyMsg').textContent = t('saved', { what: 'HTML' }); } });
$('#printPdf').addEventListener('click', () => sheet && window.print());
// Hidden message: a book cipher over the work's public text (src/secret.js). The work itself is not changed.
const say = (msg, kind) => { const m = $('#secretMsg'); m.textContent = msg; m.className = 'hint ' + kind; $('#secretSuggest').replaceChildren(); };
$('#secretHide').addEventListener('click', async () => {
  try {
    $('#secretKey').value = await hideSecret($('#aiText').textContent, $('#secretIn').value);
    say(t('secretMade'), 'good');
  } catch (e) { $('#secretKey').value = ''; say(e.missing ? t('secretMissing', { c: e.missing.map((c) => (lang === 'de' ? `„${c}“` : `“${c}”`)).join(', ') }) : e.code === 'empty-secret' ? t('secretEmpty') : e.message, 'bad'); suggest(e.missing); }
});
$('#secretReveal').addEventListener('click', async () => {
  try {
    $('#secretIn').value = await revealSecret($('#aiText').textContent, $('#secretKey').value);
    say(t('secretRead'), 'good');
  } catch (e) { say(e.wrongText ? t('secretWrong') : e.code === 'no-key' ? t('secretNoKey') : e.code === 'bad-prefix' ? t('secretBadKey') : e.code === 'damaged' ? t('secretDamaged') : e.message, 'bad'); }
});
$('#secretCopy').addEventListener('click', async () => {
  const key = $('#secretKey').value.trim();
  if (!key) return say(t('secretNoKey'), 'bad');
  try { await navigator.clipboard.writeText(key); say(t('secretCopied'), 'good'); } catch { say(t('secretCopyFail'), 'bad'); }
});
$('#aiToggle').addEventListener('click', () => {
  const open = $('#aiPanel').hidden;
  $('#aiPanel').hidden = !open;
  $('#aiToggle').setAttribute('aria-expanded', String(open));
  if (open) $('#aiPanel').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
});

new ResizeObserver(() => {
  const w = $('#wrap').clientWidth;
  if (Math.abs(w - lastWrap) < 24) return;
  if ($('#width').value === 'auto') soon(); else { lastWrap = w; applyScale(); }
}).observe($('#wrap'));

dataPanel = mountDataPanel({
  root: $('#data'), lang: () => lang, prose: () => $('#text').value, workCanon: () => $('#aiText').textContent, rerun,
  proseIsSample: () => normalizeText($('#text').value) === normalizeText(SAMPLES[lang]),
});
const openDataFromHash = () => { if (location.hash === '#data') dataPanel.open(); };
addEventListener('hashchange', openDataFromHash);
const saved = restore();
const siteLang = (() => { try { const v = localStorage.getItem('tg-art.lang'); return v === 'de' || v === 'en' ? v : null; } catch { return null; } })();
setLang(siteLang || saved?.lang || ((navigator.language || '').toLowerCase().startsWith('de') ? 'de' : 'en'));
if (!saved || typeof saved.text !== 'string') $('#text').value = SAMPLES[lang];
if (!saved) applyPreset('poster'); // first visit: default to the Poster preset (dark, strong — best for a photo); a returning visitor keeps their saved settings
applyMode();
showValues();
loadPhoto(START_PHOTO);
if (!$('#describe').value && (!saved || typeof saved.describe !== 'string')) $('#describe').value = START_DESCRIPTION[lang];
applyDescription();
$('#describe').addEventListener('input', () => { applyDescription(); save(); });
document.fonts.ready.finally(run);
openDataFromHash();
