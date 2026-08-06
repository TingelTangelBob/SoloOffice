# Changelog

Alle relevanten Änderungen an SoloOffice werden hier versioniert dokumentiert.

## [Unreleased]

Vorbereitung für den nächsten Beta-Release (`v0.2.0-beta.1`).

### Neue Funktionen

- Lokale Benutzerkonten, serverseitige Sessions und Authentifizierung.
- Workspace-Verwaltung mit Wechsel zwischen Workspaces und Einladungen von Mitgliedern.
- Rollen und Berechtigungen für Administratoren, Mitarbeiter und Nur-Lesen-Nutzer.
- Workspacebezogene Datenisolation über PostgreSQL Row-Level Security.
- Import-Assistent mit Vorschau, Feldzuordnung und Validierung.
- Erweiterte Demo-/Local-Testing-Abläufe für Workspaces und fachbezogene Daten.
- Belegverwaltung mit lokaler OCR, Prüfung der Vorschläge und Verknüpfung mit der EÜR.
- Anlagenverzeichnis mit vorbereitender Abschreibungsübersicht.
- Erweiterte EÜR mit Teilzahlungen, Korrekturen, Stornierungen und Änderungshistorie.
- Eingehende eRechnungen mit Validierung und Verarbeitung eingehender Dokumente.
- Wiederkehrende Aufträge, Entwürfe und zusätzliche Auftragsinformationen.
- Dokumentenverknüpfungen und Archivierungsfunktionen.
- Zeitzonenunterstützung für zeitabhängige Geschäfts- und Kalenderdaten.
- Erweiterte Auftrags- und Zeiterfassung mit wiederkehrenden Abläufen, Entwürfen und verbesserten Folgeaktionen.
- Überarbeitete Dashboard- und Dokumentvorschauen für einen schnelleren Überblick über aktuelle Vorgänge.

### Verbesserungen

- Überarbeitete Rechnungs-, Angebots-, Mahnungs- und Vorlagenabläufe.
- Verbesserte responsive Darstellung von Tabellen, Navigation, Kalender, Formularen und Dialogen.
- Konsistentere Aktionsmenüs, Statusdarstellungen, Farben und Terminologieprofile.
- Erweiterte Backup-/Restore-Berücksichtigung der neuen Datenbereiche.
- Lokale OCR- und Belegverarbeitung ohne Übertragung an externe Dienste.
- Projekt- und Agentendokumentation mit zentralem Kontext und einheitlichen Arbeitsanforderungen.
- Erweiterte Docker-, SaaS- und lokale Testdokumentation.
- Sicherheits- und Compliance-Härtungen, darunter Rate-Limiting, Session-Wartung, Secret-Schutz und Metriken.
- Gemeinsame Layout-, Seitenkopf-, Navigations- und Stylingpfade über weitere Kernseiten vereinheitlicht.

### Fehlerbehebungen

- Verschiedene Darstellungs- und Interaktionsprobleme in Rechnungen, Angeboten, Belegen, EÜR, Anlagen und Auswertungen behoben.
- EÜR-Buchungen werden bei Stornierung revisionssicher erhalten statt physisch gelöscht.
- Validierungen und Fehlerzustände für Belege, EÜR, Anlagen, Workspaces und Importe erweitert.
- Demo-Daten und produktive API-Abläufe stärker aneinander angeglichen.
- Zusätzliche Validierungen und Schutzmaßnahmen für eRechnungen, Dokumente, Sessions und Unternehmensdaten.
- Fehler und Inkonsistenzen in Auftrags-, Rechnungs-, Dashboard- und Dokumentdarstellungen behoben.

### Bekannte Einschränkungen

- Der Release ist für Tests und Feedback vorgesehen.
- OCR-Ergebnisse müssen vor der Übernahme in die EÜR geprüft werden.
- EÜR, Steuerprofile, Reports und Abschreibungen sind vorbereitende Arbeitsunterlagen und ersetzen keine steuerliche Prüfung.
- Eine ELSTER-Übertragung ist noch nicht enthalten.
- Der vollständige Multiuser-Ablauf mit mehreren Konten und Workspaces muss noch in einer Docker-Umgebung geprüft werden.
- Es gibt derzeit kein automatisiertes Testframework; technische und manuelle Prüfungen müssen getrennt dokumentiert werden.

## [0.1.0] – Erste Beta-Version

Erster SoloOffice-Teststand mit Rechnungsverwaltung, E-Rechnung, Kunden- und Auftragsverwaltung, EÜR-Grundfunktionen, Belegverwaltung, Anlagenverzeichnis und lokalen Demo-Abläufen.

[Unreleased]: https://github.com/TingelTangelBob/SoloOffice/compare/v0.1...HEAD
[0.1.0]: https://github.com/TingelTangelBob/SoloOffice/releases/tag/v0.1
