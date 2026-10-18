// The page script of index.html (a file, not an inline block, so the site's Content-Security-Policy needs no 'unsafe-inline' for scripts).
import { canonicalText, markupText } from '../../src/index.js';
const $ = (s) => document.querySelector(s);
// Wordmark: the technique in one word, one weight per letter.
{
  const word = 'Typographics Art', b = $('#brand');
  [...word].forEach((ch, i) => { const s = document.createElement('span'); s.textContent = ch === ' ' ? ' ' : ch; s.style.fontWeight = Math.round(250 + (700 * i) / (word.length - 1)); if (i > word.length - 4) s.style.color = 'var(--accent)'; b.appendChild(s); });
}
const DE = {
  'skip': 'Zum Inhalt springen', 'nav.idea': 'Die Idee', 'nav.how': 'So geht es', 'nav.examples': 'One-Pager', 'nav.gallery': 'Galerie', 'nav.ai': 'Für KI', 'nav.data': 'Daten',
  'cta.try': 'Kostenlos ausprobieren', 'cta.make': 'Selbst gestalten, kostenlos', 'cta.proof': 'Den Nachweis ansehen',
  'hero.kicker': 'Typographics Art · Open Source', 'hero.h1a': 'Briefpapier', 'hero.h1b': 'für das KI-Zeitalter.',
  'hero.lead': 'Ein Dokumentformat, bei dem ein Mensch auf einen Blick sieht, was etwas ist und von wem, und eine Maschine beweisbar genau das liest, was der Mensch sieht. Jeder Text wird Buchstabe für Buchstabe zum Bild deines Fotos gesetzt; die Buchstaben ändern sich nie, also sieht ein Mensch das Bild und eine Maschine liest jedes Wort.',
  'hero.tag': 'Das ganze Buch: 1,2 Millionen Zeichen', 'hero.cap': 'Moby-Dick, alle 135 Kapitel auf einem Poster von 2 × 3 m. Zoome hinein und lies es, oder lass es eine Maschine zurücklesen: Der Text ist vollständig.',
  'demo.kicker': 'Selbst ansehen', 'demo.h': 'Zoom hinein, und das Bild wird zu Wörtern.',
  'demo.lead': 'Dasselbe Werk, fern und nah. Aus der Entfernung ein Porträt; aus der Nähe ist jede Form ein Buchstabe — der echte Text, in Lesereihenfolge. Zieh den Regler oder drück auf Abspielen.',
  'demo.read': 'Was eine Maschine oben liest', 'demo.play': 'Abspielen',
  'demo.src': 'Der Anfang von Frederick Douglass’ Narrative von 1845, gesetzt als sein Porträt. Dieser Text wird direkt aus dem SVG des Werks gelesen, von links oben an.',
  'demo.open': 'Alle drei Ansichten öffnen →',
  'proof.kicker': 'Gemessen, nicht behauptet', 'proof.h': 'Der Text überlebt. Wir haben jedes Zeichen geprüft.',
  'n.exact': 'des Textes kommen aus HTML, SVG und PDF zurück', 'n.chars': 'Zeichen Moby-Dick auf einem Bogen, SHA-256 identisch', 'n.tests': 'Tests im erzeugten Nachweisbericht bestanden',
  'n.ex': 'One-Pager zurückgelesen und geprüft', 'n.vlm': 'Wörter von einem Bildmodell gelesen, wo klassische Texterkennung 5 % schaffte',
  'proof.src': 'Jede Zahl stammt aus einem Skript im Repository:', 'proof.ex': 'One-Pager-Prüfungen',
  'bn.kicker': 'Kommt es bei der Maschine an?', 'bn.h': 'Ein Dokument, vier Wege. Nur ein Bild davon verliert die Wörter.',
  'bn.lead': 'Wir haben ein erfundenes Dokument — fiktiv, damit nichts aus dem Gedächtnis beantwortet werden kann — als Markdown, als gewöhnliches PDF, als Typographics-Art-One-Pager und als flaches Bild dieses One-Pagers geteilt. Dann haben wir jedes zurückgelesen wie eine Maschine und geprüft, ob eingebaute Fakten (eine genaue Zahl, eine Verneinung, eine Klausel-Nummer) überleben.',
  'bn.loading': 'Wird gemessen …',
  'bn.src': 'Das Typographics-Art-PDF kommt bei der Maschine an wie ein gewöhnliches PDF; erst das Flachdrücken des Werks zu einem Bild verliert den Text — teile also das PDF, nicht einen Screenshot.',
  'bn.repro': 'Gemessen und nachvollziehbar:', 'bn.script': 'das Skript', 'bn.doc': 'das Testdokument',
  'idea.kicker': 'Die Idee', 'idea.h': 'Altes Briefpapier, für Maschinen übersetzt.',
  'idea.lead': 'Seit Jahrhunderten zeigen Briefkopf, Unterschrift und Siegel auf einen Blick, was ein Papier ist und von wem. Typographics Art bringt das ins KI-Zeitalter, in drei Schichten.',
  'l1.h': 'Das Dokument', 'l1.p': 'Markdown plus ein paar Pflicht-Metadaten, mit festen Abschnitten, Hashes und einer Versionskette. Für sich schon ein nützliches „llms.txt mit Struktur“.',
  'l2.h': 'Die Herkunft', 'l2.p': 'Schlüssel auf Domains, Signaturen, ein sichtbares Siegel, ein Prüfwerkzeug — das Stück, das heute in der Welt fehlt. Für Software und Fotos gibt es Signaturen, für Texte an KIs noch keine verbreitete, lesbare. Schlüssel und Signaturen werden in öffentlichen Transparenz-Logs verankert, optional über OpenTimestamps in Bitcoin. Kommt mit diesem Release.',
  'l3.h': 'Das Bild', 'l3.p': 'Nicht mehr der Kern, aber der Grund, warum man das Format ohne Spezifikation versteht: Ein Siegel auf einem Umschlag braucht keine Erklärung. Das Bild macht aus einem Krypto-Protokoll einen Gegenstand, den man erkennt, zeigt und aufhängt.',
  'idea.traffic': 'Darauf baut der Verkehr auf: Bündel, die mehrere Werke sammeln, versiegelte Sendungen, Übergabepakete zwischen Menschen und ihren Agenten und signierte Regeln für Coding-Agenten.',
  'idea.pic': 'Die Bildschicht aus der Nähe: Die Wörter werden nie weggeworfen.',
  'idea.not.h': 'Was es nicht ist',
  'idea.not.p': 'Kein Ersatz für PDF und kein Sicherheitssystem gegen einen bösartigen Autor — eine Signatur beweist, wer unterschrieben hat, nicht dass er ehrlich ist. Es ist eine Möglichkeit, keine Garantie: Ob ein Agent die Prüfung wirklich ausführt, hängt davon ab, dass Prüfwerkzeuge dort landen, wo Modelle laufen, und dass es Aussteller gibt, deren Siegel die Leute wiedererkennen.',
  'idea.sum': 'Briefpapier für das KI-Zeitalter — Briefkopf, Unterschrift, Siegel und Umschlag, die der Mensch seit Jahrhunderten nutzt, um Herkunft und Unversehrtheit zu zeigen, übersetzt in ein Format, das eine Maschine prüfen und ein Mensch sofort verstehen kann. Kleiner als „alles in einer Datei“, aber wahr — und es gab es vorher nicht.',
  'duo.see': 'Was ein Mensch sieht', 'duo.read': 'Was eine KI liest', 'duo.note': 'Direkt aus dem SVG des Kunstwerks gelesen: Douglass’ eigene Worte, jedes in Reihenfolge.',
  'c.chosen': 'Was gewählt wird', 'c.chosen.a': 'ein Zeichen je Zelle', 'c.chosen.t': 'die Typografie jedes Zeichens', 'c.text': 'Der Text', 'c.text.a': 'verloren', 'c.text.t': 'jedes Zeichen erhalten, in Lesereihenfolge (Leerraum zusammengefasst)',
  'c.machine': 'Eine Maschine liest', 'c.machine.t': 'den Originaltext', 'c.format': 'Formate', 'c.format.a': 'reiner Text',
  'how.kicker': 'So geht es', 'how.h': 'Vier Schritte von Text und Foto zu einem Kunstwerk, das zugleich ein Dokument ist.',
  'sec.kicker': 'Versteckte Nachrichten', 'sec.h': 'Eine Nachricht, die nur lesen kann, wer den Schlüssel hat. Das Werk bleibt, wie es ist.',
  'sec.lead': 'Schreib ein Geheimnis, wähl ein Werk und erhalte einen Schlüssel. Das Werk behält nur seinen öffentlichen Text, nichts Unsichtbares kommt dazu. Der Schlüssel merkt sich, wo die Buchstaben deines Geheimnisses in diesem Text stehen, zufällig gewählt. Mit Schlüssel und dem richtigen Werk kommt das Geheimnis zurück.',
  'sec1.h': 'Schreiben', 'sec1.p': 'Gib die zu versteckende Nachricht ein, im Generator oder auf der Kommandozeile.',
  'sec2.h': 'Schlüssel', 'sec2.p': 'Für jedes Zeichen wird ein zufälliges Vorkommen im öffentlichen Text gewählt. Zwei Schlüssel für dieselbe Nachricht sehen völlig verschieden aus.',
  'sec3.h': 'Teilen', 'sec3.p': 'Das Werk wird öffentlich, der Schlüssel geht nur an die Person, die die Nachricht lesen soll. Bewahre ihn wie ein Passwort auf.',
  'sec4.h': 'Lesen', 'sec4.p': 'Schlüssel und Werk ergeben die Nachricht. Bei jedem anderen Werk passt der Fingerabdruck des Schlüssels nicht.',
  'sec.try': 'Im Generator ausprobieren', 'sec.docs': 'So funktioniert es',
  'dat.kicker': 'Daten in einem Werk', 'dat.h': 'Eine Tabelle im Bild, von Maschinen zurückgelesen. Versiegelt, wenn sie privat bleiben muss.',
  'dat.lead': 'Eine Excel-, CSV-, JSON- oder Markdown-Datei wird zu einem Block aus einfachem Text, der unverändert durch ein Werk geht, die PDF-Extraktion übersteht und mit Prüfsumme wieder zu den Daten dekodiert. Dieselben Daten lassen sich mit einem Schlüssel versiegeln, so dass das Werk nur seinen öffentlichen Text trägt.',
  'dat1.h': 'Kodieren', 'dat1.p': 'Häng im Generator eine .xlsx-, .csv-, .json-, .md-Datei oder Ähnliches an. TGD 1.0 macht daraus leerraumfesten Text mit eigener Prüfsumme, in deinem Browser; nichts wird hochgeladen.',
  'dat2.h': 'Mittragen', 'dat2.p': 'Der Block ist gewöhnlicher sichtbarer Text im Werk: Ein PDF, SVG oder HTML trägt ihn, und die Werkseite zeigt die Tabelle wieder, Prüfsumme geprüft, mit Downloads als .xlsx, .csv, .json.',
  'dat3.h': 'Versiegeln', 'dat3.p': 'AES-256-GCM mit einem Schlüssel, der genau zu einem Werk passt. Das Werk bleibt unverändert; du erhältst einen Schlüssel und einen versiegelten Datensatz. Ein falscher Schlüssel oder ein verändertes Byte wird auf der Werkseite erkannt.',
  'dat4.h': 'Schlüssel', 'dat4.p': 'Ein Seed-Backup, viele Datensätze: ein Master-Schlüssel und ein eigener Schlüssel pro Datensatz, Schlüssel, die sich auf mehrere Hände aufteilen lassen, ein Passkey als Faktor. Ein Passwort ist nie das einzige Geheimnis.',
  'dat.safe.h': 'Ist das sicher?',
  'dat.safe.p': 'Die Verschlüsselung ist solide; der Code darum herum ist getestet, aber nicht unabhängig geprüft, und die ganze Sicherheit liegt in der Geheimhaltung des Schlüssels. „Ohne den Schlüssel nicht lesbar, soweit die heutige Kryptografie bekannt ist“ stimmt; „niemand kommt je an die Daten“ stimmt nicht: Ein verlorener Schlüssel verliert die Daten, ein kompromittiertes Gerät hebelt alles aus, und ein Passwort allein schützt nie etwas Öffentliches.',
  'dat.status': 'Stand: Im Browser lässt sich eine Datei anhängen, in ein Werk schreiben oder versiegeln und auf der Werkseite beides zurücklesen (kein Server, keine Dritten). Noch nur auf der Befehlszeile: Passwörter, kompakte Buchschlüssel, Schlüssel mit Datensatz darin und ein versiegelter Block im Werk.',
  'dat.try': 'Im Generator ausprobieren', 'dat.sample1': 'Beispiel: Excel', 'dat.sample2': 'Beispiel: CSV', 'dat.docs1': 'Strukturierte Daten', 'dat.docs2': 'Versiegeln', 'dat.docs3': 'Passwörter erklärt',
  's1.h': 'Vermessen', 's1.p': 'Jedes Zeichen wird in zehn Stärken einer variablen Schrift vermessen, Roboto Flex: wie breit es ist, wie viel Tinte es deckt.',
  's2.h': 'Abbilden', 's2.p': 'Das Foto wird zum Tintenbedarf je Fläche: Dunkle Stellen wollen kräftige Buchstaben, helle dünne.',
  's3.h': 'Setzen', 's3.p': 'Zeile für Zeile bekommt jeder Buchstabe die Stärke, Breite und Grösse, die zu seiner Fläche passen. Der Restfehler wird weitergegeben, damit die Töne stimmen.',
  's4.h': 'Prüfen', 's4.p': 'Das fertige Werk wird zurückgelesen wie von einer Maschine und mit der Quelle verglichen. Erst dann ist es fertig.',
  'sc.kicker': 'Schaustück', 'sc.h': 'Ein ganzes Buch als ein Poster.',
  'sc.lead': 'Herman Melvilles Moby-Dick, 135 Kapitel, auf einer einzigen Druckdatei von 2 × 3 m in drei Feldern: der Hafen, die Jagd, der weisse Wal. Klicke irgendwo in die Zoom-Ansicht, und die Seite zeigt den Text an dieser Stelle.',
  'sc.t1': 'Vollständiger Text aus dem Kunstwerk zurückgelesen: SHA-256 identisch mit der Quelle', 'sc.t2': 'Jedes sichtbare Zeichen des Druck-PDFs geprüft', 'sc.t3': 'Kapitelstruktur, Passagen und Worthäufigkeiten identisch',
  'sc.t4': 'Ein Fragensatz zum Buch aus dem ausgelesenen Text beantwortet', 'sc.t5': 'Nachprüfbar: Buch herunterladen, zwei Skripte ausführen, Hash vergleichen', 'sc.cta': 'Das zoombare Poster öffnen', 'sc.views': 'In drei Ansichten lesen & suchen',
  'op.kicker': 'One-Pager', 'op.h': 'Jede Seite eines Dokuments, auf einer Seite.',
  'op.lead': 'Ein Gesetz mit 144 Seiten wird zu einem Blatt: Die Buchstaben sind winzig und bilden zusammen den Titel. Du erkennst das Dokument auf einen Blick; ein Sprachmodell bekommt trotzdem jedes Wort aus dem PDF.',
  'op.agent': 'Anweisungen für KI-Agenten', 'op.all': 'Alle zehn One-Pager mit ihren Prüfungen →',
  'ai.kicker': 'Für KI', 'ai.h': 'Kunst, die Maschinen lesen können.',
  'ai.lead': 'Immer mehr von dem, was wir veröffentlichen, lesen Modelle, Crawler und Hilfstechnologien. Bilder, die ihre Wörter verstecken, sind für sie unsichtbar. Typographics Art behält die Wörter.',
  'u1.h': 'Anweisungen auf einen Blick', 'u1.p': 'Systemprompts, Agentenregeln, Richtlinien: eine Seite, die Menschen zeigt, welches Dokument es ist, und dem Modell jede Regel gibt.',
  'u2.h': 'Barrierefreie Bilder', 'u2.p': 'Der Text ist echter Text, ein Screenreader liest ihn; was das Bild zeigt, bekommt eine eigene kurze Beschreibung, die in die Datei geschrieben wird. Gemessen am Zugänglichkeitsbaum von Chrome, noch nicht mit NVDA, JAWS oder VoiceOver getestet.',
  'u3.h': 'Auffindbare Kunst', 'u3.p': 'Suchmaschinen und KI-Crawler indexieren die Wörter, nicht nur einen Dateinamen.',
  'u4.h': 'Herkunft', 'u4.p': 'Eine Aussage, eine Lizenz oder eine Signatur im Werk übersteht Kopieren und Einfügen.',
  'u5.h': 'Agent-Anweisungen zum Einfügen', 'u5.p': 'System-Prompts, Agent-Regeln und Richtlinien als Seite, die man liest und ein Modell ganz liest — fertige Beispiele: <a href="examples">AGENTS.md, Code-Review- und Support-Agenten, PEP 8, ganze Gesetze</a>.',
  'u6.h': 'Verschlüsselte Medien in einer Datei', 'u6.p': 'Versiegle ein Bild oder ein Video in ein Typogram (eine gültige SVG). Es öffnet überall als Deckelbild; mit dem Schlüssel streamt der <a href="#data">Adapter</a> das Video — im Speicher, nichts auf die Platte, nichts hochgeladen.',
  'ask.h': 'Frag deine KI, was das ist', 'ask.p': 'Das ganze Projekt, README und Dokumente, in einer Datei. Gib sie einem beliebigen Assistenten und frag, was Typographics Art ist. Ein Klick liefert die Erklärung als Typogram-SVG — ein Bild, das zugleich sein eigener vollständiger Text ist, sodass eine KI alles aus der einen Datei liest.',
  'ai.note': 'Ehrlich gebaut: Der sichtbare Titel benennt immer das Dokument, und der vollständige Text ist das angegebene Dokument. Winziger Text darf nie Anweisungen vor den Menschen verstecken, die die Seite sehen.',
  'g.kicker': 'Galerie', 'g.h': 'Porträts, Gemälde, Weltraum: Jedes Bild ist aus echtem Text gesetzt.', 'g.all': 'Zur Galerie →',
  'os.kicker': 'Open Source', 'os.h': 'Eine Technik für alle, wie ASCII-Art.',
  'os.lead': 'Verfahren, Web-App, Bibliothek und Befehlszeile stehen unter der MIT-Lizenz. Keine Abhängigkeiten, kein Build-Schritt, einfaches JavaScript. Schriften, Algorithmen, Übersetzungen, Messungen und Werke sind willkommen.',
  'os.gh': 'GitHub-Repository', 'os.contrib': 'Mitmachen', 'os.roadmap': 'Roadmap & offene Aufgaben',
  'ask.svg': 'Der KI erklären — eine SVG',
  'cs.kicker': 'Bald — hilf mit', 'cs.h': 'Eine selbst­entpackende verschlüsselte Datei, in Rust — die Community könnte sie übernehmen.',
  'cs.p': 'Eine doppelklickbare <code>.exe</code>, <code>.app</code> oder Linux-Datei, die ein Passwort oder eine Schlüsseldatei abfragt und genau ein verschlüsseltes Bild oder Video abspielt — im Speicher, nie auf die Platte geschrieben. Der Entwurf und die Entscheidungen stehen fest; die Verschlüsselung hat eine Spezifikation und Testvektoren zum Nachbauen. Es ist das größte Einzelstück, das ein Mitwirkender übernehmen könnte.',
  'cs.plan': 'Den Plan lesen', 'cs.tasks': 'Was sonst offen ist',
  'faq.h': 'Fragen',
  'f1.q': 'Ist der Text wirklich vollständig?', 'f1.a': 'Ja. Jedes Werk wird zurückgelesen und mit seiner Quelle verglichen; die Berichte nennen Methode und Ergebnis. Leerräume werden zu einfachen Leerzeichen, und ausgewiesener Fülltext (Lorem ipsum, für feinere Bilder) wird getrennt gezählt.',
  'f2.q': 'Kann eine KI es aus einem Foto oder Screenshot lesen?', 'f2.a': 'Teilweise. Klassische Texterkennung liest bei höchster Lesbarkeit rund 99 % und bei künstlerischen Einstellungen weniger; ein Bildmodell las in unseren Stichproben jedes Wort. Für ein perfektes Ergebnis teile HTML, SVG oder PDF: Der Text steckt in der Datei.',
  'f3.q': 'Ist das ein Kalligramm?', 'f3.a': 'Nein. Kalligramme ordnen Text entlang einer Form an, meist von Hand. Typographics Art behält einen normalen Lesesatz und erzeugt das Bild nur über die Typografie jedes Buchstabens, berechnet aus einem beliebigen Foto.',
  'f4.q': 'Kostet es etwas? Darf ich es kommerziell nutzen?', 'f4.a': 'Es ist kostenlos und steht unter der MIT-Lizenz, auch für kommerzielle Nutzung. Achte auf die Rechte an Texten und Fotos.',
  'f5.q': 'Wird mein Text irgendwo hochgeladen?', 'f5.a': 'Nein. Die Web-App läuft vollständig in deinem Browser.',
  'f6.q': 'Gab es das schon?', 'f6.a': 'Ein Bild aus Text ist alt: Mikrografie schrieb ab dem 9. Jahrhundert von Hand Schrift in Bilder, und ASCII-Art macht aus Bildern Zeichen. Neu ist die Kombination — ein gegebener Text, einmal in Lesereihenfolge gesetzt, das Bild nur aus der Typografie je Buchstabe, und das Ergebnis nachweislich als Quelltext zurücklesbar. Siehe prior-art.md.',
  'idea.fid': 'Was „erhalten“ genau heisst und wie es geprüft wird:', 'idea.prior': 'woher es kommt',
  'end.h': 'Gestalte dein erstes eigenes Typographics Art.', 'end.lead': 'Text einfügen, Foto hineinziehen, ein PDF exportieren, das Menschen anschauen und Maschinen lesen können.', 'end.press': 'Pressekit',
  'ft.mit': 'MIT-Lizenz', 'ft.def': 'Definition',
};
const EN = new Map([...document.querySelectorAll('[data-i18n]')].map((el) => [el.dataset.i18n, el.textContent]));
let lang = (navigator.language || '').toLowerCase().startsWith('de') ? 'de' : 'en';
try { lang = localStorage.getItem('tg-art.lang') || JSON.parse(localStorage.getItem('tg-art.v1') || '{}').lang || lang; } catch { /* default */ }
function setLang(l) {
  lang = l; document.documentElement.lang = l;
  document.querySelectorAll('[data-i18n]').forEach((el) => { const v = l === 'de' ? DE[el.dataset.i18n] : EN.get(el.dataset.i18n); if (v != null) el.textContent = v; });
  document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === l)));
  document.querySelectorAll('[data-href-de]').forEach((a) => { a.href = l === 'de' ? a.dataset.hrefDe : a.dataset.hrefEn; }); // links that have a German page
  try { localStorage.setItem('tg-art.lang', l); } catch { /* not remembered */ }
  fillNumbers();
  renderBenefit();
}
document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));

