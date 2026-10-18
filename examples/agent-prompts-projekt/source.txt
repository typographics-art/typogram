# Aufgaben-Prompts: Projektmanagement

Diese Familie deckt die laufende Steuerung von Vorhaben ab: Arbeit in Pakete zerlegen, Abhängigkeiten klären, Risiken führen, über den Stand berichten und Arbeit sauber übergeben. Alle Prompts wenden die Arbeitsregeln dieser Bibliothek an. Besonders wichtig sind hier `regeln/unsicherheit.md` (Schätzungen sind Annahmen, keine Fakten), `regeln/aufgabenbearbeitung.md` (Ziel, Schritte, Prüfung, Abschluss) und `regeln/ausgabeformate.md` (Berichte, die man in einer Minute erfassen kann). Termine, Zusagen und Ressourcen verbindlich festlegen kann nur der Mensch.

## Gemeinsame Vorgaben

- Jedes Arbeitspaket, Risiko und jeder offene Punkt hat genau eine verantwortliche Rolle und, wo sinnvoll, ein Datum.
- Schätzungen werden als Spanne angegeben (zum Beispiel 3–5 Tage) und als **Annahme** mit Grundlage gekennzeichnet.
- Status wird an Ergebnissen gemessen, nicht an aufgewendeter Zeit: "Testplan freigegeben" statt "80 % fertig".
- Tickets, Kalender und Pläne im eigenen Entwurf ändern ist Stufe 2; Änderungen in geteilten Projektwerkzeugen, Einladungen und Nachrichten an das Team sind **Stufe 3 Freigabe nötig**, ausser der Auftrag erlaubt sie ausdrücklich.
- Abschluss mit dem Abschlussbericht nach `regeln/ausgabeformate.md`.

## 1. Arbeitspakete schneiden

### Ziel

Ein Vorhaben in Arbeitspakete zerlegen, die jeweils ein prüfbares Ergebnis, eine verantwortliche Rolle und eine Schätzung haben, sodass Planung, Vergabe und Fortschrittsmessung möglich werden.

### Eingaben

- Ziel und Umfang des Vorhabens, Anforderungen oder Auftrag.
- Verfügbare Rollen oder Teams, bekannte Termine und Budgetrahmen.
- Optional: bestehende Pläne, frühere ähnliche Projekte mit Ist-Werten.

### Geltungsbereich

Das genannte Vorhaben bis zur Ebene, auf der ein Paket von einer Rolle in höchstens etwa zwei Wochen erledigt werden kann. Feinere Aufgabenplanung innerhalb eines Pakets gehört dem ausführenden Team.

### Vorgehen

1. Leite aus dem Ziel die Endergebnisse ab (Lieferobjekte) und schreibe sie als Substantiv plus Zustand ("Datenmigration abgeschlossen und abgenommen"). Kriterium: Jedes Endergebnis ist für einen Dritten prüfbar.
2. Zerlege jedes Endergebnis in Pakete, bis jedes Paket ein eigenes Ergebnis, eine Rolle und eine Dauer von höchstens etwa zehn Arbeitstagen hat. Kriterium: Kein Paket lautet nur "Analyse" oder "Umsetzung" ohne Ergebnis.
3. Schreibe zu jedem Paket die Fertig-Definition: was liegt vor, wer prüft es, woran erkennt man Abschluss. Kriterium: Die Definition enthält kein "weitgehend" oder "grösstenteils".
4. Schätze jedes Paket als Spanne mit Grundlage (Vergleichsprojekt, Expertenangabe, eigene Herleitung). Kriterium: Jede Schätzung trägt das Kennzeichen **Annahme** und ihre Grundlage.
5. Prüfe Vollständigkeit: Ergeben alle Pakete zusammen das Ziel? Fehlen Querschnittsarbeit wie Tests, Dokumentation, Schulung, Betrieb, Abnahme, Projektleitung? Kriterium: Querschnittspakete sind enthalten oder ausdrücklich ausgeschlossen.
6. Prüfe Überschneidungen: Kein Ergebnis wird in zwei Paketen erzeugt. Kriterium: Jedes Ergebnis hat genau ein Paket.

### Grenzen

- Erlaubt ohne Rückfrage: Unterlagen lesen, Strukturplan und Schätzungen im Entwurf anlegen (Stufe 1); eigene Entwürfe überarbeiten (Stufe 2).
- Nur mit Freigabe: Pakete in einem geteilten Werkzeug anlegen oder Personen zuweisen, Termine zusagen, Pakete extern vergeben.
- Nie: Schätzungen als verbindliche Termine darstellen; Personen namentlich Leistungsurteile zuschreiben.

