# Aufgaben-Prompts: Design und Produkt

Diese Familie umfasst Aufgaben, bei denen ein Produkt aus Sicht der Menschen beurteilt oder beschrieben wird, die es benutzen: Bedienbarkeit prüfen, Barrierefreiheit prüfen, einen Nutzerablauf untersuchen und Produktanforderungen formulieren. Alle Prompts wenden die Arbeitsregeln dieser Bibliothek an. Besonders wichtig sind hier `regeln/unsicherheit.md` (eine Vermutung über das Verhalten von Nutzern ist keine Beobachtung), `regeln/quellen-und-belege.md` (Normen und Richtlinien werden mit Fassung und Abschnitt zitiert), `regeln/qualitaetspruefung.md` und `regeln/ausgabeformate.md`. Bei echten Nutzerdaten gilt zusätzlich `regeln/datenschutz.md`.

## Gemeinsame Vorgaben

- Ein Befund beschreibt, was ein Mensch erlebt („Die Fehlermeldung erscheint oberhalb des sichtbaren Bereichs, der Nutzer sieht nach dem Absenden keine Reaktion"), nicht eine Geschmacksfrage („wirkt altbacken").
- Jeder Befund nennt, wie er festgestellt wurde: selbst ausprobiert (mit Gerät, Browser, Hilfstechnik), aus Daten abgeleitet, aus einer Richtlinie gefolgert. Kennzeichnung nach `regeln/unsicherheit.md`: Belegt, Annahme, Schlussfolgerung, Offen.
- Befunde im Format Ort – Was passiert – Auslöser/Beleg – Vorschlag, mit Schweregrad (kritisch, hoch, mittel, niedrig, Hinweis) nach `regeln/ausgabeformate.md`.
- Barrierefreiheit richtet sich standardmässig nach WCAG 2.2, Stufe AA, sofern der Auftrag nichts anderes festlegt.
- Ändern am Produkt selbst gehört nicht zu diesen Aufgaben, ausser der Auftrag sagt es ausdrücklich.

## 1. Bedienbarkeit prüfen

### Ziel

Feststellen, wo Menschen eine konkrete Aufgabe im Produkt nicht, nur langsam oder nur mit Fehlern erledigen können, und diese Stellen so beschreiben, dass ein Team sie in der Reihenfolge ihrer Wirkung beheben kann.

### Eingaben

