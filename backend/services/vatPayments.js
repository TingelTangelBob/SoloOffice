import { pool, query } from '../database.js';
import { getTaxProfile } from './taxProfiles.js';
import { VAT_PAYMENT_KINDS } from '../shared/vat/index.js';
import { euerAttributionYear, parseVatPeriodKey, paymentDueDate, specialPrepaymentDueDate } from '../shared/vat/periods.js';
import { assertDateOnly } from '../shared/recurrence.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validYear = year => Number.isInteger(year) && year >= 2000 && year <= 2200;
// Zahlungen samt EÜR-Jahr der aktiven verknüpften Buchung.
export const VAT_PAYMENT_SELECT = `SELECT vp.*, e.euer_year FROM vat_payments vp
  LEFT JOIN euer_entries e ON e.id = vp.euer_entry_id AND e.status = 'active'`;
const isoOptional = (value, label) => value === undefined || value === null || value === '' ? null : assertDateOnly(value, label);

export function mapVatPayment(row) {
  const date = (value, label) => value == null ? null : assertDateOnly(value, label);
  return {
    id: row.id,
    kind: row.kind,
    taxYear: Number(row.tax_year),
    periodKey: row.period_key || null,
    dueDate: date(row.due_date, 'Fälligkeit'),
    paidOn: date(row.paid_on, 'Zahlungsdatum'),
    amount: Number(row.amount),
    euerEntryId: row.euer_entry_id || null,
    // EÜR-Jahr der verknüpften Buchung, falls nach § 11 EStG abweichend (10-Tage-Regel).
    euerYear: row.euer_year == null ? null : Number(row.euer_year),
    source: row.source,
    notes: row.notes || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function validateVatPayment(body, { profile = null } = {}) {
  const kind = String(body.kind || '');
  const taxYear = Number(body.taxYear);
  const amount = Number(body.amount);
  const notes = body.notes == null ? null : String(body.notes).trim();
  if (!VAT_PAYMENT_KINDS.includes(kind)) return { error: 'Ungültige Art der Umsatzsteuer-Zahlung.' };
  if (!validYear(taxYear)) return { error: 'Das Steuerjahr muss zwischen 2000 und 2200 liegen.' };
  if (!Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) !== amount * 100) return { error: 'Der Betrag muss größer als 0 € sein und darf höchstens zwei Nachkommastellen haben.' };
  if (notes && notes.length > 500) return { error: 'Die Notiz darf höchstens 500 Zeichen enthalten.' };
  if (body.euerEntryId && !uuidPattern.test(String(body.euerEntryId))) return { error: 'Ungültige EÜR-Buchung.' };
  let periodKey = body.periodKey == null || body.periodKey === '' ? null : String(body.periodKey);
  let dueDate;
  let paidOn;
  try {
    dueDate = isoOptional(body.dueDate, 'Fälligkeit');
    paidOn = isoOptional(body.paidOn, 'Zahlungsdatum');
  } catch (error) { return { error: error.message }; }

  let period = null;
  if (periodKey) {
    period = parseVatPeriodKey(periodKey);
    if (!period || period.year !== taxYear) return { error: 'Der Zeitraum muss zum Steuerjahr passen.' };
  }
  if (kind === 'advance') {
    if (!period || period.type === 'annual') return { error: 'Für eine Vorauszahlung ist ein Monat oder Quartal im Steuerjahr erforderlich.' };
  } else if (kind === 'refund') {
    if (periodKey && !period) return { error: 'Der Erstattungszeitraum ist ungültig.' };
  } else if (kind === 'annual_payment') {
    if (periodKey && period?.type !== 'annual') return { error: 'Eine Jahresnachzahlung benötigt das Jahr als Zeitraum.' };
  } else if (kind === 'special_prepayment' && periodKey) {
    return { error: 'Eine Sondervorauszahlung hat keinen Voranmeldungszeitraum.' };
  }

  const permanentExtension = profile?.vatPermanentExtension === true;
  if (!dueDate) {
    if (kind === 'special_prepayment') dueDate = specialPrepaymentDueDate(taxYear);
    else if (period && period.type !== 'annual') dueDate = paymentDueDate(period, { permanentExtension });
  }
  const warnings = [];
  if (kind === 'advance' && profile?.vatPeriod && period?.type !== profile.vatPeriod) {
    warnings.push('Der Zeitraum weicht vom im Steuerprofil hinterlegten Voranmeldungsrhythmus ab.');
  }
  return { value: { kind, taxYear, periodKey, dueDate, paidOn, amount, notes: notes || null }, warnings };
}

export async function listVatPayments(year, queryFn = query) {
  if (year !== undefined && year !== null && !validYear(Number(year))) throw new RangeError('Ungültiges Steuerjahr.');
  const result = year === undefined || year === null
    ? await queryFn(`${VAT_PAYMENT_SELECT} ORDER BY vp.tax_year,vp.period_key,vp.due_date`)
    : await queryFn(`${VAT_PAYMENT_SELECT} WHERE vp.tax_year=$1 ORDER BY vp.period_key,vp.due_date`, [Number(year)]);
  return result.rows.map(mapVatPayment);
}

function entryDescription(payment) {
  if (payment.kind === 'refund') return `Umsatzsteuer-Erstattung ${payment.taxYear}`;
  if (payment.kind === 'special_prepayment') return `Umsatzsteuer-Sondervorauszahlung ${payment.taxYear}`;
  if (payment.kind === 'annual_payment') return `Umsatzsteuer-Jahresnachzahlung ${payment.taxYear}`;
  const period = parseVatPeriodKey(payment.periodKey);
  return `USt-Vorauszahlung ${period?.label || payment.taxYear}`;
}

async function syncEuerEntry(client, payment, profile) {
  const existing = payment.euer_entry_id
    ? await client.query('SELECT id,status FROM euer_entries WHERE id=$1 FOR UPDATE', [payment.euer_entry_id])
    : await client.query("SELECT id,status FROM euer_entries WHERE source_type='vat_payment' AND source_id=$1 AND status='active' FOR UPDATE", [payment.id]);
  const row = existing.rows[0];
  if (!payment.paid_on) {
    if (row && row.status === 'active') await client.query(`UPDATE euer_entries SET status='voided',correction_reason='USt-Zahlung zurückgesetzt',updated_at=NOW() WHERE id=$1`, [row.id]);
    if (row) await client.query('UPDATE vat_payments SET euer_entry_id=NULL,updated_at=NOW() WHERE id=$1', [payment.id]);
    return null;
  }
  if (payment.source === 'legacy_levy' && !row) return null;
  const attribution = euerAttributionYear({ kind: payment.kind, periodKey: payment.period_key, paidOn: payment.paid_on }, {
    permanentExtension: profile?.vatPermanentExtension === true,
  });
  const entryType = payment.kind === 'refund' ? 'income' : 'expense';
  const category = payment.kind === 'refund' ? 'vat_refund' : 'vat_payment';
  const paidYear = Number(assertDateOnly(payment.paid_on, 'Zahlungsdatum').slice(0, 4));
  const euerYear = attribution.year === paidYear ? null : attribution.year;
  let entry;
  if (row) {
    if (row.status === 'voided') {
      const updated = await client.query(`UPDATE euer_entries SET entry_type=$1,entry_date=$2,description=$3,category=$4,amount=$5,
          tax_rate=0,document_date=NULL,vat_treatment='no_vat',net_amount=NULL,vat_amount=0,input_tax_deductible=NULL,euer_year=$6,
          status='active',correction_reason=NULL,updated_at=NOW() WHERE id=$7 RETURNING id`,
      [entryType,payment.paid_on,entryDescription(payment),category,Number(payment.amount),euerYear,row.id]);
      entry = updated.rows[0];
    } else {
      const updated = await client.query(`UPDATE euer_entries SET entry_type=$1,entry_date=$2,description=$3,category=$4,amount=$5,
          tax_rate=0,document_date=NULL,vat_treatment='no_vat',net_amount=NULL,vat_amount=0,input_tax_deductible=NULL,euer_year=$6,updated_at=NOW()
        WHERE id=$7 RETURNING id`, [entryType,payment.paid_on,entryDescription(payment),category,Number(payment.amount),euerYear,row.id]);
      entry = updated.rows[0];
    }
  } else {
    const inserted = await client.query(`INSERT INTO euer_entries
        (entry_type,entry_date,description,category,amount,tax_rate,source_type,source_id,document_date,vat_treatment,net_amount,vat_amount,input_tax_deductible,euer_year)
      VALUES ($1,$2,$3,$4,$5,0,'vat_payment',$6,NULL,'no_vat',NULL,0,NULL,$7) RETURNING id`,
    [entryType,payment.paid_on,entryDescription(payment),category,Number(payment.amount),payment.id,euerYear]);
    entry = inserted.rows[0];
  }
  await client.query('UPDATE vat_payments SET euer_entry_id=$1,updated_at=NOW() WHERE id=$2', [entry.id,payment.id]);
  return entry.id;
}

async function transact(operation) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const value = await operation(client); await client.query('COMMIT'); return value; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function createVatPayment(body) {
  return transact(async client => {
    const basicValidation = validateVatPayment(body);
    if (basicValidation.error) return { error: basicValidation.error };
    const profile = await getTaxProfile(basicValidation.value.taxYear, client.query.bind(client));
    const validation = validateVatPayment(body, { profile });
    if (validation.error) return { error: validation.error };
    const value = validation.value;
    const result = await client.query(`INSERT INTO vat_payments (kind,tax_year,period_key,due_date,paid_on,amount,source,notes)
      VALUES ($1,$2,$3,$4,$5,$6,'manual',$7) RETURNING *`,
    [value.kind,value.taxYear,value.periodKey,value.dueDate,value.paidOn,value.amount,value.notes]);
    const payment = result.rows[0];
    if (payment.paid_on) await syncEuerEntry(client, payment, profile);
    const fresh = await client.query(`${VAT_PAYMENT_SELECT} WHERE vp.id=$1`, [payment.id]);
    return { payment: mapVatPayment(fresh.rows[0]), warnings: validation.warnings };
  });
}

export async function updateVatPayment(id, body) {
  return transact(async client => {
    const currentResult = await client.query('SELECT * FROM vat_payments WHERE id=$1 FOR UPDATE', [id]);
    if (!currentResult.rows.length) return { missing: true };
    const current = currentResult.rows[0];
    const profileYear = Number(body.taxYear ?? current.tax_year);
    const merged = {
      kind: body.kind ?? current.kind, taxYear: profileYear,
      periodKey: body.periodKey !== undefined ? body.periodKey : current.period_key,
      dueDate: body.dueDate !== undefined ? body.dueDate : current.due_date,
      paidOn: body.paidOn !== undefined ? body.paidOn : current.paid_on,
      amount: body.amount ?? current.amount, notes: body.notes !== undefined ? body.notes : current.notes,
    };
    const basicValidation = validateVatPayment(merged);
    if (basicValidation.error) return { error: basicValidation.error };
    const profile = await getTaxProfile(basicValidation.value.taxYear, client.query.bind(client));
    const validation = validateVatPayment(merged, { profile });
    if (validation.error) return { error: validation.error };
    const value = validation.value;
    const result = await client.query(`UPDATE vat_payments SET kind=$1,tax_year=$2,period_key=$3,due_date=$4,paid_on=$5,amount=$6,notes=$7,updated_at=NOW()
      WHERE id=$8 RETURNING *`, [value.kind,value.taxYear,value.periodKey,value.dueDate,value.paidOn,value.amount,value.notes,id]);
    await syncEuerEntry(client, result.rows[0], profile);
    const fresh = await client.query(`${VAT_PAYMENT_SELECT} WHERE vp.id=$1`, [id]);
    return { payment: mapVatPayment(fresh.rows[0]), warnings: validation.warnings };
  });
}

export async function deleteVatPayment(id, correctionReason = 'USt-Zahlung gelöscht') {
  return transact(async client => {
    const current = await client.query('SELECT * FROM vat_payments WHERE id=$1 FOR UPDATE', [id]);
    if (!current.rows.length) return { missing: true };
    const payment = current.rows[0];
    const entryId = payment.euer_entry_id;
    if (entryId) await client.query("UPDATE euer_entries SET status='voided',correction_reason=$1,updated_at=NOW() WHERE id=$2 AND status='active'", [String(correctionReason || 'USt-Zahlung gelöscht').slice(0,500),entryId]);
    await client.query('DELETE FROM vat_payments WHERE id=$1', [id]);
    return { deleted: true };
  });
}

export async function bookVatPayment(id) {
  return transact(async client => {
    const result = await client.query('SELECT * FROM vat_payments WHERE id=$1 FOR UPDATE', [id]);
    if (!result.rows.length) return { missing: true };
    const payment = result.rows[0];
    if (!payment.paid_on) return { error: 'Nur bezahlte Umsatzsteuer-Zahlungen können in die EÜR übernommen werden.' };
    if (payment.euer_entry_id) return { payment: mapVatPayment(payment), idempotent: true };
    const profile = await getTaxProfile(Number(payment.tax_year), client.query.bind(client));
    // Der Altbestand bleibt unberührt, bis die Übernahme ausdrücklich gewählt wurde.
    const booked = await syncEuerEntry(client, { ...payment, source: 'manual' }, profile);
    const fresh = await client.query(`${VAT_PAYMENT_SELECT} WHERE vp.id=$1`, [id]);
    return { payment: mapVatPayment(fresh.rows[0]), euerEntryId: booked };
  });
}

export { euerAttributionYear, paymentDueDate };
