/**
 * Migration: Datenübernahme mit Importläufen, Einnahmen mit Kundenbezug und
 * übernommenen Rechnungen.
 *
 * - `import_runs` und `import_run_items` halten fest, welcher Import welche
 *   Datensätze angelegt oder geändert hat. Solange ein Lauf nicht
 *   abgeschlossen ist, kann er rückgängig gemacht werden.
 * - `euer_entries.customer_id` ordnet Einnahmen ohne Rechnung einem Kunden zu.
 * - `invoices.origin` kennzeichnet Rechnungen aus einem anderen Programm. Ihr
 *   Original liegt in `invoice_original_documents`; SoloOffice erzeugt für sie
 *   kein eigenes Dokument.
 * - `company.import_cutover_date` ist der Stichtag des Umzugs.
 */

export const name = '044_data_import_runs';

const workspaceExpression = "NULLIF(current_setting('app.workspace_id', true), '')::uuid";

async function enableWorkspaceRls(client, table) {
  await client.query(`DROP POLICY IF EXISTS ${table}_workspace_access ON ${table}`);
  await client.query(`
    CREATE POLICY ${table}_workspace_access ON ${table}
      USING (workspace_id = ${workspaceExpression})
      WITH CHECK (workspace_id = ${workspaceExpression})
  `);
  await client.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
  await client.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
}

export async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS import_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
        DEFAULT (${workspaceExpression}),
      resource VARCHAR(40) NOT NULL,
      file_name VARCHAR(255),
      file_hash VARCHAR(64),
      source_headers JSONB NOT NULL DEFAULT '[]'::jsonb,
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      report JSONB NOT NULL DEFAULT '[]'::jsonb,
      status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'reverted')),
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      confirmed_at TIMESTAMP WITH TIME ZONE,
      reverted_at TIMESTAMP WITH TIME ZONE
    )
  `);
  await client.query('CREATE INDEX IF NOT EXISTS import_runs_workspace_idx ON import_runs(workspace_id, created_at DESC)');
  await enableWorkspaceRls(client, 'import_runs');

  await client.query(`
    CREATE TABLE IF NOT EXISTS import_run_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
        DEFAULT (${workspaceExpression}),
      run_id UUID NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      table_name VARCHAR(60) NOT NULL,
      record_id TEXT NOT NULL,
      action VARCHAR(20) NOT NULL CHECK (action IN ('created', 'updated')),
      old_data JSONB
    )
  `);
  await client.query('CREATE INDEX IF NOT EXISTS import_run_items_run_idx ON import_run_items(run_id, seq)');
  await client.query('CREATE INDEX IF NOT EXISTS import_run_items_record_idx ON import_run_items(table_name, record_id)');
  await enableWorkspaceRls(client, 'import_run_items');

  await client.query('ALTER TABLE euer_entries ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL');
  await client.query('CREATE INDEX IF NOT EXISTS euer_entries_customer_idx ON euer_entries(customer_id) WHERE customer_id IS NOT NULL');

  await client.query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS origin VARCHAR(20) NOT NULL DEFAULT 'solooffice'");
  await client.query('ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_origin_check');
  await client.query("ALTER TABLE invoices ADD CONSTRAINT invoices_origin_check CHECK (origin IN ('solooffice', 'imported'))");

  await client.query(`
    CREATE TABLE IF NOT EXISTS invoice_original_documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
        DEFAULT (${workspaceExpression}),
      invoice_id UUID NOT NULL UNIQUE REFERENCES invoices(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      content TEXT NOT NULL,
      content_type VARCHAR(120) NOT NULL,
      size INTEGER NOT NULL CHECK (size > 0),
      sha256 CHAR(64) NOT NULL,
      uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);
  await enableWorkspaceRls(client, 'invoice_original_documents');

  await client.query('ALTER TABLE company ADD COLUMN IF NOT EXISTS import_cutover_date DATE');

  // Ausgestellte Rechnungen bleiben unveränderbar. Einzige Ausnahme: Das
  // Rückgängigmachen eines noch nicht abgeschlossenen Imports entfernt die
  // dabei übernommenen Rechnungen wieder. Die Löschung wird weiterhin in der
  // Rechnungshistorie protokolliert.
  await client.query(`
    CREATE OR REPLACE FUNCTION protect_issued_invoice() RETURNS TRIGGER AS $$
    BEGIN
      IF current_setting('app.audit_disabled', true) = 'true'
         OR current_setting('app.allow_history_purge', true) = 'true' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END IF;
      IF TG_OP = 'DELETE' AND OLD.origin = 'imported'
         AND current_setting('app.import_revert', true) = 'true' THEN
        RETURN OLD;
      END IF;
      IF OLD.status <> 'draft' THEN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'Ausgestellte Rechnungen können nicht gelöscht werden' USING ERRCODE = '23514';
        END IF;
        IF NEW.status = 'draft' OR
          (to_jsonb(NEW) - ARRAY['status','last_reminder_date','last_reminder_sent_at','max_reminder_stage','updated_at'])
          IS DISTINCT FROM
          (to_jsonb(OLD) - ARRAY['status','last_reminder_date','last_reminder_sent_at','max_reminder_stage','updated_at']) THEN
          RAISE EXCEPTION 'Ausgestellte Rechnungen sind inhaltlich unveränderbar' USING ERRCODE = '23514';
        END IF;
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await client.query(`
    CREATE OR REPLACE FUNCTION protect_issued_invoice_child() RETURNS TRIGGER AS $$
    DECLARE target_id UUID; target_status TEXT; target_origin TEXT;
    BEGIN
      IF current_setting('app.audit_disabled', true) = 'true'
         OR current_setting('app.allow_history_purge', true) = 'true' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END IF;
      -- Beide Eltern prüfen: Eine Position darf auch nicht aus einer bereits
      -- ausgestellten Rechnung in einen anderen Entwurf verschoben werden.
      FOR target_id IN
        SELECT DISTINCT id FROM unnest(ARRAY[
          CASE WHEN TG_OP <> 'INSERT' THEN OLD.invoice_id END,
          CASE WHEN TG_OP <> 'DELETE' THEN NEW.invoice_id END
        ]) AS ids(id) WHERE id IS NOT NULL ORDER BY id
      LOOP
        SELECT status, origin INTO target_status, target_origin FROM invoices WHERE id = target_id FOR UPDATE;
        IF TG_OP = 'DELETE' AND target_origin = 'imported'
           AND current_setting('app.import_revert', true) = 'true' THEN
          CONTINUE;
        END IF;
        IF target_status <> 'draft' THEN
          RAISE EXCEPTION 'Positionen und Anhänge ausgestellter Rechnungen sind unveränderbar' USING ERRCODE = '23514';
        END IF;
      END LOOP;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
}

