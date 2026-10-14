# Aktueller Stand SoloOffice

**Stand:** 2026-10-04  
**Fachapp:** `main` · `e72685f4685aeebfc40a6f22941130dd8ed2bf17` · `v0.9.4-21-ge72685f`  
**Arbeitsbaum:** sauber; `main` und gespeicherte Referenz `origin/main` zeigen auf denselben Commit. Kein Fetch, daher keine Aussage zum tatsächlichen Remote-Stand.

## Produktstand

SoloOffice ist eine deutschsprachige Fachanwendung für Rechnungen, Angebote, Aufträge, E-Rechnungen und vorbereitende Buchhaltung. Der aktuelle Code enthält unter anderem lokale OCR, EÜR, Anlagen, Workspace-/Rollenverwaltung, Datenübernahme sowie die technischen Grundlagen für einen SaaS-Betrieb. Der Stand ist weiterhin Beta `0.9.4`; ein öffentlicher Hosted-/SaaS-Launch ist nicht freigegeben. Die Versionsnummer wurde seit dem Release nicht erhöht.

Seit dem in älteren Dokumenten genannten Commit `73b1756` kamen 7 Commits hinzu. Sichtbare jüngere Änderungen umfassen Verbesserungen für mobile Suche und Overlay-Scroll, die Ersteinrichtung und Datenübernahme sowie eine gehärtete `braces`-Abhängigkeit und stabilisierte parallele Migration-Session-Tests. Der Migrationsbestand reicht bis 048; die Migrationen 045–048 ergänzen Workspace-Einrichtung, Migration-Sessions, Kategorien und die Motion-Einstellung.

## Prüfung und Nachweisgrenzen

- Git: lokal sauber auf `main`; `origin/main` ist nur die gespeicherte Referenz. Netzwerkzugriff, aktueller GitHub-CI-Status und Live-Revision wurden nicht geprüft.
- Code/Dokumentation: lokaler HEAD, Commitverlauf, Migrationen sowie README, Launch-Must-Liste, manuelle Release-Checkliste und Testdokumentation wurden eingesehen.
- Tests/Build: in diesem Audit nicht ausgeführt. Vorhandene Zahlen in `docs/automated-tests.md` gelten für den älteren Stand `73b1756`; sie sind keine Aussage über aktuelle Testläufe oder den neuesten Zählstand.
- Staging: der dokumentierte technische Laufzeitnachweis ist historisch und bezieht sich auf `b6c6bb2` vom 23.09.2026. Er belegt nicht den aktuellen HEAD. Der fachliche Import-Smoke bleibt offen.
- Die manuelle Release-Checkliste nennt 13 offene Prüfpunkte; diese wurden hier nicht erneut manuell geprüft oder abgehakt.

## Wichtigste offene Punkte

1. **Manuelle Fachabnahme und Datenübernahme:** offene Punkte aus `docs/manual-release-checklist.md`, besonders echte SMTP-Zustellung, vollständiger Import-Smoke mit PostgreSQL und `.xlsx`, Fachabläufe, OCR/EÜR, Responsive-Prüfung und externe E-Rechnungsvalidierung.
2. **SaaS-Freigabe und gemeinsamer Control-Plane-Ablauf:** Betreiber-/Rechtsfreigaben, Stripe-/Tarif-E2E, sowie gemeinsamer Workspace-Export und Löschung sind laut `docs/launch-must.md` nicht nachgewiesen.
3. **Aktueller Produktions- und Buildnachweis:** CI für HEAD, aktueller Staging-Stand und Betriebsnachweise wie Offsite-Backup, Überwachung/Alarmierung und Rückfallplan fehlen in diesem Audit.

## URLs und Umgebungen

- **Test:** gemeinsamer LAN-Testserver auf Port `8090` laut Projekteinstieg. Die konkrete Serveradresse liegt in der zentralen Serververwaltung außerhalb des hier verfügbaren Projektpfads und wurde nicht verifiziert; daher ist keine vollständige Test-URL belastbar.
- **Live:** `https://solooffice.de` ist die öffentliche Landingpage, nicht als Live-Fachapp belegt. Ein öffentlicher SaaS-App-Endpunkt ist in den geprüften Fachapp-Dokumenten nicht freigegeben.
- **Demo:** `https://demo.solooffice.de` (laut README und Demo-Server-Dokumentation; in diesem Audit nicht live abgerufen).

## Abgrenzung zum Parent-Ordner

Der Parent enthält neben der Fachapp eine separate Landingpage und ein separates Control-Plane-Repository. Beim Audit waren beide ebenfalls auf `main`; die Landingpage stand auf `e86bd43` und hatte uncommittete Änderungen. Das Control Plane stand auf `8f27a30`. Diese Schwester-Repositories wurden nicht verändert. Die im Parent liegende Go-Live-Statustafel datiert auf 25.09.2026 und beschreibt selbst veraltete/ historische Fortschrittsnachweise; sie ist keine aktuelle Live-Verifikation.

## Maßgebliche nächste Schritte

Manuelle Release-Checkliste und Launch-Must-Liste vor einem öffentlichen Release wieder aufnehmen. Bestehende Haken nicht erneut prüfen und keinen offenen Haken ohne Datum, Commit und Ergebnis schließen. Siehe [`manual-release-checklist.md`](manual-release-checklist.md), [`launch-must.md`](launch-must.md) und [`CONTEXT.md`](../CONTEXT.md).
