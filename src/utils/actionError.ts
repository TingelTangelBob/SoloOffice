/**
 * Baut die Fehlermeldung für eine fehlgeschlagene Nutzeraktion: der deutsche
 * Grundtext und, sofern vorhanden, die Meldung des Servers bzw. der Demo-API.
 */
export function actionErrorMessage(fallback: string, error: unknown): string {
  const detail = error instanceof Error ? error.message.trim() : '';
  return detail ? `${fallback} ${detail}` : fallback;
}