export async function down(client) {
  await client.query(`
    CREATE OR REPLACE FUNCTION protect_issued_invoice_child() RETURNS TRIGGER AS $$
    DECLARE target_id UUID; target_status TEXT;
    BEGIN
      IF current_setting('app.audit_disabled', true) = 'true'
         OR current_setting('app.allow_history_purge', true) = 'true' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END IF;
      FOR target_id IN
        SELECT DISTINCT id FROM unnest(ARRAY[
          CASE WHEN TG_OP <> 'INSERT' THEN OLD.invoice_id END,
          CASE WHEN TG_OP <> 'DELETE' THEN NEW.invoice_id END
        ]) AS ids(id) WHERE id IS NOT NULL ORDER BY id
      LOOP
        SELECT status INTO target_status FROM invoices WHERE id = target_id FOR UPDATE;
        IF target_status <> 'draft' THEN
          RAISE EXCEPTION 'Positionen und Anhänge ausgestellter Rechnungen sind unveränderbar' USING ERRCODE = '23514';
        END IF;
      END LOOP;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await client.query(`
    CREATE OR REPLACE FUNCTION protect_issued_invoice() RETURNS TRIGGER AS $$
    BEGIN
      IF current_setting('app.audit_disabled', true) = 'true'
         OR current_setting('app.allow_history_purge', true) = 'true' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END IF;
      IF OLD.status <> 'draft' THEN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'Ausgestellte Rechnungen können nicht gelöscht werden' USING ERRCODE = '23514';
        END IF;
        IF NEW.status = 'draft' OR
          (to_jsonb(NEW) - ARRAY['status','last_reminder_date','last_reminder_sent_at','max_reminder_stage','updated_at'])
          IS DISTINCT FROM
          (to_jsonb(OLD) - ARRAY['status','last_reminder_date','last_reminder_sent_at','max_reminder_stage','updated_at']) THEN
          RAISE EXCEPTION 'Ausgestellte Rechnungen sind inhaltlich unveränderbar' USING ERRCODE = '23514';
        END IF;
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await client.query('ALTER TABLE company DROP COLUMN IF EXISTS import_cutover_date');
  await client.query('DROP TABLE IF EXISTS invoice_original_documents');
  await client.query('ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_origin_check');
  await client.query('ALTER TABLE invoices DROP COLUMN IF EXISTS origin');
  await client.query('DROP INDEX IF EXISTS euer_entries_customer_idx');
  await client.query('ALTER TABLE euer_entries DROP COLUMN IF EXISTS customer_id');
  await client.query('DROP TABLE IF EXISTS import_run_items');
  await client.query('DROP TABLE IF EXISTS import_runs');
}
