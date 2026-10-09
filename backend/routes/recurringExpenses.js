import express from 'express';
import { pool, query } from '../database.js';
import { hasPermission } from '../middleware/auth.js';
import { isExtensionEnabled } from '../middleware/extensions.js';
import {
  confirmRun, createExpense, deleteExpense, generateRuns, isUuid, listExpenses, listRuns, skipRun, updateExpense,
} from '../services/recurringExpenses.js';

const router = express.Router();
const today = () => new Date().toISOString().slice(0, 10);

const taxesEnabled = (req, executor = query) => isExtensionEnabled(req.auth?.workspaceId, 'taxes', executor);

function privateForbidden(res) {
  return res.status(403).json({ error: 'Für private Abgaben fehlt die Berechtigung.', code: 'FORBIDDEN' });
}

async function allowPrivateMutation(req, res, executor = query) {
  if (!(await taxesEnabled(req, executor))) {
    res.status(403).json({ error: 'Diese Erweiterung ist nicht aktiviert.', code: 'EXTENSION_DISABLED' });
    return false;
  }
  if (!hasPermission(req.auth, 'workspace.settings')) {
    privateForbidden(res);
    return false;
  }
  return true;
}

router.get('/runs', async (req, res, next) => {
  try {
    const runs = await listRuns(query, { year: req.query.year, dueOnly: req.query.dueOnly === 'true', today: today() });
    // Private Fälligkeiten sind sensible Daten und werden nur mit aktivierter
    // Erweiterung und Leserecht für Workspace-Einstellungen ausgeliefert.
    if (!(await taxesEnabled(req)) || !hasPermission(req.auth, 'workspace.settings')) {
      const expenseIds = runs.map(run => run.expenseId);
      if (!expenseIds.length) return res.json(runs);
      const scopes = await query('SELECT id,scope FROM recurring_expenses WHERE id=ANY($1::uuid[])', [expenseIds]);
      const businessIds = new Set(scopes.rows.filter(row => row.scope === 'business').map(row => row.id));
      return res.json(runs.filter(run => businessIds.has(run.expenseId)));
    }
    res.json(runs);
  } catch (error) { next(error); }
});

router.post('/generate', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const throughDate = String(req.body?.throughDate || '');
    const enabled = await taxesEnabled(req, client.query.bind(client));
    const canManagePrivate = enabled && hasPermission(req.auth, 'workspace.settings');
    await client.query('BEGIN');
    const runs = await generateRuns(client, throughDate, { autoConfirm: true, canManagePrivate, canAccessPrivate: canManagePrivate, today: today() });
    await client.query('COMMIT');
    res.status(201).json(runs);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error instanceof TypeError) return res.status(400).json({ error: error.message });
    next(error);
  } finally { client.release(); }
});

router.get('/', async (req, res, next) => {
  try {
    const rows = await listExpenses(query);
    const enabled = await taxesEnabled(req);
    res.json(rows.filter(row => row.scope === 'business' || (enabled && hasPermission(req.auth, 'workspace.settings'))));
  } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
  try {
    if (req.body?.scope === 'private_levy' && !(await allowPrivateMutation(req, res))) return;
    const result = await createExpense(query, req.body || {}, today());
    if (result.error) return res.status(400).json({ error: result.error });
    res.status(201).json(result.expense);
  } catch (error) { next(error); }
});

router.put('/:id', async (req, res, next) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Ungültige Fixkosten-ID.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT scope FROM recurring_expenses WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (current.rows[0]?.scope === 'private_levy' && !(await allowPrivateMutation(req, res, client.query.bind(client)))) { await client.query('ROLLBACK'); return; }
    if (req.body?.scope === 'private_levy' && !(await allowPrivateMutation(req, res, client.query.bind(client)))) { await client.query('ROLLBACK'); return; }
    const result = await updateExpense(client.query.bind(client), req.params.id, req.body || {}, today());
    if (result.missing) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Fixkosten-Vorlage nicht gefunden.' }); }
    if (result.error) { await client.query('ROLLBACK'); return res.status(400).json({ error: result.error }); }
    await client.query('COMMIT');
    res.json(result.expense);
  } catch (error) { await client.query('ROLLBACK'); next(error); }
  finally { client.release(); }
});

router.delete('/:id', async (req, res, next) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Ungültige Fixkosten-ID.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT scope FROM recurring_expenses WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (current.rows[0]?.scope === 'private_levy' && !(await allowPrivateMutation(req, res, client.query.bind(client)))) { await client.query('ROLLBACK'); return; }
    const result = await deleteExpense(client.query.bind(client), req.params.id);
    if (result.missing) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Fixkosten-Vorlage nicht gefunden.' }); }
    if (result.conflict) { await client.query('ROLLBACK'); return res.status(409).json({ error: result.conflict }); }
    await client.query('COMMIT');
    res.json({ deleted: true });
  } catch (error) { await client.query('ROLLBACK'); next(error); }
  finally { client.release(); }
});

router.post('/runs/:runId/confirm', async (req, res, next) => {
  if (!isUuid(req.params.runId)) return res.status(400).json({ error: 'Ungültige Lauf-ID.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const runInfo = await client.query('SELECT snapshot FROM recurring_expense_runs WHERE id=$1 FOR UPDATE', [req.params.runId]);
    if (runInfo.rows[0]?.snapshot?.scope === 'private_levy' && !(await allowPrivateMutation(req, res, client.query.bind(client)))) { await client.query('ROLLBACK'); return; }
    const result = await confirmRun(client, req.params.runId, String(req.body?.paidOn || ''), today());
    if (result.missing) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Fälligkeitslauf nicht gefunden.' }); }
    if (result.conflict) { await client.query('ROLLBACK'); return res.status(409).json({ error: result.conflict }); }
    await client.query('COMMIT');
    res.json(result.run);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error instanceof TypeError) return res.status(400).json({ error: error.message });
    next(error);
  } finally { client.release(); }
});

router.post('/runs/:runId/skip', async (req, res, next) => {
  if (!isUuid(req.params.runId)) return res.status(400).json({ error: 'Ungültige Lauf-ID.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT snapshot FROM recurring_expense_runs WHERE id=$1 FOR UPDATE', [req.params.runId]);
    if (current.rows[0]?.snapshot?.scope === 'private_levy' && !(await allowPrivateMutation(req, res, client.query.bind(client)))) { await client.query('ROLLBACK'); return; }
    const result = await skipRun(client.query.bind(client), req.params.runId);
    if (result.missing) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Fälligkeitslauf nicht gefunden.' }); }
    if (result.conflict) { await client.query('ROLLBACK'); return res.status(409).json({ error: result.conflict }); }
    await client.query('COMMIT');
    res.json(result.run);
  } catch (error) { await client.query('ROLLBACK'); next(error); }
  finally { client.release(); }
});

export default router;
