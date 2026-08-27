# Nachweis: Workspace- und Instanz-Backup mit Restore

**Datum:** 2026-08-25, Instanz-Restore ergänzt am 2026-08-26, manuelle Abnahme am 2026-08-27, Eingangsvalidierung ergänzt am 2026-08-28
**Instanz:** TestDocker `TestDocker` · `/opt/solooffice-tor-s` · Port 8090  
**Status:** technisch und manuell bestanden

## Workspacebezogener Ablauf

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

Seit 2026-08-28 gilt dieselbe Tabellen-/Datensatz-Allowlist für JSON- und
ZIP-Restores. ZIP-Archive werden vor dem Belegen einer Datenbankverbindung auf
die exakten Einträge `database.json` und `metadata.json`, 50 MB Uploadgröße,
45 MB entpackte Datenbankdatei, gültiges JSON, bekannte Tabellen und höchstens
250.000 Datensätze geprüft. Zusätzliche oder doppelte Einträge, beschädigtes
JSON und unbekannte Tabellen werden mit einem konkreten 4xx-Code abgewiesen.
Die temporäre Upload-Datei wird auch bei früher Ablehnung in einem äußeren
`finally`-Pfad entfernt.

## Vollständiges Instanz-Backup

Der erste direkte `pg_dump`-Versuch hat einen Betriebsfehler sichtbar gemacht:
Der nicht privilegierte Laufzeitbenutzer konnte wegen `FORCE ROW LEVEL
SECURITY` keinen vollständigen Dump lesen. PostgreSQL brach bereits bei
`calendar_events` ab. Der Instanzmanager hält deshalb jetzt das Backend kurz
an, löst nur während des Dumps den erzwungenen Besitzer-RLS-Schutz und stellt
den exakten vorherigen Zustand fehlersicher wieder her. Der Datenbankport ist
im normalen Compose-Stack nicht veröffentlicht.

Der korrigierte Lauf über den vorgesehenen Bedienbefehl ergab:

```text
command=./manage-instances.sh backup tor-s
sql_bytes=851629
sql_mode=600
appended_force_statements=31
source_rls=31/31 forced
backend_after_backup=healthy
result=PASS
```

Zusätzlich zum SQL-Dump wurden `.env.tor-s` und `.env.backend.tor-s` mit Modus
`600` gesichert. Das unvollständige Ergebnis des zuvor fehlgeschlagenen
Direktversuchs wurde nicht als Backup übernommen.

## Wiederherstellung in ein leeres Volume

Der erzeugte SQL-Dump wurde in einen kurzlebigen, getrennten
PostgreSQL-15-Container mit neuer Datenbankrolle eingespielt. Vor dem ersten
Backend-Start war diese durch die PostgreSQL-Neuinitialisierung erwartungsgemäß
noch privilegiert; die Migration war im Dump bereits als ausgeführt markiert:

```text
before: super=true bypass=true
migration_032_count=1
workspaces=3 users=3 memberships=5
rls=31 forced=31
```

Die zusätzliche Startprüfung griff unabhängig von der Migrationstabelle. Das
Backend beendete sich einmal kontrolliert, wurde neu gestartet und war danach
gesund:

```text
after: super=false bypass=false
restart_count=1
health=200
empty_context_customers=0
workspace_a_customers=9 (Quelle: 9)
workspace_b_customers=6 (Quelle: 6)
result=PASS
```

Als Abbruchsimulation wurde anschließend bei angehaltenem Test-Backend für
eine RLS-Tabelle `NO FORCE ROW LEVEL SECURITY` gesetzt. Beim Start reparierte
SoloOffice den Zustand selbständig von `30/31` auf `31/31`, führte den
vorgesehenen Neustart aus und beantwortete `/health` wieder mit HTTP 200. Alle
temporären Container und das Testnetz wurden danach entfernt; die Tor-S- und
Anzeigen-Studio-Stacks liefen weiter.

## Manuelle Browserabnahme

Ein ZIP-Vollbackup wurde über die Oberfläche erstellt, heruntergeladen und im
ursprünglichen Workspace wiederhergestellt. Ein nach dem Backup angelegter
Testkunde wurde durch den Restore erwartungsgemäß entfernt; der zweite
Workspace blieb unverändert. Ein Restoreversuch im falschen Workspace wird
vor jeder Datenänderung mit `BACKUP_WORKSPACE_MISMATCH` abgewiesen. Neue
Backup-Dateinamen verwenden die vom Browser gemeldete lokale Zeitzone.

```text
AP-2.4=PASS
zip_restore=PASS
second_workspace_unchanged=PASS
local_backup_time=PASS
```

## Verbleibende Betriebsaufgabe

Ein Offsite-Ziel und dessen regelmäßige Überwachung sind Betreiberaufgaben und
wurden in diesem Nachweis nicht geprüft.
