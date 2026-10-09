import { runWithRequestContext } from '../utils/requestContext.js';

/**
 * Betriebliche USt-Zahlungen und -Erstattungen (Phase 3).
 *
 * Umsatzsteuer ist keine private Abgabe. Bisher als private Abgabe erfasste
 * USt-Zahlungen (`levy_payments.levy_type = 'ust'`) werden je Workspace
 * verschoben, aber bewusst ohne EÜR-Buchung: Die Übernahme in die EÜR
 * bestätigt der Nutzer in der USt-Übersicht, damit sich keine Vorjahreswerte
 * still ändern.
 */
export const name = '057_vat_payments';

const workspaceExpression = "NULLIF(current_setting('app.workspace_id', true), '')::uuid";

export async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS vat_payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFAULT (${workspaceExpression}),
      kind VARCHAR(30) NOT NULL CHECK (kind IN ('advance','special_prepayment','annual_payment','refund')),
      tax_year INTEGER NOT NULL CHECK (tax_year BETWEEN 2000 AND 2200),
      period_key VARCHAR(10) CHECK (period_key IS NULL OR period_key ~ '^[0-9]{4}(-(0[1-9]|1[0-2])|-Q[1-4])?$'),
      due_date DATE,
      paid_on DATE,
      amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
      euer_entry_id UUID,
      source VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','legacy_levy')),
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (workspace_id, id),
      CHECK (period_key IS NULL OR LEFT(period_key, 4)::integer = tax_year),
      CHECK (kind <> 'special_prepayment' OR period_key IS NULL),
      CHECK (kind <> 'annual_payment' OR period_key IS NULL OR period_key ~ '^[0-9]{4}$'),
      CHECK (kind <> 'advance' OR period_key IS NULL OR period_key ~ '-'),
      CHECK (euer_entry_id IS NULL OR paid_on IS NOT NULL)
    )
  `);
  await client.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vat_payments_euer_workspace_fk') THEN
      ALTER TABLE vat_payments ADD CONSTRAINT vat_payments_euer_workspace_fk
        FOREIGN KEY (workspace_id, euer_entry_id) REFERENCES euer_entries(workspace_id, id)
        ON DELETE SET NULL (euer_entry_id) DEFERRABLE INITIALLY DEFERRED;
    END IF;
  END $$`);
  await client.query('CREATE INDEX IF NOT EXISTS vat_payments_workspace_year_idx ON vat_payments(workspace_id, tax_year)');
  await client.query('CREATE UNIQUE INDEX IF NOT EXISTS vat_payments_euer_entry_unique ON vat_payments(workspace_id, euer_entry_id) WHERE euer_entry_id IS NOT NULL');
  await client.query('DROP POLICY IF EXISTS workspace_access_vat_payments ON vat_payments');
  await client.query(`CREATE POLICY workspace_access_vat_payments ON vat_payments
    USING (workspace_id = ${workspaceExpression}) WITH CHECK (workspace_id = ${workspaceExpression})`);
  await client.query('ALTER TABLE vat_payments ENABLE ROW LEVEL SECURITY');
  await client.query('ALTER TABLE vat_payments FORCE ROW LEVEL SECURITY');

  // Altbestand je Workspace verschieben (RLS gilt auch für die Migrationsrolle).
  const workspaces = await client.query('SELECT id FROM workspaces');
  for (const workspace of workspaces.rows) {
    await runWithRequestContext({ workspaceId: workspace.id }, async () => {
      await client.query(`
        INSERT INTO vat_payments (workspace_id, kind, tax_year, period_key, due_date, paid_on, amount, source, notes, created_at)
        SELECT workspace_id, 'advance', EXTRACT(YEAR FROM period_start)::integer,
          CASE
            WHEN period_end IS NULL OR date_trunc('month', period_end) = date_trunc('month', period_start)
              THEN to_char(period_start, 'YYYY-MM')
            WHEN EXTRACT(DAY FROM period_start) = 1 AND EXTRACT(MONTH FROM period_start)::integer % 3 = 1
              AND period_end = (date_trunc('month', period_start) + INTERVAL '3 months - 1 day')::date
              THEN to_char(period_start, 'YYYY') || '-Q' || ((EXTRACT(MONTH FROM period_start)::integer + 2) / 3)::text
            ELSE NULL
          END,
          due_date, paid_on, amount, 'legacy_levy',
          CONCAT_WS(' · ', NULLIF(notes, ''), 'Aus „Private Abgaben“ übernommen; bitte Zeitraum und EÜR-Übernahme prüfen.'),
          created_at
        FROM levy_payments
        WHERE workspace_id = $1 AND levy_type = 'ust' AND amount > 0
      `, [workspace.id]);
      await client.query(`DELETE FROM levy_payments WHERE workspace_id = $1 AND levy_type = 'ust' AND amount > 0`, [workspace.id]);
    });
  }
}

export async function down(client) {
  await client.query('DROP TABLE IF EXISTS vat_payments');
}
