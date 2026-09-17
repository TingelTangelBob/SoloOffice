# Interne Control-Plane-Schnittstelle (AP-4.4)

Diese Schnittstelle erlaubt dem Control Plane, Arbeitsbereiche in SoloOffice
anzulegen und zu sperren. Sie enthält bewusst **keine** Preis-, Tarif- oder
Abrechnungslogik — die bleibt im Control Plane. Der hier beschriebene Teil
gehört zur AGPL-Anwendung und wird mit veröffentlicht.

Gegenstück im Control Plane: `control-plane/src/soloOfficeAdapter.js`.

## Betriebsvoraussetzungen

| Variable | Bedeutung |
|---|---|
| `CONTROL_PLANE_INTERNAL_SECRET` | Gemeinsames Geheimnis, mindestens 32 Zeichen. Im Control Plane steht **derselbe Wert** unter `SOLOOFFICE_INTERNAL_SECRET`. |
| `CONTROL_PLANE_INTERNAL_TIMESTAMP_TOLERANCE_SECONDS` | Erlaubtes Zeitfenster der Signatur, Standard 300, Höchstwert 3600. |
| `CONTROL_PLANE_INTERNAL_RATE_LIMIT_MAX` | Aufrufe je Minute und Quell-IP, Standard 60. |
| `APP_BASE_URL` (ersatzweise `CORS_ORIGIN`) | Öffentliche Adresse für den Einladungslink an neue Eigentümer. |

Ohne gesetztes oder mit zu kurzem Geheimnis antwortet **jeder** Endpunkt mit
`503` und `code: CONTROL_PLANE_API_NOT_CONFIGURED`. Es gibt keinen stillen
Ersatzpfad und keine Notfall-Freigabe.

Der Control Plane setzt zusätzlich `SOLOOFFICE_INTERNAL_URL` auf die
Basisadresse der Fachapp, zum Beispiel `http://backend:3001`.

## Erreichbarkeit

Die Endpunkte liegen unter `/internal/control-plane` und damit **außerhalb**
von `/api`:

- keine Nutzersitzung, kein Sitzungscookie, keine CSRF-Prüfung,
- keine CORS-Freigabe,
- `nginx.conf` reicht ausschließlich `/api/` nach außen weiter; `/internal/`
  ist nur im internen Docker-Netz erreichbar.

Der Reverse-Proxy darf diesen Pfad nicht öffentlich veröffentlichen. Steht der
Control Plane auf einer anderen Maschine, gehört dazwischen ein eigener,
authentifizierter Kanal (VPN, WireGuard, mTLS) — die Signatur ersetzt keine
Transportverschlüsselung.

## Authentifizierung

Jede Anfrage trägt drei Kopfzeilen:

| Kopfzeile | Inhalt |
|---|---|
| `X-Control-Plane-Timestamp` | Unix-Zeit in Sekunden |
| `X-Control-Plane-Signature` | HMAC-SHA256, Hex |
| `Idempotency-Key` | Vorgangsschlüssel, höchstens 255 Zeichen |

Signiert wird die Zeichenkette

```
{timestamp}.{method}.{path}.{body}
```

- `method`: HTTP-Methode in Großbuchstaben, zum Beispiel `POST`
- `path`: Pfad ohne Hostnamen und ohne Query, zum Beispiel
  `/internal/control-plane/workspaces/<id>/suspend`
- `body`: der gesendete JSON-Rohtext, unverändert

Beispiel:

```js
const timestamp = Math.floor(Date.now() / 1000).toString();
const body = JSON.stringify({ name: 'Beispiel GmbH', ownerEmail: 'inhaber@example.com' });
const signature = createHmac('sha256', process.env.SOLOOFFICE_INTERNAL_SECRET)
  .update(`${timestamp}.POST./internal/control-plane/workspaces.${body}`)
  .digest('hex');
```

Die Prüfung vergleicht zeitkonstant. Abgelehnt wird mit:

| Code | Status | Ursache |
|---|---|---|
| `CONTROL_PLANE_API_NOT_CONFIGURED` | 503 | Geheimnis fehlt oder ist zu kurz |
| `CONTROL_PLANE_TIMESTAMP_INVALID` | 401 | Zeitstempel fehlt oder ist kein Unix-Zeitwert |
| `CONTROL_PLANE_TIMESTAMP_EXPIRED` | 401 | Zeitstempel außerhalb des Fensters |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | Kopfzeile fehlt oder ist zu lang |
| `CONTROL_PLANE_SIGNATURE_INVALID` | 401 | Signatur passt nicht zu Methode, Pfad oder Inhalt |

