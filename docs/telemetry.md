# SoloOffice-Telemetrie

SoloOffice enthält einen optionalen, best-effort Telemetrie-Hook zum Control
Plane. Er ist standardmäßig deaktiviert. Der Demo-Build sendet grundsätzlich
nichts, weil er ohne Backend arbeitet.

## Datenschutzgrenze

Der Browser sendet Ereignisse ausschließlich an den authentifizierten
SoloOffice-Backend-Endpunkt `/api/telemetry`. Das Control-Plane-Secret bleibt
serverseitig. Das Backend filtert die Ereignisse erneut und leitet nur Namen aus
der Vertrags-Allowlist sowie optional den kleinen Zähler `count` weiter. Es
werden keine Kunden-, Benutzer- oder Workspace-Namen, E-Mail-Adressen,
Rechnungsinhalte oder Beträge übertragen. `invoice_sent_count` wird im
selfhost-Betrieb verworfen; der Vertrag erlaubt ihn nur für `hosted`.

Im `hosted`-Betrieb gibt das Backend zusätzlich die UUID des aktiven Workspace
(`workspaceId`) mit. Sie ist ein technischer Schlüssel ohne Namen; der Control
Plane ordnet sie serverseitig dem Kundenkonto zu, damit Kennzahlen wie
DAU/MAU je Konto möglich sind. Self-Host-Installationen senden nie eine
Workspace-Kennung.

Die vollständige Allowlist und das Ziel-API stehen im
[`telemetry-contract.md`](../../control-plane/docs/telemetry-contract.md).

## Aktivierung

Die Frontend-Buildvariable und die Backend-Laufzeitkonfiguration müssen beide
aktiviert werden. Für eine Self-Host-Installation:

```env
VITE_TELEMETRY_ENABLED=true
TELEMETRY_ENABLED=true
TELEMETRY_SOURCE=selfhost
TELEMETRY_URL=https://control-plane.example/api/telemetry/ingest
TELEMETRY_SECRET=<mindestens-32-Zeichen>
TELEMETRY_INSTALLATION_ID=sh_<UUID>
TELEMETRY_INSTALLED_AT=2026-09-15T10:00:00.000Z
```

Eine ID kann beispielsweise mit `node -e "console.log('sh_' + crypto.randomUUID())"`
erzeugt werden. `TELEMETRY_INSTALLATION_ID` und `TELEMETRY_INSTALLED_AT` sind
absichtlich getrennte Felder. Fehlt eine Pflichtangabe oder ist sie ungültig,
bleibt der Hook aus. Zum Opt-out `TELEMETRY_ENABLED=false` und
`VITE_TELEMETRY_ENABLED=false` setzen und das Frontend neu bauen.

Das Backend verwendet `X-Telemetry-Secret` nur beim Relay zum Control Plane.
Ein Fehler oder eine Deaktivierung des optionalen Ziels beeinflusst keine
Fachfunktion und wird nicht an den Benutzer durchgereicht.
