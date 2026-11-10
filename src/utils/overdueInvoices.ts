/**
 * Markiert versendete Rechnungen mit überschrittenem Fälligkeitsdatum als
 * „überfällig“. Wird von Dashboard und Rechnungsliste beim Laden aufgerufen.
 * Eine Laufsperre verhindert, dass zwei Läufe gleichzeitig dieselben
 * Rechnungen schreiben (Prüfbericht H-2).
 */
export type OverdueCandidate = { id: string; status: string; dueDate: string | Date };

let inFlight: Promise<number> | null = null;

export function findOverdueInvoiceIds(invoices: OverdueCandidate[], today: Date = new Date()): string[] {
  const startOfDay = new Date(today);
  startOfDay.setHours(0, 0, 0, 0);
  return invoices
    .filter(invoice => {
      if (invoice.status !== 'sent') return false;
      const dueDate = new Date(invoice.dueDate);
      dueDate.setHours(0, 0, 0, 0);
      return dueDate < startOfDay;
    })
    .map(invoice => invoice.id);
}

/** Liefert die Anzahl der aktualisierten Rechnungen; ein laufender Lauf wird abgewartet. */
export function markOverdueInvoices(
  invoices: OverdueCandidate[],
  updateInvoice: (id: string, data: { status: 'overdue' }) => Promise<unknown>,
  onError: (error: unknown) => void,
  today?: Date,
): Promise<number> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    let count = 0;
    for (const id of findOverdueInvoiceIds(invoices, today)) {
      try {
        await updateInvoice(id, { status: 'overdue' });
        count += 1;
      } catch (error) {
        onError(error);
      }
    }
    return count;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
