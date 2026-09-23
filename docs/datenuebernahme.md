# Datenübernahme

**Stand:** 2026-09-22
**Status:** umgesetzt; Datenbankpfade noch gegen PostgreSQL (CI/Staging) nachzuweisen

Die Datenübernahme bringt Daten aus Excel, CSV, JSON oder einem anderen
Programm nach SoloOffice. Sie richtet sich an drei Fälle:

1. **Stammdaten:** Kunden, Positionen, Stundensätze, Materialien.
2. **Excel-Buchhaltung:** eine Tabelle mit Einnahmen und Ausgaben, oft ohne
   geschriebene Rechnungen (z. B. Unterricht, der direkt bezahlt wurde).
3. **Programmwechsel:** Rechnungen mit Nummern, Zahlungen, Aufträge/Kurse und
   Angebote aus einem anderen Programm.

## Grundsätze

- **Jede Einnahme hat genau eine Quelle.** Geld, das zu einer Rechnung gehört,
  wird ausschließlich als Zahlung dieser Rechnung gebucht. Nur Einnahmen ohne
  Rechnungsbezug werden als „Einnahme ohne Rechnung“ gebucht. So zählt kein
  Geldeingang doppelt – weder in der EÜR noch in Übersicht und Auswertungen.
- **Keine nachträglich erfundenen Rechnungen.** Wo es keine Rechnung gab,
  entsteht beim Import auch keine. Die Einnahme wird mit Datum, Betrag und
  (optional) Kunde gebucht.
- **Übernommene Rechnungen bleiben Fremddokumente.** Sie behalten Nummer, Datum
  und Zahlungsstand. SoloOffice erzeugt für sie nie ein eigenes PDF; maßgeblich
  ist das Original, das an der Rechnung hinterlegt werden kann.
- **Erst prüfen, dann speichern.** Jede Datei durchläuft eine serverseitige
  Vorschau mit Zeilenstatus und Summenkontrolle. Gespeichert wird erst nach
  ausdrücklicher Übernahme, in einer Transaktion.
- **Rückgängig bis zum Abschluss.** Jeder Import ist ein Importlauf. Bis der
  Umzug abgeschlossen wird, lässt er sich vollständig zurücknehmen.

## Ablauf für Anwender

Einstieg: **Einstellungen → E-Mail & Backup → Datenübernahme** (Hash
`#data-import`). Die Seite zeigt die empfohlene Reihenfolge; jede Karte öffnet
den Import-Assistenten und bietet eine CSV-Vorlage zum Herunterladen.

1. Kunden bzw. Schüler/Mandanten
2. Leistungen und Preise (nur Administratoren)
3. Rechnungen (Altbestand)
4. Einnahmen und Ausgaben
5. Zahlungseingänge
6. Aufträge/Kurse und Angebote (nur wenn das Modul aktiv ist)

Die bisherigen Import-Knöpfe auf den Fachseiten bleiben erhalten. Auf den
Belegseiten ist die Art fest auf „Ausgabe“ gesetzt; die EÜR-Seite bietet unter
„Buchung → Aus Datei importieren“ Einnahmen und Ausgaben.

**Stichtag:** Ab diesem Tag arbeitet der Betrieb mit SoloOffice. Importierte
Buchungen und Rechnungen ab dem Stichtag werden in der Vorschau als Warnung
markiert („ist die Buchung schon in SoloOffice erfasst?“). Für eine vollständige
EÜR sollte das laufende Jahr bis zum Stichtag übernommen werden.

**Umzug abschließen:** schließt alle offenen Importläufe ab. Danach ist kein
Rückgängigmachen mehr möglich; die Daten bleiben unverändert.

### Beispiel: Nachhilfe-Tabelle

Tabelle mit den Spalten `Datum`, `Schüler`, `Stunden`, `Pro Stunde`:

1. „Einnahmen und Ausgaben“ öffnen und die .xlsx-Datei wählen. Datum, Schüler,
   Stunden und Preis pro Stunde werden automatisch zugeordnet.
2. „Art“ → *Festen Wert verwenden* → **Einnahme**; optional Beschreibung
   „Unterricht“ und MwSt.-Satz 0.
3. **Fehlende Schüler anlegen** anhaken.
4. Vorschau prüfen: Summen je Monat mit der Tabelle vergleichen, dann
   übernehmen.

