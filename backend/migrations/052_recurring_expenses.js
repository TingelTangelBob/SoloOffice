/** Fixkosten, Fälligkeitsläufe und private Abgaben. */
export const name = '052_recurring_expenses';

const workspaceExpression = "NULLIF(current_setting('app.workspace_id', true), '')::uuid";

export async function up(client) {
  await client.query(`
    CREATE TABLE recurring_expenses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFAULT (${workspaceExpression}),
      name VARCHAR(160) NOT NULL,
      counterparty VARCHAR(160),
      category VARCHAR(40) NOT NULL CHECK (category IN ('rent','memberships','materials','office','software','telecommunications','insurance','bank_fees','travel','vehicle','marketing','professional_services','other_expense','kv','pv','rv','av','ksk','est_vz','gewst_vz','ust')),
      scope VARCHAR(20) NOT NULL CHECK (scope IN ('business','private_levy')),
      amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
      tax_rate NUMERIC(5,2) CHECK (tax_rate IS NULL OR (tax_rate >= 0 AND tax_rate <= 100)),
      interval_value INTEGER NOT NULL DEFAULT 1 CHECK (interval_value > 0),
      interval_unit VARCHAR(10) NOT NULL CHECK (interval_unit IN ('day','week','month','year')),
      start_date DATE NOT NULL,
      end_date DATE,
      next_due_date DATE NOT NULL,
      cancellation_notice_days INTEGER NOT NULL DEFAULT 0 CHECK (cancellation_notice_days >= 0),
      cancelled_on DATE,
      status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended')),
      auto_confirm BOOLEAN NOT NULL DEFAULT FALSE,
      linked_receipt_id UUID,
      notes TEXT,
      price_changes JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(price_changes) = 'array'),
      pauses JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(pauses) = 'array'),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (workspace_id, id),
      CHECK (end_date IS NULL OR end_date >= start_date),
      CHECK ((scope = 'business') OR category IN ('kv','pv','rv','av','ksk','est_vz','gewst_vz','ust'))
    )
  `);
  await client.query('ALTER TABLE receipts ADD CONSTRAINT receipts_workspace_id_unique UNIQUE (workspace_id, id)');
  await client.query('ALTER TABLE euer_entries ADD CONSTRAINT euer_entries_workspace_id_unique UNIQUE (workspace_id, id)');
  await client.query(`ALTER TABLE recurring_expenses ADD CONSTRAINT recurring_expenses_receipt_workspace_fk FOREIGN KEY (workspace_id, linked_receipt_id) REFERENCES receipts(workspace_id, id) ON DELETE SET NULL (linked_receipt_id) DEFERRABLE INITIALLY DEFERRED`);

  await client.query(`
    CREATE TABLE recurring_expense_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFAULT (${workspaceExpression}),
      expense_id UUID NOT NULL,
      due_date DATE NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','confirmed','skipped')),
      snapshot JSONB NOT NULL,
      paid_on DATE,
      euer_entry_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      confirmed_at TIMESTAMPTZ,
      UNIQUE (workspace_id, id),
      UNIQUE (workspace_id, expense_id, due_date),
      FOREIGN KEY (workspace_id, expense_id) REFERENCES recurring_expenses(workspace_id, id) ON DELETE CASCADE,
      CHECK ((status = 'confirmed' AND paid_on IS NOT NULL) OR (status <> 'confirmed' AND paid_on IS NULL))
    )
  `);
  await client.query(`ALTER TABLE recurring_expense_runs ADD CONSTRAINT recurring_expense_runs_euer_workspace_fk FOREIGN KEY (workspace_id, euer_entry_id) REFERENCES euer_entries(workspace_id, id) ON DELETE SET NULL (euer_entry_id) DEFERRABLE INITIALLY DEFERRED`);
  await client.query(`ALTER TABLE euer_entries DROP CONSTRAINT IF EXISTS euer_entries_source_type_check`);
  await client.query(`ALTER TABLE euer_entries ADD CONSTRAINT euer_entries_source_type_check CHECK (source_type IN ('manual','invoice_payment','receipt','correction','recurring_expense'))`);
  await client.query(`ALTER TABLE euer_entries ADD CONSTRAINT euer_recurring_source_guard CHECK (source_type <> 'recurring_expense' OR source_id IS NOT NULL)`);
  await client.query(`CREATE UNIQUE INDEX euer_recurring_expense_run_unique ON euer_entries(workspace_id,source_id) WHERE source_type='recurring_expense' AND status='active'`);

  await client.query(`
    CREATE TABLE levy_payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFAULT (${workspaceExpression}),
      levy_type VARCHAR(20) NOT NULL CHECK (levy_type IN ('kv','pv','rv','av','ksk','est_vz','gewst_vz','ust')),
      period_start DATE NOT NULL,
      period_end DATE,
      due_date DATE,
      paid_on DATE,
      amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
      source VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (source IN ('notice','manual','recurring_expense')),
      recurring_expense_run_id UUID,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (workspace_id, id),
      FOREIGN KEY (workspace_id, recurring_expense_run_id) REFERENCES recurring_expense_runs(workspace_id, id) ON DELETE SET NULL (recurring_expense_run_id),
      CHECK (period_end IS NULL OR period_end >= period_start)
    )
  `);

  await client.query(`CREATE INDEX recurring_expenses_workspace_due_idx ON recurring_expenses(workspace_id, next_due_date)`);
  await client.query(`CREATE INDEX recurring_expense_runs_workspace_due_idx ON recurring_expense_runs(workspace_id, due_date)`);
  await client.query(`CREATE UNIQUE INDEX levy_payments_run_unique ON levy_payments(workspace_id, recurring_expense_run_id) WHERE recurring_expense_run_id IS NOT NULL`);

  await client.query(`
    CREATE OR REPLACE FUNCTION protect_recurring_expense_run_history()
    RETURNS TRIGGER AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        IF current_setting('app.audit_disabled', true) = 'true'
          OR current_setting('app.allow_history_purge', true) = 'true' THEN RETURN OLD; END IF;
        IF OLD.status <> 'planned' THEN RAISE EXCEPTION 'Historische Fixkostenläufe dürfen nicht gelöscht werden'; END IF;
        RETURN OLD;
      END IF;
      IF (NEW.snapshot IS DISTINCT FROM OLD.snapshot AND (OLD.status <> 'planned' OR OLD.due_date <= CURRENT_DATE)) OR NEW.expense_id IS DISTINCT FROM OLD.expense_id OR NEW.due_date IS DISTINCT FROM OLD.due_date THEN
        RAISE EXCEPTION 'Der Fälligkeits-Snapshot ist unveränderbar';
      END IF;
      IF OLD.status <> 'planned' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.paid_on IS DISTINCT FROM OLD.paid_on OR NEW.euer_entry_id IS DISTINCT FROM OLD.euer_entry_id) THEN
        RAISE EXCEPTION 'Historische Fixkostenläufe sind unveränderbar';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await client.query(`CREATE TRIGGER recurring_expense_run_history_guard BEFORE UPDATE OR DELETE ON recurring_expense_runs FOR EACH ROW EXECUTE FUNCTION protect_recurring_expense_run_history()`);

  for (const table of ['recurring_expenses','recurring_expense_runs','levy_payments']) {
    await client.query(`CREATE POLICY workspace_access_${table} ON ${table} USING (workspace_id = ${workspaceExpression}) WITH CHECK (workspace_id = ${workspaceExpression})`);
    await client.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await client.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
  }

  // Direkte EÜR-Posts mit einer gefälschten Fixkosten-Quelle bleiben gesperrt.
  await client.query(`
    CREATE OR REPLACE FUNCTION validate_recurring_expense_euer_source()
    RETURNS TRIGGER AS $$
    DECLARE source_run recurring_expense_runs%ROWTYPE;
    BEGIN
      IF NEW.source_type <> 'recurring_expense' THEN RETURN NEW; END IF;
      IF TG_OP = 'UPDATE' AND NEW.source_type IS NOT DISTINCT FROM OLD.source_type
        AND NEW.source_id IS NOT DISTINCT FROM OLD.source_id THEN
        -- Änderungen an einer bestehenden Fixkostenbuchung behalten ihre zuvor
        -- geprüfte Quelle; die Run-Prüfung darunter bleibt trotzdem zwingend.
        NULL;
      ELSIF current_setting('app.audit_disabled', true) IS DISTINCT FROM 'true'
        AND current_setting('app.recurring_expense_confirmation', true) IS DISTINCT FROM NEW.source_id::text THEN
        RAISE EXCEPTION 'Fixkosten-EÜR darf nur durch die Bestätigung eines Laufs angelegt werden';
      END IF;
      SELECT * INTO source_run FROM recurring_expense_runs
        WHERE id = NEW.source_id AND workspace_id = NEW.workspace_id FOR UPDATE;
      IF NOT FOUND OR source_run.snapshot->>'scope' IS DISTINCT FROM 'business' THEN
        RAISE EXCEPTION 'Nur ein betrieblicher Fixkostenlauf darf EÜR-Quelle sein';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await client.query(`CREATE TRIGGER recurring_expense_euer_source_guard BEFORE INSERT OR UPDATE OF source_type, source_id ON euer_entries FOR EACH ROW EXECUTE FUNCTION validate_recurring_expense_euer_source()`);
}

export async function down(client) {
  await client.query('DROP TRIGGER IF EXISTS recurring_expense_run_history_guard ON recurring_expense_runs');
  await client.query('DROP FUNCTION IF EXISTS protect_recurring_expense_run_history()');
  await client.query('DROP TRIGGER IF EXISTS recurring_expense_euer_source_guard ON euer_entries');
  await client.query('DROP FUNCTION IF EXISTS validate_recurring_expense_euer_source()');
  // Erst die Featuretabellen entfernen: ihre Composite-FKs hängen an den
  // Workspace-Unique-Constraints von receipts und euer_entries.
  await client.query('DROP TABLE IF EXISTS levy_payments');
  await client.query('DROP TABLE IF EXISTS recurring_expense_runs');
  await client.query('DROP TABLE IF EXISTS recurring_expenses');
  await client.query('ALTER TABLE euer_entries DROP CONSTRAINT IF EXISTS euer_recurring_source_guard');
  await client.query('DROP INDEX IF EXISTS euer_recurring_expense_run_unique');
  await client.query('ALTER TABLE euer_entries DROP CONSTRAINT IF EXISTS euer_entries_source_type_check');
  await client.query(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM euer_entries WHERE source_type='recurring_expense') THEN
      ALTER TABLE euer_entries ADD CONSTRAINT euer_entries_source_type_check CHECK (source_type IN ('manual','invoice_payment','receipt','correction','recurring_expense'));
    ELSE
      ALTER TABLE euer_entries ADD CONSTRAINT euer_entries_source_type_check CHECK (source_type IN ('manual','invoice_payment','receipt','correction'));
    END IF;
  END $$`);
  await client.query('ALTER TABLE euer_entries DROP CONSTRAINT IF EXISTS euer_entries_workspace_id_unique');
  await client.query('ALTER TABLE receipts DROP CONSTRAINT IF EXISTS receipts_workspace_id_unique');
}
