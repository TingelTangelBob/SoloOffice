import { pool, query } from '../database.js';
import { defaultTaxProfile } from '../shared/financeDefaults.js';
import { resolveTaxParams } from '../shared/taxParams/index.js';
import { TAX_PROFILE_PAYLOAD_FIELDS } from '../utils/taxProfileValidation.js';

function payloadOnly(profile) {
  return Object.fromEntries(TAX_PROFILE_PAYLOAD_FIELDS.map(key => [key, profile[key]]));
}

function timestamp(value) {
  return value ? new Date(value).toISOString() : null;
}

export function toTaxProfile(row) {
  if (!row) return null;
  const year = Number(row.year);
  const defaults = defaultTaxProfile(year);
  const source = row.profile && typeof row.profile === 'object' ? row.profile : {};
  const profile = { ...defaults };
  for (const key of TAX_PROFILE_PAYLOAD_FIELDS) {
    if (Object.hasOwn(source, key)) profile[key] = source[key];
  }
  if (!row.church_tax_consent_at) profile.churchTaxLiable = null;
  return {
    id: row.id,
    ...profile,
    disclaimerAcceptedAt: timestamp(row.disclaimer_accepted_at),
    churchTaxConsentAt: timestamp(row.church_tax_consent_at),
    paramsVersion: row.params_version,
    updatedAt: timestamp(row.updated_at),
  };
}

export async function getTaxProfile(year, queryFn = query) {
  if (!Number.isInteger(year) || year < 2000 || year > 2200) throw new RangeError('Ungültiges Steuerjahr.');
  const result = await queryFn('SELECT * FROM tax_profiles WHERE year = $1', [year]);
  return result.rows[0] ? toTaxProfile(result.rows[0]) : defaultTaxProfile(year);
}

async function lockYears(client, years) {
  for (const year of [...new Set(years)].sort((a, b) => a - b)) {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended(COALESCE(current_setting('app.workspace_id', true), '') || ':' || $1::text, 0))",
      [year],
    );
  }
}

async function ensureRow(client, year) {
  const defaults = defaultTaxProfile(year);
  await client.query(`
    INSERT INTO tax_profiles (year, profile, params_version)
    VALUES ($1, $2::jsonb, $3)
    ON CONFLICT (workspace_id, year) DO NOTHING
  `, [year, JSON.stringify(payloadOnly(defaults)), defaults.paramsVersion]);
  const result = await client.query('SELECT * FROM tax_profiles WHERE year = $1 FOR UPDATE', [year]);
  return result.rows[0];
}

async function saveRow(client, year, profile, { disclaimerAcceptedAt, churchTaxConsentAt, keepMetadata = true } = {}) {
  const values = [year, JSON.stringify(payloadOnly(profile)), resolveTaxParams(year).params.version];
  const result = await client.query(`
    INSERT INTO tax_profiles (year, profile, params_version, disclaimer_accepted_at, church_tax_consent_at)
    VALUES ($1, $2::jsonb, $3, $4, $5)
    ON CONFLICT (workspace_id, year) DO UPDATE SET
      profile = EXCLUDED.profile,
      params_version = EXCLUDED.params_version,
      disclaimer_accepted_at = CASE WHEN $6 THEN COALESCE(tax_profiles.disclaimer_accepted_at, EXCLUDED.disclaimer_accepted_at) ELSE EXCLUDED.disclaimer_accepted_at END,
      church_tax_consent_at = CASE WHEN $6 THEN COALESCE(tax_profiles.church_tax_consent_at, EXCLUDED.church_tax_consent_at) ELSE EXCLUDED.church_tax_consent_at END,
      updated_at = NOW()
    RETURNING *
  `, [...values, disclaimerAcceptedAt || null, churchTaxConsentAt || null, keepMetadata]);
  return result.rows[0];
}

async function transact(operation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function saveTaxProfile(year, payload) {
  return transact(async client => {
    await lockYears(client, [year]);
    const existing = await ensureRow(client, year);
    const profile = { ...payload, churchTaxLiable: payload.churchTaxLiable ?? null };
    if (typeof payload.churchTaxLiable === 'boolean' && !existing.church_tax_consent_at) {
      const error = new Error('Für diese Angabe ist zuerst eine gesonderte Einwilligung erforderlich.');
      error.statusCode = 400;
      error.code = 'CHURCH_TAX_CONSENT_REQUIRED';
      throw error;
    }
    const row = await saveRow(client, year, profile, {
      disclaimerAcceptedAt: existing.disclaimer_accepted_at,
      churchTaxConsentAt: existing.church_tax_consent_at,
    });
    return toTaxProfile(row);
  });
}

export function acceptTaxDisclaimer(year) {
  return transact(async client => {
    await lockYears(client, [year]);
    const existing = await ensureRow(client, year);
    const result = await client.query(`
      UPDATE tax_profiles SET disclaimer_accepted_at = COALESCE(disclaimer_accepted_at, NOW()), updated_at = NOW()
      WHERE year = $1 RETURNING *
    `, [year]);
    return toTaxProfile(result.rows[0] || existing);
  });
}

export function setChurchTaxConsent(year, consented, liable) {
  return transact(async client => {
    await lockYears(client, [year]);
    const existing = await ensureRow(client, year);
    const profile = { ...existing.profile };
    if (consented) profile.churchTaxLiable = liable;
    else delete profile.churchTaxLiable;
    const result = await client.query(`
      UPDATE tax_profiles
      SET profile = $2::jsonb,
          church_tax_consent_at = CASE WHEN $3 THEN COALESCE(church_tax_consent_at, NOW()) ELSE NULL END,
          updated_at = NOW()
      WHERE year = $1
      RETURNING *
    `, [year, JSON.stringify(profile), consented]);
    return toTaxProfile(result.rows[0]);
  });
}

export function copyTaxProfile(sourceYear, targetYear) {
  return transact(async client => {
    await lockYears(client, [sourceYear, targetYear]);
    const source = await ensureRow(client, sourceYear);
    const targetResult = await client.query('SELECT * FROM tax_profiles WHERE year = $1 FOR UPDATE', [targetYear]);
    const target = targetResult.rows[0] || null;
    const extensionResult = await client.query(
      "SELECT accepted_at FROM workspace_extensions WHERE extension_id = 'taxes'",
    );
    const profile = {
      ...payloadOnly(defaultTaxProfile(targetYear)),
      ...source.profile,
      year: targetYear,
      churchTaxLiable: target?.church_tax_consent_at ? (target.profile?.churchTaxLiable ?? null) : null,
    };
    const row = await saveRow(client, targetYear, profile, {
      disclaimerAcceptedAt: target?.disclaimer_accepted_at || source.disclaimer_accepted_at || extensionResult.rows[0]?.accepted_at,
      churchTaxConsentAt: target?.church_tax_consent_at,
      keepMetadata: false,
    });
    return toTaxProfile(row);
  });
}
