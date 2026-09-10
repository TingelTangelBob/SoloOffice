# Lokale OCR-Ressourcenlimits

SoloOffice verarbeitet Belege lokal im Backend-Container. Die OCR-Warteschlange
ist bewusst nur pro Backend-Prozess im Arbeitsspeicher vorhanden. Sie ist keine
persistent gespeicherte Queue: Bei einem Neustart gehen wartende Aufträge
verloren und werden nicht automatisch wiederaufgenommen.

## Standardwerte

| Variable | Standard | Bedeutung |
| --- | ---: | --- |
| `OCR_CONCURRENCY_LIMIT` | `2` | Maximale Zahl gleichzeitig laufender lokaler OCR-Aufträge |
| `OCR_MAX_PENDING` | `32` | Maximale Zahl zusätzlich wartender Aufträge im Prozess |
| `OCR_WORKSPACE_LIMIT` | `4` | Maximale Zahl laufender und wartender Aufträge eines Workspaces |
| `OCR_TIMEOUT_MS` | `120000` | Zeitlimit pro lokalem OCR-Unterprozess |

Alle Werte müssen positive Ganzzahlen sein. Ungültige oder fehlende Werte fallen
auf den jeweiligen Standard zurück. Die Workspace-Grenze verwendet ausschließlich
die serverseitig authentifizierte Workspace-ID aus `req.auth`.

Wird eine Grenze vor dem Einreihen erreicht, antworten die Receipt-Endpunkte mit
HTTP `429` und dem maschinenlesbaren Code `OCR_QUEUE_OVERLOADED`. Die Antwort
enthält `retryAfterSeconds`; zusätzlich wird der HTTP-Header `Retry-After`
gesetzt. Der Beleg wird bei dieser Überlastung nicht als OCR-Fehler gespeichert.

Die Zähler werden bei Erfolg, Fehler, Timeout und abgewiesenem Auftrag korrekt
freigegeben. Die bestehende Begrenzung von 50 PDF-Seiten, 8 MiB OCR-Ausgabe und
25 MiB Uploadgröße bleibt bestehen. Wartende Aufträge werden grundsätzlich in
Einreichungsreihenfolge bedient; wenn mehrere Workspaces warten, wird dabei der
zuletzt bediente Workspace übersprungen, sofern ein anderer Workspace wartet.
