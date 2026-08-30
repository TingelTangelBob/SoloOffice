export const DATABASE_RLS_RESTART_MESSAGE =
  'Datenbank-RLS wurde abgesichert. Backend wird einmal neu gestartet.';

// Ein eigener Exit-Code unterscheidet den erwarteten Verbindungsneustart von
// echten Startfehlern. Der Produktionsstarter akzeptiert ihn genau einmal.
export const DATABASE_RLS_RESTART_EXIT_CODE = 75;

export function isDatabaseRlsRestart(error) {
  return error instanceof Error && error.message === DATABASE_RLS_RESTART_MESSAGE;
}