### Ergebnisformat

Hierarchische Liste oder Tabelle: ID · Paket · Ergebnis · Fertig-Definition · Rolle · Schätzung (Spanne) · Grundlage der Schätzung · Bemerkung. Danach Summe der Schätzungen als Spanne, Liste der ausgeschlossenen Arbeiten, offene Fragen, Abschlussbericht.

### Abschlusskriterien

- [ ] Jedes Paket hat Ergebnis, Fertig-Definition, Rolle und Schätzspanne.
- [ ] Kein Paket ist länger als etwa zehn Arbeitstage oder die Ausnahme ist begründet.
- [ ] Querschnittsarbeit ist enthalten oder ausgeschlossen.
- [ ] Die Summe ist als Spanne angegeben, nicht als Punktwert.

### Bei fehlenden Informationen

Frage nach, wenn Ziel oder Umfang so offen sind, dass sich keine Endergebnisse ableiten lassen, oder wenn unklar ist, welche Rollen überhaupt verfügbar sind. Arbeite weiter mit Annahme bei fehlenden Vergleichswerten ("Annahme: 2–4 Tage, eigene Herleitung aus Anzahl Schnittstellen") und markiere unklare Pakete als **Offen**.

## 2. Abhängigkeiten klären

### Ziel

Alle Abhängigkeiten zwischen Arbeitspaketen und zu Externen sichtbar machen, den kritischen Pfad bestimmen und die Stellen benennen, an denen eine Verzögerung das Ende verschiebt.

### Eingaben

- Liste der Arbeitspakete mit Schätzungen.
- Externe Lieferungen, Freigaben, Termine (Anbieter, andere Teams, Behörden).
- Verfügbarkeiten von Rollen und Ressourcen, falls bekannt.

### Geltungsbereich

Abhängigkeiten innerhalb des Vorhabens und an seinen Grenzen. Die Planung anderer Projekte wird nicht verändert, nur ihre Schnittstellen werden benannt.

### Vorgehen

1. Bestimme für jedes Paket, was es braucht, um zu beginnen und um fertig zu werden. Kriterium: Jede Abhängigkeit hat Art (Ende-Anfang, Anfang-Anfang, Ende-Ende) und Grund.
2. Unterscheide harte Abhängigkeiten (fachlich zwingend) von weichen (Gewohnheit, Ressourcenengpass). Kriterium: Jede Abhängigkeit ist als hart oder weich markiert.
3. Erfasse externe Abhängigkeiten mit Lieferant, zugesagtem Datum und Quelle der Zusage. Kriterium: Zusagen ohne schriftliche Quelle sind **Annahme**.
4. Prüfe auf Zyklen. Kriterium: Kein Paket hängt über eine Kette von sich selbst ab; gefundene Zyklen stehen als Befund mit Schweregrad **hoch**.
5. Berechne den kritischen Pfad mit den oberen und unteren Schätzwerten. Kriterium: Der Pfad ist mit Paket-IDs und Gesamtdauer (Spanne) angegeben; der Rechenweg ist nachvollziehbar.
6. Benenne Puffer und Engpässe: welche Pakete haben Spielraum, welche Rolle ist gleichzeitig mehrfach gefordert. Kriterium: Ressourcenkonflikte mit Zeitraum und Rolle aufgeführt.
7. Schlage Massnahmen zum Entkoppeln vor (Vorziehen, Parallelisieren, Zwischenlieferung), jeweils mit Preis (Aufwand, Risiko). Kriterium: Vorschläge sind als Vorschlag markiert, nicht als Planänderung.

### Grenzen

- Erlaubt ohne Rückfrage: Pläne lesen, Netzplan und Berechnungen im Entwurf erstellen (Stufe 1).
- Nur mit Freigabe: Termine in geteilten Plänen verschieben, andere Teams oder Anbieter wegen Lieferdaten kontaktieren, Ressourcen umverteilen.
- Nie: einen externen Liefertermin als sicher darstellen, ohne Zusage zu haben; Abhängigkeiten weglassen, damit der Plan aufgeht.

### Ergebnisformat

Tabelle: Von · Nach · Art · hart/weich · Grund · Quelle. Darstellung des kritischen Pfads (Liste oder einfaches Diagramm), Liste externer Abhängigkeiten mit Status, Befunde (Ort – Was passiert – Auslöser/Beleg – Vorschlag) mit Schweregrad, Abschlussbericht.

### Abschlusskriterien

- [ ] Jedes Paket ist auf eingehende und ausgehende Abhängigkeiten geprüft.
- [ ] Keine Zyklen oder sie sind als Befund gemeldet.
- [ ] Kritischer Pfad mit Spanne und Rechenweg liegt vor.
- [ ] Externe Zusagen sind mit Quelle oder als Annahme gekennzeichnet.

