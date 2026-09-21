#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

# Einheitlicher Update-Ablauf für lokale Entwicklung, GitHub, Demo und
# den gemeinsamen LAN-Testserver. Das Skript kann aus jedem Arbeitsordner
# gestartet werden, weil es sein Repository relativ zu diesem Skript findet.

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)

TARGET_BRANCH="${SOLOOFFICE_BRANCH:-main}"
GITHUB_REPOSITORY="${SOLOOFFICE_GITHUB_REPOSITORY:-TingelTangelBob/SoloOffice}"
LAN_HOST="${SOLOOFFICE_LAN_HOST:-192.168.178.127}"
LAN_USER="${SOLOOFFICE_LAN_USER:-root}"
LAN_KEY="${SOLOOFFICE_LAN_KEY:-${HOME:-}/.ssh/id_kabot_test}"
LAN_DEPLOY_DIR="${SOLOOFFICE_LAN_DEPLOY_DIR:-/opt/solooffice-tor-s}"
LAN_INSTANCE="${SOLOOFFICE_LAN_INSTANCE:-tor-s}"
STAGING_HOST="${SOLOOFFICE_STAGING_HOST:-46.224.132.27}"
STAGING_USER="${SOLOOFFICE_STAGING_USER:-root}"
STAGING_KEY="${SOLOOFFICE_STAGING_KEY:-${HOME:-}/.ssh/id_kabot_test}"
STAGING_DEPLOY_DIR="${SOLOOFFICE_STAGING_DEPLOY_DIR:-/opt/solooffice-staging/app}"
STAGING_INSTANCE="${SOLOOFFICE_STAGING_INSTANCE:-staging}"
GITHUB_WAIT_SECONDS="${SOLOOFFICE_GITHUB_WAIT_SECONDS:-1800}"
GITHUB_POLL_SECONDS="${SOLOOFFICE_GITHUB_POLL_SECONDS:-30}"

COMMIT_MESSAGE=""
DEPLOY_LAN=false
DEPLOY_STAGING=false
ASSUME_YES=false

print_info() {
  printf '\033[0;34mℹ️  %s\033[0m\n' "$1"
}

print_success() {
  printf '\033[0;32m✅ %s\033[0m\n' "$1"
}

print_warning() {
  printf '\033[1;33m⚠️  %s\033[0m\n' "$1"
}

print_error() {
  printf '\033[0;31m❌ %s\033[0m\n' "$1" >&2
}

fail() {
  print_error "$1"
  exit 1
}

usage() {
  cat <<'EOF'
SoloOffice Gesamtupdate

Verwendung:
  bash deploy/solooffice-update-all.sh --message "Beschreibung" [Optionen]

Optionen:
  --message TEXT       Commit-Nachricht. Ohne Angabe wird sie abgefragt.
  --lan                Nach erfolgreicher GitHub-Prüfung den LAN-Testserver
                       192.168.178.127:8090 aktualisieren.
  --staging            Nach dem Push die Staging-Instanz aktualisieren und
                       mit dem exakten Commit prüfen.
  --yes                Sicherheitsabfragen überspringen.
  --help               Diese Hilfe anzeigen.

Ohne --lan werden Änderungen committed und nach origin/main gepusht. Die
öffentliche Demo aktualisiert sich danach über GitHub Actions und den
Server-Timer automatisch.

Umgebungsvariablen für Sonderfälle:
  SOLOOFFICE_SSH_KEY       SSH-Schlüssel für den LAN-Testserver
  SOLOOFFICE_STAGING_HOST, SOLOOFFICE_STAGING_USER, SOLOOFFICE_STAGING_KEY
  SOLOOFFICE_STAGING_DEPLOY_DIR, SOLOOFFICE_STAGING_INSTANCE
  SOLOOFFICE_GITHUB_WAIT_SECONDS
  SOLOOFFICE_GITHUB_POLL_SECONDS
EOF
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Benötigtes Programm fehlt: $1"
}

confirm() {
  local question="$1"
  if [ "$ASSUME_YES" = true ]; then
    return 0
  fi

  printf '%s [j/N] ' "$question"
  local answer
  read -r answer
  [[ "$answer" =~ ^[JjYy]$ ]]
}

