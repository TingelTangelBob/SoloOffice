# Identity und Workspace lokal testen

Die Authentifizierung bleibt vollständig lokal testbar. Es wird keine externe Identitätsplattform benötigt. PostgreSQL, Backend und Frontend laufen weiterhin über Docker Compose.

## Demo-Modus

Wenn `.env.local` `VITE_DEMO_MODE=true` enthält, läuft die Oberfläche ohne Backend. Workspaces und ihre Demo-Daten werden lokal im Browser gespeichert und können für UI-Tests angelegt und gewechselt werden. Anmeldung, echte Benutzer, Rollenrechte und serverseitige Datenisolation sind in diesem Modus nur simuliert.

Für den vollständigen Multiuser-Test `VITE_DEMO_MODE` entfernen oder auf `false` setzen und die Docker-Instanz starten.

## Start

Für eine neue Instanz:

```bash
./deploy-instance.sh
```

Das Skript erzeugt zusätzlich `CORS_ORIGIN` und `COOKIE_SECURE=false`. Für einen lokalen HTTP-Test bleibt das Session-Cookie dadurch funktionsfähig. Bei HTTPS hinter einem Reverse Proxy muss `COOKIE_SECURE=true` gesetzt und `CORS_ORIGIN` auf die echte Frontend-Adresse geändert werden.

Wenn Frontend und Backend auf unterschiedlichen Sites liegen, `COOKIE_SAME_SITE=none` zusammen mit `COOKIE_SECURE=true` verwenden.

## Erster Durchlauf

1. Frontend öffnen.
2. Ein Konto registrieren.
3. Prüfen, dass das Firmenprofil leer bzw. onboardingbereit ist und keine Fantasiedaten als echte Firmendaten erscheinen.
4. Im Profil einen zweiten Workspace anlegen und zwischen beiden Workspaces wechseln.
5. Einen Mitarbeiter mit Rolle `Mitarbeiter`, `Nur lesen` oder `Admin` einladen.
6. Mit einem zweiten Browser/Inkognito-Fenster den Einladungslink öffnen und das Konto anlegen.
7. Mit `Nur lesen` anmelden und prüfen, dass Schreibaktionen abgelehnt werden.
8. Im ersten Workspace einen Datensatz anlegen und verifizieren, dass er im zweiten Workspace nicht erscheint.
9. Mit aktivierter SMTP-Testumgebung eine Einladungs-, Verifikations- und Passwort-Reset-Mail auslösen; Token dürfen nicht standardmäßig in der API-Antwort erscheinen.
10. Einen workspacebezogenen Backup- und Restore-Lauf durchführen und prüfen, dass Daten eines zweiten Workspaces unverändert bleiben.
11. Konto-/Workspace-Löschung mit falschem und richtigem aktuellem Passwort prüfen.

## Wichtige Sicherheitsprüfung

- Session-Cookies sind HttpOnly und enthalten nur ein zufälliges Token; in der Datenbank liegt ausschließlich dessen SHA-256-Hash.
- Passwörter werden mit scrypt und individuellem Salt gespeichert.
- PostgreSQL erzwingt die aktive Workspace-Zuordnung über Row-Level Security.
- Restore-Funktionen löschen und schreiben jetzt nur den aktiven Workspace. Dieser Schutz muss mit zwei Workspaces praktisch bestätigt werden.
