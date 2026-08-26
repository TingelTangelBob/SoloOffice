# SoloOffice – Audit 1: Code, Architektur & Recht

- **Stand:** 2026-08-26
- **Geprüfter Commit:** `c68d787`
- **Status:** Umgesetzt mit ausdrücklich markierten offenen Nachweisen

**Ausgangsanalyse:** 2026-08-06; Arbeitsbaum nach Umsetzung der Auditpunkte.
**Methode:** Die Ausgangsanalyse nutzte statische Prüfungen; Docker war am
2026-08-06 lokal nicht verfügbar. Aktuelle Docker-, Datenbank-, RLS- und
Restore-Nachweise stehen in `docs/` und der Go-Live-Statustafel.
**Zweck:** Umsetzungs- und Nachweisdokument für Code, Architektur, E-Rechnung, Deployment, Lizenz und SaaS-Reife.

> **Statussymbole:** ✅ umgesetzt und lokal geprüft · 🟠 teilweise umgesetzt bzw. externe Betriebs-/Validierungsabhängigkeit · 🔴 Produktlücke oder noch nicht sicher freigabefähig.

**Umsetzungsstand:** Die sicherheitsrelevanten Codepfade, Workspace-Restore, Branding, Authentifizierungsfunktionen, XML-Generatoren und der begrenzte XML-E-Rechnungseingang wurden bearbeitet. Die grüne Markierung bedeutet statisch/lokal geprüft, nicht automatisch produktiv durch einen externen Validator oder Docker-Lauf bestätigt.

> **Teil 1 von 2.** Die Prüfung der laufenden Oberfläche (Dunkelmodus, Responsive, Demo-Modus, Abhängigkeits-Schwachstellen) steht getrennt in **[`SoloOffice-Audit-2-Oberflaeche.md`](SoloOffice-Audit-2-Oberflaeche.md)**.

---

## 1. Prüfkriterien

Selbst festgelegt, orientiert an dem, was für ein steuerlich relevantes SaaS-Produkt im deutschen Markt zählt:

| # | Kriterium | Warum |
|---|---|---|
| K1 | **Mandantentrennung** | Ein SaaS mit Rechnungsdaten darf unter keinen Umständen Daten zwischen Kunden vermischen. |
| K2 | **Authentifizierung & Sitzungen** | Passwörter, Sessions, CSRF, Brute-Force, Rechteprüfung. |
| K3 | **Deployment & Secrets** | Was ist von außen erreichbar, wie entstehen Passwörter, was landet im Image. |
| K4 | **Datenhaltung & Datenverlust** | Persistenz, Backups, Migrationen, Wiederherstellbarkeit. |
| K5 | **Fachliche Korrektheit E-Rechnung** | ZUGFeRD/XRechnung müssen normkonform sein, sonst ist das Kernversprechen wertlos. |
| K6 | **Steuerliche/rechtliche Belastbarkeit** | GoBD, Kleinunternehmer, Rechnungsnummern, DSGVO. |
| K7 | **Marken- und Rebrand-Konsistenz** | Fremdmarke im Produkt ist ein Landingpage- und Rechtsproblem. |
| K8 | **Build-Reproduzierbarkeit & Betrieb** | Lockfiles, CI, Tests, Observability. |
| K9 | **Code-Qualität & Wartbarkeit** | Typisierung, Struktur, Altlasten. |
| K10 | **SaaS-Reife** | Registrierung, Abrechnung, Onboarding, Self-Service, Support-Prozesse. |
| K11 | **Marketing-Wahrheit** | Welche Claims dürfen auf die Landingpage – und welche nicht. |

### Was in **diesem** Dokument nicht geprüft wurde

- **Kein Docker-Start** – Docker ist auf dem Prüfrechner nicht installiert. Backend, PostgreSQL, RLS, Migrationen und OCR sind daher **ausschließlich statisch** geprüft. Alle Befunde zu Abschnitt A, B und E sind aus dem Quelltext abgeleitet und **nicht zur Laufzeit bestätigt**.
- Keine Validierung erzeugter XML-Dateien gegen den echten KOSIT-Validator (Befunde in Abschnitt C sind aus dem Quelltext abgeleitet, aber eindeutig).
- Keine Penetrationstests, keine Lasttests.
- Oberfläche, Responsive-Verhalten und Dunkelmodus → **Audit 2**.

---

## 2. Gesamtbild

Das Projekt ist **technisch deutlich besser als der Durchschnitt vergleichbarer Nebenprojekte**: TypeScript strikt, fast kein `any`, saubere Kontext-Trennung im Frontend, Row-Level Security mit `FORCE`, scrypt-Hashing, CSRF-Schutz, Pfad-Traversal-Schutz bei Backups, dokumentierte Domänenregeln. Das ist eine gute Basis. Die priorisierten Codebefunde wurden bearbeitet; die verbleibenden orange/roten Punkte sind bewusst als externe Nachweise, Betriebsbausteine oder Produktlücken markiert.

Die verbleibenden Risiken liegen in drei Clustern:

1. **Die E-Rechnung braucht externe Referenzvalidatoren.** XML-Escaping, Steuerkategorien, Leitweg-ID, Ländercodes und Fehlerverhalten sind im Code verbessert; PDF/A-3-Details und KOSIT-/FeRD-Nachweise bleiben offen.
2. **Deployment und Datenbetrieb brauchen einen echten Docker-/Datenbanklauf.** Die statische Härtung ist umgesetzt, aber in dieser Umgebung nicht gestartet.
3. **SaaS-Betrieb ist noch kein vollständiges Produkt.** Abrechnung/Control Plane, Objektspeicher, rechtliche Betreiberunterlagen und ein vollständiger E-Rechnungseingang (insbesondere ZUGFeRD-PDF) bleiben offen.

