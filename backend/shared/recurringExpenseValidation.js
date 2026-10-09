import { assertDateOnly } from './recurrence.js';

export const expenseCategories = ['rent','memberships','materials','office','software','telecommunications','insurance','bank_fees','travel','vehicle','marketing','professional_services','other_expense','kv','pv','rv','av','ksk','est_vz','gewst_vz','ust'];
export const levyCategories = ['kv','pv','rv','av','ksk','est_vz','gewst_vz','ust'];
export const recurrenceUnits = ['day','week','month','year'];
const expenseCategorySet = new Set(expenseCategories);
const levyCategorySet = new Set(levyCategories);
const units = new Set(recurrenceUnits);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateExpense(input, today = new Date().toISOString().slice(0, 10)) {
  try {
    const name = String(input.name || '').trim();
    const scope = String(input.scope || 'business');
    const category = String(input.levyKind || input.category || 'other_expense');
    const startDate = assertDateOnly(input.startDate, 'Startdatum');
    const endDate = input.endDate ? assertDateOnly(input.endDate, 'Enddatum') : null;
    const nextDueDate = assertDateOnly(input.nextDueDate || startDate, 'Nächste Fälligkeit');
    if (!name || name.length > 160) return 'Bitte geben Sie eine Bezeichnung mit höchstens 160 Zeichen ein.';
    if (!['business','private_levy'].includes(scope) || !expenseCategorySet.has(category)) return 'Ungültiger Bereich oder ungültige Kategorie.';
    if (scope === 'private_levy' && !levyCategorySet.has(category)) return 'Private Abgaben benötigen eine passende Abgabenart.';
    if (scope === 'private_levy' && category === 'ust') return 'Umsatzsteuer ist keine private Abgabe und wird über Umsatzsteuer-Zahlungen erfasst.';
    if (scope === 'business' && levyCategorySet.has(category)) return 'Private Abgaben können nicht als betriebliche Fixkosten gespeichert werden.';
    const amount = Number(input.amountGross ?? input.amount);
    const taxRate = input.taxRate == null || input.taxRate === '' ? null : Number(input.taxRate);
    const presets = { monthly: [1,'month'], quarterly: [3,'month'], half_yearly: [6,'month'], yearly: [1,'year'] };
    const preset = presets[input.interval];
    const intervalValue = Number(preset ? preset[0] : input.intervalCount ?? input.intervalValue ?? 1);
    const intervalUnit = String(preset ? preset[1] : input.intervalUnit === 'months' ? 'month' : input.intervalUnit === 'weeks' ? 'week' : input.intervalUnit || 'month');
    const cancellationNoticeDays = Number(input.noticePeriodDays ?? input.cancellationNoticeDays ?? 0);
    const cancelledOn = input.cancelledOn ? assertDateOnly(input.cancelledOn, 'Kündigungsdatum') : null;
    if (!Number.isFinite(amount) || amount < 0 || !Number.isInteger(intervalValue) || intervalValue < 1 || !units.has(intervalUnit)) return 'Betrag und Intervall sind ungültig.';
    if (taxRate !== null && (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100)) return 'Der MwSt.-Satz muss zwischen 0 und 100 liegen.';
    if (!Number.isInteger(cancellationNoticeDays) || cancellationNoticeDays < 0 || cancellationNoticeDays > 3650) return 'Die Kündigungsfrist ist ungültig.';
    if (endDate && endDate < startDate) return 'Das Enddatum darf nicht vor dem Startdatum liegen.';
    if (nextDueDate < startDate) return 'Die nächste Fälligkeit darf nicht vor dem Startdatum liegen.';
    if (input.linkedReceiptId && !uuid.test(String(input.linkedReceiptId))) return 'Ungültiger Belegbezug.';
    const changes = normalizePriceChanges(input.priceChanges ?? [], { amount, taxRate }, today, input.immutablePriceChanges ?? []);
    const pauses = normalizePauses(input.pauses ?? []);
    return { name, counterparty: String(input.counterparty || '').trim() || null, category, scope, amount, taxRate,
      intervalValue, intervalUnit, interval: input.interval || null, intervalCount: intervalValue, startDate, endDate, nextDueDate, cancellationNoticeDays, cancelledOn,
      status: ['active','paused','ended'].includes(input.status) ? input.status : 'active',
      autoConfirm: input.automaticBooking === true || input.autoConfirm === true, linkedReceiptId: input.linkedReceiptId || null,
      notes: String(input.notes || '').trim() || null, priceChanges: changes, pauses };
  } catch (error) { return error.message || 'Ungültige Fixkostenangaben.'; }
}

export function normalizePriceChanges(changes, base = {}, today = '9999-12-31', immutable = []) {
  if (!Array.isArray(changes)) throw new TypeError('Preisänderungen müssen eine Liste sein.');
  const normalized = changes.map(change => {
    const validFrom = assertDateOnly(change.validFrom, 'Preisgültigkeit');
    const amount = Number(change.amountGross ?? change.amount);
    const taxRate = change.taxRate == null || change.taxRate === '' ? (base.taxRate == null ? null : Number(base.taxRate)) : Number(change.taxRate);
    if (!Number.isFinite(amount) || amount < 0 || (taxRate !== null && (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100))) throw new TypeError('Eine Preisänderung enthält ungültige Werte.');
    const oldAtDate = immutable.find(old => old.validFrom === validFrom);
    if ((validFrom < today || oldAtDate) && !immutable.some(old => old.validFrom === validFrom && Number(old.amount) === amount && (old.taxRate == null ? null : Number(old.taxRate)) === taxRate)) throw new TypeError('Vergangene oder bereits gesetzte Preise können nicht geändert werden.');
    return { validFrom, amount, taxRate };
  }).sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  for (const old of immutable) {
    if (old.validFrom <= today && !normalized.some(item => item.validFrom === old.validFrom && Number(item.amount) === Number(old.amount) && (item.taxRate == null ? null : Number(item.taxRate)) === (old.taxRate == null ? null : Number(old.taxRate)))) {
      throw new TypeError('Vergangene Preise können weder geändert noch entfernt werden.');
    }
  }
  if (new Set(normalized.map(item => item.validFrom)).size !== normalized.length) throw new TypeError('Je Datum ist nur eine Preisänderung möglich.');
  return normalized;
}

export function normalizePauses(pauses) {
  if (!Array.isArray(pauses)) throw new TypeError('Pausen müssen eine Liste sein.');
  return pauses.map(pause => {
    const from = assertDateOnly(pause.from, 'Pausenbeginn');
    const until = pause.until == null || pause.until === '' ? null : assertDateOnly(pause.until, 'Pausenende');
    if (until && until < from) throw new TypeError('Das Pausenende darf nicht vor dem Beginn liegen.');
    return { from, until };
  }).sort((a, b) => a.from.localeCompare(b.from));
}
