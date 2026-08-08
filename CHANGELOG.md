# Changelog

Alle relevanten Änderungen an SoloOffice werden hier versioniert dokumentiert.

## [v0.5] – Öffentliche Demo und Betriebsmodi

Der Release ergänzt einen eigenständigen Demo-Betrieb sowie vorbereitete
Container- und Deployment-Abläufe für eine öffentliche Vorführung und ein
gehostetes Betriebsmodell.

### Neue Funktionen

- Eigenständiger Demo-Modus ohne Backend, Datenbank oder Secrets; die Demo hält
  ihren Zustand ausschließlich im `localStorage` des Browsers.
- Dauerhafter Demo-Hinweis mit Zurücksetzen der Testdaten und Verweis auf den
  Quelltext der exakt laufenden Commit-Fassung.
- Automatische Aktualisierung veralteter Demodaten nach 14 Tagen sowie ein
  Hinweis mit manueller Auffrischung, wenn eigene Änderungen vorhanden sind.
- Separate Docker-Compose-Konfiguration für die öffentliche Demo mit eigener
  nginx-Konfiguration und Healthcheck.
- SaaS-Compose-Override und `.env`-Vorlage für sichere Cookies, HSTS,
  Einladungsbetrieb, E-Mail-Bestätigung, CORS und Ressourcenlimits.

### Verbesserungen

- GitHub-Actions-Workflow zum Prüfen, Bauen und Veröffentlichen des Demo-Images
  in der GitHub Container Registry mit beweglichem `main`-Tag und
  unveränderlichem Commit-Tag.
- Pull-basiertes Server-Deployment mit systemd-Timer, Healthcheck,
  versionsbezogenem Rollback und begrenzter Image-Bereinigung dokumentiert.
- Demo-Container mit Read-only-Dateisystem, reduzierten Linux-Capabilities,
  `no-new-privileges`, Speicherlimit und begrenzter Protokollierung gehärtet.
- Demo-Datensätze verwenden nun Datums- und Jahresbezüge relativ zum aktuellen
  Datum und bleiben dadurch auch über den Jahreswechsel konsistent.
- Kontrastberechnung für dynamische Primärfarben an helle und dunkle Flächen
  angepasst; Demo-Firmendaten werden vollständig vorbelegt.

### Fehlerbehebungen

- Veraltete Demo-Daten werden nach längerer Pause nicht mehr dauerhaft mit
  überfälligen Terminen, Rechnungen und EÜR-Einträgen angezeigt.
- Automatische Statusaktualisierungen werden nicht fälschlich als eigene
  Änderungen des Besuchers gewertet.
- Demo-Updates laden durch passende Cache-Regeln zuverlässig das aktuelle
  Bundle; der Dienst kann über `/healthz` geprüft werden.

### Bekannte Einschränkungen

- Die SaaS-Konfiguration ist eine technische Vorbereitung und noch kein
  vollständig buchbares Hosting-Produkt. Control Plane, Objektspeicher,
  Offsite-Backups und ein vollständiger Multiuser-Laufzeitcheck fehlen noch.
- Die öffentliche Demo ist eine Vorführung; ihre Daten bleiben lokal im Browser
  und werden nicht an einen Server übertragen.

## [v0.4] – Beta-Release

Aktueller SoloOffice-Beta-Release mit erweitertem Identitäts-, Workspace-, eRechnungs-, Dokumenten- und Auftragsumfang.

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

[v0.4]: https://github.com/TingelTangelBob/SoloOffice/releases/tag/v0.4
[v0.5]: https://github.com/TingelTangelBob/SoloOffice/releases/tag/v0.5
[0.1.0]: https://github.com/TingelTangelBob/SoloOffice/releases/tag/v0.1
