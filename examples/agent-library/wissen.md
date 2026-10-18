# Wissen: was man einem Agenten bereitstellt

Ein Sprachmodell bringt breites Allgemeinwissen mit, aber kein verlässliches Wissen über deine Projekte, über die genaue Version deiner Software, über das Datenblatt deines Bauteils oder über die Fassung eines Gesetzes, die heute gilt. Dieses Wissen muss man gezielt bereitstellen. Diese Anleitung beschreibt neun Bereiche: was jeweils hineingehört, warum es zählt und wie man es so aufbereitet, dass ein Agent es richtig nutzt.

## Grundsätze für jedes Material

1. **Original vor Zusammenfassung.** Ein Agent soll aus der Quelle zitieren können. Eine Zusammenfassung ist nützlich als Einstieg, ersetzt aber nicht das Original (Vorrang der Quellen in `regeln/quellen-und-belege.md`).
2. **Version und Datum an jedem Dokument.** Im Dateinamen oder in der ersten Zeile: "PostgreSQL 16 Dokumentation, Stand 2026-03", "Datenblatt Rev. C, 2024-11". Ohne Stand kann der Agent nicht entscheiden, welche von zwei Angaben gilt.
3. **Wenig und passend statt viel.** Material, das nicht zur Aufgabe gehört, lenkt ab und erhöht das Risiko, dass eine falsche Stelle zitiert wird. Veraltetes Material wird entfernt oder sichtbar als veraltet markiert, nicht still liegen gelassen.
4. **Maschinenlesbar.** Text, der sich aus der Datei lesen lässt: PDFs mit Textebene statt eingescannter Bilder, Tabellen als Tabellen statt als Bildschirmfoto, Code als Datei statt als Foto.
5. **Eine Quelle der Wahrheit.** Gibt es dieselbe Angabe an mehreren Stellen, wird festgelegt, welche gilt. Widersprüche im Material werden aufgelöst, bevor ein Agent damit arbeitet, oder ausdrücklich benannt.
6. **Vertrauliches kennzeichnen.** Was nicht weitergegeben werden darf, wird als vertraulich markiert; Zugangsdaten gehören nie in das Wissensmaterial (`regeln/datenschutz.md`).

## 1. Eigener Kontext

**Was:** Projekte und ihr Zweck, Produkte, Abläufe, Ziele, Zuständigkeiten, getroffene Entscheidungen mit Begründung, Begriffe, die intern eine besondere Bedeutung haben.

**Warum:** Ohne diesen Kontext trifft ein Agent Entscheidungen, die allgemein vernünftig, aber für dich falsch sind: Er schlägt ein Werkzeug vor, das ihr abgeschafft habt, oder optimiert ein Ziel, das nicht eures ist.

**Wie:** Eine kurze Übersichtsseite pro Projekt (Zweck, Stand, Verantwortliche, wichtigste Dateien). Entscheidungen als knappe Einträge: Datum, Entscheidung, Grund, verworfene Alternativen. Ein Glossar für interne Begriffe. Diese Dateien werden bei jeder Änderung des Vorgehens nachgeführt; ein veralteter Kontext richtet mehr Schaden an als ein fehlender.

## 2. Software

**Was:** Dokumentation der tatsächlich eingesetzten Versionen, API-Beschreibungen (etwa OpenAPI-Dateien), Datenbankschemas, Architekturübersicht, Konventionen des Projekts, Befehle für Tests und Build.

**Warum:** Bibliotheken ändern ihr Verhalten zwischen Versionen. Ein Agent, der aus der Erinnerung arbeitet, mischt Versionen und erfindet Funktionen, die es nicht gibt.

**Wie:** Versionen aus der Abhängigkeitsdatei des Projekts ablesen und genau diese Dokumentation beilegen oder verlinken. Das Datenbankschema aus der Datenbank exportieren, nicht von Hand abschreiben. Die Architekturübersicht kurz halten: Bausteine, ihre Verantwortung, ihre Schnittstellen, ihre Grenzen. Für technische Entscheidungen sind aktuelle Dokumentation und der Code selbst meist nützlicher als ein Lehrbuch.

## 3. Technik

**Was:** Originaldatenblätter, Handbücher, Toleranzen, Schaltpläne, Anschlussbelegungen, Errata, Normen, Prüfprotokolle.

**Warum:** Grenzwerte, Pinbelegungen und Toleranzen lassen sich nicht schätzen. Ein falscher Wert kann Bauteile zerstören oder Menschen gefährden.

**Wie:** Immer das Originaldatenblatt des Herstellers in der Revision, die zum verbauten Teil passt, mit Errata. Teilenummer und Revision im Dateinamen. Eigene Messungen und Abweichungen vom Datenblatt in einem getrennten, datierten Protokoll. Schaltpläne als Vektor-PDF mit durchsuchbaren Bezeichnern.

## 4. Recht und Verwaltung

**Was:** Offizielle Vorschriften nach Land und Datum, Verträge, allgemeine Geschäftsbedingungen, Verfahrensregeln, Formulare, Fristen, behördliche Merkblätter.

**Warum:** Recht gilt nur in einem bestimmten Gebiet und in einer bestimmten Fassung. Eine Regel aus dem falschen Land oder aus einer überholten Fassung ist schlimmer als keine.

