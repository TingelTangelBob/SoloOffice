# SoloOffice selbst hosten

Diese Anleitung ist die eigenständige Vorlage für eine öffentlich erreichbare
SoloOffice-Instanz mit Docker Compose und TLS. Sie beschreibt den aktuellen
Beta-/Teststand und ist keine Freigabe für einen unbeaufsichtigten
Produktivbetrieb. Der Betreiber bleibt für Host, Netzwerk, Geheimnisse,
Backups, Wiederherstellung und die fachliche sowie rechtliche Nutzung
verantwortlich.

> **Demo-vHost nicht übernehmen:**
> `deploy/nginx-host-demo.solooffice.de.conf` gehört zur Live-Demo. Die Datei
> ist eine 80er-Vorlage; Certbot ergänzt dort den 443-Block. Sie darf niemals
> 1:1 über einen Self-Hosting- oder Host-vHost kopiert werden: Dabei können
> der von Certbot verwaltete `certbot-443`-Block und die TLS-Einstellungen
> verloren gehen; bei einer alten Demo-Fassung kann außerdem
> `X-Robots-Tag: noindex` zurückkehren. Die folgenden Beispiele sind eine
> eigene Self-Hosting-Vorlage.

## Voraussetzungen und Zielbild

- Linux-Host oder Docker Desktop mit Docker Engine und Docker Compose v2
- Bash, Git und OpenSSL für die mitgelieferten Skripte
- eine eigene Domain, zum Beispiel `app.example.de`, deren `A`-/`AAAA`-
  Einträge auf den Host zeigen
- eingehend nur die für den Reverse Proxy benötigten Ports 80 und 443; der
  veröffentlichte Frontend-Port darf nicht aus dem Internet erreichbar sein
- dauerhaftes Speichervolume für PostgreSQL und ausreichend Speicher für
  lokale Sicherungen
- entweder nginx mit Certbot oder Caddy auf dem Host

Die vorgesehene Topologie lautet:

```text
Internet --HTTPS--> nginx/Caddy auf dem Host --HTTP--> Frontend :8080
                                                    --/api--> Backend :3001
                                                               --> PostgreSQL :5432
```

Nur das Frontend wird vom Compose-Stack auf dem Host veröffentlicht. Backend
und PostgreSQL bleiben im Compose-Netzwerk. Der Host-Reverse-Proxy spricht den
Frontend-Port über `127.0.0.1` an; der Host muss zusätzlich verhindern, dass
dieser Port direkt aus dem Internet erreichbar ist. Bei Docker-Published-Ports
reicht eine Firewall-Regel nicht auf jedem System allein aus. Von außen muss
geprüft werden, dass nur 80/443 offen sind.

## Neue Instanz starten

```bash
git clone https://github.com/TingelTangelBob/SoloOffice.git
cd SoloOffice
chmod +x deploy-instance.sh manage-instances.sh
./deploy-instance.sh
```

Das interaktive Deployment fragt einen Instanznamen sowie Ports ab und erzeugt
pro Instanz `.env.<name>` und `.env.backend.<name>`. Beide Dateien enthalten
Geheimnisse und bleiben lokal außerhalb des Git-Repositories. Der erste Start
erfolgt zunächst über HTTP am Frontend-Port. Die Instanz darf erst nach der
öffentlichen Konfiguration und dem eingerichteten TLS-Reverse-Proxy von außen
erreichbar sein.

```bash
./manage-instances.sh list
./manage-instances.sh verify <name>
./manage-instances.sh logs <name> backend
```

`<name>` ist der beim Deployment gewählte Instanzname. Das Skript verwendet
pro Instanz einen eigenen Compose-Projektnamen und ein eigenes PostgreSQL-
Volume. Backend und Datenbank werden im normalen Compose-Setup nicht als
Host-Ports veröffentlicht.

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
Webverzeichnis. Ein neuer Schlüssel ist kein Ersatz für den alten: Vor einer
Änderung muss ein ausdrücklich dafür vorgesehener Migrationsweg vorhanden sein;
die aktuelle Anleitung beschreibt keine Schlüsselrotation.