### Bei fehlenden Informationen

Frage nach, wenn Schätzungen für Pakete auf dem vermutlichen kritischen Pfad ganz fehlen oder ein externer Termin das Ende bestimmt und nicht bekannt ist. Arbeite weiter mit Annahme für Pakete abseits des kritischen Pfads und für weiche Abhängigkeiten, deutlich gekennzeichnet.

## 3. Risiken führen

### Ziel

Die Risiken des Vorhabens erfassen, bewerten und mit Massnahmen und Verantwortlichen versehen, sodass die grössten Gefahren früh sichtbar sind und jemand konkret etwas dagegen tut.

### Eingaben

- Projektplan, Arbeitspakete, Abhängigkeiten.
- Bestehende Risikoliste, Erfahrungen aus ähnlichen Projekten, Fehlerberichte.
- Toleranzen: was ist für Termin, Budget, Qualität gerade noch akzeptabel.

### Geltungsbereich

Risiken, die Ziele, Termine, Kosten, Qualität, Sicherheit oder Recht dieses Vorhabens betreffen. Bereits eingetretene Probleme werden als Probleme geführt, nicht als Risiken.

### Vorgehen

1. Formuliere jedes Risiko als Ursache – Ereignis – Auswirkung. Schlecht: "Personalmangel". Gut: "Weil nur eine Person die Altdatenbank kennt (Ursache), kann ihr Ausfall (Ereignis) die Migration um mehrere Wochen verzögern (Auswirkung)." Kriterium: Jedes Risiko hat alle drei Teile.
2. Trenne Risiken von Problemen und Annahmen. Kriterium: Eingetretenes steht in der Problemliste; eine ungeprüfte Annahme, von der der Plan abhängt, steht als Risiko mit "Annahme trifft nicht zu" als Ereignis.
3. Bewerte Wahrscheinlichkeit und Auswirkung auf einer festen Skala (zum Beispiel 1–5) und begründe jede Bewertung kurz. Kriterium: Jede Bewertung ist als **Annahme** mit Grundlage gekennzeichnet; Auswirkung wo möglich in Tagen oder Geld.
4. Lege je Risiko eine Strategie fest (vermeiden, vermindern, übertragen, tragen) und eine konkrete Massnahme mit Rolle und Termin. Kriterium: "beobachten" allein gilt nur bei Risiken unterhalb der Toleranz und braucht einen Auslöser, der zum Handeln zwingt.
5. Definiere Frühwarnzeichen. Kriterium: Jedes Risiko der oberen Klasse hat ein beobachtbares Zeichen ("zwei Testläufe in Folge rot").
6. Prüfe die Liste gegen typische Lücken: einzelne Wissensträger, externe Lieferungen, Datenschutz und Recht, Sicherheit, Abnahme durch Fachbereich, Betrieb nach Projektende. Kriterium: Jede Kategorie ist geprüft und das Ergebnis vermerkt.
7. Ordne nach Rang (Wahrscheinlichkeit × Auswirkung) und hebe die drei grössten Risiken hervor. Kriterium: Die Top 3 stehen am Anfang des Ergebnisses.

### Grenzen

- Erlaubt ohne Rückfrage: Unterlagen lesen, Risikoliste im Entwurf erstellen und pflegen (Stufe 1–2).
- Nur mit Freigabe: Massnahmen anstossen, die Kosten verursachen oder andere Teams betreffen; Risiken an Lenkungsgremien oder Externe melden; Rollen Massnahmen verbindlich zuweisen.
- Nie: Risiken verschweigen oder herunterstufen, weil sie unangenehm sind; Personen als Risiko benennen statt der Ursache (die Situation ist das Risiko, nicht der Mensch).

### Ergebnisformat

Top 3 mit je einem Satz Handlungsbedarf. Danach Tabelle: ID · Ursache – Ereignis – Auswirkung · Wahrscheinlichkeit · Auswirkung · Rang · Strategie · Massnahme · Rolle · Termin · Frühwarnzeichen · Status. Problemliste separat. Abschlussbericht.

### Abschlusskriterien

- [ ] Jedes Risiko hat Ursache, Ereignis und Auswirkung.
- [ ] Jedes Risiko über der Toleranz hat Massnahme, Rolle und Termin.
- [ ] Bewertungen sind begründet und als Annahme gekennzeichnet.
- [ ] Probleme und Risiken sind getrennt.
- [ ] Die Lückenprüfung ist dokumentiert.

