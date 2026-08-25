#!/bin/bash

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

# Function to list all running instances
list_instances() {
    echo
    print_info "=== Laufende SoloOffice-Instanzen ==="
    echo
    
    # Get all running containers with belego in name
    containers=$(docker ps --filter "name=belego-" --format "table {{.Names}}\t{{.Ports}}\t{{.Status}}")
    
    if [ "$(echo "$containers" | wc -l)" -eq 1 ]; then
        print_warning "Keine laufenden Instanzen gefunden."
    else
        echo "$containers"
    fi
    
    echo
    print_info "=== Verfügbare Konfigurationen ==="
    for env_file in .env.*; do
        if [ -f "$env_file" ] && [[ "$env_file" != .env.backend.* ]]; then
            instance_name=$(echo "$env_file" | sed 's/.env.//')
            if [ -f ".env.backend.$instance_name" ]; then
                # Get ports from env file
                DB_PORT=$(grep "DB_PORT=" "$env_file" | cut -d'=' -f2)
                BACKEND_PORT=$(grep "BACKEND_PORT=" "$env_file" | cut -d'=' -f2)
                FRONTEND_PORT=$(grep "FRONTEND_PORT=" "$env_file" | cut -d'=' -f2)
                
                # Check if running
                if docker ps --filter "name=belego-${instance_name}" --format "{{.Names}}" | grep -q "belego-${instance_name}"; then
                    status="${GREEN}RUNNING${NC}"
                else
                    status="${RED}STOPPED${NC}"
                fi
                
                echo -e "  ${BLUE}$instance_name${NC} - $status - Frontend:$FRONTEND_PORT (Backend/DB intern)"
            fi
        fi
    done
}

# Function to stop an instance
stop_instance() {
    local instance_name=$1
    if [ -z "$instance_name" ]; then
        print_error "Bitte geben Sie den Instanznamen an"
        echo "Usage: $0 stop <instance_name>"
        return 1
    fi
    
    if [ ! -f ".env.${instance_name}" ]; then
        print_error "Instanz '$instance_name' nicht gefunden"
        return 1
    fi
    
    print_info "Stoppe Instanz: $instance_name"
    if docker compose --env-file .env.${instance_name} -f docker-compose.yml down; then
        print_success "Instanz '$instance_name' wurde gestoppt"
    else
        print_error "Fehler beim Stoppen der Instanz '$instance_name'"
        return 1
    fi
}

# Function to start an instance
start_instance() {
    local instance_name=$1
    if [ -z "$instance_name" ]; then
        print_error "Bitte geben Sie den Instanznamen an"
        echo "Usage: $0 start <instance_name>"
        return 1
    fi
    
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
    fi
    
    print_info "Starte Instanz: $instance_name"
    if docker compose --env-file .env.${instance_name} -f docker-compose.yml up -d --build; then
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
    local instance_name=$1
    if [ -z "$instance_name" ]; then
        print_error "Bitte geben Sie den Instanznamen an"
        echo "Usage: $0 remove <instance_name>"
        return 1
    fi
    
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
    local instance_name=$1
    local service=${2:-""}
    
    if [ -z "$instance_name" ]; then
        print_error "Bitte geben Sie den Instanznamen an"
        echo "Usage: $0 logs <instance_name> [service]"
        return 1
    fi
    
    if [ ! -f ".env.${instance_name}" ]; then
        print_error "Instanz '$instance_name' nicht gefunden"
        return 1
    fi
    
    print_info "Zeige Logs für Instanz: $instance_name"
    if [ -n "$service" ]; then
        print_info "Service: $service"
        docker compose --env-file .env.${instance_name} -f docker-compose.yml logs -f $service
    else
        docker compose --env-file .env.${instance_name} -f docker-compose.yml logs -f
    fi
}

# Function to backup instance data
backup_instance() {
    local instance_name=$1
    if [ -z "$instance_name" ]; then
        print_error "Bitte geben Sie den Instanznamen an"
        echo "Usage: $0 backup <instance_name>"
        return 1
    fi
    
    if [ ! -f ".env.${instance_name}" ]; then
        print_error "Instanz '$instance_name' nicht gefunden"
        return 1
    fi
    
    # Backups contain business data and the instance keys from the env files.
    # Keep the complete backup set private even when the host uses a permissive
    # default umask.
    umask 077

    # Get database configuration
    DB_NAME=$(grep "POSTGRES_DB=" ".env.${instance_name}" | cut -d'=' -f2)
    DB_USER=$(grep "POSTGRES_USER=" ".env.${instance_name}" | cut -d'=' -f2)
    
    local backup_dir="backups"
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_file="${backup_dir}/backup_${instance_name}_${timestamp}.sql"
    local container_name="belego-${instance_name}-db"
    
    # Create backup directory if it doesn't exist
    mkdir -p "$backup_dir"
    chmod 700 "$backup_dir"
    
    print_info "Erstelle Backup für Instanz: $instance_name"
    print_info "Backup wird gespeichert als: $backup_file"
    
    if docker exec "$container_name" pg_dump -U "$DB_USER" "$DB_NAME" > "$backup_file"; then
        chmod 600 "$backup_file"
        # Also backup configuration files
        cp ".env.${instance_name}" "${backup_dir}/env_${instance_name}_${timestamp}"
        chmod 600 "${backup_dir}/env_${instance_name}_${timestamp}"
        if [ -f ".env.backend.${instance_name}" ]; then
            cp ".env.backend.${instance_name}" "${backup_dir}/env_backend_${instance_name}_${timestamp}"
            chmod 600 "${backup_dir}/env_backend_${instance_name}_${timestamp}"
        fi
        
        print_success "Backup erfolgreich erstellt!"
        print_info "Dateien:"
        print_info "  - Datenbank: $backup_file"
        print_info "  - Konfiguration: ${backup_dir}/env_${instance_name}_${timestamp}"
        if [ -f ".env.backend.${instance_name}" ]; then
            print_info "  - Backend-Konfiguration: ${backup_dir}/env_backend_${instance_name}_${timestamp}"
        fi
    else
        print_error "Backup fehlgeschlagen!"
        return 1
    fi
}

# Function to edit instance configuration
edit_config() {
    local instance_name=$1
    if [ -z "$instance_name" ]; then
        print_error "Bitte geben Sie den Instanznamen an"
        echo "Usage: $0 config <instance_name>"
        return 1
    fi
    
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
        backup_instance $2
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
        echo "  config <instance>       - Konfiguration bearbeiten"
        echo "  help                    - Diese Hilfe anzeigen"
        echo
        echo "Beispiele:"
        echo "  $0 list"
        echo "  $0 start client1"
        echo "  $0 logs client1 backend"
        echo "  $0 backup client1"
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
