/**
 * Migration: Calendar events
 * Stores calendar-wide events such as vacation periods.
 */

export const name = '005_calendar_events';

export async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS calendar_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type VARCHAR(30) NOT NULL CHECK (event_type IN ('vacation')),
      title VARCHAR(255) NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      notes TEXT,
      all_day BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      CONSTRAINT calendar_events_valid_date_range CHECK (end_date >= start_date)
    )
  `);
  await client.query('CREATE INDEX IF NOT EXISTS calendar_events_date_idx ON calendar_events (start_date, end_date)');
}

export async function down(client) {
  await client.query('DROP TABLE IF EXISTS calendar_events');
}
