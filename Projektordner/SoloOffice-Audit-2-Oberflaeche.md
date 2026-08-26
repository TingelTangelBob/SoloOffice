# SoloOffice – Audit 2: Oberfläche & Laufzeit

- **Stand:** 2026-08-07
- **Geprüfter Commit:** `de9021f` als Ausgangsanalyse
- **Status:** Überholt – aktuelle Browserabnahme steht in der Go-Live-Statustafel

**Methode:** Laufzeitprüfung der echten Oberfläche im Browser
**Zweck:** Zustand der Oberfläche vor dem Erstellen der Landingpage-Screenshots und dem Einbinden der Live-Demo.

> **Umsetzungsstand (2026-08-07):** Die Punkte O-1 bis O-25 wurden im Arbeitsstand umgesetzt. ✅ steht für umgesetzt; 🟠 markiert Prüfungen, die ohne Docker/Browser offen bleiben.

> **Teil 2 von 2.** Backend, Datenbank, E-Rechnung, Deployment und Lizenz stehen in **[`SoloOffice-Audit-1-Code-und-Architektur.md`](SoloOffice-Audit-1-Code-und-Architektur.md)**.

---

## 1. Aufbau der Prüfung

Docker ist auf dem Prüfrechner nicht installiert. Die Prüfung lief deshalb über den **Demo-Modus**, der ohne Backend und ohne Datenbank auskommt:

```bash
npm ci
# .env.local mit VITE_DEMO_MODE=true
npm run dev -- --port 5173
```

| | |
|---|---|
| Browser | Chrome, `devicePixelRatio` 2 |
| Breiten | Desktop 1440×900, Mobil 375×812 |
| Farbschemata | hell und dunkel (über `prefers-color-scheme`) |
| Geprüfte Bereiche | Übersicht, Rechnungen, Angebote, Angebotseditor, Rechnungseditor, Belege, Auswertungen, Einstellungen |

Befunde wurden nicht nach Augenschein festgehalten, sondern über `getComputedStyle` und DOM-Auswertung im laufenden Dokument gemessen.

### Prüfkriterien

| # | Kriterium |
|---|---|
| O1 | **Lesbarkeit und Kontrast** in hell *und* dunkel (Ziel: WCAG AA, 4,5:1 für Fließtext) |
| O2 | **Responsive-Verhalten** – kein horizontaler Überlauf, sinnvolle Verdichtung statt Schrumpfen |
| O3 | **Datenkorrektheit in der Anzeige** – keine `NaN`, `undefined`, leeren Platzhalter |
| O4 | **Sprachliche Konsistenz** – Hinweistexte müssen zu den tatsächlichen Bedienelementen passen |
| O5 | **Interaktionskonsistenz** – gleiche Information verhält sich überall gleich |
| O6 | **Demo-Tauglichkeit** – taugt der Demo-Modus als öffentliche Live-Demo? |
| O7 | **Abhängigkeiten** – bekannte Schwachstellen im Paketbaum |

### Was nicht geprüft wurde

