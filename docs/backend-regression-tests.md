# Nachweis: Backend-Regressionssuite und Request-Tracing

**Datum:** 2026-08-28
**Laufzeit:** Node.js 20 im Backend-Image
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
- standardmäßig gesperrter Metrikzugriff mit konstantzeitlichem Tokenvergleich
- Validierung, Weitergabe und Verschachtelung von Request-IDs

## Ergebnis

```text
tests=16
passed=16
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

Die Suite ersetzt noch keine Datenbank-Integrationstests, offiziellen
E-Rechnungsvalidatoren oder externes Uptime-Monitoring.
