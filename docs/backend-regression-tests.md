# Nachweis: Backend-Regressionssuite und Request-Tracing

**Datum:** 2026-08-28
**Laufzeit:** Node.js 22 im Backend-Image
**Status:** technisch bestanden

## Umfang

Die Suite verwendet ausschließlich `node:test` und benötigt kein zusätzliches
Testframework. Sie wird durch `RUN npm test` bei jedem Backend-Image-Build
ausgeführt und deckt folgende Verträge ab:

- Normalisierung von E-Mail-Adressen, Passwortregeln und scrypt-Prüfung
- sichere Sitzungs-Token, Cookie-Auswertung und Workspace-Slugs
- Validierung und Formatierung konfigurierbarer Rechnungsnummernmuster
- UUID-, Datums-, Zahlen-, Schema- und Rabattvalidierung
- Base64-Prüfung für lokal verarbeitete Belege
- ZIP-/JSON-Backupstruktur, Entpack- und Datensatzgrenzen
- CORS-Herkunft, öffentliche Health-Antworten und Graceful Shutdown
- standardmäßig gesperrter Metrikzugriff, begrenzte Routenkardinalität sowie
  getrennte 4xx-/5xx-Zähler
- Validierung, Weitergabe und Verschachtelung von Request-IDs
- echte PDF-Erzeugung mit PDFKit einschließlich mehrseitigem Dokument und
  gültigem PDF-Anfang/-Ende

## Ergebnis

```text
tests=37
passed=37
failed=0
result=PASS
```

Zusätzlich werden alle Backend-JavaScript-Dateien mit `node --check`, die
statischen Audit-Verträge und der vollständige Docker-Build geprüft.

## Request-Tracing

Jede HTTP-Antwort enthält `X-Request-ID`. Eine zulässige eingehende ID wird
übernommen, andernfalls erzeugt das Backend eine UUID. Die ID bleibt beim
Übergang in den authentifizierten Workspace-Kontext erhalten und wird
automatisch an strukturierte Backend-Logs angefügt. Bei HTTP-5xx ergänzt das
Frontend die Referenz in der Fehlermeldung, damit Browsermeldung und
Serverprotokoll eindeutig zusammengeführt werden können. Query-Strings werden
nicht in Request-Logs übernommen.

## Metrikschutz

`/metrics` ist ohne `METRICS_TOKEN` geschlossen und antwortet mit HTTP 503 und
`METRICS_NOT_CONFIGURED`. Mit konfiguriertem Token ist exakt
`Authorization: Bearer <Token>` erforderlich; falsche Angaben enden mit HTTP
401 und `METRICS_UNAUTHORIZED`.

Die separate CI-Stufe prüft Migrationen und RLS gegen PostgreSQL; Frontend- und
Datenbankumfang stehen in [`automated-tests.md`](automated-tests.md). Die Suite
ersetzt keine Browserabnahme, offiziellen E-Rechnungsvalidatoren oder externes
Uptime-Monitoring.