Die Einnahmen erscheinen in der EÜR mit Kundenbezug („Manuell · Anna“), in der
Übersicht, in den Auswertungen und bei den Top-Kunden. Optional lassen sich
dieselben Zeilen zusätzlich als Unterrichtstermine mit Status „abgerechnet“
importieren.

## Der Import-Assistent

| Schritt | Inhalt |
| --- | --- |
| 1 Datei | .xlsx, .csv, .tsv, .txt oder .json bis 10 MB; Vorlage zum Herunterladen |
| 2 Zuordnung | Spalten, feste Werte, Werte-Zuordnung, Optionen, Leseprobe der ersten Zeilen |
| 3 Vorschau | Zeilenstatus mit Filtern, Summenkontrolle, neu anzulegende Kunden, Hinweiszeilen als CSV |
| 4 Ergebnis | gespeicherte Datensätze, Verweis auf die Datenübernahme zum Rückgängigmachen |

**Datei lesen** (`src/utils/importParser.ts`, `src/utils/xlsxReader.ts`)

- Excel-Arbeitsmappen werden ohne Fremdbibliothek gelesen (ZIP und XML; Formeln
  liefern ihren gespeicherten Wert, Makros werden nie ausgeführt). Datumszellen
  werden über das Zahlenformat erkannt. Bei mehreren Tabellenblättern ist das
  Blatt wählbar. Alte .xls/.ods-Dateien werden mit Hinweis abgelehnt.
- Textdateien: UTF-8, UTF-16 und – als Rückfall – Windows-1252 (deutsches
  Excel-CSV) mit Hinweis. Trennzeichen werden erkannt.
- Die Kopfzeile ist die erste Zeile mit mindestens zwei befüllten Zellen unter
  den ersten 20 Zeilen; Titelzeilen darüber und Summenzeilen („Summe“,
  „Gesamt“, …) werden mit Hinweis ausgelassen. Zeilennummern entsprechen der
  Anzeige in Excel.
- Je zugeordneter Spalte werden Zahlenformat (1.234,56 oder 1,234.56) und
  Datumsreihenfolge erkannt und angezeigt; nicht lesbare Werte werden gezählt.

**Zuordnung**

- Automatische Zuordnung über deutsche und englische Spaltennamen; nur echte
  Mehrdeutigkeiten werden zur Prüfung markiert.
- **Feste Werte** für ganze Spalten, etwa Art, Status, Steuersatz oder Titel.
- **Werte-Zuordnung** für Auswahlfelder (Art, Kategorie, Status, Kundenart,
  Wiederholung): eigene Werte wie „Kfz“ oder „Fahrt“ werden einer
  SoloOffice-Auswahl zugeordnet; Vorschläge kommen automatisch.
- Wird dieselbe Spaltenstruktur erneut importiert, übernimmt der Assistent die
  Zuordnung, festen Werte und Optionen des letzten Imports. Eine bereits
  importierte Datei (gleicher SHA-256) wird angezeigt.

## Importziele und Regeln

Alle Regeln stehen in `backend/utils/importPlanner.js` und
`backend/utils/importValues.js`.

| Ziel | Pflicht | Besonderheiten |
| --- | --- | --- |
| Kunden | Name (oder Vor-/Nachname) | Aktualisieren ändert nur zugeordnete, befüllte Felder und nennt sie; Straße + Hausnummer werden zusammengeführt |
| Positionen, Stundensätze, Materialien | Name, Preis | aktualisierbar; nur Administratoren |
| Aufträge/Kurse | Datum, Kundenbezug | Titel fällt auf den Terminologiebegriff zurück; Serien über „Wiederholung“ + „Wiederholen bis“ oder „Anzahl Termine“ |
| Angebote | Kundenbezug, Position oder Gesamtbetrag | mehrere Zeilen je Angebotsnummer werden gruppiert |
| Einnahmen und Ausgaben | Datum, Betrag | siehe unten |
| Zahlungseingänge | Zahlungsdatum, Betrag, Rechnungsbezug | wie bisher, Dubletten jetzt unabhängig von Notizen |
| Rechnungen (Altbestand) | Nummer, Datum, Kundenbezug, Betrag | siehe unten |

**Werte lesen:** „1.234“ ist 1234 (deutsches Tausenderformat), „10,-“ ist 10,
Klammern und nachgestellte Minuszeichen sind negativ. Datumswerte werden ohne
freien `Date`-Parser gelesen (TT.MM.JJ(JJ), ISO, JJJJMMTT, Monatsnamen,
Excel-Seriennummern); zweistellige Jahre 00–69 gelten als 20xx.

