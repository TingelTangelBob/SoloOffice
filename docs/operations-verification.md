# Automatisierte Instanzprüfung und Updates

**Stand:** 2026-08-30
**Status:** in `manage-instances.sh` integriert

## Schneller Commit-, Push- und Staging-Ablauf

Für einen normalen Änderungsstand bündelt das vorhandene Skript Commit, Push
und optional das Staging-Update:

```bash
bash deploy/solooffice-update-all.sh --message "Beschreibung" --staging
```

Das Skript verwendet keine Zugangsdaten aus dem Repository. Host, SSH-Nutzer,
Schlüssel, Zielverzeichnis und Instanz können über
`SOLOOFFICE_STAGING_HOST`, `SOLOOFFICE_STAGING_USER`, `SOLOOFFICE_STAGING_KEY`,
`SOLOOFFICE_STAGING_DEPLOY_DIR` und `SOLOOFFICE_STAGING_INSTANCE` gesetzt
werden. Standardmäßig wird der bekannte Staging-Server verwendet.

Der Ablauf ist absichtlich zweistufig: GitHub wird zuerst gepusht, danach wird
derselbe Commit als Archiv übertragen und serverseitig mit
`manage-instances.sh update` gebaut, gesichert und geprüft. So bleibt die
Staging-Instanz exakt auf dem Commit, der auch in GitHub liegt.

In einer eingeschränkten Agentenumgebung kann der erste `git push` wegen DNS-
oder Netzwerkbeschränkungen fehlschlagen. Dann wird derselbe Push mit einer
Netzwerkfreigabe wiederholt; ein zweiter Commit oder ein erneutes Staging-
Archiv ist dafür nicht nötig. Der direkte Archivtransfer zu Staging benötigt
ebenfalls eine explizite Netzwerkfreigabe, weil dabei Quellcode an den Server
übertragen wird.

SoloOffice kann eine laufende Self-Hosting-Instanz technisch prüfen, ohne sich
anzumelden oder Fachdaten zu verändern:

```bash
./manage-instances.sh verify <instanz>
```

Die Prüfung umfasst:

- Dateimodus `600` für beide Instanzdateien;
- gesunde Container für PostgreSQL, Backend und Frontend;
- interne Backend-Readiness mit erreichbarer Datenbank;
- Startseite und `/healthz` über den veröffentlichten Frontend-Port;
- erwartetes `401` für einen anonymen Aufruf von `/api/auth/me` samt
  `X-Request-ID`;
- PostgreSQL-Laufzeitrolle ohne `SUPERUSER` und `BYPASSRLS`;
- ausschließlich erzwungene RLS-Tabellen;
- neuesten registrierten Datenbank-Migrationsstand;
- gleiche Versions- und Commit-Labels für Frontend- und Backend-Image.

GitHub Actions startet mit jedem Commit zusätzlich eine frische vollständige
Compose-Instanz, wartet auf alle drei Healthchecks und führt genau diese
Prüfung gegen den erwarteten Commit aus. Damit werden Containerrechte,
schreibgeschütztes Frontend, Proxy, Migrationen und RLS bereits vor einem
Serverupdate gemeinsam erprobt.

Auf einer ganz frischen Datenbank entzieht die RLS-Migration dem Laufzeitkonto
einmalig seine PostgreSQL-Sonderrechte. Das Backend baut seine Verbindungen
danach innerhalb desselben Containers kontrolliert neu auf; der Container
bleibt dabei stabil und fordert höchstens einen solchen Neustart an.

Ein bestimmter Commit lässt sich zusätzlich erzwingen:

```bash
./manage-instances.sh verify <instanz> <vollständiger-commit-sha>
```

## Gesichertes Update

Nachdem der gewünschte Quellstand im Projektordner liegt, fasst der
Update-Befehl den serverseitigen Ablauf zusammen:

```bash
./manage-instances.sh update <instanz> [vollständiger-commit-sha]
```

Der Befehl verweigert veränderte Git-Arbeitsbäume und Quellstände ohne
eindeutigen Commit. Danach:

1. werden Prüfsummen der geschützten Instanzdateien aufgenommen;
2. wird ein vollständiges Instanzbackup erstellt;
3. werden Frontend und Backend mit Version und Commit als OCI-Image-Labels
   gebaut;
4. werden die laufenden Container erst nach erfolgreichen Builds ersetzt;
5. wird auf gesunde Container gewartet;
6. werden die Instanzdateien erneut per Prüfsumme verglichen;
7. läuft die vollständige technische Instanzprüfung.

Schlägt ein Image-Build fehl, bleiben die laufenden Container unverändert. Ein
fehlgeschlagener Start oder Smoke-Test wird deutlich gemeldet und nicht als
erfolgreiches Update ausgegeben. Datenbankmigrationen werden nicht automatisch
zurückgerollt; dafür bleibt das vorab erzeugte Backup maßgeblich.

## Commit-Nachweis ohne `.git`

Die Datei `BUILD_COMMIT` enthält im normalen Checkout nur einen Git-Platzhalter.
Beim Export mit `git archive` ersetzt Git ihn automatisch durch den exakten
40-stelligen Commit:

```bash
git archive --format=tar <commit> | \
  ssh <server> 'tar -xf - -C /opt/solooffice'
```

Damit kann auch ein Archiv-Deployment ohne `.git` den tatsächlichen Quellstand
ermitteln. Der Update-Befehl übernimmt diesen Wert in beide Images und die
Instanzprüfung vergleicht ihn anschließend.

## Abgrenzung

Die technische Prüfung ersetzt weder Anmeldung mit einem echten Konto noch
SMTP-Zustellung, Fachabläufe, OCR-Qualität, Responsive-Prüfung oder externe
E-Rechnungsvalidatoren. Diese Punkte bleiben in der
[manuellen Release-Checkliste](manual-release-checklist.md) getrennt geführt.
