// Umwandlung eines Angebots in einen Auftrag: reine Abbildungs- und Prüflogik.
//
// Gemeinsam von Backend (backend/services/quoteService.js) und Demo-Modus
// (src/services/demoApi.ts) genutzt. Keine Node- oder Datenbankzugriffe, damit
// die Datei auch im Browser läuft. Die Datenbankanteile (Sperren, Nummernkreis,
// Einfügen) liegen im Aufrufer.
//
// Was der Auftrag vom Angebot übernimmt:
//   Kunde, Positionen (als Materialpositionen mit Menge, Einzelpreis, Steuersatz,
//   Positionsrabatt und Positionssumme), Hinweise als Notiz, Verknüpfung zum Angebot.
// Was er nicht abbilden kann:
//   Gesamtrabatt (der Auftrag kennt nur Rabatte je Position), Anhänge des
//   Angebots, Ausstellungs- und Gültigkeitsdatum. Der Auftrag bekommt das
//   heutige Datum und startet als Entwurf.

import { checkManualTransition } from './stateMachines.js';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TITLE_LENGTH = 255;

export const QUOTE_JOB_ERRORS = Object.freeze({
  ALREADY_CONVERTED: 'Aus diesem Angebot wurde bereits ein Auftrag erstellt.',
  BILLED: 'Ein bereits abgerechnetes Angebot kann nicht in einen Auftrag umgewandelt werden.',
  WRONG_STATUS: 'Nur versendete oder angenommene Angebote können in einen Auftrag umgewandelt werden.',
});

/**
 * Prüft, ob ein Angebot in einen Auftrag umgewandelt werden darf.
 * Liefert `null` (erlaubt) oder `{ status, code, error }`.
 */
export function quoteToJobProblem(quote, existingJobId = null) {
  if (existingJobId) return { status: 409, code: 'QUOTE_ALREADY_CONVERTED', error: QUOTE_JOB_ERRORS.ALREADY_CONVERTED };
  if (quote.convertedToInvoiceId || quote.status === 'billed') {
    return { status: 409, code: 'QUOTE_BILLED', error: QUOTE_JOB_ERRORS.BILLED };
  }
  if (quote.status !== 'sent' && quote.status !== 'accepted') {
    return { status: 400, code: 'QUOTE_STATUS_INVALID', error: QUOTE_JOB_ERRORS.WRONG_STATUS };
  }
  return null;
}

/** Status des Angebots nach der Umwandlung: ein versendetes Angebot gilt damit als angenommen. */
export function quoteStatusAfterJobConversion(status) {
  if (status === 'accepted') return 'accepted';
  if (status === 'sent' && checkManualTransition('quote', 'sent', 'accepted') === null) return 'accepted';
  return status;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sortedItems(items) {
  return [...(Array.isArray(items) ? items : [])].sort((a, b) => numberOr(a.order) - numberOr(b.order));
}

/** Titel des Auftrags: Angebotsnummer, bei Positionen mit der ersten Bezeichnung. */
export function jobTitleFromQuote(quote) {
  const items = sortedItems(quote.items);
  const first = text(items[0]?.description).replace(/\s+/g, ' ');
  const base = `Angebot ${quote.quoteNumber}`;
  if (!first) return base;
  const more = items.length > 1 ? ' u. a.' : '';
  return `${base}: ${first}${more}`.slice(0, MAX_TITLE_LENGTH);
}

function numberOr(value, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Bildet die Positionen eines Angebots auf Materialpositionen des Auftrags ab.
 * `newId` liefert je Position eine neue ID (Backend und Demo bringen ihre eigene mit).
 */
export function materialsFromQuoteItems(items, newId) {
  return sortedItems(items)
    .map(item => {
      const material = {
        id: newId(),
        description: text(item.description),
        quantity: numberOr(item.quantity),
        unitPrice: numberOr(item.unitPrice),
        taxRate: numberOr(item.taxRate),
        total: numberOr(item.total),
      };
      if (item.discountType) {
        material.discountType = item.discountType;
        material.discountValue = numberOr(item.discountValue);
        material.discountAmount = numberOr(item.discountAmount);
      }
      return material;
    });
}

/**
 * Auftragsdaten aus einem Angebot. `quote` hat die Form der API (camelCase,
 * `items` als Liste). `today` ist der Kalendertag der Umwandlung (`YYYY-MM-DD`).
 */
export function quoteToJobData(quote, { today, newId }) {
  if (!DATE_ONLY.test(String(today))) throw new Error('Ungültiges Datum für den Auftrag.');
  if (typeof newId !== 'function') throw new Error('Für neue Positionen fehlt die ID-Vergabe.');
  const notes = text(quote.notes);
  return {
    customerId: quote.customerId,
    customerName: quote.customerName,
    title: jobTitleFromQuote(quote),
    description: `Leistungen gemäß Angebot ${quote.quoteNumber}`,
    date: today,
    hoursWorked: 0,
    hourlyRate: 0,
    materials: materialsFromQuoteItems(quote.items, newId),
    status: 'draft',
    notes: notes || null,
    sourceQuoteId: quote.id,
    sourceQuoteNumber: quote.quoteNumber,
  };
}