**Kunden finden:** über ID, Nummer, E-Mail, exakten Namen und zuletzt über
Namensteile. Ein Namensteil passt nur als ganzes Wort und nur eindeutig
(„Anna“ → „Anna Müller“, nicht „Johanna“); eine solche Zuordnung wird zur
Prüfung markiert. Mit **Fehlende … anlegen** entsteht jeder unbekannte Name
genau einmal, auch wenn er in vielen Zeilen vorkommt.

**Einnahmen und Ausgaben**

- Art aus Spalte, festem Wert, getrennten Einnahme-/Ausgabespalten oder
  Vorzeichen. Enthält die Datei negative Beträge und keine Art, gelten negative
  als Ausgaben und positive als Einnahmen; sonst muss die Art angegeben werden.
- Betrag aus der Betragsspalte oder aus Menge × Einzelpreis (Abweichungen
  werden gemeldet). Beträge sind brutto.
- Einnahmen mit Rechnungsnummer werden als Zahlung dieser Rechnung gebucht.
  Ohne Nummer wird – sofern aktiviert – eine offene Rechnung desselben Kunden
  mit genau diesem offenen Betrag gesucht (älteste zuerst) und die Einnahme als
  deren Zahlung gebucht; das wird zur Prüfung markiert.
- Kundenbezug gilt nur für Einnahmen; bei Ausgaben steht dort meist ein
  Lieferant.
- Fehlende Kategorie → „Sonstige Betriebsausgaben“, fehlender Steuersatz → 0 %;
  beides ist eine Warnung, weil es steuerlich relevant ist.
- Jede übernommene Buchung erhält, wenn keine eigene Notiz mitkommt, den
  Herkunftsvermerk „Datenübernahme: Datei, Zeile N“.

**Dubletten:** Vorhandene Buchungen und Termine werden gezählt
(Mehrfachmengen). Kommt eine Buchung zweimal in der Datei vor und einmal im
Bestand, wird genau eine neu angelegt. Ein erneuter Import derselben Datei
ergibt nur Duplikate. Eine Einnahme am selben Tag über denselben Betrag wie eine
bereits erfasste Zahlung desselben Kunden gilt als Duplikat; sonst gibt es
einen Prüfhinweis.

**Hinweise und Warnungen:** Informationen (neuer Kunde, vorgegebener Titel,
erzeugte Beschreibung, Serie) lassen eine Zeile „Bereit“. Warnungen markieren
Punkte, die geprüft werden sollten (Steuersatz, Kategorie, Status, Namensteil,
automatische Rechnungszuordnung, Stichtag).

## Übernommene Rechnungen

- Zeilen mit derselben Rechnungsnummer bilden eine Rechnung; Einzelpositionen
  sind optional. Ohne Positionen entsteht je Zeile bzw. Steuersatz eine
  Sammelposition; aus Brutto wird Netto so bestimmt, dass die centgenaue
  Steuerberechnung wieder den Bruttobetrag ergibt. Weicht der angegebene
  Rechnungsbetrag ab, ist die Zeile ein Fehler.
- Zahlungsangaben: „Bezahlt am“, „Bezahlter Betrag“ und/oder Zahlungsstatus.
  Fehlt bei „bezahlt“ das Datum, wird das Rechnungsdatum verwendet und gewarnt,
  weil für die EÜR das tatsächliche Zahlungsdatum zählt. Teilzahlungen lassen
  den Rest offen; offene Rechnungen sind „versendet“ oder „überfällig“ und
  können gemahnt werden.
- Datenbank: `invoices.origin = 'imported'`. Die Rechnung wird als Entwurf mit
  Positionen angelegt und sofort ausgestellt; danach greift der bestehende
  Unveränderbarkeits-Trigger.
- Original: `invoice_original_documents` (PDF, XML, PNG, JPEG bis 10 MB,
  SHA-256). Hochladen über „Original hinterlegen“ an der Rechnung. Solange der
  Importlauf offen ist, lässt es sich ersetzen oder entfernen; danach nur noch
  erstmalig hinterlegen, nicht ersetzen.
