# Passwörter, Schlüssel und Seeds: wie es hier funktioniert, und was wir nicht versprechen

Diese Seite ist für Menschen, die wissen wollen, ob sie dem Schutz von Daten in Typographics Art vertrauen können, ohne die Fachliteratur zu lesen. Sie erklärt den Aufbau in einfachen Worten, nennt die Gründe und sagt klar, was **nicht** abgedeckt ist. Alles ist Open Source; jede Zahl unten wurde gemessen oder ist als Schätzung oder Zitat gekennzeichnet, und der letzte Abschnitt zeigt, wie man es selbst nachprüft. Die technischen Dokumente dahinter sind [encrypted-data.md](encrypted-data.md), [key-management.md](key-management.md) und [cipher-review.md](cipher-review.md) (auf Englisch). Die englische Fassung dieser Seite: [passwords-and-keys.md](passwords-and-keys.md).

## 1. In einer Minute

- **Das Schloss ist stark.** Versiegelte Daten nutzen AES-256-GCM, ein Standardverfahren, das Browser und Node mitbringen. Wir haben kein eigenes Verfahren erfunden und die Alternativen geprüft (Abschnitt 7): Keine ist das Risiko von zusätzlichem Code wert.
- **Ein Passwort ist die Schwachstelle jedes solchen Schlosses, deshalb steht es nie allein.** Für alles Öffentliche oder Dauerhafte ist der eigentliche Schutz ein langes Zufallsgeheimnis, das niemand eintippt. Ein Passwort kann nur ein *zusätzlicher* Faktor sein, der damit gemischt wird. Die Werkzeuge weigern sich, einen Datensatz zu veröffentlichen, der nur durch ein Passwort geschützt ist.
- **Du hältst den Schlüssel, wir können ihn nicht wiederherstellen.** Die Seite arbeitet in deinem Browser und schickt Daten, Schlüssel, Seed oder Passwort nirgendwohin (die Website lädt nichts von Dritten, und der Browser erzwingt das mit einer Content-Security-Policy). Das heisst auch: Wenn du den Schlüssel verlierst, sind die Daten weg, und niemand kann helfen.
- **Es ist nicht unabhängig geprüft.** Das Verfahren ist Standard; der Code darum herum (Formate, Werkbindung, Schlüsselbehandlung) wurde für dieses Projekt geschrieben, getestet und von automatischen Werkzeugen geprüft, aber keine externe Kryptografin hat ihn begutachtet. Wenn Verlust oder Preisgabe der Daten wirklich schaden würde, lass ihn vorher prüfen.

## 2. Die Geheimnisse und wofür jedes da ist

| Geheimnis | Was es ist | Von Hand getippt? | Wofür |
|---|---|---|---|
| **Zufallsschlüssel** (`tgx1.…`, `tgx2.…`) | 256 Zufallsbits, als etwa 60 Zeichen dargestellt | Nein: kopieren oder Datei | Öffnet einen versiegelten Datensatz. Das ist der Standardschutz. |
| **Seed** (12, 18 oder 24 Wiederherstellungswörter, oder Hex) | Das eine Backup, aus dem ein **Master-Schlüssel** und **ein Schlüssel pro Datensatz** abgeleitet werden | Wörter werden aufgeschrieben und selten getippt | Öffnet alles, was daraus versiegelt wurde; ein einzelner Datensatz-Schlüssel lässt sich weitergeben, ohne den Rest preiszugeben. |
| **Passwort / Passphrase** | Etwas, das sich ein Mensch merkt | Ja | Nur als *zusätzlicher* Faktor (nie allein für öffentliche Daten). |
| **Anteil** (`tgsh1.…`) | Ein Stück eines in mehrere Teile zerlegten Schlüssels | Nein | Ein Schlüssel, der mehrere Teile aus verschiedenen Händen braucht (beliebige k von n). |
| **Passkey** (WebAuthn, Handy oder Sicherheitsschlüssel) | Ein an die Hardware gebundenes Geheimnis, das man nicht erraten kann | Nein: das Gerät erledigt es | Ein Faktor eines 2-aus-3-Tresors; funktioniert in einem Testbrowser mit virtuellem Passkey, **noch nicht auf echten Geräten geprüft** (du kannst deines prüfen: `/passkey-check`). |

## 3. Warum ein Passwort die Schwachstelle ist

Ein Verfahren mit 256-Bit-Schlüssel lässt sich praktisch nicht durch Raten brechen. Ein Passwort ist kein 256-Bit-Schlüssel, es ist etwas, das ein Mensch erfunden hat. Entscheidend ist, wie viele Versuche ein Angreifer braucht und wie schnell er raten kann.