## Endpunkte

### `POST /internal/control-plane/workspaces`

Legt einen Arbeitsbereich an.

```json
{ "name": "Beispiel GmbH", "ownerEmail": "inhaber@example.com", "operationId": "<binding-id>" }
```

Antwort `201`:

```json
{
  "workspaceId": "0f4c…-uuid",
  "name": "Beispiel GmbH",
  "slug": "beispiel-gmbh-1a2b3c",
  "status": "active",
  "createdAt": "2026-09-15T10:00:00.000Z",
  "owner": {
    "email": "inhaber@example.com",
    "binding": "invitation",
    "invitationExpiresAt": "2026-09-22T10:00:00.000Z",
    "invitationEmailSent": true
  }
}
```

Dabei entsteht dieselbe Grundausstattung wie bei einer Registrierung in der
Fachapp: Firmenstammsatz, ein Standard-Stundensatz und eine Materialvorlage.

Die Eigentümerbindung hat zwei Fälle:

- `binding: "account"` — zur Adresse existiert bereits ein aktives Konto. Es
  wird sofort Eigentümer des neuen Arbeitsbereichs.
- `binding: "invitation"` — es existiert kein Konto. Die Fachapp legt eine
  Einladung mit der Rolle `owner` an (sieben Tage gültig) und versendet den
  Link `<APP_BASE_URL>?invite=<token>`. Erst die Annahme erzeugt ein Konto mit
  selbst gewähltem Passwort. **Die Fachapp vergibt niemals ein Passwort und
  legt kein Konto ohne Zutun des Eigentümers an.**

Scheitert der E-Mail-Versand, bleibt die Einladung gültig; die Antwort meldet
`invitationEmailSent: false`. Mit `EXPOSE_INVITATION_TOKENS=true` enthält die
Antwort zusätzlich `owner.invitationLink` — nur für Prüfstände gedacht.

Fehler: `WORKSPACE_NAME_REQUIRED` (400), `OWNER_EMAIL_INVALID` (400),
`IDEMPOTENCY_KEY_CONFLICT` (409).

### `POST /internal/control-plane/workspaces/:id/suspend`

```json
{ "reason": "subscription:past_due" }
```

Antwort `200`:

```json
{
  "workspaceId": "0f4c…-uuid",
  "name": "Beispiel GmbH",
  "status": "suspended",
  "suspendedAt": "2026-09-15T10:05:00.000Z",
  "reason": "subscription:past_due",
  "changed": true
}
```

`changed: false` bedeutet, dass der Arbeitsbereich bereits im Zielzustand war.
Der Sperrzeitpunkt bleibt in diesem Fall unverändert.

### `POST /internal/control-plane/workspaces/:id/unsuspend`

Gleiche Form, Ergebnis `status: "active"` und `suspendedAt: null`.

Fehler beider Endpunkte: `WORKSPACE_ID_INVALID` (400), `WORKSPACE_NOT_FOUND`
(404).

## Wirkung einer Sperre

Eine Sperre ist ein Zustand am Arbeitsbereich (`workspaces.suspended_at`,
`workspaces.suspended_reason`) und **kein Löschvorgang**:

- Lesen bleibt erlaubt.
- Backup und Export bleiben erlaubt (`POST /api/backup/create`,
  `POST /api/backup/create-zip`) — obwohl es HTTP-Schreibaufrufe sind, sind sie
  fachlich Lesevorgänge.
- Jeder andere schreibende Aufruf unterhalb von `/api` wird mit `403` und
  `code: WORKSPACE_SUSPENDED` abgewiesen, einschließlich Wiederherstellung und
  Anlage weiterer Arbeitsbereiche aus dieser Sitzung heraus.
- Anmeldung, Abmeldung, Passwortwechsel und Workspace-Wechsel bleiben möglich.

Damit kann eine Sperre wegen offener Zahlungen niemanden von den eigenen Daten
und Belegen abschneiden. Der Sperrzustand steht in jeder Workspace-Antwort der
Anwendung als `suspended` und `suspendedAt`.

