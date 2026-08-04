/**
 * Migration: EÜR source metadata, corrections, voiding and append-only history
 */

export const name = '017_euer_audit';

export async function up(client) {
  await client.query(`
    ALTER TABLE euer_entries
      ADD COLUMN IF NOT EXISTS source_type VARCHAR(30) NOT NULL DEFAULT 'manual',
      ADD COLUMN IF NOT EXISTS source_id UUID,
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active',
      ADD COLUMN IF NOT EXISTS correction_reason TEXT
  `);

  await client.query('ALTER TABLE euer_entries DROP CONSTRAINT IF EXISTS euer_entries_source_type_check');
  await client.query(`
    ALTER TABLE euer_entries
      ADD CONSTRAINT euer_entries_source_type_check
      CHECK (source_type IN ('manual', 'invoice_payment', 'receipt', 'correction'))
  `);
  await client.query('ALTER TABLE euer_entries DROP CONSTRAINT IF EXISTS euer_entries_status_check');
  await client.query(`
    ALTER TABLE euer_entries
      ADD CONSTRAINT euer_entries_status_check
      CHECK (status IN ('active', 'voided'))
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS euer_entry_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      euer_entry_id UUID REFERENCES euer_entries(id) ON DELETE SET NULL,
      action VARCHAR(20) NOT NULL CHECK (action IN ('created', 'updated', 'voided')),
      reason TEXT,
      old_data JSONB,
      new_data JSONB,
      changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await client.query('CREATE INDEX IF NOT EXISTS euer_entry_history_entry_idx ON euer_entry_history(euer_entry_id, changed_at DESC)');
  await client.query(`
    CREATE OR REPLACE FUNCTION prevent_euer_history_mutation()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'EÜR-Historie ist unveränderbar';
    END;
    $$ LANGUAGE plpgsql;
  `);
  await client.query('DROP TRIGGER IF EXISTS euer_entry_history_immutable_trigger ON euer_entry_history');
  await client.query(`
    CREATE TRIGGER euer_entry_history_immutable_trigger
    BEFORE UPDATE OR DELETE ON euer_entry_history
    FOR EACH ROW EXECUTE FUNCTION prevent_euer_history_mutation()
  `);

  await client.query(`
    CREATE OR REPLACE FUNCTION record_euer_entry_history()
    RETURNS TRIGGER AS $$
    BEGIN
      INSERT INTO euer_entry_history (euer_entry_id, action, reason, old_data, new_data)
      VALUES (
        CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
        CASE WHEN TG_OP = 'INSERT' THEN 'created' WHEN TG_OP = 'DELETE' THEN 'voided' WHEN NEW.status = 'voided' THEN 'voided' ELSE 'updated' END,
        CASE WHEN TG_OP = 'INSERT' THEN NEW.correction_reason WHEN TG_OP = 'DELETE' THEN OLD.correction_reason ELSE COALESCE(NEW.correction_reason, OLD.correction_reason) END,
        CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
        CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END
      );
      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await client.query('DROP TRIGGER IF EXISTS euer_entries_history_trigger ON euer_entries');
  await client.query(`
    CREATE TRIGGER euer_entries_history_trigger
    AFTER INSERT OR UPDATE OR DELETE ON euer_entries
    FOR EACH ROW EXECUTE FUNCTION record_euer_entry_history()
  `);
}

export async function down(client) {
  await client.query('DROP TRIGGER IF EXISTS euer_entries_history_trigger ON euer_entries');
  await client.query('DROP TRIGGER IF EXISTS euer_entry_history_immutable_trigger ON euer_entry_history');
  await client.query('DROP FUNCTION IF EXISTS record_euer_entry_history()');
  await client.query('DROP FUNCTION IF EXISTS prevent_euer_history_mutation()');
  await client.query('DROP TABLE IF EXISTS euer_entry_history');
  await client.query(`
    ALTER TABLE euer_entries
      DROP CONSTRAINT IF EXISTS euer_entries_source_type_check,
      DROP CONSTRAINT IF EXISTS euer_entries_status_check,
      DROP COLUMN IF EXISTS source_type,
      DROP COLUMN IF EXISTS source_id,
      DROP COLUMN IF EXISTS status,
      DROP COLUMN IF EXISTS correction_reason
  `);
}