Ist dein versiegelter Datensatz **öffentlich**, kann ihn jeder kopieren und **offline, für immer** Versuche durchprobieren, so schnell seine Hardware es erlaubt; niemand kann ihn bremsen oder bemerkt es. Die Tabelle zeigt, wie lange es dauert, *jedes* Geheimnis einer bestimmten Stärke durchzuprobieren. Geschwindigkeiten: Die erste Spalte ist auf der Entwicklungsmaschine gemessen (eine langsame, absichtlich teure Schlüsselableitung, etwa 10 Versuche pro Sekunde und Kern, 32 Kerne, linear hochgerechnet); die beiden anderen sind **Schätzungen**, keine Messungen.

| Stärke des Geheimnisses | Diese Maschine | GPU-Farm (Schätzung) | Staatlicher Aufwand (Schätzung) |
|---|---|---|---|
| 28 Bit (ein typisches Menschenpasswort) | 9 Tage | 45 Minuten | 27 Sekunden |
| 40 Bit (ein *gutes* Menschenpasswort) | 102 Jahre | 127 Tage | 1,3 Tage |
| 50 Bit | 100 000 Jahre | 357 Jahre | 3,6 Jahre |
| 66 Bit (6 Zufallswörter) | 7·10^9 Jahre | 2,3·10^7 Jahre | 2,3·10^5 Jahre |
| 88 Bit (8 Zufallswörter) | 3·10^16 Jahre | 10^14 Jahre | 10^12 Jahre |
| 128 Bit (ein Zufallsschlüssel) | 3·10^28 Jahre | 10^26 Jahre | 10^24 Jahre |
| 256 Bit (unser Standard) | 10^67 Jahre | 10^65 Jahre | 10^63 Jahre |

Zwei Dinge bestimmen den Aufbau:

1. **Menschen wählen keine zufälligen Passwörter.** Was Menschen ein starkes Passwort nennen, liegt bei etwa 28 bis 40 Bit, und diese Zeilen fallen in Tagen bis Jahren.
2. **Ein menschliches Geheimnis geht auf menschliche Weise verloren**: auf einer fremden Seite eingetippt, von einem Keylogger mitgelesen, auf Papier geschrieben, laut gesagt. Einen 256-Bit-Schlüssel tippt niemand.

(Herleitung und genaue Werte: [cipher-review.md](cipher-review.md), Abschnitt 0.1.)

## 4. Die Regel, und was sie durchsetzt

> **Ein von Menschen gewähltes Passwort ist nie das einzige Geheimnis, das einen öffentlichen oder dauerhaften Datensatz schützt.**

Was der Code dafür tut (alles getestet, siehe Abschnitt 9):

- Der Standardschutz eines versiegelten Datensatzes ist ein zufälliges 256-Bit-Geheimnis oder ein aus deinem Seed abgeleiteter Datensatz-Schlüssel.
- Ein Passwort kann als zusätzlicher Faktor beigemischt werden: Das Geheimnis besteht dann aus dem Zufallsteil und dem gestreckten Passwort zusammen, das Passwort allein zu erraten bringt einem Angreifer nichts.
- `seal` mit Passwort und ohne Zufallsgeheimnis wird abgelehnt, ausser du gibst `--accept-password-only` an. Das ist für lokale Dateien gedacht, die du für dich behältst.
- `publish` (und die Bibliotheksprüfung `assertPublishable()`) lehnen einen nur durch ein Passwort geschützten Datensatz ab.
- Der Passwort-Faktor wird mit **Argon2id** gestreckt, einer speicherintensiven Funktion (standardmässig 64 MiB und 3 Durchgänge, etwa 1 Sekunde in Chromium und 2 in Firefox): Jeder Versuch kostet den Angreifer Speicher und Zeit, was GPUs ausbremst. Das macht Raten langsamer; es macht ein schwaches Passwort nicht stark.
- In einem **Tresor** (ein Schlüssel, den mehrere Faktoren halten, Abschnitt 5) kann die Passphrase nie allein etwas öffnen: Der Code weigert sich, einen Tresor zu bauen, in dem eine öffnende Faktorenmenge nur aus Passphrasen besteht.

## 5. Was wir stattdessen empfehlen (drei Varianten)

| Variante | Für wen | Was du aufbewahrst | Wenn du verlierst... |
|---|---|---|---|
| **A. Ein Zufallsschlüssel, im Passwortmanager oder in einer Datei** | Die meisten, für die meisten Daten | Einen Schlüssel pro Datensatz (etwa 60 Zeichen) | den Schlüssel: der Datensatz ist verloren |
| **B. Ein Seed, viele Datensätze** | Wer viel versiegelt | Den Seed (12 bis 24 Wörter, auf Papier, sicher verwahrt). Jeder Datensatz bekommt daraus einen eigenen Schlüssel | den Seed: alles daraus Versiegelte ist verloren; wer den Seed stiehlt, öffnet alles |
| **C. Ein Tresor mit 2 von 3 Faktoren** | Wer bequemen Zugang *und* ein Sicherheitsnetz will | Beliebige zwei von: Seed-Backup, Passkey, Passphrase | einen Faktor: nichts, die anderen zwei öffnen ihn noch; eine Passphrase allein öffnet nichts |

