#!/usr/bin/env bash

set -o pipefail
umask 077

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR"
# shellcheck source=scripts/build-provenance.sh
source "$SCRIPT_DIR/scripts/build-provenance.sh"

# Script to deploy multiple instances of SoloOffice
# Interactive deployment with guided configuration

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

# Function to prompt for input with default value
prompt_input() {
    local prompt="$1"
    local default="$2"
    local result
    
    if [ -n "$default" ]; then
        read -p "$(echo -e "${BLUE}$prompt${NC} [${GREEN}$default${NC}]: ")" result
        echo "${result:-$default}"
    else
        read -p "$(echo -e "${BLUE}$prompt${NC}: ")" result
        echo "$result"
    fi
}

# Function to prompt for password (hidden input)
prompt_password() {
    local prompt="$1"
    local default="$2"
    local result
    
    if [ -n "$default" ]; then
        read -s -p "$(echo -e "${BLUE}$prompt${NC} [${GREEN}verwende Standard${NC}]: ")" result
        echo
        echo "${result:-$default}"
    else
        read -s -p "$(echo -e "${BLUE}$prompt${NC}: ")" result
        echo
        echo "$result"
    fi
}

# Function to check if port is available
check_port() {
    local port=$1
    if netstat -tuln 2>/dev/null | grep -q ":${port} " || lsof -i :${port} >/dev/null 2>&1; then
        return 1
    fi
    return 0
}

# Function to find next available port
find_available_port() {
    local start_port=$1
    local port=$start_port
    
    while ! check_port $port; do
        ((port++))
    done
    echo $port
}

# Function to collect instance configuration
collect_instance_config() {
    echo
    print_info "=== SoloOffice Instance Deployment ==="
    echo
    print_info "Dieses Skript führt Sie durch die Konfiguration einer neuen SoloOffice-Instanz."
    echo
    
    # Instance name
    while true; do
        INSTANCE_NAME=$(prompt_input "Name der Instanz (z.B. 'client1', 'firma-mustermann')" "")
        if [ -n "$INSTANCE_NAME" ] && validate_instance_name "$INSTANCE_NAME"; then
            # Check if instance already exists
            if [ -f ".env.${INSTANCE_NAME}" ]; then
                print_warning "Eine Instanz mit dem Namen '$INSTANCE_NAME' existiert bereits."
                read -p "$(echo -e "${YELLOW}Möchten Sie diese überschreiben? (y/N)${NC}: ")" -n 1 -r
                echo
                if [[ $REPLY =~ ^[Yy]$ ]]; then
                    break
                fi
            else
                break
            fi
        else
            print_error "Der Instanzname darf nicht leer sein."
        fi
    done
    
    echo
    print_info "=== Port-Konfiguration ==="
    print_info "Ports werden automatisch überprüft und falls belegt, wird der nächste freie Port vorgeschlagen."
    echo
    
    # Database port
    DEFAULT_DB_PORT=5432
    SUGGESTED_DB_PORT=$(find_available_port $DEFAULT_DB_PORT)
    DB_PORT=$(prompt_input "Datenbank Port" "$SUGGESTED_DB_PORT")
    
    # Backend port
    DEFAULT_BACKEND_PORT=3001
    SUGGESTED_BACKEND_PORT=$(find_available_port $DEFAULT_BACKEND_PORT)
    BACKEND_PORT=$(prompt_input "Backend API Port" "$SUGGESTED_BACKEND_PORT")
    
    # Frontend port
    DEFAULT_FRONTEND_PORT=8080
    SUGGESTED_FRONTEND_PORT=$(find_available_port $DEFAULT_FRONTEND_PORT)
    FRONTEND_PORT=$(prompt_input "Frontend Web Port" "$SUGGESTED_FRONTEND_PORT")
    
    # Validate ports are not conflicting
    if [ "$DB_PORT" = "$BACKEND_PORT" ] || [ "$DB_PORT" = "$FRONTEND_PORT" ] || [ "$BACKEND_PORT" = "$FRONTEND_PORT" ]; then
        print_error "Ports dürfen nicht identisch sein!"
        return 1
    fi
    

    
    # Generate secure random passwords
    DB_PASSWORD="secure_db_${INSTANCE_NAME}_$(openssl rand -hex 32)"
    ENCRYPTION_KEY="$(openssl rand -hex 32)"
    
    return 0
}

