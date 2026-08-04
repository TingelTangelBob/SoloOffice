/**
 * Migration Runner
 * Handles executing database migrations in order
 */

import logger from '../utils/logger.js';

// Import all migrations in order
import * as migration001 from './001_initial_schema.js';
import * as migration002 from './002_customer_emails.js';
import * as migration003 from './003_email_management.js';
import * as migration004 from './004_customer_specific_rates.js';
import * as migration005 from './005_calendar_events.js';
import * as migration006 from './006_number_format.js';
import * as migration007 from './007_company_format_preferences.js';
import * as migration008 from './008_invoice_templates.js';
import * as migration009 from './009_theme_and_document_templates.js';
import * as migration010 from './010_payment_information_mode.js';
import * as migration011 from './011_recurring_and_credit_documents.js';
import * as migration012 from './012_terminology_profile.js';
import * as migration013 from './013_euer_entries.js';
import * as migration014 from './014_receipt_label.js';
import * as migration015 from './015_receipts.js';
import * as migration016 from './016_tax_profile.js';
import * as migration017 from './017_euer_audit.js';
import * as migration018 from './018_fixed_assets.js';
import * as migration019 from './019_terminology_color_source.js';

// List of all migrations in execution order
const migrations = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
  migration009,
  migration010,
  migration011,
  migration012,
  migration013,
  migration014,
  migration015,
  migration016,
  migration017,
  migration018,
  migration019,
];

/**
 * Run all pending migrations
 * @param {import('pg').PoolClient} client - Database client
 */
export async function runMigrations(client) {
  // Ensure migrations table exists
  await client.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  // Get list of already executed migrations
  const result = await client.query('SELECT name FROM migrations');
  const executedMigrations = new Set(result.rows.map(row => row.name));

  // Run pending migrations
  for (const migration of migrations) {
    if (!executedMigrations.has(migration.name)) {
      logger.info(`Running migration: ${migration.name}`);
      
      try {
        await migration.up(client);
        
        // Record the migration
        await client.query(
          'INSERT INTO migrations (name) VALUES ($1)',
          [migration.name]
        );
        
        logger.info(`Migration completed: ${migration.name}`);
      } catch (error) {
        logger.error(`Migration failed: ${migration.name}`, { error: error.message });
        throw error;
      }
    }
  }
}

/**
 * Rollback the last migration
 * @param {import('pg').PoolClient} client - Database client
 */
export async function rollbackLastMigration(client) {
  // Get the last executed migration
  const result = await client.query(
    'SELECT name FROM migrations ORDER BY executed_at DESC LIMIT 1'
  );

  if (result.rows.length === 0) {
    logger.info('No migrations to rollback');
    return;
  }

  const lastMigrationName = result.rows[0].name;
  const migration = migrations.find(m => m.name === lastMigrationName);

  if (!migration) {
    logger.error(`Migration not found: ${lastMigrationName}`);
    return;
  }

  logger.info(`Rolling back migration: ${migration.name}`);

  try {
    await migration.down(client);
    
    // Remove the migration record
    await client.query(
      'DELETE FROM migrations WHERE name = $1',
      [migration.name]
    );
    
    logger.info(`Rollback completed: ${migration.name}`);
  } catch (error) {
    logger.error(`Rollback failed: ${migration.name}`, { error: error.message });
    throw error;
  }
}

/**
 * Get migration status
 * @param {import('pg').PoolClient} client - Database client
 * @returns {Promise<{pending: string[], executed: string[]}>}
 */
export async function getMigrationStatus(client) {
  // Ensure migrations table exists
  await client.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  const result = await client.query('SELECT name FROM migrations');
  const executedMigrations = new Set(result.rows.map(row => row.name));

  const pending = migrations
    .filter(m => !executedMigrations.has(m.name))
    .map(m => m.name);

  const executed = migrations
    .filter(m => executedMigrations.has(m.name))
    .map(m => m.name);

  return { pending, executed };
}

export default {
  runMigrations,
  rollbackLastMigration,
  getMigrationStatus,
};

