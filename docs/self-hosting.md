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

## Geheimnisse und Instanzdateien

Die beiden `.env`-Dateien sind Teil der Betriebsdaten. Mindestens diese Werte
müssen dauerhaft erhalten bleiben:

- `POSTGRES_PASSWORD` und die dazugehörigen Datenbanknamen
- `ENCRYPTION_KEY`
- Domain-, Cookie- und SMTP-Einstellungen

```bash
chmod 600 .env.<name> .env.backend.<name>
```

Der `ENCRYPTION_KEY` muss 32 Byte lang sein und wird vom Deployment als 64
Hex-Zeichen erzeugt. Geht er verloren oder wird er ohne Migration ersetzt,
können bereits gespeicherte SMTP-Passwörter nicht mehr entschlüsselt werden.
Er gehört deshalb zusammen mit dem Datenbankdump in das verschlüsselte
Offsite-Backup, aber niemals in Git, ein Ticket oder ein öffentliches
Webverzeichnis.

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
Verbindungen erneut. Zusätzlich werden die Rolle und alle RLS-Tabellen bei
jedem Start geprüft, damit auch ein in ein frisches PostgreSQL-Volume
eingespielter Dump oder eine unterbrochene Wartung sicher bleibt. Dieser
Neustart ist beim ersten Start und nach einer vollständigen Wiederherstellung
erwartbar.

RLS ist nur dann eine wirksame Mandantengrenze, wenn der Laufzeitbenutzer nicht
`SUPERUSER` oder `BYPASSRLS` ist. Das lässt sich prüfen:

```bash
docker exec <projekt>-db psql -U <datenbankbenutzer> -d <datenbank> \
  -c "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user"
```

Beide Werte müssen `f` sein. Das Passwort des Datenbankbenutzers wird dabei
nicht ausgegeben.

## Workspace-Backup und vollständiges Instanz-Backup

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

Für den vollständigen SQL-Dump hält das Skript das Backend kurz an. Da der
Laufzeitbenutzer selbst Tabellenbesitzer ist, wird `FORCE ROW LEVEL SECURITY`
nur für diesen angehaltenen Dump vorübergehend gelöst und anschließend auch
bei einem Fehler wieder aktiviert. Der Datenbankport darf währenddessen nicht
öffentlich veröffentlicht sein. Der Dump enthält am Ende zusätzlich die
ursprünglichen `FORCE`-Anweisungen; der Backend-Start prüft Rolle und Tabellen
noch einmal unabhängig davon. Ein fehlgeschlagener Lauf entfernt den
unvollständigen Dump und startet ein zuvor laufendes Backend wieder.

Dieses Skript legt neben dem SQL-Dump auch Kopien der beiden Instanz-
Konfigurationen mit Datenbankpasswort und `ENCRYPTION_KEY` an. Der Backup-
Ordner wird deshalb auf `700`, die erzeugten Dateien auf `600` gesetzt. Die
Dateien dürfen nicht in Git oder ein öffentliches Webverzeichnis gelangen und
sollten zusätzlich verschlüsselt an einem zweiten Ort aufbewahrt werden.

Das Repository richtet bewusst weder Zeitplan noch Offsite-Ziel ein. Ein
einfacher täglicher Cron-Eintrag auf einem Linux-Host kann so aussehen:

```cron
17 2 * * * root cd /opt/solooffice && ./manage-instances.sh backup produktiv >> /var/log/solooffice-backup.log 2>&1
```

Die erzeugten Dateien müssen danach auf einen zweiten Host oder in einen
verschlüsselten Objektspeicher übertragen werden. Beispiel für einen bereits
abgesicherten SSH-Backupzugang:

```bash
rsync -a --chmod=F600,D700 /opt/solooffice/backups/ \
  backup@backup.example:/srv/backups/solooffice-produktiv/
```

SoloOffice prüft dieses Ziel nicht automatisch. Der Betreiber muss
Übertragungsfehler überwachen, Aufbewahrungsfristen festlegen und regelmäßig
eine Wiederherstellung in einer getrennten Testinstanz durchführen. Erst nach
einer erfolgreichen Offsite-Übertragung sollten alte lokale Sicherungen
gelöscht werden.

## Wiederherstellung nach einem Host- oder Volume-Ausfall

Für eine vollständige Wiederherstellung werden das zusammengehörige Trio aus
SQL-Dump, `.env.<name>` und `.env.backend.<name>` sowie derselbe Quellstand
benötigt. Die Wiederherstellung erfolgt in eine **leere** PostgreSQL-Datenbank;
ein Dump darf nicht über eine bereits befüllte Instanz geschrieben werden.

