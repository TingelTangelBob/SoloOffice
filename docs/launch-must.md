# Launch-Must-Liste

**Stand:** 2026-09-25

**Geprüfte Codebasis:** `v0.9.4` · `73b1756f2794db53cca55128061731b3e93b59dc`
**Prüfgrenze:** lokaler Quellstand; heutige GitHub-CI und Staging-Laufzeit
wegen gesperrtem Netzwerkzugriff nicht erneut nachgewiesen.
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
  lokales Repository vor (Auditbasis `5f77421`, kein Remote); ein externes
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
  App-/Control-Plane-Commit und Ergebnis archivieren.

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

### T-6 Aktuelle CI und reproduzierbarer Build

- **Status:** Nachweis offen (Umgebungsblocker)
- **Owner:** Tech
- **Nachweis / nächster Schritt:** CI und Demo-Image müssen für den tatsächlichen
  Release-Commit erfolgreich sein. Ein historischer grüner Lauf vom 23.09.2026
  gehört zu `ad0f90e`; danach kamen weitere Änderungen bis `73b1756`.
  Die Lint-/Typecheck-Fixes `d053153` und `73b1756` sind vorhanden. Der aktuelle
  GitHub-Lauf war am 25.09. nicht abrufbar. Kein spekulativer CI-Fix und kein
  Push ohne aktuellen Nachweis.

## Aktueller technischer Stand

Lokal zeigen `main` und die gespeicherte Referenz `origin/main` auf `73b1756`.
Ohne Fetch ist das keine Bestätigung des heutigen GitHub-Stands. Der oben
beschriebene Staging-Nachweis bleibt historisch auf `b6c6bb2` datiert; die
behauptete heutige Staging-Revision `73b1756` wurde nicht erneut verifiziert.

Am 25.09.2026 bestanden die statischen Audit-Verträge und die Shell-Syntaxprüfung.
Die Quellzählung ergibt 43 Frontend-, 106 Backend- und 36 PostgreSQL-
Testdeklarationen (kein Testlauf). Einzelheiten und Prüfgrenzen stehen in
[automated-tests.md](automated-tests.md).

Der Control Plane ist vorhanden; ältere Aussagen, er sei im Gesamtworkspace
nicht verfügbar, sind überholt. Provisionierung und Sperrpfade existieren,
Telemetrie und Support sind angebunden. Ein älterer Staging-E2E-Nachweis mit
manuell gesetztem Abo ersetzt weder Stripe-Checkout/Portal/Webhooks noch den
aktuellen gemeinsamen Export-/Löschnachweis. Rechtliche Freigaben, manuelle
Abnahme und vollständiger Produktionsbetrieb bleiben offen.
