/**
 * Migration: administrative Workspace-Schnittstelle für den Control Plane (AP-4.4).
 *
 * Die Sperre ist bewusst ein Zustand am Workspace und kein Datenlöschvorgang:
 * `suspended_at` markiert die Sperre, Lesen und Export bleiben erlaubt.
 *
 * Zusätzlich entstehen drei Verwaltungstabellen. Sie enthalten keine
 * Fachdaten eines Workspaces und stehen deshalb bewusst außerhalb der
 * Workspace-RLS: die Zeilen sind gerade nicht aus einer Nutzersitzung heraus
 * erreichbar, sondern nur über die signierte interne Schnittstelle.
 */

export const name = '040_control_plane_workspace_admin';

export async function up(client) {
  await client.query(`
    ALTER TABLE workspaces
      ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS suspended_reason TEXT
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS workspaces_suspended_idx
      ON workspaces(suspended_at)
      WHERE suspended_at IS NOT NULL
  `);

  // Bindung zwischen Control-Plane-Konto und Fachapp-Workspace. Die
  // E-Mail-Adresse ist der Eigentümeranspruch; `owner_user_id` wird gesetzt,
  // sobald ein Konto dahintersteht.
  await client.query(`
    CREATE TABLE IF NOT EXISTS control_plane_workspaces (
      workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
      owner_email VARCHAR(255) NOT NULL,
      owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      idempotency_key VARCHAR(255) UNIQUE NOT NULL,
      operation_id VARCHAR(100),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS control_plane_workspaces_owner_email_idx
      ON control_plane_workspaces (LOWER(owner_email))
  `);

  // Wiederholte Aufrufe desselben Vorgangs dürfen keinen zweiten Workspace
  // erzeugen. Die gespeicherte Antwort wird bei gleichem Schlüssel und
  // gleichem Anfrageinhalt erneut ausgeliefert.
  await client.query(`
    CREATE TABLE IF NOT EXISTS control_plane_requests (
      idempotency_key VARCHAR(255) PRIMARY KEY,
      operation VARCHAR(40) NOT NULL,
      request_hash CHAR(64) NOT NULL,
      operation_id VARCHAR(100),
      workspace_id UUID,
      response_status INTEGER NOT NULL,
      response_body JSONB NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  // Jede Bereitstellungs- und Sperrentscheidung bleibt nachvollziehbar.
  await client.query(`
    CREATE TABLE IF NOT EXISTS control_plane_audit_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      operation VARCHAR(40) NOT NULL,
      workspace_id UUID,
      idempotency_key VARCHAR(255),
      operation_id VARCHAR(100),
      previous_state VARCHAR(30),
      next_state VARCHAR(30),
      reason TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS control_plane_audit_events_workspace_idx
      ON control_plane_audit_events(workspace_id, created_at DESC)
  `);

  // Eine vom Control Plane bereitgestellte Instanz hat zunächst keinen
  // Benutzer. Der Eigentümeranspruch läuft deshalb über eine Einladung mit
  // der Rolle 'owner' und ohne einladendes Konto.
  await client.query('ALTER TABLE workspace_invitations ALTER COLUMN invited_by DROP NOT NULL');
  await client.query('ALTER TABLE workspace_invitations DROP CONSTRAINT IF EXISTS workspace_invitations_role_check');
  await client.query(`
    ALTER TABLE workspace_invitations
      ADD CONSTRAINT workspace_invitations_role_check
      CHECK (role IN ('owner', 'admin', 'member', 'viewer'))
  `);
}

export async function down(client) {
  await client.query('DROP TABLE IF EXISTS control_plane_audit_events');
  await client.query('DROP TABLE IF EXISTS control_plane_requests');
  await client.query('DROP TABLE IF EXISTS control_plane_workspaces');
  await client.query('DROP INDEX IF EXISTS workspaces_suspended_idx');
  await client.query(`
    ALTER TABLE workspaces
      DROP COLUMN IF EXISTS suspended_at,
      DROP COLUMN IF EXISTS suspended_reason
  `);

  // Offene Eigentümer-Einladungen fallen aus der engeren Prüfregel heraus und
  // werden vor dem Zurücksetzen entfernt.
  await client.query("DELETE FROM workspace_invitations WHERE role = 'owner' OR invited_by IS NULL");
  await client.query('ALTER TABLE workspace_invitations DROP CONSTRAINT IF EXISTS workspace_invitations_role_check');
  await client.query(`
    ALTER TABLE workspace_invitations
      ADD CONSTRAINT workspace_invitations_role_check
      CHECK (role IN ('admin', 'member', 'viewer'))
  `);
  await client.query('ALTER TABLE workspace_invitations ALTER COLUMN invited_by SET NOT NULL');
}
