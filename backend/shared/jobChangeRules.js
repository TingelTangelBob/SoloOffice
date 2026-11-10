// Regeln für Änderungen und Löschungen abgerechneter Aufträge.
//
// Gemeinsam von Backend (backend/routes/jobs.js) und Demo-Modus
// (src/services/demoApi.ts) genutzt, damit beide dieselbe Ablehnung liefern.
// Reine Funktionen ohne Node- oder Datenbankzugriff, damit sie auch im Browser
// laufen. Ein abgerechneter Auftrag hat den Status `invoiced` (siehe
// STATE_MACHINES.job in ./stateMachines.js).
//
// Jede Regel liefert `null` (erlaubt) oder ein Objekt mit HTTP-Status und
// Antwortkörper. Der Aufrufer sendet den Körper unverändert: `error` ist die
// Meldung, die die Oberfläche anzeigt, `message` die Erläuterung.

export const JOB_INVOICED_STATUS = 'invoiced';

const EDIT_PROBLEM = Object.freeze({
  status: 403,
  error: 'Cannot edit invoiced job',
  message: 'Jobs that have been invoiced cannot be modified to maintain invoice integrity.',
});

const DELETE_PROBLEM = Object.freeze({
  status: 403,
  error: 'Cannot delete invoiced job',
  message: 'Jobs that have been invoiced cannot be deleted to maintain invoice integrity.',
});

const BULK_DELETE_PROBLEM = Object.freeze({
  status: 403,
  error: 'Abgerechnete Aufträge können nicht gelöscht werden.',
  message: 'Einige ausgewählte Aufträge wurden bereits abgerechnet und bleiben unverändert.',
});

/** Bearbeiten eines einzelnen Auftrags, anhand des aktuellen Status. */
export function jobEditProblem(currentStatus) {
  return currentStatus === JOB_INVOICED_STATUS ? { ...EDIT_PROBLEM } : null;
}

/** Löschen eines einzelnen Auftrags, anhand des aktuellen Status. */
export function jobDeleteProblem(currentStatus) {
  return currentStatus === JOB_INVOICED_STATUS ? { ...DELETE_PROBLEM } : null;
}

/**
 * Sammellöschung: `jobs` ist eine Liste mit `id` und `status`. Liefert bei
 * mindestens einem abgerechneten Auftrag die Ablehnung samt `invoicedJobIds`.
 */
export function jobBulkDeleteProblem(jobs) {
  const invoicedJobIds = (Array.isArray(jobs) ? jobs : [])
    .filter((job) => job?.status === JOB_INVOICED_STATUS)
    .map((job) => job.id);
  if (invoicedJobIds.length === 0) return null;
  return { ...BULK_DELETE_PROBLEM, invoicedJobIds };
}