# Function to deploy an instance
deploy_instance() {
    echo
    print_info "=== Deployment wird gestartet ==="
    echo
    print_info "Instance Name: $INSTANCE_NAME"
    print_info "Database Port: $DB_PORT"
    print_info "Backend Port: $BACKEND_PORT" 
    print_info "Frontend Port: $FRONTEND_PORT"
    echo
    
    # Final confirmation
    read -p "$(echo -e "${YELLOW}Soll das Deployment gestartet werden? (y/N)${NC}: ")" -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_warning "Deployment abgebrochen."
        return 1
    fi
    
    # Create Docker Compose environment file
    print_info "Erstelle Docker Compose Konfiguration..."
    cat > .env.${INSTANCE_NAME} << EOF
COMPOSE_PROJECT_NAME=belego-${INSTANCE_NAME}
INSTANCE_NAME=${INSTANCE_NAME}
DB_PORT=${DB_PORT}
BACKEND_PORT=${BACKEND_PORT}
FRONTEND_PORT=${FRONTEND_PORT}
CORS_ORIGIN=http://localhost:${FRONTEND_PORT}
COOKIE_SECURE=false
COOKIE_SAME_SITE=lax
POSTGRES_DB=belego_${INSTANCE_NAME}
POSTGRES_USER=rm_user_${INSTANCE_NAME}
POSTGRES_PASSWORD=${DB_PASSWORD}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
REGISTRATION_MODE=closed-after-first
EOF
    chmod 600 ".env.${INSTANCE_NAME}"

    # Create Backend environment file
    print_info "Erstelle Backend Konfiguration..."
    cat > .env.backend.${INSTANCE_NAME} << EOF
PORT=3001
DB_HOST=database
DB_PORT=5432
DB_NAME=belego_${INSTANCE_NAME}
DB_USER=rm_user_${INSTANCE_NAME}
DB_PASSWORD=${DB_PASSWORD}
NODE_ENV=production
CORS_ORIGIN=http://localhost:${FRONTEND_PORT}
COOKIE_SECURE=false
COOKIE_SAME_SITE=lax
ENCRYPTION_KEY=${ENCRYPTION_KEY}
REGISTRATION_MODE=closed-after-first
EOF
    chmod 600 ".env.backend.${INSTANCE_NAME}"

    # Start deployment
    print_info "Starte Docker Container..."
    local build_version
    local build_revision
    build_version=$(solooffice_project_version "$SCRIPT_DIR")
    build_revision=$(solooffice_source_revision "$SCRIPT_DIR")
    if env SOLOOFFICE_VERSION="$build_version" SOLOOFFICE_COMMIT_SHA="$build_revision" \
        docker compose --env-file ".env.${INSTANCE_NAME}" -f docker-compose.yml \
        up -d --build --wait --wait-timeout 120 \
        && bash "$SCRIPT_DIR/manage-instances.sh" verify "$INSTANCE_NAME"; then
        echo
        print_success "Instance '$INSTANCE_NAME' wurde erfolgreich deployed!"
        echo
        print_info "=== Zugriffsinformationen ==="
        print_success "Frontend:     http://localhost:$FRONTEND_PORT"
        print_info "Backend/Datenbank: nur intern im Compose-Netzwerk (für Debugging docker-compose.debug.yml ergänzen)"
        echo
        print_info "=== Konfigurationsdateien ==="
        print_info "Docker Compose: .env.${INSTANCE_NAME}"
        print_info "Backend:        .env.backend.${INSTANCE_NAME}"
        echo
        print_info "=== Nächste Schritte ==="
        print_info "1. Öffnen Sie http://localhost:$FRONTEND_PORT im Browser"
        print_info "2. Konfigurieren Sie Ihre Firma in den Einstellungen"
        print_info "3. Erstellen Sie Ihre ersten Kunden und Rechnungen"
        echo
        print_warning "Wichtig: Bewahren Sie die Konfigurationsdateien sicher auf!"
        print_info "Passwörter und Verschlüsselungsschlüssel werden ausschließlich in den geschützten Instanzdateien gespeichert."
    else
        print_error "Deployment fehlgeschlagen!"
        return 1
    fi
}

# Main script logic
main() {
    # Hilfe muss auch auf einem Rechner ohne laufendes Docker lesbar sein.
    if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
        show_help
        return
    fi

    # Check for dependencies
    print_info "Überprüfe Systemvoraussetzungen..."
    
    # Check if Docker is installed and running
    if ! command -v docker &> /dev/null; then
        print_error "Docker ist nicht installiert. Bitte installieren Sie Docker Desktop."
        exit 1
    fi
    
    if ! docker info &> /dev/null; then
        print_error "Docker läuft nicht. Bitte starten Sie Docker Desktop."
        exit 1
    fi
    
    # Check if docker compose is available
    if ! docker compose version &> /dev/null; then
        print_error "Docker Compose ist nicht verfügbar."
        exit 1
    fi
    
    print_success "Alle Systemvoraussetzungen erfüllt."
    
    # Interactive mode if no arguments provided or with --interactive flag
    if [ $# -eq 0 ]; then
        collect_instance_config
        if [ $? -eq 0 ]; then
            deploy_instance
        fi
    else
        # Parse command line arguments
        case "$1" in
            --interactive|-i)
                collect_instance_config
                if [ $? -eq 0 ]; then
                    deploy_instance
                fi
                ;;
            --legacy)
                # Legacy mode with explicit flag
                shift # Remove --legacy from arguments
                legacy_deploy "$@"
                ;;
            *)
                print_error "Unbekanntes Argument: $1"
                echo
                print_info "Verfügbare Optionen:"
                print_info "  (keine Argumente)    - Interaktiver Modus (Standard)"
                print_info "  --interactive, -i    - Interaktiver Modus"
                print_info "  --legacy            - Legacy-Modus"
                print_info "  --help, -h          - Hilfe anzeigen"
                echo
                exit 1
                ;;
        esac
    fi
}

