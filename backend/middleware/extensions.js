import { query } from '../database.js';
import { getExtensionDefinition, canUseExtension } from '../shared/extensions.js';

/** Liest den aktivierten Zustand im aktuellen Workspace. */
export async function isExtensionEnabled(workspaceId, id, queryFn = query) {
  const definition = getExtensionDefinition(id);
  if (!definition || !workspaceId) return false;

  if (definition.legacyCompanyField) {
    const result = await queryFn(
      `SELECT ${definition.legacyCompanyField} AS enabled FROM company WHERE workspace_id = $1 LIMIT 1`,
      [workspaceId],
    );
    return result.rows[0]?.enabled === true;
  }

  const result = await queryFn(
    'SELECT enabled FROM workspace_extensions WHERE workspace_id = $1 AND extension_id = $2',
    [workspaceId, id],
  );
  return result.rows[0]?.enabled === true;
}

/** Blockiert API-Aufrufe für ausgeschaltete Erweiterungen. */
export function requireExtension(id, queryFn = query) {
  return async (req, res, next) => {
    try {
      const definition = getExtensionDefinition(id);
      const enabled = await isExtensionEnabled(req.auth?.workspaceId, id, queryFn);
      // Der Tarif stammt ausschließlich aus dem serverseitig geladenen Auth-Kontext.
      const plan = req.auth?.workspace?.plan || 'free';
      if (!canUseExtension(definition, enabled, plan)) {
        return res.status(403).json({ error: 'Diese Erweiterung ist nicht aktiviert.', code: 'EXTENSION_DISABLED' });
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