| Schweregrad | Anzahl der ursprünglichen Befunde |
|---|---|
| Kritisch | 5 |
| Hoch | 8 |
| Mittel | 10 |
| Niedrig | 6 |

Audit 2 ergänzt 1 × hoch, 3 × mittel, 2 × niedrig.

---

## A – Sicherheit & Deployment

### ✅ A1 · KRITISCH · Vorhersagbares Datenbankpasswort im Schnell-Deployment

**Umsetzung:** Beide Deploy-Pfade verwenden `openssl rand -hex 32`. Datenbank und Backend sind im Standard-Compose nur intern erreichbar; `docker-compose.debug.yml` ist der ausdrücklich opt-in Debug-Zugriff.

Die frühere zeitbasierte Passwort- und Portfreigabe ist entfernt. Beide Deploy-Pfade erzeugen zufällige Geheimnisse; Datenbank und Backend sind im Standard-Compose nur intern erreichbar. Der explizite Debug-Override ist für lokale Diagnose dokumentiert.

### ✅ A2 · KRITISCH · SQL-Injection über hochgeladene Backup-Datei

**Umsetzung:** Restore-Spalten werden gegen `information_schema.columns` geprüft; unbekannte und geheime Spalten werden verworfen. Tabellennamen kommen weiterhin ausschließlich aus festen Listen.

Die frühere direkte Verwendung der JSON-Schlüssel ist entfernt. Restore-Spalten werden je Tabelle gegen `information_schema.columns` geprüft; unbekannte, geheime und deferred Relation-Spalten gelangen nicht in das SQL-Statement.

### ✅ A3 · HOCH · Kein `.dockerignore` – Secrets landen im Image

**Umsetzung:** Root- und Backend-`.dockerignore` schließen Umgebungsdateien, Git, Abhängigkeiten, Backups und Projektunterlagen aus.

Die Dateien werden durch Root- und Backend-`.dockerignore` aus dem Build-Kontext ausgeschlossen. Das bleibt zusätzlich von korrekter Secret-Verwaltung und sauberem Image-Registry-Zugriff abhängig.

### 🟠 A4 · HOCH · Registrierung ist offen, ohne E-Mail-Verifikation

**Umsetzung:** `REGISTRATION_MODE` (`closed-after-first`, `invite-only`, offen als eigener Betriebswert) und `REQUIRE_EMAIL_VERIFICATION` sind konfigurierbar. Verifizierungslink und Login-Sperre sind implementiert; Versand/Zustellbarkeit benötigen eine konfigurierte SMTP-Umgebung.

Die Registrierung bleibt als Endpoint erreichbar, ist aber standardmäßig `closed-after-first`; zusätzlich gibt es `invite-only`. Für SaaS kann `REQUIRE_EMAIL_VERIFICATION=true` den Double-Opt-In erzwingen. Die orange Markierung betrifft die erforderliche SMTP-/Zustellkonfiguration und den fehlenden Laufzeitnachweis.

### ✅ A5 · HOCH · SMTP-Passwörter im Klartext in der Datenbank

**Umsetzung:** Migration `025_security_and_compliance` verschlüsselt Bestandswerte mit AES-256-GCM, entfernt die Klartextspalte und verlangt `ENCRYPTION_KEY`. API und Mailversand verwenden nur noch den verschlüsselten Wert.

Bestandswerte werden in Migration `025_security_and_compliance` mit AES-256-GCM verschlüsselt; die Klartextspalte wird entfernt. Ohne dauerhaft verfügbaren `ENCRYPTION_KEY` verweigert die Migration die unsichere Weiterverwendung.

### ✅ A6 · MITTEL · Kein globales Rate-Limiting, Login-Sperre nur im Prozessspeicher

**Umsetzung:** PostgreSQL-basierte Rate-Limits für API und Auth sowie routebezogene Body-Limits sind vorhanden; der unbeschränkte Login-Map-Speicher wurde entfernt.

Der frühere ungebundene Prozessspeicher wurde durch einen PostgreSQL-basierten Fixed-Window-Limiter ersetzt. Authentifizierung ist fail-closed, die übrige API hat ein globales Limit und routebezogene Body-Limits; die Bereinigung läuft regelmäßig.

### 🟠 A7 · MITTEL · Fehlende Security-Header und `helmet`

**Umsetzung:** Backend und nginx setzen zentrale Security-Header. HSTS ist opt-in über `ENABLE_HSTS`; eine vollständige CSP-/Helmet-Konfiguration bleibt deploymentabhängig.

Die zentralen Header werden in Backend und nginx gesetzt. Eine vollständige CSP und die Aktivierung von HSTS bleiben bewusst deploymentabhängig; deshalb orange statt grün.

### ✅ A8 · MITTEL · `trust proxy` nicht gesetzt

**Umsetzung:** `TRUST_PROXY` wird beim Start gesetzt und standardmäßig auf einen Reverse Proxy vertraut; dadurch sind `req.ip` und Sitzungsmetadaten hinter nginx nutzbar.

`TRUST_PROXY` wird beim Start gesetzt und `req.ip` kann damit hinter nginx für Rate-Limit und Session-Metadaten verwendet werden.

### ✅ A9 · MITTEL · Stored XSS über E-Mail-HTML

**Umsetzung:** E-Mail-HTML wird vor der Anzeige über eine lokale Allowlist sanitisiert; Skripte, aktive Inhalte, Eventhandler und unsichere URLs werden entfernt.

HTML wird vor dem Rendern über `src/utils/sanitizeHtml.ts` auf eine lokale Allowlist reduziert; aktive Inhalte, Eventhandler und unsichere URLs werden entfernt. Der `httpOnly`-Session-Cookie und der vorhandene CSRF-Schutz bleiben bestehen.