- Vorschau, Download und Mahnungsanhang verwenden das Original
  (`loadImportedInvoiceOriginal` in `src/utils/pdfGenerator.ts`). Ohne Original
  zeigt die App einen Hinweis statt eines neu erzeugten Dokuments.
- Nummernkreis: Die eigenen Nummern laufen weiter. Fremde Nummern zählen nur
  plausibel mit (`legacyCounter` in `backend/utils/invoiceNumberPattern.js`):
  „R20250042“ und „17/2025“ ergeben 42 bzw. 17, unplausibel große Werte werden
  ignoriert.

## Importläufe und Rückgängig

Tabellen `import_runs` (Datei, Hash, Spalten, Zuordnung, Zusammenfassung,
Zeilenprotokoll, Status `pending`/`confirmed`/`reverted`) und
`import_run_items` (Tabelle, Datensatz, `created`/`updated`, alte Werte).

Rückgängig machen (`POST /api/imports/runs/:id/revert`) arbeitet in einer
Transaktion, in umgekehrter Reihenfolge:

- EÜR-Buchungen werden storniert (`voided`, Grund „Import rückgängig gemacht“),
  nie gelöscht; der Änderungsverlauf bleibt.
- Übernommene Rechnungen werden gelöscht. Dafür erlaubt Migration 044 im
  Schutz-Trigger eine einzige Ausnahme: `origin = 'imported'` und die
  transaktionslokale Einstellung `app.import_revert`. Die Löschung wird in
  `invoice_history` protokolliert.
- Angelegte Kunden, Termine, Serien, Angebote und Preise werden entfernt,
  aktualisierte Stammdaten auf ihre alten Werte gesetzt.
- Rechnungsstatus werden neu berechnet.

Das Rückgängigmachen wird mit Begründung abgelehnt, wenn inzwischen etwas
darauf aufbaut: weitere Dokumente oder Buchungen eines angelegten Kunden,
Zahlungen/Gutschriften/Mahnungen zu einer übernommenen Rechnung, abgerechnete
Termine oder umgewandelte Angebote. Spätere Importe müssen dann zuerst
zurückgenommen werden. Abgeschlossene Läufe lassen sich nicht zurücknehmen.

## Schnittstellen

| Methode und Pfad | Zweck | Recht |
| --- | --- | --- |
| `POST /api/imports/:resource` | Vorschau (`dryRun`) oder Übernahme | `data.write`; Preise `workspace.settings` |
| `GET /api/imports/runs`, `GET /api/imports/runs/:id` | Verlauf, Protokoll | Lesen |
| `POST /api/imports/runs/:id/revert` | Rückgängig machen | `data.write` (Preise: `workspace.settings`) |
| `POST /api/imports/runs/:id/confirm`, `POST /api/imports/runs/confirm-all` | Abschließen | `data.write` |
| `GET`/`PUT /api/imports/settings` | Stichtag | Ändern: `workspace.settings` |
| `GET`/`PUT`/`DELETE /api/imports/original-documents/:invoiceId` | Original einer übernommenen Rechnung | Ändern: `data.write` |

Anfragen an `/api/imports` dürfen bis 25 MB groß sein (bis zu 5.000 Zeilen je
Import, Zellen bis 100.000 Zeichen). Weitere Optionen im Rumpf:
`duplicateMode`, `createMissingCustomers`, `matchOpenInvoices`, `file`
(Name, Hash, Spalten) und `settings` (Zuordnung für die Wiederverwendung).

## Architektur

- **Gemeinsame Planung:** `backend/utils/importPlanner.js` (Prüfung,
  Meldungen, Summen) und `backend/utils/importValues.js` (Werte lesen) sind
  datenbankfrei und browserfähig. Server, Demo-Modus und Import-Assistent nutzen
  sie gemeinsam; neue Regeln gehören dorthin.
- **Server:** `backend/routes/imports.js` lädt den Workspace-Bestand, plant,
  schreibt in einer Transaktion und protokolliert den Lauf.
- **Demo:** `src/services/demoApi.ts` plant mit denselben Modulen und schreibt
  in den Browserzustand (Originale dort bis 1 MB).
- **Serienregeln:** `backend/utils/jobRecurrenceRule.js`, gemeinsam mit der
  Auftragsroute.
- **Oberfläche:** `src/components/ImportWizard.tsx`,
  `src/components/DataImportCenter.tsx`.
