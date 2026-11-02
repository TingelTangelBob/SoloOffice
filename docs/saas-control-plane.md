# SaaS-Control-Plane

Abrechnung, Tarife, Zahlungsdaten und Sperren gehören laut
[`SoloOffice-Betriebsmodell.md`](../Projektordner/SoloOffice-Betriebsmodell.md)
in einen separaten Control-Plane-Dienst. SoloOffice bleibt die AGPL-lizenzierte
Fachapplikation und erhält keinen versteckten SaaS-Sonderfunktionsumfang.

Der Control Plane muss vor einem gehosteten Start mindestens diese Grenzen
besitzen:

- öffentliche Registrierung und E-Mail-Verifikation außerhalb der Fachapp,
- Plan-/Limitprüfung vor Workspace-Anlage und Speicherwachstum,
- idempotente Bereitstellung und Sperrung von Workspaces,
- Zahlungsanbieter-Webhooks mit Signaturprüfung und Wiederholschutz,
- Auditierbarkeit von Tarif- und Sperrentscheidungen,
- Export-/Löschworkflow mit der Workspace- und Backup-Funktion.

Ein erster API-/Betriebsstand liegt jetzt als separater Dienst unter
[`../../control-plane`](../../control-plane). Er enthält die technische
Grundlage für Konto, E-Mail-Verifikation, Google-Login, Tarif, Stripe-
Checkout, Kundenportal, Webhook-Signaturprüfung, Deduplizierung,
Kulanzstatus, Zahlungshistorie und Admin-Kennzahlen.

Der Stand ist noch kein öffentlicher Verkaufsstart. Die Stripe-Price-IDs,
Schlüssel, Steuerkonfiguration und Rechtstexte werden ausschließlich über die
Umgebung gesetzt.

Die Fachapp-Seite der Bereitstellung und Sperre ist seit AP-4.4 vorhanden:
`/internal/control-plane` mit HMAC-Signatur, Zeitfenster, Idempotenz und
Sperrzustand am Workspace. Beschreibung in
[`control-plane-internal-api.md`](control-plane-internal-api.md). Eine Sperre
lässt Lesen und Export ausdrücklich zu und verweigert nur Schreibzugriffe.

Offen bleiben der Nachweis gegen einen laufenden Control Plane, der Export-
und Löschworkflow (AP-5.5) sowie ein sichtbarer Sperrhinweis in der
Oberfläche. Bis dahin bleibt der SaaS-Betrieb ein 🟠 offener Betriebsbaustein;
Self-Hosting ist davon nicht abhängig.

## Workspace-Kapazität

Die Fachapp besitzt derzeit keinen Tarifvertrag mit Plan- oder Speicherquoten
pro Workspace. Deshalb setzt `REGISTRATION_MAX_WORKSPACES` ein
instanzweites Maximum für Registrierungen, normale Workspace-Erstellung und
Control-Plane-Bereitstellung. Der Standardwert ist 0 (kein Maximum), sodass
Self-Hosting ohne ausdrückliche Konfiguration unverändert bleibt. Bei einem
positiven Wert werden parallele Anlagevorgänge transaktionsweit serialisiert
und bei Erreichen des Maximums mit HTTP 429 und `WORKSPACE_LIMIT_REACHED`
abgewiesen. Die Workspace-Verwaltung zeigt Verbrauch und Maximum der Instanz.

Das ist eine Kapazitätsgrenze für die Instanz und keine individuelle
Tarifquote. Für Speicher-, Mitglieder- oder monatliche Rechnungsquoten fehlt
im bestehenden App-/Control-Plane-Vertrag eine definierte Planstruktur samt
Zählregeln; solche Grenzen werden daher hier nicht erfunden.
