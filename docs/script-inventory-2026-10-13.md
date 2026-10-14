# SoloOffice-Skriptinventar und Dashboard-Ziele

Stand: 13.10.2026. Die Zielumgebungen stammen aus lesenden Aufrufen von
GET /api/projekte als agent:luna. Dashboard-Änderungen führt der
Projektverantwortliche separat aus.

## Skriptbestand

| Skript | Aufgabe und Wirkung | Sicherer Prüfaufruf | Status / Grenzen |
|---|---|---|---|
| manage-instances.sh | Instanzverwaltung. verify <instanz> [sha] prüft den Zustand ohne Änderung; update <instanz> [sha] sichert, baut, schaltet um und prüft. start, stop, remove und backup verändern Zustand bzw. Daten. | ./manage-instances.sh verify tor-s | LAN-Fachapp unter /opt/solooffice-tor-s. Updates nur mit vollständigem, bereits gepushtem Commit. Kein Dry-Run für update. |
| deploy/solooffice-update-all.sh | Staged alle Änderungen im SoloOffice-Checkout, committet und pusht nach origin/main; optional LAN- oder Staging-Deploy. | bash deploy/solooffice-update-all.sh --help | --staging wartet auf ci.yml; --lan wartet auf demo-deploy.yml. Beide Ziele gleichzeitig werden abgewiesen. Kein Dry-Run: nicht mit ungeprüften Working-Tree-Dateien starten. Staging nutzt SSH-Alias bp-server; ein expliziter Schlüssel ist optional. |
| deploy/solooffice-demo-update.sh | Zieht das Demo-Image, startet bei neuem Image oder fehlerhaftem Laufzeitzustand den Compose-Dienst und prüft /healthz. | systemctl list-timers solooffice-demo-update.timer; systemctl status solooffice-demo-update.service --no-pager | Der Timerjob ändert den Live-Demo-Stack. Kein Dry-Run. Globales Docker-Pruning ist entfernt. Skip nur bei gleichem Image, laufendem Container und erfolgreichem /healthz. |
| landingpage/deploy/solooffice-landingpage-update.sh | Holt das Landingpage-Image, extrahiert statische Dateien, schaltet current atomar um, prüft die URL, rollt bei Fehler zurück und begrenzt alte Releases. | ssh bp-server 'systemctl list-timers --all --no-pager \| grep solooffice-landingpage' | Der Timerjob ändert die Live-Landingpage. Kein Dry-Run. No-op nur bei passender Image-ID im aktuellen Release und erfolgreicher Health-URL. |
| control-plane/scripts/deploy-testserver.sh | Überträgt und baut den LAN Control Plane Stack auf 192.168.178.127:8100; initiale .env wird nur angelegt, falls sie fehlt. | bash control-plane/scripts/deploy-testserver.sh --dry-run | Dry-Run zeigt Ziel, Port und private Bind-Adresse ohne Logdatei, Netzwerkzugriff oder Dateischreibzugriff. Der echte Aufruf baut/aktualisiert den Stack. |
| control-plane/scripts/wire-testserver.sh | Verknüpft LAN Control Plane und Fachapp in beide Richtungen, sichert und ändert Umgebungsdateien, startet CP neu und baut die Fachapp neu. | Kein Dry-Run vorhanden. | Mutierend und ändert Prüfstand-Konfiguration. Nicht in einem Dashboardziel freigeben. |
| control-plane/deploy/hetzner/deploy.sh | Staging-/Prod-Deploy von Fachapp und Control Plane: Vorprüfung, DNS, Upload, Instanzkonfiguration, Build/Start, Proxy, Backups und Verifikation. | bash control-plane/deploy/hetzner/deploy.sh staging --app-source worktree --dry-run | --dry-run prüft Voraussetzungen und DNS, überträgt/startet nichts. Echter Staging-Aufruf ist separat autorisiert; Prod ist nicht freigegeben. Setzt REQUIRE_OPERATOR_2FA=true. Erzeugt CONTROL_PLANE_MAIL_ENCRYPTION_KEY einmalig, wenn leer; erhält gültige vorhandene Werte und bricht bei ungültigem nichtleerem Wert ab. Secret-Werte werden nicht protokolliert. |
| control-plane/deploy/hetzner/verify.sh | Serverseitige und öffentliche Wiederholungsprüfung. Verändert keine Fach-/Kontodaten; prüft Ports, Health, Sicherheit, Migrationen, Registrierung, Betreiberzugriff, Fachapp-Verbindung und E-Mail-Konfiguration. | bash control-plane/deploy/hetzner/verify.sh staging | Neue nur lesende Admin-Token-Prüfungen: /api/admin/overview, /api/admin/platform/overview und /api/admin/mail/settings. Mailantwort wird auf sichere Form und fehlende Klartext-Passwortfelder geprüft. Antwortinhalte werden nicht ausgegeben. Plattformabfrage ist ein signierter GET an die Fachapp. |
| control-plane/deploy/hetzner/e2e.sh | Vollständiger Registrierungs-, Abo-, Workspace-, Sperr- und Entsperr-Smoke. Legt Konto, Subscription, Workspace und Kundendatensatz an. | Nicht als allgemeine Verifikation ausführen. | Mutiert Staging-Daten. Verwendet example.invalid, gibt keine Response-Bodies oder Sitzungscookies mehr aus und legt temporäre Dateien mit Modus 600 an. SMTP kann trotzdem einen Zustellversuch für die nicht zustellbare Adresse protokollieren. Nur in isoliertem Staging und nach ausdrücklicher Freigabe starten. |
| control-plane/deploy/hetzner/backup.sh | Erstellt/verifiziert verschlüsselte Backups; --verify führt eine Rücksicherungsprobe aus. | bash control-plane/deploy/hetzner/backup.sh --help | Regulärer Systemd-Lauf schreibt Backup-Dateien; keine Konto- oder E-Mail-Mutation. Kein Deploy-Mapping. |
| control-plane/deploy/hetzner/admin-allowlist.sh | Ändert die nginx-Allowlist für Betreiber-API-Zugriff. | bash control-plane/deploy/hetzner/admin-allowlist.sh --help | Sicherheitskonfiguration; mutierend. Nicht vom Dashboard ausführen. |

