# Automatisierte Tests und Qualitätstore

**Stand:** 2026-08-28
**Status:** im Docker-Build und in GitHub Actions integriert

SoloOffice trennt schnelle Regressionstests, reproduzierbare Image-Builds und
echte Datenbankintegration. Die Tests laufen in Docker; auf dem Entwicklungs-
Mac ist keine lokale Node-/PostgreSQL-Installation erforderlich.

## Teststufen

| Stufe | Umfang | Ausführung |
|---|---|---|
| Frontend-Fachlogik | 15 Tests für Nummernmuster, Zahlen-/Datumsformate, CSV-Schutz, Wiederholungen, Zahlungen und Kundendubletten | bei jedem Frontend-Image-Build |
| Backend-Regressionssuite | 36 Tests für Auth, Validierung, Restore-Archive, Health, Shutdown, CORS, Request-IDs und Metriken | bei jedem Backend-Image-Build |
| PostgreSQL-Integration | 7 Tests für alle Migrationen, Rollenentmachtung, erzwungene RLS, Trennung zweier Workspaces und parallele Rechnungsnummern | im gemeinsamen GitHub-Qualitätsworkflow |
| Statische Audit-Verträge | sicherheits- und fachkritische Quellverträge | vor beiden Image-Builds in GitHub Actions |

Der Frontend-Testlauf kompiliert nur ausgewählte, reine TypeScript-Fachmodule
in das ignorierte Verzeichnis `.test-dist` und führt sie anschließend mit
`node:test` aus. Dadurch ist kein Browser-Simulator nötig und die geprüfte
Logik entspricht trotzdem dem TypeScript-Quellstand.

## Docker-Prüfung

```bash
docker compose --env-file .env.<name> -f docker-compose.yml build frontend backend
```

Der Frontend-Build läuft nur durch, wenn Test, ESLint, TypeScript und Vite-Build
erfolgreich sind. Der Backend-Build führt die schnelle Suite mit `npm test`
aus. Die PostgreSQL-Integration läuft bewusst separat gegen eine frische
PostgreSQL-15-Datenbank, weil ein Image-Build keinen Datenbankdienst enthalten
soll.

## Was der RLS-Test nachweist

Der CI-Lauf startet eine leere PostgreSQL-Datenbank und führt den echten
Migrationspfad aus. Die Migration darf die anfänglich privilegierte Docker-
Rolle entmachten und genau einen kontrollierten Neustart verlangen. Danach wird
geprüft:

- kein ausstehender Migrationsschritt;
- Laufzeitrolle mit `NOSUPERUSER NOBYPASSRLS`;
- jede RLS-Tabelle mit `FORCE ROW LEVEL SECURITY`;
- Workspace A sieht nur Kunde A, Workspace B nur Kunde B;
- ein leerer Request-Kontext sieht keine Fachdaten;
- ein Cross-Workspace-Schreibversuch scheitert in PostgreSQL.
- zwei parallele Transaktionen reservieren unterschiedliche Rechnungsnummern.

Die Testdaten verwenden zufällige IDs und werden am Ende entfernt. Der
GitHub-Service selbst ist kurzlebig und wird nach dem Workflow verworfen.

## Bewusste Grenzen

Automatisiert sind reine Frontend-Fachlogik, Backend-Hilfslogik und die zentrale
Datenbank-Isolationsnaht. Nicht ersetzt werden:

- visuelle und interaktive Browserabnahme;
- reale SMTP-Zustellung;
- OCR-Qualität mit repräsentativen Belegen;
- offizielle KOSIT-/FeRD-/Factur-X-Validatoren;
- Offsite-Backup und externe Betriebsüberwachung.

Diese Punkte stehen dauerhaft in der
[manuellen Release-Checkliste](manual-release-checklist.md).
