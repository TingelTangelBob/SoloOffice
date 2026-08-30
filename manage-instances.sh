#!/usr/bin/env bash

set -o pipefail
umask 077

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR"
# shellcheck source=scripts/build-provenance.sh
source "$SCRIPT_DIR/scripts/build-provenance.sh"

# Script to manage multiple SoloOffice instances

# Colors for better output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

validate_instance_name() {
    local instance_name="${1:-}"
    if [[ ! "$instance_name" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]]; then
        print_error "Ungültiger Instanzname. Erlaubt sind Buchstaben, Zahlen, _ und -."
        return 1
    fi
}

file_mode() {
    stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null
}

# Function to list all running instances
list_instances() {
    local env_file
    local instance_name
    local frontend_port
    local container_id
    local container_state
    local status
    local found=false

    echo
    print_info "=== Verfügbare SoloOffice-Instanzen ==="
    for env_file in .env.*; do
        if [ -f "$env_file" ] && [[ "$env_file" != .env.backend.* ]]; then
            instance_name=${env_file#.env.}
            if [ -f ".env.backend.$instance_name" ]; then
                found=true
                frontend_port=$(sed -n 's/^FRONTEND_PORT=//p' "$env_file" | tail -n 1)
                container_id=$(docker compose --env-file "$env_file" -f docker-compose.yml \
                    ps -q frontend 2>/dev/null)
                if [ -n "$container_id" ]; then
                    container_state=$(docker inspect --format \
                        '{{.State.Status}}{{if .State.Health}}/{{.State.Health.Status}}{{end}}' \
                        "$container_id" 2>/dev/null)
                else
                    container_state="stopped"
                fi
                if [[ "$container_state" == running* ]]; then
                    status="${GREEN}$(printf '%s' "$container_state" | tr '[:lower:]' '[:upper:]')${NC}"
                else
                    status="${RED}$(printf '%s' "$container_state" | tr '[:lower:]' '[:upper:]')${NC}"
                fi

                echo -e "  ${BLUE}$instance_name${NC} - $status - Frontend:${frontend_port:-unbekannt} (Backend/DB intern)"
            fi
        fi
    done
    if [ "$found" = false ]; then
        print_warning "Keine Instanzkonfigurationen gefunden."
    fi
}

# Function to stop an instance
stop_instance() {
    local instance_name="${1:-}"
    if [ -z "$instance_name" ]; then
        print_error "Bitte geben Sie den Instanznamen an"
        echo "Usage: $0 stop <instance_name>"
        return 1
    fi
    validate_instance_name "$instance_name" || return 1
    
    if [ ! -f ".env.${instance_name}" ]; then
        print_error "Instanz '$instance_name' nicht gefunden"
        return 1
    fi
    
    print_info "Stoppe Instanz: $instance_name"
    if docker compose --env-file ".env.${instance_name}" -f docker-compose.yml down; then
        print_success "Instanz '$instance_name' wurde gestoppt"
    else
        print_error "Fehler beim Stoppen der Instanz '$instance_name'"
        return 1
    fi
}

# Function to start an instance
start_instance() {
    local instance_name="${1:-}"
    if [ -z "$instance_name" ]; then
        print_error "Bitte geben Sie den Instanznamen an"
        echo "Usage: $0 start <instance_name>"
        return 1
    fi
    validate_instance_name "$instance_name" || return 1
    
    if [ ! -f ".env.${instance_name}" ]; then
        print_error "Konfigurationsdatei .env.${instance_name} nicht gefunden"
        return 1
    fi
    
    if [ ! -f ".env.backend.${instance_name}" ]; then
        print_warning "Backend-Konfigurationsdatei .env.backend.${instance_name} nicht gefunden"
        print_info "Erstelle minimale Backend-Konfiguration..."
        
        # Get database config from main env file
        DB_NAME=$(grep "POSTGRES_DB=" ".env.${instance_name}" | cut -d'=' -f2)
        DB_USER=$(grep "POSTGRES_USER=" ".env.${instance_name}" | cut -d'=' -f2)
        DB_PASSWORD=$(grep "POSTGRES_PASSWORD=" ".env.${instance_name}" | cut -d'=' -f2)
        FRONTEND_PORT=$(grep "FRONTEND_PORT=" ".env.${instance_name}" | cut -d'=' -f2)

        cat > .env.backend.${instance_name} << EOF
PORT=3001
DB_HOST=database
DB_PORT=5432
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
NODE_ENV=production
CORS_ORIGIN=http://localhost:${FRONTEND_PORT}
COOKIE_SECURE=false
COOKIE_SAME_SITE=lax
EOF
        chmod 600 ".env.backend.${instance_name}"
    fi
    
    local build_version
    local build_revision
    build_version=$(solooffice_project_version "$SCRIPT_DIR")
    build_revision=$(solooffice_source_revision "$SCRIPT_DIR")

    print_info "Starte Instanz: $instance_name"
    if env SOLOOFFICE_VERSION="$build_version" SOLOOFFICE_COMMIT_SHA="$build_revision" \
        docker compose --env-file ".env.${instance_name}" -f docker-compose.yml \
        up -d --build --wait --wait-timeout 120; then
        if ! verify_instance "$instance_name"; then
            print_error "Die Instanz wurde gestartet, hat die Betriebsprüfung aber nicht bestanden."
            return 1
        fi
        print_success "Instanz '$instance_name' wurde gestartet"
        
        # Show access information
        FRONTEND_PORT=$(grep "FRONTEND_PORT=" ".env.${instance_name}" | cut -d'=' -f2)
        BACKEND_PORT=$(grep "BACKEND_PORT=" ".env.${instance_name}" | cut -d'=' -f2)
        
        echo
        print_info "=== Zugriffsinformationen ==="
        print_success "Frontend: http://localhost:$FRONTEND_PORT"
        print_info "Backend:  intern im Compose-Netzwerk (Debug-Override für localhost-Zugriff verwenden)"
    else
        print_error "Fehler beim Starten der Instanz '$instance_name'"
        return 1
    fi
}

# Function to remove an instance completely
remove_instance() {
    local instance_name="${1:-}"
    if [ -z "$instance_name" ]; then
        print_error "Bitte geben Sie den Instanznamen an"
        echo "Usage: $0 remove <instance_name>"
        return 1
    fi
    validate_instance_name "$instance_name" || return 1
    
    if [ ! -f ".env.${instance_name}" ]; then
        print_error "Instanz '$instance_name' nicht gefunden"
        return 1
    fi
    
    echo
    print_warning "=== ACHTUNG: DATENVERLUST ==="
    print_warning "Dies wird die Instanz '$instance_name' vollständig entfernen!"
    print_warning "Alle Daten (Datenbank, Konfiguration) gehen verloren!"
    echo
    read -p "$(echo -e "${RED}Sind Sie sicher? Geben Sie 'LÖSCHEN' ein um zu bestätigen${NC}: ")" confirmation
    
    if [ "$confirmation" = "LÖSCHEN" ]; then
        print_info "Entferne Instanz: $instance_name"
        
        # Stop and remove containers with volumes
        docker compose --env-file .env.${instance_name} -f docker-compose.yml down -v
        
        # Remove configuration files
        rm -f .env.${instance_name}
        rm -f .env.backend.${instance_name}
        
        print_success "Instanz '$instance_name' wurde vollständig entfernt"
    else
        print_info "Vorgang abgebrochen"
    fi
}

# Function to show logs for an instance
logs_instance() {
    local instance_name="${1:-}"
    local service=${2:-""}
    
    if [ -z "$instance_name" ]; then
        print_error "Bitte geben Sie den Instanznamen an"
        echo "Usage: $0 logs <instance_name> [service]"
        return 1
    fi
    validate_instance_name "$instance_name" || return 1
    case "$service" in
        ""|database|backend|frontend) ;;
        *)
            print_error "Unbekannter Dienst '$service'."
            return 1
            ;;
    esac
    
    if [ ! -f ".env.${instance_name}" ]; then
        print_error "Instanz '$instance_name' nicht gefunden"
        return 1
    fi
    
    print_info "Zeige Logs für Instanz: $instance_name"
    if [ -n "$service" ]; then
        print_info "Service: $service"
        docker compose --env-file ".env.${instance_name}" -f docker-compose.yml logs -f "$service"
    else
        docker compose --env-file ".env.${instance_name}" -f docker-compose.yml logs -f
    fi
}