### ✅ A10 · NIEDRIG · Backend-Container läuft als root

**Umsetzung:** Das Backend-Image wechselt nach dem Anlegen von `/app` und `/backups` zu `USER node`.

`backend/Dockerfile` verwendet nach der Anlage der Laufzeitverzeichnisse `USER node`.

---

## B – Mandantenfähigkeit & Datenintegrität

### 🟠 B1 · HOCH · Backups liegen in einem flüchtigen Containerpfad

**Umsetzung:** `/backups` ist jetzt ein benanntes Compose-Volume. Offsite-/S3-Replikation und ein Wiederherstellungs-Test bleiben Betriebsaufgaben für SaaS.

Der Pfad `/backups` ist jetzt mit `backups_data` persistent. Offsite-/S3-Replikation, Rotation und ein Wiederherstellungstest sind für den SaaS-Betrieb noch offen.

### ✅ B2 · HOCH · Workspacebezogener Restore im Mehrmandantenbetrieb

**Umsetzung:** Die Sperre ist entfernt. JSON- und ZIP-Restore löschen und schreiben ausschließlich im aktiven Workspace per parametrisiertem `DELETE`/RLS.

Der Restore löscht und schreibt ausschließlich die Daten des aktiven Workspace per parametrisiertem `DELETE`; `TRUNCATE` und die Mehrmandanten-Sperre wurden entfernt. Der Ablauf muss noch in einer echten Docker/PostgreSQL-Mehrmandantenumgebung bestätigt werden.

### ✅ B3 · MITTEL · Migrationsstand wird beim Restore geschützt

**Umsetzung:** `migrations` ist nicht mehr Bestandteil von Backup-Clear oder Restore-Order; alte Backups werden dadurch ignoriert.

Die Tabelle `migrations` steht weder in `RESTORE_CLEAR_TABLES` noch in `RESTORE_ORDER`; ein altes Backup kann den Migrationsstand dadurch nicht zurücksetzen.

### ✅ B4 · MITTEL · Rechnungsnummern werden konkurrenzsicher vergeben

**Umsetzung:** `generateInvoiceNumber` verwendet einen transaktionsbezogenen PostgreSQL-Advisory-Lock je Workspace/Jahr/Dokumenttyp.

Die Generierung verwendet jetzt einen transaktionsbezogenen PostgreSQL-Advisory-Lock je Workspace, Jahr und Dokumenttyp. Der lokale Nachweis umfasst den Code; konkurrierende Datenbanktransaktionen müssen noch praktisch getestet werden.

### 🟠 B5 · MITTEL · Dateien als Base64-TEXT in PostgreSQL

**Hinweis:** Für Self-Hosting bleibt die bestehende Speicherung unverändert. S3/MinIO mit signierten URLs ist als SaaS-Infrastruktur noch offen.

`backend/migrations/015_receipts.js:12` – `content TEXT NOT NULL`; Belege bis 25 MB, JSON-Body bis 100 MB.

Base64 kostet ~33 % Overhead, die Datenbank wächst schnell, Dumps und Backups werden riesig, und jeder Beleg-Download geht durch die DB-Verbindung. Für Self-Hosting mit einem Nutzer akzeptabel – für SaaS ist Objektspeicher (S3/MinIO) mit signierten URLs die richtige Antwort.

### ✅ B6 · MITTEL · Request-Kontext verursacht keine unnötigen Folge-Roundtrips

**Umsetzung:** Der Datenbank-Client setzt den Request-Kontext nur noch bei einem Kontextwechsel der Pool-Verbindung; der Pool übernimmt das Statement-Timeout.

Der instrumentierte Client setzt den Request-Kontext nur bei einem Wechsel des Kontextschlüssels der Pool-Verbindung. Dadurch entfallen die zusätzlichen Kontext-Roundtrips für Folgeabfragen derselben Belegung.

### ✅ B7 · Positiv · Die RLS-Umsetzung selbst ist korrekt

**Ergebnis:** Die bestehende RLS-Architektur wurde nicht verändert; der workspacebezogene Restore nutzt sie jetzt korrekt.

`backend/migrations/021_identity_and_workspace_ownership.js:43,61-62`

- `FORCE ROW LEVEL SECURITY` ist gesetzt – ohne das wäre RLS für den Tabelleneigentümer wirkungslos gewesen. Das ist der Fehler, den fast alle an dieser Stelle machen.
- `NULLIF(current_setting('app.workspace_id', true), '')::uuid` liefert bei fehlendem Kontext `NULL` → keine Zeile. **Fail-closed.**
- Alle 28 fachlichen Tabellen sind erfasst; die Identity-Tabellen sind bewusst ausgenommen und werden explizit gefiltert.
- Nummernkreise wurden korrekt von global-unique auf `(workspace_id, nummer)` umgestellt.
- Mitgliedschaftsentzug wirkt sofort, weil `loadSession` über `workspace_members` joint.

Das ist solide Arbeit und sollte nicht angefasst werden.

---

## C – E-Rechnung: der kritische Block

Dies ist der Bereich mit dem größten fachlichen Nachweisbedarf. Die Generatoren wurden für die im Audit gefundenen Fehler nachgebessert. Eine produktive Compliance-Aussage setzt trotzdem die externen KOSIT-/FeRD-Validatorläufe aus [`docs/e-rechnung-validation.md`](../docs/e-rechnung-validation.md) voraus.

### 🟠 C1 · KRITISCH · Die erzeugte ZUGFeRD-Datei ist kein vollständig nachgewiesenes PDF/A-3

