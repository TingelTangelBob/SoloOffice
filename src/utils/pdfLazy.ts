/**
 * Dünne Zugänge zur PDF-Erzeugung. jsPDF und der Dokumentrenderer sind
 * zusammen mehr als ein Megabyte; sie sollen erst geladen werden, wenn ein
 * Dokument wirklich entsteht, nicht schon mit der Übersicht oder der
 * Rechnungsliste. Die Aufrufer warten ohnehin auf das Ergebnis.
 */
import type * as PdfGenerator from './pdfGenerator';

export { downloadBlob } from './blobUtils';

const loadGenerator = () => import('./pdfGenerator');

/** Lädt die PDF-Erzeugung vor, etwa wenn ein Dialog mit Download öffnet. */
export function preloadPdfGenerator(): void {
  void loadGenerator().catch(() => {});
}

export async function generateInvoicePDF(...args: Parameters<typeof PdfGenerator.generateInvoicePDF>) {
  return (await loadGenerator()).generateInvoicePDF(...args);
}

export async function generateJobPDF(...args: Parameters<typeof PdfGenerator.generateJobPDF>) {
  return (await loadGenerator()).generateJobPDF(...args);
}

export async function generateQuotePDF(...args: Parameters<typeof PdfGenerator.generateQuotePDF>) {
  return (await loadGenerator()).generateQuotePDF(...args);
}

export async function generateReminderPDF(...args: Parameters<typeof PdfGenerator.generateReminderPDF>) {
  return (await loadGenerator()).generateReminderPDF(...args);
}

export async function loadImportedInvoiceOriginal(...args: Parameters<typeof PdfGenerator.loadImportedInvoiceOriginal>) {
  return (await loadGenerator()).loadImportedInvoiceOriginal(...args);
}
