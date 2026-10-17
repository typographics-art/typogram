# Structured data: user interface design

This is the design of the three places where people meet [TGD](structured-data.md): the generator (attach a file), the work page (read the data back out) and the errors. It is a design, not an implementation: nothing in `app.html` or `work.html` has been changed. Element ids, labels and messages are fixed here so that the implementation is a transcription. API terms stay English everywhere (`TGD`, `sha256`, `model`, `.tgd.json`, `xlsx`, `csv`); everything else is in English and in German.

The rule behind every message in this document comes from this project's own history: an error that is technically right but shown in small grey text under the wrong field reads as "the button does nothing". So every message here is **visible** (own box, contrast, an icon that is not the only signal), **placed directly under the action** that caused it (never under a field the person was not just using), **actionable** (it says what to do, with a button where there is one), and **announced** (`role="alert"` for errors, `role="status"` for progress; focus moves to the box when an action fails).

## 1. Generator: attach a data file

### 1.1 Where it goes

In the text step of the generator, directly under the text area and above the sample-text field, a new field **Data file**. It does not replace the text area: the person chooses whether the data stands alone or is added to the prose.

```
 Text
 ┌──────────────────────────────────────────────────────────────┐
 │ (text area)                                                  │
 └──────────────────────────────────────────────────────────────┘

 Data file (optional)
 ┌──────────────────────────────────────────────────────────────┐
 │  [ Choose a file … ]   or drop it here                       │
 │  Excel, CSV, TSV, JSON, Markdown, YAML, XML, iCalendar, vCard │
 └──────────────────────────────────────────────────────────────┘
```

After a file has been read, the field turns into a card (state **ready**):

```
 Data file
 ┌──────────────────────────────────────────────────────────────┐
 │ budget.xlsx   Excel · 2 sheets · 1,204 cells        [Remove] │
 │                                                              │
 │ What will be written into the work                           │
 │ ┌──────────────────────────────────────────────────────────┐ │
 │ │ Sheet "Q1 Sales" · 6 columns × 200 rows · has a header   │ │
 │ │ Name           | Qty | Price | ID  | Shipped    | Note    │ │
 │ │ Müller & Söhne | 3   | 19.9  | 007 | 2024-03-05 | …       │ │
 │ │ Zoë 😀         | 12  | 0.1   | 0012…678 | …     | …       │ │
 │ │ … 197 more rows           [ Sheet "Hidden" (1 row) ▾ ]   │ │
 │ └──────────────────────────────────────────────────────────┘ │
 │                                                              │
 │ Space   ▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░  13,858 of 600,000      │
 │         characters · type about 2.9 mm on A4                 │
 │                                                              │
 │ ⚠ Not carried over: styles and colours, column widths,       │
 │   charts, validation, macros.                    [ Details ] │
 │                                                              │
 │ How should the data go into the work?                        │
 │ (•) Add it after my text      ( ) Use only the data          │
 │                                                              │
 │ [ ] Also keep the original file inside the work (+33 %)      │
 └──────────────────────────────────────────────────────────────┘
 [ Make the work ]
```

The primary button of the generator stays where it is. The data card never carries its own "generate" button, so there is only one place that makes the work.

### 1.2 What is shown, and why

