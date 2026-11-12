import type { HelpArticle } from '../types.js';

const KEINE_STEUERBERATUNG = 'SoloOffice ersetzt keine Steuerberatung. Klären Sie steuerliche Fragen mit Ihrer Steuerberatung.';

export const belegeAusgabenArticles: HelpArticle[] = [
  {
    id: 'beleg-hochladen-und-pruefen',
    category: 'belege-ausgaben',
    title: 'Einen Beleg hochladen und prüfen',
    summary: 'SoloOffice liest Aussteller, Datum und Beträge aus Ihrem Beleg als Vorschlag, den Sie vor dem Speichern prüfen.',
    keywords: ['beleg', 'beleg hochladen', 'quittung', 'kassenbon', 'eingangsrechnung', 'scan', 'foto', 'pdf', 'belegerkennung', 'ocr', 'prüfen', 'kamera'],
    blocks: [
      { type: 'paragraph', text: 'Belege sind Ihre Nachweise für Ausgaben, zum Beispiel Quittungen oder Rechnungen von Lieferanten. Sie laden den Beleg hoch, SoloOffice erkennt die Angaben lokal und macht daraus einen Vorschlag. Erst nach Ihrer Prüfung wird etwas gespeichert oder in die EÜR übernommen.' },
      {
        type: 'steps',
        items: [
          'Öffnen Sie in der Seitenleiste **Belege** und klicken Sie auf **Beleg hochladen**. Auf dem Handy können Sie direkt ein Foto aufnehmen.',
          'Wählen Sie die Datei. Unterstützt werden PDF, JPG, PNG und WEBP bis 25 MB.',
          'Warten Sie, bis der Beleg den Status „Beleg erkannt“ hat. Davor steht er auf „Wartet auf Erkennung“ oder „Erkennung läuft“.',
          'Klicken Sie auf **Prüfen**. Kontrollieren Sie Aussteller, Belegdatum, Belegnummer, Netto, MwSt. Betrag, Brutto, MwSt.-Satz und Währung und korrigieren Sie Fehler.',
          'Wählen Sie bei **Kategorie-Vorschlag** die passende Kategorie.',
          'Klicken Sie auf **Prüfung speichern**. Mit **Als EÜR-Ausgabe vorbereiten** übernehmen Sie den Beleg zusätzlich als Ausgabe.',
        ],
      },
      { type: 'note', tone: 'warning', text: 'Die Erkennung kann sich irren, besonders bei Fotos. Gleichen Sie Beträge und Datum immer mit dem Originalbeleg ab. Hat die Erkennung den Status „Erkennung fehlgeschlagen“, versuchen Sie es mit **Erkennung erneut ausführen**. Sie können die Angaben auch von Hand eintragen.' },
      { type: 'note', tone: 'info', text: 'Die Erkennung läuft lokal, es gibt keine externe Schnittstelle. Der Originalbeleg bleibt unter **Originalbeleg anzeigen** erhalten.' },
      { type: 'link', label: 'Zu den Belegen', page: 'documents' },
    ],
    related: ['beleg-einer-buchung-zuordnen', 'ausgabe-erfassen-und-kategorie', 'belege-aufbewahren'],
  },
  {
    id: 'ausgabe-erfassen-und-kategorie',
    category: 'belege-ausgaben',
    title: 'Eine Ausgabe erfassen und einer Kategorie zuordnen',
    summary: 'Betriebliche Ausgaben tragen Sie in der EÜR ein und ordnen sie einer Kategorie zu.',
    keywords: ['ausgabe', 'ausgabe erfassen', 'betriebsausgabe', 'kategorie', 'buchung', 'manuelle buchung', 'vorsteuer', 'bürobedarf', 'software', 'reisekosten', 'material'],
    blocks: [
      { type: 'paragraph', text: 'Jede Betriebsausgabe gehört in die EÜR, damit sie Ihren Gewinn mindert. Die Kategorie sortiert die Ausgabe, etwa „Bürobedarf“ oder „Software und Lizenzen“. Gebucht wird mit dem Tag, an dem Sie bezahlt haben.' },
      {
        type: 'steps',
        items: [
          'Öffnen Sie **Steuern** und dann **EÜR**. Wählen Sie das Jahr.',
          'Klicken Sie auf **Buchung** und dann auf **Manuelle Buchung**. Alternativ nutzen Sie in der Monatsübersicht die Schaltfläche **Ausgaben** des passenden Monats.',
          'Wählen Sie bei **Art** die Ausgabe und tragen Sie **Datum** und **Beschreibung** ein.',
          'Wählen Sie die **Kategorie**, zum Beispiel „Material und Waren“, „Telefon und Internet“, „Fahrzeugkosten“ oder „Sonstige Betriebsausgaben“.',
          'Tragen Sie den **Betrag (Brutto)** und den **MwSt.-Satz in %** ein. Bei Regelbesteuerung prüfen Sie im Block „Umsatzsteuer“ die Behandlung.',
          'Klicken Sie auf **Speichern**.',
        ],
      },
      { type: 'note', tone: 'info', text: 'Als Regelbesteuerer trennt die EÜR die Vorsteuer von der Ausgabe. Als Kleinunternehmer zählt der Bruttobetrag, weil Sie keine Vorsteuer abziehen können.' },
      { type: 'note', tone: 'tip', text: 'Die Kategorie lässt sich später ändern, indem Sie die Buchung bearbeiten. Für Pauschalen gibt es unter **Buchung** den Punkt **Pauschale erfassen**.' },
      { type: 'note', tone: 'warning', text: 'Ob und in welcher Höhe eine Ausgabe abziehbar ist, hängt vom Einzelfall ab. ' + KEINE_STEUERBERATUNG },
      { type: 'link', label: 'EÜR öffnen', page: 'euer' },
    ],
    related: ['beleg-einer-buchung-zuordnen', 'beleg-hochladen-und-pruefen', 'wiederkehrende-ausgabe-aus-beleg', 'euer-aufstellung-lesen'],
  },
  {
    id: 'beleg-einer-buchung-zuordnen',
    category: 'belege-ausgaben',
    title: 'Einen Beleg einer Buchung zuordnen',
    summary: 'Verknüpfen Sie Beleg und Ausgabe, damit zu jeder Buchung der Nachweis griffbereit ist.',
    keywords: ['beleg zuordnen', 'beleg verknüpfen', 'buchung', 'nachweis', 'belegnotiz', 'verknüpft', 'ohne beleg', 'beleghinweis'],
    blocks: [
      { type: 'paragraph', text: 'Zu jeder Ausgabe sollten Sie den Beleg aufbewahren. In SoloOffice gibt es zwei Wege, ihn mit einer EÜR-Buchung zu verbinden. Verknüpfte Belege tragen im Beleg-Bereich den Vermerk „Mit EÜR verknüpft“.' },
      { type: 'heading', text: 'Weg 1: Vom Beleg zur Ausgabe' },
      {
        type: 'steps',
        items: [
          'Laden Sie den Beleg hoch und klicken Sie auf **Prüfen**.',
          'Korrigieren Sie die Angaben und klicken Sie auf **Als EÜR-Ausgabe vorbereiten**.',
          'Kontrollieren Sie im Dialog „EÜR-Ausgabe prüfen“ Zahlungsdatum, Betrag und Umsatzsteuer.',
          'Klicken Sie auf **EÜR-Ausgabe anlegen**. Die Buchung ist nun mit dem Beleg verknüpft, der Beleg zeigt „Bereits in EÜR“.',
        ],
      },
      { type: 'heading', text: 'Weg 2: Von der Buchung zum Beleg' },
      {
        type: 'steps',
        items: [
          'Laden Sie den Beleg zuerst hoch und speichern Sie die Prüfung.',
          'Öffnen Sie in der EÜR eine Ausgabe oder legen Sie eine neue an.',
          'Wählen Sie im Feld **Beleg (optional)** den passenden Beleg. Die Angaben des Belegs werden übernommen. Mit „Ohne Beleg“ lösen Sie die Verknüpfung.',
        ],
      },
      { type: 'note', tone: 'info', text: 'Das Feld **Beleg (optional)** erscheint nur bei Ausgaben und nur, wenn bereits Belege vorhanden sind. Fehlt ein Beleg, hilft das Feld **Notiz / Beleghinweis**, etwa mit der Belegnummer.' },
      { type: 'note', tone: 'warning', text: 'Ein Beleg mit Verknüpfung zu einer Rechnung, die Sie weiterberechnet haben, lässt sich nicht löschen. Er bleibt als Nachweis erhalten.' },
      { type: 'link', label: 'Zu den Belegen', page: 'documents' },
      { type: 'link', label: 'EÜR öffnen', page: 'euer' },
    ],
    related: ['beleg-hochladen-und-pruefen', 'ausgabe-erfassen-und-kategorie', 'belege-aufbewahren'],
  },
  {
    id: 'wiederkehrende-ausgabe-aus-beleg',
    category: 'belege-ausgaben',
    title: 'Wiederkehrende Ausgaben aus einem Beleg anlegen',
    summary: 'Aus einem Beleg, der sich regelmäßig wiederholt, machen Sie mit einem Klick Fixkosten.',
    keywords: ['wiederkehrend', 'wiederkehrende ausgabe', 'fixkosten', 'abo', 'als fixkosten speichern', 'regelmäßig', 'monatlich', 'jährlich', 'miete', 'versicherung'],
    blocks: [
      { type: 'paragraph', text: 'Manche Belege kommen immer wieder, etwa die Rechnung für Ihr Software-Abo oder die Büromiete. Statt jeden Monat eine Ausgabe neu zu tippen, legen Sie sie einmal als Fixkosten an. SoloOffice plant dann die Fälligkeiten.' },
      {
        type: 'steps',
        items: [
          'Laden Sie den Beleg hoch und warten Sie, bis er erkannt ist.',
          'Klicken Sie in der Belegkarte auf **Als Fixkosten speichern**. Die Schaltfläche erscheint, wenn der Beleg erkannt ist, ein Bruttobetrag vorliegt und der Beleg noch nicht in der EÜR verbucht wurde.',
          'Prüfen Sie im Dialog „Fixkosten erfassen“ Bezeichnung, **Betrag je Fälligkeit**, **Intervall** und **Erste Fälligkeit**. Aussteller, Betrag und Kategorie sind vorbelegt.',
          'Klicken Sie auf **Speichern**.',
          'Buchen Sie fällige Termine auf der Seite **Fixkosten** mit **Als bezahlt buchen**.',
        ],
      },
      { type: 'note', tone: 'info', text: 'Eine Fälligkeit wird erst zur EÜR-Ausgabe, wenn Sie sie als bezahlt buchen. Das automatische Buchen ist standardmäßig ausgeschaltet.' },
      { type: 'note', tone: 'tip', text: 'Ändert sich der Preis, tragen Sie in den Fixkosten unter „Preisänderungen“ ein neues Datum und den neuen Betrag ein. Alte Buchungen bleiben unverändert.' },
      { type: 'link', label: 'Fixkosten öffnen', page: 'fixed-costs' },
    ],
    related: ['fixkosten-planen-und-buchen', 'beleg-hochladen-und-pruefen'],
  },
  {
    id: 'eingehende-e-rechnungen-uebernehmen',
    category: 'belege-ausgaben',
    title: 'Eingehende E-Rechnungen übernehmen',
    summary: 'E-Rechnungen von Lieferanten können Sie als XML-Datei einlesen, prüfen lassen, archivieren und einem Kunden zuordnen.',
    keywords: ['e-rechnung', 'erechnung', 'xrechnung', 'zugferd', 'xml', 'eingang', 'eingehende rechnung', 'e-rechnungseingang', 'archivieren', 'prüfung', 'lieferantenrechnung'],
    blocks: [
      { type: 'paragraph', text: 'Eine E-Rechnung ist eine Rechnung als strukturierte Datei, die ein Programm lesen kann. Wenn Sie eine solche Datei als XML erhalten, können Sie sie unter **Belege** einlesen. SoloOffice prüft sie, legt sie unverändert ab und zeigt die erkannten Daten.' },
      {
        type: 'steps',
        items: [
          'Öffnen Sie **Belege** und wechseln Sie zur Registerkarte **E-Rechnungen**.',
          'Klicken Sie auf **XML übernehmen** und wählen Sie die Datei (XML bis 10 MB).',
          'Warten Sie auf die Prüfung. Fehlen Pflichtfelder, meldet SoloOffice das. Die Datei wird trotzdem archiviert.',
          'Klicken Sie bei der Rechnung auf **Eingang prüfen**. Sie sehen Rechnungsnummer, Rechnungsdatum, Aussteller, Steuernummer und Gesamtbetrag.',
          'Wählen Sie bei Bedarf unter „Kunde zuordnen“ den passenden Kunden. Die Auswahl wird sofort gespeichert.',
        ],
      },
      { type: 'note', tone: 'warning', text: 'Das Einlesen einer E-Rechnung bucht noch keine Ausgabe in die EÜR. Erfassen Sie die Zahlung selbst als Ausgabe, sobald Sie bezahlt haben. Gelöscht werden kann eine E-Rechnung über die Oberfläche nicht, die Originaldatei bleibt als Nachweis erhalten.' },
      { type: 'note', tone: 'info', text: 'Eingelesen werden nur XML-Dateien. Andere Dateien laden Sie als normalen Beleg hoch.' },
      { type: 'link', label: 'Zu den Belegen', page: 'documents' },
    ],
    related: ['beleg-hochladen-und-pruefen', 'ausgabe-erfassen-und-kategorie', 'belege-aufbewahren', 'e-rechnung-xrechnung-zugferd'],
  },
  {
    id: 'belege-aufbewahren',
    category: 'belege-ausgaben',
    title: 'Belege aufbewahren',
    summary: 'Belege sind Ihr Nachweis für die Steuer. SoloOffice legt sie ab, die Aufbewahrungspflicht bleibt bei Ihnen.',
    keywords: ['aufbewahrung', 'aufbewahrungsfrist', 'belege aufbewahren', 'archiv', 'gobd', 'nachweis', 'betriebsprüfung', 'löschen', 'ablage'],
    blocks: [
      { type: 'paragraph', text: 'Steuerlich müssen Sie Rechnungen und Belege über Einnahmen und Ausgaben in der Regel mehrere Jahre aufbewahren. Wie lange genau und welche Form zulässig ist, hängt von der Art des Belegs und Ihrer Situation ab. Die aktuellen Fristen erfragen Sie bei Ihrer Steuerberatung oder dem Finanzamt.' },
      { type: 'heading', text: 'Was SoloOffice für Sie tut' },
      {
        type: 'list',
        items: [
          'Hochgeladene Belege bleiben mit Ihrer Prüfung gespeichert. Das Original öffnen Sie jederzeit über **Originalbeleg anzeigen**.',
          'Eingelesene E-Rechnungen bleiben als Quelldatei mit Prüfstatus erhalten.',
          'Änderungen an EÜR-Buchungen werden protokolliert. Sie sehen sie im Änderungsverlauf der Buchung.',
          'Weiterberechnete Belege lassen sich nicht löschen, sie bleiben als Nachweis.',
        ],
      },
      { type: 'heading', text: 'Was bei Ihnen bleibt' },
      {
        type: 'list',
        items: [
          'Die Entscheidung, welche Belege Sie wie lange aufheben, und ihre Löschung.',
          'Eine zusätzliche Datensicherung. Welche Sicherungen es gibt, sehen Sie unter **Einstellungen** im Bereich **E-Mail & Backup**.',
          'Papierbelege, falls Sie sie nur fotografiert haben und die Steuerberatung das Original verlangt.',
        ],
      },
      { type: 'note', tone: 'tip', text: 'Erfassen Sie einen Beleg zeitnah nach dem Kauf. So gehen Bons nicht verloren, und die Erkennung liest Fotos in der Regel besser, solange sie neu und sauber sind.' },
      { type: 'note', tone: 'warning', text: KEINE_STEUERBERATUNG },
      { type: 'link', label: 'Zu den Belegen', page: 'documents' },
    ],
    related: ['beleg-hochladen-und-pruefen', 'beleg-einer-buchung-zuordnen', 'export-fuer-steuerberater'],
  },
];
