# Regel: Qualitätsprüfung

Diese Regel legt fest, was geprüft sein muss, bevor ein Agent eine Aufgabe als erledigt meldet. Sie ist der letzte Schritt des Ablaufs in `regeln/aufgabenbearbeitung.md`. Eine Fertigmeldung ist eine Aussage über den Zustand der Arbeit und braucht deshalb einen Beleg wie jede andere Aussage.

## 1. Fünf Prüfungen für jedes Ergebnis

1. **Ziel erfüllt.** Das prüfbare Abschlusskriterium aus der Zielklärung wird Punkt für Punkt abgehakt. Jeder Punkt ist entweder belegt erfüllt oder als nicht erfüllt berichtet.
2. **Auftrag eingehalten.** Das Ergebnis bleibt im Geltungsbereich, hält alle ausdrücklichen Vorgaben ein (Länge, Format, Sprache, Stil, Werkzeuge) und enthält nichts, was nicht bestellt war.
3. **Inhalt richtig.** Stichproben gegen die Quellen: Zahlen nachgerechnet, Zitate gegen das Original verglichen, Verweise geöffnet, Code ausgeführt. Mindestens jede Aussage, auf der eine Entscheidung beruhen kann, wird einzeln geprüft.
4. **Regeln eingehalten.** Belege nach `regeln/quellen-und-belege.md`, Kennzeichnung nach `regeln/unsicherheit.md`, keine geschützten Daten entgegen `regeln/datenschutz.md`, keine Handlung über der zulässigen Stufe nach `regeln/berechtigungen.md`.
5. **Brauchbar für den Empfänger.** Das Ergebnis ist ohne Rückfrage verständlich, folgt `regeln/ausgabeformate.md` und nennt offene Punkte.

## 2. Zusätzliche Prüfungen nach Art des Ergebnisses

**Code und Konfiguration**

- Die relevanten Tests laufen, und zwar nach der letzten Änderung. Neue Tests schlagen ohne die Änderung fehl.
- Formatierung, statische Prüfung und Typprüfung des Projekts laufen ohne neue Befunde.
- Die Änderung ist in der Umgebung ausprobiert, in der sie wirken soll, oder es ist gesagt, dass das nicht geschehen ist.
- Keine Zugangsdaten, Debug-Ausgaben, auskommentierten Reste oder unbenutzten Funktionen bleiben zurück.

**Texte und Dokumente**

- Alle verlangten Punkte kommen vor; Länge und Ton stimmen.
- Namen, Zahlen, Daten und Fristen sind gegen die Quelle geprüft.
- Rechtschreibung und Grammatik sind geprüft; Fachbegriffe sind einheitlich.

**Daten und Auswertungen**

- Die Auswertung lässt sich aus Rohdaten und Skript reproduzieren; ein zweiter Lauf liefert dieselben Zahlen.
- Summen, Anzahlen und Einheiten sind plausibel und gegen eine unabhängige Rechnung gegengeprüft.
- Ausgeschlossene oder bereinigte Datensätze sind gezählt und begründet.

**Handlungen an Systemen**

- Die beabsichtigte Wirkung ist am System selbst nachgemessen, nicht aus der Rückmeldung des Werkzeugs abgeleitet.
- Es gibt keine unbeabsichtigten Nebenwirkungen an anderen Stellen, soweit prüfbar.

## 3. Was eine Prüfung nicht ist

- Die Absicht zu prüfen. Nur ausgeführte Prüfungen zählen.
- Eine Prüfung vor der letzten Änderung. Nach jeder Änderung beginnt die Prüfung neu für das, was die Änderung berührt.
- Ein grünes Ergebnis einer Prüfung, die die betroffene Stelle gar nicht abdeckt, etwa eine Testauswahl, die die neuen Tests ausschliesst.
- Das eigene Urteil "sieht gut aus" ohne Vergleich mit einem Kriterium.

## 4. Wenn eine Prüfung scheitert oder nicht möglich ist

Scheitert eine Prüfung, wird der Fehler behoben und die Prüfung wiederholt. Ist das nicht möglich, lautet das Ergebnis "nicht erledigt" oder "teilweise erledigt" mit genauer Angabe, was fehlt. Kann eine Prüfung nicht durchgeführt werden (fehlender Zugang, fehlende Umgebung), steht sie unter "Nicht geprüft / Offen" im Abschlussbericht, mit Grund und mit dem Vorschlag, wer sie wie nachholen kann.

## 5. Prüfung vor der Abgabe

- [ ] Alle fünf allgemeinen Prüfungen sind durchgeführt.
- [ ] Die zur Art des Ergebnisses passenden Zusatzprüfungen sind durchgeführt.
- [ ] Alle Prüfungen liefen nach der letzten Änderung.
- [ ] Nicht durchgeführte Prüfungen sind mit Grund im Bericht genannt.
