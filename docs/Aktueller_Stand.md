# Aktueller Stand SoloOffice

**Stand:** 2026-10-19
**Fachapp:** main · Beta-/Release-Kandidat v0.9.6 (lokal vorbereitet)
**Git:** lokaler main-Arbeitsstand sauber; der annotierte Tag v0.9.6 ist nur lokal vorhanden. Die gespeicherte Referenz origin/main ist kein Nachweis des aktuellen Remote-Stands. Das GitHub-Token ist ungültig; Push und Remote-Prüfungen stehen aus.

## Produktstand

SoloOffice ist eine deutschsprachige Webanwendung für Rechnungen, Kunden- und Auftragsverwaltung sowie vorbereitende Buchhaltung. Der aktuelle Stand umfasst unter anderem E-Rechnungen, Belege mit lokaler OCR, Workspace- und Rollenverwaltung, Datenübernahme, EÜR und die optionale Erweiterung „Steuern & Abgaben“.

Der Stand bleibt Beta/Test. Ein öffentlicher Hosted-/SaaS-Launch ist laut launch-must.md nicht freigegeben. v0.9.6 ist lokal vorbereitet, aber weder auf GitHub veröffentlicht noch auf Staging oder Demo bestätigt.

## Änderungen im lokalen Release-Kandidaten

- Die EÜR-Monatsübersicht kann nach Monat filtern und zeigt einen Monatsdurchschnitt.
- Tagespauschalen lassen sich mit selbst recherchierten Beträgen, optionalen Grenzen und einer eigenen Quelle je Steuerjahr erfassen. SoloOffice liefert keine gesetzlichen Tagessätze oder Höchstgrenzen vor.
- Arbeitstage und Tätigkeitsarten können unabhängig von Unterrichts- oder Kalenderterminen dokumentiert werden. Termine werden nicht als Arbeitstage vorausgesetzt.
- Weitere oder besondere Pauschalen lassen sich frei beschriften und mit selbst eingetragener Berechnungsgrundlage erfassen.
- Die Dokumentation grenzt die Funktion klar ab: SoloOffice prüft weder steuerliche Anspruchsvoraussetzungen noch Ausschlüsse oder ELSTER-Zuordnung.
- Einstellungen und Rechte für Workspace-Daten wurden korrigiert.
- Das Release-Skript behandelt Git-Worktrees und kann einen Push eines bereits erstellten Commits aus einem sauberen Arbeitsbaum wiederholen.

Details zur Steuererfassung stehen in docs/steuern-abgaben.md; Versionshinweise in CHANGELOG.md.

## Prüfstand und Nachweisgrenzen

- Lokal bestanden: git diff --check, bash -n deploy/solooffice-update-all.sh und node scripts/verify-audit-contracts.mjs.
- Docker ist auf der Arbeitsmaschine nicht verfügbar. Für den aktuellen Stand wurden deshalb kein Docker-Build, keine vollständige Frontend-/Backend-Testsuite und kein Datenbank-Smoke-Test ausgeführt.
- Das GitHub-Token ist ungültig. Der vorbereitete Commit wurde nicht gepusht; aktueller GitHub-CI-Status, Staging, Demo und ein GitHub-Pre-Release sind nicht bestätigt.
- Die manuelle Release-Checkliste nennt 13 offene Punkte. Sie wurden nicht erneut geprüft oder geschlossen.
- Betriebsnachweise zu Offsite-Backup, externer Überwachung und Rückfallplan sind für den aktuellen Stand nicht erbracht.
- Die Steuer- und Sozialwerte sind unverbindliche Schätzungen. Entwürfe für Einwilligungs-, Hilfe- und Nutzungstexte müssen vor einer öffentlichen Veröffentlichung anwaltlich geprüft werden. Das ist keine Prüfung einzelner EÜR-Buchungen und keine Voraussetzung für die interne Erfassung.

## Umgebungen und Freigaben

- solooffice.de ist die öffentliche Landingpage; ein öffentlicher SaaS-Fachapp-Endpunkt ist nicht freigegeben.
- demo.solooffice.de ist als Demo dokumentiert, wurde in dieser Aktualisierung aber nicht live geprüft.
- Selbsthosting ist möglich, ersetzt jedoch keine manuelle, rechtliche oder steuerliche Abnahme.

## Nächste Schritte

1. GitHub-Anmeldung erneuern und danach den vorbereiteten main-Stand und Tag v0.9.6 pushen.
2. CI abwarten und den vorgesehenen Staging-Deploy samt Laufzeitprüfung durchführen.
3. Demo-Update und GitHub-Beta-Pre-Release erst nach erfolgreicher Verifikation abschließen.
4. Die offenen Punkte aus docs/manual-release-checklist.md mit Steffen manuell prüfen. Bestehende Haken bleiben unverändert.
5. Backup, Überwachung und Rückfallplan für den aktuellen Betriebsstand nachweisen.

Ein erfolgreicher lokaler Build oder eine vorbereitete Version ist keine öffentliche Release- oder SaaS-Freigabe.
