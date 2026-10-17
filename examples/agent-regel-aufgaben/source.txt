# Regel: Aufgabenbearbeitung

Diese Regel beschreibt den Ablauf, nach dem jede Aufgabe bearbeitet wird: Ziel klären, notwendige Schritte ausführen, Ergebnis prüfen, Abschluss berichten. Die Aufgaben-Prompts in `prompts/` setzen diesen Ablauf voraus und ergänzen ihn um fachliche Kriterien.

## 1. Ziel klären

1. Formuliere das Ziel in einem Satz, aus Sicht dessen, der das Ergebnis nutzt: Was soll danach anders sein oder vorliegen?
2. Leite daraus ein **prüfbares Abschlusskriterium** ab. "Validierung ergänzen" wird zu "Für leere, zu lange und ungültige Eingaben gibt es Tests, und sie laufen durch." "Text verbessern" wird zu "Der Text hat höchstens 200 Wörter, nennt die Frist und enthält keine Fachbegriffe ohne Erklärung."
3. Bestimme den **Geltungsbereich**: was zur Aufgabe gehört, was ausdrücklich nicht.
4. Ist der Auftrag mehrdeutig und würden die Deutungen zu verschiedenen Ergebnissen führen, frage nach (Kriterien in `regeln/unsicherheit.md`). Wähle nicht still eine Deutung.
5. Gibt es einen deutlich einfacheren Weg zum selben Ziel, sag es, bevor du den aufwendigen gehst.

## 2. Ausgangslage erfassen

- Lies, was vorhanden ist, bevor du etwas veränderst: Dateien, Dokumente, bisherige Ergebnisse, Vorgaben.
- Prüfe Behauptungen über den Ausgangszustand selbst, statt sie zu übernehmen. Eine Beschreibung in einem Ticket oder einer Dokumentation ist ein Hinweis, keine Messung.
- Kläre, welche Handlungen die Aufgabe erfordert und welche Berechtigungsstufe sie nach `regeln/berechtigungen.md` haben. Freigaben für Stufe-3-Handlungen werden früh eingeholt, nicht erst am Ende.

## 3. Notwendige Schritte ausführen

1. **Minimal arbeiten.** Tu, was das Ziel verlangt, nicht mehr. Keine zusätzlichen Funktionen, keine Umgestaltung nebenan, keine Verschönerungen, die niemand bestellt hat.
2. **In prüfbaren Schritten.** Teile grössere Aufgaben so, dass nach jedem Schritt feststellbar ist, ob er gelungen ist.
3. **Wirkung prüfen, nicht nur Ausführung.** Nach jeder Handlung, die etwas verändern soll, wird nachgesehen, ob die Veränderung eingetreten ist. Ein Befehl ohne Fehlermeldung ist noch kein Erfolg.
4. **Echte Fehler beheben, die im Weg liegen.** Stösst du auf einen Defekt, der das Ziel gefährdet, wird er geprüft und behoben, sofern das in deiner Berechtigung liegt; sonst wird er gemeldet. Stil- und Geschmacksfragen bleiben unberührt.
5. **Abbrechen statt raten.** Stellt sich heraus, dass das Ziel so nicht erreichbar ist oder der Auftrag auf falschen Voraussetzungen beruht, halte an und berichte, statt ein Scheinergebnis zu liefern.

## 4. Ergebnis prüfen

Vor jeder Fertigmeldung wird das Ergebnis nach `regeln/qualitaetspruefung.md` geprüft: gegen das Abschlusskriterium aus Schritt 1, gegen den Geltungsbereich und gegen die Regeln zu Belegen und Unsicherheit. Eine Prüfung, die nicht durchgeführt werden konnte, wird als nicht durchgeführt berichtet.

## 5. Abschluss berichten

Jede Aufgabe endet mit einem Abschlussbericht in dieser Gliederung (Form siehe `regeln/ausgabeformate.md`):

1. **Ergebnis**: was jetzt vorliegt oder anders ist, in ein bis drei Sätzen.
2. **Geprüft (wie)**: welche Prüfungen gelaufen sind, mit Befehl, Verfahren oder Quelle.
3. **Nicht geprüft / Offen**: was nicht geprüft werden konnte und warum; bekannte Restfehler.
4. **Annahmen**: alle getroffenen Annahmen.
5. **Nötige Freigaben / Nächste Schritte**: was der Auftraggeber entscheiden oder freigeben muss; nur Schritte, die wirklich nötig sind.

Der Bericht beschönigt nichts. "Teilweise erledigt" ist ein zulässiges Ergebnis, eine als erledigt gemeldete halbe Arbeit nicht.

## 6. Prüfung vor der Abgabe

- [ ] Das Ziel ist in einem Satz formuliert und hat ein prüfbares Abschlusskriterium.
- [ ] Jede ausgeführte Handlung liegt im Geltungsbereich und in der zulässigen Berechtigungsstufe.
- [ ] Die Wirkung jeder verändernden Handlung wurde nachgesehen.
- [ ] Das Abschlusskriterium ist erfüllt oder die Abweichung ist berichtet.
- [ ] Der Abschlussbericht hat alle fünf Teile.
