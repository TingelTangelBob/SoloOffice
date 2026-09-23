# Launch-Must-Liste

**Stand:** 2026-09-23

**Quellstand:** `v0.9.4` · Commit `b6c6bb279dcd1c9807f237812c59c57de58135a3`
**Entscheidung:** Ein öffentlicher Hosted-/SaaS-Launch ist mit diesem Stand nicht
freigegeben. Ein begrenzter Self-Hosting-Test ist mit den unten genannten
Einschränkungen möglich.

Diese Liste enthält ausschließlich Must-Punkte für einen Hosted-Launch. Nice-
to-haves und spätere Funktionen stehen in der [README](../README.md) unter
„Geplante Funktionen“ und sind hier nicht als offene Launch-Haken geführt.
„Erledigt“ bedeutet immer: Datum, Commit und ein prüfbarer Nachweis sind
angegeben.

## Steffen – Betreiberentscheidung und Freigabe

### S-1 Launch-Scope

- **Status:** offen
- **Owner:** Steffen
- **Nachweis / nächster Schritt:** Entscheiden und dokumentieren, ob zunächst
  eine eingeladene Hosted-Beta oder ein öffentlicher Verkauf startet. Den
  Self-Hosting-Test davon getrennt benennen. Ohne diese Entscheidung keine
  Launch-Freigabe.

### S-2 Control Plane, Preise und Betriebsregeln

- **Status:** offen
- **Owner:** Steffen
- **Nachweis / nächster Schritt:** Betreiber, Repository/Commit und
  Betriebszugang des Control Plane benennen sowie Stripe-Preise,
  Steuer-/Zahlungskonfiguration und Kulanz-/Sperrregeln freigeben. Der
  Control-Plane-Dienst liegt außerhalb dieses App-Repositories; der laufende
  Staging-Dienst ist damit noch kein fachlicher End-to-End-Nachweis.

### S-3 Recht und Datenverantwortung

- **Status:** offen
- **Owner:** Steffen
- **Nachweis / nächster Schritt:** Impressum, Datenschutz, AGB, AVV, TOM,
  Lösch-/Auskunfts-/Export-/Aufbewahrungskonzept, Incident-Prozess und
  AGPL-Angebot für den tatsächlich deployten Stand rechtlich freigeben.
  `docs/saas-legal-checklist.md` ist nur eine technische Vorbereitung.

### S-4 Domain, Mail und öffentliche Betriebsdaten

- **Status:** offen
- **Owner:** Steffen
- **Nachweis / nächster Schritt:** Öffentliche Domain einschließlich
  `admin.solooffice.de`, TLS, Admin-Kontakt, SMTP-Absenderdomain,
  SPF/DKIM/DMARC und Testempfänger festlegen und zur Prüfung bereitstellen.

## Tech – Umsetzung und Nachweis

### T-1 Control Plane end-to-end

- **Status:** offen
- **Owner:** Tech
- **Nachweis / nächster Schritt:** Gegen eine laufende SoloOffice-Instanz
  Registrierung/Verifikation, Workspace-Provisionierung, Stripe-Testfluss,
  signierte Webhooks, Deduplizierung, Tariflimits, Sperre/Entsperre und
  Admin-Audit mit dem freigegebenen Control Plane durchspielen und mit Datum,
  App-/Control-Plane-Commit und Ergebnis archivieren.

### T-2 AP-5.5 Export und Löschung

- **Status:** offen
- **Owner:** Tech
- **Nachweis / nächster Schritt:** Workspace-Export und Workspace-Löschung
  müssen zwischen Control Plane und Fachapp zusammen funktionieren. Dazu
  gehört ein positiver Export sowie ein Löschtest mit korrekter und falscher
  Bestätigung, ohne andere Workspaces zu berühren. Der vorhandene App-
  Backup-/Restore-Pfad ersetzt diesen SaaS-Nachweis nicht.

### T-3 Staging, Migration und Datenübernahme

- **Status:** teilweise
- **Owner:** Tech
- **Nachweis / nächster Schritt:** Am 2026-09-23 bestand auf dem dokumentierten
  Staging-Server der nicht verändernde Lauf
  `manage-instances.sh verify staging b6c6bb279dcd1c9807f237812c59c57de58135a3`.
  Damit sind Healthchecks, Image-Version/Commit, RLS und Migration 044 als
  aktueller Migrationsstand technisch nachgewiesen. Offen bleibt der isolierte
  fachliche Smoke-Test mit echter `.xlsx`-Datei je Importziel: Summenkontrolle,
  Duplikatlauf, Rückgängig/Blockierung und „Umzug abschließen“.

### T-4 Manuelle Release-Abnahme

- **Status:** offen
- **Owner:** Tech
- **Nachweis / nächster Schritt:** Die 13 offenen Punkte in der
  [manuellen Release-Checkliste](manual-release-checklist.md) auf dem echten
  Zielstand abnehmen: SMTP/Auth, Import, Rechnungsablauf, wiederkehrende
  Vorgänge, OCR/EÜR, Reporting/Exporte, Responsive Hell/Dunkel, Löschung und
  externe E-Rechnungsvalidatoren. Jeder Punkt braucht Datum, Commit und ein
  kurzes Ergebnis; automatisierte Tests ersetzen die Browser- und Fachabnahme
  nicht.

### T-5 Produktionsbetrieb

- **Status:** offen
- **Owner:** Tech
- **Nachweis / nächster Schritt:** Offsite-Backup mit Rotation und
  Restore-Probe, Speicher-/Log-Überwachung, externe Uptime-/Alarmierung,
  Domain-/TLS-/Cookie-/CORS-Prüfung und dokumentierten Rückfallplan
  produktionsnah nachweisen. Der aktuelle Stack bietet dafür noch keinen
  vollständigen Betriebsnachweis.

## Aktueller technischer Stand

Die Dokumentation und der Staging-Stand sind auf v0.9.4 / `b6c6bb2`
synchronisiert. Die automatisierten Zählungen betragen 43 Frontend-Tests,
99 Backend-Regressions-Tests und 43 PostgreSQL-Integrationstests. Der aktuelle
Teststand ist in [docs/automated-tests.md](automated-tests.md) beschrieben.

Diese Nachweise ändern die Entscheidung oben nicht: Control Plane, rechtliche
Freigaben, fachliche manuelle Abnahme, Export/Löschung und der vollständige
Produktionsbetrieb sind weiterhin offen.
