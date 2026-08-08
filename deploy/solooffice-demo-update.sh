#!/usr/bin/env bash
#
# Hol-Deploy für die SoloOffice-Demo.
#
# Prüft, ob in der Registry unter dem verfolgten Tag ein neueres Image liegt,
# und tauscht es nur dann aus. Läuft per systemd-Timer auf dem Server; GitHub
# braucht dadurch keinerlei Zugang zu dieser Maschine.
#
# Einrichtung siehe deploy/README-demo-server.md

set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/solooffice-demo}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.demo.yml}"

cd "$DEPLOY_DIR"

# DEMO_IMAGE steht in der .env neben der Compose-Datei und bestimmt, welchem
# Tag dieser Server folgt. Für ein Rollback dort einfach einen festen
# Commit-Hash statt "main" eintragen.
# shellcheck disable=SC1091
[ -f .env ] && set -a && . ./.env && set +a
IMAGE="${DEMO_IMAGE:?DEMO_IMAGE ist nicht gesetzt (erwartet in .env)}"

vorher="$(docker image inspect --format '{{.Id}}' "$IMAGE" 2>/dev/null || echo 'keines')"

# --quiet, damit der Timer im Normalfall nichts ins Journal schreibt.
docker compose -f "$COMPOSE_FILE" pull --quiet

nachher="$(docker image inspect --format '{{.Id}}' "$IMAGE" 2>/dev/null || echo 'keines')"

if [ "$vorher" = "$nachher" ]; then
  exit 0
fi

echo "Neue Fassung gefunden, wird übernommen: ${nachher:0:19}"
docker compose -f "$COMPOSE_FILE" up -d

# Kurz warten und nachsehen, ob die Demo wirklich antwortet. Schlägt das fehl,
# endet das Skript mit Fehler – systemd protokolliert das, und der Zustand ist
# über "systemctl status" sichtbar, statt still kaputtzugehen.
sleep 5
port="${DEMO_PORT:-8081}"
if ! curl --fail --silent --max-time 10 "http://127.0.0.1:${port}/healthz" > /dev/null; then
  echo "WARNUNG: Demo antwortet nach der Aktualisierung nicht auf /healthz" >&2
  exit 1
fi

echo "Demo läuft."

# Aufräumen: Auf dieser Maschine liegen weitere Projekte (Mattermost, n8n,
# LiteLLM, Roomverse). Ein volllaufendes Dateisystem legt die alle mit lahm.
# "until=168h" behält die Images der letzten Woche für mögliche Rollbacks.
# Bewusst KEIN "system prune --volumes" – das würde Volumes fremder Projekte
# anfassen.
docker image prune -f --filter "until=168h" > /dev/null