## Dashboard-Ziele: Projekt SO, Projekt-ID 1

Die stabile Umgebungskennung besteht aus Projekt-ID und Schlüssel; es gibt
keine separate Umgebungs-ID. Die thematisch passenden Akten sind SO-40
(Deploy-Skripte und Zielzuordnung), SO-39 (Staging-Control-Plane) und SO-19
(Landingpage). Eine eigene Akte je Ziel ist nicht vorhanden.

| Umgebungskennung | Ziel | Aktenbezug | Empfohlene Dashboard-Konfiguration | Prüfkommando |
|---|---|---|---|---|
| 1 + lan | LAN-Fachapp http://192.168.178.127:8090 | SO-40 | deployMethode=hinweis; deployBefehl=null; deployArgumente=[]; deployErlaubt=false. Hinweis: Update nur über bereits gepushten Commit und manage-instances.sh update tor-s <sha>; derzeit kein Übertragungsskript. | ssh -i ~/.ssh/id_kabot_test root@192.168.178.127 'cd /opt/solooffice-tor-s && ./manage-instances.sh verify tor-s <vollständiger-sha>' |
| 1 + lan-cp | LAN Control Plane http://192.168.178.127:8100 | SO-40 | deployMethode=skript; deployBefehl=control-plane/scripts/deploy-testserver.sh; deployArgumente=[--dry-run]; deployErlaubt=true. Hinweis auf LAN-only Bindung und separaten mutierenden Aufruf nach Freigabe. | bash control-plane/scripts/deploy-testserver.sh --dry-run |
| 1 + staging | Staging-Fachapp https://app.staging.solooffice.de | SO-39, SO-40 | deployMethode=skript; deployBefehl=control-plane/deploy/hetzner/deploy.sh; deployArgumente=[staging, --app-source, worktree, --dry-run]; deployErlaubt=true. Hinweis: Dry-Run prüft Vorbedingungen/DNS, kein Upload. | bash control-plane/deploy/hetzner/deploy.sh staging --app-source worktree --dry-run |
| 1 + staging-admin | Staging Control Plane https://admin.staging.solooffice.de | SO-39, SO-40 | deployMethode=skript; deployBefehl=control-plane/deploy/hetzner/deploy.sh; deployArgumente=[staging, --skip-app, --dry-run]; deployErlaubt=true. Hinweis: echter Deploy ist gemeinsam mit Staging; keinen eigenständigen CP-Deploy freigeben. | bash control-plane/deploy/hetzner/deploy.sh staging --skip-app --dry-run |
| 1 + live | Landingpage https://solooffice.de | SO-19, SO-40 | deployMethode=hinweis; deployBefehl=null; deployArgumente=[]; deployErlaubt=false. Hinweis: Live-VHost wird vom Systemd-Timer bedient; kein Dashboard-Deploy freigeben. | ssh bp-server 'systemctl list-timers --all --no-pager | grep solooffice-landingpage' |
| 1 + demo | Live-Demo https://demo.solooffice.de | SO-40 | deployMethode=hinweis; deployBefehl=null; deployArgumente=[]; deployErlaubt=false. Hinweis: Image wird vom Systemd-Timer aktualisiert; kein Dashboard-Deploy freigeben. | ssh bp-server 'systemctl list-timers solooffice-demo-update.timer' |

Für jedes PUT /api/projekte/SO/umgebungen/<schluessel> gilt: deployBefehl ist
relativ zum hinterlegten SoloOffice-Projektordner, Argumente sind einzelne
literale Werte statt einer Shell-Zeile, und deployErlaubt bleibt nur bei
skript plus --dry-run wahr. Live-Umgebungen werden nicht freigeschaltet.
Diese Konfigurationen sind Vorschläge für den Projektverantwortlichen; dieses
Dokument hat keine API-Schreibaktion ausgeführt.