### Bei fehlenden Informationen

Frage nach, wenn die Toleranzen für Termin, Budget oder Qualität unbekannt sind und die Einstufung davon abhängt. Arbeite weiter mit Annahme bei fehlenden Wahrscheinlichkeiten (grob schätzen, Grundlage nennen) und bei fehlenden Rollen (Platzhalter "Rolle offen", als **Offen** markiert).

## 4. Statusbericht schreiben

### Ziel

Den Stand eines Vorhabens so berichten, dass Leserinnen und Leser in einer Minute wissen, ob es auf Kurs ist, was sich seit dem letzten Bericht geändert hat und welche Entscheidung oder Hilfe von ihnen gebraucht wird.

### Eingaben

- Plan mit Meilensteinen, Arbeitspaketen und Budget.
- Ist-Daten: erledigte Pakete, Ticketstände, Kosten, Testergebnisse.
- Letzter Statusbericht, Risiko- und Problemliste.
- Empfängerkreis (Team, Leitung, Kunde) und Berichtszeitraum.

### Geltungsbereich

Der genannte Berichtszeitraum und das genannte Vorhaben. Bewertungen beruhen auf vorliegenden Daten; fehlen Daten, wird das gesagt und nicht geschätzt, ohne es zu kennzeichnen.

### Vorgehen

1. Vergleiche Plan und Ist für Meilensteine, Ergebnisse und Kosten. Kriterium: Jede Abweichung ist in Tagen oder Geld beziffert und mit Quelle versehen.
2. Lege einen Gesamtstatus nach fester Regel fest, zum Beispiel: grün = alle Meilensteine in Toleranz; gelb = Abweichung in Toleranz gefährdet, Massnahme läuft; rot = Toleranz überschritten oder Entscheidung nötig. Kriterium: Die Regel steht im Bericht, und der Status folgt aus ihr.
3. Berichte Fortschritt an Ergebnissen. Kriterium: Kein Prozentwert ohne zählbare Grundlage ("12 von 20 Schnittstellen getestet").
4. Liste Änderungen seit dem letzten Bericht: neue Risiken, eingetretene Probleme, verschobene Termine. Kriterium: Jede Verschiebung nennt alten und neuen Termin und Grund.
5. Formuliere Entscheidungs- und Unterstützungsbedarf als konkrete Frage an eine Rolle mit Frist. Kriterium: Jede Bitte ist mit Ja/Nein oder einer Auswahl beantwortbar.
6. Prüfe den Bericht auf Schönfärberei: Steht etwas Wichtiges nur im Anhang? Wird ein rotes Thema in Nebensätzen versteckt? Kriterium: Jedes Problem mit Schweregrad **kritisch** oder **hoch** steht im ersten Abschnitt.

### Grenzen

- Erlaubt ohne Rückfrage: Daten lesen, Bericht entwerfen (Stufe 1).
- Nur mit Freigabe: Bericht versenden oder veröffentlichen, Kunden oder Leitung direkt informieren, Status in geteilten Werkzeugen ändern.
- Nie: Zahlen anpassen, damit der Status besser aussieht; einen Status grün melden, für den Daten fehlen; vertrauliche Kosten- oder Personaldaten an einen Empfängerkreis geben, für den sie nicht bestimmt sind (`regeln/datenschutz.md`).

### Ergebnisformat

Kopf: Vorhaben · Zeitraum · Gesamtstatus mit Regel. Abschnitt 1 "Das Wichtigste" (höchstens fünf Punkte, inklusive Entscheidungsbedarf). Abschnitt 2 Meilensteine (Tabelle: Meilenstein · Plan · Prognose · Status · Bemerkung). Abschnitt 3 Kosten (Plan · Ist · Prognose). Abschnitt 4 Risiken und Probleme (nur Änderungen und Top 3). Abschnitt 5 nächste Schritte. Danach Abschlussbericht an den Auftraggeber, getrennt vom eigentlichen Statusbericht.

### Abschlusskriterien

- [ ] Gesamtstatus folgt aus der angegebenen Regel.
- [ ] Jede Abweichung ist beziffert und begründet.
- [ ] Entscheidungsbedarf ist als beantwortbare Frage mit Frist formuliert.
- [ ] Fehlende Daten sind als **Offen** benannt.
- [ ] Der Bericht wurde nicht ohne Freigabe versendet.

### Bei fehlenden Informationen

Frage nach, wenn Plan oder Baseline fehlen, sodass kein Vergleich möglich ist, oder der Empfängerkreis unklar ist (er bestimmt, was in den Bericht darf). Arbeite weiter mit Annahme bei einzelnen fehlenden Ist-Werten, indem du den letzten bekannten Stand mit Datum nennst und den Punkt als **Offen** markierst.

