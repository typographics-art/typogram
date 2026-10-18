# Regel: Ausgabeformate

Diese Regel legt einheitliche Formen für Berichte, Befunde, Tabellen und Codeänderungen fest. Einheitliche Formen sparen dem Empfänger Zeit und machen Ergebnisse verschiedener Aufgaben vergleichbar. Ein Auftrag kann ein anderes Format verlangen; dann gilt der Auftrag.

## 1. Allgemein

1. **Das Wichtigste zuerst.** Jede Ausgabe beginnt mit dem Ergebnis oder der Antwort, nicht mit dem Vorgehen.
2. **Sprache des Auftrags.** Geantwortet wird in der Sprache des Auftrags, sofern nichts anderes verlangt ist. Fachbegriffe und Bezeichner (Befehle, Parameter, Feldnamen) bleiben in ihrer Originalform.
3. **Knapp und vollständig.** Keine Einleitungsfloskeln, keine Wiederholung des Auftrags, keine Zusammenfassung des eben Gesagten. Aber auch nichts weglassen, was der Empfänger zum Handeln braucht.
4. **Genau.** Konkrete Werte statt "einige", "viele", "bald". Absolute Daten statt "gestern" oder "nächste Woche".
5. **Kennzeichnung.** Aussagen werden nach `regeln/unsicherheit.md` als Belegt, Annahme, Schlussfolgerung oder Offen erkennbar gemacht.

## 2. Abschlussbericht

Jede Aufgabe endet mit diesem Bericht (Herleitung in `regeln/aufgabenbearbeitung.md`):

```
Ergebnis: …
Geprüft (wie): …
Nicht geprüft / Offen: …
Annahmen: …
Nötige Freigaben / Nächste Schritte: …
```

Leere Teile werden mit "keine" ausgefüllt, nicht weggelassen. Der Bericht passt bei kleinen Aufgaben in wenige Zeilen; Länge ist kein Qualitätsmerkmal.

## 3. Befunde

Prüfaufgaben (Review, Faktencheck, Vollständigkeitsprüfung, Sicherheitsprüfung) liefern Befunde in dieser Form:

- **Ort**: Datei und Zeile, Seite und Abschnitt, Tabellenzeile, Bildschirm.
- **Was passiert**: ein Satz, beschrieben als Wirkung ("ein leerer Warenkorb führt beim Bezahlen zu einem Absturz"), nicht als Geschmacksurteil.
- **Auslöser / Beleg**: die konkrete Eingabe, Abfolge oder Quelle, die den Befund zeigt.
- **Vorschlag**: die kleinste Änderung, die das Problem löst.

Jeder Befund hat einen Schweregrad:

- **kritisch**: Datenverlust, Sicherheitslücke, Rechtsverstoss, Gefahr für Personen, oder das Ergebnis ist grundsätzlich falsch.
- **hoch**: falsches Ergebnis oder Ausfall in einem üblichen Fall.
- **mittel**: falsches Ergebnis in einem seltenen Fall, deutliche Erschwernis.
- **niedrig**: kleiner Mangel ohne falsches Ergebnis.
- **Hinweis**: kein Mangel, aber nützlich zu wissen.

Befunde werden nach Schweregrad sortiert, der schwerste zuerst. Unbestätigte Vermutungen werden höchstens einmal genannt und als Offen markiert. Wurde nichts Ernstes gefunden, wird das klar gesagt, zusammen mit dem geprüften Umfang; es werden keine Kleinigkeiten erfunden, um gründlich zu wirken.

## 4. Tabellen

- Tabellen dann, wenn mehrere Gegenstände nach denselben Merkmalen verglichen werden; sonst Fliesstext oder Liste.
- Jede Spalte hat eine Überschrift mit Einheit ("Preis (CHF, exkl. MWST)").
- Gleiche Merkmale in derselben Form: gleiche Einheit, gleiche Rundung, gleiches Datumsformat (JJJJ-MM-TT).
- Fehlende Werte als "unbekannt" oder "nicht angegeben", nie als 0 oder leer, wenn das missverstanden werden kann.
- Unter der Tabelle stehen Quellen und Stand der Werte.

## 5. Codeänderungen

- Änderungen werden als Diff oder mit genauem Pfad und Stelle beschrieben, nie als "ich habe die Datei angepasst".
- Jede Änderung wird mit einem Satz begründet, der auf das Ziel zurückführt.
- Commit-Nachrichten: eine Betreffzeile im Imperativ, höchstens etwa 70 Zeichen; darunter das Warum, nicht das Was.
- Befehle stehen in Codeblöcken, vollständig und ausführbar, mit erwarteter Ausgabe, wenn sie zur Prüfung dienen.
- Neue Abhängigkeiten, geänderte Schnittstellen und nötige Migrationen werden ausdrücklich genannt.

## 6. Prüfung vor der Abgabe

- [ ] Das Ergebnis steht am Anfang.
- [ ] Der Abschlussbericht hat alle fünf Teile.
- [ ] Befunde haben Ort, Wirkung, Beleg, Vorschlag und Schweregrad.
- [ ] Tabellen haben Einheiten, Quellen und Stand.
- [ ] Codeänderungen sind mit Pfad und Begründung beschrieben.
