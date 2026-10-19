# Aktueller Stand SoloOffice

**Stand:** 2026-10-19

**Fachapp:** `main` · Beta-Pre-Release `v0.9.6` veröffentlicht

**Release-Commit:** `1caddc66b86704c91583da1b810ab1346d38aef6`

**GitHub-Release:** [SoloOffice v0.9.6](https://github.com/TingelTangelBob/SoloOffice/releases/tag/v0.9.6)

Der Tag `v0.9.6` zeigt auf den Release-Commit. Nachgelagerte Korrekturen an Deploy-Skript und Statusdokumentation ändern diesen Release-Tag nicht. Ein öffentlicher Hosted-/SaaS-Start ist weiterhin nicht freigegeben.

## Produktstand

SoloOffice ist eine deutschsprachige Webanwendung für Rechnungen, Kunden- und Auftragsverwaltung sowie vorbereitende Buchhaltung. Der aktuelle Stand umfasst unter anderem E-Rechnungen, Belege mit lokaler OCR, Workspace- und Rollenverwaltung, Datenübernahme, EÜR und die optionale Erweiterung „Steuern & Abgaben“.

## Änderungen in v0.9.6

- Die EÜR-Monatsübersicht kann nach Monat filtern und zeigt einen Monatsdurchschnitt.
- Tagespauschalen lassen sich mit selbst recherchierten Beträgen, optionalen Grenzen und einer eigenen Quelle je Steuerjahr erfassen. SoloOffice liefert keine gesetzlichen Tagessätze oder Höchstgrenzen vor.
- Arbeitstage und Tätigkeitsarten können unabhängig von Unterrichts- oder Kalenderterminen dokumentiert werden. Termine werden nicht als Arbeitstage vorausgesetzt.
- Weitere oder besondere Pauschalen lassen sich frei beschriften und mit selbst eingetragener Berechnungsgrundlage erfassen.
- SoloOffice prüft weder steuerliche Anspruchsvoraussetzungen noch Ausschlüsse oder ELSTER-Zuordnung.
- Einstellungen und Rechte für Workspace-Daten wurden korrigiert. Zusätzlich wurden Mailverwaltung, Plattformübersicht und Workspace-Einblicke erweitert.

Details zur Steuererfassung stehen in [docs/steuern-abgaben.md](steuern-abgaben.md); Versionshinweise in [CHANGELOG.md](../CHANGELOG.md).

## Prüfstand und Nachweise

- GitHub CI für den Release-Commit bestanden: [Lauf 39288082121](https://github.com/TingelTangelBob/SoloOffice/actions/runs/39288082121). Frontend-Tests, Lint, Typprüfung, Produktionsbuild, Backend-Image und 387 Backend-Unit-Tests liefen erfolgreich; die Compose-Prüfung sowie Migrationen und Workspace-RLS gegen PostgreSQL bestanden.
- ESLint meldet vier nicht blockierende Warnungen in `Calendar.tsx`, `TaxOverview.tsx` und `MotionProvider.tsx`.
- Staging unter [app.staging.solooffice.de](https://app.staging.solooffice.de) wurde mit dem Release-Commit aktualisiert und die Betriebsprüfung meldete Version `0.9.6` als gesund.
- Das Demo-Image wurde durch [Lauf 39288082067](https://github.com/TingelTangelBob/SoloOffice/actions/runs/39288082067) gebaut und veröffentlicht. Der aktive Server-Timer übernahm es; `https://demo.solooffice.de/healthz` antwortete mit `ok`. Das ausgelieferte JavaScript enthält Version `0.9.6` und den Release-Commit.
- Lokal bestanden: `git diff --check`, `bash -n deploy/solooffice-update-all.sh`, `node scripts/verify-audit-contracts.mjs`, `npm run typecheck` und `npm run lint`.
- Docker ist auf der Arbeitsmaschine nicht verfügbar. Docker-Builds und die vollständigen Containerprüfungen liefen deshalb in GitHub CI.
- Die manuelle Release-Checkliste nennt 13 offene Punkte. Sie wurden nicht erneut geprüft oder geschlossen.
- Betriebsnachweise zu Offsite-Backup, externer Überwachung und Rückfallplan für den Gesamtbetrieb sind weiterhin offen. Das Staging-Backup ersetzt diese Nachweise nicht.

## Umgebungen und Freigaben

- `solooffice.de` ist die öffentliche Landingpage.
- `app.staging.solooffice.de` enthält den geprüften v0.9.6-Release-Commit.
- `demo.solooffice.de` läuft als Demo und nicht als produktiver SaaS-Endpunkt.
- Selbsthosting ist möglich, ersetzt jedoch keine manuelle, rechtliche oder steuerliche Prüfung.
- Vor einem späteren öffentlichen Hosted-/SaaS-Start bleiben die dafür vorgesehenen Freigaben und Prüfungen offen. Das blockiert nicht die interne Erfassung eigener EÜR-Werte in SoloOffice.

## Nächste Schritte

1. Die 13 offenen Punkte aus [docs/manual-release-checklist.md](manual-release-checklist.md) mit Steffen manuell prüfen; bestehende Haken bleiben unverändert.
2. Offsite-Backup, externe Überwachung und Rückfallplan für den Gesamtbetrieb nachweisen.
3. Die vorbereiteten Dashboard-Zielzuordnungen aus SO-40 über Steffens Dashboard-Anmeldung anwenden.
4. Vor einem öffentlichen SaaS-Start die dafür vorgesehenen Produkt- und Rechtsfreigaben abschließen.

Ein erfolgreicher Beta-Release ist keine öffentliche SaaS-Freigabe.
