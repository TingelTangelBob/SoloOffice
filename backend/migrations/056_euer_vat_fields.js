/**
 * USt-Angaben an EÜR-Buchungen (Phase 3).
 *
 * Alle neuen Spalten sind nullable: Bestandsbuchungen bleiben unverändert
 * gültig und gelten als „USt-Angaben unvollständig“. `entry_date` bleibt das
 * Zahlungsdatum (Zu-/Abfluss); `document_date` trägt nur ein abweichendes
 * Rechnungs-/Belegdatum für Vorsteuer und Soll-Versteuerung.
 */
export const name = '056_euer_vat_fields';

const VAT_TREATMENTS = "'taxable','exempt','no_vat','reverse_charge_eu','reverse_charge_domestic'";

export async function up(client) {
  await client.query(`
    ALTER TABLE euer_entries
      ADD COLUMN IF NOT EXISTS document_date DATE,
      ADD COLUMN IF NOT EXISTS vat_treatment VARCHAR(30),
      ADD COLUMN IF NOT EXISTS net_amount NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS input_tax_deductible BOOLEAN,
      ADD COLUMN IF NOT EXISTS euer_year SMALLINT
  `);
  await client.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'euer_vat_treatment_check') THEN
      ALTER TABLE euer_entries ADD CONSTRAINT euer_vat_treatment_check
        CHECK (vat_treatment IS NULL OR vat_treatment IN (${VAT_TREATMENTS}));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'euer_vat_amounts_check') THEN
      ALTER TABLE euer_entries ADD CONSTRAINT euer_vat_amounts_check
        CHECK ((net_amount IS NULL OR net_amount >= 0) AND (vat_amount IS NULL OR vat_amount >= 0));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'euer_euer_year_check') THEN
      ALTER TABLE euer_entries ADD CONSTRAINT euer_euer_year_check
        CHECK (euer_year IS NULL OR euer_year BETWEEN 2000 AND 2200);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'euer_input_tax_expense_check') THEN
      ALTER TABLE euer_entries ADD CONSTRAINT euer_input_tax_expense_check
        CHECK (input_tax_deductible IS NULL OR entry_type = 'expense');
    END IF;
  END $$`);
  // Beträge passen zur Behandlung; Rundungstoleranz ein Cent.
  await client.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'euer_vat_consistency_check') THEN
      ALTER TABLE euer_entries ADD CONSTRAINT euer_vat_consistency_check CHECK (
    vat_treatment IS NULL
    OR (vat_treatment = 'taxable' AND net_amount IS NOT NULL AND vat_amount IS NOT NULL
      AND ABS(net_amount + vat_amount - amount) <= 0.01)
    OR (vat_treatment IN ('exempt', 'no_vat') AND COALESCE(vat_amount, 0) = 0)
    OR (vat_treatment IN ('reverse_charge_eu', 'reverse_charge_domestic') AND entry_type = 'expense'
      AND net_amount IS NOT NULL AND vat_amount IS NOT NULL AND ABS(net_amount - amount) <= 0.01)
      );
    END IF;
  END $$`);

  await client.query('ALTER TABLE euer_entries DROP CONSTRAINT IF EXISTS euer_entries_source_type_check');
  await client.query(`ALTER TABLE euer_entries ADD CONSTRAINT euer_entries_source_type_check
    CHECK (source_type IN ('manual','invoice_payment','receipt','correction','recurring_expense','vat_payment'))`);
  // USt-Zahlungen sind betrieblich und nur über `vat_payments` entstehende Buchungen.
  await client.query(`ALTER TABLE euer_entries DROP CONSTRAINT IF EXISTS euer_vat_payment_source_check`);
  await client.query(`ALTER TABLE euer_entries ADD CONSTRAINT euer_vat_payment_source_check CHECK (
    (source_type = 'vat_payment') = (category IN ('vat_payment', 'vat_refund'))
    AND (source_type <> 'vat_payment' OR (source_id IS NOT NULL AND (
      (entry_type = 'expense' AND category = 'vat_payment') OR (entry_type = 'income' AND category = 'vat_refund'))))
    AND (euer_year IS NULL OR source_type = 'vat_payment')
  )`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS euer_vat_payment_unique
    ON euer_entries(workspace_id, source_id) WHERE source_type = 'vat_payment' AND status = 'active'`);
  await client.query('CREATE INDEX IF NOT EXISTS euer_entries_document_date_idx ON euer_entries(workspace_id, document_date) WHERE document_date IS NOT NULL');
}

export async function down(client) {
  await client.query('DROP INDEX IF EXISTS euer_entries_document_date_idx');
  await client.query('DROP INDEX IF EXISTS euer_vat_payment_unique');
  for (const constraint of ['euer_vat_payment_source_check', 'euer_vat_consistency_check', 'euer_input_tax_expense_check',
    'euer_euer_year_check', 'euer_vat_amounts_check', 'euer_vat_treatment_check']) {
    await client.query(`ALTER TABLE euer_entries DROP CONSTRAINT IF EXISTS ${constraint}`);
  }
  await client.query('ALTER TABLE euer_entries DROP CONSTRAINT IF EXISTS euer_entries_source_type_check');
  await client.query(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM euer_entries WHERE source_type = 'vat_payment') THEN
      ALTER TABLE euer_entries ADD CONSTRAINT euer_entries_source_type_check CHECK (source_type IN ('manual','invoice_payment','receipt','correction','recurring_expense','vat_payment'));
    ELSE
      ALTER TABLE euer_entries ADD CONSTRAINT euer_entries_source_type_check CHECK (source_type IN ('manual','invoice_payment','receipt','correction','recurring_expense'));
    END IF;
  END $$`);
  await client.query(`ALTER TABLE euer_entries
    DROP COLUMN IF EXISTS euer_year,
    DROP COLUMN IF EXISTS input_tax_deductible,
    DROP COLUMN IF EXISTS vat_amount,
    DROP COLUMN IF EXISTS net_amount,
    DROP COLUMN IF EXISTS vat_treatment,
    DROP COLUMN IF EXISTS document_date`);
}
