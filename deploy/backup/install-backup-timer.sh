#!/usr/bin/env bash
# Richtet das nächtliche Backup als systemd-Timer ein (als root ausführen).
# Nutzung: sudo deploy/backup/install-backup-timer.sh <instanz> [uhrzeit HH:MM] [aufbewahrung_tage]
# Entfernen: systemctl disable --now solooffice-backup-<instanz>.timer && rm /etc/systemd/system/solooffice-backup-<instanz>.*
set -euo pipefail

instance="${1:-}"
time_of_day="${2:-02:17}"
keep_days="${3:-14}"
if [[ ! "$instance" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]]; then
  echo "Nutzung: $0 <instanz> [HH:MM] [aufbewahrung_tage]" >&2
  exit 2
fi
if [[ ! "$time_of_day" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]]; then
  echo "Die Uhrzeit muss im Format HH:MM angegeben werden." >&2
  exit 2
fi
if [ "$(id -u)" -ne 0 ]; then
  echo "Bitte als root ausführen (sudo)." >&2
  exit 1
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
[ -f "$root/.env.$instance" ] || { echo "Instanz '$instance' nicht gefunden ($root/.env.$instance fehlt)." >&2; exit 1; }

unit="solooffice-backup-$instance"
cat > "/etc/systemd/system/$unit.service" <<UNIT
[Unit]
Description=SoloOffice Backup ($instance)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
WorkingDirectory=$root
# Optional: Offsite-Ziel in /etc/solooffice-backup-$instance.env als BACKUP_OFFSITE_TARGET=... eintragen.
EnvironmentFile=-/etc/solooffice-backup-$instance.env
ExecStart=$root/deploy/backup/solooffice-backup.sh $instance $keep_days
UNIT
cat > "/etc/systemd/system/$unit.timer" <<UNIT
[Unit]
Description=Nächtliches SoloOffice-Backup ($instance)

[Timer]
OnCalendar=*-*-* $time_of_day:00
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
UNIT

chmod +x "$root/deploy/backup/solooffice-backup.sh"
systemctl daemon-reload
systemctl enable --now "$unit.timer"
systemctl list-timers "$unit.timer" --no-pager
echo "Eingerichtet. Sofort testen mit: systemctl start $unit.service && journalctl -u $unit.service -n 30"
