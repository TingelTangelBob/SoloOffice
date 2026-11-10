#!/usr/bin/env bash
# Nächtliches Instanz-Backup mit Aufbewahrung; wird vom systemd-Timer aufgerufen.
# Nutzung: solooffice-backup.sh <instanz> [aufbewahrung_in_tagen]
# Optional: BACKUP_OFFSITE_TARGET=user@host:/pfad/ kopiert nach jedem Backup per rsync.
set -euo pipefail
umask 077

instance="${1:-}"
keep_days="${2:-14}"
if [[ ! "$instance" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]]; then
  echo "Ungültiger oder fehlender Instanzname." >&2
  exit 2
fi
if [[ ! "$keep_days" =~ ^[0-9]+$ ]] || [ "$keep_days" -lt 1 ]; then
  echo "Die Aufbewahrung muss eine ganze Zahl von mindestens 1 Tag sein." >&2
  exit 2
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

# Nie zwei Läufe gleichzeitig: Das Backend wird für den Dump kurz angehalten.
exec 9>"$root/.backup.lock"
if ! flock -n 9; then
  echo "Ein anderes Backup läuft noch. Dieser Lauf wird übersprungen." >&2
  exit 1
fi

echo "$(date -Is) Backup für '$instance' startet."
./manage-instances.sh backup "$instance"

if [ -n "${BACKUP_OFFSITE_TARGET:-}" ]; then
  echo "$(date -Is) Offsite-Kopie nach $BACKUP_OFFSITE_TARGET."
  rsync -a --chmod=F600,D700 "$root/backups/" "$BACKUP_OFFSITE_TARGET"
fi

# Rotation erst nach erfolgreichem Backup (und erfolgreicher Offsite-Kopie).
find "$root/backups" -maxdepth 1 -type f -mtime +"$keep_days" \
  \( -name "backup_${instance}_*.sql" -o -name "env_${instance}_*" -o -name "env_backend_${instance}_*" \) \
  -print -delete
echo "$(date -Is) Backup für '$instance' fertig; Dateien älter als $keep_days Tage entfernt."
