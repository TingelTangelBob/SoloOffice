# Automatisierte Tests und Qualitätstore

**Stand:** 2026-09-23
**Status:** im Docker-Build und in GitHub Actions integriert

SoloOffice trennt schnelle Regressionstests, reproduzierbare Image-Builds und
echte Datenbankintegration. Die Tests laufen in Docker; auf dem Entwicklungs-
Mac ist keine lokale Node-/PostgreSQL-Installation erforderlich.

## Teststufen

| Stufe | Umfang | Ausführung |
|---|---|---|
| Frontend-Fachlogik | 43 Tests für Nummernmuster, Zahlen-/Datumsformate, CSV-Schutz, Wiederholungen, Zahlungen, Kundendubletten und Importdateien (Excel-Arbeitsmappen, Zeichensätze, Spaltenformate, Vorlagen) | bei jedem Frontend-Image-Build |
| Backend-Regressionssuite | 99 Tests für Auth, Validierung, Restore-Archive, Health, Shutdown, kontrollierten RLS-Neustart, CORS, Request-IDs, Metriken, PDFKit-Ausgabe, Rechnungsnummern und die Importplanung der Datenübernahme | bei jedem Backend-Image-Build |
| PostgreSQL-Integration | 43 Tests für alle Migrationen, Rollenentmachtung, erzwungene RLS, Trennung zweier Workspaces, parallele Dokumentnummern, Rechnungsintegrität, Control-Plane-Workspaces und die Datenübernahme (Import, übernommene Rechnungen, Rückgängig) | im gemeinsamen GitHub-Qualitätsworkflow |
| Statische Audit-Verträge | sicherheits- und fachkritische Quellverträge | vor beiden Image-Builds in GitHub Actions |
| Abhängigkeits-Audit | vollständiger Frontend-Baum ab hoher Kritikalität sowie produktive Frontend-/Backend-Bäume ab mittlerer Kritikalität | vor beiden Image-Builds in GitHub Actions |
| Betriebsverträge | Shell-Syntax, Archiv-Commit, OCI-Labels, komplette Compose-Instanz, Healthchecks und geschützte Update-/Prüfpfade | in GitHub Actions und nach jedem Instanzupdate |

Der Frontend-Testlauf kompiliert nur ausgewählte, reine TypeScript-Fachmodule
in das ignorierte Verzeichnis `.test-dist` und führt sie anschließend mit
`node:test` aus. Dadurch ist kein Browser-Simulator nötig und die geprüfte
Logik entspricht trotzdem dem TypeScript-Quellstand.

Die Zahlen entsprechen dem Stand der vorhandenen `test(...)`-Deklarationen am
23.09.2026: 43 Frontend-, 99 Backend-Unit- und 43
PostgreSQL-Integrationstests. Sie werden bei Änderungen an den Tests erneut
gezählt und nicht aus älteren Release-Notizen übernommen.

## Docker-Prüfung

```bash
docker compose --env-file .env.<name> -f docker-compose.yml build frontend backend
```

Der Frontend-Build läuft nur durch, wenn Test, ESLint, TypeScript und Vite-Build
erfolgreich sind. Der Backend-Build führt die schnelle Suite mit `npm test`
aus. Die PostgreSQL-Integration läuft bewusst separat gegen eine frische
PostgreSQL-15-Datenbank, weil ein Image-Build keinen Datenbankdienst enthalten
soll.

Zusätzlich prüft die CI vor dem Bau den aktuellen npm-Sicherheitsstand. Der
vollständige Frontend-Baum darf keine hohe oder kritische bekannte
Schwachstelle enthalten. In den produktiven Frontend- und Backend-Bäumen sind
auch mittlere Befunde blockierend. Versionen und Grenzen stehen im
[`Abhängigkeitsnachweis`](dependency-security.md).

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

Die zusätzliche technische Prüfung einer tatsächlich laufenden Instanz ist im
[Betriebsnachweis](operations-verification.md) beschrieben.