### Vollständige JSON-Bodies für PUT /api/projekte/SO/umgebungen/{schluessel}

<pre>
[
  {
    "schluessel": "lan",
    "bezeichnung": "LAN-Test Fachapp",
    "url": "http://192.168.178.127:8090",
    "sortierung": 5,
    "aktiv": true,
    "deployMethode": "hinweis",
    "deployBefehl": null,
    "deployArgumente": [],
    "deployHinweis": "Nur bereits gepushten Commit prüfen und gezielt über manage-instances.sh verify tor-s &lt;sha&gt; kontrollieren. Ein Upload-/Deployskript ist für diese Umgebung nicht hinterlegt.",
    "deployErlaubt": false,
    "stufe": "test",
    "server": "TestDocker (LAN) · 192.168.178.127 · Port 8090"
  },
  {
    "schluessel": "lan-cp",
    "bezeichnung": "LAN-Test Control Plane",
    "url": "http://192.168.178.127:8100",
    "sortierung": 6,
    "aktiv": true,
    "deployMethode": "skript",
    "deployBefehl": "control-plane/scripts/deploy-testserver.sh",
    "deployArgumente": ["--dry-run"],
    "deployHinweis": "Freigegeben ist nur die lokale Trockenprüfung. Echter Deploy bindet an die private LAN-IP, überträgt Dateien und startet den Control Plane.",
    "deployErlaubt": true,
    "stufe": "test",
    "server": "TestDocker (LAN) · 192.168.178.127 · Port 8100"
  },
  {
    "schluessel": "staging",
    "bezeichnung": "Staging-Fachapp",
    "url": "https://app.staging.solooffice.de",
    "sortierung": 20,
    "aktiv": true,
    "deployMethode": "skript",
    "deployBefehl": "control-plane/deploy/hetzner/deploy.sh",
    "deployArgumente": ["staging", "--app-source", "worktree", "--dry-run"],
    "deployHinweis": "Freigegeben ist nur die Staging-Vorprüfung mit Arbeitskopie. Sie prüft Voraussetzungen und DNS, überträgt oder startet nichts.",
    "deployErlaubt": true,
    "stufe": "test",
    "server": "bp-server · 46.224.132.27 · Fachapp-Port 127.0.0.1:8090 hinter nginx"
  },
  {
    "schluessel": "staging-admin",
    "bezeichnung": "Staging Control Plane",
    "url": "https://admin.staging.solooffice.de",
    "sortierung": 25,
    "aktiv": true,
    "deployMethode": "skript",
    "deployBefehl": "control-plane/deploy/hetzner/deploy.sh",
    "deployArgumente": ["staging", "--skip-app", "--dry-run"],
    "deployHinweis": "Freigegeben ist nur die Staging-Vorprüfung. Der echte Control-Plane-Deploy erfolgt gemeinsam über das Staging-Deploy; kein eigenständiger Aufruf.",
    "deployErlaubt": true,
    "stufe": "test",
    "server": "bp-server · 46.224.132.27 · Control Plane 127.0.0.1:8100 hinter nginx"
  },
  {
    "schluessel": "live",
    "bezeichnung": "Landingpage",
    "url": "https://solooffice.de",
    "sortierung": 0,
    "aktiv": true,
    "deployMethode": "hinweis",
    "deployBefehl": null,
    "deployArgumente": [],
    "deployHinweis": "Live-Landingpage wird vom Server-Timer aktualisiert. Kein Dashboard-Deployskript freigegeben.",
    "deployErlaubt": false,
    "stufe": "live",
    "server": "bp-server · 46.224.132.27 · /var/www/solooffice.de"
  },
  {
    "schluessel": "demo",
    "bezeichnung": "Demo",
    "url": "https://demo.solooffice.de",
    "sortierung": 30,
    "aktiv": true,
    "deployMethode": "hinweis",
    "deployBefehl": null,
    "deployArgumente": [],
    "deployHinweis": "Live-Demo-Image wird vom Server-Timer aktualisiert. Kein Dashboard-Deployskript freigegeben.",
    "deployErlaubt": false,
    "stufe": "live",
    "server": "bp-server · 46.224.132.27 · Port 8081 (Image per Timer)"
  }
]
</pre>

## Verifikation

bash -n wurde für die relevanten Shellskripte ausgeführt. Für den neuen LAN
Control-Plane-Dry-Run wurden Syntax und --help geprüft; ein echter
Serveraufruf, Staging-Deploy, Landingpage-/Demo-Update und E2E-Datenlauf
wurden nicht ausgeführt. Akten- und Umgebungsdaten stammen aus lesenden
Dashboard-API-Aufrufen mit Lunas eigener Token-Identität.
