import express from 'express';
import { query } from '../database.js';
import { hasPermission } from '../middleware/auth.js';
import { EXTENSION_CATALOG, getExtensionDefinition, workspaceExtension, canUseExtension } from '../shared/extensions.js';

const router = express.Router();

function requireSettings(req, res) {
  if (hasPermission(req.auth, 'workspace.settings')) return true;
  res.status(403).json({ error: 'Nur Administratoren dürfen Erweiterungen verwalten.', code: 'FORBIDDEN' });
  return false;
}

router.get('/', async (req, res, next) => {
  try {
    const [companyResult, extensionResult] = await Promise.all([
      query(`SELECT job_tracking_enabled, quotes_enabled, reporting_enabled FROM company WHERE workspace_id = $1 LIMIT 1`, [req.auth.workspaceId]),
      query('SELECT extension_id, enabled, accepted_at, updated_at FROM workspace_extensions WHERE workspace_id = $1', [req.auth.workspaceId]),
    ]);
    const company = companyResult.rows[0] || {};
    const byId = new Map(extensionResult.rows.map(row => [row.extension_id, row]));
    const fields = { jobTracking: 'job_tracking_enabled', quotes: 'quotes_enabled', reporting: 'reporting_enabled' };
    return res.json(EXTENSION_CATALOG.map(definition => workspaceExtension(definition,
      definition.legacyCompanyField
        ? { enabled: company[fields[definition.id]] === true }
        : byId.get(definition.id),
    )));
  } catch (error) {
    return next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  if (!requireSettings(req, res)) return;
  const definition = getExtensionDefinition(req.params.id);
  if (!definition) return res.status(404).json({ error: 'Erweiterung nicht gefunden.', code: 'EXTENSION_NOT_FOUND' });
  const { enabled, acceptDisclaimer } = req.body || {};
  if (typeof enabled !== 'boolean' || (acceptDisclaimer !== undefined && acceptDisclaimer !== true)) {
    return res.status(400).json({ error: 'Ungültige Angaben zur Erweiterung.', code: 'EXTENSION_INVALID' });
  }

  try {
    if (enabled && !canUseExtension(definition, true, req.auth?.workspace?.plan || 'free')) {
      return res.status(403).json({ error: 'Diese Erweiterung benötigt einen anderen Tarif.', code: 'EXTENSION_PLAN_REQUIRED' });
    }
    if (definition.legacyCompanyField) {
      const result = await query(
        `UPDATE company SET ${definition.legacyCompanyField} = $1 WHERE workspace_id = $2 RETURNING ${definition.legacyCompanyField} AS enabled`,
        [enabled, req.auth.workspaceId],
      );
      if (!result.rows[0]) return res.status(404).json({ error: 'Unternehmensdaten nicht gefunden.' });
      return res.json(workspaceExtension(definition, result.rows[0]));
    }

    const current = await query(
      'SELECT accepted_at FROM workspace_extensions WHERE workspace_id = $1 AND extension_id = $2',
      [req.auth.workspaceId, definition.id],
    );
    if (definition.id === 'taxes' && enabled && !current.rows[0]?.accepted_at && acceptDisclaimer !== true) {
      return res.status(400).json({ error: 'Bitte bestätige zuerst den Hinweis zu Schätzungen und Prognosen.', code: 'EXTENSION_DISCLAIMER_REQUIRED' });
    }
    const result = await query(`
      INSERT INTO workspace_extensions (workspace_id, extension_id, enabled, accepted_at, updated_at)
      VALUES ($1, $2, $3, CASE WHEN $3 AND $4 THEN NOW() ELSE NULL END, NOW())
      ON CONFLICT (workspace_id, extension_id) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        accepted_at = CASE
          WHEN workspace_extensions.accepted_at IS NOT NULL THEN workspace_extensions.accepted_at
          WHEN $3 AND $4 THEN NOW()
          ELSE workspace_extensions.accepted_at
        END,
        updated_at = NOW()
      RETURNING enabled, accepted_at, updated_at
    `, [req.auth.workspaceId, definition.id, enabled, acceptDisclaimer === true]);
    return res.json(workspaceExtension(definition, result.rows[0]));
  } catch (error) {
    return next(error);
  }
});

export default router;