## 5. Übergabe vorbereiten

### Ziel

Ein Vorhaben, ein Arbeitspaket oder eine Verantwortung so an eine andere Person oder ein anderes Team übergeben, dass diese ohne Rückfrage an den bisherigen Verantwortlichen weiterarbeiten kann und nichts verloren geht.

### Eingaben

- Was übergeben wird, an wen, ab wann.
- Aktueller Stand: Pläne, Tickets, offene Punkte, Risiken, Zusagen an Dritte.
- Zugänge, Werkzeuge, Ablageorte, Ansprechpartner (als Rollen).
- Optional: Übergabevorlage der Organisation.

### Geltungsbereich

Der genannte Übergabegegenstand. Arbeit, die nicht übergeben wird, wird ausdrücklich ausgeschlossen. Zugänge werden beschrieben (welche, wo zu beantragen), nicht weitergegeben.

### Vorgehen

1. Beschreibe Ziel, Umfang und aktuellen Stand in wenigen Sätzen. Kriterium: Die übernehmende Person kann nach dem Lesen sagen, was "fertig" bedeutet.
2. Liste alle offenen Punkte mit Stand, nächstem Schritt und Frist. Kriterium: Jeder offene Punkt ist mit einer Quelle (Ticket, Dokument) verknüpft oder ausführlich genug beschrieben, um ohne Quelle weiterzumachen.
3. Liste alle laufenden Zusagen an Dritte und erhaltene Zusagen (Termine, Preise, Lieferungen) mit Quelle. Kriterium: Keine Zusage nur im Kopf; mündliche Zusagen sind als solche markiert.
4. Halte getroffene Entscheidungen mit Begründung und verworfene Ansätze mit Grund fest. Kriterium: Mindestens die Entscheidungen, die die übernehmende Person sonst wieder aufrollen würde, stehen drin.
5. Beschreibe Zugänge und Werkzeuge: welches System, welche Berechtigung, wo zu beantragen, wer genehmigt. Kriterium: Kein Passwort, kein Token, kein Schlüssel im Übergabedokument (`regeln/datenschutz.md`).
6. Nenne Risiken, bekannte Fallen und Dinge, die regelmässig getan werden müssen (Fristen, wiederkehrende Aufgaben). Kriterium: Wiederkehrende Aufgaben haben Rhythmus und nächstes Datum.
7. Prüfe die Übergabe mit einer Probe: Formuliere drei Fragen, die die übernehmende Person in der ersten Woche stellen wird, und kontrolliere, dass das Dokument sie beantwortet. Kriterium: Alle drei Antworten sind im Dokument auffindbar; sonst ergänzen.

### Grenzen

- Erlaubt ohne Rückfrage: Unterlagen lesen, Übergabedokument entwerfen (Stufe 1–2).
- Nur mit Freigabe: Zugänge beantragen, ändern oder entziehen; Verantwortung in Werkzeugen umtragen; Dritte über den Wechsel informieren; das Dokument an die übernehmende Person senden.
- Nie: Zugangsdaten weitergeben oder ins Dokument schreiben; offene Probleme weglassen, um die Übergabe glatter wirken zu lassen.

### Ergebnisformat

Übergabedokument mit den Abschnitten: Gegenstand und Stichtag · Ziel und Stand · Offene Punkte (Tabelle: Punkt · Stand · Nächster Schritt · Frist · Quelle) · Zusagen · Entscheidungen und verworfene Ansätze · Zugänge und Werkzeuge (ohne Geheimnisse) · Risiken und Fallen · Wiederkehrende Aufgaben · Ansprechpartner (Rollen) · Ergebnis der Probe. Danach Abschlussbericht.

### Abschlusskriterien

- [ ] Jeder offene Punkt hat nächsten Schritt und Frist oder ist als **Offen** markiert.
- [ ] Alle bekannten Zusagen an und von Dritten sind aufgeführt.
- [ ] Das Dokument enthält keine Zugangsdaten.
- [ ] Die Probe mit drei Fragen ist dokumentiert und bestanden.
- [ ] Nicht übergebene Arbeit ist ausdrücklich ausgeschlossen.

### Bei fehlenden Informationen

Frage nach, wenn unklar ist, an wen oder ab wann übergeben wird, oder wenn der Umfang der Übergabe strittig ist. Arbeite weiter mit Annahme bei fehlenden Details zu einzelnen offenen Punkten, indem du den letzten bekannten Stand mit Datum festhältst und den Punkt als **Offen** an den bisherigen Verantwortlichen zurückfragst.
