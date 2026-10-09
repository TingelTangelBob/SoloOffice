import express from 'express';
import { query } from '../database.js';
import { hasPermission } from '../middleware/auth.js';
import { requireExtension } from '../middleware/extensions.js';
import { getTaxProfile } from '../services/taxProfiles.js';
import { listExpenses, listRuns } from '../services/recurringExpenses.js';
import { mapPayment } from './levyPayments.js';
import { buildForecast } from '../shared/forecast/index.js';
import { computeVatForYear } from '../services/vatComputation.js';

const router = express.Router();
router.use(requireExtension('taxes'));

function parseYear(value) {
  if (!/^\d{4}$/.test(String(value))) return null;
  const year = Number(value);
  return year >= 2000 && year <= 2200 ? year : null;
}

router.get('/:year', async (req, res, next) => {
  if (!hasPermission(req.auth, 'workspace.settings')) {
    return res.status(403).json({ error: 'Für die Steuerprognose fehlt die Berechtigung.', code: 'FORBIDDEN' });
  }
  const year = parseYear(req.params.year);
  if (!year) return res.status(400).json({ error: 'Ungültiges Prognosejahr.' });
  try {
    const [profile, entryRows, expenses, runs, levyRows, previousRows, company, extension, legacyPaidRows] = await Promise.all([
      getTaxProfile(year),
      query(`SELECT entry_type,entry_date,description,category,amount,tax_rate,source_type,status
        FROM euer_entries WHERE entry_date >= make_date($1,1,1) AND entry_date < make_date($1+1,1,1)`, [year]),
      listExpenses(query),
      listRuns(query, { year }),
      query(`SELECT * FROM levy_payments WHERE period_start >= make_date($1,1,1) AND period_start < make_date($1+1,1,1)`, [year]),
      query(`SELECT entry_type,entry_date,description,category,amount,tax_rate,source_type,status
        FROM euer_entries WHERE entry_date >= make_date($1,1,1) AND entry_date < make_date($1+1,1,1)`, [year - 1]),
      query('SELECT legal_form FROM company LIMIT 1'),
      query("SELECT accepted_at FROM workspace_extensions WHERE extension_id='taxes' AND enabled=TRUE LIMIT 1"),
      query(`SELECT COUNT(*)::int AS count FROM invoices i
        WHERE i.status='paid' AND COALESCE(i.document_type,'invoice') IN ('invoice','credit_note')
          AND NOT EXISTS (SELECT 1 FROM euer_entries e WHERE e.source_type='invoice_payment' AND e.source_id=i.id AND COALESCE(e.status,'active')<>'voided')`),
    ]);
    const disclaimerAcceptedAt = profile.disclaimerAcceptedAt || extension.rows[0]?.accepted_at || null;
    if (!disclaimerAcceptedAt) return res.status(403).json({ error: 'Bitte bestätige zuerst die Erweiterungsbedingungen für Steuern & Abgaben.', code: 'DISCLAIMER_REQUIRED' });
    const entries = entryRows.rows.map(row => ({ entryType: row.entry_type, entryDate: row.entry_date, description: row.description,
      category: row.category, amount: Number(row.amount), taxRate: Number(row.tax_rate), sourceType: row.source_type, status: row.status }));
    const previousEntries = previousRows.rows.map(row => ({ entryType: row.entry_type, entryDate: row.entry_date,
      amount: Number(row.amount), taxRate: Number(row.tax_rate), sourceType: row.source_type, status: row.status }));
    const levyPayments = levyRows.rows.map(mapPayment);
    const now = new Date();
    let vat = null;
    let vatWarning = false;
    try { vat = await computeVatForYear(year, { queryFn: query, now }); }
    catch { vatWarning = true; }
    const result = buildForecast({ year, profile: { ...profile, legalForm: company.rows[0]?.legal_form || null }, entries,
      expenses, runs, levyPayments, previousEntries, vat, now });
    if (vatWarning) result.warnings.push('Die Umsatzsteuerberechnung ist derzeit nicht verfügbar; der Umsatzsteuerwert wird als grobe Schätzung dargestellt.');
    if (legacyPaidRows.rows[0]?.count > 0) result.warnings.push('Bezahlte ältere Rechnungen ohne zugehörigen EÜR-Zahlungseingang wurden nicht als Ist-Umsatz angesetzt; die Datenbasis kann unvollständig sein.');
    return res.json(result);
  } catch (error) { return next(error); }
});

export default router;
