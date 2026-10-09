# Steuern & Abgaben und Fixkosten

Implementierungsstand 09.10.2026. Die Steuer- und Sozialwerte sind unverbindliche Schätzungen für vorbereitende Unterlagen. Die Rechts-/Hilfetexte sind Entwürfe zur anwaltlichen Prüfung; dieses Paket ist keine öffentliche Release-Freigabe.

## Bedienung

Unter **Einstellungen → Erweiterungen** lässt sich „Steuern & Abgaben“ je Workspace aktivieren. Die Erstaktivierung verlangt eine Bestätigung und speichert deren Zeitstempel serverseitig. Unter **Steuern & Abgaben** stehen fünf bedingte, überspringbare Frageschritte: Tätigkeit/Beginn, Handwerk, Umsatzsteuer, Versicherungen sowie persönliche Angaben/Vorauszahlungen. Ein Beruf löst keine automatische Versicherungspflicht aus. Kirchensteuer wird nur als Ja/Nein mit separater, widerrufbarer Einwilligung gespeichert; Konfession, Steuer-ID und Krankenkassenname werden nicht erhoben.

**Fixkosten** bleiben für betriebliche Ausgaben eine Kernfunktion. Vorlagen unterstützen Monats-/Wochenintervalle, Preisänderungen ab Datum, Pausen und Vertragsende. Ab dem Enddatum entstehen keine neuen Fälligkeiten; frühere offene Fälligkeiten bleiben nachvollziehbar. Der Kündigungstag ist das Datum der Erklärung und beendet den Zahlungsplan nicht selbst. Automatik ist standardmäßig aus. Eine bestätigte betriebliche Fälligkeit erzeugt genau eine EÜR-Ausgabe; der EÜR-Hinweis bietet „Bezahlt am …“ und „Überspringen“.

Der Tab **Private Abgaben** erfordert die Erweiterung und das Recht „Einstellungen verwalten“. Private Vorlagen und Zahlungen werden in `levy_payments` geführt und erzeugen niemals EÜR-Betriebsausgaben. Bescheidbetrag, Bezugsperiode, Fälligkeit und Zahlungsdatum haben unterschiedliche Funktionen.

Im Dashboard sind die sieben neuen Kacheln standardmäßig aus und über **Dashboard anpassen** hinzufügbar. Im ⋯-Menü stehen Fixkosten, Sozialbeiträge, Steuerrücklage, grobe USt-Rücklage und „Verfügbar“ bereit. **Private Abgaben einblenden** ist standardmäßig aus: private Reihen und Kacheln bleiben auch beim Bearbeiten/Hinzufügen verborgen. Betriebliche Fixkosten und USt bleiben unabhängig davon verfügbar. Bei ausgeschalteter Erweiterung erscheinen ihre Dashboard-Elemente nicht.

Die optionale **Monatsansicht mit Vergleich** ist ebenfalls standardmäßig aus. Der Regler umfasst die letzten zwölf Monate und startet ohne gültige gespeicherte Wahl beim letzten abgeschlossenen Monat. Ein laufender Monat trägt „bisher“ und wird nicht mit einem alarmierenden Prozentdelta gegen einen vollen Monat dargestellt. Vergleichsmonat, Ansicht und Serienschalter werden je Benutzer und Workspace gespeichert. Der Monatschart vergleicht Umsatz und aktivierte Kosten als Balken; fehlende Vergleichsgrundlagen bleiben „Nicht verfügbar“.

## Datenbasis und Grenzen

Der Forecast verwendet aktive EÜR-Zahlungen und zulässige künftige betriebliche Fixkosten. Offene vergangene Fixkosten werden angezeigt, aber ohne Bestätigung nicht als vergangene Ausgaben erfunden. Eine saisonale Hochrechnung benötigt zwölf belegte Vorjahresmonate; sonst gilt die lineare Hochrechnung. Ältere bezahlte Rechnungen ohne zugehörigen EÜR-Zahlungseingang führen zu einem Datenbasis-Hinweis.

Bei aktiven Kostenreihen zeigt das Diagramm konsistent EÜR-Einnahmen und Prognose. Die bestehende Umsatzkennzahl verwendet weiterhin Rechnungszahlungen; die unterschiedliche Basis wird am Diagramm erklärt. Historische Monatswerte für Sozialbeiträge und Steuer sind verteilte Jahresschätzungen, keine bestätigten Zahlungen. „Verfügbar“ zieht ausschließlich die eingeblendeten Komponenten ab und enthält keine variablen Ausgaben. USt steht separat und ist bei Regelbesteuerung nur ein grober Richtwert ohne vollständige Vorsteuer-/Sonderfallprüfung. Vorauszahlungsterminrichtwerte aus dem Profil erzeugen keine Buchung und keinen künstlichen Überfälligkeitsstatus.

