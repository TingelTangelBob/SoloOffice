# SoloOffice selbst hosten

Diese Anleitung beschreibt den aktuellen Beta-/Testbetrieb mit Docker Compose.
Sie ist keine Freigabe für einen unbeaufsichtigten Produktivbetrieb.

## Voraussetzungen

- Docker Engine oder Docker Desktop mit Compose v2
- ein Host mit dauerhaftem Speicher für PostgreSQL und Backups
- ein Reverse Proxy mit HTTPS für öffentliche Erreichbarkeit
- eine eigene Absenderdomain und SMTP-Zugang, sobald E-Mails versendet werden

## Neue Instanz starten

```bash
git clone https://github.com/TingelTangelBob/SoloOffice.git
cd SoloOffice
chmod +x deploy-instance.sh manage-instances.sh
./deploy-instance.sh
```

Das Deployment erzeugt pro Instanz `.env.<name>` und
`.env.backend.<name>`. Beide Dateien enthalten Geheimnisse und bleiben lokal,
außerhalb des Git-Repositories. Vor dem ersten öffentlichen Betrieb müssen
`CORS_ORIGIN`, `COOKIE_SECURE` und die Reverse-Proxy-Einstellungen auf die
tatsächliche Adresse angepasst werden.

```bash
./manage-instances.sh list
./manage-instances.sh logs <name> backend
```

## Erster Login und Workspace

1. Frontend-Adresse öffnen.
2. Den ersten Benutzer registrieren.
3. Im Menü den eigenen Bereich **Workspace** öffnen.
4. Workspace-Namen prüfen oder ändern, weitere Workspaces anlegen und
   Mitglieder mit den Rollen Administrator, Mitarbeiter oder Nur lesen
   einladen.
5. Für jede weitere Person den Einladungslink sicher übermitteln.

Die öffentliche Registrierung ist nach dem ersten Konto standardmäßig
geschlossen. Für weitere Konten ist eine Einladung vorgesehen. Bei aktiviertem
`REQUIRE_EMAIL_VERIFICATION=true` ist zusätzlich ein funktionierendes SMTP-Setup
erforderlich.

## Sicherheit der Datenbankrolle

Die Migration `032_runtime_rls_role` prüft, ob der PostgreSQL-Benutzer des
Backends als Superuser läuft. Auf einer frischen Docker-Datenbank wird er nach
den Schema-Migrationen auf `NOSUPERUSER NOBYPASSRLS` gesetzt. Das Backend
beendet sich danach einmal kontrolliert; Docker startet es mit neuen
Verbindungen erneut. Dieser Neustart ist beim ersten Start erwartbar.

RLS ist nur dann eine wirksame Mandantengrenze, wenn der Laufzeitbenutzer nicht
`SUPERUSER` oder `BYPASSRLS` ist. Das lässt sich prüfen:

```bash
docker exec <projekt>-db psql -U <datenbankbenutzer> -d <datenbank> \
  -c "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user"
```

Beide Werte müssen `f` sein. Das Passwort des Datenbankbenutzers wird dabei
nicht ausgegeben.

## Backup und Restore

Backups werden im Bereich **Einstellungen → E-Mail & Backup** erstellt. Es
stehen JSON-Backups und ZIP-Vollbackups zur Verfügung. Sie sind an den aktiven
Workspace gebunden:

- Download und Liste zeigen nur Backups des aktiven Workspace.
- Restore löscht und schreibt nur Daten des aktiven Workspace.
- SMTP-Passwörter werden nicht in das Backup übernommen.
- Backups müssen zusätzlich außerhalb des Hosts aufbewahrt werden.

Vor jeder Aktualisierung:

```bash
./manage-instances.sh backup <name>
```

Der technische Nachweis mit zwei Workspaces steht in
[`backup-restore-nachweis.md`](backup-restore-nachweis.md).

## Aktualisierung

```bash
git pull
docker compose --env-file .env.<name> -f docker-compose.yml up -d --build
docker compose --env-file .env.<name> -f docker-compose.yml ps
```

Nach dem Update müssen `/health`, Login und der aktive Workspace geprüft
werden. Migrationen laufen beim Backend-Start automatisch. Ein Datenbankbackup
vor jedem Update bleibt Pflicht.

## Reverse Proxy und HTTPS

Das Frontend ist der öffentliche Einstiegspunkt. Der Backend-Port bleibt im
Compose-Netzwerk. Hinter HTTPS müssen mindestens diese Werte stimmen:

```dotenv
CORS_ORIGIN=https://app.example.de
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
TRUST_PROXY=1
```

Bei Frontend und Backend auf unterschiedlichen Sites ist
`COOKIE_SAME_SITE=none` zusammen mit `COOKIE_SECURE=true` erforderlich.

## Bekannte Grenzen

- Der aktuelle Stand ist Beta/Test und noch kein freigegebenes Hostingprodukt.
- SMTP-Zustellung muss mit eigener Domain, SPF, DKIM und DMARC nachgewiesen
  werden.
- Offsite-Backup, Objektspeicher, Überwachung und Alarmierung sind noch nicht
  als vollständiger SaaS-Betrieb umgesetzt.
- Die offiziellen KOSIT-/FeRD-Validatoren müssen vor einer fachlichen Freigabe
  zusätzlich ausgeführt werden.

## Technische Nachweise

- [Multiuser- und RLS-Isolation](rls-isolation-nachweis.md)
- [Backup und Restore](backup-restore-nachweis.md)
- [Identity-/Workspace-Testablauf](identity-workspace-local-testing.md)