**Umsetzung/Hinweis:** XMP-Basis-Metadaten inklusive PDF/A-3- und ZUGFeRD-Feldern werden jetzt gesetzt. `factur-x.xml` wird eingebettet. ICC-OutputIntent, vollständige Schrifteinbettung und ein FeRD-Validatorlauf sind mit `pdf-lib` allein nicht nachgewiesen; deshalb bleibt der Punkt orange.

`src/utils/pdf/zugferdGenerator.ts:199-233`

Für eine vollständige PDF/A-3-Freigabe sind folgende Bestandteile noch nicht nachgewiesen:

- **ICC-OutputIntent mit eingebettetem Profil**
- **vollständige Schrifteinbettung**
- **Bestätigung durch den FeRD-/Factur-X-Validator**

XMP-Grundmetadaten und die ZUGFeRD-XMP-Felder werden jetzt gesetzt. `pdf-lib` allein ersetzt aber keinen externen PDF/A-Nachweis.

### ✅ C2 · KRITISCH · Falscher Dateiname des eingebetteten XML

**Umsetzung:** Der eingebettete Dateiname lautet jetzt `factur-x.xml`.

`src/utils/pdf/zugferdGenerator.ts:219`
```js
await pdfDoc.attach(xmlBytes, 'factur-x.xml', { ... })
```

ZUGFeRD 2.1/Factur-X verwendet jetzt den erwarteten Anhangsnamen **`factur-x.xml`**.

### ✅ C3 · KRITISCH · Sonderzeichen zerstören die XML-Datei

**Umsetzung:** Dynamische Textfelder in XRechnung und ZUGFeRD werden zentral escaped; XML wird vor der Ausgabe wohlgeformt geprüft.

Der frühere Befund war unvollständiges Escaping. `escapeXML()` wird nun für dynamische Text-, Adress-, Zahlungs- und Positionselemente in beiden Generatoren verwendet; anschließend prüft `assertEInvoiceXML` die Wohlgeformtheit und zentrale Pflichtfelder.

| Zeile | Feld |
|---|---|
| 55 | `BuyerReference` (Kundennummer) |
| 65–67 | Straße, Ort, PLZ des Absenders |
| 73 | Steuernummer |
| 79 | `RegistrationName` Absender |
| 82–84 | Kontaktname, Telefon, E-Mail |
| 91–101 | Adresse und Name des Kunden |
| 112–115 | IBAN, Kontoinhaber, BIC |
| 160–161 | `Description` und `Name` jeder Rechnungsposition |

Sonderzeichen werden dadurch als XML-Entitäten ausgegeben. Ein echter KOSIT-Lauf mit den genannten Sonderzeichen bleibt als externer Nachweis offen.

### ✅ C4 · HOCH · Kleinunternehmer-Rechnungen sind normwidrig

**Umsetzung:** 0-%-Aufschlüsselungen bleiben erhalten. Kleinunternehmer verwenden `E` mit Befreiungsgrund; 0-%-Positionen außerhalb der Kleinunternehmerregelung werden als `AE`/Reverse Charge ausgegeben.

`src/utils/pdf/xrechnungGenerator.ts:127,134,166`

```js
const category = taxCategoryCode(Number(rate), isSmallBusiness);
const exemption = taxExemptionReason(category);
```

Bei aktivierter Kleinunternehmerregelung (§ 19 UStG) bleiben die 0-%-Aufschlüsselungen erhalten und erhalten `E` samt Befreiungsgrund. Reverse-Charge-Fälle werden als `AE` ausgegeben. Der frühere Befund ist damit im Generator adressiert; die fachliche Validatorbestätigung bleibt offen.

Die Beispielrechnungen müssen noch gegen KOSIT geprüft werden.

### ✅ C5 · HOCH · Fehlgeschlagene XML-Einbettung wird stillschweigend verschluckt

**Umsetzung:** Ein Einbettungs- oder XML-Fehler wirft jetzt einen sichtbaren Fehler; ein normales PDF ohne strukturierte Daten wird nicht mehr zurückgegeben.

`src/utils/pdf/zugferdGenerator.ts:235-241`
Schlägt die Einbettung fehl, wird jetzt ein sichtbarer Fehler geworfen und kein scheinbar gültiges PDF ohne XML ausgeliefert. Der Fehlerpfad ist lokal statisch geprüft.

### ✅ C6 · HOCH · Widersprüchliche `CustomizationID`

**Umsetzung:** XRechnung verwendet die XRechnung-3.0-Kennung ohne ungenutzte Extension; ZUGFeRD verwendet die eigene ZUGFeRD-2.1-/EN-16931-Guideline.

Die UBL-XRechnung und das CII-ZUGFeRD-Dokument verwenden jetzt getrennte, zum jeweiligen Format passende Kennungen. Ein Validatorlauf muss die konkrete Profilwahl noch bestätigen.

### ✅ C7 · MITTEL · Ländercode fest auf DE

**Umsetzung:** Länderbezeichnungen und zweistellige ISO-Codes werden über eine gemeinsame Länder-Code-Funktion abgebildet.

`src/utils/pdf/xrechnungGenerator.ts:69` und `:97`
Die gemeinsame Funktion `countryCode()` bildet Länderbezeichnungen und ISO-Codes ab. Damit ist die frühere feste `DE`-Ausgabe im Generator beseitigt.

### ✅ C8 · MITTEL · Keine Leitweg-ID – B2G nicht möglich

**Umsetzung:** `leitweg_id`/`leitwegId` wurde migriert, in API/Typen und Kundenmaske ergänzt und wird als `BuyerReference` bevorzugt.

`BuyerReference` bevorzugt `customer.leitwegId` und fällt nur ohne Leitweg-ID auf Kundennummer bzw. `KUNDE` zurück. Für echte B2G-Rechnungen muss die ID im Kundenstamm gepflegt werden.

