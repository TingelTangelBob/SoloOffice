# Demo auf dem Server einrichten (`demo.solooffice.de`)

Einmalige Einrichtung. Danach aktualisiert sich die Demo selbstständig, sobald
ein Push auf `main` das Image in der Registry erneuert hat.

**Betriebsmodell:** Hol-Prinzip. GitHub baut und veröffentlicht nur; dieser
Server holt sich das fertige Image. GitHub bekommt **keinen** Zugang zu der
Maschine — wichtig, weil dort auch Mattermost, n8n, LiteLLM und Roomverse
laufen.

---

## 0. Voraussetzungen prüfen

```bash
docker --version && docker compose version
```

Der Server nutzt bereits host-nginx mit certbot — beides bleibt unangetastet,
die Demo wird nur eingehängt.

## 1. DNS setzen (zuerst!)

Beim Domain-Anbieter für `demo.solooffice.de`:

| Typ | Wert |
|---|---|
| `A` | die IPv4 des Servers |
| `AAAA` | die IPv6 des Servers |

Ohne `AAAA` erreichen IPv6-Netze die Demo nicht. Muss **vor** Schritt 4 stehen,
sonst schlägt die Zertifikatsausstellung fehl. Prüfen:

```bash
dig +short demo.solooffice.de A
dig +short demo.solooffice.de AAAA
```

## 2. Verzeichnis anlegen

```bash
sudo mkdir -p /opt/solooffice-demo
cd /opt/solooffice-demo
```

Dorthin gehören zwei Dateien aus dem Repository:

- `docker-compose.demo.yml`
- `deploy/solooffice-demo-update.sh` → nach `/usr/local/bin/solooffice-demo-update`

```bash
sudo curl -fsSL -o /opt/solooffice-demo/docker-compose.demo.yml \
  https://raw.githubusercontent.com/TingelTangelBob/SoloOffice/main/docker-compose.demo.yml

sudo curl -fsSL -o /usr/local/bin/solooffice-demo-update \
  https://raw.githubusercontent.com/TingelTangelBob/SoloOffice/main/deploy/solooffice-demo-update.sh

sudo chmod +x /usr/local/bin/solooffice-demo-update
```

## 3. Konfiguration hinterlegen

`/opt/solooffice-demo/.env`:

```ini
# Dem Tag "main" folgen. Für ein Rollback hier einen festen Commit-Hash
# eintragen, z. B. ...solooffice-demo:9f2c1ab...
DEMO_IMAGE=ghcr.io/tingeltangelbob/solooffice-demo:main

# Loopback-Port. Belegt sind auf dieser Maschine bereits 4000, 5432, 5678, 8065.
DEMO_PORT=8081
```

Erster Start:

```bash
cd /opt/solooffice-demo
sudo docker compose -f docker-compose.demo.yml up -d
curl -sS http://127.0.0.1:8081/healthz
```

> **Hinweis:** Das Paket muss in GHCR auf **public** stehen, sonst schlägt das
> Ziehen ohne Zugangsdaten fehl. Einstellbar unter *Packages → solooffice-demo
> → Package settings → Change visibility*.

## 4. nginx und Zertifikat

```bash
sudo curl -fsSL -o /etc/nginx/sites-available/demo.solooffice.de \
  https://raw.githubusercontent.com/TingelTangelBob/SoloOffice/main/deploy/nginx-host-demo.solooffice.de.conf

sudo ln -s /etc/nginx/sites-available/demo.solooffice.de /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d demo.solooffice.de
```

`certbot` ergänzt den 443-Block und die Zertifikatspfade selbst und richtet die
automatische Erneuerung ein — wie bei den bestehenden Domains auf dieser
Maschine.

## 5. Automatische Aktualisierung einrichten

`/etc/systemd/system/solooffice-demo-update.service`:

```ini
[Unit]
Description=SoloOffice-Demo auf neue Fassung pruefen
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
Environment=DEPLOY_DIR=/opt/solooffice-demo
ExecStart=/usr/local/bin/solooffice-demo-update
```

`/etc/systemd/system/solooffice-demo-update.timer`:

```ini
[Unit]
Description=SoloOffice-Demo regelmaessig aktualisieren

[Timer]
# Alle fuenf Minuten. RandomizedDelaySec verteilt die Last, damit der Abruf
# nicht mit anderen Timern auf der Maschine zusammenfaellt.
OnBootSec=3min
OnUnitActiveSec=5min
RandomizedDelaySec=60

[Install]
WantedBy=timers.target
```

Aktivieren:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now solooffice-demo-update.timer
```

## 6. Kontrolle

```bash
# Wann lief der Timer zuletzt, wann wieder?
systemctl list-timers solooffice-demo-update.timer

# Was hat er getan? (im Normalfall still)
journalctl -u solooffice-demo-update.service -n 30 --no-pager

# Einmal von Hand auslösen
sudo systemctl start solooffice-demo-update.service
```

Öffentlich erreichbar prüfen:

```bash
curl -sS https://demo.solooffice.de/healthz
```

---

## Rollback

In `/opt/solooffice-demo/.env` `DEMO_IMAGE` auf einen festen Commit-Hash
setzen, dann:

```bash
sudo systemctl start solooffice-demo-update.service
```

Solange dort ein fester Hash steht, überschreibt der Timer den Stand nicht mehr
mit `main`.

## Was dieser Aufbau bewusst NICHT tut

- **Kein `docker system prune --volumes`.** Das würde Volumes fremder Projekte
  auf dieser Maschine löschen. Es wird ausschließlich `image prune` mit einer
  Woche Schonfrist ausgeführt.
- **Keine Rückmeldung an GitHub.** Der CI-Lauf endet mit dem Veröffentlichen
  des Images. Ob der Server ihn übernommen hat, steht im Journal (Schritt 6) —
  das ist der Preis dafür, dass GitHub keinen Zugang zur Maschine hat.
- **Kein Zugriff auf andere Dienste.** Der Container läuft ohne
  Zusatzrechte, nur lesbar, an `127.0.0.1` gebunden und mit begrenztem
  Arbeitsspeicher.