- **Migration 044** (`backend/migrations/044_data_import_runs.js`):
  Importläufe, `euer_entries.customer_id`, `invoices.origin`,
  `invoice_original_documents`, `company.import_cutover_date`,
  Trigger-Ausnahme. Alle neuen Tabellen haben erzwungene Row-Level Security.

## Auswirkungen auf andere Bereiche

- **EÜR:** Einnahmen ohne Rechnung können einem Kunden zugeordnet werden
  (auch manuell im Buchungsdialog); die Liste zeigt „Manuell · Kunde“.
- **Übersicht und Auswertungen:** Einnahmen ohne Rechnung zählen mit ihrem
  Buchungsdatum zum Umsatz und zu den Top-Kunden; die Auswertungen weisen den
  Anteil „ohne Rechnung“ aus. Auswertungen und EÜR bieten zehn Jahre zur Wahl.
- **Backup:** `invoice_original_documents` gehört zum Backup. `import_runs` und
  `import_run_items` gehören nicht dazu und werden bei jeder Wiederherstellung
  verworfen. Ein Backup aus einem anderen Workspace wird nach ausdrücklicher
  Bestätigung übernommen (`allowWorkspaceTransfer`); existieren dieselben
  Datensätze auf diesem Server bereits in einem anderen Workspace, lehnt der
  Server mit einer klaren Meldung ab.
- **Workspace-Löschung:** entfernt Importläufe und Originale mit.
- **Kundennummern:** Das Anlegen in der App übergeht nicht numerische Nummern
  (z. B. importierte „K-1001“) statt abzubrechen; der Import vergibt Nummern im
  selben Schema (0001, 0002, …).

## Nachweise

Stand 2026-09-22:

- **Automatisiert (lokal ausgeführt):** `backend/test/importValues.test.js`,
  `backend/test/importPlanner.test.js`, `backend/test/invoiceNumberPattern.test.js`
  sowie die Import-Tests in `test/frontend/importParser.test.mjs` (u. a. echte
  .xlsx-Datei, Windows-1252, die Nachhilfe-Tabelle). ESLint, TypeScript,
  Vite-Build und `scripts/verify-audit-contracts.mjs` ohne Befund.
- **Automatisiert, nur in der CI:** `backend/test/integration/dataImport.test.js`
  prüft gegen PostgreSQL Import, übernommene Rechnungen, Original, Abgleich,
  blockiertes und umgekehrtes Rückgängigmachen, Trigger-Schutz und Abschluss.
  Lokal gibt es kein PostgreSQL; der Test ist noch nicht gelaufen.
- **Manuell im Demo-Modus (Browser):** kompletter Ablauf mit der
  Nachhilfe-Tabelle bis EÜR, Übersicht und Auswertungen; Wiedererkennung
  derselben Datei; Rechnungsimport mit Original und Vorschau; Abgleich einer
  Einnahme mit einer offenen Rechnung; Kursserie; Rückgängig in umgekehrter
  Reihenfolge und blockiertes Rückgängig; 375 px Breite; heller und dunkler
  Modus.
- **Offen:** Migration 044 und die Datenbankpfade auf Staging bzw. in der CI;
  die Punkte in der [manuellen Release-Checkliste](manual-release-checklist.md).

## Offene Punkte und Produktentscheidungen

- **Steuerliche Rückfrage (offen):** Aufbewahrung – die Originale (Tabelle,
  vorhandene PDFs) bleiben außerhalb von SoloOffice aufbewahrungspflichtig; der
  Import ersetzt sie nicht. Bereits erklärte Jahre sind in SoloOffice nur
  informativ, maßgeblich bleibt die eingereichte Erklärung. Empfehlung: keine
  Rechnungen nachträglich erzeugen, sondern Einnahmen ohne Rechnung buchen. Eine
  kurze Bestätigung durch eine Steuerberatung steht aus.
- **Noch nicht umgesetzt:** Zuordnungsprofile für bestimmte Programme (dafür
  werden echte, anonymisierte Exporte benötigt), DATEV-Buchungsstapel,
  Gutschriften im Rechnungsimport, Kontoauszüge (CAMT/MT940).
- **Bekannte Altlast außerhalb der Datenübernahme:** In
  `backend/routes/jobs.js` gibt es zwei ungenutzte Variablen (ESLint-Regel
  `no-unused-vars`); Backend-JavaScript wird von der ESLint-Konfiguration bisher
  nicht geprüft.