**Prüfe dein Gerät, bevor du dich auf einen Passkey verlässt**, mit der Geräteprüfung unter [typographics-art.org/passkey-check](https://typographics-art.org/passkey-check): Sie testet in deinem Browser und ohne etwas zu senden, ob dein Passkey oder Sicherheitsschlüssel jedes Mal dasselbe Geheimnis liefert. Nicht jeder Browser und nicht jedes Gerät unterstützt das, und ein synchronisierter Passkey kann sich anders verhalten als ein Hardware-Schlüssel. Das Seed-Backup bleibt in jedem Fall der Weg zurück.

**Nimm einen eigenen Seed für Daten.** Nimm nicht den Seed einer Wallet, in der Geld liegt: Wer ihn stiehlt, bekäme auch deine Daten, und ein verlorener Wallet-Seed würde deine Daten verlieren. (Die Wallet der Plattform ist reine Beobachtung, und ihren Seed verwaltet der Betreiber; sie ist deshalb nie ein Ort für private Nutzerdaten.)

**Eine gute Passphrase wird erzeugt, nicht erfunden.** Die Werkzeuge ziehen Wörter gleichverteilt aus der BIP-39-Liste (2048 Wörter, 11 Bit pro Wort, exakt gleichverteilt): 6 Wörter sind 66 Bit, 8 Wörter 88 Bit. Acht erzeugte Wörter sind ein starker *zusätzlicher* Faktor; als *einzigen* Schutz eines dauerhaften öffentlichen Datensatzes raten wir trotzdem nicht dazu (88 Bit sind nicht 128, und Menschen gehen mit Wörtern um, nicht mit Zufallsbytes, mit allen Lecks aus Abschnitt 3).

## 6. Was wir nicht versprechen

- **Kein externes Audit.** Das Verfahren ist Standard, der Code darum herum ist unserer. Abschnitt 9 sagt, was getan wurde; nichts davon ersetzt eine Prüfung durch Fachleute. Wir empfehlen sie, bevor etwas Wertvolles versiegelt und weitergegeben wird.
- **Ein verlorener Schlüssel sind verlorene Daten.** Es gibt keine Wiederherstellung, kein Zurücksetzen, keinen Support, der es öffnen könnte.
- **Ein kompromittiertes Gerät hebelt alles aus.** Eine bösartige Browser-Erweiterung, Schadsoftware oder ein gestohlenes entsperrtes Handy können lesen, was du tippst, und sehen, was die Seite entschlüsselt. Verschlüsselung schützt ruhende und übertragene Daten, nicht einen Rechner, der schon feindlich ist.
- **Metadaten sind nicht verborgen.** Ein versiegelter Datensatz zeigt seine Grösse (ausser mit Auffüllung), und wer ihn erhält, weiss, dass es ihn gibt und wann er geteilt wurde.
- **Die versteckten Nachrichten mit der Buchchiffre sind keine Verschlüsselung.** Sie verbergen eine Nachricht im öffentlichen Text eines Werks vor jemandem, der das Verfahren nicht kennt; nimm für alles, was geheim bleiben muss, versiegelte Daten ([hidden-messages.md](hidden-messages.md)).
- **Quantencomputer:** AES-256 behält gegen die beste bekannte Quantensuche 128 Bit, was noch ausser Reichweite ist. Der *asymmetrische* Teil (Versiegeln für einen öffentlichen Schlüssel, `tgr1.`) nutzt X25519, das ein grosser Quantencomputer brechen würde; eine Hybridvariante mit einem quantensicheren Verfahren ist entworfen, nicht gebaut, weil Browser noch keines anbieten.

## 7. Warum wir nichts anderes gewählt haben

| Alternative | Was wir fanden | Entscheid |
|---|---|---|
| Ein anderes Verfahren (ChaCha20-Poly1305, XChaCha20, AES-GCM-SIV) | In der eingebauten Browser-Kryptografie nicht verfügbar (gemessen in Chromium 154 und Firefox 153); gleiche Sicherheitsklasse; es hiesse, eine Code-Bibliothek einzubauen | AES-256-GCM bleibt |
| Zwei Verfahren hintereinander | Fast nichts gewonnen, echte Kosten und mehr Code | Nein |
| Ein grösserer Schlüssel | AES-256 hat schon den grössten Standardschlüssel | Nichts zu tun |
| Nur Passwort, mit sehr langsamer Ableitung | Langsam vervielfacht die Kosten des Angreifers nur um eine Konstante; die wenigen Bits des Passworts bleiben die Grenze, und der Datensatz kann für immer angegriffen werden | Für öffentliche Daten abgelehnt |
| Deine Schlüssel „zur Wiederherstellung" auf einem Server | Dann kann der Betreiber deine Daten lesen, und jeder, der einbricht | Nicht angeboten: Schlüssel bleiben bei dir |
| Verbergen, zu welchem „Buch" ein Schlüssel gehört, als Schutz | Das ist Unbekanntheit im Wert von etwa 17 bis 20 Bit (einige hunderttausend bis eine Million Kandidatentexte), und ein Angreifer kann jeden Kandidaten automatisch prüfen | Nur dafür genutzt, das Werk nicht in einem Schlüssel zu *nennen* (`tgx2.`), nie als Schutz |

## 8. Die kurze Praxisliste

**Tun**
- Lass das Werkzeug den Schlüssel erzeugen; bewahre ihn in einem Passwortmanager oder auf einem Offline-Zettel auf.
- Halte eine zweite Kopie von Schlüssel oder Seed getrennt bereit (Tresor, versiegelter Umschlag).
- Nimm für Daten einen eigenen Seed, nicht den deiner Wallet.
- Teste das Öffnen eines Datensatzes, bevor du etwas anderes löschst.
- Gib einen Schlüssel der Kommandozeile lieber per Datei, Standardeingabe oder Umgebungsvariable.

**Nicht tun**
- Verlass dich für nichts Öffentliches auf ein Passwort allein.
- Schreib keinen Schlüssel oder Seed in einen Chat, eine E-Mail, einen Screenshot oder eine URL.
- Tipp deinen Seed nicht auf einer Seite ein, die du nicht von typographics-art.org geöffnet hast, und nicht auf einem Gerät, dem du nicht traust.

## 9. Selbst nachprüfen

Alles ist aus dem Repository reproduzierbar (Node 22 oder neuer):

```sh
node --test test/                       # die ganze Suite, mit den Schlüssel- und Verfahrenstests
node scripts/cipher-probe.mjs           # welche Verfahren es in diesem Node gibt (und, mit Browser, dort)
node scripts/crypt-measure.mjs          # die Schlüssellängen- und Grössentabellen von encrypted-data.md
node cli/tg-crypt.mjs --help            # die Befehle; Geheimnisse nur per Datei, Standardeingabe oder Umgebung
```

- Die Konformanzvektoren (eingefrorene Eingaben und Ausgaben) liegen in `test/fixtures/`; der Trezor-BIP-39-Vektor und die veröffentlichten SLIP-21-Testschlüssel gehören dazu, die Seed-Ableitung lässt sich also mit anderen Werkzeugen vergleichen.
- Browser und Node liefern byte-identische Ergebnisse bei der Schlüsselableitung (in Chromium und Firefox ohne Fenster geprüft).
- Der mitgelieferte Argon2id-Code (`assets/vendor/noble-hashes/`, MIT) wurde gegen das veröffentlichte Paket auf Unversehrtheit geprüft; seine Ausgabe stimmt mit dem eigenen Argon2id von Node überein.
- Jede Grenze wird erzwungen, bevor Arbeit geleistet wird (ein 5 MB grosser „Schlüssel", ein 200-MB-Datensatz oder eine Kompressionsbombe werden in weit unter einer Sekunde abgelehnt; getestet).
- Fehlermeldungen enthalten nie Schlüssel, Passwort oder Nachricht (getestet), und Geheimnisse werden nie als Kommandozeilenargument angenommen.

Wenn du einen Fehler im Aufbau, im Code oder auf dieser Seite findest, sag es bitte: Für private Meldungen siehe [SECURITY.md](../SECURITY.md), für alles andere [CONTRIBUTING.md](../CONTRIBUTING.md). Ein offen gefundener und behobener Fehler ist, wie ein solches Projekt Vertrauen verdient.

## 10. Glossar

- **Verfahren (Cipher)**: die Methode, die Daten mit einem Schlüssel verwürfelt (hier AES-256-GCM).
- **Schlüssel**: das Geheimnis, das einen versiegelten Datensatz öffnet. **Seed**: das Backup, aus dem Schlüssel abgeleitet werden. **Anteil (Share)**: ein Stück eines zerlegten Schlüssels.
- **Datensatz (Record)**: die versiegelten (verschlüsselten) Daten.
- **KDF** (Schlüsselableitung): macht aus einem Passwort einen Schlüssel; eine **speicherintensive** KDF wie Argon2id macht jeden Versuch teuer.
- **Offline-Angriff**: Raten gegen eine Kopie des Datensatzes, ohne Server, der den Angreifer bremsen oder stoppen könnte.
- **Stärke in Bit**: Ein Geheimnis mit n Bit braucht etwa 2^n Versuche, um durch Probieren gefunden zu werden.
- **Audit**: eine Prüfung des Codes durch unabhängige Fachleute.
