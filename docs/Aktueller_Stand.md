# Aktueller Stand SoloOffice

**Stand:** 2026-10-23
**Release:** Beta `v0.9.11b`, interne Build-Version `0.9.11`
**Release-Seite:** [SoloOffice v0.9.11b](https://github.com/TingelTangelBob/SoloOffice/releases/tag/v0.9.11b)

Diese Beta führt den geprüften Kandidaten und den veröffentlichten Vite-Patch
von `main` (`c5774f6`) zusammen. Die Veröffentlichung und das Ausrollen sind für
Staging, Demo und Landingpage beauftragt. Der tatsächliche Betriebsnachweis wird
nach dem jeweiligen Rollout getrennt gesichert; die Versionsangabe allein ist
kein Nachweis einer erfolgreichen Aktualisierung.
Der ursprüngliche lokale Arbeitsbestand wurde erhalten und um die geprüften
Korrekturen ergänzt; die Editor-Swapdatei gehört nicht zum Release.

## Inhalt der Beta

[Release Notes v0.9.11b](releases/v0.9.11b.md) und [Changelog](../CHANGELOG.md)
beschreiben den Umfang: gemeinsame PDF-Designs und Vorschau,
verlässlicher Vorlagen-Autosave, wirksamer Textreset, Seitenumbrüche für lange
Dokumentinhalte, gemeinsame Logo-Aufbereitung, Schutz bei Sitzungswechseln,
konsistente Reporting-Filter und Währungen sowie kompaktere Listen und Dialoge.

Die Landingpage-Versionsangabe wird mit derselben Beta synchronisiert. Ihre
älteren Produktaufnahmen wurden nicht erneuert und bleiben im Landingpage-README
datiert. Der separate Control-Plane-Fix korrigiert die Stripe-UGX-Umrechnung.

## Technische Prüfung

Die Prüfungen erfolgen auf dem vorgesehenen LAN-Testserver in eigenen temporären
Docker-Ressourcen. Laufende Staging-, Demo- und Fremdprojekt-Instanzen werden dabei
nicht aktualisiert. Vollständige Protokolle und der genaue geprüfte Commit werden
im Abschlussnachweis unter `107_SoloOffice/tmp/release-fixes-20261022/` im gemeinsamen
Projektordner gesichert.

- Frontend-Regressionssuite, ESLint, TypeScript und Vite-Produktionsbuild.
- Backend-Unit-Tests und Produktionsimage.
- Verpflichtende Frontend-/Backend-Abhängigkeits-Audits.
- Migrationen und Workspace-RLS gegen eine frische PostgreSQL-15-Datenbank.
- Vollständige isolierte Compose-Laufzeitprüfung samt Health, Proxy, Migrationen,
  Rollenentmachtung und Image-Provenienz.
- Echte jsPDF-Regressionen für Normalfälle, lange Positionen, Zahlungsblöcke,
  Signaturen und gemeinsame normalisierte Bildquellen.
- Separater Control-Plane-Kennzahlenlauf und Landingpage-Docker-Build.

Der CSS-Parser wird gezielt auf 7.1.7 überschrieben; Tailwind bleibt auf Version 3.
Der Kompatibilitätstest prüft Verschachtelung, responsive und beliebige Varianten
sowie `@apply`. DOMPurify steht auf 3.4.17, Vite auf 8.3.5.

Ein vollständiger neuer Browserdurchlauf auf allen Gerätebreiten und Themes
sowie die tatsächliche Browser-Canvas-Rasterisierung bleiben gesonderte manuelle
Nachweise. Der automatische PDF-Test injiziert den Browser-Decoder/Canvas und
prüft anschließend echte jsPDF-Dokumente mit dem PDF-Parser. Er ersetzt keinen
Browser-Decoder-Test. Die größeren Vite-Chunks bleiben ein nicht blockierender
Buildhinweis.

## Umgebungen und offene Freigaben

- `solooffice.de`: öffentliche Landingpage, gemeinsam mit dieser Beta zu aktualisieren.
- `app.staging.solooffice.de`: Ziel für Build `0.9.11`; vor diesem Rollout zuletzt als `0.9.10` / `c5774f6` geprüft.
- `demo.solooffice.de`: Demo, kein produktiver SaaS-Endpunkt.
- Die [manuelle Release-Checkliste](manual-release-checklist.md) hat weiterhin
  **13 offene Punkte**. Bestehende Haken bleiben erhalten; ohne Datum und
  Nachweis werden keine weiteren Haken gesetzt.
- Reale Mailzustellung, vollständige Fachabläufe, externe E-Rechnungsvalidierung
  sowie die vorgesehenen Rechts- und Betriebsfreigaben bleiben gesondert offen.
- Offsite-Backup, externe Überwachung und Rückfallplan für den Gesamtbetrieb
  sind durch einen lokalen Teststack nicht nachgewiesen.

Weiterhin Beta unter v1; keine öffentliche Hosted-/SaaS-Freigabe.
