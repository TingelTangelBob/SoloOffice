# Aktueller Stand SoloOffice

**Stand:** 2026-10-20

**Fachapp:** `release/v0.9.7` · Beta-Pre-Release `v0.9.7b` veröffentlicht

**Release-Commit:** `8b566fb94bb19b8c22d1d1148802290f14173fbd`

**GitHub-Release:** [SoloOffice v0.9.7b](https://github.com/TingelTangelBob/SoloOffice/releases/tag/v0.9.7b)

Der Tag `v0.9.7b` zeigt auf den geprüften Beta-Release-Commit. Ein öffentlicher Hosted-/SaaS-Start ist weiterhin nicht freigegeben.

## Produktstand

SoloOffice ist eine deutschsprachige Webanwendung für Rechnungen, Kunden- und Auftragsverwaltung sowie vorbereitende Buchhaltung. Der aktuelle Stand umfasst unter anderem E-Rechnungen, Belege mit lokaler OCR, Workspace- und Rollenverwaltung, Datenübernahme, EÜR und die optionale Erweiterung „Steuern & Abgaben“.

## Änderungen in v0.9.7b

- Rechnungszahlungen in der EÜR übernehmen standardmäßig den noch offenen Rechnungsbetrag, einschließlich Zahlungen aus anderen EÜR-Jahren. Ein kleinerer Betrag erfasst weiterhin eine Teilzahlung.
- EÜR-Monatsdurchschnitt und bisherige Berechnung zeigen ihre Zeiträume an einer Info-Schaltfläche. Die Ausgabenaktion und PDF-Vorschau sind kompakter.
- Das Anpassungssymbol im Dashboard öffnet ein Menü zum bestehenden Kachel-Editor.
- Einstellungen enthalten weniger redundante Beschreibungen. SMTP-Server, Port und Verschlüsselung lassen sich ohne feste Anbieterauswahl eintragen.

Details zur Steuererfassung stehen in [docs/steuern-abgaben.md](steuern-abgaben.md); Versionshinweise in [CHANGELOG.md](../CHANGELOG.md).

## Prüfstand und Nachweise

- GitHub CI für den Release-Commit bestanden: [Lauf 39399549078](https://github.com/TingelTangelBob/SoloOffice/actions/runs/39399549078). Frontend-Tests, Lint, Typprüfung, Produktionsbuild, Audit, Backend-Image und 394 Backend-Unit-Tests liefen erfolgreich; die Compose-Prüfung sowie Migrationen und Workspace-RLS gegen PostgreSQL bestanden.
- ESLint meldet eine nicht blockierende Warnung in `src/context/MotionProvider.tsx`.
- Staging unter [app.staging.solooffice.de](https://app.staging.solooffice.de) wurde auf Version `0.9.7` und Commit `8b566fb94bb1` aktualisiert. Die Betriebsprüfung war erfolgreich.
- Das Demo-Image folgt weiterhin dem Branch `main`; der Beta-Tag `v0.9.7b` wurde nicht auf `main` übertragen.
- Lokal bestanden: `git diff --check`, `bash -n deploy/solooffice-update-all.sh`, `node scripts/verify-audit-contracts.mjs`, `npm run typecheck` und `npm run lint`.
- Docker ist auf der Arbeitsmaschine nicht verfügbar. Docker-Builds und die vollständigen Containerprüfungen liefen deshalb in GitHub CI.
- Die manuelle Release-Checkliste nennt 13 offene Punkte. Sie wurden nicht erneut geprüft oder geschlossen.
- Betriebsnachweise zu Offsite-Backup, externer Überwachung und Rückfallplan für den Gesamtbetrieb sind weiterhin offen. Das Staging-Backup ersetzt diese Nachweise nicht.

## Umgebungen und Freigaben

- `solooffice.de` ist die öffentliche Landingpage.
- `app.staging.solooffice.de` enthält den geprüften v0.9.7b-Release-Commit.
- `demo.solooffice.de` läuft als Demo und nicht als produktiver SaaS-Endpunkt.
- Selbsthosting ist möglich, ersetzt jedoch keine manuelle, rechtliche oder steuerliche Prüfung.
- Vor einem späteren öffentlichen Hosted-/SaaS-Start bleiben die dafür vorgesehenen Freigaben und Prüfungen offen. Das blockiert nicht die interne Erfassung eigener EÜR-Werte in SoloOffice.

## Nächste Schritte

1. Die 13 offenen Punkte aus [docs/manual-release-checklist.md](manual-release-checklist.md) mit Steffen manuell prüfen; bestehende Haken bleiben unverändert.
2. Offsite-Backup, externe Überwachung und Rückfallplan für den Gesamtbetrieb nachweisen.
3. Die vorbereiteten Dashboard-Zielzuordnungen aus SO-40 über Steffens Dashboard-Anmeldung anwenden.
4. Vor einem öffentlichen SaaS-Start die dafür vorgesehenen Produkt- und Rechtsfreigaben abschließen.

Ein erfolgreicher Beta-Release ist keine öffentliche SaaS-Freigabe.
