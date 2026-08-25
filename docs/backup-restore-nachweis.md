# Nachweis: Workspacebezogenes Backup und Restore

**Datum:** 2026-08-25  
**Instanz:** TestDocker `TestDocker` · `/opt/solooffice-tor-s` · Port 8090  
**Status:** technisch bestanden, manuelle UI-Abnahme für AP-2.4 offen

## Ablauf

1. JSON-Backup für `RLS-Test A` und `RLS-Test B` über die API erstellt.
2. Backup-Listen beider Workspaces geprüft: Jeder Workspace sieht nur seinen
   eigenen Dateinamen.
3. Beide JSON-Dateien über den jeweils workspacebezogenen Download-Endpunkt
   geladen.
4. In Workspace A einen zusätzlichen Testkunden angelegt.
5. Nur das Backup von Workspace A wiederhergestellt.
6. Workspace A auf Entfernung des zusätzlichen Kunden geprüft und Workspace B
   unverändert gegengeprüft.
7. ZIP-Vollbackup erstellt, heruntergeladen und auf `database.json` sowie
   `metadata.json` geprüft.

## Ergebnis

```text
backup_a=10_records
backup_b=7_records
transient_removed=true
workspace_b_unchanged=true
restore_http=200
result=PASS
```

Das ZIP-Backup enthielt:

```text
database.json
metadata.json
```

Der Restore löscht und schreibt ausschließlich im aktiven Workspace. Der
zweite Workspace blieb während des Restore-Laufs erhalten.

## Größenlimit

Ein absichtlich zu großer JSON-Payload wurde gegen den Restore-Endpunkt
gesendet:

```text
oversize_http=413
response={"error":"Das Backup ist zu groß. Erlaubt sind maximal 50 MB.","code":"BACKUP_PAYLOAD_TOO_LARGE"}
```

Die Grenze wird damit verständlich und ohne Datenbankänderung abgewiesen.

## Einschränkung

Eine zusätzliche manuelle Prüfung der Backup-Anzeige und des Restore-Ablaufs
in zwei Browserfenstern bleibt für die endgültige Abnahme sinnvoll.