parse_arguments() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --message)
        [ "$#" -ge 2 ] || fail "--message benötigt einen Text."
        COMMIT_MESSAGE="$2"
        shift 2
        ;;
      --message=*)
        COMMIT_MESSAGE="${1#*=}"
        shift
        ;;
      --lan)
        DEPLOY_LAN=true
        shift
        ;;
      --staging)
        DEPLOY_STAGING=true
        shift
        ;;
      --yes)
        ASSUME_YES=true
        shift
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        fail "Unbekannte Option: $1 (siehe --help)."
        ;;
    esac
  done
}

check_repository() {
  [ -d "$REPO_ROOT/.git" ] || fail "Kein Git-Repository gefunden: $REPO_ROOT"
  require_command git

  local branch
  branch=$(git -C "$REPO_ROOT" branch --show-current)
  [ "$branch" = "$TARGET_BRANCH" ] || fail "Aktiver Branch ist '$branch', erwartet wird '$TARGET_BRANCH'."

  local remote
  remote=$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || true)
  [ -n "$remote" ] || fail "Das Remote 'origin' ist nicht eingerichtet."

  git -C "$REPO_ROOT" diff --check
  git -C "$REPO_ROOT" diff --cached --check
}

commit_and_push() {
  local worktree_status
  worktree_status=$(git -C "$REPO_ROOT" status --short)

  print_info "Aktueller Arbeitsstand:"
  printf '%s\n' "$worktree_status"

  if [ -z "$worktree_status" ]; then
    fail "Es gibt keine Änderungen zum Committen."
  fi

  if [ -z "$COMMIT_MESSAGE" ]; then
    if [ -t 0 ]; then
      printf 'Commit-Nachricht [SoloOffice aktualisieren]: '
      read -r COMMIT_MESSAGE
    fi
    COMMIT_MESSAGE="${COMMIT_MESSAGE:-SoloOffice aktualisieren}"
  fi

  print_warning "Es werden alle angezeigten Änderungen in diesem Repository gestaged."
  confirm "Änderungen committen und nach origin/$TARGET_BRANCH pushen?" || fail "Abgebrochen."

  git -C "$REPO_ROOT" add -A
  git -C "$REPO_ROOT" diff --cached --check

  if git -C "$REPO_ROOT" diff --cached --quiet; then
    fail "Nach dem Staging gibt es keine Änderungen zum Committen."
  fi

  git -C "$REPO_ROOT" commit -m "$COMMIT_MESSAGE"
  git -C "$REPO_ROOT" push origin "$TARGET_BRANCH"

  COMMIT_SHA=$(git -C "$REPO_ROOT" rev-parse HEAD)
  print_success "Commit $COMMIT_SHA wurde nach origin/$TARGET_BRANCH gepusht."
}

github_run_state() {
  local response
  local auth_header=()

  if [ -n "${SOLOOFFICE_GITHUB_TOKEN:-}" ]; then
    auth_header=(-H "Authorization: Bearer ${SOLOOFFICE_GITHUB_TOKEN}")
  fi

  response=$(curl --fail --silent --show-error --retry 2 "${auth_header[@]}" \
    -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/$GITHUB_REPOSITORY/actions/workflows/demo-deploy.yml/runs?head_sha=$COMMIT_SHA&per_page=5") || return 1

  SOLOOFFICE_COMMIT_SHA="$COMMIT_SHA" node -e '
    const fs = require("fs");
    const sha = process.env.SOLOOFFICE_COMMIT_SHA;
    const payload = JSON.parse(fs.readFileSync(0, "utf8"));
    const run = (payload.workflow_runs || [])
      .filter(item => item.head_sha === sha)
      .sort((left, right) => new Date(right.created_at) - new Date(left.created_at))[0];
    if (!run) {
      process.stdout.write("missing\t-\t-\n");
    } else {
      process.stdout.write(`${run.status}\t${run.conclusion || "-"}\t${run.html_url || ""}\n`);
    }
  ' <<< "$response"
}

wait_for_github() {
  require_command curl
  require_command node

  local deadline=$(( $(date +%s) + GITHUB_WAIT_SECONDS ))
  local state status conclusion url

  print_info "Warte auf den erfolgreichen GitHub-Demo-Workflow für $COMMIT_SHA …"
  while true; do
    state=$(github_run_state) || fail "GitHub Actions konnte nicht abgefragt werden."
    IFS=$'\t' read -r status conclusion url <<< "$state"

    case "$status:$conclusion" in
      completed:success)
        print_success "GitHub-Qualitätstor und Demo-Image erfolgreich: $url"
        return 0
        ;;
      completed:*)
        fail "GitHub-Demo-Workflow ist fehlgeschlagen ($conclusion): ${url:-keine URL}"
        ;;
      in_progress:*|queued:*|waiting:*|requested:*)
        print_info "GitHub Actions: $status …"
        ;;
      missing:*)
        print_info "GitHub Actions: Workflow noch nicht sichtbar …"
        ;;
        *)
        print_info "GitHub Actions: $status / $conclusion …"
        ;;
    esac

    [ "$(date +%s)" -lt "$deadline" ] || fail "Zeitüberschreitung beim Warten auf GitHub Actions."
    sleep "$GITHUB_POLL_SECONDS"
  done
}