# Function to show help
show_help() {
    echo
    print_info "=== SoloOffice Deployment Script ==="
    echo
    echo "Usage:"
    echo "  $0                        # Interaktiver Modus (Standard, empfohlen)"
    echo "  $0 -i, --interactive      # Interaktiver Modus"
    echo "  $0 --legacy <args>        # Legacy-Modus mit explizitem Flag"
    echo "  $0 -h, --help             # Diese Hilfe anzeigen"
    echo
    echo "Legacy Modus (für Kompatibilität):"
    echo "  $0 --legacy <instance_name> [db_port] [backend_port] [frontend_port]"
    echo
    echo "Beispiele:"
    echo "  $0                        # Startet interaktiven Modus (Standard)"
    echo "  $0 --interactive          # Startet interaktiven Modus"
    echo "  $0 --legacy client1 5432 3001 8080"
    echo "  $0 --legacy client2 5433 3002 8081"
    echo
    print_info "Der interaktive Modus läuft standardmäßig und ist empfohlen, da er eine"
    print_info "vollständige E-Mail-Konfiguration und Validierung bietet."
    echo
}

# Legacy deployment function for backwards compatibility
legacy_deploy() {
    print_warning "Verwende Legacy-Modus (mit --legacy aufgerufen). Für vollständige Konfiguration verwenden Sie den Standard-Modus ohne Argumente."
    
    # Check if instance name is provided
    if [ -z "$1" ]; then
        show_help
        exit 1
    fi

    # Set default ports if not provided
    INSTANCE_NAME=$1
    DB_PORT=${2:-5432}
    BACKEND_PORT=${3:-3001}
    FRONTEND_PORT=${4:-8080}

    validate_instance_name "$INSTANCE_NAME" || exit 1

    # Check if ports are already in use
    if ! check_port $DB_PORT; then
        print_error "Port $DB_PORT ist bereits belegt!"
        exit 1
    fi

    if ! check_port $BACKEND_PORT; then
        print_error "Port $BACKEND_PORT ist bereits belegt!"
        exit 1
    fi

    if ! check_port $FRONTEND_PORT; then
        print_error "Port $FRONTEND_PORT ist bereits belegt!"
        exit 1
    fi

    # Generate secure secrets
    DB_PASSWORD="secure_db_${INSTANCE_NAME}_$(openssl rand -hex 32)"
    ENCRYPTION_KEY="$(openssl rand -hex 32)"
    
    # Create minimal configuration (no SMTP)
    cat > .env.${INSTANCE_NAME} << EOF
COMPOSE_PROJECT_NAME=belego-${INSTANCE_NAME}
INSTANCE_NAME=${INSTANCE_NAME}
DB_PORT=${DB_PORT}
BACKEND_PORT=${BACKEND_PORT}
FRONTEND_PORT=${FRONTEND_PORT}
POSTGRES_DB=belego_${INSTANCE_NAME}
POSTGRES_USER=rm_user_${INSTANCE_NAME}
POSTGRES_PASSWORD=${DB_PASSWORD}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
REGISTRATION_MODE=closed-after-first
EOF
    chmod 600 ".env.${INSTANCE_NAME}"

    # Create minimal backend config
    cat > .env.backend.${INSTANCE_NAME} << EOF
PORT=3001
DB_HOST=database
DB_PORT=5432
DB_NAME=belego_${INSTANCE_NAME}
DB_USER=rm_user_${INSTANCE_NAME}
DB_PASSWORD=${DB_PASSWORD}
NODE_ENV=production
ENCRYPTION_KEY=${ENCRYPTION_KEY}
REGISTRATION_MODE=closed-after-first
EOF
    chmod 600 ".env.backend.${INSTANCE_NAME}"

    # Deploy with specific env file
    local build_version
    local build_revision
    build_version=$(solooffice_project_version "$SCRIPT_DIR")
    build_revision=$(solooffice_source_revision "$SCRIPT_DIR")
    if env SOLOOFFICE_VERSION="$build_version" SOLOOFFICE_COMMIT_SHA="$build_revision" \
        docker compose --env-file ".env.${INSTANCE_NAME}" -f docker-compose.yml \
        up -d --build --wait --wait-timeout 120 \
        && bash "$SCRIPT_DIR/manage-instances.sh" verify "$INSTANCE_NAME"; then
        print_success "Instance '$INSTANCE_NAME' deployed successfully!"
        print_info "Frontend available at: http://localhost:$FRONTEND_PORT"
        print_info "Backend/Datenbank: nur intern im Compose-Netzwerk (Debug-Override bei Bedarf ergänzen)"
        print_warning "E-Mail-Funktionen sind im Legacy-Modus nicht konfiguriert."
        print_info "Verwenden Sie das Script ohne --legacy Flag für vollständige Konfiguration."
    else
        print_error "Deployment fehlgeschlagen!"
        exit 1
    fi
}

# Run main function
main "$@"
