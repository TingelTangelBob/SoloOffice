# SoloOffice v0.8.2 – Beta-Freigabe und Hosting-Check

Stand: 14.09.2026
Status: Vorbereitung einer geschlossenen Beta

## Entscheidung

SoloOffice kann mit `v0.8.2` für eine kleine, geschlossene Beta vorbereitet
werden. Für einen öffentlichen oder uneingeschränkten Produktivbetrieb ist die
Version noch nicht freigegeben. Vor dem ersten Zugang müssen die technischen
und fachlichen Abnahmeschritte weiter unten abgeschlossen sein.

## Inhalt von v0.8.2

- Kundenseiten ohne separaten Steckbrief, mit kompakterer Kontaktkarte,
  Anschrift an der vorgesehenen Stelle und allgemeinem Aktivitätsverlauf.
- Notizen direkt in der Kundenseite bearbeiten.
- Rechnungen, Gutschriften, Angebote und Aufträge auf der Kundenseite
  vollständig und kundenbezogen anzeigen.
- PDF-Vorschauen verbreitern und doppelte Aktionsleisten entfernen. Die PDF-
  Aktionen bleiben in der nativen PDF-Leiste.
- Demo-Kundenseiten gegen Datumswerte aus dem Backend absichern, damit die
  Ansicht nicht mehr mit einer weißen Seite endet.
- Projekt- und Backend-Version einschließlich Lockfiles auf `0.8.2` anheben.

## Bereits geprüfter Arbeitsstand

Die folgenden lokalen Prüfungen wurden im aktuellen Arbeitsstand ausgeführt:

- `npm run typecheck`
- `npm run lint`
- `npm test` mit 26 Frontend-Tests
- `npm run build`

Der Build ist erfolgreich. Vite meldet weiterhin den bekannten, nicht
blockierenden PostCSS-Hinweis zur fehlenden `from`-Option. Die vollständige
Docker-, PostgreSQL- und CI-Prüfung bleibt für den Release-Gate erforderlich.

Bereits nachgewiesene Grundlagen sind in
`docs/rls-isolation-nachweis.md` und `docs/backup-restore-nachweis.md`
dokumentiert: getrennte Benutzer und Workspaces, fehlende Sichtbarkeit
zwischen Workspaces, Einladungen und Rollen sowie Backup/Restore mit
Zeitzonen-sicherem Dateinamen.

## Noch offene Release-Gates

Vor dem ersten echten Beta-Zugang müssen diese Punkte mit Datum, Commit und
Ergebnis in `docs/manual-release-checklist.md` oder einem verknüpften
Abnahmeprotokoll festgehalten werden:

- CI, Quality-Workflow, Datenbankmigrationen, RLS-Tests und Dependency-Audit
  müssen grün sein.
- SMTP mit einer echten Testdomain: Einladung, E-Mail-Verifizierung,
  Passwort-Reset und Dokumentversand.
- Anmeldung, Abmeldung, abgelaufene Session und falsches Passwort.
- Kundenimport mit Feldzuordnung, Vorschau, Duplikaten, Warnungen und
  Teilfehlern.
- Kernablauf: Angebot, Auftrag, Zeiterfassung, Rechnung, Teilzahlung und
  Mahnung.
- Wiederkehrende Aufträge und Rechnungen einschließlich Verlauf.
- Belegupload mit OCR-Vorschlägen, Korrektur, Übernahme in die EÜR und
  Stornierung.
- Anlagen, Steuerübersicht, Rechnungsjournal sowie PDF- und CSV-Exporte.
- Ansichten auf Desktop, Tablet und Mobilgerät in hellem und dunklem Modus.
- Konto- und Workspace-Löschung mit Prüfung von richtigem und falschem
  Passwort.
- Stichproben mit einem offiziellen KOSIT-Validator für XRechnung sowie einer
  Prüfung von Factur-X/ZUGFeRD.

Automatisierte Tests ersetzen die manuelle Abnahme dieser Abläufe nicht.

## Hosting für die Beta

Die Demo unter `demo.solooffice.de` bleibt eine separate Demo-Umgebung. Dort
werden Authentifizierung, Rollen und Workspaces im Demo-Modus simuliert. Sie
ist nicht für echte Beta-Daten oder mehrere unabhängige Unternehmen geeignet.

Für jeden Beta-Zugang sollte eine eigene echte Instanz bereitgestellt werden:

- `VITE_DEMO_MODE=false`
- HTTPS/TLS und `COOKIE_SECURE=true`
- exakt gesetztes `CORS_ORIGIN` und `APP_BASE_URL`
- Registrierung auf `invite-only`
- funktionierendes SMTP
- geprüfte Backups außerhalb des Containers und ein Restore-Test
- Healthcheck, Logs und eine einfache Überwachung
- getrennte Zugangsdaten und ein eigener Datenbestand pro Beta-Instanz

Der erste Beta-Rollout erfolgt erst, wenn CI grün ist und die Kernabläufe auf
dem Zielserver mit genau dem ausgelieferten Commit geprüft wurden.

## Bekannte Grenzen

SoloOffice übermittelt keine Steuerdaten an ELSTER. OCR-Ergebnisse sind
Vorschläge und müssen geprüft werden. Steuerübersichten, EÜR und
Abschreibungen sind vorbereitende Arbeitsunterlagen. Lokale E-Rechnungsprüfungen
ersetzen keine offizielle Validierung. Diese Grenzen müssen bei der Einladung
und im Beta-Feedback berücksichtigt werden.

## Release-Schritte

1. Versionsänderungen und diese Dokumentation prüfen.
2. Einen lokalen Commit für `v0.8.2` erstellen und den Tag `v0.8.2` setzen.
3. Commit und Tag zu GitHub übertragen.
4. CI und Quality-Workflow abwarten.
5. Den exakten Commit auf dem Zielserver aktualisieren und den Smoke-Test
   durchführen.

Der vorhandene Update-Ablauf liegt unter
`deploy/solooffice-update-all.sh`. Dieser Versionsschritt erstellt weder einen
Remote-Release noch einen Server-Deploy automatisch.