## Öffentliche Adresse und Cookie-Konfiguration

Vor dem ersten öffentlichen Aufruf die beiden Instanzdateien mit einem Editor
anpassen. Für die folgende gemeinsame Adresse `https://app.example.de` lautet
die relevante Konfiguration:

In `.env.<name>` (der Compose-Env-Datei):

```dotenv
CORS_ORIGIN=https://app.example.de
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
TRUST_PROXY=2
OCR_CONCURRENCY_LIMIT=2
OCR_TIMEOUT_MS=120000
```

In `.env.backend.<name>`:

```dotenv
APP_BASE_URL=https://app.example.de
CORS_ORIGIN=https://app.example.de
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
```

Die Werte in `.env.<name>` werden von Compose interpoliert und als
`environment`-Werte gesetzt; sie überschreiben gleichnamige Werte aus
`.env.backend.<name>`. Deshalb müssen `CORS_ORIGIN`, `COOKIE_SECURE`,
`COOKIE_SAME_SITE` und `TRUST_PROXY` mindestens in `.env.<name>` korrekt sein.
`APP_BASE_URL` wird aus der Backend-Datei gelesen. Gleiche Werte in beiden
Dateien verhindern Fehlersuche mit einer veralteten Kopie.

Die vier Einstellungen greifen zusammen:

| Einstellung | Wirkung | Öffentliche Standardkonfiguration |
| --- | --- | --- |
| `COOKIE_SECURE` | Session- und CSRF-Cookies werden nur über HTTPS gesendet. | `true` |
| `COOKIE_SAME_SITE` | Begrenzt, bei welchen siteübergreifenden Anfragen Cookies mitgehen. | `lax` bei einer gemeinsamen App-Adresse |
| `TRUST_PROXY` | Legt fest, wie viele kontrollierte Proxy-Hops Express für Client-IP und Protokoll vertraut. | `2` für Host-nginx/Caddy plus internes Frontend-nginx |
| `CORS_ORIGIN` | Erlaubt den exakten Browser-Ursprung für API-Anfragen. | `https://app.example.de` ohne Pfad und ohne abschließenden `/` |
| `OCR_CONCURRENCY_LIMIT` | Begrenzt die gleichzeitig laufenden lokalen OCR-Vorgänge; wartende Belege werden eingereiht. | `2` |
| `OCR_TIMEOUT_MS` | Bricht einen hängenden OCR-Hilfsprozess nach dieser Zeit in Millisekunden ab. | `120000` |

In der hier gezeigten Topologie liegen zwischen Backend und Browser zwei
kontrollierte Proxy-Hops: der Reverse Proxy auf dem Host und das interne
Frontend-nginx. `TRUST_PROXY=2` ist dafür der passende Wert. Bei einer anderen
Topologie ist die Zahl auf die tatsächlich kontrollierten Hops anzupassen; ein
zu großer Wert erlaubt gefälschte Weiterleitungsadressen. `TRUST_PROXY` ist
kein TLS-Schalter und sollte nicht pauschal auf `true` gesetzt werden.

`COOKIE_SAME_SITE=lax` genügt, wenn Oberfläche und `/api` unter derselben
öffentlichen Adresse laufen. Nur wenn Oberfläche und Backend auf tatsächlich
unterschiedlichen Sites liegen, ist `COOKIE_SAME_SITE=none` zusammen mit
`COOKIE_SECURE=true` erforderlich. Bei `COOKIE_SECURE=true` darf die
Anwendung danach nicht mehr über die direkte HTTP-Adresse des Frontend-Ports
bedient werden, sonst verwirft der Browser die Cookies.

Nach Änderungen an den Instanzdateien den Backend-Container neu erstellen und
die Konfiguration prüfen:

```bash
docker compose --env-file .env.<name> -f docker-compose.yml up -d --force-recreate
./manage-instances.sh verify <name>
```

`CORS_ORIGIN` muss exakt zum Ursprung passen, den der Browser sendet. Ein
abweichendes Schema, ein anderer Port oder ein zusätzlicher Pfad führt bei
API-Anfragen zu einer Ablehnung und kann wie ein fehlgeschlagener Login
aussehen. `APP_BASE_URL` sorgt zusätzlich dafür, dass Einladungs-,
Verifikations- und Passwort-Reset-Links auf die öffentliche Adresse zeigen.