# Function to backup instance data
backup_instance() {
    local instance_name="${1:-}"
    if [ -z "$instance_name" ]; then
        print_error "Bitte geben Sie den Instanznamen an"
        echo "Usage: $0 backup <instance_name>"
        return 1
    fi
    validate_instance_name "$instance_name" || return 1
    
    if [ ! -f ".env.${instance_name}" ]; then
        print_error "Instanz '$instance_name' nicht gefunden"
        return 1
    fi
    
    # Backups contain business data and the instance keys from the env files.
    # Keep the complete backup set private even when the host uses a permissive
    # default umask.
    umask 077

    # Get database configuration
    local DB_NAME
    local DB_USER
    DB_NAME=$(grep "^POSTGRES_DB=" ".env.${instance_name}" | cut -d'=' -f2-)
    DB_USER=$(grep "^POSTGRES_USER=" ".env.${instance_name}" | cut -d'=' -f2-)

    if [ -z "$DB_NAME" ] || [ -z "$DB_USER" ]; then
        print_error "POSTGRES_DB oder POSTGRES_USER fehlt in .env.${instance_name}"
        return 1
    fi
    
    local backup_dir="backups"
    local timestamp
    timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_file="${backup_dir}/backup_${instance_name}_${timestamp}.sql"
    local force_rls_file
    force_rls_file=$(mktemp)
    local compose_command=(docker compose --env-file ".env.${instance_name}" -f docker-compose.yml)
    local backend_was_running=false
    local rls_relaxed=false
    local cleanup_done=false
    local cleanup_status=0

    wait_for_backend_health() {
        local backend_container
        local backend_status
        local attempt
        backend_container=$("${compose_command[@]}" ps -q backend)

        if [ -z "$backend_container" ]; then
            return 1
        fi

        for attempt in $(seq 1 45); do
            backend_status=$(docker inspect --format \
                '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
                "$backend_container" 2>/dev/null)
            if [ "$backend_status" = "healthy" ]; then
                return 0
            fi
            sleep 1
        done

        return 1
    }

    backup_cleanup() {
        if [ "$cleanup_done" = true ]; then
            return "$cleanup_status"
        fi
        cleanup_done=true

        if [ "$rls_relaxed" = true ] && [ -s "$force_rls_file" ]; then
            if "${compose_command[@]}" exec -T database \
                psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" \
                < "$force_rls_file" >/dev/null; then
                rls_relaxed=false
            else
                print_error "FORCE ROW LEVEL SECURITY konnte nicht vollständig reaktiviert werden."
                cleanup_status=1
            fi
        fi

        if [ "$backend_was_running" = true ]; then
            if ! "${compose_command[@]}" start backend >/dev/null; then
                print_error "Das Backend konnte nach dem Backup nicht neu gestartet werden."
                cleanup_status=1
            elif ! wait_for_backend_health; then
                print_error "Das Backend wurde nach dem Backup nicht rechtzeitig gesund."
                cleanup_status=1
            fi
        fi

        rm -f "$force_rls_file"
        return "$cleanup_status"
    }

    trap 'backup_cleanup' EXIT
    trap 'exit 130' INT TERM HUP
    
    # Create backup directory if it doesn't exist
    mkdir -p "$backup_dir"
    chmod 700 "$backup_dir"
    
    print_info "Erstelle Backup für Instanz: $instance_name"
    print_info "Backup wird gespeichert als: $backup_file"

    if "${compose_command[@]}" ps --status running --services | grep -Fxq backend; then
        backend_was_running=true
        print_warning "Das Backend wird für den konsistenten RLS-Dump kurz angehalten."
        if ! "${compose_command[@]}" stop backend >/dev/null; then
            print_error "Das Backend konnte nicht angehalten werden."
            backup_cleanup
            trap - EXIT INT TERM HUP
            return 1
        fi
    fi

    if ! "${compose_command[@]}" exec -T database \
        psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -Atc "
            SELECT format(
                'ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY;',
                namespace.nspname,
                table_class.relname
            )
            FROM pg_class AS table_class
            JOIN pg_namespace AS namespace ON namespace.oid = table_class.relnamespace
            WHERE table_class.relkind IN ('r', 'p')
              AND table_class.relrowsecurity
              AND table_class.relforcerowsecurity
              AND namespace.nspname NOT IN ('pg_catalog', 'information_schema')
            ORDER BY namespace.nspname, table_class.relname
        " > "$force_rls_file"; then
        print_error "RLS-Tabellen konnten nicht ermittelt werden."
        backup_cleanup
        trap - EXIT INT TERM HUP
        return 1
    fi

    if [ ! -s "$force_rls_file" ]; then
        print_error "Keine erzwungenen RLS-Tabellen gefunden; Backup aus Sicherheitsgründen abgebrochen."
        backup_cleanup
        trap - EXIT INT TERM HUP
        return 1
    fi

    if ! "${compose_command[@]}" exec -T database \
        psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -c "
            DO \$solooffice\$
            DECLARE
                target RECORD;
            BEGIN
                FOR target IN
                    SELECT namespace.nspname AS schema_name, table_class.relname AS table_name
                    FROM pg_class AS table_class
                    JOIN pg_namespace AS namespace ON namespace.oid = table_class.relnamespace
                    WHERE table_class.relkind IN ('r', 'p')
                      AND table_class.relrowsecurity
                      AND table_class.relforcerowsecurity
                      AND namespace.nspname NOT IN ('pg_catalog', 'information_schema')
                LOOP
                    EXECUTE format(
                        'ALTER TABLE %I.%I NO FORCE ROW LEVEL SECURITY',
                        target.schema_name,
                        target.table_name
                    );
                END LOOP;
            END
            \$solooffice\$;
        " >/dev/null; then
        print_error "RLS konnte für den angehaltenen Backup-Lauf nicht vorbereitet werden."
        backup_cleanup
        trap - EXIT INT TERM HUP
        return 1
    fi
    rls_relaxed=true

    if ! "${compose_command[@]}" exec -T database \
        pg_dump -U "$DB_USER" --no-owner --no-acl "$DB_NAME" > "$backup_file"; then
        print_error "Backup fehlgeschlagen!"
        rm -f "$backup_file"
        backup_cleanup
        trap - EXIT INT TERM HUP
        return 1
    fi

    # pg_dump records the temporary NO-FORCE state. Append the exact original
    # FORCE statements so a restored database is safe before the backend starts.
    if ! printf '\n-- SoloOffice: erzwungene RLS-Richtlinien wiederherstellen\n' >> "$backup_file" \
        || ! cat "$force_rls_file" >> "$backup_file" \
        || ! chmod 600 "$backup_file"; then
        print_error "Der SQL-Dump konnte nicht sicher abgeschlossen werden."
        rm -f "$backup_file"
        backup_cleanup
        trap - EXIT INT TERM HUP
        return 1
    fi

    backup_cleanup
    local finished_cleanup_status=$?
    trap - EXIT INT TERM HUP
    if [ "$finished_cleanup_status" -ne 0 ]; then
        rm -f "$backup_file"
        return 1
    fi

    # Also backup configuration files
    if ! cp ".env.${instance_name}" "${backup_dir}/env_${instance_name}_${timestamp}" \
        || ! chmod 600 "${backup_dir}/env_${instance_name}_${timestamp}"; then
        print_error "Die Instanzkonfiguration konnte nicht gesichert werden."
        rm -f "$backup_file" "${backup_dir}/env_${instance_name}_${timestamp}"
        return 1
    fi
    if [ -f ".env.backend.${instance_name}" ]; then
        if ! cp ".env.backend.${instance_name}" "${backup_dir}/env_backend_${instance_name}_${timestamp}" \
            || ! chmod 600 "${backup_dir}/env_backend_${instance_name}_${timestamp}"; then
            print_error "Die Backend-Konfiguration konnte nicht gesichert werden."
            rm -f "$backup_file" \
                "${backup_dir}/env_${instance_name}_${timestamp}" \
                "${backup_dir}/env_backend_${instance_name}_${timestamp}"
            return 1
        fi
    fi

    print_success "Backup erfolgreich erstellt!"
    print_info "Dateien:"
    print_info "  - Datenbank: $backup_file"
    print_info "  - Konfiguration: ${backup_dir}/env_${instance_name}_${timestamp}"
    if [ -f ".env.backend.${instance_name}" ]; then
        print_info "  - Backend-Konfiguration: ${backup_dir}/env_backend_${instance_name}_${timestamp}"
    fi
}

