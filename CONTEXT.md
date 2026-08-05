# SoloOffice – Projektkontext

## Zweck

SoloOffice ist eine deutschsprachige, mandantenfähige Webanwendung für Rechnungen, E-Rechnungen, Kunden- und Auftragsverwaltung sowie vorbereitende Buchhaltung.

Der aktuelle Produktname ist **SoloOffice**. Ältere technische Bezeichnungen und Commit-Texte können noch den früheren Namen „Belego“ enthalten.

## Technischer Überblick

- Frontend: React 18, TypeScript, Vite 5, Tailwind CSS 3, Context API
- Backend: Node.js, Express, ES Modules
- Datenbank: PostgreSQL 15
- Dokumente/PDF: jspdf, pdf-lib, pdfkit
- E-Mail: nodemailer
- Deployment: Docker Compose mit `database`, `backend` und `frontend`
- Routing: Hash-Routing über `window.location.hash`, kein React Router
- API: `VITE_API_URL`, in Produktion standardmäßig über Nginx unter `/api`

## Struktur

- `src/components/`: Seiten und UI-Komponenten
- `src/context/`: globale Frontend-Kontexte
- `src/services/api.ts`: produktiver API-Client
- `src/services/demoApi.ts`: Demo-/Local-Testing-API
- `src/types/index.ts`: zentrale TypeScript-Typen
- `backend/routes/`: Express-Routen
- `backend/migrations/`: sequenzielle Datenbankmigrationen
- `backend/services/`: Backend-Dienste, unter anderem lokale OCR

## Fachliche Bereiche

- Kunden und kundenbezogene Stundensätze
- Rechnungen, Gutschriften und wiederkehrende Rechnungen
- Angebote und Aufträge
- Kalender und Mahnungen
- E-Rechnung: ZUGFeRD/XRechnung
- EÜR mit Einnahmen, Ausgaben, Teilzahlungen, Korrekturen und Stornierungen
- Belegverwaltung mit lokaler OCR und EÜR-Verknüpfung
- Anlagenverzeichnis mit vorbereitender linearer Abschreibung
- Lokale Benutzerkonten, Sessions und Workspace-Verwaltung
- Rollen und Berechtigungen für Workspace-Mitglieder
- Import-Wizard und workspacebezogene Datenisolation
- Reporting, Steuerprofil und Backups
- Terminologieprofile für unterschiedliche Zielgruppen

## Wichtige Domänenregeln

- Alle sichtbaren UI-Texte sind grundsätzlich Deutsch.
- EÜR-Buchungen werden bei einer Stornierung nicht physisch gelöscht.
- EÜR-Änderungen werden über `euer_entry_history` protokolliert.
- OCR-Ergebnisse sind Vorschläge und müssen vor der Übernahme geprüft werden.
- Die Anlagen-Abschreibung ist eine Orientierung für Unterlagen und ersetzt keine steuerliche Prüfung.
- Es gibt derzeit keine ELSTER-Übertragung.
- Belege werden lokal im Backend-Container mit Tesseract verarbeitet; es ist kein externer OCR-Dienst vorgesehen.
- Authentifizierung bleibt lokal: Sessions werden serverseitig verwaltet, Passwörter mit scrypt gehasht.
- Workspaces werden serverseitig über PostgreSQL Row-Level Security voneinander getrennt.
- Der Demo-Modus simuliert Authentifizierung, Rollen und Workspaces nur im Browser.

## Datenbank und Migrationen

Das Backend führt ausstehende Migrationen beim Start automatisch aus. Neue Migrationen werden in `backend/migrations/index.js` registriert und erhalten die nächste fortlaufende Nummer.

Backups und Restores müssen bei neuen Tabellen und JSONB-Feldern mit angepasst werden.

## Entwicklung und Prüfung

Alle Entwicklungs- und Build-Schritte sollen innerhalb der Docker-Container erfolgen. Auf dem Host wird kein `npm` direkt ausgeführt.

Der Frontend-Container liefert die gebaute Produktionsversion aus. Lint und TypeScript-Prüfung erfolgen deshalb über den Docker-Build des Frontends.

Aktuell ist kein automatisiertes Testframework eingerichtet. Mindestens folgende Prüfungen sind vor einem Release erforderlich:

1. `git diff --check`
2. Docker-Build von Backend und Frontend
3. Migrationen gegen eine Testdatenbank ausführen
4. Manuelle Prüfung der Kernabläufe: Registrierung/Login, Workspace-Wechsel, Rollenrechte, Import, Rechnung, Beleg-OCR, EÜR, Anlagen und Backup/Restore

## Multi-Instance-Betrieb

- Compose-Projektname: `belego-<instance>` aus Kompatibilitätsgründen
- Compose-Variablen: `.env.<instance>`
- Backend-Konfiguration: `.env.backend.<instance>`
- Container-Namen und Volumes sind instanzbezogen.

## Release-Hinweise

Der erste öffentliche Teststand ist als `v0.1` beziehungsweise Beta-Release vorgesehen. Release Notes sollen insbesondere auf folgende Punkte hinweisen:

- OCR-Ergebnisse müssen geprüft werden.
- Steuerliche Auswertungen und Abschreibungen sind vorbereitende Arbeitsunterlagen.
- ELSTER-Übertragung ist noch nicht enthalten.
- Der Release ist für Tests und Feedback gedacht, nicht als uneingeschränkt produktiver Steuerabschluss.

## Bekannte nächste Aufgaben

- Die konfigurierbare Belegbezeichnung ist im Datenmodell/API vorbereitet, wird aber im aktuellen Einstellungsformular nicht gespeichert und in der Navigation noch nicht dynamisch verwendet.
- Die lokale Identity-/Workspace-Erweiterung befindet sich aktuell in Entwicklung und braucht einen vollständigen Multiuser-Test mit mindestens zwei Konten und Workspaces.
- Docker-Build, Frontend-Lint und manuelle End-to-End-Prüfung müssen in einer Docker-fähigen Umgebung erfolgen.

## Abgrenzung

Arbeitsweise, UX-Anspruch, Verifikation und Kommunikation stehen zentral in `EXPECTATIONS.md`. `AGENTS.md` und `CLAUDE.md` sind nur automatische Einstiegspunkte und verweisen auf diese beiden Dateien.
