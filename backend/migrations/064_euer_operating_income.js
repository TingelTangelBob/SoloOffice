// Neue EÜR-Einnahmenkategorie `operating_income` („Betriebseinnahmen (Rechnungen)“).
// Bestehende, automatisch aus Rechnungszahlungen erzeugte Buchungen werden
// umgestellt. Sicher erkennbar sind sie ausschließlich über die Verknüpfung
// source_type = 'invoice_payment' (die Quelle verweist auf die Rechnung).
// Manuell erfasste Einnahmen (source_type = 'manual' u. a.) bleiben unberührt,
// Beträge werden nicht verändert. Die Historie-Trigger protokollieren die Umstellung.
export const name = '064_euer_operating_income';

const FORECAST_CATEGORIES = "'operating_income','other_income','materials','office','software','telecommunications','travel','vehicle','marketing','professional_services','insurance','bank_fees','rent','memberships','allowance','other_expense'";
const OLD_FORECAST_CATEGORIES = "'other_income','materials','office','software','telecommunications','travel','vehicle','marketing','professional_services','insurance','bank_fees','rent','memberships','allowance','other_expense'";

async function recategorise(client, from, to) {
  await client.query('BEGIN');
  try {
    await client.query('LOCK TABLE euer_entries IN SHARE ROW EXCLUSIVE MODE');
    await client.query('ALTER TABLE euer_entries NO FORCE ROW LEVEL SECURITY');
    await client.query('ALTER TABLE euer_entry_history NO FORCE ROW LEVEL SECURITY');
    const workspaces = await client.query(
      "SELECT DISTINCT workspace_id FROM euer_entries WHERE source_type = 'invoice_payment' AND entry_type = 'income' AND category = $1",
      [from],
    );
    for (const row of workspaces.rows) {
      // Der Historie-Trigger schreibt workspace_id aus dieser Sitzungsvariable.
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [String(row.workspace_id)]);
      await client.query(
        "UPDATE euer_entries SET category = $1 WHERE workspace_id = $2 AND source_type = 'invoice_payment' AND entry_type = 'income' AND category = $3",
        [to, row.workspace_id, from],
      );
    }
    await client.query('ALTER TABLE euer_entries FORCE ROW LEVEL SECURITY');
    await client.query('ALTER TABLE euer_entry_history FORCE ROW LEVEL SECURITY');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function up(client) {
  // euer_entries.category hat keine Prüfbedingung; nur die Prognosetabelle.
  await client.query('ALTER TABLE euer_forecasts DROP CONSTRAINT IF EXISTS euer_forecasts_category_check');
  await client.query(`ALTER TABLE euer_forecasts ADD CONSTRAINT euer_forecasts_category_check CHECK (category IS NULL OR category IN (${FORECAST_CATEGORIES}))`);
  await recategorise(client, 'other_income', 'operating_income');
}

export async function down(client) {
  await recategorise(client, 'operating_income', 'other_income');
  await client.query("UPDATE euer_forecasts SET category = 'other_income' WHERE category = 'operating_income'");
  await client.query('ALTER TABLE euer_forecasts DROP CONSTRAINT IF EXISTS euer_forecasts_category_check');
  await client.query(`ALTER TABLE euer_forecasts ADD CONSTRAINT euer_forecasts_category_check CHECK (category IS NULL OR category IN (${OLD_FORECAST_CATEGORIES}))`);
}