# Prüft eine laufende Instanz ohne Anmeldung und ohne Fachdaten zu verändern.
verify_instance() {
    local instance_name="${1:-}"
    local expected_revision="${2:-}"
    local env_file
    local backend_env_file
    local compose_command
    local service
    local container_id
    local container_state
    local frontend_port
    local base_url
    local headers_file
    local body_file
    local auth_status
    local db_user
    local db_name
    local role_flags
    local unforced_rls
    local latest_migration_file
    local expected_migration
    local actual_migration
    local expected_version
    local frontend_revision
    local backend_revision
    local image_id
    local image_revision
    local image_version
    local source_revision

    validate_instance_name "$instance_name" || return 1
    env_file=".env.${instance_name}"
    backend_env_file=".env.backend.${instance_name}"
    if [ ! -f "$env_file" ] || [ ! -f "$backend_env_file" ]; then
        print_error "Instanzkonfiguration für '$instance_name' ist unvollständig."
        return 1
    fi
    if [ "$(file_mode "$env_file")" != "600" ] || [ "$(file_mode "$backend_env_file")" != "600" ]; then
        print_error "Die Instanzdateien müssen Dateimodus 600 besitzen."
        return 1
    fi

    source_revision=$(solooffice_source_revision "$SCRIPT_DIR")
    if [ -z "$expected_revision" ] && [[ "$source_revision" =~ ^[0-9a-f]{40}$ ]]; then
        expected_revision="$source_revision"
    fi
    if [ -n "$expected_revision" ]; then
        solooffice_require_revision "$expected_revision" || return 1
    fi

    compose_command=(docker compose --env-file "$env_file" -f docker-compose.yml)
    for service in database backend frontend; do
        container_id=$("${compose_command[@]}" ps -q "$service")
        if [ -z "$container_id" ]; then
            print_error "Der Dienst '$service' besitzt keinen Container."
            return 1
        fi
        container_state=$(docker inspect --format \
            '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
            "$container_id" 2>/dev/null)
        if [ "$container_state" != "running|healthy" ]; then
            print_error "Der Dienst '$service' ist nicht gesund: $container_state"
            return 1
        fi
    done

    if ! "${compose_command[@]}" exec -T backend node -e \
        "fetch('http://127.0.0.1:3001/health/ready').then(response => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"; then
        print_error "Die interne Backend-Readiness ist fehlgeschlagen."
        return 1
    fi

    frontend_port=$(sed -n 's/^FRONTEND_PORT=//p' "$env_file" | tail -n 1)
    if [[ ! "$frontend_port" =~ ^[0-9]{1,5}$ ]] || [ "$frontend_port" -gt 65535 ]; then
        print_error "FRONTEND_PORT ist ungültig."
        return 1
    fi
    base_url="${SOLOOFFICE_VERIFY_URL:-http://127.0.0.1:${frontend_port}}"
    if ! curl --fail --silent --show-error --max-time 10 "$base_url/" >/dev/null; then
        print_error "Das Frontend antwortet nicht unter $base_url/."
        return 1
    fi
    if ! curl --fail --silent --show-error --max-time 10 "$base_url/healthz" >/dev/null; then
        print_error "Der Frontend-Healthcheck antwortet nicht."
        return 1
    fi

    headers_file=$(mktemp)
    body_file=$(mktemp)
    auth_status=$(curl --silent --show-error --max-time 10 \
        --dump-header "$headers_file" --output "$body_file" \
        --write-out '%{http_code}' "$base_url/api/auth/me")
    if [ "$auth_status" != "401" ] || ! grep -qi '^X-Request-ID:' "$headers_file"; then
        rm -f "$headers_file" "$body_file"
        print_error "Der anonyme Auth- und Request-ID-Smoke-Test ist fehlgeschlagen."
        return 1
    fi
    rm -f "$headers_file" "$body_file"

    db_user=$(sed -n 's/^POSTGRES_USER=//p' "$env_file" | tail -n 1)
    db_name=$(sed -n 's/^POSTGRES_DB=//p' "$env_file" | tail -n 1)
    if [ -z "$db_user" ] || [ -z "$db_name" ]; then
        print_error "POSTGRES_USER oder POSTGRES_DB fehlt."
        return 1
    fi
    role_flags=$("${compose_command[@]}" exec -T database \
        psql -U "$db_user" -d "$db_name" -Atc \
        "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")
    if [ "$role_flags" != "f|f" ]; then
        print_error "Die Datenbank-Laufzeitrolle kann RLS umgehen."
        return 1
    fi
    unforced_rls=$("${compose_command[@]}" exec -T database \
        psql -U "$db_user" -d "$db_name" -Atc \
        "SELECT count(*) FROM pg_class JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace WHERE pg_namespace.nspname = current_schema() AND pg_class.relrowsecurity AND NOT pg_class.relforcerowsecurity")
    if [ "$unforced_rls" != "0" ]; then
        print_error "$unforced_rls RLS-Tabellen erzwingen die Richtlinie nicht."
        return 1
    fi

    latest_migration_file=$(find backend/migrations -maxdepth 1 -type f \
        -name '[0-9][0-9][0-9]_*.js' | LC_ALL=C sort | tail -n 1)
    expected_migration=$(basename "$latest_migration_file" .js)
    actual_migration=$("${compose_command[@]}" exec -T database \
        psql -U "$db_user" -d "$db_name" -Atc \
        "SELECT name FROM migrations ORDER BY id DESC LIMIT 1")
    if [ -z "$expected_migration" ] || [ "$actual_migration" != "$expected_migration" ]; then
        print_error "Migrationsstand abweichend: erwartet '$expected_migration', aktiv '$actual_migration'."
        return 1
    fi

    expected_version=$(solooffice_project_version "$SCRIPT_DIR")
    for service in frontend backend; do
        image_id=$("${compose_command[@]}" images -q "$service" | head -n 1)
        image_revision=$(docker image inspect --format \
            '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image_id" 2>/dev/null)
        image_version=$(docker image inspect --format \
            '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$image_id" 2>/dev/null)
        if [ "$image_version" != "$expected_version" ]; then
            print_error "Das $service-Image meldet Version '$image_version' statt '$expected_version'."
            return 1
        fi
        if [ "$service" = "frontend" ]; then
            frontend_revision="$image_revision"
        else
            backend_revision="$image_revision"
        fi
    done
    if [ "$frontend_revision" != "$backend_revision" ]; then
        print_error "Frontend und Backend stammen aus unterschiedlichen Commits."
        return 1
    fi
    if [ -n "$expected_revision" ] && [ "$frontend_revision" != "$expected_revision" ]; then
        print_error "Die Images stammen nicht aus dem erwarteten Commit $expected_revision."
        return 1
    fi
    if [ "$frontend_revision" = "unknown" ] || [ -z "$frontend_revision" ]; then
        print_warning "Die Images besitzen noch keinen eindeutigen Commit-Nachweis."
    fi

    print_success "Betriebsprüfung bestanden: SoloOffice ${expected_version}, Commit ${frontend_revision:0:12}."
}

# Baut einen bereits synchronisierten Quellstand, sichert die Instanz und
# schaltet erst nach erfolgreichen Image-Builds um.
update_instance() {
    local instance_name="${1:-}"
    local requested_revision="${2:-}"
    local revision
    local version
    local env_file
    local backend_env_file
    local env_hashes
    local compose_command

    validate_instance_name "$instance_name" || return 1
    env_file=".env.${instance_name}"
    backend_env_file=".env.backend.${instance_name}"
    if [ ! -f "$env_file" ] || [ ! -f "$backend_env_file" ]; then
        print_error "Instanzkonfiguration für '$instance_name' ist unvollständig."
        return 1
    fi
    if git -C "$SCRIPT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
        && [ -n "$(git -C "$SCRIPT_DIR" status --porcelain --untracked-files=normal)" ]; then
        print_error "Ein Update aus einem veränderten Git-Arbeitsbaum ist nicht erlaubt."
        return 1
    fi

    revision=$(solooffice_source_revision "$SCRIPT_DIR")
    solooffice_require_revision "$revision" || return 1
    if [ -n "$requested_revision" ]; then
        solooffice_require_revision "$requested_revision" || return 1
        if [ "$requested_revision" != "$revision" ]; then
            print_error "Quellstand $revision stimmt nicht mit $requested_revision überein."
            return 1
        fi
    fi
    version=$(solooffice_project_version "$SCRIPT_DIR")
    compose_command=(docker compose --env-file "$env_file" -f docker-compose.yml)

    env_hashes=$(mktemp)
    if ! solooffice_write_sha256_manifest "$env_hashes" "$env_file" "$backend_env_file"; then
        rm -f "$env_hashes"
        return 1
    fi
    if ! backup_instance "$instance_name"; then
        rm -f "$env_hashes"
        return 1
    fi

    print_info "Baue SoloOffice $version aus Commit ${revision:0:12}."
    if ! env SOLOOFFICE_VERSION="$version" SOLOOFFICE_COMMIT_SHA="$revision" \
        "${compose_command[@]}" build frontend backend; then
        rm -f "$env_hashes"
        print_error "Build fehlgeschlagen; die laufenden Container wurden nicht umgeschaltet."
        return 1
    fi
    if ! "${compose_command[@]}" up -d --no-build --wait --wait-timeout 120; then
        rm -f "$env_hashes"
        print_error "Die neuen Container wurden nicht rechtzeitig gesund."
        return 1
    fi
    if ! solooffice_verify_sha256_manifest "$env_hashes" >/dev/null; then
        rm -f "$env_hashes"
        print_error "Eine geschützte Instanzdatei wurde während des Updates verändert."
        return 1
    fi
    rm -f "$env_hashes"

    verify_instance "$instance_name" "$revision"
}

# Function to edit instance configuration
edit_config() {
    local instance_name="${1:-}"
    if [ -z "$instance_name" ]; then
        print_error "Bitte geben Sie den Instanznamen an"
        echo "Usage: $0 config <instance_name>"
        return 1
    fi
    validate_instance_name "$instance_name" || return 1
    
    if [ ! -f ".env.backend.${instance_name}" ]; then
        print_error "Backend-Konfigurationsdatei .env.backend.${instance_name} nicht gefunden"
        return 1
    fi
    
    print_info "Öffne Konfigurationsdatei für Instanz: $instance_name"
    print_warning "Nach Änderungen muss die Instanz neu gestartet werden!"
    
    # Try to open with preferred editor
    if command -v code &> /dev/null; then
        code ".env.backend.${instance_name}"
    elif command -v nano &> /dev/null; then
        nano ".env.backend.${instance_name}"
    elif command -v vim &> /dev/null; then
        vim ".env.backend.${instance_name}"
    else
        print_error "Kein unterstützter Editor gefunden (code, nano, vim)"
        return 1
    fi
    
    echo
    read -p "$(echo -e "${YELLOW}Möchten Sie die Instanz jetzt neu starten? (y/N)${NC}: ")" -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        stop_instance "$instance_name"
        start_instance "$instance_name"
    fi
}

# Main script logic
case "$1" in
    list|ls)
        list_instances
        ;;
    start)
        start_instance $2
        ;;
    stop)
        stop_instance $2
        ;;
    restart)
        if [ -n "$2" ]; then
            print_info "Starte Instanz '$2' neu..."
            stop_instance $2
            start_instance $2
        else
            print_error "Bitte geben Sie den Instanznamen an"
        fi
        ;;
    remove|delete)
        remove_instance $2
        ;;
    logs)
        logs_instance $2 $3
        ;;
    backup)
        backup_instance "$2"
        ;;
    verify|check)
        verify_instance "$2" "${3:-}"
        ;;
    update)
        update_instance "$2" "${3:-}"
        ;;
    config|edit)
        edit_config $2
        ;;
    --help|-h|help)
        echo
        print_info "=== SoloOffice Instance Manager ==="
        echo
        echo "Usage: $0 {command} [instance_name] [options]"
        echo
        echo "Commands:"
        echo "  list, ls                - Alle Instanzen auflisten"
        echo "  start <instance>        - Instanz starten"
        echo "  stop <instance>         - Instanz stoppen"
        echo "  restart <instance>      - Instanz neu starten"
        echo "  remove <instance>       - Instanz löschen (⚠️  Datenverlust!)"
        echo "  logs <instance> [svc]   - Logs anzeigen"
        echo "  backup <instance>       - Datenbank-Backup erstellen"
        echo "  verify <instance> [sha] - Laufzeit, RLS und Image-Commit prüfen"
        echo "  update <instance> [sha] - Sichern, bauen, umschalten und prüfen"
        echo "  config <instance>       - Konfiguration bearbeiten"
        echo "  help                    - Diese Hilfe anzeigen"
        echo
        echo "Beispiele:"
        echo "  $0 list"
        echo "  $0 start client1"
        echo "  $0 logs client1 backend"
        echo "  $0 backup client1"
        echo "  $0 verify client1"
        echo "  $0 update client1"
        echo "  $0 config client1"
        echo
        ;;
    *)
        print_error "Unbekannter Befehl: $1"
        echo
        echo "Verwenden Sie '$0 help' für eine Liste aller verfügbaren Befehle."
        exit 1
        ;;
esac
