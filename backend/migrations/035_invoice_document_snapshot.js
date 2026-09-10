export const name = '035_invoice_document_snapshot';

export async function up(client) {
  await client.query('ALTER TABLE invoices ADD COLUMN IF NOT EXISTS document_snapshot JSONB');
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
    CREATE TRIGGER invoices_document_protection BEFORE UPDATE OR DELETE ON invoices
      FOR EACH ROW EXECUTE FUNCTION protect_issued_invoice();

    CREATE OR REPLACE FUNCTION protect_issued_invoice_child() RETURNS TRIGGER AS $$
    DECLARE target_id UUID; target_status TEXT;
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
        SELECT status INTO target_status FROM invoices WHERE id = target_id FOR UPDATE;
        IF target_status <> 'draft' THEN
          RAISE EXCEPTION 'Positionen und Anhänge ausgestellter Rechnungen sind unveränderbar' USING ERRCODE = '23514';
        END IF;
      END LOOP;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER invoice_items_document_protection BEFORE INSERT OR UPDATE OR DELETE ON invoice_items
      FOR EACH ROW EXECUTE FUNCTION protect_issued_invoice_child();
    CREATE TRIGGER invoice_attachments_document_protection BEFORE INSERT OR UPDATE OR DELETE ON invoice_attachments
      FOR EACH ROW EXECUTE FUNCTION protect_issued_invoice_child();
  `);
}

export async function down(client) {
  await client.query(`
    DROP TRIGGER IF EXISTS invoice_attachments_document_protection ON invoice_attachments;
    DROP TRIGGER IF EXISTS invoice_items_document_protection ON invoice_items;
    DROP TRIGGER IF EXISTS invoices_document_protection ON invoices;
    DROP FUNCTION IF EXISTS protect_issued_invoice_child();
    DROP FUNCTION IF EXISTS protect_issued_invoice();
    ALTER TABLE invoices DROP COLUMN IF EXISTS document_snapshot;
  `);
}