## Idempotenz

Jeder Aufruf braucht einen `Idempotency-Key`.

- **Bereitstellung**: streng über den Schlüssel. Ein wiederholter Aufruf gibt
  die gespeicherte Antwort zurück (Status `200` statt `201`) und legt keinen
  zweiten Arbeitsbereich an. Derselbe Schlüssel mit abweichendem Inhalt ergibt
  `409 IDEMPOTENCY_KEY_CONFLICT`.
- **Sperren und Entsperren**: idempotent über den Zielzustand. Der Zustand wird
  immer gesetzt, damit eine zwischenzeitliche Gegenbewegung nicht durch eine
  gespeicherte Antwort verdeckt wird. `changed` zeigt, ob sich etwas geändert
  hat.

Gleichzeitige Aufrufe mit demselben Schlüssel werden über einen
PostgreSQL-Advisory-Lock serialisiert.

## Nachvollziehbarkeit

Jede Entscheidung landet in `control_plane_audit_events` mit Vorgang,
Arbeitsbereich, Vorgangs- und Idempotency-Schlüssel, vorherigem und neuem
Zustand sowie Grund. Zustandslose Wiederholungen erzeugen keinen zweiten
Eintrag.

`control_plane_requests` hält Antwortstatus und Antwortinhalt je
Idempotency-Key. Einladungstoken werden dort **nicht** abgelegt. Wird ein
Arbeitsbereich gelöscht, werden diese Einträge mitgelöscht — sie enthalten die
Eigentümeradresse. Die Audit-Ereignisse bleiben erhalten; sie halten nur
Vorgang, Kennung und Grund fest.

`control_plane_workspaces` verbindet Arbeitsbereich, Eigentümeradresse und —
sobald vorhanden — das zugehörige Konto.

Diese drei Tabellen enthalten keine Fachdaten eines Arbeitsbereichs und stehen
deshalb außerhalb der Workspace-RLS: sie sind aus einer Nutzersitzung heraus
gar nicht erreichbar. Wird ein Arbeitsbereich gelöscht, fällt die Bindung
automatisch mit weg.

## Datenbank

Migration `040_control_plane_workspace_admin`:

- `workspaces.suspended_at`, `workspaces.suspended_reason`
- `control_plane_workspaces`, `control_plane_requests`,
  `control_plane_audit_events`
- `workspace_invitations` erlaubt zusätzlich die Rolle `owner` und eine
  Einladung ohne einladendes Konto (`invited_by IS NULL`)

## Prüfung

- `backend/test/controlPlaneAuth.test.js` — Signatur, Zeitfenster,
  Idempotency-Key, Abschaltung ohne Geheimnis, Wirkung der Sperre auf Lese-,
  Schreib- und Exportaufrufe. Läuft im Backend-Image-Build mit.
- `backend/test/integration/controlPlaneWorkspaces.test.js` — Bereitstellung,
  Grundausstattung, Eigentümerbindung, dreifacher identischer Aufruf,
  Schlüsselkonflikt, Sperren, Entsperren, erneutes Sperren und Audit-Verlauf
  gegen eine echte PostgreSQL-Datenbank (`npm run test:integration`).

Für einen Aufruf von Hand:

```bash
SECRET=… ; TS=$(date +%s) ; BODY='{"name":"Prüfung GmbH","ownerEmail":"pruefung@example.com"}'
SIG=$(printf '%s' "$TS.POST./internal/control-plane/workspaces.$BODY" \
  | openssl dgst -sha256 -hmac "$SECRET" -r | cut -d' ' -f1)
curl -sS -X POST http://127.0.0.1:3001/internal/control-plane/workspaces \
  -H 'Content-Type: application/json' \
  -H "X-Control-Plane-Timestamp: $TS" \
  -H "X-Control-Plane-Signature: $SIG" \
  -H 'Idempotency-Key: pruefung-1' \
  -d "$BODY"
```

## Offen

- Der Zustand `suspended` wird in der Oberfläche noch nicht als eigener Hinweis
  dargestellt. Ein Schreibversuch zeigt die deutsche Fehlermeldung der API; ein
  ruhiger Dauerhinweis im Kopfbereich fehlt noch.
- Der Control Plane meldet Löschung und Export eines Arbeitsbereichs noch nicht
  über diese Schnittstelle (AP-5.5).
