/**
 * Migration: E-Mail-Benachrichtigungen je Benutzer und Workspace.
 *
 * Ein Benutzer entscheidet je Arbeitsbereich, ob er eine tägliche
 * Zusammenfassung erhalten will: abgeschlossene Aufträge ohne Rechnung,
 * Rechnungsentwürfe, die seit einigen Tagen nicht versendet wurden, und
 * überfällige Rechnungen. Die Uhrzeit gilt in der Zeitzone des Unternehmens.
 *
 * Die Tabelle steht außerhalb der Workspace-RLS: der Versand läuft aus einem
 * Hintergrundlauf ohne Nutzersitzung und muss die Einstellungen aller
 * Arbeitsbereiche lesen. Fachdaten enthält sie nicht; die Route erlaubt nur
 * den Zugriff auf die eigene Zeile des aktiven Workspace.
 */

export const name = '041_user_notification_settings';

export async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS user_notification_settings (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      jobs_completed BOOLEAN NOT NULL DEFAULT FALSE,
      invoice_drafts BOOLEAN NOT NULL DEFAULT FALSE,
      invoice_draft_days INTEGER NOT NULL DEFAULT 3 CHECK (invoice_draft_days BETWEEN 1 AND 60),
      invoices_overdue BOOLEAN NOT NULL DEFAULT FALSE,
      digest_hour INTEGER NOT NULL DEFAULT 8 CHECK (digest_hour BETWEEN 0 AND 23),
      last_digest_day DATE,
      last_digest_at TIMESTAMP WITH TIME ZONE,
      last_digest_error TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      PRIMARY KEY (user_id, workspace_id)
    )
  `);
  // Der Hintergrundlauf sucht nur Zeilen mit mindestens einem aktiven Hinweis.
  await client.query(`
    CREATE INDEX IF NOT EXISTS user_notification_settings_active_idx
      ON user_notification_settings (digest_hour)
      WHERE jobs_completed OR invoice_drafts OR invoices_overdue
  `);
}

export async function down(client) {
  await client.query('DROP TABLE IF EXISTS user_notification_settings');
}
