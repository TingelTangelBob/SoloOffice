# Steuerprognose: Texte und Hilfe

Die verbindlichen UI-Texte für Steuerprognosen liegen zentral in
[`backend/shared/taxTexts.js`](../backend/shared/taxTexts.js). Frontend und
Backend können dieselbe ESM-Datei verwenden; die Typdeklaration steht in
[`backend/shared/taxTexts.d.ts`](../backend/shared/taxTexts.d.ts).

Die ausführliche Hilfe wird von `TaxForecastHelp` aus den versionierten
Parametern in `backend/shared/taxParams/` aufgebaut. Quellen, Parameterjahr,
Stand und bekannte Grenzen werden aus dem Parametersatz gelesen. Neue
Steuerjahre benötigen dort einen eigenen geprüften Datensatz und einen
Registry-Eintrag.

Alle Rechts- und Haftungstexte sind Entwürfe und vor einer Veröffentlichung
anwaltlich zu prüfen. Die Schätzungen sind unverbindliche Arbeitswerte; sie
stellen keine Steuer- oder Rechtsberatung und keine amtliche Erklärung dar.
