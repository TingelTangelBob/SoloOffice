# Wiedervorlage: manuelle Release-Prüfung

**Stand:** 2026-08-28
**Status:** vor dem nächsten öffentlichen Release erneut vorlegen
**Verantwortung:** gemeinsame Prüfung mit dem Nutzer

> Erinnerung für jeden Agenten: Beim nächsten Projektstand ausdrücklich sagen,
> dass diese manuelle Abnahme noch ansteht. Kein Haken ohne Datum und kurzen
> Nachweis setzen.

## Bereits manuell bestanden

- [x] Zwei Konten in getrennten Browserkontexten verwenden.
- [x] Getrennte Workspaces, Firmendaten und Kunden nachweisen.
- [x] Kunde aus Workspace A bleibt in Workspace B unsichtbar.
- [x] Einladung und Rollen im gemeinsamen Workspace prüfen.
- [x] Workspacebezogenen ZIP-Restore durchführen; zweiter Workspace bleibt
  unverändert.
- [x] Lokale Zeitzone in neuen Backup-Dateinamen prüfen.

Nachweise: [RLS-Isolation](rls-isolation-nachweis.md) und
[Backup/Restore](backup-restore-nachweis.md).

## Noch manuell zu prüfen

- [ ] SMTP mit echter Testdomain: Einladung, E-Mail-Verifikation,
  Passwort-Zurücksetzung und Dokumentversand einschließlich Zustellung.
- [ ] Registrierung, Login und Logout einschließlich abgelaufener Sitzung und
  falschem Passwort einmal vollständig durchspielen.
- [ ] Kundenimport mit Feldzuordnung, Vorschau, Dublette, Warnung, Teilfehler
  und Ergebnisprotokoll.
- [ ] Angebot → Auftrag → Zeiterfassung → Rechnung → Teilzahlung → Mahnung als
  zusammenhängenden Fachablauf prüfen.
- [ ] Wiederkehrende Rechnung und wiederkehrenden Auftrag mindestens einmal
  ausführen und Verlauf prüfen.
- [ ] Repräsentativen PDF-/Bildbeleg hochladen, OCR-Vorschläge korrigieren, in
  die EÜR übernehmen und anschließend stornieren.
- [ ] Anlagenverzeichnis, Steuerübersicht, Rechnungsjournal und PDF-/CSV-Export
  mit plausiblen Testwerten prüfen.
- [ ] Kernansichten auf Desktop, Tablet und Mobilgerät in hellem und dunklem
  Modus prüfen; besonders Navigation, Tabellen, Kalender und lange Dialoge.
- [ ] Konto-/Workspace-Löschung mit falschem und richtigem Passwort prüfen.
- [ ] Erzeugte E-Rechnungsfälle extern mit KOSIT und FeRD/Factur-X validieren;
  dies ist ein fachlicher Release-Nachweis, kein normaler UI-Test.

## Abschlussregel

Die Liste gilt erst als erledigt, wenn jeder offene Punkt ein Datum, die
getestete Version bzw. den Commit und ein kurzes Ergebnis erhalten hat.
Automatisierte Builds oder Unit-Tests ersetzen diese Abnahme ausdrücklich
nicht.
