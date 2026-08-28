# Node- und npm-Abhängigkeitssicherheit

**Stand:** 2026-08-28

**Status:** Audit bestanden und in GitHub Actions erzwungen

SoloOffice installiert Frontend- und Backend-Pakete ausschließlich aus den
eingecheckten Lockdateien mit `npm ci`. Die Docker-Builds verwenden Node.js 22.
Das Frontend nennt zusätzlich die gemeinsame Laufzeitgrenze von Vite und
ESLint in `package.json` (Node.js 20.19, 22.13 oder ab 24); das produktive
Backend verlangt mindestens Node.js 22.12.

## Bereinigter Ausgangsbefund

Die alte Frontend-Lockdatei enthielt 18 bekannte npm-Befunde: 2 niedrige,
5 mittlere und 11 hohe. Davon lagen 17 im Build-/Lint-Baum. Ein mittlerer
DOMPurify-Befund war über jsPDF auch im produktiven Baum vorhanden.

Die Lockdatei wurde innerhalb der vorhandenen Versionsbereiche vollständig
aktualisiert. Zusätzlich wurden Vite 5 auf Vite 8,
`@vitejs/plugin-react` 4 auf 6 und ESLint 9 auf 10 angehoben. Im Backend wurde
PDFKit 0.14 durch 0.20 ersetzt; dadurch entfällt das nicht mehr gepflegte
`crypto-js`. Danach melden die aktuellen Audits:

```text
Frontend vollständig: 0 bekannte Schwachstellen
Frontend produktiv:    0 bekannte Schwachstellen
Backend produktiv:     0 bekannte Schwachstellen
```

Test, ESLint, TypeScript-Prüfung und Produktionsbuild laufen nach der
Aktualisierung weiterhin im Frontend-Image. Die beiden etablierten
React-Hooks-Regeln bleiben explizit aktiv; die zusätzlichen optionalen
React-Compiler-Regeln von `eslint-plugin-react-hooks` werden erst in einem
getrennten Refactoring aktiviert. Das Backend-Image führt seine
Regressionssuite einschließlich echter PDFKit-Ausgabe ebenfalls unter
Node.js 22 aus.

## Lokale und CI-Prüfung

```bash
npm run audit:dependencies
npm --prefix backend run audit:dependencies
```

Der Frontend-Befehl blockiert hohe und kritische Befunde im vollständigen
Abhängigkeitsbaum. Für den produktiven Frontend-Baum blockiert er bereits ab
mittlerer Kritikalität. Der Backend-Befehl prüft den produktiven Baum ebenfalls
ab mittlerer Kritikalität. GitHub Actions führt beide Befehle vor den
Image-Builds aus.

## Grenzen

`npm audit` bewertet veröffentlichte Hinweise aus dem npm-Register. Ein heute
grüner Lauf schließt unbekannte Schwachstellen nicht aus und kann durch einen
neu veröffentlichten Hinweis ohne Quellcodeänderung später fehlschlagen.
Container-Basisimages, Alpine-Pakete, Browser und PostgreSQL brauchen getrennte
Aktualisierung und Prüfung. Der bewegliche Tag `node:22-alpine` liefert bei
einem Neubau Sicherheitsupdates, ist aber kein bytegenau reproduzierbarer
Digest-Pin.
