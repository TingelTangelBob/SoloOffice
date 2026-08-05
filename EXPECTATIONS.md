# Erwartungen an die Zusammenarbeit

Diese Datei beschreibt die Arbeits- und Qualitätsmaßstäbe für die Weiterentwicklung von SoloOffice. Sie ergänzt konkrete Aufgaben und ersetzt keine fachlichen Entscheidungen.

## 1. Erst verstehen, dann umsetzen

- Vor nichttrivialen Änderungen den betroffenen Fachbereich vollständig verfolgen: gerenderte Seite, Varianten, Navigation, gemeinsame Komponenten, globale Styles, Breakpoints, Zustand, API, Typen, Demo-API, Backend, Datenbank, Berechtigungen und Deployment.
- Kurz Zielbild, Annahmen, offene Entscheidungen und überprüfbare Erfolgskriterien nennen. Bei aktuellen Bibliotheken, Standards, Lizenzen oder rechtlich sensiblen Themen recherchieren und Primärquellen bevorzugen.
- Fehlende Schritte eines vollständigen Ablaufs selbst erkennen und ergänzen. Fachliche, steuerliche oder rechtliche Regeln niemals stillschweigend erfinden; Unsicherheiten als Produktentscheidung markieren.

## 2. Vollständige, integrierte Lösung

- Beauftragte Funktionen werden im bestehenden Projekt end-to-end umgesetzt: UI, Zustände, Validierung, Fehlermeldungen, Persistenz, API, Migrationen, Rechte, Folgeaktionen, Backups und Demo-/Local-Testing müssen zusammenpassen.
- Keine reine Oberfläche, leere Zielseite, wirkungslose Einstellung, Scheinvorschau oder simulierte Sicherheit als fertiges Ergebnis abgeben.
- Neue Funktionen in bestehende Terminologie, Designsysteme und Architektur integrieren. Wiederkehrende Muster gemeinsam lösen und betroffene Ansichten systematisch mitziehen.
- Demo-Modus und produktiver Backend-Modus klar trennen. Authentifizierung, Workspace-Isolation und Rollen müssen im produktiven Modus tatsächlich sicher sein; Demo-Verhalten darf dies nicht vortäuschen.
- Importe brauchen, soweit fachlich sinnvoll, Feldzuordnung, Vorschau, Validierung, Warnungen, Duplikatbehandlung, Teilfehler und ein nachvollziehbares Ergebnisprotokoll.

## 3. Bestand schützen, Änderungen fokussieren

- Unabhängige Working-Tree-Änderungen anderer Agents gehören dem Nutzer und bleiben erhalten. Keine unaufgeforderten Rücksetzungen, breiten Refactorings oder Änderungen außerhalb des Auftrags.
- Nur direkt relevante Bereiche anfassen; direkt betroffene doppelte oder widersprüchliche Implementierungen dürfen zusammengeführt werden.
- Bei Datenmodelländerungen immer Migration, API, Typen, Demo-API, Berechtigungen sowie Backup/Restore gemeinsam prüfen.

## 4. Visuelles Zielbild und UX

- Screenshots und konkrete Rückmeldungen sind verbindliche Referenzen für Positionen, Größen, Abstände, Rahmen, Farben, Hierarchie und Zustände. Bei Abweichungen den tatsächlich gerenderten Pfad, globale CSS-Regeln und mögliche doppelte Renderstellen untersuchen.
- SoloOffice soll ruhig, kompakt und professionell wirken: vorhandenen Platz sinnvoll nutzen, keine unnötigen Boxen, Badges, Symbole oder Hilfstexte ergänzen und keine Inhalte abschneiden.
- Bestehende Buttons, Tabellen, Aktionsmenüs, Hinweise, Dialoge und Farbvariablen wiederverwenden. Primärfarbe, Statusfarben, Auswahlzustände und Icon-Buttons müssen global konsistent bleiben; unbeabsichtigte hardcodierte Blautöne vermeiden.
- Text darf nicht an Ober-/Unterlängen, Rahmen oder Nachbarelementen abgeschnitten werden. Zeilenumbrüche, Symbole, Labels und Rahmen müssen sauber ausgerichtet sein. Native Browserdialoge sind kein Ersatz für gestaltete Produktdialoge.
- Dialoge bleiben im Viewport: Overlay klar sichtbar, Header und Footer erreichbar, nur der Inhaltsbereich scrollt, Aktionen funktionieren mit Maus, Tastatur und Touch. Fokus, Abbrechen, Schließen, Speichern und Vorschau mitprüfen.
- Einstellungen, Vorlagen und Fachsprache müssen wirksam sein: keine doppelte Unternehmensdatenpflege, realistische und unterscheidbare PDF-Vorschauen, nachvollziehbare Layoutoptionen, korrekter Änderungsstatus und produktweit konsistente Begriffe. „Belege“ bleibt der Standardbegriff, sofern keine gebräuchliche Alternative vorgegeben ist.

