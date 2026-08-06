# SoloOffice

SoloOffice ist eine deutschsprachige Rechnungs- und Geschäftsverwaltung für Self-Hosting. Der Funktionsumfang umfasst Kunden, Angebote, Rechnungen, Aufträge, Zeiterfassung, Mahnungen, EÜR, Belege, Anlagen, SMTP-Versand, Backups und mehrere Workspaces.

SoloOffice steht unter der GNU Affero General Public License v3. Die ursprüngliche Codebasis und die Fork-Historie sind in [NOTICE.md](NOTICE.md) dokumentiert.

## Entwicklung und Betrieb

Die Anwendung wird mit Docker Compose betrieben. Auf dem Host werden keine Node-Abhängigkeiten installiert.

```bash
./deploy-instance.sh
# Das Skript erzeugt die Instanzdateien mit zufälligem
# POSTGRES_PASSWORD und ENCRYPTION_KEY.
```

Für eine lokale Diagnose können Datenbank und Backend ausdrücklich über den Debug-Override veröffentlicht werden:

```bash
docker compose --env-file .env.<instanz> -f docker-compose.yml -f docker-compose.debug.yml up --build
```

Das normale Compose-Setup veröffentlicht nur das Frontend. Der Backend-Container läuft als unprivilegierter Benutzer; PostgreSQL und `/backups` liegen auf persistenten Volumes.

## E-Rechnungen

SoloOffice erzeugt XRechnung-XML sowie ZUGFeRD-XML als eingebettete `factur-x.xml` und kann eingehende XRechnung-/CII-XML lokal archivieren, strukturell prüfen und Kunden zuordnen. Die Generatoren und der Eingang prüfen nur Wohlgeformtheit bzw. zentrale Pflichtfelder. Eine rechtssichere Freigabe setzt weiterhin eine Prüfung mit den offiziellen KOSIT-/FeRD-Schema- und Schematron-Validatoren voraus. Die PDF/A-3-Vollständigkeit (insbesondere ICC-OutputIntent und eingebettete Schriften) sowie ZUGFeRD-PDF-Eingang müssen vor produktiver Archivierung zusätzlich extern bzw. durch weitere Integration validiert werden.

## Sicherheit und Daten

- Workspace-Daten werden über PostgreSQL-RLS und einen Request-Kontext getrennt.
- SMTP-Passwörter werden verschlüsselt gespeichert; `ENCRYPTION_KEY` muss dauerhaft sicher verwahrt werden.
- Registrierung, E-Mail-Verifizierung und Passwort-Reset sind konfigurierbar.
- Backups werden workspacebezogen erstellt und beim Restore nur in den aktiven Workspace eingespielt. Produktionsbackups sollten zusätzlich offsite repliziert und regelmäßig testweise wiederhergestellt werden.
- GoBD-, DSGVO- und steuerrechtliche Eignung hängt von Konfiguration, Betriebsprozess und fachlicher Prüfung ab; SoloOffice ersetzt keine Rechts- oder Steuerberatung.

## Lizenz und Beiträge

Beiträge zu dieser Fork werden unter der AGPL v3 veröffentlicht. Copyright-Vermerke der ursprünglichen Belego Contributors bleiben erhalten. Siehe [NOTICE.md](NOTICE.md) für Fork- und Beitragsangaben.

Copyright (C) 2026 SoloOffice Contributors für eigene Beiträge.
