/**
 * Migration: Manual EÜR income and expense entries
 */

export const name = '013_euer_entries';

export async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS euer_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entry_type VARCHAR(20) NOT NULL CHECK (entry_type IN ('income', 'expense')),
      entry_date DATE NOT NULL,
      description VARCHAR(255) NOT NULL,
      category VARCHAR(40) NOT NULL,
      amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
      tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
      notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await client.query('CREATE INDEX IF NOT EXISTS euer_entries_date_idx ON euer_entries(entry_date)');
  await client.query('CREATE INDEX IF NOT EXISTS euer_entries_type_date_idx ON euer_entries(entry_type, entry_date)');
}

export async function down(client) {
  await client.query('DROP TABLE IF EXISTS euer_entries');
}