- **Tablet-Breakpoint (768–1024 px)** – nicht geprüft. `EXPECTATIONS.md` §5 verlangt ihn ausdrücklich als eigenständigen Zustand („Tablet ist kein vergrößertes Mobile-Layout"). **Offen.**
- **Eingeklappte Seitenleiste** – nicht geprüft, siehe Verdachtspunkt unten.
- **Kalender** (Drag-and-drop, 15-Minuten-Raster, fixierte Überschriften) – nicht geprüft.
- **Alles, was ein Backend braucht**: echte OCR, E-Mail-Versand, PDF-Erzeugung mit echten Daten, Backup/Restore, Login, Workspace-Wechsel, Rollenrechte, Import.
- Kein Screenreader-Test, keine vollständige Tastaturbedienung.

---

## 2. Gesamteindruck: besser als erwartet

Die aktuelle Oberfläche ist ruhig, dicht und wirkt professionell – sie hat mit den veralteten belego-Screenshots im Repository (Audit 1, D4) wenig gemein. Tabellen, Statusbadges, Filterleisten und Aktionsmenüs sind über die Bereiche hinweg konsistent. **Der Qualitätsanspruch aus `EXPECTATIONS.md` ist sichtbar umgesetzt.**

Für die Landingpage ist das gutes Material – nach Behebung von O-1.

### Ausdrücklich bestätigt

- **„Mobile-First" stimmt.** Bei 375 px werden Tabellen nicht geschrumpft, sondern in Karten umgebaut (Rechnungsnummer, Kunde, Betrag, Datum untereinander). Hamburger-Navigation, große Touch-Ziele. Gemessen: `scrollWidth == clientWidth == 375` – **kein horizontaler Überlauf**. Der Claim darf auf die Landingpage.
- **Der Dunkelmodus funktioniert auf den meisten Seiten einwandfrei.** Auswertungen, Rechnungslisten, Navigation, Tabellen und Formulare sind vollständig lesbar. Das Problem ist eng begrenzt (O-1).
- **Die Terminologieprofile** (Kunden / Mandanten / Patienten / Schüler·Träger / Klienten) sind in den Einstellungen mit Live-Vorschaukarten umgesetzt. Das ist ein starkes, sofort vorzeigbares Alleinstellungsmerkmal – und war aus dem Quelltext allein nicht in seiner Wirkung erkennbar.
- **Der Demo-Modus weist sich offen als solcher aus** („Lokaler Demo-Modus – Testdaten und Änderungen werden nur in diesem Browser gespeichert", mit „Testdaten neu laden" und „Demo-Daten löschen"). Das ist genau die Trennung, die `EXPECTATIONS.md` §2 verlangt.

| Schweregrad | Anzahl |
|---|---|
| Hoch | 1 |
| Mittel | 3 |
| Niedrig | 2 |

---

## ✅ O-1 · HOCH · Dunkelmodus: Text auf Gradient-Flächen ist unlesbar

> ✅ **Umsetzung:** Gradient-Flächen verwenden jetzt gekoppelte, semantische Farbvariablen für Hintergrund, Text und Rahmen. Die Werte werden für Hell- und Dunkelmodus gemeinsam gesetzt, statt einzelne Tailwind-Farbklassen nachträglich zu überschreiben.

**Der schwerwiegendste Oberflächenfehler. Die Ursache ist strukturell, nicht kosmetisch.**

### Mechanismus

Der Dunkelmodus wird in `src/components/DynamicColors.tsx:217-340` als **handgepflegte Liste von Überschreibungen einzelner Tailwind-Klassen** injiziert:

```css
#app-shell[data-theme="dark"] .bg-gray-50  { … }
#app-shell[data-theme="dark"] .text-gray-900 { … }   /* → nahezu Weiß */
```

Abgedeckt sind Flächen in `gray`, `blue`, `green`, `red`, `yellow`, `amber` (jeweils `-50`/`-100`) sowie diverse Textfarben. **Nicht abgedeckt sind Gradient-Stops** (`from-*`, `to-*`) – und Orange fehlt vollständig.

Folge: Bei jeder Fläche mit `bg-gradient-to-*` bleibt der **helle** Hintergrund stehen, während der Text auf **hell** umgestellt wird.

### Messwerte

```
Dashboard-Karte  Text  rgb(243,244,246)  auf  Gradient rgb(255,247,237) → rgb(255,237,213)
Angebots-Summen  Wert  rgb(243,244,246)  auf  Gradient rgb(249,250,251) → rgb(239,246,255)
Angebots-Summen  Label rgb(209,213,219)  auf  derselben Fläche
```

Kontrast ≈ **1,05:1**. WCAG AA verlangt 4,5:1. Der Text ist effektiv unsichtbar.

### Betroffen sind alle fünf Gradient-Flächen im Projekt

| Datei | Klasse | Sichtbare Folge |
|---|---|---|
| `Dashboard.tsx` | `from-orange-50 to-orange-100` | Überschrift **„Entwürfe"** unsichtbar |
| `Dashboard.tsx` | `from-green-50 to-green-100` | Überschrift **„Bezahlt"** unsichtbar |
| `Dashboard.tsx` | `from-red-50 to-red-100` | Überschrift **„Überfällig"** unsichtbar |
| `QuoteEditor.tsx` | `from-blue-50 to-indigo-50` | **Dialogtitel „Neues Angebot"** unsichtbar |
| `QuoteEditor.tsx` | `from-gray-50 to-blue-50` | **Summenblock unsichtbar: Zwischensumme, MwSt., Gesamtbetrag** |

### Warum das nicht warten kann

Die Schwere ist gestaffelt. Auf dem Dashboard fehlen Überschriften, deren Bedeutung sich aus Zahl und Farbe noch erschließen lässt. Im Angebotseditor dagegen ist **der Gesamtbetrag eines Angebots nicht ablesbar** – der Nutzer erstellt ein Angebot, ohne die Summe sehen zu können.

**Verschärfend:** Der Dunkelmodus ist die **Voreinstellung**, sobald das Betriebssystem dunkel eingestellt ist (`themeMode: 'system'` ist Standard, `DynamicColors.tsx:74-80`). Ein erheblicher Teil der Nutzer sieht sofort die kaputte Variante.

### Empfehlung

**Nicht die fünf fehlenden Klassen nachtragen.** Das behebt fünf Symptome und lässt die Ursache stehen: Der Ansatz „Utility-Klassen global überschreiben" ist prinzipiell unvollständig – jede neue Komponente mit einer nicht gelisteten Farbe bricht erneut, und niemand merkt es, weil es keinen Test dafür gibt.

Richtig ist eine der beiden Umstellungen:

1. Tailwind `darkMode: 'class'` mit echten `dark:`-Varianten an den Komponenten, oder
2. CSS-Custom-Properties für Flächen-, Text- und Rahmenfarben, die pro Theme einmal gesetzt werden.

**Als Sofortmaßnahme vor der Landingpage:** die fünf Gradient-Flächen durch einfarbige, bereits abgedeckte Klassen ersetzen. Das ist ein Fünfzeiler und macht Screenshots im Dunkelmodus sofort brauchbar.

---

## ✅ O-2 · MITTEL · Belege-Ansicht: `NaN undefined` und leere OCR-Felder

> ✅ **Umsetzung:** Die Demo-Belege enthalten jetzt Dateiname, Dateigröße und realistische OCR-/Extraktionsdaten. `formatFileSize` behandelt ungültige, negative und sehr große Werte defensiv.

Auf der Belege-Seite zeigt **jede** der fünf Belegkarten `NaN undefined` als Kopfzeile, keinen Dateinamen, und bei Lieferant / Datum / Brutto durchgängig „Nicht erkannt" – obwohl der Status „OCR abgeschlossen" lautet.

### Einordnung

Nach Rückmeldung des Projektinhabers existierten **noch nie Beispielbelege**; es wurde bislang nur mit den generierten Demo-Datensätzen gearbeitet. Das deckt sich mit dem Befund: **Es ist kein Fehler des produktiven Pfades, sondern der Demo-Seed-Daten** – mit einer kleinen echten Codeschwäche daneben.

### Ursache 1 – Demo-Seed hat die falsche Form

`src/services/demoApi.ts:216-221` legt Belege so an:

```js
state.receipts = Array.from({ length: 5 }, (_, index) => ({
  id: generateUUID(),
  vendorName: [...][index],        // ← oberste Ebene
  receiptDate: …, grossAmount: …,  // ← oberste Ebene
  ocrStatus: 'completed',
  extractedData: {}, ocrExtractedData: {},   // ← leer
  // name und size fehlen vollständig
}));
```

Die Ansicht liest aber ausschließlich aus `extractedData`/`ocrExtractedData` (`ReceiptsManagement.tsx:349`) sowie `receipt.name` und `receipt.size` (`ReceiptsManagement.tsx:345`).

**Das ist die Demo-/Produktiv-Divergenz, die `EXPECTATIONS.md` §2 untersagt** – und der `CHANGELOG` behauptet bereits, Demo und produktive API seien angeglichen.

### Ursache 2 – Formatierung ohne Schutz

`src/utils/fileUtils.ts:64-70`

```js
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const i = Math.floor(Math.log(bytes) / Math.log(k));  // undefined → NaN
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];  // sizes[NaN] → undefined
};
```

Ergibt wörtlich `"NaN undefined"`. Im produktiven Pfad liefert das Backend `size` als geprüfte Zahl, dort tritt der Fall also nicht auf. **Zwei Restfehler bleiben aber auch produktiv:** Dateien ≥ 1 TB laufen aus dem `sizes`-Array (`sizes[4]` existiert nicht → wieder `undefined`), und negative Werte werden nicht abgefangen.

### Empfehlung

1. `formatFileSize` defensiv machen (Guard auf endliche, positive Zahl; Index auf Arraylänge begrenzen).
2. **Demo-Seed reparieren** – die Werte gehören in `extractedData`/`ocrExtractedData`, plus `name` und `size`.
3. **Für die Live-Demo weiter gehen als nur „nicht kaputt":** Die lokale Belegerkennung ist das stärkste Verkaufsargument. Der Seed sollte realistische, erfolgreiche OCR-Ergebnisse zeigen – Lieferant, Datum, Brutto, Steuerbetrag und eine plausible Konfidenz – damit die Demo die Funktion vorführt statt sie zu verstecken.

### Offen: der produktive OCR-Pfad ist ungetestet

Weil Tesseract im Backend-Container läuft, konnte die echte Belegerkennung hier **gar nicht geprüft werden**. Das braucht eine Docker-Umgebung und echte Belegfotos. Zu prüfen wären mindestens: Erkennungsqualität bei Kassenbons und Rechnungen, Verhalten bei schiefen/dunklen Fotos, Laufzeit und Speicherbedarf pro Beleg, sowie das Verhalten bei fehlgeschlagener Erkennung.

**Merke für die Landingpage:** Bis dieser Test gelaufen ist, ist keine Aussage zur OCR-Qualität belegt. „Lokale Verarbeitung, keine externe Schnittstelle" ist dagegen belegt (Tesseract im Image, kein ausgehender Aufruf im Quelltext) – und ist ohnehin das stärkere Argument.

---

## ✅ O-3 · MITTEL · Kein Tablet-Test, kein Test der eingeklappten Seitenleiste

> ✅ **Umsetzung:** Der Tablet-Breakpoint beginnt jetzt bei 768 px und die kompakte Seitenleiste versieht Haupt-, Unter- und Profilnavigation mit zugänglichen Namen, `title`-Hinweisen und aktuellem Seitenstatus.
>
> 🟠 **Hinweis:** Der echte Browserlauf für 768/880/1024 px sowie Hell-/Dunkelmodus konnte wegen der fehlenden Docker-Umgebung nicht durchgeführt werden.

Zwei von `EXPECTATIONS.md` ausdrücklich geforderte Zustände wurden nicht geprüft:

- **Tablet (768–1024 px).** §5: „Tablet ist kein vergrößertes Mobile-Layout." Der Bereich zwischen den beiden geprüften Breiten ist blind.
- **Eingeklappte Seitenleiste.** Die kompakten Haupt-, Unter- und Profilnavigationen haben jetzt `aria-label`, `title`-Hinweise und `aria-current`. Der Browser- und Screenreader-Lauf bleibt als technische Nachprüfung offen.

---

## ✅ O-4 · NIEDRIG · Hinweistext nennt einen Button, den es nicht gibt

> ✅ **Umsetzung:** Der Leerzustand nennt jetzt den tatsächlich vorhandenen Button **„Manuell hinzufügen“**.

Rechnungseditor, Leerzustand der Positionen:

> „Keine Positionen hinzugefügt. Klicken Sie auf **„Position hinzufügen"** um zu beginnen."

Der Button daneben heißt **„Manuell hinzufügen"**. (`src/components/InvoiceEditor.tsx`)

---

## ✅ O-5 · NIEDRIG · Rechnungsnummer verhält sich je nach Ansicht anders

> ✅ **Umsetzung:** Rechnungsnummern sind in Desktop-Tabelle und mobiler Kartenansicht jetzt als zugängliche Buttons öffnbar und führen in den Rechnungseditor.

Auf der Übersicht ist die Rechnungsnummer ein blauer Link, der die Rechnung öffnet. In der Rechnungsliste ist dieselbe Nummer schwarzer Fließtext ohne Funktion – dort führt nur das Aktionsmenü (`…`) zum Ziel.

Gleiche Information, zwei Verhaltensweisen. Ein Nutzer, der die Übersicht kennt, klickt in der Liste ins Leere.

---

## ✅ O-6 · HOCH · `npm audit`: 19 Schwachstellen, davon eine kritisch

> ✅ **Umsetzung:** jsPDF ist auf 4.2.1 aktualisiert, inklusive reproduzierbarem Lockfile und der neuen PNG-/Runtime-Abhängigkeiten. Der Docker-Demo-Build erhält außerdem jetzt den fehlenden `VITE_DEMO_MODE`-Build-Parameter.
>
> 🟠 **Hinweis:** `npm audit`, Docker-Build und visuelle PDF-Gegenprüfung konnten in dieser Umgebung nicht erneut ausgeführt werden, da Docker nicht installiert ist. Diese Prüfungen bleiben vor dem Release erforderlich.

Ergebnis von `npm ci && npm audit` im Frontend (2026-08-05):

| Schwere | Paket | Direkt? |
|---|---|---|
| **kritisch** | **jspdf** | **ja** |
| hoch | postcss, vite | ja |
| hoch | brace-expansion, cross-spawn, flatted, glob, js-yaml, minimatch, picomatch, rollup | nein (transitiv) |

**`jspdf` ist die Bibliothek, mit der sämtliche Rechnungs-PDFs erzeugt werden** – ausgerechnet dort steht die einzige kritische Meldung. `vite` und `postcss` betreffen nur die Bauzeit.

Für alle Meldungen ist laut npm ein Fix verfügbar. **Vor dem Update von `jspdf` müssen die PDF-Ausgaben visuell gegengeprüft werden** (Layout, Schriften, Positionen, Seitenumbrüche), da ein Versionssprung das Rendering verändern kann. Das betrifft auch die ZUGFeRD-Erzeugung (Audit 1, Abschnitt C).

**Nebenbefund:** `dompurify` liegt **bereits transitiv im Abhängigkeitsbaum**. Für die Behebung von Audit 1 · A9 (XSS über E-Mail-HTML) muss also keine neue Abhängigkeit eingeführt, sondern nur explizit eingebunden werden.

---

## ✅ O-7 · MITTEL · Globale Seitentitel liegen im Dunkelmodus auf einer abweichenden Fläche

> ✅ **Umsetzung:** `PageHeader` verwendet keine weiße Kartenfläche und keinen Schatten mehr. Titel und Aktionen liegen direkt auf dem jeweiligen Seitenhintergrund.

Die Seitentitel von Kalender, Rechnungen, Einstellungen und weiteren Bereichen liegen in den Screenshots auf einem sichtbar helleren/dunkleren Streifen als der eigentliche App-Hintergrund. Ursache ist der gemeinsame `PageHeader`: Im responsiven/fixierten Zustand verwendet er `bg-white`; der Dunkelmodus übersetzt diese Fläche zu `#1f2937`, während der App-Hintergrund `#111827` verwendet.

**Erwartung:** Der Seitentitel soll – wie im Hellmodus – direkt auf der jeweiligen Seitenfläche liegen und keinen zusätzlichen Kartenstreifen erzeugen.

---

## ✅ O-8 · MITTEL · Aktionsmenüs bleiben im Dunkelmodus weiß

> ✅ **Umsetzung:** Aktionsmenüs werden in den thematisierten `#app-shell`-Bereich portaliert und erhalten eine dunkle Fläche, helle Texte, einen dunklen Hover-Zustand sowie einen neutralen dunklen Standard-Trigger.

Die Aktionsmenüs in den Auftragsscreenshots erscheinen als weiße Popover-Flächen mit dunkler Schrift. `ActionMenu` rendert das Menü per Portal direkt in `document.body`; die bisherigen Dunkelmodus-Regeln sind jedoch auf `#app-shell` begrenzt und greifen dort deshalb nicht. Auch der Standard-Trigger nutzt weiterhin die sehr helle `primary-light`-Fläche.

**Erwartung:** Menüfläche, Text, Hover-Zustand und Standard-Trigger müssen auf die dunkle Oberfläche abgestimmt sein; farbige Aktionsicons bleiben erhalten.

---

## ✅ O-9 · MITTEL · Orange Hinweis- und Aktionsflächen bleiben hell

> ✅ **Umsetzung:** Orange Hintergründe, Rahmen und Texte erhalten jetzt eigene dunkle Theme-Werte; die Steuerkarte „EÜR öffnen“ bleibt dadurch im Dunkelmodus kontrastreich.

Auf der Steuerübersicht ist die Karte **„EÜR öffnen“** im Dunkelmodus hell-orange, während die globale Textüberschreibung den Text sehr hell setzt. Dadurch verliert die Karte den beabsichtigten Kontrast. Die Dunkelmodus-Regeln decken Blau, Grün, Rot, Gelb und Amber ab, aber die eigenständigen `orange-*`-Flächen nicht.

**Erwartung:** Orange Flächen erhalten im Dunkelmodus eine dunkle orange Oberfläche mit lesbarer heller Schrift und passendem Rahmen.

---

## ✅ O-10 · NIEDRIG · Kalender-Slate-Flächen bleiben hell

> ✅ **Umsetzung:** Slate-Hintergründe, Texte und Rahmen werden im Dunkelmodus auf abgestufte dunkle Kalenderflächen abgebildet.

> 🟠 **Hinweis:** Die exakte Darstellung muss nach dem nächsten Docker-/Browserlauf noch einmal visuell in Monats-, Wochen- und Tagesansicht geprüft werden.

Im Monatskalender bleiben Wochentagskopf, Kalenderwochen-Spalte und Tage außerhalb des aktuellen Monats in hellen `slate-*`-Flächen. Diese Flächen fallen im ansonsten dunklen Kalender deutlich als helle Streifen auf.

**Erwartung:** Slate-Hintergründe, Slate-Texte und Slate-Rahmen müssen im Dunkelmodus dieselbe abgestufte dunkle Oberfläche wie der Kalender verwenden.

---

## ✅ O-11 · MITTEL · Tab-Leisten von Einstellungen und Vorlagen sind nicht als Theme-Gruppe definiert

> ✅ **Umsetzung:** Einstellungen und Vorlagen verwenden jetzt die gemeinsame Theme-Gruppe `theme-tab-bar` mit `theme-tab-button` und einem eigenen aktiven Zustand.

Die Tab-Leisten in Einstellungen und Vorlagen kombinieren eigene halbtransparente `bg-gray-*`-/`bg-white`-Utilities. Dadurch wird die gesamte Leiste im Dunkelmodus nicht zuverlässig als zusammengehörige Fläche behandelt; aktive und inaktive Tabs driften farblich auseinander.

**Erwartung:** Leiste und Tab-Buttons verwenden eine gemeinsame semantische Theme-Gruppe mit getrennten Zuständen für aktiv, inaktiv und Hover.

---

## ✅ O-12 · MITTEL · Der aktuelle Kalendertag bleibt hell

> ✅ **Umsetzung:** Primary-Light- und Primary-Opacity-Flächen werden im Dunkelmodus dunkel abgestuft; Akzentfarbe und Fokusrahmen bleiben erhalten.

Die Hervorhebung des heutigen bzw. ausgewählten Tages nutzt helle `primary-light`- und Primary-Opacity-Flächen. Im dunklen Kalender wirkt der aktuelle Tag dadurch wie ein heller Fremdkörper.

**Erwartung:** Der aktuelle/ausgewählte Tag bleibt dunkel abgestuft; Akzentfarbe und Fokusrahmen bleiben sichtbar.

---

## ✅ O-13 · MITTEL · Aktiver Menüpunkt in der Seitenleiste ist zu hell

> ✅ **Umsetzung:** `nav-active` erhält im Dunkelmodus eine dunkle graue Fläche und behält den konfigurierten Akzent für Text und Seitenrand.

`nav-active` verwendet im Dunkelmodus weiterhin `--primary-light`. Bei hellen Profil-/Akzentfarben ist der aktive Menüpunkt deutlich heller als die übrige Seitenleiste.

**Erwartung:** Dunkle aktive Menüfläche, farbiger Akzent und ausreichender Kontrast für Text und Icon.

---

## ✅ O-14 · MITTEL · Belege und E-Rechnungseingang enthalten helle Aktionsflächen

> ✅ **Umsetzung:** `action-button` ist im Dunkelmodus jetzt eine dunkle Sekundäraktion; die farbigen Upload-Primäraktionen bleiben bewusst als Primäraktionen sichtbar.

In Belege und E-Rechnungseingang bleiben `action-button`-Flächen und die Aktionen in der Titelzeile hell. Dazu gehören die Verlinkung zur EÜR, „Beleg hochladen“/„XML übernehmen“ und die Prüfaktionen in den Karten.

**Erwartung:** Sekundäre Aktionen erhalten eine dunkle Oberfläche; primäre Upload-Aktionen bleiben als bewusst farbige Primäraktion erkennbar.

---

## ✅ O-15 · NIEDRIG · Verlinkungen in der Steuervorschau sind hell

> ✅ **Umsetzung:** Die Verlinkungs-/Aktionsbuttons der Steuervorschau folgen automatisch der gemeinsamen dunklen `action-button`-Fläche.

Die drei Aktionen in der Steuervorschau verwenden ebenfalls `action-button` mit weißer Standardfläche und fallen dadurch aus der dunklen Oberfläche heraus.

**Erwartung:** Steueraktionen folgen derselben dunklen Sekundäraktionsfläche wie Belege und E-Rechnungseingang.

---

## ✅ O-16 · MITTEL · Checkboxen und Radiobuttons bleiben global hell

> ✅ **Umsetzung:** Unausgewählte `.custom-checkbox` und `.custom-radio` erhalten im Dunkelmodus dunkle Flächen und sichtbare Rahmen; ausgewählte Zustände bleiben akzentfarben.

Die globalen `.custom-checkbox`- und `.custom-radio`-Komponenten tragen ihre weiße Grundfläche direkt in der Komponentendefinition. Die bisherigen Regeln für `.bg-white` können diese Grundfläche deshalb nicht zuverlässig überschreiben.

**Erwartung:** Unausgewählte Auswahlfelder sind im Dunkelmodus dunkel mit sichtbarem Rahmen; ausgewählte Zustände behalten den konfigurierten Akzent.

---

## ✅ O-17 · MITTEL · Die feste Zurücksetzen-/Speichern-Leiste bleibt hell

> ✅ **Umsetzung:** Die feste Settings-Aktionsleiste hat jetzt eine eigene Theme-Klasse und verwendet im Dunkelmodus eine dunkle, halbtransparente Oberfläche; die sekundäre Zurücksetzen-Aktion folgt ebenfalls dem dunklen Kontrollflächenstil.

Die Leiste am unteren Rand der Einstellungen verwendet `bg-gray-50/95`. Diese Utility-Variante wird von der bisherigen allgemeinen `bg-gray-50`-Regel nicht erfasst und bleibt deshalb im Dunkelmodus nahezu weiß.

**Erwartung:** Die Leiste fügt sich in die dunkle Seite ein; Zurücksetzen und Speichern bleiben als getrennte Aktionen erkennbar.

---

## ✅ O-18 · NIEDRIG · Scrollbar von „Begriffe & Fachsprache“ bleibt hell

> ✅ **Umsetzung:** Der horizontale Begriffs-Scroller verwendet jetzt eine eigene `theme-scrollbar`-Klasse mit dunklem Track, Thumb und Hover-Zustand im Dunkelmodus.

Die globale WebKit-Scrollbar nutzt helle Track- und Thumb-Farben. Dadurch bleibt die horizontale Scrollbar der Profilkarten in „Begriffe & Fachsprache“ trotz dunkler Umgebung hell.

**Erwartung:** Track und Thumb der Begriffsübersicht sind dunkel abgestuft und bleiben auf Desktop und Touch-Geräten nutzbar.

---

## ✅ O-19 · MITTEL · Statusbadges im E-Rechnungseingang bleiben hell

> ✅ **Umsetzung:** Emerald- und Rose-Statusbadges erhalten im Dunkelmodus dunkle Flächen, kontrastreiche Rahmen und helle Statusfarben; die Statuspunkte bleiben als farbige Orientierung erhalten.

Die Statusbadges verwenden Varianten wie `bg-emerald-50`/`text-emerald-700` beziehungsweise `bg-rose-50`/`text-rose-700`. Diese Farbpräfixe wurden von den bisherigen Dark-Mode-Regeln nicht abgedeckt und erscheinen deshalb als helle Pillen.

**Erwartung:** Erfolgs- und Fehlerstatus sind auf der dunklen Oberfläche klar lesbar, ohne weiße Flächen zu erzeugen.

---

## ✅ O-20 · MITTEL · „Prüfen“ hat in Belegen und E-Rechnungseingang zu wenig Kontrast

> ✅ **Umsetzung:** `action-button` erhält im Dunkelmodus eine helle Standard-Textfarbe; die rote Löschaktion behält ihre explizite Rose-Statusfarbe.

Die `action-button`-Komponente setzt ihre Textfarbe direkt in der Komponentenebene. Die vorhandene globale Dark-Mode-Regel für `.text-gray-700` erreicht diese Farbe deshalb nicht; auf der dunklen Buttonfläche erscheinen Text und Icon zu dunkel.

**Erwartung:** „Prüfen“ und „Eingang prüfen“ sind in Belegen und E-Rechnungseingang deutlich lesbar; farbige Sonderaktionen behalten ihre Statusfarbe.

---

## ✅ O-21 · MITTEL · „Eingang prüfen“ ist unabhängig vom Theme zu hoch

> ✅ **Umsetzung:** Das zusätzliche `pt-4` wurde entfernt; die Kartenaktion verwendet wieder die kompakte Standardhöhe von `action-button`.

Der Button in den E-Rechnungskarten trägt zusätzlich `pt-4`. Dadurch wird die kompakte Standard-Paddinghöhe von `action-button` überschrieben und der Button ist auch im Hellmodus unnötig hoch.

**Erwartung:** Die Kartenaktion verwendet wieder die kompakte Standardhöhe von `action-button` in Hell- und Dunkelmodus.

---

## ✅ O-22 · MITTEL · Monatsraster ist mobil zu hoch

> ✅ **Umsetzung:** Die mobile Monatsrasterhöhe verwendet jetzt `calc(100vh - 280px)`; ab `sm` bleibt die bisherige Desktop-/Tablet-Höhe `calc(100vh - 180px)` erhalten.

Die Monatsansicht verwendet aktuell auch auf kleinen Displays nahezu die gesamte verfügbare Viewporthöhe. Dadurch werden die sechs Kalenderwochen unnötig hoch gestreckt und die einzelnen Tage wirken auf mobilen Geräten zu luftig.

**Erwartung:** Das mobile Monatsraster nutzt eine kompaktere Gesamthöhe und reduziert dadurch die Höhe jeder Tageszeile, während die Desktopansicht unverändert bleibt.

---

## ✅ O-23 · NIEDRIG · Monatsumsatzbalken variieren trotz gemeinsamer Darstellung

> ✅ **Umsetzung:** Die gemeinsame graue Balkenspur nutzt jetzt explizit die volle verfügbare Breite; der orange Anteil bleibt weiterhin proportional zum jeweiligen Monatsumsatz.

Die farbige Füllung der Monatsumsatzbalken wird relativ zum höchsten Euro-Wert berechnet. Die Gesamtspur muss dabei unabhängig von den Eurobeträgen gleich lang bleiben; die Beträge werden separat rechts angezeigt.

**Erwartung:** Die Gesamtspur aller Monatsumsatzbalken ist gleich lang; der orange Anteil bleibt entsprechend dem jeweiligen Monatswert unterschiedlich lang.

---

## ✅ O-24 · MITTEL · Tab-Leisten von Belegen, Vorlagen und Einstellungen sind nicht vereinheitlicht

> ✅ **Umsetzung:** Belege, Vorlagen und Einstellungen verwenden jetzt die gemeinsame `ThemeTabBar`-Schnittstelle mit identischer Höhe, solidem Kontrast, Zählbadges und horizontalem Overflow für Tablet und Mobile.

Die drei Tab-Leisten verwenden unterschiedliche Module und Layoutregeln: Belege nutzt ein dreispaltiges Raster mit höherem Tab, Vorlagen und Einstellungen verwenden jeweils eigene Sticky-Markup-Strukturen. Auf Tablet verschlechtert sich dadurch der Kontrast und auf Mobile entstehen unterschiedliche Anordnungen und Höhen.

**Erwartung:** Alle drei Bereiche verwenden dieselbe globale Tab-Leisten-Schnittstelle mit solidem Kontrast, gleicher Höhe, einheitlicher aktiver Auswahl und horizontalem Overflow-Konzept für Tablet und Mobile.

---

## ✅ O-25 · MITTEL · Tab-Leiste ragt aus dem Inhaltsraster und ist per Tastatur nicht vollständig navigierbar

> ✅ **Umsetzung:** Die drei Seiten verwenden die Tab-Leiste jetzt ohne negative Außenränder als `width: 100%` des Inhaltscontainers; `ThemeTabBar` ergänzt automatisches Aktivieren per Pfeiltasten, Home/End und roving `tabindex`.

Die gemeinsame Leiste verwendet an mehreren Seiten negative Außenränder und kann dadurch auf Tablet breiter als die umgebenden Karten und Formulare werden. Außerdem sind die Tabs zwar semantisch als `tablist`/`tab` ausgezeichnet, nutzen aber noch keine Pfeiltasten-Navigation nach dem üblichen Tabs-Pattern.

**Erwartung:** Die Leiste nutzt exakt `width: 100%` des Seitencontainers; auf kleinen Breiten scrollt sie einzeilig horizontal. Der aktive Tab ist per Tab fokussierbar, weitere Tabs lassen sich mit Links/Rechts sowie Home/End auswählen.

---

## 3. Bewusst geprüft und verworfen

Damit die umsetzenden Agenten hier keine Zeit verlieren – folgende zunächst verdächtige Beobachtungen waren **keine** Fehler:

| Beobachtung | Tatsächliche Ursache |
|---|---|
| Navigation im Hellmodus blass und kaum lesbar | Momentaufnahme der 300-ms-Farbanimation. Gemessen `rgb(55,65,81)` auf Weiß ≈ 10:1. In Ordnung. |
| Zwei gleichzeitig aktive Navigationseinträge | Ebenfalls die Übergangsanimation. Im DOM trägt nur ein Eintrag `nav-active`, alle anderen sind transparent. |
| Navigationsbuttons ohne zugänglichen Namen | Der Accessibility-Baum des Prüfwerkzeugs löste sie nicht auf. Die Buttons haben sichtbaren Textinhalt und damit einen gültigen Namen. *(Ausnahme: eingeklappte Seitenleiste, siehe O-3.)* |
| Zerissenes Layout mit großen weißen Flächen | Artefakt des Browser-Panels nach einer Größenänderung. Nach Neuladen nicht reproduzierbar, `innerWidth` korrekt bei 1440. |

---

## 4. Reihenfolge

| Rang | Punkt | Warum zuerst |
|---|---|---|
| **1** | **O-1** Dunkelmodus auf Gradient-Flächen | ✅ Technisch umgesetzt; Browser-Gegenprüfung in Hell/Dunkel bleibt vor Screenshots erforderlich. |
| **2** | **O-2** Belege-Demodaten + `formatFileSize` | ✅ Umgesetzt; echter OCR-Lauf mit Tesseract bleibt für die Produktivqualität offen. |
| **3** | **O-6** `jspdf` aktualisieren | ✅ Abhängigkeit aktualisiert; Docker-Build, `npm audit` und PDF-Gegenprüfung bleiben Release-Gates. |
| 4 | **O-3** Tablet + eingeklappte Seitenleiste prüfen | ✅ Technische Absicherung umgesetzt; reale Browser-/Screenreader-Prüfung steht aus. |
| 5 | **O-7** Seitentitel direkt auf dem Hintergrund | ✅ Global in `PageHeader` umgesetzt. |
| 6 | **O-8** Aktionsmenüs abdunkeln | ✅ Portal und Menütheme angepasst. |
| 7 | **O-9**, **O-10** Orange-/Slate-Flächen | ✅ Theme-Regeln ergänzt; Browser-Gegenprüfung bleibt offen. |
| 8 | **O-4**, **O-5** | ✅ Umgesetzt und in den Checkpoint-Überschriften dokumentiert. |
| 9 | **O-11** Tab-Leisten gruppieren | ✅ Gemeinsame Theme-Gruppe ergänzt. |
| 10 | **O-12**, **O-13** Kalender-/Navigationszustände | ✅ Dunkle Zustände ergänzt. |
| 11 | **O-14**, **O-15** Sekundäraktionen | ✅ Gemeinsame dunkle `action-button`-Fläche ergänzt. |
| 12 | **O-16** Checkboxen und Radiobuttons | ✅ Globale Auswahlkontrollen angepasst. |
| 13 | **O-17** Feste Settings-Aktionsleiste | ✅ Theme-Klasse und dunkle Fläche ergänzt. |
| 14 | **O-18** Begriffs-Scrollbar | ✅ Eigene dunkle Scrollbar-Variante ergänzt. |
| 15 | **O-19** Statusbadges | ✅ Emerald-/Rose-Statusvarianten ergänzt. |
| 16 | **O-20** Buttontext-Kontrast | ✅ Dark-Mode-Textfarbe der `action-button`-Komponente ergänzt. |
| 17 | **O-21** Höhe von „Eingang prüfen“ | ✅ Zusätzliches `pt-4` entfernt. |
| 18 | **O-22** Mobile Kalenderzeilen | ✅ Mobile Rasterhöhe kompakter gesetzt. |
| 19 | **O-23** Monatsumsatzbalken | ✅ Gemeinsame Gesamtspur vereinheitlicht; Wertanteile bleiben proportional. |
| 20 | **O-24** Gemeinsame Tab-Leisten | ✅ Globale `ThemeTabBar`-Schnittstelle mit Desktop-/Tablet-/Mobile-Regeln eingeführt. |
| 21 | **O-25** Inhaltsbreite und Tastaturbedienung | ✅ Vollbreite im Seitenraster und roving-Tabindex mit Pfeiltasten ergänzt. |

---

## 5. Folgerungen für Landingpage und Live-Demo

**Screenshots.** O-1 und O-2 sind technisch umgesetzt. Vor den endgültigen Aufnahmen müssen die Hell-/Dunkelansichten sowie die Tablet-Breiten im Browser noch gegengeprüft werden. Empfehlenswert ist ein Playwright-Skript mit festen Fenstergrößen, `deviceScaleFactor: 2` und deterministischem Seed – reproduzierbar bei jeder Produktänderung, statt Einzelaufnahmen von Hand.

**Live-Demo.** Der Demo-Modus ist als öffentliche Demo grundsätzlich gut geeignet: kein Backend, keine Datenbank, alles in `localStorage`, jeder Besucher in seiner eigenen Sandbox. Die technische Demo-Konfiguration und die Beleg-Seed-Daten sind umgesetzt. Offen bleiben der Docker-Build sowie ein echter OCR-Lauf mit repräsentativen Belegfotos.

**Belegbare Claims aus dieser Prüfung:**

- „Mobile-First" / „für unterwegs" – **belegt** (Kartenumbau statt Schrumpfen, kein Überlauf)
- „Dunkelmodus" – **erst nach O-1 bewerben**
- „Passt sich Ihrer Branche an" (Terminologieprofile) – **belegt und untervermarktet**
- Aussagen zur **OCR-Erkennungsqualität** – **nicht belegt**, Test steht aus
- „Lokale Belegverarbeitung ohne externe Schnittstelle" – **belegt**
