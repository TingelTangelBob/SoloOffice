import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';
import { demoExpenseDueDates, demoLevyFromRun, demoNewRunDates, demoPriceForDate, demoRunRecord, canAccessDemoFinance, validateDemoLevy, validateDemoTaxProfile } from '../../backend/shared/financeDemo.js';
import { defaultTaxProfile } from '../../backend/shared/financeDefaults.js';

class MemoryStorage {
  #values = new Map();
  getItem(key) { return this.#values.has(key) ? this.#values.get(key) : null; }
  setItem(key, value) { this.#values.set(String(key), String(value)); }
  removeItem(key) { this.#values.delete(key); }
}

async function loadDemoApi() {
  const base = path.resolve('.test-dist');
  await mkdir(base, { recursive: true });
  const temp = await mkdtemp(path.join(base, 'demo-finance-'));
  const bundle = await rolldown({ input: path.resolve('src/services/demoApi.ts'), platform: 'browser', plugins: [{
    name: 'demo-env', transform(code) {
      return code.replaceAll('import.meta.env', "({ VITE_API_URL: '/api', VITE_DEMO_MODE: 'true', DEV: false, PROD: true })");
    },
  }] });
  const output = path.join(temp, 'demo-finance.mjs');
  await bundle.write({ file: output, format: 'esm' });
  await bundle.close();
  return { module: await import(`${pathToFileURL(output).href}?finance-test=${Date.now()}`), temp };
}

const expense = overrides => ({
  id: 'expense-1', name: 'Software', counterparty: 'Demo', category: 'software', amountGross: 80, taxRate: 19,
  interval: 'monthly', intervalCount: 1, intervalUnit: 'months', startDate: '2026-01-31', endDate: null,
  noticePeriodDays: 30, cancelledOn: null, status: 'active', pauses: [], priceChanges: [], automaticBooking: false,
  scope: 'business', levyKind: null, linkedReceiptId: null, notes: '', nextDueDate: '2026-01-31', ...overrides,
});

test('Demo-Fälligkeiten bleiben am Starttag verankert und respektieren Pausen und exklusives Ende', () => {
  const result = demoExpenseDueDates(expense({
    endDate: '2026-05-31', pauses: [{ from: '2026-03-01', until: '2026-03-31' }],
  }), '2026-06-30');
  assert.deepEqual(result.dates, ['2026-01-31', '2026-02-28', '2026-04-30']);
  assert.equal(result.nextDueDate, '2026-05-31');
});

test('Pausierter Rhythmus nutzt finite Pausen; Kündigungserklärung ist kein Fälligkeits-Cutoff', () => {
  const item = expense({ status: 'paused', cancelledOn: '2026-02-01', noticePeriodDays: 0,
    pauses: [{ from: '2026-03-01', until: '2026-03-31' }] });
  assert.deepEqual(demoExpenseDueDates(item, '2026-04-30', 2000, '2026-01-01').dates,
    ['2026-01-31', '2026-02-28', '2026-04-30']);
});

test('Jahresintervalle bleiben als 12 Monate am ursprünglichen Fälligkeitstag verankert', () => {
  const annual = expense({ startDate: '2026-01-31', nextDueDate: '2026-01-31', interval: 'yearly', intervalCount: 12, intervalUnit: 'months' });
  assert.deepEqual(demoExpenseDueDates(annual, '2028-01-31').dates, ['2026-01-31', '2027-01-31', '2028-01-31']);
});

test('Preisänderungen gelten nur für spätere Snapshots; ein bestehender Lauf behält seinen Preis', () => {
  const item = expense({ priceChanges: [{ validFrom: '2026-04-01', amountGross: 95 }] });
  const oldRun = demoRunRecord(item, '2026-03-31', 'run-old');
  const newRun = demoRunRecord(item, '2026-04-30', 'run-new');
  assert.equal(demoPriceForDate(item, oldRun.dueDate), 80);
  assert.equal(oldRun.amountGross, 80);
  assert.equal(newRun.amountGross, 95);
});

test('erneute Laufgenerierung liefert vorhandene Fälligkeiten nicht doppelt', () => {
  const existing = [{ expenseId: 'expense-1', dueDate: '2026-02-28' }];
  assert.deepEqual(demoNewRunDates('expense-1', ['2026-01-31', '2026-02-28', '2026-03-31'], existing), ['2026-01-31', '2026-03-31']);
  assert.deepEqual(demoNewRunDates('expense-2', ['2026-02-28'], existing), ['2026-02-28']);
});

test('Private Laufbestätigung erzeugt ausschließlich eine Abgabenzahlung', () => {
  const item = expense({ scope: 'private_levy', category: 'kv', levyKind: 'kv' });
  const run = demoRunRecord(item, '2026-02-28', 'run-private');
  const payment = demoLevyFromRun(run, '2026-02-28', 'levy-1');
  assert.deepEqual({ kind: payment.kind, source: payment.source, expenseRunId: payment.expenseRunId, amount: payment.amount }, {
    kind: 'kv', source: 'recurring_expense', expenseRunId: 'run-private', amount: 80,
  });
  assert.equal(Object.hasOwn(payment, 'euerEntryId'), false);
});

test('Finanzzugriff ist bei deaktivierter Erweiterung oder fehlendem Einstellungsrecht gesperrt', () => {
  assert.equal(canAccessDemoFinance({ enabled: false, hasSettingsPermission: true }), false);
  assert.equal(canAccessDemoFinance({ enabled: true, hasSettingsPermission: false }), false);
  assert.equal(canAccessDemoFinance({ enabled: true, hasSettingsPermission: true }), true);
});

test('Profilvalidator lehnt private oder serverseitige Zusatzfelder ab', () => {
  const { id: _id, disclaimerAcceptedAt: _disclaimer, churchTaxConsentAt: _consent, updatedAt: _updated, paramsVersion: _version, ...defaults } = defaultTaxProfile(2026);
  const profile = { ...defaults, businessKind: 'teacher', startedOn: '2021-01-01', vatStatus: 'regular',
    healthInsurance: 'gkv_voluntary', birthYear: 1980, pensionStatus: 'teacher', pensionMode: 'income',
    healthNoticeMonthly: 262.5, careNoticeMonthly: 63, healthNoticeIncomeMonthly: 1500 };
  const valid = validateDemoTaxProfile(profile, 2026);
  assert.equal(valid.valid, true);
  const invalid = validateDemoTaxProfile({ ...profile, privateMedicalNote: 'soll nicht gespeichert werden' }, 2026);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some(error => error.includes('privateMedicalNote')));
});

test('Abgabenvalidator prüft Monat, Jahresübereinstimmung und gültige Zahlungsdaten strikt', () => {
  const basic = { kind: 'kv', year: 2026, amount: 100, source: 'manual' };
  assert.equal(typeof validateDemoLevy({ ...basic, period: '2027-01' }), 'string');
  assert.equal(typeof validateDemoLevy({ ...basic, period: '2026-13' }), 'string');
  assert.equal(typeof validateDemoLevy({ ...basic, period: '2026-02-30' }), 'string');
  assert.equal(typeof validateDemoLevy({ ...basic, period: '2026-09', paidOn: '2026-10-10' }, '2026-10-09'), 'string');
  assert.equal(typeof validateDemoLevy({ ...basic, period: '2026-09', paidOn: '2026-10-09' }, '2026-10-09'), 'object');
});

test('Demo-API dedupliziert Läufe, bucht private Zahlungen nur als Abgabe und sperrt deaktivierte Daten', async t => {
  globalThis.localStorage = new MemoryStorage();
  globalThis.sessionStorage = new MemoryStorage();
  const { module: demo, temp } = await loadDemoApi();
  t.after(async () => { await rm(temp, { recursive: true, force: true }); });
  const call = (url, method = 'GET', body) => demo.demoRequest(url, {
    method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const today = new Date().toISOString().slice(0, 10);
  await call('/tax-profile/2026');
  const privateExpense = await call('/recurring-expenses', 'POST', {
    name: 'Private KV', category: 'kv', levyKind: 'kv', scope: 'private_levy', amountGross: 50, taxRate: null,
    interval: 'monthly', intervalCount: 1, intervalUnit: 'months', startDate: today, endDate: null,
    cancelledOn: null, noticePeriodDays: 0, status: 'active', pauses: [], priceChanges: [],
    automaticBooking: false, linkedReceiptId: null, notes: '',
  });
  assert.equal(privateExpense.scope, 'private_levy');
  const generated = await call('/recurring-expenses/generate', 'POST', { throughDate: today });
  const privateRun = generated.find(run => run.expenseId === privateExpense.id);
  assert.ok(privateRun);
  assert.deepEqual(await call('/recurring-expenses/generate', 'POST', { throughDate: today }), []);
  const confirmed = await call(`/recurring-expenses/runs/${privateRun.id}/confirm`, 'POST', { paidOn: today });
  assert.equal(confirmed.status, 'confirmed');
  const state = JSON.parse(globalThis.localStorage.getItem('solooffice-demo-data-v1'));
  assert.equal(state.levyPayments.some(payment => payment.expenseRunId === privateRun.id), true);
  assert.equal(state.euerEntries.some(entry => entry.sourceId === privateRun.id), false);
  const taxes = state.extensions.find(extension => extension.id === 'taxes');
  await call('/extensions/taxes', 'PUT', { enabled: false });
  await assert.rejects(call('/levy-payments'), error => error.status === 403 && error.code === 'EXTENSION_DISABLED');
  await assert.rejects(call('/tax-profile/2026'), error => error.status === 403 && error.code === 'EXTENSION_DISABLED');
  assert.ok(taxes.acceptedAt, 'der Einwilligungszeitpunkt bleibt beim Deaktivieren erhalten');
});

test('Demo-API übernimmt Abgabenzeitraum-Updates ohne interne Laufmetadaten', async t => {
  globalThis.localStorage = new MemoryStorage();
  globalThis.sessionStorage = new MemoryStorage();
  const { module: demo, temp } = await loadDemoApi();
  t.after(async () => { await rm(temp, { recursive: true, force: true }); });
  const call = (url, method = 'GET', body) => demo.demoRequest(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const payment = await call('/levy-payments', 'POST', { kind: 'est_vz', year: 2026, period: '2026-09', paidOn: '2026-10-09', amount: 120, source: 'manual' });
  const updated = await call(`/levy-payments/${payment.id}`, 'PUT', { year: 2026, period: '2026-08', amount: 140 });
  assert.equal(updated.period, '2026-08');
  assert.equal(updated.amount, 140);
  await assert.rejects(call(`/levy-payments/${payment.id}`, 'PUT', { year: 2026, period: '2027-01' }));
  await assert.rejects(call('/levy-payments', 'POST', { kind: 'kv', year: 2026, period: '2026-09', paidOn: '2026-10-10', amount: 10 }));
  await assert.rejects(call('/levy-payments', 'POST', { kind: 'kv', year: 2026, period: '2026-09', expenseRunId: 'forbidden', amount: 10 }));
});

test('Demo-API auto-confirmiert Opt-in-Läufe standardmäßig und schließt bestehende offene Läufe ein', async t => {
  globalThis.localStorage = new MemoryStorage();
  globalThis.sessionStorage = new MemoryStorage();
  const { module: demo, temp } = await loadDemoApi();
  t.after(async () => { await rm(temp, { recursive: true, force: true }); });
  const call = (url, method = 'GET', body) => demo.demoRequest(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const today = new Date();
  const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const opted = await call('/recurring-expenses', 'POST', {
    name: 'Opt-in Software', category: 'software', scope: 'business', amountGross: 30, taxRate: 19,
    interval: 'monthly', intervalCount: 1, intervalUnit: 'months', startDate: todayString, endDate: null,
    cancelledOn: null, noticePeriodDays: 0, status: 'active', pauses: [], priceChanges: [], automaticBooking: true,
    linkedReceiptId: null, notes: '',
  });
  const created = await call('/recurring-expenses/generate', 'POST', { throughDate: todayString, autoConfirm: false });
  const pending = created.find(run => run.expenseId === opted.id);
  assert.equal(pending.status, 'planned', 'explizites autoConfirm=false hat Vorrang');
  const confirmed = await call('/recurring-expenses/generate', 'POST', { throughDate: todayString });
  assert.equal(confirmed.find(run => run.id === pending.id)?.status, 'confirmed');
  const state = JSON.parse(globalThis.localStorage.getItem('solooffice-demo-data-v1'));
  assert.ok(state.euerEntries.some(entry => entry.sourceId === pending.id && entry.sourceType === 'recurring_expense'));
});

test('Terminänderung löscht nur geplante Zukunftsläufe; bestätigte Schnappschüsse und übersprungene Läufe bleiben erhalten', async t => {
  globalThis.localStorage = new MemoryStorage();
  globalThis.sessionStorage = new MemoryStorage();
  const { module: demo, temp } = await loadDemoApi();
  t.after(async () => { await rm(temp, { recursive: true, force: true }); });
  const call = (url, method = 'GET', body) => demo.demoRequest(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const now = new Date();
  const year = now.getFullYear();
  const today = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const through = new Date(now.getFullYear(), now.getMonth() + 3, 1);
  const throughDate = `${through.getFullYear()}-${String(through.getMonth() + 1).padStart(2, '0')}-${String(through.getDate()).padStart(2, '0')}`;
  const created = await call('/recurring-expenses', 'POST', {
    name: 'Terminraster', category: 'software', scope: 'business', amountGross: 44, taxRate: 19,
    interval: 'monthly', intervalCount: 1, intervalUnit: 'months', startDate: `${year}-01-01`, endDate: null,
    cancelledOn: null, noticePeriodDays: 0, status: 'active', pauses: [], priceChanges: [], automaticBooking: false,
    linkedReceiptId: null, notes: '',
  });
  await call('/recurring-expenses/generate', 'POST', { throughDate });
  let runs = await call('/recurring-expenses/runs');
  const currentRun = runs.find(run => run.expenseId === created.id && run.dueDate <= today && run.status === 'planned');
  const futureRun = runs.find(run => run.expenseId === created.id && run.dueDate > today && run.status === 'planned');
  assert.ok(currentRun);
  assert.ok(futureRun);
  const currentSnapshot = JSON.parse(globalThis.localStorage.getItem('solooffice-demo-data-v1')).recurringExpenseRuns.find(run => run.id === currentRun.id).snapshot;
  await call(`/recurring-expenses/runs/${currentRun.id}/confirm`, 'POST', { paidOn: today });
  await call(`/recurring-expenses/runs/${futureRun.id}/skip`, 'POST', {});
  await call(`/recurring-expenses/${created.id}`, 'PUT', { ...created, interval: 'quarterly', intervalCount: 3, intervalUnit: 'months' });
  const state = JSON.parse(globalThis.localStorage.getItem('solooffice-demo-data-v1'));
  assert.deepEqual(state.recurringExpenseRuns.find(run => run.id === currentRun.id).snapshot, currentSnapshot);
  assert.equal(state.recurringExpenseRuns.find(run => run.id === currentRun.id).status, 'confirmed');
  assert.equal(state.recurringExpenseRuns.find(run => run.id === futureRun.id).status, 'skipped');
  assert.equal(state.recurringExpenseRuns.some(run => run.expenseId === created.id && run.status === 'planned' && run.dueDate > today), false);
});

test('Profilkopie behält Ziel-ID und vorhandene Kirchensteuer-Einwilligung samt Angabe', async t => {
  globalThis.localStorage = new MemoryStorage();
  globalThis.sessionStorage = new MemoryStorage();
  const { module: demo, temp } = await loadDemoApi();
  t.after(async () => { await rm(temp, { recursive: true, force: true }); });
  const call = (url, method = 'GET', body) => demo.demoRequest(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const currentYear = new Date().getFullYear();
  const targetYear = currentYear + 1;
  await call(`/tax-profile/${targetYear}`);
  const targetBefore = await call(`/tax-profile/${targetYear}/church-consent`, 'POST', { consented: true, liable: false });
  const copied = await call(`/tax-profile/${currentYear}/copy`, 'POST', { targetYear });
  assert.equal(copied.id, targetBefore.id);
  assert.equal(copied.churchTaxConsentAt, targetBefore.churchTaxConsentAt);
  assert.equal(copied.churchTaxLiable, false);
  assert.equal(copied.businessKind, 'teacher');
});

test('Alte persistierte Demo erhält Finanzseed einmal; bewusster Reset hält Arrays leer und wahrt Profile/Erweiterungen', async t => {
  globalThis.localStorage = new MemoryStorage();
  globalThis.sessionStorage = new MemoryStorage();
  const today = new Date();
  const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  globalThis.localStorage.setItem('solooffice-demo-data-v1', JSON.stringify({ seedVersion: 11, seededAt: todayString, touched: true,
    company: { terminologyProfile: 'customers', name: 'Bestehende Demo' }, euerEntries: [], euerEntryHistory: [] }));
  const { module: demo, temp } = await loadDemoApi();
  t.after(async () => { await rm(temp, { recursive: true, force: true }); });
  await demo.demoRequest('/recurring-expenses');
  const before = JSON.parse(globalThis.localStorage.getItem('solooffice-demo-data-v1'));
  assert.ok(before.recurringExpenses.length > 0);
  assert.equal(before.financeSeedVersion, 3);
  const privateTemplates = before.recurringExpenses.filter(expense => expense.scope === 'private_levy');
  assert.deepEqual(privateTemplates.map(expense => expense.levyKind).sort(), ['kv', 'pv', 'rv']);
  assert.ok(before.recurringExpenseRuns.some(run => run.scope === 'private_levy' && run.status === 'planned'));
  assert.ok(before.recurringExpenseRuns.filter(run => run.scope === 'private_levy' && run.status === 'confirmed')
    .every(run => before.levyPayments.some(payment => payment.id === run.levyPaymentId)));
  assert.equal(before.euerEntries.some(entry => privateTemplates.some(expense => entry.sourceId === expense.id)), false);
  const savedProfiles = before.taxProfiles;
  const savedExtensions = before.extensions;
  demo.resetDemoWorkspaceData({ companyProfile: false, takeover: false });
  const after = JSON.parse(globalThis.localStorage.getItem('solooffice-demo-data-v1'));
  assert.deepEqual(after.recurringExpenses, []);
  assert.deepEqual(after.recurringExpenseRuns, []);
  assert.deepEqual(after.levyPayments, []);
  assert.deepEqual(after.taxProfiles, savedProfiles);
  assert.deepEqual(after.extensions, savedExtensions);
  assert.equal(after.company.name, 'Bestehende Demo');
  await demo.demoRequest('/recurring-expenses');
  assert.deepEqual(JSON.parse(globalThis.localStorage.getItem('solooffice-demo-data-v1')).recurringExpenses, []);
});

test('Demo-Finanzupgrade ergänzt private Vorlagen, bewahrt Zahlungen und EÜR-Nutzerdaten', async t => {
  globalThis.localStorage = new MemoryStorage();
  globalThis.sessionStorage = new MemoryStorage();
  const userEntry = { id: 'user-euer', entryType: 'expense', amount: 123, sourceType: 'manual' };
  const savedPayment = { id: 'user-levy', kind: 'kv', year: new Date().getFullYear(), period: `${new Date().getFullYear()}-01`, dueDate: `${new Date().getFullYear()}-01-15`, paidOn: `${new Date().getFullYear()}-01-15`, amount: 222, source: 'notice', expenseRunId: null, notes: 'Eigene Angabe' };
  globalThis.localStorage.setItem('solooffice-demo-data-v1', JSON.stringify({ seedVersion: 11, financeSeedVersion: 2, touched: true,
    company: { terminologyProfile: 'customers', name: 'Eigene Demo' }, euerEntries: [userEntry], euerEntryHistory: [],
    extensions: [], taxProfiles: [], recurringExpenses: [], recurringExpenseRuns: [], levyPayments: [savedPayment] }));
  const { module: demo, temp } = await loadDemoApi();
  t.after(async () => { await rm(temp, { recursive: true, force: true }); });
  await demo.demoRequest('/recurring-expenses');
  const upgraded = JSON.parse(globalThis.localStorage.getItem('solooffice-demo-data-v1'));
  assert.equal(upgraded.financeSeedVersion, 3);
  assert.equal(upgraded.recurringExpenses.filter(expense => expense.scope === 'private_levy').length, 3);
  assert.deepEqual(upgraded.levyPayments, [savedPayment]);
  assert.deepEqual(upgraded.euerEntries, [userEntry]);
  assert.equal(upgraded.recurringExpenseRuns.some(run => run.scope === 'private_levy' && run.status === 'planned'), true);
});

test('Demo-Forecast zählt bezahlte Alt-Rechnungen ohne EÜR-Zahlung nicht doppelt und warnt dazu', async t => {
  globalThis.localStorage = new MemoryStorage();
  globalThis.sessionStorage = new MemoryStorage();
  const { module: demo, temp } = await loadDemoApi();
  t.after(async () => { await rm(temp, { recursive: true, force: true }); });
  const year = new Date().getFullYear();
  const forecast = await demo.demoRequest(`/forecast/${year}`);
  const state = JSON.parse(globalThis.localStorage.getItem('solooffice-demo-data-v1'));
  const bookedIncome = state.euerEntries.filter(entry => entry.entryType === 'income' && entry.status !== 'voided')
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  assert.equal(forecast.revenueYtd, bookedIncome);
  assert.ok(forecast.warnings.some(warning => warning.includes('ohne zugehörigen EÜR-Zahlungseingang')));
});

test('Das aktuelle Steuerjahr nutzt das Demo-Beispielprofil; andere Jahre bleiben wirklich leer', async t => {
  globalThis.localStorage = new MemoryStorage();
  globalThis.sessionStorage = new MemoryStorage();
  const { module: demo, temp } = await loadDemoApi();
  t.after(async () => { await rm(temp, { recursive: true, force: true }); });
  const currentYear = new Date().getFullYear();
  const current = await demo.demoRequest(`/tax-profile/${currentYear}`);
  const next = await demo.demoRequest(`/tax-profile/${currentYear + 1}`);
  assert.equal(current.businessKind, 'teacher');
  assert.equal(current.healthNoticeIncomeMonthly, 1500);
  assert.equal(next.businessKind, null);
  assert.equal(next.healthInsurance, null);
  assert.equal(next.pensionStatus, 'unclear');
});