## Erster Login und Workspace

1. Die HTTPS-Adresse des Reverse Proxys öffnen, nicht den direkten
   Frontend-Port.
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
- Das Workspace-JSON-/ZIP-Backup enthält keine SMTP-Passwörter; der vollständige
  SQL-Dump und die Konfigurationskopien bleiben trotzdem streng vertraulich.
- JSON- und ZIP-Restore akzeptieren nur bekannte Tabellen und gültige
  Datensatzlisten. ZIP-Dateien dürfen komprimiert höchstens 50 MB groß sein;
  auch die entpackte Datenbankdatei und die Datensatzanzahl sind begrenzt.
- Backups müssen zusätzlich außerhalb des Hosts aufbewahrt werden.

**Wichtige Betriebsgrenze:** Die Backup-Funktionen sind manuell. Das
Repository richtet keinen Zeitplan, kein Offsite-Ziel, keine Verschlüsselung
und keine Rotation ein. Die JSON-/ZIP-Dateien der Oberfläche liegen nur im
lokalen Docker-Volume `backups_data`; der vollständige Instanzdump liegt nach
`manage-instances.sh backup` im lokalen Verzeichnis `./backups/`. Beide Orte
sind keine Ausfallvorsorge. Ohne eigene Aufbewahrungsregel wächst
`./backups/` weiter und alte Dateien werden nicht automatisch gelöscht.

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

SoloOffice prüft ein Offsite-Ziel nicht automatisch. Der Betreiber muss
Übertragungsfehler überwachen, Aufbewahrungsfristen festlegen und regelmäßig
eine Wiederherstellung in einer getrennten Testinstanz durchführen. Erst nach
einer erfolgreichen Offsite-Übertragung sollten alte lokale Sicherungen
gelöscht werden. Der folgende Cron-Auszug ist nur ein Beispiel für einen
selbst einzurichtenden Ablauf; SSH-Schlüssel, Zielrechte, Verschlüsselung am
Ziel und Logrotation gehören ebenfalls zum Betreiber:

```cron
17 2 * * * root (cd /opt/solooffice && ./manage-instances.sh backup produktiv && rsync -a --chmod=F600,D700 /opt/solooffice/backups/ backup@backup.example:/srv/backups/solooffice-produktiv/) >> /var/log/solooffice-backup.log 2>&1
```

Das Ziel muss vorab angelegt, zugriffsbeschränkt und gegen den Ausfall des
SoloOffice-Hosts geschützt sein. `rsync` verschlüsselt den Transport über SSH;
die Verschlüsselung der Daten am Ziel muss der Betreiber zusätzlich
sicherstellen. Der Cronjob löscht weder lokale noch entfernte alte Dateien.

## Wiederherstellung nach einem Host- oder Volume-Ausfall

Für eine vollständige Wiederherstellung werden das zusammengehörige Trio aus
SQL-Dump, `.env.<name>` und `.env.backend.<name>` sowie derselbe oder ein
späterer geprüfter Quellstand benötigt. Der SQL-Dump enthält den
Migrationsstand und die Fachdaten; Proxy-Konfiguration, DNS und TLS-Zertifikate
sind davon getrennte Host-Betriebsdaten und müssen separat wiederhergestellt
oder neu eingerichtet werden.

Den Quellstand vor dem Import bereitstellen: im Zweifel denselben Commit oder
Tag wie beim Backup auschecken und den Arbeitsbaum sauber lassen. Ein späterer
Quellstand darf nur verwendet werden, wenn seine Migrationen und der
Restore-Ablauf geprüft sind. Für einen neu geklonten Arbeitsbaum ist das zum
Beispiel:

```bash
git clone https://github.com/TingelTangelBob/SoloOffice.git /opt/solooffice
cd /opt/solooffice
git checkout <freigegebener-commit-oder-tag>
git status --short
```

Die letzte Ausgabe muss leer sein, bevor `manage-instances.sh` verwendet wird.

