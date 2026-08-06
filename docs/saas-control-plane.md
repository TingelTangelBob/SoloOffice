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

Dieser Dienst ist in diesem Repository noch nicht implementiert. Bis dahin
bleibt der SaaS-Betrieb ein 🟠 offener Betriebsbaustein; Self-Hosting ist davon
nicht abhängig.