**Wie:** Gesetzestexte aus der amtlichen Sammlung, mit Rechtsgebiet, Fassung und Abrufdatum. Verträge in der unterschriebenen Fassung mit allen Nachträgen. Ein Agent liefert hier Grundlagen und Fundstellen; die rechtliche Beurteilung bleibt bei einer dafür zuständigen Person.

## 5. Sicherheit

**Was:** Sicherheitsrichtlinien, Berechtigungsmodelle (wer darf was), Klassifizierung von Daten, Notfallabläufe mit Ansprechpersonen, Vorgaben für Zugangsdaten und Protokollierung.

**Warum:** Ein Agent muss wissen, welche Systeme heikel sind und wen er im Ernstfall informiert. Ohne diese Vorgaben fällt die Einstufung nach `regeln/berechtigungen.md` vorsichtig, aber ungenau aus.

**Wie:** Das Berechtigungsmodell als Tabelle (Rolle, System, erlaubte Handlungen). Notfallabläufe als nummerierte Schritte mit Kontaktweg, nicht als Fliesstext. Keine Zugangsdaten in diesen Dokumenten, nur Verweise auf den Geheimnisspeicher.

## 6. Wissenschaft

**Was:** Originalpublikationen, Methodenbeschreibungen, Datensätze mit Datenbeschreibung, Fachübersichten, Protokolle von Experimenten.

**Warum:** Zusammenfassungen und Pressetexte verkürzen Ergebnisse oft bis zur Unrichtigkeit. Ein Agent soll Effektgrössen, Stichproben und Einschränkungen aus der Quelle lesen können.

**Wie:** Die Publikation als PDF mit Textebene und mit DOI. Datensätze mit Beschreibung der Spalten, Einheiten, Erhebungszeitraum und Lizenz. Eine aktuelle Fachübersicht als Einstieg, damit Einzelstudien eingeordnet werden können.

## 7. Qualität

**Was:** Abnahmekriterien, Prüflisten, Definitionen von "fertig", gute und schlechte Beispiele mit Begründung, frühere Prüfberichte.

**Warum:** Was "gut" bedeutet, ist ohne Beispiel kaum zu vermitteln. Ein gutes und ein schlechtes Beispiel mit je zwei Sätzen Begründung leisten mehr als eine Seite Beschreibung.

**Wie:** Kriterien prüfbar formulieren ("jede Tabelle hat Einheiten" statt "sauber formatiert"). Beispiele nebeneinander stellen und den Unterschied benennen. Die Kriterien mit `regeln/qualitaetspruefung.md` abstimmen, damit es nur einen Massstab gibt.

## 8. Sprache und Gestaltung

**Was:** Stilvorgaben, Terminologie und verbotene Begriffe, Vorlagen für wiederkehrende Dokumente, Gestaltungsregeln, Markenvorgaben, Vorgaben zur Barrierefreiheit.

**Warum:** Ein Agent schreibt sonst im Durchschnittston aller Texte, die er kennt. Einheitliche Begriffe sind ausserdem eine Frage der Richtigkeit: Zwei Wörter für dieselbe Sache lassen Leser zwei Sachen vermuten.

**Wie:** Eine Terminologieliste mit bevorzugtem Begriff, verworfenen Varianten und Definition. Vorlagen als echte Dateien mit Platzhaltern. Stilregeln mit je einem Beispiel und einem Gegenbeispiel.

## 9. Erfahrungswissen

**Was:** Fehlerberichte, Ursachenanalysen, gescheiterte Ansätze, bekannte Fallen, Messungen, die eine Vermutung widerlegt haben.

**Warum:** Dieses Wissen steht in keinem Buch und ist oft das wertvollste. Ohne es wiederholt ein Agent Fehler, die schon einmal teuer waren.

**Wie:** Ein Eintrag pro Fall: Datum, Symptom, gemessene Ursache, Behebung, wie man den Fehler künftig früh erkennt. Gescheiterte Ansätze mit dem Grund des Scheiterns, damit sie nicht wieder vorgeschlagen werden. Einträge, deren Ursache nie gemessen wurde, als Vermutung kennzeichnen.

## Bücher oder Datenblatt?

Bücher lohnen sich, wenn man eine Methode übernehmen will: eine Vorgehensweise für Ursachenanalysen, ein Verfahren der Statistik, eine Schreibschule. Für technische Entscheidungen sind Datenblatt, aktuelle Dokumentation und eigene Messung meist nützlicher, weil sie genau den Gegenstand beschreiben, um den es geht, in der Fassung, die gilt.

## Prüfliste für bereitgestelltes Wissen

- [ ] Jedes Dokument trägt Version oder Stand.
- [ ] Zu jeder eingesetzten Software liegt die Dokumentation der verwendeten Version vor oder ist verlinkt.
- [ ] Widersprüche im Material sind aufgelöst oder benannt.
- [ ] Veraltetes ist entfernt oder sichtbar markiert.
- [ ] Das Material enthält keine Zugangsdaten.
- [ ] Es gibt gute und schlechte Beispiele für die wichtigsten Ergebnisarten.
- [ ] Erfahrungswissen ist nach Fällen mit gemessener Ursache geordnet.
