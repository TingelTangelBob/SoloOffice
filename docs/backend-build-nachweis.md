# Nachweis: reproduzierbarer Backend-Bau

**Datum:** 2026-08-26  
**Instanz:** TestDocker `TestDocker` · `/opt/solooffice-tor-s`  
**Status:** technisch bestanden, Gegenlesen für AP-2.1 offen

## Änderung

- `backend/package-lock.json` mit Lockfile-Version 3 ergänzt.
- Das Backend-Image installiert Produktionsabhängigkeiten mit
  `npm ci --omit=dev`.
- Die ungenutzte direkte Abhängigkeit `uuid` wurde entfernt.
- `adm-zip`, Nodemailer und Multer wurden auf Versionen ohne bekannte
  npm-Audit-Befunde aktualisiert.

## Sicherheitsprüfung

Der Produktions-Audit im Node-20-Container meldet:

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

Die installierten Node-Abhängigkeiten sind damit zwischen beiden Läufen
identisch. Betriebssystempakete bleiben an das digest-gepinnte
`node:20-alpine`-Basisimage und dessen Alpine-Repositories gebunden.

## Verbleibender Hinweis

`pdfkit@0.14.0` zieht transitiv das nicht mehr aktiv gepflegte
`crypto-js@4.2.0` ein. npm meldet dafür aktuell keine bekannte Schwachstelle.
Ein PDFKit-Upgrade braucht einen getrennten PDF-Regressionslauf und ist nicht
Teil dieses Pakets.
