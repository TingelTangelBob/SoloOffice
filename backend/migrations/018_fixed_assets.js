/**
 * Migration: Fixed asset register for tax preparation
 */

export const name = '018_fixed_assets';

export async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS fixed_assets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      category VARCHAR(80) NOT NULL,
      acquisition_date DATE NOT NULL,
      acquisition_cost NUMERIC(12, 2) NOT NULL CHECK (acquisition_cost >= 0),
      useful_life_years NUMERIC(5, 2) NOT NULL CHECK (useful_life_years > 0),
      status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disposed')),
      disposal_date DATE,
      notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      CHECK (disposal_date IS NULL OR disposal_date >= acquisition_date)
    )
  `);
  await client.query('CREATE INDEX IF NOT EXISTS fixed_assets_acquisition_date_idx ON fixed_assets(acquisition_date)');
  await client.query('CREATE INDEX IF NOT EXISTS fixed_assets_status_idx ON fixed_assets(status)');
}

export async function down(client) {
  await client.query('DROP TABLE IF EXISTS fixed_assets');
}
