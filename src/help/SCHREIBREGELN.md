# Schreibregeln für Hilfeartikel

Die Hilfe besteht aus typisierten Daten (`types.ts`). Jede Kategorie hat eine Datei in `articles/<kategorie-id>.ts`, die `HelpArticle[]` exportiert. Bearbeiten Sie nur Ihre Datei. Neue Artikel in `begriffe.ts` und `erste-schritte.ts` dienen als Vorlage.

## Zielgruppe und Ton
- Leser sind Selbständige ohne Buchhaltungswissen. Fachwörter erklären Sie beim ersten Auftreten in einem Halbsatz.
- Sprechen Sie mit „Sie“. Schreiben Sie kurze Sätze, aktiv und konkret.
- Nicht gendern, keine Gedankenstriche als Stilmittel, keine Emojis, echte Umlaute.

## Aufbau eines Artikels (150 bis 400 Wörter)
1. `title` (höchstens 70 Zeichen) und `summary` (ein Satz).
2. Ein Absatz: wozu dient das, wann brauchen Sie es.
3. Ein `steps`-Block mit Schritten, je Schritt eine Handlung.
4. `note`-Blöcke für Hinweise (`info`), Stolperfallen (`warning`) und Tipps (`tip`).
5. Optional `link`-Blöcke in die App und `related` mit Ids verwandter Artikel.
- `keywords`: Wörter, die Leser tippen würden, auch Alltagsbegriffe und Schreibvarianten.
- `id` in kebab-case, stabil, ändert sich nie (sie steht in der Adresse `#help/<id>`).
- `requires` nur setzen, wenn der Artikel ein Modul voraussetzt (`jobs`, `quotes`, `vat`).

## Schaltflächen und Menüpunkte
- Schreiben Sie sie wörtlich wie in der Oberfläche und fett: `**Neue Rechnung**`. Das ist die einzige erlaubte Auszeichnung.
- Bei Aufträgen und Kunden gilt der Begriff des Terminologieprofils. Wählen Sie neutrale Worte oder „Auftrag“.

## Wahrheit
- Prüfen Sie jede Aussage am Code oder im Demo-Modus. Beschreiben Sie nichts, was es nicht gibt.
- Steuerliche Aussagen formulieren Sie vorsichtig und nennen die Rechtsgrundlage nur, wenn sie sicher ist. Fügen Sie einen Hinweis an, dass SoloOffice keine Steuerberatung ersetzt.
- Ist ein Ablauf noch im Umbau, formulieren Sie allgemein („wird vorbelegt und bleibt änderbar“).

## Test ausführen
```
node node_modules/typescript/bin/tsc -p tsconfig.frontend-tests.json && node --test test/frontend/helpContent.test.mjs
```
Der Test prüft eindeutige Ids, `related`, gültige Link-Ziele, leere Texte, ungepaarte `**`, Titellänge und Schlagwörter.