Die folgenden Befehle setzen einen neuen Host oder ein nachweislich leeres
PostgreSQL-Volume voraus. Einen Dump niemals in eine bereits befüllte
Produktivdatenbank importieren. Wenn das Volume noch existiert, die laufende
Instanz zuerst anhalten, ein zusätzliches Backup anfertigen und für die
Wiederherstellung ein frisches Compose-Projekt/Volume verwenden. Das Löschen
eines Volumes ist unwiderruflich und gehört nicht in einen ungeprüften
Wiederherstellungsablauf. Vor dem Import bricht der Beispielablauf ab, wenn
das erwartete PostgreSQL-Volume bereits existiert.

```bash
set -euo pipefail

INSTANCE=produktiv
STAMP=20260826_021700
ENV_SOURCE="backups/env_${INSTANCE}_${STAMP}"
BACKEND_ENV_SOURCE="backups/env_backend_${INSTANCE}_${STAMP}"
SQL_SOURCE="backups/backup_${INSTANCE}_${STAMP}.sql"

test -s "$ENV_SOURCE" && test -s "$BACKEND_ENV_SOURCE" && test -s "$SQL_SOURCE"
install -m 600 "$ENV_SOURCE" ".env.${INSTANCE}"
install -m 600 "$BACKEND_ENV_SOURCE" ".env.backend.${INSTANCE}"

DB_USER="$(sed -n 's/^POSTGRES_USER=//p' ".env.${INSTANCE}" | tail -n 1)"
DB_NAME="$(sed -n 's/^POSTGRES_DB=//p' ".env.${INSTANCE}" | tail -n 1)"
test -n "$DB_USER" && test -n "$DB_NAME"

PROJECT_NAME="$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' ".env.${INSTANCE}" | tail -n 1)"
POSTGRES_VOLUME="${PROJECT_NAME:-solooffice}_postgres_data"
if docker volume inspect "$POSTGRES_VOLUME" >/dev/null 2>&1; then
  echo "Abbruch: Das PostgreSQL-Volume $POSTGRES_VOLUME existiert bereits."
  exit 1
fi

compose=(docker compose --env-file ".env.${INSTANCE}" -f docker-compose.yml)
"${compose[@]}" up -d --wait database
"${compose[@]}" exec -T database pg_isready -U "$DB_USER" -d "$DB_NAME"

"${compose[@]}" exec -T database \
  psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" < "$SQL_SOURCE"

./manage-instances.sh start "$INSTANCE"
./manage-instances.sh verify "$INSTANCE"
```

Beim ersten Backend-Start werden die aktuelle Datenbankrolle und alle
RLS-Tabellen unabhängig vom gesicherten Migrationsstand erneut geprüft. Die
Rolle muss `NOSUPERUSER NOBYPASSRLS` sein, jede RLS-Tabelle muss `FORCE ROW
LEVEL SECURITY` verwenden. Ein einmaliger Backend-Neustart ist dabei
erwartbar. Anschließend müssen mindestens Login, aktiver Workspace,
Kundenzahl, eine Rechnung und ein Download über die HTTPS-Adresse geprüft
werden. `./manage-instances.sh start` baut die Images aus dem ausgecheckten
Quellstand und wartet auf die technische Betriebsprüfung; ein Fehler dort ist
kein erfolgreicher Restore.

Wenn die Domain gewechselt hat, vor dem Start `CORS_ORIGIN`,
`COOKIE_SECURE`, `COOKIE_SAME_SITE`, `TRUST_PROXY` und `APP_BASE_URL` auf die
neue öffentliche Adresse anpassen. `ENCRYPTION_KEY`, Datenbankname,
Datenbankbenutzer und Datenbankpasswort müssen zum Dump passen.

Bei einem reinen Workspace-Fehler ohne Host- oder Volume-Ausfall genügt der
workspacebezogene JSON-/ZIP-Restore in der Oberfläche. Dieser Restore ändert
nur den aktiven Workspace und ersetzt keine vollständige Instanzsicherung.

Der technische Nachweis mit zwei Workspaces steht in
[`backup-restore-nachweis.md`](backup-restore-nachweis.md).