### ✅ C9 · MITTEL · Platzhalter-Datenmüll im Rechnungs-XML

**Umsetzung:** Zahlungsbedingungen kommen aus den Firmeneinstellungen bzw. den konfigurierten Zahlungstagen; leere Bedingungen werden weggelassen.

Die frühere Platzhalter-Bedingung `/` wird nicht mehr erzeugt. Zahlungsbedingungen kommen aus den Firmeneinstellungen bzw. Zahlungstagen; leere Bedingungen entfallen.

### 🟠 C10 · MITTEL · Kein vollständiger Empfang von E-Rechnungen

**Umsetzung/Hinweis:** Ein lokaler XML-Eingang für XRechnung und CII/ZUGFeRD ist mit SHA-256-Hash, Prüfstatus, unveränderlichem Quellinhalt, Workspace-RLS und Kundenverknüpfung vorhanden (`backend/routes/eInvoices.js`, Migration `026_incoming_e_invoices`). ZUGFeRD-PDF-Extraktion, automatische Buchung, vollständige Referenzvalidierung und ein formales revisionssicheres Archiv-/Aufbewahrungskonzept bleiben offen.

✅ **Oberfläche konsolidiert:** `Belege` führt normale Belege und E-Rechnungen jetzt in einer gemeinsamen Ansicht mit den Tabs `Alle`, `Sonstige Belege` und `E-Rechnungen`. Die fachlich getrennten Detailpfade und unveränderlichen E-Rechnungsquellen bleiben erhalten (`src/components/DocumentsManagement.tsx`).

Der Eingang verarbeitet derzeit XML-Dateien. ZUGFeRD-PDF-Dateien mit eingebettetem `factur-x.xml` müssen noch über einen PDF-/Attachment-Parser integriert werden. Die technische Ablage ist eine Grundlage, aber keine rechtliche Zusicherung einer revisionssicheren Archivierung.

Für die Landingpage darf deshalb nur „XRechnung-/CII-XML lokal empfangen und strukturell prüfen“ behauptet werden; vollständiger ZUGFeRD-Eingang und steuerliche Archivkonformität bleiben Roadmap bzw. Betriebsaufgabe.

### 🟠 C11 · Falscher Claim · „Automatische Struktur- und Regelprüfungen"

**Umsetzung/Hinweis:** Es gibt jetzt eine lokale Wohlgeformtheits- und Pflichtfeldprüfung. Schema-/Schematron-Regeln und KOSIT-/FeRD-Referenzvalidatoren sind nicht eingebunden; der Claim darf daher nicht als vollständige automatische Regelvalidierung verwendet werden.

Die lokale Prüfung ist bewusst nur eine Wohlgeformtheits- und Pflichtfeldprüfung. Eine Schema-/Schematron-Prüfung und die Referenzvalidatoren sind nicht eingebunden; der Claim muss deshalb eingeschränkt bleiben.

> **Empfehlung für den gesamten Block C:** Vor der Landingpage einen Testlauf mit dem offiziellen KOSIT-Validator und dem ZUGFeRD-Referenzvalidator gegen je eine Beispielrechnung (Regelbesteuerung, Kleinunternehmer, Auslandskunde, Sonderzeichen im Namen) fahren. Das Ergebnis entscheidet, welche Compliance-Claims überhaupt geführt werden dürfen.

---

## D – Branding & Rebrand-Reste

### ✅ D1 · HOCH · Eigenes SoloOffice-Standardlogo

Die Standardassets `backend/assets/SoloOffice.png`, `backend/assets/SoloOffice_Icon.png` und `public/SoloOffice_Icon.png` wurden durch ein eigenes SoloOffice-Icon ersetzt. Eine visuelle Prüfung im laufenden Browser konnte mangels Docker/Browser in dieser Umgebung nicht erfolgen.

### ✅ D2 · HOCH · Leeres Standard-Firmenprofil mit geführtem Onboarding

Die Standardwerte für Firmenname, Adresse, Kontakt, Steuer-ID, IBAN und Website sind leer. Ein Onboarding-Banner führt zu den Firmeneinstellungen; Rechnungsversand und Mahnversand prüfen die erforderlichen Firmendaten und blockieren mit einer 409-Antwort, solange sie fehlen.

### ✅ D3 · MITTEL · README auf SoloOffice und Fork-Herkunft aktualisiert

Die README wurde auf SoloOffice, Docker-Betrieb, Sicherheitskonfiguration, E-Rechnungsgrenzen, Lizenz und Fork-Herkunft aktualisiert. Fremde Support- und Verkaufsadressen wurden entfernt; die Herkunft ist zusätzlich in [`NOTICE.md`](../NOTICE.md) dokumentiert.

### 🟠 D4 · MITTEL · Screenshots zeigen die alte Oberfläche

Alle acht Bilder in `demo/` stammen aus dem belego-Commit `df4a96c` (vor dem Rebrand). Sie zeigen den belego-Schriftzug in der Kopfzeile und eine Navigation mit neun Punkten – die aktuelle App hat zusätzlich Steuern/EÜR/Anlagenverzeichnis, Belege, Gutschriften und wiederkehrende Rechnungen.

Für die Landingpage werden ohnehin frische Aufnahmen gebraucht; die alten sollten dabei ersetzt werden.

### ✅ D5 · NIEDRIG · Weitere Fundstellen

Die verbleibenden Treffer für „Belego/belego" außerhalb von `node_modules` sind überwiegend historische Dokumentation bzw. bewusst kompatible Infrastruktur:

- `src/utils/dismissedNoticeStorage.ts` migriert den alten localStorage-Schlüssel einmalig auf `solooffice:...`
- `deploy-instance.sh`, `manage-instances.sh` – Container- und Projektnamen `belego-<instanz>` bleiben laut `CONTEXT.md:81` bewusst wegen Kompatibilität bestehen
- `AGENTS.md`, `docs/superpowers/plans/...`