ESt/Splitting, Soli/KiSt, GewSt und §35, GKV/PKV/PV/RV/AV/KSK, Vorsorgeabzug und Kammer-/Gründerregeln liegen im gemeinsamen reinen Rechenkern. Die Stufenanzeige zeigt Schwellen und Abstände; §19 trennt Ist-Umsatz und Jahresprognose. Maßgeblich bleiben Bescheide und eine individuelle fachliche Prüfung.

## Architektur und Wartung

- Gemeinsame ESM-Module mit `.d.ts`: `backend/shared/forecast/`, `backend/shared/recurrence.js`, `backend/shared/taxParams/`. So verwenden Backend und Frontend/Demo dieselben Regeln ohne separaten TS-Backend-Build.
- Jahresparameter: `taxParams/2026.js` mit Quellen und Stand, Registrierung in `taxParams/index.js`. Ein fehlendes Set erzeugt einen sichtbaren Hinweis auf das verwendete Jahr; für 2027 ist ein neues fachlich geprüftes Set erforderlich.
- Zentrale Texte A–E: `backend/shared/taxTexts.js`; Änderungen der Einwilligungs-/Hilfe-/AGB-Texte vor Veröffentlichung anwaltlich prüfen.
- Katalog: `backend/shared/extensions.js`, bestehende Modulschalter über `legacyCompanyField`; `requiredPlan` heute überall `free`. `canUseExtension` und `middleware/extensions.js` unterstützen `pro` mit vertrauenswürdiger serverseitiger Tarifquelle. Shop, Abrechnung und ein produktiver Pro-Tarif sind nicht implementiert.
- Tabellen/Migrationen 051–055: `tax_profiles`, `workspace_extensions`, `recurring_expenses`, `recurring_expense_runs`, `levy_payments`; Workspace-RLS/FORCE, Backup/Restore, Löschung und Umzugsreset sind berücksichtigt. Migration 055 sperrt private EÜR-Kategorien bei neuen/aktualisierten Zeilen mit `NOT VALID`, ohne Altbestände umzuschreiben.
- API: `/api/tax-profile`, `/api/levy-payments` und `/api/forecast/:year` benötigen die aktivierte Erweiterung plus `workspace.settings`; betriebliche Fixkosten bleiben im EÜR-Berechtigungsbereich. Deaktivierte private Funktionen liefern 403 und werden auch im Frontend ausgeblendet.
- PostgreSQL-`DATE` kann als JS-`Date` ankommen: Kalenderschlüssel stets mit `assertDateOnly` bilden, niemals über UTC-ISO abschneiden. Zeitstempel/Stichtage sind davon getrennt zu behandeln.
- Dashboard-Präferenzen/Registry: `backend/utils/dashboardPreferences.js` mit `.d.ts`, vom Frontend reexportiert. Serien in `src/utils/dashboardChartSeries.ts`; Jahreschart `RevenueAreaChart`, Monatsvergleich `MonthlyRevenueChart`, Monatsschlüssel/-filter `dashboardPeriod`.

## Prüfung und offene Freigaben

Regressionssuiten enthalten Golden-Werte gegen die bereitgestellten Referenzen, Tarif-/BBG-Randwerte, Monatsgrenzen, DATE-Objekte, Präferenzpersistenz, Demo und private EÜR-Trennung. PostgreSQL-Integration prüft RLS, Erweiterungsschutz, idempotente Zahlungen, Preis-/Pausen-/Enddatum-Lebenszyklen sowie Backup/Reset. Technische Checks und manuelle UI-Prüfung sind getrennt zu dokumentieren; Host-Nachweise ersetzen den vorgesehenen Docker-/CI-Lauf nicht.

Offen bleiben vollständige USt/Vorsteuer (Phase 3), unabhängiger manueller BMF-Abgleich und anwaltliche Textprüfung. Vor dem nächsten öffentlichen Release die offenen Punkte aus [manual-release-checklist.md](manual-release-checklist.md) mit Steffen besprechen; vorhandene Haken nicht ohne neuen Nachweis ändern.

Technischer Endnachweis vom 09.10.2026: Host-Typecheck/Lint/Audit, 127 Frontend- und 318 Backend-Tests bestanden; PostgreSQL 17.11 UTC 76/76 und Berlin 29/29. Manuell sind 1440 px hell und 390 px dunkel samt Privat-/Monatspräferenz-Reload und Slider-Tastatur nachgewiesen. Weitere Varianten, Docker und PostgreSQL 15 bleiben offen. Nicht blockierende UI-Restpunkte: appweiter Dialog-Escape, verschachtelte Info-Schaltfläche im Menü, Leerraum in „Wo stehe ich“ und ISO-Datum in der Preisgeschichte.