## 5. Responsive und interaktive Zustände

- Desktop, Tablet und Mobile sowie Hell- und Dunkelmodus gleichwertig prüfen. Tablet ist kein vergrößertes Mobile-Layout.
- Keine vermeidbare horizontale Überbreite: Primärdaten bleiben sichtbar, sekundäre Inhalte werden zuerst gekürzt oder kompakt dargestellt, Aktionen bleiben erreichbar.
- Navigation, Seitenleisten und Tab-/Sticky-Bereiche dürfen sich nicht überblenden. Jeder Menüpunkt muss eine funktionierende, fertige Zielansicht öffnen; aktive Haupt- und Unterpunkte müssen korrekt auf- und zuklappbar sein.
- Alle relevanten Zustände mitdenken: leer/voll, Auswahl/Mehrfachauswahl, offene/geschlossene Menüs, oberstes/unterstes Listenelement, Scroll/Overflow, Dialog mit/ohne Änderungen und unterschiedliche Fensterbreiten.
- Tabellen behalten relevante Spalten so lange wie sinnvoll. Kalenderinformationen werden stufenweise verdichtet: vollständige Metadaten bei viel Platz, kompakte Angaben bei mittlerem Platz, Titel bzw. Indikator bei sehr wenig Platz. Kalender-Scroll, fixierte Überschriften, 15-Minuten-Raster, Drag-and-drop sowie Klick-/Doppelklickzustände müssen funktionieren.

## 6. Fachlich sensible Bereiche

- OCR liefert ausschließlich prüfbare Vorschläge; keine automatische steuerliche Buchung ohne sichtbare Bestätigung.
- Belegverarbeitung bleibt standardmäßig lokal. Ein Wechsel der OCR-Engine braucht einen reproduzierbaren Vergleich mit anonymisierten Belegen und eine Prüfung von Qualität, Ressourcen, Offline-Fähigkeit, Docker-Integration, Modellpflege und Lizenzen. Tesseract bleibt CPU-/Offline-Fallback.
- EÜR, Steuerprofile, Anlagen und Reports sind vorbereitende Arbeitsunterlagen. ELSTER oder externe Dienste werden erst nach bewusster Produkt-, Datenschutz- und Rechtsprüfung umgesetzt.

## 7. Verifikation und Übergabe

- Nach Änderungen mindestens relevante technische Prüfungen ausführen: ESLint für betroffene Frontend-Dateien, TypeScript/Build soweit möglich, `git diff --check` und bei Backend-/Datenänderungen Migrationen gegen eine Testdatenbank.
- Bei visuellen oder interaktiven Änderungen zusätzlich gezielt Desktop-, Tablet- und Mobile-Zustände sowie hellen und dunklen Modus prüfen; bei Dialogen Overlay, Scrollbereich, Header/Footer, Fokus und Aktionen.
- Technische und manuelle Prüfung strikt getrennt berichten. Build, TypeScript oder Lint beweisen keine visuelle oder interaktive Korrektheit. Nicht durchgeführte Prüfungen und Umgebungsblocker offen nennen.
- Übergabe auf Deutsch, direkt und lösungsorientiert: zuerst Ergebnis, dann wichtigste Änderungen, tatsächlich ausgeführte Prüfungen, offene Risiken und Folgeaufgaben. Bei Fehlern Ursache und vollständigen Interaktions-/Datenpfad erklären, nicht nur Symptome oder weitere CSS-Ausnahmen liefern.

## Arbeitsstil

Gründlich und produktionsnah arbeiten, aber fokussiert bleiben. Ziel ist eine nachvollziehbare, integrierte Änderung mit möglichst wenig Rückfragen und Iterationen – ohne Annahmen zu verstecken oder Qualität durch unnötige Komplexität zu erkaufen.