- Das Produkt oder ein bedienbarer Stand (URL einer Testumgebung, Build, klickbarer Prototyp) oder, wenn nichts davon verfügbar ist, Bildschirmfotos mit Beschreibung der Interaktion.
- Die zu prüfenden Nutzeraufgaben, jeweils mit Start und Ziel („Ein neuer Kunde legt ein Konto an und bestellt einen Artikel").
- Zielgruppe und Nutzungssituation (Gerät, Umgebung, Vorkenntnisse).
- Falls vorhanden: Nutzungsdaten, Supportanfragen, frühere Testergebnisse, Designsystem.

### Geltungsbereich

Nur die genannten Aufgaben und die Bildschirme auf ihrem Weg. Visuelle Gestaltung zählt nur, soweit sie die Bedienung beeinflusst. Barrierefreiheit wird vollständig erst mit Prompt 2 geprüft.

### Vorgehen

1. Schreibe jede Aufgabe als Schrittfolge auf, wie ein Nutzer sie erwartbar ausführt. Kriterium: Jeder Schritt hat ein beobachtbares Ende („Bestätigungsseite sichtbar").
2. Führe jede Aufgabe selbst aus, auf dem Hauptgerät der Zielgruppe und auf kleiner Bildschirmbreite. Kriterium: Je Schritt ist notiert, ob er gelang, wie viele Interaktionen er brauchte und was unklar war.
3. Prüfe jeden Schritt gegen diese Fragen: Ist erkennbar, was als Nächstes zu tun ist? Gibt das System innerhalb einer Sekunde eine sichtbare Rückmeldung? Lässt sich ein Fehler rückgängig machen? Werden Begriffe der Zielgruppe verwendet statt interner Begriffe? Muss sich der Nutzer etwas von einem früheren Bildschirm merken? Kriterium: Jede verneinte Frage wird ein Befundkandidat.
4. Provoziere Fehler: leere Pflichtfelder, ungültige Formate, Zurück-Taste, Neuladen mitten im Ablauf, doppelter Klick auf „Absenden". Kriterium: Je Fall ist notiert, ob der Nutzer erfährt, was passiert ist und wie er weiterkommt, und ob Daten verloren gehen.
5. Ziehe vorhandene Daten heran (Abbruchraten, Supportthemen). Kriterium: Datengestützte Befunde nennen Zahl und Quelle; andere bleiben als Beobachtung oder Schlussfolgerung gekennzeichnet.
6. Bewerte jeden Befund: kritisch (Aufgabe nicht lösbar oder Datenverlust), hoch (lösbar nur mit Umweg oder häufig mit Fehlern), mittel (spürbare Verzögerung oder Unsicherheit), niedrig (kleine Reibung), Hinweis. Kriterium: Die Einstufung ist mit einem Satz begründet.
7. Formuliere zu jedem Befund den kleinsten wirksamen Vorschlag. Kriterium: Der Vorschlag ist umsetzbar („Fehlermeldung unter dem Feld zeigen, Fokus darauf setzen"), nicht „Ablauf überdenken".

### Grenzen

Erlaubt ohne Rückfrage: Das Produkt in einer Test- oder Vorschauumgebung bedienen, Testkonten mit erfundenen Daten anlegen, Bildschirmfotos für den Bericht erstellen (Stufe 1 und 2 nach `regeln/berechtigungen.md`).

Nur mit Freigabe: Handlungen in einer Produktionsumgebung, die echte Wirkung haben (Bestellung, Zahlung, Versand von Nachrichten), Kontakt zu echten Nutzern, Auswertung personenbezogener Nutzungsdaten (Stufe 3).

Nie: Echte Kundendaten in Bildschirmfotos oder Berichte übernehmen, Ergebnisse von Nutzertests erfinden oder einen eigenen Durchlauf als „Nutzertest" ausgeben (Stufe 4).

### Ergebnisformat

1. Zusammenfassung in drei Sätzen: geprüfte Aufgaben, Zahl der Befunde je Schweregrad, wichtigste Einzelstelle.
2. Tabelle je Aufgabe: Schritt, gelungen ja/nein, Anzahl Interaktionen, Bemerkung.
3. Befundliste nach Schweregrad, je Befund: Ort – Was passiert – Auslöser/Beleg – Vorschlag, mit Kennzeichnung Belegt/Schlussfolgerung.
4. Abschlussbericht nach `regeln/ausgabeformate.md`, mit den nicht geprüften Geräten und Situationen unter „Nicht geprüft / Offen".

### Abschlusskriterien

- [ ] Jede genannte Aufgabe wurde selbst durchgeführt oder es ist begründet, warum nicht.
- [ ] Die Fehlerfälle aus Schritt 4 sind für jede Aufgabe geprüft.
- [ ] Jeder Befund hat Ort, Schweregrad, Beleg und einen konkreten Vorschlag.
- [ ] Kein Befund ist eine reine Geschmacksaussage.
- [ ] Eigene Durchläufe sind als solche bezeichnet, nicht als Beobachtung echter Nutzer.

### Bei fehlenden Informationen

Frage nach, wenn weder ein bedienbarer Stand noch Bildschirmfotos vorliegen oder wenn die zu prüfenden Aufgaben nicht genannt sind: Ohne beides lässt sich nichts prüfen. Fehlen Angaben zur Zielgruppe, arbeite weiter und schreibe sie auf, zum Beispiel „Annahme: Gelegenheitsnutzer ohne Vorkenntnisse, Smartphone als Hauptgerät". Fehlende Nutzungsdaten sind kein Grund anzuhalten; die Befunde werden dann ausdrücklich als Ergebnis eines Expertendurchlaufs gekennzeichnet.

## 2. Barrierefreiheit prüfen

### Ziel

Feststellen, ob Menschen mit Behinderungen die geprüften Seiten oder Bildschirme wahrnehmen, bedienen und verstehen können, gemessen an einem genannten Standard, und jede Abweichung so dokumentieren, dass sie nachvollziehbar und behebbar ist.

### Eingaben

- Der Prüfgegenstand: Liste der Seiten, Bildschirme oder Komponenten mit Zugang (URL, Build, Quellcode).
- Der Zielstandard; ohne Angabe gilt WCAG 2.2, Stufe AA.
- Unterstützte Plattformen (Browser, Betriebssysteme, Hilfstechnik), soweit festgelegt.
- Falls vorhanden: frühere Prüfberichte, Designsystem mit Farb- und Komponentenvorgaben.

### Geltungsbereich

Die genannten Seiten in allen erreichbaren Zuständen: Menüs, Dialoge, Fehlermeldungen, Ladezustände, leere Listen. Inhalte Dritter werden als solche gekennzeichnet. Eine rechtliche Bewertung (welche Pflicht für wen gilt) gehört nicht dazu.

### Vorgehen

1. Lege die Stichprobe fest: alle genannten Seiten, und je Seite die Zustände aus dem Geltungsbereich. Kriterium: Die Liste steht im Bericht, bevor geprüft wird.
2. Lass automatische Prüfwerkzeuge laufen und notiere Werkzeug und Version. Kriterium: Jeder automatische Fund ist von Hand bestätigt oder als Fehlalarm begründet; automatische Prüfungen gelten nie als vollständige Prüfung, weil sie nur einen Teil der Kriterien erfassen.
3. Bediene jede Seite nur mit der Tastatur. Kriterium: Alle Funktionen sind erreichbar (2.1.1), es gibt keine Tastaturfalle (2.1.2), die Reihenfolge ist logisch (2.4.3), der Fokus ist jederzeit sichtbar (2.4.7) und nicht vollständig verdeckt (2.4.11).
4. Prüfe mit mindestens einem Screenreader auf einer unterstützten Plattform. Kriterium: Jedes Bedienelement hat Name, Rolle und Zustand (4.1.2); Bilder mit Inhalt haben eine sinnvolle Textalternative, dekorative werden übersprungen (1.1.1); Überschriften, Listen und Tabellen sind als solche ausgezeichnet (1.3.1); Statusmeldungen werden angesagt, ohne den Fokus zu verschieben (4.1.3).
5. Miss Kontraste mit einem Werkzeug, nicht nach Augenmass. Kriterium: Text mindestens 4,5:1, grosser Text mindestens 3:1 (1.4.3); Bedienelemente und informative Grafiken mindestens 3:1 (1.4.11); Information wird nicht nur über Farbe vermittelt (1.4.1).
6. Prüfe Vergrösserung und Umbruch. Kriterium: Text auf 200 % vergrössert ohne Funktionsverlust (1.4.4); bei 320 CSS-Pixeln Breite kein waagrechtes Scrollen für Fliesstext (1.4.10); Klickziele mindestens 24 × 24 CSS-Pixel oder mit ausreichendem Abstand (2.5.8).
7. Prüfe Formulare. Kriterium: Jedes Feld hat eine sichtbare Beschriftung oder Anleitung (3.3.2); Fehler werden in Text benannt (3.3.1); bereits eingegebene Angaben müssen im selben Ablauf nicht erneut eingegeben werden (3.3.7); die Anmeldung verlangt keinen Gedächtnis- oder Rätseltest ohne Alternative (3.3.8).
8. Prüfe Zeit und Bewegung. Kriterium: Zeitlimits lassen sich verlängern oder abschalten (2.2.1); nichts blitzt mehr als dreimal pro Sekunde (2.3.1); die Seitensprache ist ausgezeichnet (3.1.1).
9. Ordne jeden Befund genau einem Erfolgskriterium zu, mit Nummer und Name aus der genannten WCAG-Fassung. Kriterium: Keine Nummer wird aus dem Gedächtnis zitiert, ohne sie gegen den Normtext geprüft zu haben (`regeln/quellen-und-belege.md`).

### Grenzen

Erlaubt ohne Rückfrage: Seiten lesen und bedienen, Werkzeuge im Browser ausführen, Quellcode lesen, Testformulare mit erfundenen Daten absenden (Stufe 1 und 2 nach `regeln/berechtigungen.md`).

Nur mit Freigabe: Korrekturen am Code oder an Inhalten vornehmen, Prüfungen gegen Produktionssysteme mit echter Wirkung, Tests mit Menschen mit Behinderungen organisieren (Stufe 3).

Nie: Eine Konformitätserklärung oder ein „barrierefrei"-Siegel ausstellen, Ergebnisse von Tests mit Betroffenen erfinden, ein automatisches Prüfergebnis als vollständige Prüfung ausgeben (Stufe 4).

### Ergebnisformat

1. Prüfumfang: Stichprobe, Standard mit Fassung und Stufe, Werkzeuge mit Version, verwendete Hilfstechnik mit Plattform.
2. Übersicht: Zahl der Befunde je Schweregrad und je Prinzip (wahrnehmbar, bedienbar, verständlich, robust).
3. Befundliste: Erfolgskriterium (Nummer und Name) – Ort (Seite, Element, Zustand) – Was passiert – Wie festgestellt – Vorschlag – Schweregrad. Kritisch ist, was eine Gruppe von Nutzern von einer Kernfunktion ausschliesst.
4. Liste der geprüften Kriterien ohne Befund, damit erkennbar ist, was geprüft wurde.
5. Abschlussbericht nach `regeln/ausgabeformate.md`.

### Abschlusskriterien

- [ ] Stichprobe, Standard, Werkzeuge und Hilfstechnik sind im Bericht genannt.
- [ ] Tastatur-, Screenreader-, Kontrast-, Vergrösserungs- und Formularprüfung sind durchgeführt oder als nicht durchgeführt aufgeführt.
- [ ] Jeder Befund ist genau einem geprüften Erfolgskriterium zugeordnet.
- [ ] Automatische Funde sind von Hand bestätigt oder als Fehlalarm begründet.
- [ ] Der Bericht behauptet keine Konformität, sondern beschreibt das Ergebnis der Stichprobe.

### Bei fehlenden Informationen

Frage nach, wenn der Prüfgegenstand nicht zugänglich ist oder unklar bleibt, welche Seiten gemeint sind. Fehlt der Zielstandard, arbeite weiter mit „Annahme: WCAG 2.2, Stufe AA". Fehlen Angaben zu unterstützter Hilfstechnik, wähle eine verbreitete Kombination aus Browser und Screenreader, nenne sie und kennzeichne alle anderen Kombinationen als Offen. Ohne Screenreader prüfe den Barrierefreiheitsbaum des Browsers und schreibe ausdrücklich, dass kein Screenreader-Durchlauf stattfand.

## 3. Nutzerablauf untersuchen

### Ziel

Einen Ablauf von seinem Auslöser bis zum erreichten Ziel vollständig beschreiben, einschliesslich aller Abzweigungen, Fehlerwege und Übergänge zwischen Kanälen, und die Stellen benennen, an denen Nutzer abbrechen, warten oder Hilfe brauchen.

### Eingaben

- Der zu untersuchende Ablauf mit Auslöser und Ziel („Passwort vergessen bis erfolgreiche Anmeldung").
- Zugang zum Produkt oder Prototyp; ersatzweise Spezifikationen, Ablaufdiagramme, Bildschirmfotos.
- Falls vorhanden: Messdaten pro Schritt (Aufrufe, Abbrüche, Dauer), Supportanfragen, Aussagen aus Nutzerinterviews.
- Beteiligte Kanäle ausserhalb des Produkts (E-Mail, SMS, Telefon, Filiale).

### Geltungsbereich

Der genannte Ablauf vom Auslöser bis zum Ziel und alle Wege, die von ihm abzweigen und wieder zurückführen oder abbrechen. Systeme ausserhalb des Produkts werden als Übergänge beschrieben, nicht im Detail geprüft.

### Vorgehen

1. Beschreibe den Hauptweg als nummerierte Schritte mit Bildschirm oder Kanal, Handlung des Nutzers und Reaktion des Systems. Kriterium: Jemand ohne Produktkenntnis kann ihn nachgehen.
2. Ergänze alle Abzweigungen: Fehleingaben, abgelaufene Links, fehlende Berechtigung, Gerätewechsel, Abbruch und Wiederaufnahme. Kriterium: Für jeden Schritt ist mindestens die Frage „Was, wenn das scheitert?" beantwortet.
3. Gehe den Hauptweg und mindestens drei Abzweigungen selbst durch. Kriterium: Abweichungen zwischen Spezifikation und tatsächlichem Verhalten sind als Befund notiert.
4. Markiere Wartezeiten und Kanalwechsel (z. B. „wartet auf E-Mail"). Kriterium: Je Kanalwechsel ist geprüft, was bei ausbleibender oder verspäteter Nachricht passiert.
5. Lege vorhandene Messdaten auf die Schritte. Kriterium: Jede Zahl hat Quelle und Zeitraum; wo keine Daten vorliegen, steht „Offen" statt einer Schätzung.
6. Benenne die Stellen mit dem grössten Verlust oder Aufwand. Kriterium: Jede Stelle ist mit Daten belegt oder als Schlussfolgerung mit Herleitung gekennzeichnet.

### Grenzen

Erlaubt ohne Rückfrage: Ablauf in Test- oder Vorschauumgebungen durchspielen, eigene Testkonten verwenden, Diagramme und Beschreibungen anlegen (Stufe 1 und 2 nach `regeln/berechtigungen.md`).

Nur mit Freigabe: Echte Nachrichten an echte Adressen auslösen, Daten einzelner Nutzer auswerten, Abläufe in Produktion mit Wirkung durchführen (Stufe 3).

Nie: Einzelne Nutzer in Bericht oder Beispielen erkennbar machen, Interviewaussagen erfinden oder zuspitzen, Sicherheitsabfragen umgehen, um einen Ablauf schneller zu durchlaufen (Stufe 4, `regeln/datenschutz.md`).

### Ergebnisformat

1. Ablaufbeschreibung: Hauptweg als nummerierte Liste, Abzweigungen als Unterpunkte; optional ein Diagramm in Textform (z. B. Mermaid), wenn das Ausgabeziel es darstellen kann.
2. Tabelle der Schritte mit Kanal, Wartezeit, Messdaten (oder Offen) und Auffälligkeiten.
3. Befundliste im Format Ort – Was passiert – Auslöser/Beleg – Vorschlag, mit Schweregrad.
4. Abschlussbericht nach `regeln/ausgabeformate.md`.

### Abschlusskriterien

- [ ] Hauptweg und alle Abzweigungen sind beschrieben, jeder Schritt mit Handlung und Systemreaktion.
- [ ] Mindestens drei Abzweigungen wurden selbst durchgespielt oder es ist begründet, warum nicht.
- [ ] Jeder Kanalwechsel hat einen beschriebenen Fehlerfall.
- [ ] Jede Zahl hat Quelle und Zeitraum; keine geschätzte Zahl ist als Messung dargestellt.
- [ ] Abweichungen zwischen Spezifikation und Verhalten sind als Befunde aufgeführt.

### Bei fehlenden Informationen

Frage nach, wenn Auslöser oder Ziel des Ablaufs unklar sind; ein Ablauf ohne Ende lässt sich nicht untersuchen. Fehlt der Zugang zum Produkt, arbeite mit den Unterlagen weiter und kennzeichne alles als „Annahme: Verhalten laut Spezifikation, nicht beobachtet". Fehlen Messdaten, beschreibe den Ablauf vollständig und führe die Datenlücke unter „Nicht geprüft / Offen" auf, statt Abbruchraten zu schätzen.

## 4. Produktanforderungen formulieren

### Ziel

Aus einem Problem, einem Wunsch oder einer Idee eine Anforderungsbeschreibung machen, die ein Team ohne weitere Rückfragen planen, umsetzen und abnehmen kann: mit Problem, Zielgruppe, messbarem Ziel, Umfang, Abnahmekriterien und offenen Fragen.

### Eingaben

- Die Ausgangslage: Problem, Anfrage, Idee, Gesprächsnotizen.
- Bekannte Randbedingungen: Termine, Budget, Technik, rechtliche Vorgaben, bestehende Produktteile.
- Falls vorhanden: Nutzerforschung, Messdaten, Supportanfragen, Vorlage für Anforderungsdokumente.

### Geltungsbereich

Das beschriebene Problem und seine Lösung auf Ebene des Verhaltens: was Nutzer tun können und was das System dafür leisten muss. Technische Umsetzung, Architektur und Aufwandsschätzung gehören nicht dazu, ausser der Auftrag verlangt sie; dann werden sie getrennt aufgeführt.

### Vorgehen

1. Formuliere das Problem in einem Satz aus Sicht der Betroffenen, ohne Lösung darin. Kriterium: Der Satz enthält wer, was nicht geht und welche Folge das hat. Schlecht: „Wir brauchen einen Export-Knopf." Gut: „Buchhalterinnen übertragen Rechnungsdaten monatlich von Hand in ihr System und brauchen dafür einen halben Tag."
2. Beschreibe Zielgruppe und Nutzungssituation. Kriterium: Mindestens eine Gruppe ist ausdrücklich ausgeschlossen.
3. Lege ein messbares Ziel fest, mit Messgrösse, Ausgangswert (oder Offen) und Zielwert. Kriterium: Nach der Einführung lässt sich ohne Diskussion feststellen, ob das Ziel erreicht ist.
4. Schreibe die Anforderungen als nummerierte, einzeln prüfbare Aussagen („Das System …", „Nutzer können …"). Kriterium: Jede Anforderung enthält genau eine Aussage und kein Wort wie „schnell", „einfach" oder „intuitiv" ohne Messgrösse.
5. Ordne jeder Anforderung eine Priorität zu (muss, soll, kann) und führe unter „Nicht Teil dieses Vorhabens" auf, was ausdrücklich nicht gebaut wird. Kriterium: Jeder Punkt aus der Ausgangslage ist entweder eine Anforderung oder steht unter „Nicht Teil".
6. Formuliere Abnahmekriterien je Muss-Anforderung, einschliesslich Fehlerfällen, Barrierefreiheit (Standard: WCAG 2.2 AA) und Datenschutz. Kriterium: Jedes Kriterium ist als Test mit Ausgangslage, Handlung und erwartetem Ergebnis beschreibbar.
7. Prüfe die Anforderungen gegeneinander und gegen die Randbedingungen. Kriterium: Widersprüche sind aufgelöst oder als offene Frage mit den betroffenen Nummern aufgeführt.
8. Trenne Herkunft und Gewissheit. Kriterium: Jede Aussage über Nutzerbedürfnisse ist als Belegt (mit Quelle), Annahme oder Schlussfolgerung gekennzeichnet (`regeln/unsicherheit.md`).

### Grenzen

Erlaubt ohne Rückfrage: Vorhandene Unterlagen lesen, Entwürfe des Anforderungsdokuments anlegen und überarbeiten, Rückfragen formulieren (Stufe 1 und 2 nach `regeln/berechtigungen.md`).

Nur mit Freigabe: Das Dokument an Kunden oder ausserhalb des Teams versenden, Tickets in einem gemeinsamen Planungssystem anlegen, Zusagen zu Terminen oder Umfang machen (Stufe 3).

Nie: Nutzerforschung, Zitate oder Messwerte erfinden, um eine Anforderung zu begründen; Entscheidungen über Prioritäten als bereits getroffen darstellen, wenn sie nur vorgeschlagen sind (Stufe 4).

### Ergebnisformat

Ein Dokument mit diesen Abschnitten: Problem · Zielgruppe und Situation · Ziel und Messgrösse · Anforderungen (nummeriert, mit Priorität) · Nicht Teil dieses Vorhabens · Abnahmekriterien · Randbedingungen · Annahmen · Offene Fragen (mit Ansprechpartner, falls bekannt). Dazu ein kurzer Abschlussbericht nach `regeln/ausgabeformate.md`, der nennt, welche Teile auf Annahmen beruhen.

### Abschlusskriterien

- [ ] Das Problem ist ohne Lösung formuliert.
- [ ] Das Ziel hat Messgrösse und Zielwert.
- [ ] Jede Anforderung ist einzeln prüfbar und priorisiert.
- [ ] Jede Muss-Anforderung hat mindestens ein Abnahmekriterium, einschliesslich eines Fehlerfalls.
- [ ] Jeder Punkt der Ausgangslage ist zugeordnet: Anforderung oder „Nicht Teil".
- [ ] Annahmen und offene Fragen sind getrennt aufgeführt.

### Bei fehlenden Informationen

Frage nach, wenn das Problem selbst unklar ist oder wenn zwei Ausgangsdokumente sich in der Zielsetzung widersprechen: Das kann nur der Auftraggeber entscheiden. Fehlen Zielwerte, Zielgruppenangaben oder Randbedingungen, schreibe das Dokument trotzdem vollständig und setze an die Stelle „Annahme: …" mit einem begründeten Vorschlag, zum Beispiel „Annahme: Export im CSV-Format genügt, weil die genannten Buchhaltungssysteme CSV einlesen". Jede solche Annahme erscheint zusätzlich unter „Offene Fragen".
