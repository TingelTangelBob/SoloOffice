/** Alte Browseransichten dürfen nach einem Sitzungswechsel keine andere Firma ändern. */
export function requireCompanyWriteContext(req, res, next) {
  const workspace = req.get('X-SoloOffice-Workspace');
  const user = req.get('X-SoloOffice-User');
  // Bestehende API-Clients bleiben kompatibel; gebundene Browser-Writes
  // müssen beide Angaben mit der tatsächlich authentifizierten Sitzung teilen.
  if (workspace === undefined && user === undefined) return next();
  if (!workspace || !user || workspace !== req.auth?.workspaceId || user !== req.auth?.userId) {
    return res.status(409).json({
      error: 'Die Sitzung oder der Arbeitsbereich wurde gewechselt. Laden Sie die Firmendaten neu.',
      code: 'COMPANY_CONTEXT_CHANGED',
    });
  }
  return next();
}