### ✅ D6 · NIEDRIG · Favicon wird mit dem Frontend-Build ausgeliefert

`public/SoloOffice_Icon.png` liegt jetzt im Frontend-Quellbaum und wird von Vite in das Build kopiert. `src/utils/faviconUtils.ts` ersetzt es bei Bedarf weiterhin durch das Workspace-Icon.

---

## E – Build, Betrieb, Reproduzierbarkeit

### 🟠 E1 · HOCH · Kein `package-lock.json` im Backend

Das Frontend verwendet mit dem vorhandenen Root-Lockfile `npm ci`. Das Backend besitzt weiterhin kein Lockfile und verwendet deshalb im Dockerfile `npm install --omit=dev`; ein reproduzierbarer Backend-Lockfile-Lauf muss in einer Docker-Umgebung erzeugt und geprüft werden. Der Punkt bleibt orange.

### ✅ E2 · MITTEL · `VITE_API_URL` wird zur Bauzeit übergeben

`VITE_API_URL` wird jetzt als Docker-Build-Argument an das Frontend-Dockerfile übergeben und dort zur Bauzeit gesetzt. Die Laufzeitumgebung bleibt bewusst ohne wirkungslose Vite-Konfiguration.

### ✅ E3 · MITTEL · Demo-Modus ist als Docker-Build konfigurierbar

`VITE_DEMO_MODE` wird jetzt über das Frontend-Dockerfile und `docker-compose.yml` als Build-Argument gesetzt. Ein Demo-Build ist damit im vorgesehenen Docker-Weg möglich:
```dockerfile
ARG VITE_DEMO_MODE=false
ENV VITE_DEMO_MODE=$VITE_DEMO_MODE
```
Das Ergebnis bleibt ein statisches Bundle ohne Backend und Datenbank.

Positiv: `demoApi.ts` ist mit 1.172 Zeilen sehr vollständig (Auth, Rollen, Workspaces, alle Fachbereiche, Seed-Daten pro Terminologieprofil, Speicherung in `localStorage`). Als Basis für eine überzeugende Live-Demo ist das ein echter Vorteil gegenüber statischen Screenshots.

### 🟠 E4 · MITTEL · Keine Tests, keine CI

`.github/workflows/quality.yml` baut jetzt Frontend- und Backend-Images; `scripts/verify-audit-contracts.mjs` schützt zentrale Audit-Verträge ohne zusätzliche Testabhängigkeit. Vollständige Unit-/Integrationstests für Steuerberechnung, RLS und XML gegen Referenzvalidatoren fehlen weiterhin, deshalb bleibt der Punkt orange.

### 🟠 E5 · MITTEL · Keine Observability

Das Backend bietet jetzt geschützte Laufzeitmetriken unter `/metrics`, strukturierte Logs und einen Health-Endpunkt. Externes Fehler-Tracking, Uptime-Monitoring, Alerting und Logaggregation (z. B. Sentry) müssen noch im jeweiligen SaaS-Betrieb eingerichtet werden.

### ✅ E6 · NIEDRIG · Expliziter JSON-404-Handler im Backend

`backend/server.js` – unbekannte Pfade erhalten jetzt eine definierte JSON-Antwort mit HTTP 404; der Handler steht vor dem optional geschützten `/metrics`-Endpunkt.

## 🟠 G – SaaS-Reife

Die Fachanwendung enthält die sicherheitsrelevanten Self-Service-Grundlagen. Für ein gehostetes Angebot bleiben Control Plane, Speicherbetrieb und Betreiberunterlagen offen; die Architektur ist in [`docs/saas-control-plane.md`](../docs/saas-control-plane.md) beschrieben.

| Bereich | Stand |
|---|---|
| Abrechnung / Abo-Verwaltung | 🟠 Nicht in der Fachanwendung; separater Control Plane laut Betriebsmodell erforderlich. |
| Passwort-Vergessen | ✅ Tokenbasierter Reset mit generischer Antwort, Ablaufzeit und Session-Widerruf implementiert. |
| E-Mail-Verifikation | 🟠 Konfigurierbar (`REQUIRE_EMAIL_VERIFICATION`); Versand/Zustellung benötigen SMTP und einen Laufzeitnachweis. |
| Einladungs-E-Mails | ✅ Einladung wird per Systemmail versendet; Token/Link wird nur mit explizitem Debug-Schalter zusätzlich ausgegeben. |
| Konto-/Workspace-Löschung | ✅ Passwortgeschützte Kontolöschung mit workspacebezogener Datenlöschung; gemeinschaftlich genutzte Eigentümer-Workspaces werden geschützt. |
| Datenexport für Betroffene | 🟠 Workspacebezogene Backups/Restore vorhanden; ein menschenlesbarer DSGVO-Auskunftsexport und Offsite-Speicher bleiben offen. |
| Session-Aufräumen | ✅ Abgelaufene und alte widerrufene Sessions werden regelmäßig bereinigt. |
| Mandanten-Onboarding | ✅ Leeres Profil, Onboarding-Hinweis und Versandblockade bei fehlenden Pflichtdaten. |
| Auftragsverarbeitungsvertrag, Datenschutzerklärung, Impressum, TOM-Dokumentation | 🟠 Technische Checkliste in [`docs/saas-legal-checklist.md`](../docs/saas-legal-checklist.md); Betreiber-/Juristenfreigabe fehlt. |

---

## H – Lizenz & Recht

### ✅ H1 · Positiv · Die Lizenz erlaubt den SaaS-Betrieb ausdrücklich

