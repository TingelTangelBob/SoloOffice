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
Umgebung gesetzt. Die Anbindung an eine abgesicherte SoloOffice-Admin-API für
Provisioning und Sperren ist als Vertrag vorbereitet, aber noch nicht in der
Fachanwendung vorhanden. Bis zu diesem Nachweis bleibt der SaaS-Betrieb ein 🟠
offener Betriebsbaustein; Self-Hosting ist davon nicht abhängig.
