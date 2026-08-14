/**
 * Migration: Unveränderbare Änderungshistorie für Rechnungen.
 *
 * Bisher waren Rechnungen nach dem Versand ohne jede Spur änderbar. Die
 * Oberfläche warnt zwar, das Backend nahm die Änderung aber kommentarlos an
 * und es blieb kein Nachweis, was vorher darin stand.
 *
 * Aufbau bewusst identisch zu `017_euer_audit`: Ein Trigger schreibt jede
 * Änderung fort, ein zweiter verhindert, dass die Historie selbst angefasst
 * wird. Die Protokollierung liegt damit in der Datenbank und nicht in der
 * Anwendung – sie greift auch bei direkten Zugriffen und lässt sich nicht
 * versehentlich umgehen.
 *
 * Positionen werden mitprotokolliert, weil sich der Rechnungsbetrag über sie
 * ändert. Reine Statuswechsel (versendet, bezahlt, gemahnt) sind ebenfalls
 * Teil der Historie: Wann eine Rechnung als bezahlt galt, ist nachweisrelevant.
 */

export const name = '029_invoice_audit';

const workspaceExpression = "NULLIF(current_setting('app.workspace_id', true), '')::uuid";

export async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS invoice_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL DEFAULT (${workspaceExpression}) REFERENCES workspaces(id),
      invoice_id UUID,
      invoice_number VARCHAR(50),
      record_type VARCHAR(20) NOT NULL CHECK (record_type IN ('invoice', 'item')),
      action VARCHAR(20) NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
      old_data JSONB,
      new_data JSONB,
      changed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      changed_by UUID
    )
  `);
  await client.query('CREATE INDEX IF NOT EXISTS invoice_history_invoice_idx ON invoice_history(workspace_id, invoice_id, changed_at DESC)');
  await client.query('DROP POLICY IF EXISTS workspace_access_invoice_history ON invoice_history');
  await client.query(`
    CREATE POLICY workspace_access_invoice_history ON invoice_history
      USING (workspace_id = ${workspaceExpression})
      WITH CHECK (workspace_id = ${workspaceExpression})
  `);
  await client.query('ALTER TABLE invoice_history ENABLE ROW LEVEL SECURITY');
  await client.query('ALTER TABLE invoice_history FORCE ROW LEVEL SECURITY');

  // Historieneinträge müssen ihre fachliche Referenz auch dann behalten, wenn
  // beim Wiederherstellen die aktuellen EÜR-Sätze vorübergehend ersetzt
  // werden. ON DELETE SET NULL würde außerdem den unveränderbaren Datensatz
  // selbst aktualisieren und damit am Schutz-Trigger scheitern.
  await client.query('ALTER TABLE euer_entry_history DROP CONSTRAINT IF EXISTS euer_entry_history_euer_entry_id_fkey');

  await client.query(`
    CREATE OR REPLACE FUNCTION prevent_invoice_history_mutation()
    RETURNS TRIGGER AS $$
    BEGIN
      IF current_setting('app.allow_history_purge', true) = 'true' THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'Rechnungshistorie ist unveränderbar';
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Dieselbe eng begrenzte Ausnahme braucht die bereits vorhandene
  // EÜR-Historie für die ausdrücklich bestätigte Konto-/Workspace-Löschung.
  // Im normalen Betrieb ist die Sitzungsvariable leer und der Schutz bleibt
  // unverändert aktiv.
  await client.query(`
    CREATE OR REPLACE FUNCTION prevent_euer_history_mutation()
    RETURNS TRIGGER AS $$
    BEGIN
      IF current_setting('app.allow_history_purge', true) = 'true' THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'EÜR-Historie ist unveränderbar';
    END;
    $$ LANGUAGE plpgsql;
  `);

  await client.query(`
    CREATE OR REPLACE FUNCTION record_euer_entry_history()
    RETURNS TRIGGER AS $$
    BEGIN
      IF current_setting('app.audit_disabled', true) = 'true' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END IF;

      INSERT INTO euer_entry_history (euer_entry_id, action, reason, old_data, new_data)
      VALUES (
        CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
        CASE WHEN TG_OP = 'INSERT' THEN 'created' WHEN TG_OP = 'DELETE' THEN 'voided' WHEN NEW.status = 'voided' THEN 'voided' ELSE 'updated' END,
        CASE WHEN TG_OP = 'INSERT' THEN NEW.correction_reason WHEN TG_OP = 'DELETE' THEN OLD.correction_reason ELSE COALESCE(NEW.correction_reason, OLD.correction_reason) END,
        CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
        CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END
      );
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await client.query('DROP TRIGGER IF EXISTS invoice_history_immutable_trigger ON invoice_history');
  await client.query(`
    CREATE TRIGGER invoice_history_immutable_trigger
    BEFORE UPDATE OR DELETE ON invoice_history
    FOR EACH ROW EXECUTE FUNCTION prevent_invoice_history_mutation()
  `);

  await client.query(`
    CREATE OR REPLACE FUNCTION record_invoice_history()
    RETURNS TRIGGER AS $$
    DECLARE
      acting_user UUID;
    BEGIN
      IF current_setting('app.audit_disabled', true) = 'true' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END IF;

      -- Der angemeldete Benutzer steht in der Sitzungsvariablen, die
      -- database.js vor jeder Abfrage setzt. Fehlt sie (Migration, Wartung),
      -- bleibt das Feld leer statt die Änderung zu blockieren.
      BEGIN
        acting_user := NULLIF(current_setting('app.user_id', true), '')::uuid;
      EXCEPTION WHEN others THEN
        acting_user := NULL;
      END;

      INSERT INTO invoice_history (workspace_id, invoice_id, invoice_number, record_type, action, old_data, new_data, changed_by)
      VALUES (
        CASE WHEN TG_OP = 'DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END,
        CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
        CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_number ELSE NEW.invoice_number END,
        'invoice',
        CASE WHEN TG_OP = 'INSERT' THEN 'created' WHEN TG_OP = 'DELETE' THEN 'deleted' ELSE 'updated' END,
        CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
        CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
        acting_user
      );

      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await client.query('DROP TRIGGER IF EXISTS invoices_history_trigger ON invoices');
  await client.query(`
    CREATE TRIGGER invoices_history_trigger
    AFTER INSERT OR UPDATE OR DELETE ON invoices
    FOR EACH ROW EXECUTE FUNCTION record_invoice_history()
  `);

  await client.query(`
    CREATE OR REPLACE FUNCTION record_invoice_item_history()
    RETURNS TRIGGER AS $$
    DECLARE
      acting_user UUID;
      target_invoice UUID;
      target_number VARCHAR(50);
    BEGIN
      IF current_setting('app.audit_disabled', true) = 'true' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END IF;

      BEGIN
        acting_user := NULLIF(current_setting('app.user_id', true), '')::uuid;
      EXCEPTION WHEN others THEN
        acting_user := NULL;
      END;

      target_invoice := CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
      SELECT invoice_number INTO target_number FROM invoices WHERE id = target_invoice;

      INSERT INTO invoice_history (workspace_id, invoice_id, invoice_number, record_type, action, old_data, new_data, changed_by)
      VALUES (
        CASE WHEN TG_OP = 'DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END,
        target_invoice,
        target_number,
        'item',
        CASE WHEN TG_OP = 'INSERT' THEN 'created' WHEN TG_OP = 'DELETE' THEN 'deleted' ELSE 'updated' END,
        CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
        CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
        acting_user
      );

      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await client.query('DROP TRIGGER IF EXISTS invoice_items_history_trigger ON invoice_items');
  await client.query(`
    CREATE TRIGGER invoice_items_history_trigger
    AFTER INSERT OR UPDATE OR DELETE ON invoice_items
    FOR EACH ROW EXECUTE FUNCTION record_invoice_item_history()
  `);
}

export async function down(client) {
  await client.query('DROP TRIGGER IF EXISTS invoice_items_history_trigger ON invoice_items');
  await client.query('DROP TRIGGER IF EXISTS invoices_history_trigger ON invoices');
  await client.query('DROP TRIGGER IF EXISTS invoice_history_immutable_trigger ON invoice_history');
  await client.query('DROP FUNCTION IF EXISTS record_invoice_item_history()');
  await client.query('DROP FUNCTION IF EXISTS record_invoice_history()');
  await client.query('DROP FUNCTION IF EXISTS prevent_invoice_history_mutation()');
  await client.query('DROP POLICY IF EXISTS workspace_access_invoice_history ON invoice_history');
  await client.query('DROP TABLE IF EXISTS invoice_history');
  await client.query(`
    CREATE OR REPLACE FUNCTION prevent_euer_history_mutation()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'EÜR-Historie ist unveränderbar';
    END;
    $$ LANGUAGE plpgsql;
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
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  // NOT VALID erlaubt das Zurückrollen auch dann, wenn eine erhaltene
  // Historie bereits auf einen gelöschten aktuellen Datensatz verweist.
  await client.query(`
    ALTER TABLE euer_entry_history
      ADD CONSTRAINT euer_entry_history_euer_entry_id_fkey
      FOREIGN KEY (euer_entry_id) REFERENCES euer_entries(id) ON DELETE SET NULL NOT VALID
  `);
}
