/**
 * PostgreSQL liefert DECIMAL-Spalten als Text ("75.00"). Die API soll Zahlen
 * liefern; sonst zeigt das Frontend leere Beträge.
 */
export function withNumericFields(row, keys) {
  if (!row) return row;
  const result = { ...row };
  for (const key of keys) {
    if (result[key] !== null && result[key] !== undefined) result[key] = Number(result[key]);
  }
  return result;
}
