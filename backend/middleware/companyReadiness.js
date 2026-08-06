import { query } from '../database.js';

export async function requireCompanyReadiness(req, res, next) {
  const result = await query(`
    SELECT name, address, city, postal_code, email, tax_id, bank_account
    FROM company
    WHERE workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
    LIMIT 1
  `);
  const company = result.rows[0];
  const requiredFields = {
    name: company?.name,
    address: company?.address,
    city: company?.city,
    postal_code: company?.postal_code,
    email: company?.email,
    tax_id: company?.tax_id,
    bank_account: company?.bank_account,
  };
  const missing = Object.entries(requiredFields).filter(([, value]) => !String(value || '').trim()).map(([field]) => field);
  if (missing.length > 0) {
    return res.status(409).json({
      success: false,
      message: 'Bitte vervollständigen Sie zuerst die Firmendaten.',
      code: 'COMPANY_SETUP_REQUIRED',
      missing,
    });
  }
  return next();
}