## Aktualisierung

```bash
git pull --ff-only
./manage-instances.sh update <name>
```

Der Update-Befehl erstellt zuerst ein vollständiges Instanzbackup, baut beide
Images mit dem exakten Commit-Nachweis, schaltet erst nach erfolgreichen Builds
um und führt anschließend die technische Instanzprüfung aus. Die geschützten
`.env`-Dateien werden vor und nach dem Ablauf per Prüfsumme verglichen.

Eine laufende Instanz kann jederzeit ohne Änderung von Fachdaten erneut geprüft
werden:

```bash
./manage-instances.sh verify <name>
```

Migrationen laufen beim Backend-Start in der Reihenfolge aus
`backend/migrations/index.js` automatisch. Die Migrationstabelle ist Teil des
SQL-Dumps. Bei einem älteren Dump führt der neue Quellstand die noch fehlenden
Migrationen vor dem normalen Betrieb aus; eine einmalige Meldung bzw. ein
kontrollierter Neustart für die RLS-Sicherung kann dabei erwartbar sein.

Der Update-Befehl rollt Datenbankmigrationen bei einem Fehler nicht automatisch
zurück. Deshalb vor jedem Update ein vollständiges Backup erstellen und dieses
auf ein Offsite-Ziel übertragen. Schlägt der Build fehl, bleiben die laufenden
Container unverändert. Schlägt der Start oder eine Migration fehl, den Zustand
als fehlgeschlagen behandeln, Backend-Logs prüfen und nicht wiederholt gegen
dieselbe Produktivdatenbank experimentieren. Der nachvollziehbare Rückweg ist
der Restore des vorherigen Dumps in ein frisches Volume; fachliche
Downgrades/`down`-Migrationen sind kein allgemeiner Rollback-Mechanismus.

Der technische Ablauf und seine Grenzen stehen im
[`Betriebsnachweis`](operations-verification.md).

## Health, Shutdown, Logs und Laufzeitmetriken

`/health/live` bestätigt ausschließlich, dass der Node-Prozess antwortet.
`/health/ready` prüft zusätzlich PostgreSQL und wird vom Container verwendet.
`/health` bleibt als kompatibler Alias erhalten. Öffentliche Health-Antworten
enthalten weder Datenbankfehler noch Pool-Statistiken.

Das Frontend besitzt zusätzlich `/healthz`. Sein nginx-Container läuft ohne
root, mit schreibgeschütztem Dateisystem und begrenzten Logdateien. `index.html`
wird nicht zwischengespeichert; gehashte Vite-Assets sind dagegen unveränderlich
cachebar.

Bei `SIGTERM` und `SIGINT` nimmt das Backend keine neuen Verbindungen mehr an,
lässt laufende Requests bis zu `SHUTDOWN_TIMEOUT_MS` auslaufen und schließt
danach den Datenbank-Pool. Der Standardwert beträgt zehn Sekunden; Compose gibt
dem Container dafür 15 Sekunden. Ein schlanker Init-Prozess übernimmt
Kindprozesse der lokalen OCR, zusätzliche Linux-Capabilities sind entfernt und
`no-new-privileges` verhindert spätere Rechteausweitung.

Jede Backend-Antwort enthält den Header `X-Request-ID`. Dieselbe ID erscheint
in strukturierten Serverlogs; bei einem internen Fehler zeigt die Oberfläche
sie zusätzlich als Referenz an. Damit lässt sich eine Browsermeldung ohne
personenbezogene Query-Parameter dem richtigen Logeintrag zuordnen.

Der Endpunkt `/metrics` ist standardmäßig geschlossen. Für ein internes
Monitoring einen langen Zufallswert in der Instanzkonfiguration setzen:

```dotenv
METRICS_TOKEN=<langer-zufallswert>
METRICS_MAX_PATHS=250
LOG_LEVEL=WARN
```