| Part | Content | Reason |
|---|---|---|
| Title line | file name, format name, counts (sheets and cells, rows, records, blocks) | proves the right file was read |
| Preview | the first 8 rows of the first sheet as a table (JSON: the first 12 lines; Markdown: the first blocks as headings and paragraphs; XML: the first levels; iCalendar/vCard: the first components); a sheet switcher when there are several | the person sees what a machine will get, not what they uploaded |
| Space meter | `characters of the block` against the capacity of the chosen paper, and the estimated type size | capacity is the main limit; see [§Capacity](structured-data.md#capacity) |
| Not carried over | the `lossy` list of the encoder, shortened to the first four items, "Details" shows all, each in a sentence | the envelope declares it, and the person is told before they commit |
| Placement | add after the text / use only the data | the work may hold prose and data |
| Keep the original | adds the file as base64 (+33 %) | optional, off by default; the cost is shown as a number |

The meter has three states, each with text, not only colour:

| Share of capacity | Style | Text (EN / DE) |
|---|---|---|
| up to 60 % | neutral | "Fits comfortably." / "Passt bequem." |
| 60 % to 100 % | amber, ⚠ | "Fits, but the letters become small: about {mm} mm. Use a larger paper or fewer sheets to make them bigger." / "Passt, aber die Buchstaben werden klein: etwa {mm} mm. Mit größerem Papier oder weniger Blättern werden sie größer." |
| over 100 % | red, ✖, box with actions | see §3.4 "too large" |

Type size estimate: measured on this repository's one-pager, `size_mm ≈ 345 / √characters` on A4 (11,169 characters: 3.22 mm; 1,394 characters: 9.5 mm); the app shows it as an estimate ("about").

### 1.3 States of the Data file field

| State | What the person sees | `aria` |
|---|---|---|
| empty | the drop zone above | – |
| reading | the drop zone replaced by "Reading budget.xlsx …" with a thin progress bar (the file is read in the browser; nothing is uploaded) | `role="status"` |
| ready | the card above | focus stays on the Choose button |
| warning | the card, with the amber box of §3.2 above the preview | – |
| error | the red box of §3 *inside the field, directly under the Choose button*, the drop zone stays usable | `role="alert"`, focus moves to the box |

### 1.4 Labels (EN / DE)

| id | EN | DE |
|---|---|---|
| `dataField` (label) | Data file (optional) | Datendatei (optional) |
| `dataChoose` | Choose a file … | Datei wählen … |
| `dataDrop` | or drop it here | oder hierher ziehen |
| `dataTypes` | Excel, CSV, TSV, JSON, Markdown, YAML, XML, iCalendar, vCard | Excel, CSV, TSV, JSON, Markdown, YAML, XML, iCalendar, vCard |
| `dataReading` | Reading {name} … | {name} wird gelesen … |
| `dataRemove` | Remove | Entfernen |
| `dataSummary` | {format} · {sheets} sheets · {cells} cells | {format} · {sheets} Blätter · {cells} Zellen |
| `dataPreviewTitle` | What will be written into the work | Das kommt in das Werk |
| `dataSheetLine` | Sheet "{name}" · {cols} columns × {rows} rows · {header} | Blatt „{name}“ · {cols} Spalten × {rows} Zeilen · {header} |
| `dataHasHeader` / `dataNoHeader` | has a header | mit Kopfzeile / ohne Kopfzeile |
| `dataMore` | … {n} more rows | … {n} weitere Zeilen |
| `dataSpace` | Space | Platz |
| `dataSpaceOf` | {used} of {cap} characters · type about {mm} mm on {paper} | {used} von {cap} Zeichen · Schrift etwa {mm} mm auf {paper} |
| `dataLost` | Not carried over: {list}. | Nicht übernommen: {list}. |
| `dataDetails` | Details | Einzelheiten |
| `dataPlacement` | How should the data go into the work? | Wie sollen die Daten in das Werk? |
| `dataAfterText` | Add it after my text | Nach meinem Text anhängen |
| `dataOnly` | Use only the data | Nur die Daten verwenden |
| `dataAttach` | Also keep the original file inside the work (+33 %) | Die Originaldatei zusätzlich im Werk aufbewahren (+33 %) |
| `dataUnicode` | Write all characters as they are (readable, but not guaranteed exact for rare scripts) | Alle Zeichen unverändert schreiben (lesbar, aber bei seltenen Schriften nicht garantiert exakt) |
| `dataTitleHint` | The picture is formed from the data text; the title still shows. | Das Bild entsteht aus dem Datentext; der Titel bleibt sichtbar. |

The unicode option (`dataUnicode`) sits under "Details", off by default (it is `--unicode plain`).

The lost-feature sentences come from the encoder's `lossy` list. They are English API strings; the app translates the fixed set of them by key (the encoder's list is the key set; see [§Formats](structured-data.md#formats)). The German versions:

| English (encoder) | Deutsch |
|---|---|
| styles, fonts, colours, borders and number formats (dates and times are recognised and kept) | Stile, Schriften, Farben, Rahmen und Zahlenformate (Datum und Uhrzeit werden erkannt und bleiben erhalten) |
| column widths, row heights, hidden rows and columns, frozen panes | Spaltenbreiten, Zeilenhöhen, ausgeblendete Zeilen und Spalten, fixierte Bereiche |
| data validation, conditional formatting, filters, tables, pivot tables | Datenüberprüfung, bedingte Formatierung, Filter, Tabellen, Pivot-Tabellen |
| charts, images, drawings, macros | Diagramme, Bilder, Zeichnungen, Makros |
| types: every cell is text | Typen: Jede Zelle ist Text |
| quoting style: fields are quoted only where needed | Anführungszeichen: Felder werden nur dort in Anführungszeichen gesetzt, wo es nötig ist |
| formatting: indentation, spacing and line breaks | Formatierung: Einrückung, Abstände und Zeilenumbrüche |
| comments and processing instructions | Kommentare und Verarbeitungsanweisungen |
| block syntax is normalised (bullets, heading style, fences, table alignment) | Die Blocksyntax wird vereinheitlicht (Aufzählungszeichen, Überschriftenstil, Codeblöcke, Tabellenausrichtung) |
| folding of long lines (written again at 75 octets) | Zeilenumbruch langer Zeilen (wird neu bei 75 Oktetten gesetzt) |

### 1.5 Warnings that are not about lost features

| Situation | Box (amber unless noted), EN | DE |
|---|---|---|
| Cells contain scripts outside the measured-safe set | "Some cells contain characters from scripts such as Chinese, Japanese kanji, Arabic or Hebrew. They are written as `\u` codes so that they come back exactly. The data stays complete, but is harder to read as plain text." | „Einige Zellen enthalten Zeichen aus Schriften wie Chinesisch, japanischen Kanji, Arabisch oder Hebräisch. Sie werden als `\u`-Codes geschrieben, damit sie exakt zurückkommen. Die Daten bleiben vollständig, sind als Klartext aber schwerer lesbar.“ |
| Workbook has formulas | "{n} cells hold formulas. Formula and last calculated value are both kept." | „{n} Zellen enthalten Formeln. Formel und zuletzt berechneter Wert bleiben beide erhalten.“ |
| A date-formatted cell cannot be a date | "{n} date-formatted cells hold numbers that are not dates (for example 1900-02-29). They stay numbers." | „{n} als Datum formatierte Zellen enthalten Zahlen, die kein Datum sind (zum Beispiel der 29.02.1900). Sie bleiben Zahlen.“ |
| Very long text in one cell | "One cell has {n} characters. It fits, but the table gets hard to read." | „Eine Zelle hat {n} Zeichen. Sie passt, aber die Tabelle wird schwer lesbar.“ |
| Data and text both | "The data block sits after your text and counts toward the space above." | „Der Datenblock steht nach Ihrem Text und zählt zum Platz oben.“ |

## 2. Work page: Machine view

### 2.1 Where it goes

`work.html` has three views (Art, Read, Machine). Data is machine content, so it lives in **Machine**, as a section **Data** above "Sections". The Read view shows the prose without the block (the block is cut out with `stripBlocks`) and, where the block was, one line: "Data: budget.xlsx · open in Machine" / „Daten: budget.xlsx · in „Maschine“ öffnen“. The Art view is untouched.

A work with several blocks shows one card per block, in order.

### 2.2 The card

```
 Data
 ┌──────────────────────────────────────────────────────────────┐
 │ budget.xlsx    Excel · created 2026-10-17 · tg-data/1.0      │
 │ ✔ Verified    sha256:d448af6794d4c360…        [ Copy ]       │
 │ The data below is exactly what was stored in this work.      │
 │                                                              │
 │ [ Table ]  [ Model ]  [ Text ]                               │
 │ Sheets:  [ Q1 Sales ]  [ Hidden · hidden ]                   │
 │ ┌──┬──────────────┬─────┬───────┬─────┬────────────┬──────┐ │
 │ │  │ A            │ B   │ C     │ D   │ E          │ F    │ │
 │ ├──┼──────────────┼─────┼───────┼─────┼────────────┼──────┤ │
 │ │ 1│ Name         │ Qty │ Price │ ID  │ Shipped    │ Note │ │
 │ │ 2│ Müller & Söh │ 3   │ 19.9  │ 007 │ 2024-03-05…│ …    │ │
 │ │ 4│ Total        │ =SUM(B2:B3) → (no value)                │ │
 │ └──┴──────────────┴─────┴───────┴─────┴────────────┴──────┘ │
 │ 200 rows · 6 columns · merged: A6:C6 · comments: A1          │
 │                                                              │
 │ Not carried over: styles and colours, widths, charts, …      │
 │                                                              │
 │ Download   [ .xlsx ]  [ .csv ]  [ .tgd.json (model) ]        │
 │ [ ] write formulas (only for data you trust)                 │
 │ Copy       [ Block text ]  [ Model as JSON ]                 │
 └──────────────────────────────────────────────────────────────┘
```

- **Verified** badge: green ✔ and the words, with the full checksum on hover/focus (`title` and a visible "Copy"). It is shown only after `openBody` succeeded, i.e. after the checksum matched.
- **Table / Model / Text** switch the same card: Table (workbook: a grid with column letters and row numbers, sparse sheets show only used rows with their numbers; JSON: a collapsible tree; Markdown: rendered headings, lists, tables and code from the model, not from raw text; XML: element tree; iCalendar/vCard: components with properties), Model (the `.tgd.json` model, pretty), Text (the block exactly as read from the work, with the middle dots visible, so people see what the picture carries).
- Typed cells are shown with their type in a quiet form: dates as ISO text, formulas as `=SUM(B2:B3)` followed by `→ cached value` (or "(no value)"), errors in red, long numbers in full with a "text" tooltip when they are not plain doubles.
- **Downloads** call `toFile`. `.xlsx` is offered for workbooks, `.csv` and `.tsv` for sheets, `.json` for JSON data and for workbooks (sheet name → rows), `.md`, `.yaml`, `.xml`, `.ics`, `.vcf`, `.env` for their kinds; the source format is the first and primary button. `.tgd.json` is always there.
- Guard notes from `toFile` (`notes`) are shown **under the download row** as a visible info box, not as a tooltip: "3 cells starting with = + - @ got a leading ' so that Excel shows them as text. [Download without the guard]" (the second button sets `safe: false` after a confirm step: "Only do this for data you trust.").
- The download of an `.xlsx` with formulas needs the checkbox; default off.
- The existing Machine key-value table (format, checksum of the canonical text, …) stays; the new card sits above it. The existing "Copy JSON" gets a member `data: [ { name, format, sum, model } ]`.

### 2.3 Labels (EN / DE)

| id | EN | DE |
|---|---|---|
| `dataH` | Data | Daten |
| `dataVerified` | Verified | Geprüft |
| `dataVerifiedLong` | The data below is exactly what was stored in this work. | Die Daten unten sind genau das, was in diesem Werk gespeichert wurde. |
| `dataCreated` | created {date} | erstellt {date} |
| `dataTabTable` / `dataTabModel` / `dataTabText` | Table / Model / Text | Tabelle / Modell / Text |
| `dataSheets` | Sheets | Blätter |
| `dataHidden` | hidden | ausgeblendet |
| `dataNoValue` | (no value) | (kein Wert) |
| `dataCounts` | {rows} rows · {cols} columns | {rows} Zeilen · {cols} Spalten |
| `dataMerged` / `dataComments` | merged: {list} / comments: {list} | verbunden: {list} / Kommentare: {list} |
| `dataDownload` | Download | Herunterladen |
| `dataFormulas` | write formulas (only for data you trust) | Formeln mitschreiben (nur für vertrauenswürdige Daten) |
| `dataCopyBlock` / `dataCopyModel` | Block text / Model as JSON | Blocktext / Modell als JSON |
| `dataCopied` | Copied. | Kopiert. |
| `dataInRead` | Data: {name} · open in Machine | Daten: {name} · in „Maschine“ öffnen |
| `dataGuard` | {n} cells starting with = + - @ got a leading ' so that a spreadsheet shows them as text. | {n} Zellen, die mit = + - @ beginnen, haben ein vorangestelltes ', damit eine Tabellenkalkulation sie als Text zeigt. |
| `dataGuardOff` | Download without the guard | Ohne Schutz herunterladen |
| `dataGuardOffConfirm` | Only do this for data you trust. | Tun Sie das nur bei Daten, denen Sie vertrauen. |

## 3. Errors

### 3.1 Design rules

1. One error box type, used everywhere: red left border and background tint, a ✖ icon **and** a bold title, body text at normal size (not smaller than the page text), at least 4.5:1 contrast.
2. It appears **directly under the control the person just used** (the Choose button, the Download row, the Verify button) and pushes content down; it never replaces the whole card unless the whole block is unusable.
3. Title = what happened, in plain words. Body = the cause in one sentence and what it means for the data. Then **actions as buttons** (not links in the text).
4. `role="alert"`, focus moves to the box title, the box stays until the person acts or fixes the cause. No toast that disappears.
5. The technical code (`checksum`, `zip-slip`) is shown last, small, as "Code: checksum", for bug reports. It is never the message.

### 3.2 Damaged or tampered block (Machine view)

```
 Data
 ┌──────────────────────────────────────────────────────────────┐
 │ ✖ The data in this work was changed or is damaged            │
 │   The checksum stored in the data block does not match its   │
 │   content. This happens when the text was edited, cut off,   │
 │   or read wrongly from a PDF. The data is not shown, because │
 │   it cannot be trusted.                                      │
 │   [ Show the block text ]  [ Try the SVG/HTML version ]      │
 │   [ Download the block text ]                                │
 │   Code: checksum                                             │
 └──────────────────────────────────────────────────────────────┘
```

"Show the block text" opens the Text tab with the damaged block (so a person can see what is wrong); the data tabs stay hidden. When a work has several blocks, only the damaged one shows the box; the others work.

Messages by error code (title, body; EN then DE). The decoder's `TgdError.code` selects the entry.

| code | EN title | EN body | DE title | DE body | actions |
|---|---|---|---|---|---|
| `checksum` | The data in this work was changed or is damaged | The checksum stored in the data block does not match its content. This happens when the text was edited, cut off, or read wrongly from a PDF. The data is not shown, because it cannot be trusted. | Die Daten in diesem Werk wurden verändert oder sind beschädigt | Die im Datenblock gespeicherte Prüfsumme passt nicht zum Inhalt. Das passiert, wenn der Text bearbeitet, abgeschnitten oder aus einem PDF falsch gelesen wurde. Die Daten werden nicht angezeigt, weil man ihnen nicht trauen kann. | Show block text · Try the SVG/HTML version · Download block text |
| `unterminated` | The data block is cut off | The block starts at character {offset} but has no end. The text was probably shortened. | Der Datenblock ist abgeschnitten | Der Block beginnt bei Zeichen {offset}, hat aber kein Ende. Der Text wurde wahrscheinlich gekürzt. | Show block text · Try the SVG/HTML version |
| `version` | This data needs a newer reader | The block says it is TGD {version}; this page reads version 1. | Diese Daten brauchen ein neueres Leseprogramm | Der Block nennt TGD {version}; diese Seite liest Version 1. | Show block text · Download block text |
| `syntax` / `shape` | The data block is not valid | {message} | Der Datenblock ist ungültig | {message} | Show block text |
| `limit` | The data is too large for this page | {message} Reading it here could freeze your browser. | Die Daten sind für diese Seite zu groß | {message} Sie hier zu lesen könnte Ihren Browser einfrieren. | Download block text · Use the command line tool |
| `none` | This work carries no data | No TGD data block was found in its text. | Dieses Werk enthält keine Daten | Im Text wurde kein TGD-Datenblock gefunden. | – |
| `format` (model not writable as the format asked for) | This data cannot be written as {format} | {message} | Diese Daten lassen sich nicht als {format} schreiben | {message} | Choose another download |

The Art view is never blocked by a damaged block: the picture and the text stay available.

### 3.3 Generator errors (attach a file)

Placed under the Choose button, same box.

| code | EN title | EN body | DE title | DE body | actions |
|---|---|---|---|---|---|
| `format` | This file type is not supported | {name} is not one of: Excel, CSV, TSV, JSON, Markdown, YAML, XML, iCalendar, vCard. | Dieser Dateityp wird nicht unterstützt | {name} ist keiner von: Excel, CSV, TSV, JSON, Markdown, YAML, XML, iCalendar, vCard. | Choose another file |
| `encoding` | The file is not in UTF-8 | Text files from older programs are often Windows-1252 or ISO-8859-1. Choose the encoding and read it again. | Die Datei ist nicht in UTF-8 | Textdateien aus älteren Programmen sind oft Windows-1252 oder ISO-8859-1. Wählen Sie die Kodierung und lesen Sie die Datei erneut. | a select `[Windows-1252 ▾]` and [Read again] |
| `syntax` | The file could not be read | {message} (for example: line 12: a quoted field is not closed) | Die Datei konnte nicht gelesen werden | {message} (zum Beispiel: Zeile 12: Ein Feld in Anführungszeichen ist nicht geschlossen) | Choose another file |
| `zip` / `zip-slip` | This Excel file looks damaged or unsafe | It was not read. {message} | Diese Excel-Datei wirkt beschädigt oder unsicher | Sie wurde nicht gelesen. {message} | Choose another file |
| `limit` | The file is too large | {message} A work holds about 600,000 characters of data on one A4 page. | Die Datei ist zu groß | {message} Ein Werk fasst etwa 600 000 Zeichen Daten auf einer A4-Seite. | Remove sheets (when the file has several) · Choose another file |
| nothing to write | The file holds no data | No cells, rows or entries were found. | Die Datei enthält keine Daten | Es wurden keine Zellen, Zeilen oder Einträge gefunden. | Choose another file |

### 3.4 Too large

Not an error of the file but of the plan, shown as the red state of the meter, with actions:

```
 Space   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  1,204,000 of 600,000 characters
 ✖ This does not fit on one A4 page
   The data needs 2.0 times the space. Letters would be below 0.3 mm.
   [ Use A2 ]   [ Split into 3 pages ]   [ Leave out sheets … ]
```

"Split into pages" produces several works (one block each, `1/3` in the name of each) and is described in [§Capacity](structured-data.md#capacity); until the one-pager tool supports it, the button is not offered and the box says "Leave out sheets or rows".

DE: „Das passt nicht auf eine A4-Seite. Die Daten brauchen das 2,0-fache an Platz. Die Buchstaben wären kleiner als 0,3 mm.“ Actions: „A2 verwenden“, „Auf 3 Seiten aufteilen“, „Blätter weglassen …“.

### 3.5 After the work was made: read-back check

After generating, the generator reads the finished work back (the same text path as the Machine view) and verifies the block. Success shows a green line **under the download button**: "✔ Checked: the data comes back out of this PDF exactly." / „✔ Geprüft: Die Daten kommen aus diesem PDF exakt zurück.“ Failure is the damaged-block box of §3.2 with the added sentence "The work was not saved as a finished file." / „Das Werk wurde nicht als fertige Datei bereitgestellt.“ and a button "Write all characters as \u codes and try again" / „Alle Zeichen als \u-Codes schreiben und erneut versuchen“. This is the safety net behind the measured-safe character set: if a font substitution in a different environment changed a character, the person finds out when making the work, not later.

## 4. Accessibility and behaviour notes

- Every box is reachable by keyboard; the preview table is a real `<table>` with `<th scope>`; the meter is a `<meter>` with the same text.
- Reading happens in the browser (a `Worker` for XLSX and large files; the zip and XML limits of the library apply). Nothing is uploaded by the Data file field.
- The 16 MiB input limit and the 6 M element limit show as the `limit` message before any layout work starts.
- The file name shown is always the sanitised `name` of the block (no path), never a path from the person's machine.