`LICENSE:66` – *„You are explicitly permitted and encouraged to offer [die Software] as a hosted service"*.

Bedingung aus AGPL § 13: Nutzern des Netzwerkdienstes muss der **vollständige, korrespondierende Quelltext der eingesetzten Version** zugänglich sein. Das öffentliche GitHub-Repository erfüllt das – **solange es mit dem Stand mitzieht, der tatsächlich deployed ist.** Wer produktiv einen Branch fährt, der nicht veröffentlicht ist, verletzt die Lizenz.

**Für die Landingpage bedeutet das:** ein gut sichtbarer Link auf das Repository ist nicht nur Marketing, sondern Lizenzpflicht. Am besten zusätzlich im Produkt selbst (Footer/Info-Dialog) mit Versions- und Commit-Angabe.

### 🟠 H2 · HOCH · Urheberrechtsvermerk und Zuschreibung

`LICENSE:4` – `Copyright (C) 2025 Belego Contributors`.

Der ursprüngliche Vermerk bleibt erhalten. README und [`NOTICE.md`](../NOTICE.md) enthalten jetzt zusätzlich `Copyright (C) 2026 SoloOffice Contributors` für eigene Beiträge und benennen SoloOffice als Fork. Ein sichtbarer Fork-Hinweis auf einer noch nicht vorhandenen Landingpage muss vor einem öffentlichen SaaS-Launch ergänzt werden.

### ✅ H3 · MITTEL · Fremder kommerzieller Support-Kontakt entfernt

Die fremde Managed-Hosting-/Priority-Support-Adresse wurde aus der README entfernt. Eigene Supportkanäle müssen beim SaaS-Betreiber noch festgelegt werden.

---

## 3. Priorisierte Reihenfolge

**Vor irgendeiner öffentlichen Ankündigung:**

1. **C1/C11** Vier E-Rechnungsfälle mit KOSIT- und FeRD-/Factur-X-Referenzvalidatoren prüfen und Ergebnis versionieren.
2. **E1** Backend-Lockfile in einer Docker-Umgebung erzeugen, `npm ci --omit=dev` umstellen und den Build wiederholen.
3. **B1/B5** Offsite-Backup, Restore-Probe und Objektspeicherstrategie für produktive SaaS-Daten festlegen.
4. **H2/G** Landingpage, Copyright-/Fork-Hinweis, Datenschutzunterlagen und Supportkanal rechtlich/fachlich freigeben.

**Vor dem SaaS-Start:**

5. **B7/G** Multiuser-, RLS-, Restore- und Löschablauf in Docker/PostgreSQL durchspielen.
6. **G** Separaten Control Plane für Abrechnung, Limits, Bereitstellung und Sperren bauen bzw. betreiben.
7. **C10** ZUGFeRD-PDF-Eingang, automatische Buchung und formales Archiv-/Aufbewahrungskonzept ergänzen.
8. **E4/E5** Fachliche Tests, Referenzvalidatoren, Fehler-Tracking, Uptime-Monitoring und Alerting ergänzen.

**Bereits umgesetzt und lokal geprüft:**

- **A1–A10** Deployment-/Secret-Härtung, Auth-Rate-Limit, Security-Header, XSS-Sanitizing, `trust proxy` und unprivilegierter Backend-Container.
- **B2–B4/B6–B7** Workspace-Restore, Migrationstabelle, Rechnungsnummern-Lock, Pool-Kontext und RLS-Naht.
- **C2–C9** XML-Escaping, Steuerkategorien, Fehlerpfad, Kennungen, Länder, Leitweg-ID und Zahlungsbedingungen.
- **D1–D3/D5–D6**, **E2–E3/E6**, **G** Passwort-Reset/Verifikation/Einladung/Löschung/Session-Bereinigung.

---

## 4. Konsequenzen für die Landingpage

### Bedenkenlos bewerbbar

- Open Source, AGPL-3.0, selbst hostbar, Daten bleiben beim Nutzer
- Vollständig deutschsprachig, für den deutschen Markt entwickelt
- Kompletter Prozess: Angebot → Auftrag → Zeiterfassung → Rechnung → Mahnung
- EÜR, Anlagenverzeichnis, Belegverwaltung **als vorbereitende Arbeitsunterlagen**
- Belegerkennung per OCR – **lokal im eigenen Container, keine Übertragung an Dritte** (starkes Datenschutzargument, technisch belegt: Tesseract im Backend-Image)
- Mehrere Nutzer und Workspaces mit Rollen, Trennung datenbankseitig über Row-Level Security
- Mandantenfähigkeit, Docker-Deployment
- Wiederkehrende Rechnungen, Gutschriften, Kalender, Import-Assistent

### Erst nach Korrektur bewerbbar

| Claim | Grund |
|---|---|
| „ZUGFeRD 2.1" / „PDF/A-3" | C1 – XMP und `factur-x.xml` sind umgesetzt, ICC, Schriften und FeRD-Validierung noch nicht nachgewiesen |
| „XRechnung 3.0" | C11 – Generator und lokale Pflichtfeldprüfung vorhanden, KOSIT-Schema-/Schematronlauf noch offen |
| „Automatische Validierung" | C11 – nur als eingeschränkte lokale Strukturprüfung formulieren |
| „Backup & Restore" | B1/B5 – Volume und workspacebezogener Restore vorhanden, Offsite-/S3-Betrieb und Wiederherstellungstest offen |
| „GoBD-konform" | Als **„GoBD-geeignete Arbeitsweise"** formulieren. Konformität ist eine Eigenschaft des Gesamtverfahrens beim Anwender, nicht einer Software. |
| „Für Behörden / B2G" | C8 – nur für Kunden mit gepflegter Leitweg-ID und extern validiertem Profil |

### Niemals ohne Einschränkung behaupten

