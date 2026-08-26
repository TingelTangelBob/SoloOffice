# SoloOffice – Betriebsmodell: Open Source, SaaS und Demo

- **Stand:** 2026-08-26
- **Geprüfter Commit:** `c68d787`
- **Status:** Planung – maßgebliche Fassung

**Anlass:** Frage 4 aus [Audit 1](SoloOffice-Audit-1-Code-und-Architektur.md) – eine Codebasis oder mehrere? Pooled oder dedizierte Instanzen?

---

## Kurzfassung

| Frage | Empfehlung |
|---|---|
| Zwei oder drei Versionen? | **Eine Codebasis, drei Konfigurationen.** |
| Funktionsunterschied SaaS ↔ Open Source? | **Keinen.** Verkauft wird der Betrieb, nicht der Funktionsumfang. |
| Eine Datenbank mit vielen Workspaces oder eine Instanz pro Kunde? | **Pooled** als Standard. Dedizierte Instanz später als Premium-Stufe. |
| Wo kommt die Abrechnung hin? | **In einen separaten Dienst** außerhalb von SoloOffice. |
| Wie schützt man die Demo? | **Gar nicht nötig** – sie hat keinen Server. |

---

## 1. Die Lizenz entscheidet die Frage, nicht die Technik

Das muss zuerst geklärt werden, weil es die naheliegendste Variante ausschließt.

SoloOffice steht unter **AGPL-3.0**. Zwei Punkte daraus sind hier bindend:

**§13 – Netzwerknutzung.** Wer eine *veränderte* Version als Netzwerkdienst betreibt, muss den Nutzern dieses Dienstes den **vollständigen Quelltext der betriebenen Version** zugänglich machen. Nicht auf Anfrage, nicht später – als Angebot im Dienst selbst.

