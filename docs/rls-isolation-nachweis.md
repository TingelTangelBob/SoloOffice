# Nachweis: Multiuser- und RLS-Isolation

**Datum:** 2026-08-25  
**Instanz:** TestDocker `TestDocker` · `/opt/solooffice-tor-s` · Port 8090  
**Stand:** Workspace-Verwaltung plus Migration `032_runtime_rls_role`  
**Status:** technisch bestanden, manuelle UI-Abnahme für AP-2.3 offen

## Testaufbau

Auf der getrennten Tor-S-Instanz wurden zwei technische Konten und zwei
Workspaces verwendet:

| Konto | Workspace | Rolle |
|---|---|---|
| `rls-a-20260825@solooffice.test` | `RLS-Test A` | Eigentümer in A, Viewer in B |
| `rls-b-20260825@solooffice.test` | `RLS-Test B` | Eigentümer in B, Mitarbeiter in A |

Die Konten und Daten sind ausschließlich Testdaten auf Tor S. Der vorhandene
Workspace des ersten manuellen Login-Tests wurde nicht verändert.

## Sicherheitsbefund und Korrektur

Der erste API-Test hat einen echten Fehler gefunden: Beide Workspaces konnten
beide Kundensätze lesen. Die PostgreSQL-Policies waren zwar aktiv und auf
`FORCE ROW LEVEL SECURITY` gesetzt, der Compose-Datenbankbenutzer hatte aber
`rolsuper=true` und `rolbypassrls=true`. PostgreSQL-Superuser umgehen RLS auch
bei `FORCE ROW LEVEL SECURITY`.

Auf dem Teststand wurde der Laufzeitbenutzer auf `NOSUPERUSER NOBYPASSRLS`
gesetzt. Im Quellstand ist das jetzt als Migration
`032_runtime_rls_role` abgesichert. Bei einer frischen Instanz wird das
Backend nach der Demotion einmal beendet; Docker startet es mit neuem
PostgreSQL-Login wieder. Bereits abgesicherte Instanzen bleiben idempotent.

Nach der Korrektur:

```text
solooffice_tor_s|f|f
```

## API-Nachweis

Der vollständige Test wurde über die produktiven Auth-, Workspace- und
Kundenendpunkte ausgeführt:

```text
cross_workspace_status=404
viewer_write_status=403
admin_rename_status=200
result=PASS
```

Ein Eigentümer sieht nur seine Workspace-Daten. Ein Mitarbeiter kann im
zugewiesenen Workspace schreiben. Ein Viewer kann lesen, aber nicht schreiben.
Ein Zugriff auf die Mitgliederroute eines fremden, nicht aktiven Workspaces
endet mit 404. Ein Administrator kann den Workspace-Namen ändern.

## Direkte Datenbankprüfung

Die Abfragen wurden mit dem jetzt nicht privilegierten Laufzeitbenutzer und
jeweils gesetztem Sitzungswert ausgeführt:

```text
Workspace A: A=7
Workspace B: B=5
Leerer Kontext: empty=0
```

Der leere Kontext ist damit fail-closed. Die unterschiedlichen Datensatzmengen
enthalten die absichtlich mehrfach ausgeführten Testläufe; entscheidend ist,
dass A keine B-Sätze und B keine A-Sätze sieht.

## Paralleltest des Connection-Pools

20 parallele Leseanfragen je Workspace, insgesamt 40 Anfragen:

```text
parallel_a_pass=20/20
parallel_b_pass=20/20
result=PASS
```

Es wurde kein Datensatz des jeweils anderen Workspaces sichtbar.

## Transaktionsfehler und Pool-Rückgabe

Ein Restore in Workspace A wurde absichtlich mit einer ungültigen UUID zum
Fehlschlag gebracht. Der gestartete Restore löste HTTP 500 aus und wurde
vollständig zurückgerollt. Danach wurden beide Workspaces erneut gelesen:

```text
restore_error_http=500
workspace_a_rollback=true
workspace_b_unchanged=true
next_workspace_request_clean=true
result=PASS
```

Damit bleibt auch eine fehlerhafte Transaktion ohne Datenreste oder fremden
Workspace-Kontext im Connection-Pool.

## Einschränkung

Der Nachweis ist ein technischer API- und Datenbanklauf. Eine zusätzliche
manuelle Prüfung mit zwei Browserfenstern und den Rollenbeschriftungen in der
Oberfläche bleibt für die endgültige Abnahme sinnvoll.