Der Abruf erfolgt innerhalb des Backend-Netzes mit
`Authorization: Bearer <Token>`. Ohne konfiguriertes Token antwortet der
Endpunkt mit HTTP 503; ein falsches Token ergibt HTTP 401. Der Backend-Port
soll weiterhin nicht öffentlich veröffentlicht werden. Unbekannte Pfade werden
in einem gemeinsamen Schlüssel gezählt; oberhalb von `METRICS_MAX_PATHS`
landen weitere Routen unter `OTHER`. Dadurch kann die Metriksammlung nicht
durch frei gewählte URL-Pfade unbegrenzt wachsen.

## Reverse Proxy und HTTPS

Das Frontend ist der öffentliche Einstiegspunkt. Der Backend-Port bleibt im
Compose-Netzwerk. Der Host-Reverse-Proxy muss TLS beenden und die Anfrage an
den veröffentlichten Frontend-Port weitergeben. Für eine gemeinsame
öffentliche Adresse und die in dieser Anleitung gezeigte Zwei-Hop-Topologie
müssen mindestens diese Werte stimmen:

```dotenv
CORS_ORIGIN=https://app.example.de
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
TRUST_PROXY=2
```

Der Host-Reverse-Proxy setzt `Host`, `X-Forwarded-For` und
`X-Forwarded-Proto`; das interne Frontend-nginx leitet `/api` zum Backend
weiter. `TRUST_PROXY` muss deshalb der Zahl der kontrollierten Proxy-Hops
entsprechen. Bei nur einem Proxy vor dem Backend ist `1` richtig, bei der hier
gezeigten Kette Host-nginx/Caddy plus Frontend-nginx `2`. Nur Proxy-Schichten
des eigenen Betriebs vertrauen und keinen größeren Wert als tatsächlich
vorhanden setzen.

Empfohlen ist eine gemeinsame öffentliche Adresse für Frontend und `/api`.
Zusätzlich muss in `.env.backend.<name>` stehen:

```dotenv
APP_BASE_URL=https://app.example.de
```

Damit verwenden Einladungs-, Verifikations- und Passwort-Reset-Links dieselbe
öffentliche Basisadresse. Nach Änderungen an den Instanzdateien den Stack neu
erstellen, bevor der Proxy den neuen Betrieb freigibt.

### nginx-Beispiel

Der Host-Proxy zeigt ausschließlich auf den veröffentlichten Frontend-Port;
das interne Frontend-nginx leitet `/api` an das Backend weiter. Für die erste
Zertifikatsausstellung kann zunächst nur ein HTTP-Serverblock geladen werden.
Danach ergänzt Certbot den 443-Block. Die folgende Fassung zeigt den Zustand
nach der Ausstellung:

Zuerst eine temporäre HTTP-Konfiguration in
`/etc/nginx/sites-available/app.example.de` anlegen und aktivieren:

```nginx
server {
    listen 80;
    server_name app.example.de;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Danach Zertifikat ausstellen lassen:

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
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

Beispielablauf für einen neuen nginx-vHost:

```bash
sudo ln -s /etc/nginx/sites-available/app.example.de \
  /etc/nginx/sites-enabled/app.example.de
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx --redirect -d app.example.de
sudo certbot renew --dry-run
```

Die Zertifikatsausstellung und automatische Erneuerung müssen vor dem
öffentlichen Betrieb funktionieren. Den von Certbot erzeugten 443-Block nicht
später durch `deploy/nginx-host-demo.solooffice.de.conf` oder eine andere
80er-Vorlage ersetzen. HSTS erst aktivieren, wenn HTTPS und alle
Subdomains dauerhaft korrekt funktionieren.

### Caddy-Beispiel

Caddy beschafft und erneuert das Zertifikat automatisch, sobald die Domain auf
den Host zeigt und Port 80/443 erreichbar sind. Caddy setzt die
Forwarded-Header für den vorgeschalteten Dienst selbst:

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

Nach dem Einrichten prüfen und neu laden:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Das Caddy-Datenverzeichnis mit Zertifikats- und ACME-Zustand gehört ebenfalls
in die Host-Sicherung. Bei beiden Proxy-Varianten nach außen prüfen:

```bash
curl -I http://app.example.de/
curl -fsS https://app.example.de/healthz
curl -sS -o /dev/null -w '%{http_code}\n' https://app.example.de/api/auth/me
```

Erwartet werden eine Weiterleitung von HTTP auf HTTPS, `200` für `/healthz`
und `401` für den anonymen Auth-Aufruf. Ein TLS-Zertifikatsfehler, ein
abweichender CORS-Ursprung oder ein fehlendes Session-Cookie muss vor dem
öffentlichen Betrieb behoben werden.

Der externe Proxy und das interne Frontend erlauben für E-Mail-Anhänge bis zu
100 MB. Workspace-Restores sind unabhängig davon im Backend bewusst auf 50 MB
komprimierte ZIP-Größe begrenzt. Größere Datenbestände werden über den
vollständigen Instanz-Dump aus `manage-instances.sh` wiederhergestellt.

## E-Mail: konfigurierbar, aber noch nicht nachgewiesen

SMTP ist konfigurierbar: entweder über `SMTP_HOST`, `SMTP_PORT`,
`SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` und `EMAIL_FROM` in der
Instanzkonfiguration oder über die E-Mail-Einstellungen der Anwendung. Für
Einladungen, E-Mail-Verifikation, Passwort-Zurücksetzung und Dokumentversand
muss der Betreiber ein eigenes SMTP-Konto einrichten.

**AP-2.5 ist blockiert.** SPF, DKIM und DMARC sowie die zuverlässige Zustellung
an Gmail und Outlook sind im Projekt noch nicht belegt. Diese Anleitung macht
keine Aussage, dass E-Mails nach der SMTP-Konfiguration zugestellt werden oder
im Posteingang landen. Vor einem darauf angewiesenen Betrieb sind DNS,
Absenderdomain, Rohkopfzeilen und Zustellordner jeweils selbst zu prüfen.

## Betreiberverantwortung

Zum Selbsthosting gehören mindestens:

- Betriebssystem-, Docker- und Compose-Updates sowie SSH- und Firewall-Härtung;
- DNS, TLS-Ausstellung und Zertifikatserneuerung des Reverse Proxys;
- sichere Verwahrung und Zugriffskontrolle für beide Instanzdateien,
  `ENCRYPTION_KEY`, Datenbankpasswort und alle SMTP-Zugangsdaten;
- Speicherüberwachung für PostgreSQL, Uploads, lokale Backups und Logs;
- eigener Backup-Zeitplan, Offsite-Kopie, Aufbewahrung/Rotation und regelmäßige
  Restore-Proben;
- SMTP-DNS, Absenderreputation und die tatsächliche Zustellung;
- Benutzer, Rollen, Einladungswege, Protokollzugriff und die
  datenschutzrechtliche Organisation der gespeicherten Rechnungs- und
  Kundendaten;
- fachliche, steuerrechtliche und rechtliche Prüfung des konkreten Einsatzes.

SoloOffice richtet diese Abläufe im aktuellen Beta-Stand nicht automatisch ein
und überwacht sie nicht zentral.

## Bekannte Grenzen

- Der aktuelle Stand ist Beta/Test und noch kein freigegebenes Hostingprodukt.
- SMTP ist konfigurierbar; SPF, DKIM, DMARC und Zustellung an Gmail/Outlook sind
  noch nicht nachgewiesen (AP-2.5, blockiert).
- Offsite-Backup, Objektspeicher, Überwachung und Alarmierung sind noch nicht
  als vollständiger SaaS-Betrieb umgesetzt.
- Die offiziellen KOSIT-/FeRD-Validatoren müssen vor einer fachlichen Freigabe
  zusätzlich ausgeführt werden.

## Technische Nachweise

- [Backend-Build](backend-build-nachweis.md)
- [Backend-Regressionssuite und Request-Tracing](backend-regression-tests.md)
- [Automatisierte Tests und Qualitätstore](automated-tests.md)
- [Node- und npm-Abhängigkeitssicherheit](dependency-security.md)
- [Multiuser- und RLS-Isolation](rls-isolation-nachweis.md)
- [Backup und Restore](backup-restore-nachweis.md)
- [Identity-/Workspace-Testablauf](identity-workspace-local-testing.md)
- [Wiedervorlage für manuelle Release-Prüfungen](manual-release-checklist.md)
