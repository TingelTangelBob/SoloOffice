import { encryptSecret, isEncryptionConfigured } from '../utils/secretBox.js';

export const name = '025_security_and_compliance';

export async function up(client) {
  await client.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS email_verification_token_hash CHAR(64),
      ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS password_reset_token_hash CHAR(64),
      ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMP WITH TIME ZONE
  `);
  // Existing installations already had an authenticated account, so do not
  // lock those users out when verification is enabled later.
  await client.query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, created_at)');

  await client.query('ALTER TABLE customers ADD COLUMN IF NOT EXISTS leitweg_id VARCHAR(100)');
  // The initial company schema predates the audit timestamps. Add the column
  // before the legacy placeholder cleanup below uses it, so a fresh database
  // can run this migration without depending on an unrelated later change.
  await client.query(`
    ALTER TABLE company
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  `);
  await client.query(`
    UPDATE company
    SET name = '', address = '', city = '', postal_code = '', phone = '', email = '',
        website = '', tax_id = '', bank_account = '', bic = '', updated_at = NOW()
    WHERE name = 'Meine Firma GmbH' AND email = 'info@meinefirma.de'
  `);

  await client.query('ALTER TABLE smtp_settings ADD COLUMN IF NOT EXISTS smtp_pass_encrypted TEXT');
  const legacyPasswords = await client.query(`
    SELECT workspace_id, id, smtp_pass
    FROM smtp_settings
    WHERE smtp_pass IS NOT NULL AND smtp_pass <> ''
  `);
  if (legacyPasswords.rows.length > 0 && !isEncryptionConfigured()) {
    throw new Error('ENCRYPTION_KEY fehlt; vorhandene SMTP-Passwörter können nicht sicher migriert werden.');
  }
  for (const row of legacyPasswords.rows) {
    await client.query(`
      UPDATE smtp_settings
      SET smtp_pass_encrypted = $1, smtp_pass = NULL, updated_at = NOW()
      WHERE workspace_id = $2 AND id = $3
    `, [encryptSecret(row.smtp_pass), row.workspace_id, row.id]);
  }
  // The old plaintext column is no longer part of the data model. Backups
  // from older versions are handled by the restore column allow-list.
  await client.query('ALTER TABLE smtp_settings DROP COLUMN IF EXISTS smtp_pass');

  await client.query(`
    CREATE TABLE IF NOT EXISTS rate_limit_buckets (
      bucket_key VARCHAR(255) PRIMARY KEY,
      window_started TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      hit_count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);
  await client.query('CREATE INDEX IF NOT EXISTS rate_limit_buckets_updated_idx ON rate_limit_buckets(updated_at)');
}

export async function down(client) {
  await client.query('DROP INDEX IF EXISTS rate_limit_buckets_updated_idx');
  await client.query('DROP TABLE IF EXISTS rate_limit_buckets');
  await client.query('ALTER TABLE smtp_settings ADD COLUMN IF NOT EXISTS smtp_pass VARCHAR(255)');
  await client.query('ALTER TABLE smtp_settings DROP COLUMN IF EXISTS smtp_pass_encrypted');
  await client.query('ALTER TABLE customers DROP COLUMN IF EXISTS leitweg_id');
  await client.query(`
    ALTER TABLE users
      DROP COLUMN IF EXISTS email_verified_at,
      DROP COLUMN IF EXISTS email_verification_token_hash,
      DROP COLUMN IF EXISTS email_verification_expires_at,
      DROP COLUMN IF EXISTS password_reset_token_hash,
      DROP COLUMN IF EXISTS password_reset_expires_at
  `);
}