```bash
install -m 600 backups/env_produktiv_<zeitstempel> .env.produktiv
install -m 600 backups/env_backend_produktiv_<zeitstempel> .env.backend.produktiv

docker compose --env-file .env.produktiv -f docker-compose.yml up -d database
docker compose --env-file .env.produktiv -f docker-compose.yml \
  exec -T database pg_isready -U rm_user_produktiv -d belego_produktiv

docker compose --env-file .env.produktiv -f docker-compose.yml \
  exec -T database \
  psql -U rm_user_produktiv -d belego_produktiv \
  < backups/backup_produktiv_<zeitstempel>.sql

docker compose --env-file .env.produktiv -f docker-compose.yml up -d --build
docker compose --env-file .env.produktiv -f docker-compose.yml ps
```

Beim ersten Backend-Start werden die aktuelle Datenbankrolle und alle
RLS-Tabellen unabhängig vom gesicherten Migrationsstand erneut geprüft. Die
Rolle muss `NOSUPERUSER NOBYPASSRLS` sein, jede RLS-Tabelle muss `FORCE ROW
LEVEL SECURITY` verwenden. Ein einmaliger Backend-Neustart ist dabei
erwartbar. Anschließend müssen mindestens Login, aktiver Workspace,
Kundenzahl, eine Rechnung und ein Download geprüft werden.

Der technische Nachweis mit zwei Workspaces steht in
[`backup-restore-nachweis.md`](backup-restore-nachweis.md).

## Aktualisierung

```bash
git pull
docker compose --env-file .env.<name> -f docker-compose.yml up -d --build
docker compose --env-file .env.<name> -f docker-compose.yml ps
```

Nach dem Update müssen Backend-Healthcheck, Login und der aktive Workspace
geprüft werden. Der Healthcheck ist intern und erscheint in
`docker compose ps` als `healthy`; ein Aufruf von `/health` am veröffentlichten
Frontend-Port prüft nicht die Datenbank. Die direkte Antwort lässt sich so
ansehen:

```bash
docker compose --env-file .env.<name> -f docker-compose.yml \
  exec -T backend node -e \
  "fetch('http://127.0.0.1:3001/health').then(async response => { console.log(response.status, await response.text()); process.exit(response.ok ? 0 : 1); }).catch(() => process.exit(1))"
```

Migrationen laufen beim Backend-Start automatisch. Ein Datenbankbackup vor
jedem Update bleibt Pflicht.

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

Empfohlen ist eine gemeinsame öffentliche Adresse für Frontend und `/api`.
Zusätzlich sollte in `.env.backend.<name>` stehen:

```dotenv
APP_BASE_URL=https://app.example.de
```

Damit verwenden Einladungs-, Verifikations- und Passwort-Reset-Links dieselbe
öffentliche Basisadresse. Nach Änderungen an den Instanzdateien muss der Stack
neu erstellt werden.

### nginx-Beispiel

Der Host-Proxy zeigt ausschließlich auf den veröffentlichten Frontend-Port;
das interne Frontend-nginx leitet `/api` an das Backend weiter:

```nginx
server {
    listen 80;
    server_name app.example.de;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name app.example.de;

    ssl_certificate /etc/letsencrypt/live/app.example.de/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.example.de/privkey.pem;

    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

Die Zertifikatsausstellung muss vor dem produktiven Einsatz eingerichtet und
automatisch erneuert werden. HSTS erst aktivieren, wenn HTTPS und alle
Subdomains dauerhaft korrekt funktionieren.

### Caddy-Beispiel

Caddy beschafft und erneuert das Zertifikat automatisch, sobald die Domain auf
den Host zeigt und Port 80/443 erreichbar ist:

```caddyfile
app.example.de {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8080

    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy no-referrer
        Permissions-Policy "camera=(), microphone=(), geolocation=()"
    }
}
```

Der externe Proxy und das interne Frontend begrenzen Uploads aktuell effektiv
auf 100 MB. Größere ZIP-Dateien müssen für einen Restore auf Host-Ebene oder
über eine bewusst angepasste Proxygrenze verarbeitet werden.

## Betreiberverantwortung

Zum Selbsthosting gehören mindestens Betriebssystem- und Docker-Updates,
TLS-Erneuerung, SMTP-Reputation, Protokollkontrolle, Speicherüberwachung,
Offsite-Backups, Restore-Proben sowie die datenschutz- und steuerrechtliche
Bewertung des eigenen Einsatzes. SoloOffice automatisiert diese Pflichten im
aktuellen Beta-Stand nicht.

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
