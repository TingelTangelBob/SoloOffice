/**
 * Entwurf – anwaltlich zu prüfen.
 * Zentrale Texte für Steuerprognosen; Text A–E aus PLAN.md.
 */
export const TAX_TEXTS = Object.freeze({
  badge: 'Unverbindliche Schätzung',
  tooltip: year => `Unverbindlicher Richtwert auf Basis deiner erfassten Zahlen und allgemeiner Werte für das Steuerjahr ${year}. Keine Steuerberatung und kein Bescheid.`,
  activationTitle: 'Steuern & Abgaben anzeigen',
  activationBody: 'SoloOffice berechnet unverbindliche Näherungswerte für Steuern und Sozialabgaben. Grundlage sind deine erfassten Zahlen sowie allgemeine Tarife und Beitragssätze. Individuelle Besonderheiten wie weitere Einkünfte, Sonderausgaben, außergewöhnliche Belastungen, Verlustvorträge oder Einzelfallfragen werden nicht oder nur vereinfacht berücksichtigt. Maßgeblich sind die Bescheide von Finanzamt, Krankenkasse und Rentenversicherung. SoloOffice leistet keine Steuer- oder Rechtsberatung.',
  activationCheckbox: 'Ich habe verstanden, dass es sich um eine unverbindliche Schätzung handelt.',
  churchTitle: 'Angabe zur Kirchensteuer',
  churchBody: 'Für die Schätzung der Kirchensteuer speichern wir nur, ob du kirchensteuerpflichtig bist, ohne deine Konfession. Diese Angabe ist besonders geschützt. Du kannst sie jederzeit in den Einstellungen löschen.',
  churchCheckbox: 'Ich willige in die Speicherung dieser Angabe für die Schätzung ein.',
  draftNotice: 'Entwurf – vor einer Veröffentlichung anwaltlich zu prüfen.',
  termsDraft: 'Die in SoloOffice angezeigten Schätzungen zu Steuern, Sozialabgaben und Fixkosten sind unverbindliche Näherungswerte auf Basis vereinfachter Annahmen. Sie sind keine Steuerberatung, keine Rechtsdienstleistung und keine verbindliche Auskunft. Für Schäden haften wir unbeschränkt bei Vorsatz, grober Fahrlässigkeit sowie bei Verletzung von Leben, Körper oder Gesundheit und in allen weiteren Fällen zwingender gesetzlicher Haftung. Bei einfacher Fahrlässigkeit haften wir nur bei Verletzung wesentlicher Vertragspflichten, begrenzt auf den vertragstypisch vorhersehbaren Schaden.',
  socialNotice: 'Maßgeblich sind die Beitragsbescheide deiner Krankenkasse und Rentenversicherung. Die Krankenkasse kann Beiträge nach Vorlage des Einkommensteuerbescheids endgültig festsetzen. Die hier angezeigten Beträge sind eine Schätzung.',
  smallBusinessNotice: 'Überschreitet dein Umsatz im laufenden Jahr die maßgebliche Grenze, kann die Kleinunternehmerregelung bereits ab dem Umsatz entfallen, mit dem die Grenze überschritten wird. Die Anzeige ist eine Schätzung anhand der erfassten Umsätze.',
  educationNotice: 'Eine Umsatzsteuerbefreiung für Unterricht nach § 4 Nr. 21 UStG hängt von den gesetzlichen Voraussetzungen und gegebenenfalls einer Bescheinigung der zuständigen Landesbehörde ab. Für selbständige Lehrkräfte gelten eigene Voraussetzungen. Prüfe den Einzelfall und die erforderlichen Nachweise.',
  pensionNotice: 'Ob für dich Rentenversicherungspflicht besteht, hängt von deiner konkreten Tätigkeit und persönlichen Situation ab. SoloOffice leitet den Status nicht allein aus deinem Beruf ab. Bei offenen Fragen kann die Deutsche Rentenversicherung deinen Status prüfen.',
  kskNotice: 'Ob eine Versicherung über die Künstlersozialkasse möglich ist, prüft die Künstlersozialkasse anhand der persönlichen und beruflichen Voraussetzungen. Die Anzeige nimmt keine Einstufung vor.',
  vatRoughNotice: 'Die Umsatzsteuer-Rücklage ist nur ein grober Richtwert aus den erfassten Zahlungen und Steuersätzen. Vorsteuer und besondere Sachverhalte können unvollständig sein. Die Anzeige ersetzt keine Umsatzsteuer-Voranmeldung.',
  missingYearNotice: (requestedYear, parameterYear, asOf) => `Für ${requestedYear} liegen keine geprüften Parameter vor. Diese Schätzung verwendet Werte für ${parameterYear} (Stand ${asOf}).`,
  helpTitle: 'So entstehen die Schätzungen',
});