- **Keine ELSTER-Übertragung** – explizit als Roadmap ausweisen
- **EÜR, Steuerprofil, Reports und Abschreibungen ersetzen keine steuerliche Prüfung** – gehört sichtbar auf die Seite, nicht nur ins Kleingedruckte
- **OCR liefert Vorschläge, die geprüft werden müssen**
- **Aktueller Stand ist Beta** (`v0.2.0-beta.1` in Vorbereitung, kein automatisiertes Testframework)

### Positionierung

Der Markt (lexoffice, sevDesk, easybill, Papierkram) ist besetzt und wirbt mit denselben Funktionen. Die drei Punkte, bei denen SoloOffice tatsächlich etwas hat, was die anderen nicht bieten:

1. **Open Source und selbst hostbar** – prüfbarer Quelltext, kein Vendor-Lock-in, Ausstieg jederzeit möglich
2. **OCR läuft lokal** – Belege verlassen den eigenen Server nicht. Gegen Cloud-Anbieter ein hartes, technisch belegbares Argument
3. **Beides gleichzeitig** – kostenlos selbst betreiben oder gehostet buchen, identischer Funktionsumfang, Wechsel in beide Richtungen möglich

Das gehört über den Funktionsvergleich gestellt, nicht darunter.

---

## 5. Offene Fragen – beantwortet am 2026-08-06

**1. Zustand der Oberfläche** → geprüft, siehe [Audit 2](SoloOffice-Audit-2-Oberflaeche.md). Ergebnis: gut, mit einer schweren Ausnahme (Dunkelmodus). Offen bleiben Tablet-Breakpoint und eingeklappte Seitenleiste.

**2. Wurde der Multiuser-Ablauf je vollständig durchgespielt?** → **In dieser Umgebung weiterhin nein.** Die Codepfade sind statisch geprüft; Docker ist nicht installiert. Der konkrete Ablauf steht in `docs/identity-workspace-local-testing.md` und bleibt ein Start-Gate.

> **Folge:** Authentifizierung, Rollenrechte, Workspace-Wechsel, Einladungen und die RLS-Isolation sind **ausschließlich statisch geprüft und nie zur Laufzeit bestätigt**. Der Quelltext sieht korrekt aus – aber „sieht korrekt aus" ist bei Mandantentrennung nicht genug. Das ist eine **Voraussetzung für den SaaS-Start**, keine Fleißaufgabe: Ein Fehler in dieser Schicht bedeutet fremde Rechnungsdaten im falschen Konto.
>
> Der Testablauf ist in `docs/identity-workspace-local-testing.md` bereits sauber beschrieben (zwei Konten, zwei Workspaces, Rollenprüfung, Isolationsprüfung). Er braucht nur eine Docker-Umgebung und etwa einen halben Tag. **Zusätzlich** sollte die RLS-Isolation nicht nur über die Oberfläche, sondern direkt auf der Datenbank geprüft werden: mit gesetztem `app.workspace_id` eines fremden Workspaces eine Abfrage absetzen und bestätigen, dass **null Zeilen** zurückkommen.

**3. Gab es je einen KOSIT-Validierungslauf?** → **Nein.** Die Generatoren enthalten jetzt eine lokale Wohlgeformtheits-/Pflichtfeldprüfung; KOSIT- und FeRD-/Factur-X-Referenzvalidatoren wurden nicht ausgeführt. Der Ablauf ist in [`docs/e-rechnung-validation.md`](../docs/e-rechnung-validation.md) festgehalten.

### Was der KOSIT-Validator ist

**KOSIT** = *Koordinierungsstelle für IT-Standards*, angesiedelt bei der Freien Hansestadt Bremen im Auftrag des IT-Planungsrats. Die KOSIT **pflegt den XRechnung-Standard** – sie ist die Stelle, die festlegt, was eine gültige XRechnung ist.

Dazu veröffentlicht sie zwei Dinge kostenlos und quelloffen:

1. **Das Regelwerk** – die Prüfregeln als Schematron-Dateien. Jede Regel hat eine Kennung wie `BR-S-05` oder `BR-CO-18` (genau die, die in Abschnitt C verletzt werden).
2. **Den Validator** – ein Java-Programm, das eine XML-Datei gegen dieses Regelwerk prüft und jeden Verstoß mit Regelnummer und Klartext meldet.

Der Aufruf ist ein Einzeiler:

```bash
java -jar validationtool.jar -s scenarios.xml meine-rechnung.xml
```

**Warum das entscheidend ist:** Der Validator ist nicht *eine* Meinung, sondern **die Referenz**. Öffentliche Auftraggeber prüfen eingehende Rechnungen mit demselben Werkzeug. Was der Validator ablehnt, lehnt die Behörde ab. Und die großen Rechnungsportale der Privatwirtschaft nutzen dasselbe Regelwerk.

Für ZUGFeRD gibt es das Gegenstück vom **FeRD** (Forum elektronische Rechnung Deutschland) – dort wird zusätzlich die PDF/A-3-Konformität und die korrekte XMP-Einbettung geprüft, also genau die Punkte C1 und C2.

**Empfehlung:** Beide Validatoren als festen Release-Prüfschritt einrichten, nicht als einmalige Aktion. Konkret vier Beispielrechnungen erzeugen und durchlaufen lassen – Regelbesteuerung, Kleinunternehmer, Auslandskunde, Kunde mit `&` im Namen – plus B2G mit Leitweg-ID und ZUGFeRD-PDF/A-3-Prüfung. Bis dahin bleiben die Compliance-Claims eingeschränkt.

**4. Betriebsmodell des SaaS** → beantwortet in [`SoloOffice-Betriebsmodell.md`](SoloOffice-Betriebsmodell.md).
