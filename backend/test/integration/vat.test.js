import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool, query } from '../../database.js';
import { createVatPayment, updateVatPayment, bookVatPayment } from '../../services/vatPayments.js';
import { runWithRequestContext } from '../../utils/requestContext.js';
import { cleanupFinanceWorkspaces } from './financeTestCleanup.js';

if (!/(?:^|[_-])(integration|test)(?:$|[_-])/i.test(String(process.env.DB_NAME || ''))) {
  throw new Error('Umsatzsteuer-Integrationstests dürfen nur gegen eine als Test/Integration benannte Datenbank laufen.');
}

const workspaceId = randomUUID();
const userId = randomUUID();
const suffix = randomUUID().slice(0, 8);
const inWorkspace = callback => runWithRequestContext({ workspaceId, userId }, callback);
let paymentId;

before(async () => {
  await pool.query('INSERT INTO workspaces (id,name,slug) VALUES ($1,$2,$3)', [workspaceId, 'USt-Test', `vat-${suffix}`]);
  await inWorkspace(() => query("INSERT INTO workspace_extensions (extension_id,enabled,accepted_at) VALUES ('taxes',TRUE,NOW())"));
});

after(() => cleanupFinanceWorkspaces([workspaceId]));

test('bezahlte Zahlung erzeugt EÜR-Buchung; Zurücksetzen storniert sie und erneute Zahlung bleibt idempotent', async () => {
  await inWorkspace(async () => {
    const created = await createVatPayment({ kind: 'advance', taxYear: 2026, periodKey: '2026-Q1', amount: 420, paidOn: '2026-04-08' });
    assert.ok(created.payment?.id);
    paymentId = created.payment.id;
    assert.ok(created.payment.euerEntryId);
    let entry = await query('SELECT * FROM euer_entries WHERE id=$1', [created.payment.euerEntryId]);
    assert.equal(entry.rows[0].source_type, 'vat_payment');
    assert.equal(entry.rows[0].category, 'vat_payment');
    assert.equal(entry.rows[0].vat_treatment, 'no_vat');
    assert.equal(entry.rows[0].euer_year, null);

    const reset = await updateVatPayment(paymentId, { paidOn: null });
    assert.equal(reset.payment.euerEntryId, null);
    entry = await query('SELECT status,correction_reason FROM euer_entries WHERE id=$1', [created.payment.euerEntryId]);
    assert.equal(entry.rows[0].status, 'voided');
    assert.ok(entry.rows[0].correction_reason);

    const repaid = await updateVatPayment(paymentId, { paidOn: '2026-04-09' });
    assert.ok(repaid.payment.euerEntryId);
    assert.notEqual(repaid.payment.euerEntryId, created.payment.euerEntryId);
    const repeated = await updateVatPayment(paymentId, { amount: 420 });
    assert.equal(repeated.payment.euerEntryId, repaid.payment.euerEntryId);
    const active = await query("SELECT id FROM euer_entries WHERE source_type='vat_payment' AND source_id=$1 AND status='active'", [paymentId]);
    assert.equal(active.rowCount, 1);
  });
});

test('Migration erzwingt Workspace-RLS für USt-Zahlungen', async () => {
  const own = await inWorkspace(() => query('SELECT id FROM vat_payments WHERE id=$1', [paymentId]));
  assert.equal(own.rowCount, 1);
  const other = await runWithRequestContext({ workspaceId: randomUUID(), userId: randomUUID() }, () => query('SELECT id FROM vat_payments WHERE id=$1', [paymentId]));
  assert.equal(other.rowCount, 0);
  const metadata = await pool.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='vat_payments'::regclass");
  assert.equal(metadata.rows[0].relrowsecurity, true);
  assert.equal(metadata.rows[0].relforcerowsecurity, true);
});

test('Altzahlung wird erst nach ausdrücklicher Buchung in die EÜR übernommen', async () => {
  await inWorkspace(async () => {
    const inserted = await query(`INSERT INTO vat_payments (kind,tax_year,period_key,paid_on,amount,source,notes)
      VALUES ('advance',2025,NULL,'2025-04-10',85,'legacy_levy','Altbestand') RETURNING id`, []);
    const id = inserted.rows[0].id;
    const before = await query("SELECT id FROM euer_entries WHERE source_type='vat_payment' AND source_id=$1", [id]);
    assert.equal(before.rowCount, 0);
    const result = await bookVatPayment(id);
    assert.ok(result.euerEntryId);
    const afterRows = await query("SELECT category FROM euer_entries WHERE source_type='vat_payment' AND source_id=$1 AND status='active'", [id]);
    assert.equal(afterRows.rows[0].category, 'vat_payment');
    const again = await bookVatPayment(id);
    assert.equal(again.idempotent, true);
  });
});
