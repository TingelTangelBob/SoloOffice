/** Private Abgaben bleiben auch bei Restore und direkten DB-Schreibpfaden außerhalb der EÜR. */
export const name = '054_recurring_expense_scope_guards';
const privateCategories = "'kv','pv','rv','av','ksk','est_vz','gewst_vz','ust'";

export async function up(client) {
  await client.query(`ALTER TABLE euer_entries ADD CONSTRAINT euer_recurring_expense_type_guard CHECK (
    source_type <> 'recurring_expense' OR entry_type = 'expense'
  )`);
  await client.query(`ALTER TABLE recurring_expenses ADD CONSTRAINT recurring_expenses_scope_category_guard CHECK (
    (scope = 'business' AND category NOT IN (${privateCategories}))
    OR (scope = 'private_levy' AND category IN (${privateCategories}))
  )`);
  await client.query(`ALTER TABLE recurring_expense_runs ADD CONSTRAINT recurring_expense_runs_snapshot_scope_guard CHECK (
    COALESCE(jsonb_typeof(snapshot) = 'object' AND (
      (snapshot->>'scope' = 'business' AND snapshot->>'category' NOT IN (${privateCategories}))
      OR (snapshot->>'scope' = 'private_levy' AND snapshot->>'category' IN (${privateCategories}))
    ), FALSE)
  )`);
  await client.query(`CREATE OR REPLACE FUNCTION validate_recurring_expense_euer_source()
    RETURNS TRIGGER AS $$
    DECLARE source_run RECORD;
    BEGIN
      IF NEW.source_type <> 'recurring_expense' THEN RETURN NEW; END IF;
      IF TG_OP = 'UPDATE' AND NEW.source_type IS NOT DISTINCT FROM OLD.source_type
        AND NEW.source_id IS NOT DISTINCT FROM OLD.source_id THEN
        NULL;
      ELSIF current_setting('app.audit_disabled', true) IS DISTINCT FROM 'true'
        AND current_setting('app.recurring_expense_confirmation', true) IS DISTINCT FROM NEW.source_id::text THEN
        RAISE EXCEPTION 'Fixkosten-EÜR darf nur durch die Bestätigung eines Laufs angelegt werden';
      END IF;
      SELECT r.snapshot, e.scope AS expense_scope, e.category AS expense_category INTO source_run
        FROM recurring_expense_runs r JOIN recurring_expenses e
          ON e.id = r.expense_id AND e.workspace_id = r.workspace_id
        WHERE r.id = NEW.source_id AND r.workspace_id = NEW.workspace_id FOR UPDATE OF r;
      IF NOT FOUND OR source_run.expense_scope IS DISTINCT FROM 'business'
        OR source_run.snapshot->>'scope' IS DISTINCT FROM 'business'
        OR source_run.snapshot->>'category' IS DISTINCT FROM source_run.expense_category
        OR source_run.expense_category IN (${privateCategories}) THEN
        RAISE EXCEPTION 'Nur ein betrieblicher Fixkostenlauf mit betrieblicher Kategorie darf EÜR-Quelle sein';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql`);
}

export async function down(client) {
  await client.query('ALTER TABLE euer_entries DROP CONSTRAINT IF EXISTS euer_recurring_expense_type_guard');
  await client.query('ALTER TABLE recurring_expense_runs DROP CONSTRAINT IF EXISTS recurring_expense_runs_snapshot_scope_guard');
  await client.query('ALTER TABLE recurring_expenses DROP CONSTRAINT IF EXISTS recurring_expenses_scope_category_guard');
  // Die strengere Quellenprüfung bleibt beim Rückrollen erhalten. Sie benötigt
  // keine neuen Spalten und schützt auch die weiterhin bestehenden 052-Tabellen.
}
