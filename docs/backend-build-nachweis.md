# Nachweis: reproduzierbarer Backend-Bau

**Datum:** 2026-08-26, Gegenprüfung, Tests und Node-22-Umstellung ergänzt am 2026-08-28
**Instanz:** TestDocker `TestDocker` · `/opt/solooffice-tor-s`  
**Status:** technisch bestanden und gegengeprüft

## Änderung

- `backend/package-lock.json` mit Lockfile-Version 3 ergänzt.
- Das Backend-Image installiert Produktionsabhängigkeiten mit
  `npm ci --omit=dev`.
- Die ungenutzte direkte Abhängigkeit `uuid` wurde entfernt.
- `adm-zip`, Nodemailer und Multer wurden auf Versionen ohne bekannte
  npm-Audit-Befunde aktualisiert.

## Sicherheitsprüfung

Der Produktions-Audit im Node-22-Container meldet:

```text
found 0 vulnerabilities
```

Die von SoloOffice genutzten APIs wurden im fertigen Image geprüft:

```text
dependency_api_smoke=PASS
```

Der Test erzeugt und liest ein ZIP-Archiv und prüft die Exporte
`nodemailer.createTransport` sowie `multer.default`. Alle Backend-JavaScript-
Dateien bestanden außerdem `node --check` im Container.

## Doppelbuild ohne Cache

Das Backend-Image wurde zweimal vollständig ohne Docker-Cache gebaut. Danach
wurde in beiden Images der komplette mit `npm ls --omit=dev --all --json`
ermittelte Produktions-Abhängigkeitsbaum gehasht:

```text
Build A: 3d456aa5d3536e8ed47f1c881643cc7dcacb0af2dcd05ed5823e1e8836fcbc0c
Build B: 3d456aa5d3536e8ed47f1c881643cc7dcacb0af2dcd05ed5823e1e8836fcbc0c
```

Die installierten Node-Abhängigkeiten waren damit zwischen beiden Läufen
identisch. Die Anwendung verwendet inzwischen `node:22-alpine`; der Tag ist
nicht digest-gepinnt und kann bei einem späteren Neubau ein aktualisiertes
Node-/Alpine-Basisimage liefern. Reproduzierbar festgeschrieben ist der
npm-Abhängigkeitsbaum über `backend/package-lock.json`, nicht das
Betriebssystemimage. Der vollständige Image-Build in CI bleibt deshalb das
maßgebliche Qualitätstor.

Seit dem 2026-08-28 führt der Backend-Build zusätzlich die dokumentierte
[`Backend-Regressionssuite`](backend-regression-tests.md) aus. Ein Image wird
nur noch erzeugt, wenn alle Tests bestanden sind. Der aktuelle Auditablauf ist
im [`Abhängigkeitsnachweis`](dependency-security.md) beschrieben.

## PDFKit-Aktualisierung

PDFKit wurde von 0.14 auf 0.20 angehoben. Damit entfällt die transitive,
nicht mehr gepflegte Abhängigkeit `crypto-js`. Ein eigener Regressionstest
erzeugt bei jedem Backend-Build ein mehrseitiges PDF mit denselben zentralen
Text-, Farb-, Rechteck-, Seiten- und Standardschrift-APIs wie das
Rechnungsjournal. Anfang, Ende und Mindestgröße der Ausgabe werden geprüft.
