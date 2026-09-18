/**
 * Sperrzustand eines Workspaces (AP-4.4).
 *
 * Eine Sperre stammt aus dem Control Plane, typischerweise wegen offener
 * Zahlungen. Sie darf keine Daten unerreichbar machen: Lesen und Export
 * bleiben erlaubt, Schreibzugriffe werden abgewiesen.
 */

const writeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Export ist in der Fachapp ein schreibender HTTP-Aufruf, fachlich aber ein
// Lesevorgang. Ohne diese Ausnahme käme ein gesperrter Workspace nicht mehr an
// seine eigenen Daten.
const exportPaths = new Set(['/backup/create', '/backup/create-zip']);

// Gerade ein gesperrter Workspace muss den Support erreichen können (meist
// geht es um genau diese Sperre). Tickets liegen im Control Plane, nicht in
// den Fachdaten – die Sperre schützt hier nichts.
function isSupportPath(path) {
  return path === '/support/tickets' || path.startsWith('/support/tickets/');
}

export function workspaceSuspensionGuard(req, res, next) {
  const suspendedAt = req.auth?.workspace?.suspendedAt;
  if (!suspendedAt) return next();
  if (!writeMethods.has(req.method)) return next();
  if (exportPaths.has(req.path)) return next();
  if (isSupportPath(req.path)) return next();

  return res.status(403).json({
    error: 'Dieser Arbeitsbereich ist gesperrt. Daten lassen sich weiterhin ansehen und exportieren, Änderungen sind bis zur Freigabe nicht möglich.',
    code: 'WORKSPACE_SUSPENDED',
    suspendedAt,
  });
}