**Kein eigenes Urheberrecht.** Der Copyright-Vermerk lautet `Belego Contributors` (`LICENSE:4`). SoloOffice ist ein Fork fremden AGPL-Codes. Damit ist **keine Doppellizenzierung möglich** – der übliche Open-Core-Weg („freie Version AGPL, Enterprise-Version proprietär") steht nicht offen. Dafür bräuchte es die Zustimmung aller Urheber des Ursprungsprojekts.

### Was daraus folgt

Eine geschlossene SaaS-Variante mit Zusatzfunktionen ist **rechtlich nicht möglich**. Jede Erweiterung innerhalb von SoloOffice – Abrechnung, Limits, Mandantenverwaltung – ist eine Veränderung und muss veröffentlicht werden.

**Das ist kein Problem, sondern eine Vereinfachung.** Es beendet die Debatte, welche Funktion in welche Variante gehört, bevor sie anfängt. Und es macht die Positionierung ehrlicher, statt sie zu verwässern.

> Hinweis: Ich bin kein Anwalt. Die AGPL-Auslegung zur Abgrenzung „eigenständiges Programm" (Abschnitt 4) ist in Randbereichen umstritten. Bevor echtes Geld fließt, lohnt eine Stunde bei einem auf Open-Source-Lizenzen spezialisierten Anwalt.

---

## 2. Eine Codebasis, drei Konfigurationen

Nicht drei Versionen. Drei **Betriebsarten desselben Images**, gesteuert über Umgebungsvariablen.

| | Self-Hosting | SaaS (gehostet) | Demo |
|---|---|---|---|
| Wer betreibt | der Nutzer | ihr | ihr |
| Backend | ja | ja | **nein** |
| Datenbank | eigene | pooled, RLS | **keine** |
| Registrierung | nach dem ersten Konto geschlossen | offen + E-Mail-Bestätigung | entfällt |
| Datenhaltung | beim Nutzer | bei euch | `localStorage` im Browser |
| Abrechnung | – | separater Dienst davor | – |
| Funktionsumfang | **voll** | **voll** | voll, aber ohne OCR |
| Artefakt | dasselbe Docker-Image | dasselbe Docker-Image | statisches Bundle |

Der Unterschied zwischen Self-Hosting und SaaS besteht aus **Konfiguration, nicht aus Code**:

```
REGISTRATION_MODE=closed-after-first | open
REQUIRE_EMAIL_VERIFICATION=false | true
STORAGE_DRIVER=database | s3
BACKUP_TARGET=local | s3
COOKIE_SECURE=false | true
```

Die Demo ist der einzige echte Sonderfall – ein anderes Build-Artefakt, weil `VITE_DEMO_MODE` zur Bauzeit ausgewertet wird. Das Frontend-Dockerfile und Compose übergeben dafür jetzt das entsprechende Build-Argument.

---

## 3. Keine Funktionsunterschiede zwischen SaaS und Open Source

Die Versuchung ist groß, im gehosteten Angebot „etwas mehr" zu bieten. Dagegen sprechen vier Gründe:

1. **Rechtlich bringt es nichts.** Die AGPL zwingt zur Veröffentlichung. Wer die Funktion will, holt sie sich aus dem Repository – nur mit schlechterem Gefühl gegenüber dem Projekt.
2. **Die Verkaufsgeschichte wird schwächer.** „Dieselbe Software, wir betreiben sie für dich" ist ein klares Versprechen. „Fast dieselbe Software, aber die guten Teile kosten" erzeugt sofort die Frage, was noch fehlt.
3. **Es beschädigt die Community.** Ein Open-Source-Projekt, dessen wichtigste Funktionen hinter der gehosteten Version liegen, bekommt keine Beiträge mehr.
4. **Der Wechsel in beide Richtungen ist euer stärkstes Argument.** Wer selbst hostet und keine Lust mehr hat, zieht zu euch. Wer bei euch ist und ausziehen will, kann es – und bleibt genau deshalb.

### Was ihr stattdessen verkauft

Nicht Funktionen, sondern **die Abwesenheit von Arbeit**:

- Betrieb, Updates, Sicherheitspatches
- Backups, die tatsächlich woanders liegen und wiederherstellbar sind
- E-Mail-Zustellung von einer eingerichteten, reputierten Domain – ein unterschätzter Punkt: Rechnungsmails aus einer frisch aufgesetzten Selbsthosting-Instanz landen zuverlässig im Spam
- Erreichbarkeit und Support auf Deutsch
- Kein Server, keine Docker-Kenntnisse, keine Migrationen

Das ist genau das, wofür Einzelunternehmer und kleine Betriebe gerne zahlen – weil sie es weder können noch wollen.

Legitime Stufen entstehen aus **Umfang**, nicht aus Funktion: Zahl der Nutzer, Zahl der Workspaces, Speicherplatz, Support-Reaktionszeit. Wer als Steuerberater fünfzig Mandanten betreut, zahlt mehr als der Solo-Fotograf – aber beide haben dieselbe Software.

---

## 4. Pooled statt dedizierte Instanzen

**Empfehlung: eine Datenbank, viele Workspaces, getrennt über Row-Level Security.**

### Warum

**Der teure Teil ist schon gebaut – und korrekt.** Mandantenfähige RLS ist die Stelle, an der die meisten Projekte scheitern. In SoloOffice ist sie richtig umgesetzt: `FORCE ROW LEVEL SECURITY` gesetzt (ohne das wäre sie für den Tabelleneigentümer wirkungslos), fail-closed bei fehlendem Kontext, alle 28 Fachtabellen erfasst, Nummernkreise auf `(workspace_id, nummer)` umgestellt. Diese Arbeit jetzt liegen zu lassen und stattdessen Container zu vervielfältigen, wäre Verschwendung.

**Der Betriebsaufwand skaliert sonst linear mit der Kundenzahl.** Bei 100 Kunden mit dedizierten Instanzen: 100 PostgreSQL-Instanzen, 200 Container, 100 Migrationsläufe pro Release – jeder davon ein möglicher Teilausfall, der einzeln behoben werden muss. Für ein kleines Team ist das der Punkt, an dem der Betrieb das Produkt auffrisst.

**Die Grenzkosten pro Kunde gehen gegen null.** Ein zusätzlicher Workspace ist ein Datenbankeintrag. Eine zusätzliche Instanz ist Arbeitsspeicher, ein Port und ein Backup-Ziel. Bei den Preisen, die in diesem Markt durchsetzbar sind (10–30 € pro Monat), trägt das dedizierte Modell sich nicht.

### Was pooled zwingend voraussetzt

Ein Punkt aus Audit 1 wird dadurch von „wichtig" zu **„Startvoraussetzung"**:

- **B2 – Restore.** Die Wiederherstellung arbeitet jetzt workspacebezogen mit `DELETE`; `TRUNCATE` und die Mehrmandanten-Sperre sind entfernt. Der Ablauf braucht noch den beschriebenen Docker-/PostgreSQL-Isolationstest.
- **Der Multiuser-Test** (Audit 1, Frage 2), der nie stattgefunden hat. Im pooled Modell ist die RLS-Schicht das Einzige, was Kundendaten trennt. Sie darf nicht ungetestet in Produktion gehen.

Dazu kommt **B5** – Belege liegen als Base64 in der Datenbank. Bei einem Kunden egal, bei hundert wird die Datenbank unhandlich und jedes Backup riesig. Vor dem Start Objektspeicher einplanen (`STORAGE_DRIVER=s3`); der Treiber ist in der Fachanwendung noch nicht implementiert.

### Dedizierte Instanzen trotzdem nicht wegwerfen

Die Multi-Instanz-Skripte bleiben nützlich – als **Premium-Stufe** für Kunden, die getrennte Datenhaltung ausdrücklich verlangen: Steuerkanzleien, Kunden mit eigenen Compliance-Vorgaben, Behördennähe. Das ist ein Angebot mit deutlich höherem Preis und wenigen Kunden. Erst bauen, wenn jemand danach fragt – nicht vorher.

---

## 5. Abrechnung gehört nicht in SoloOffice

**Empfehlung: ein separater kleiner Dienst („Control Plane") vor der Anwendung.**

Aufgaben: Registrierung mit Zahlungsdaten, Stripe- oder Paddle-Anbindung, Tarife und Limits, Bereitstellung neuer Workspaces über die SoloOffice-API, Sperren bei Zahlungsausfall, Rechnungen an die eigenen Kunden.

Drei Gründe:

1. **Lizenzgrenze.** Ein eigenständiges Programm, das über eine HTTP-Schnittstelle mit SoloOffice spricht, ist nach verbreiteter Auslegung kein abgeleitetes Werk und muss nicht unter AGPL stehen. Abrechnungslogik direkt in SoloOffice wäre eine Veränderung und damit veröffentlichungspflichtig – inklusive eurer Preislogik und Tarifgrenzen.
2. **Es gehört fachlich nicht dazu.** Wer SoloOffice selbst hostet, hat keinen Nutzen von Tarifverwaltung. Der Code würde bei jedem Selbsthoster als toter Ballast mitlaufen.
3. **Es hält das Produkt sauber.** Die Anwendung kennt Workspaces und Rollen. Ob ein Workspace bezahlt ist, ist eine Frage der Ebene darüber.

Die Anwendung braucht dafür einen abgesicherten administrativen API-Zugang zum Anlegen und Sperren von Workspaces sowie ein Flag „gesperrt" pro Workspace. Diese Schnittstelle und der Control Plane sind noch nicht implementiert; siehe [`docs/saas-control-plane.md`](../docs/saas-control-plane.md).

---

## 6. Die Demo braucht keinen Schutz

Die Sorge im Ausgangspunkt war: *„Die Nutzer sollten die nicht einfach verwenden können, aber sie sollte offen zugänglich und trotzdem geschützt sein."*

**Der Demo-Modus löst das bereits von selbst – weil es nichts zu schützen gibt.**

Bei `VITE_DEMO_MODE=true` (`src/services/demoApi.ts:29`) wird jeder API-Aufruf abgefangen und gegen `localStorage` beantwortet. Es existiert:

- **kein Backend** – nichts, was angegriffen oder überlastet werden könnte
- **keine Datenbank** – keine fremden Daten, die man erreichen könnte
- **kein E-Mail-Versand** – kein Missbrauch als Spam-Schleuder
- **kein Speicherverbrauch bei euch** – jeder Besucher schreibt in seinen eigenen Browser

Die Demo ist ein Ordner mit statischen Dateien hinter einem CDN. Missbrauch kostet euch nichts, weil es nichts zu missbrauchen gibt. Jeder Besucher sitzt automatisch in seiner eigenen Sandbox und kann nicht einmal theoretisch die Daten eines anderen sehen.

### Was stattdessen zu tun ist

Nicht abschotten, sondern **Verwechslung verhindern**. Das einzige reale Risiko ist, dass jemand die Demo für das Produkt hält, echte Kundendaten einträgt und sie beim Leeren des Browser-Caches verliert.

1. **Dauerhaft sichtbares Band** über der Anwendung: „Demoversion – Daten werden nur in diesem Browser gespeichert und sind nicht dauerhaft." Nicht wegklickbar. Die Einstellungsseite weist bereits darauf hin, aber nur dort.
2. **„Zurücksetzen"** prominent – ist als „Testdaten neu laden" schon vorhanden.
3. **Eigene Subdomain**, z. B. `demo.<domain>`, mit `<link rel="canonical">` auf die Landingpage. Nicht auf `noindex` setzen: Eine Demo ist ein guter Einstiegspunkt aus der Suche. Das Canonical verhindert nur, dass sie die eigentliche Verkaufsseite verdrängt.
4. **Deutlicher Weg heraus:** „Gefällt dir? → Kostenlos selbst hosten" und „→ Gehostet starten" an sichtbarer Stelle in der Demo.
5. **Realistische Seed-Daten**, insbesondere für die Belege (Audit 2 · O-2). Eine Demo, in der das Kernargument defekt aussieht, schadet mehr als sie nützt.

Was **nicht** nötig ist: Login für die Demo, Rate-Limiting, Captcha, Zugangscode. Alles davon erhöht die Hürde und schützt vor nichts.

### Eine Einschränkung, die benannt werden muss

Die OCR läuft im Backend-Container mit Tesseract. **In der Demo gibt es kein Backend, also keine echte Belegerkennung.** Die Demo kann den Ablauf zeigen (Beleg öffnen, Vorschläge prüfen, in die EÜR übernehmen), aber nicht wirklich erkennen.

Das ist vertretbar – muss aber in der Demo **ehrlich beschriftet** sein („In der Demo sind die Erkennungsergebnisse hinterlegt"). Eine vorgetäuschte Erkennung, die als echt dargestellt wird, wäre genau die Art von Scheinfunktion, die `EXPECTATIONS.md` §2 untersagt – und sie fliegt beim ersten kritischen Interessenten auf.

---

## 7. Empfohlene Reihenfolge

**Vor dem SaaS-Start – nicht verhandelbar:**

1. Multiuser- und RLS-Isolationstest (Audit 1, Frage 2)
2. Offsite-Backup, Restore-Probe und workspacebezogenen Restorebetrieb (Audit 1 · B1/B2)
3. Control Plane für Abrechnung, Limits und Workspace-Sperren (Audit 1 · G)
4. Belege in Objektspeicher (Audit 1 · B5)
5. Passwort-Reset, E-Mail-Bestätigung, Kontolöschung und Multiuser-Test (Audit 1 · G)

**Parallel, unabhängig davon:**

5. Landingpage und Demo – hängen an keinem der obigen Punkte
6. Control Plane mit Abrechnung
7. Dedizierte Instanzen als Premium-Stufe – erst auf Nachfrage
