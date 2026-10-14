# Launch-Must-Liste

**Stand:** 2026-10-11

**Geprüfte Codebasis:** `v0.9.5` · `0674c0849e968ac1d11062a8b6568f3490ba726e`
**Prüfgrenze:** lokaler Quellstand. Ein SSH-Lesezugriff zeigte laufende Staging-
Container; weitere Zugriffe, aktueller BUILD_COMMIT, HTTPS und GitHub-CI konnten
wegen Netzwerkbeschränkungen nicht nachgewiesen werden. Kein Deploy.
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

- **Status:** teilweise entschieden
- **Owner:** Steffen
- **Nachweis / nächster Schritt:** Die Arbeitsunterlagen vom 15.09.2026
  dokumentieren die Vorbereitung einer geschlossenen Beta (Variante B) und
  übernommene Beta-Vertragswerte. Das ist keine Freigabe zum öffentlichen
  Verkauf. Offen bleibt die ausdrückliche Freigabe des konkreten Startumfangs
  nach den technischen und rechtlichen Nachweisen.

### S-2 Control Plane, Preise und Betriebsregeln

- **Status:** offen
- **Owner:** Steffen
- **Nachweis / nächster Schritt:** Der Control Plane liegt als eigenes
  lokales Repository vor (Auditbasis `8f27a30`, kein Remote); ein externes
  privates Repository benötigt Betreiberfreigabe. Stripe ist als Anbieter
  bereits gewählt. Die Beta-Unterlagen nennen 14 Tage Kulanz und 30 Tage
  Lesemodus nach Vertragsende; daraus folgt keine Freigabe der Stripe-Live-
  Konfiguration, Preise und steuerlichen Einstellungen. Ein laufender Dienst
  ersetzt den vollständigen E2E-Nachweis nicht.

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
  App-/Control-Plane-Commit und Ergebnis archivieren. Betreiber-2FA inklusive
  bestehender Sitzungen nach Aktivierung prüfen: Einrichtung ist derzeit
  optional, vorhandene Sitzungen werden dabei nicht widerrufen.

### T-2 AP-5.5 Export und Löschung

- **Status:** offen
- **Owner:** Tech
- **Nachweis / nächster Schritt:** Workspace-Export und Workspace-Löschung
  müssen zwischen Control Plane und Fachapp zusammen funktionieren. Dazu
  gehört ein positiver Export sowie ein Löschtest mit korrekter und falscher
  Bestätigung, ohne andere Workspaces zu berühren. Die Fachapp bietet intern
  derzeit nur Provisionierung, Sperre und Entsperre. Der vorhandene CP-
  Kontoexport enthält ausgewählte CP-Daten, keine Fachdaten; der gemeinsame
  Export- und Löschworkflow ist noch nicht implementiert. Der vorhandene App-
  Backup-/Restore-Pfad ersetzt diesen SaaS-Nachweis nicht.

### T-3 Staging, Migration und Datenübernahme

- **Status:** teilweise
- **Owner:** Tech
- **Nachweis / nächster Schritt:** Am 2026-09-23 bestand auf dem dokumentierten
  Staging-Server der nicht verändernde Lauf
  `manage-instances.sh verify staging b6c6bb279dcd1c9807f237812c59c57de58135a3`.
  Damit sind Healthchecks, Image-Version/Commit, RLS und Migration 044 für
  diesen historischen Stand technisch nachgewiesen. Der heutige Quellstand
  registriert Migrationen bis 058; deren aktueller Staging-Stand ist damit
  nicht belegt. Offen bleibt der isolierte
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

### T-6 Aktuelle CI und reproduzierbarer Build

- **Status:** Nachweis offen (Umgebungsblocker)
- **Owner:** Tech
- **Nachweis / nächster Schritt:** CI und Demo-Image müssen für den tatsächlichen
  Release-Commit erfolgreich sein. Lokal liegt `main` auf `0674c08`, die
  gespeicherte Referenz `origin/main` auf `c75ce13`. Der aktuelle GitHub-Lauf
  war am 11.10. nicht abrufbar; weder „rot“ noch „grün“ ist bestätigt. Die
  alten Lint-/Typecheck-Fixes vom September sind kein Nachweis für Oktober.
  Docker fehlt lokal. Kein spekulativer CI-Fix oder Push fremder Commits.

## Aktueller technischer Stand

Der v0.9.4-/September-Stand ist überholt: Fachapp v0.9.5, Migrationen bis 058,
zusätzliche Steuer-/USt-, Import- und UI-Funktionen. `README.md` nennt bereits
v0.9.5. Die nicht versionierte `docs/Aktueller_Stand.md` ist fremde Arbeit und
wurde nicht verändert oder als freigegebener Nachweis übernommen.

Am 11.10.2026 bestanden die statischen Audit-Verträge. Die Quellzählung ergibt
142 Frontend-, 342 Backend-Unit- und 81 PostgreSQL-Testdeklarationen,
**keinen Testlauf**. Historische Oktober-Testberichte ersetzen keinen heutigen
Docker-/CI-Nachweis. Einzelheiten und Prüfgrenzen stehen in
[automated-tests.md](automated-tests.md). Die 13 offenen manuellen Haken bleiben
offen; bereits bestandene Haken werden nicht zurückgesetzt.

Der Control Plane ist vorhanden; ältere Aussagen, er sei im Gesamtworkspace
nicht verfügbar, sind überholt. Provisionierung und Sperrpfade existieren,
Telemetrie und Support sind angebunden. Ein älterer Staging-E2E-Nachweis mit
manuell gesetztem Abo ersetzt weder Stripe-Checkout/Portal/Webhooks noch den
aktuellen gemeinsamen Export-/Löschnachweis. Rechtliche Freigaben, manuelle
Abnahme und vollständiger Produktionsbetrieb bleiben offen.