// Numbers come from the generated reports; the values in the HTML are only a fallback.
let proof = null, examples = null, benefit = null;
function renderBenefit() {
  if (!benefit) return;
  const h = lang === 'de'
    ? { format: 'Format', size: 'Grösse', recall: 'Wörter erkannt', facts: 'Fakten erhalten' }
    : { format: 'Format', size: 'Size', recall: 'Word recall', facts: 'Facts kept' };
  const names = lang === 'de'
    ? { 'Markdown': 'Markdown', 'Ordinary PDF': 'Gewöhnliches PDF', 'Typographics Art PDF': 'Typographics-Art-PDF', 'Typographics Art as a flat image (OCR)': 'Typographics Art als flaches Bild (OCR)' } : {};
  const kb = (b) => (b >= 1048576 ? (b / 1048576).toFixed(2) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
  const rows = benefit.results.map((r) => `<tr><td style="color:var(--ink)">${names[r.name] || r.name}</td><td>${kb(r.bytes)}</td><td>${(r.wordRecall * 100).toFixed(r.wordRecall === 1 ? 0 : 1)}%</td><td>${r.factsFound}/${r.factsTotal}</td></tr>`).join('');
  document.querySelector('#benefitTable').innerHTML = `<thead><tr><th>${h.format}</th><th>${h.size}</th><th>${h.recall}</th><th>${h.facts}</th></tr></thead><tbody>${rows}</tbody>`;
}
const fmt = (n) => n.toLocaleString(lang === 'de' ? 'de-CH' : 'en-US');
function fillNumbers() {
  if (proof) {
    $('#n-chars').textContent = fmt(proof.poster.characters);
    $('#n-tests').textContent = `${proof.tests.filter((t) => t.pass).length}/${proof.tests.length}`;
    if (proof.vision) $('#n-vlm').textContent = `${Math.round(proof.vision.accuracy * proof.vision.words)}/${proof.vision.words}`;
  }
  if (examples) $('#n-ex').textContent = `${examples.filter((e) => e.readBack && e.readBack.visibleIdentical).length}/${examples.length}`;
}
Promise.all([fetch('demo/moby-dick/proof.json').then((r) => r.json()).catch(() => null), fetch('examples/index.json').then((r) => r.json()).catch(() => null)])
  .then(([p, e]) => { proof = p; examples = e; fillNumbers(); });
fetch('docs/ai-benefit.json').then((r) => r.json()).then((b) => { benefit = b; renderBenefit(); }).catch(() => { const s = $('#benefit'); if (s) s.hidden = true; });
setLang(lang);

// Zoom demo: the Douglass work (2.6 MB SVG) is inlined only when the section scrolls into view, so it
// never slows the first paint. Zooming reveals the top-left, which is the start of the text in reading order.
function initDemo() {
  const stage = $('#demoStage'); if (!stage) return;
  fetch('gallery/douglass.svg').then((r) => (r.ok ? r.text() : Promise.reject(new Error('fetch')))).then((raw) => {
    const svg = new DOMParser().parseFromString(raw, 'image/svg+xml').documentElement;
    if (svg.nodeName.toLowerCase() !== 'svg') throw new Error('not svg');
    svg.querySelectorAll('script,foreignObject').forEach((n) => n.remove());
    svg.querySelectorAll('*').forEach((el) => [...el.attributes].forEach((a) => { if (a.name.toLowerCase().startsWith('on')) el.removeAttribute(a.name); }));
    svg.removeAttribute('width'); svg.removeAttribute('height'); svg.style.width = '100%';
    stage.appendChild(document.importNode(svg, true));
    const s = stage.querySelector('svg');
    const opening = canonicalText(markupText(raw, 'svg')).slice(0, 240).replace(/\s+\S*$/, '');
    $('#demoSentence').textContent = opening + ' …';
    const setZoom = (z) => { s.style.transform = `scale(${z})`; $('#demoZoomV').textContent = (z < 9.95 ? z.toFixed(1) : Math.round(z)) + '×'; };
    let raf = null;
    $('#demoZoom').addEventListener('input', (e) => { if (raf) { cancelAnimationFrame(raf); raf = null; } setZoom(+e.target.value); });
    $('#demoPlay').addEventListener('click', () => {
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) { $('#demoZoom').value = 8; setZoom(8); return; }
      const t0 = performance.now(), ms = 3200;
      const step = (now) => { const k = Math.min(1, (now - t0) / ms); const z = 1 + 7 * (0.5 - 0.5 * Math.cos(Math.PI * k)); $('#demoZoom').value = z; setZoom(z); if (k < 1) raf = requestAnimationFrame(step); else raf = null; };
      raf = requestAnimationFrame(step);
    });
    setZoom(1);
  }).catch(() => { const sec = $('#demo'); if (sec) sec.hidden = true; });
}
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); initDemo(); } }, { rootMargin: '300px' });
  io.observe($('#demoStage'));
} else initDemo();