deploy_lan() {
  require_command ping
  require_command ssh
  require_command tar

  [ -f "$LAN_KEY" ] || fail "SSH-Schlüssel nicht gefunden: $LAN_KEY"

  print_info "Prüfe Erreichbarkeit des LAN-Testservers …"
  ping -c 1 -W 2000 "$LAN_HOST" >/dev/null || fail "LAN-Testserver nicht erreichbar: $LAN_HOST"
  ssh -o BatchMode=yes -o ConnectTimeout=5 -i "$LAN_KEY" \
    "$LAN_USER@$LAN_HOST" 'true' || fail "SSH-Verbindung zum LAN-Testserver fehlgeschlagen."

  print_info "Übertrage Commit $COMMIT_SHA nach $LAN_HOST:$LAN_DEPLOY_DIR …"
  git -C "$REPO_ROOT" archive --format=tar "$COMMIT_SHA" | \
    ssh -i "$LAN_KEY" "$LAN_USER@$LAN_HOST" \
    "tar -xf - -C '$LAN_DEPLOY_DIR'"

  print_info "Baue und prüfe die LAN-Instanz …"
  ssh -i "$LAN_KEY" "$LAN_USER@$LAN_HOST" \
    "cd '$LAN_DEPLOY_DIR' && ./manage-instances.sh update '$LAN_INSTANCE' '$COMMIT_SHA'"

  print_success "LAN-Testserver aktualisiert: http://$LAN_HOST:8090"
}

deploy_staging() {
  require_command ssh
  require_command tar

  [ -f "$STAGING_KEY" ] || fail "SSH-Schlüssel nicht gefunden: $STAGING_KEY"

  print_info "Prüfe Erreichbarkeit der Staging-Instanz …"
  ssh -o BatchMode=yes -o ConnectTimeout=8 -i "$STAGING_KEY" \
    "$STAGING_USER@$STAGING_HOST" 'true' || fail "SSH-Verbindung zur Staging-Instanz fehlgeschlagen."

  print_info "Übertrage Commit $COMMIT_SHA nach $STAGING_HOST:$STAGING_DEPLOY_DIR …"
  git -C "$REPO_ROOT" archive --format=tar "$COMMIT_SHA" | \
    ssh -i "$STAGING_KEY" "$STAGING_USER@$STAGING_HOST" \
    "tar -xf - -C '$STAGING_DEPLOY_DIR'"

  print_info "Baue und prüfe die Staging-Instanz …"
  ssh -i "$STAGING_KEY" "$STAGING_USER@$STAGING_HOST" \
    "cd '$STAGING_DEPLOY_DIR' && ./manage-instances.sh update '$STAGING_INSTANCE' '$COMMIT_SHA'"

  print_success "Staging aktualisiert: https://app.staging.solooffice.de"
}

main() {
  parse_arguments "$@"
  check_repository
  commit_and_push

  if [ "$DEPLOY_LAN" = true ]; then
    wait_for_github
    deploy_lan
  elif [ "$DEPLOY_STAGING" = true ]; then
    deploy_staging
  else
    print_info "Die Demo aktualisiert sich nach erfolgreicher GitHub-Aktion automatisch."
    print_info "Für Staging mit --staging starten; für den LAN-Testserver mit --lan."
  fi
}

main "$@"
