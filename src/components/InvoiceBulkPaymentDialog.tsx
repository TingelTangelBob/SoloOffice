import { useMemo, useState, type FormEvent } from 'react';
import { Banknote } from 'lucide-react';
import type { Invoice } from '../types';
import { apiService } from '../services/api';
import { useCompany } from '../context/CompanyContext';
import { formatCurrency } from '../utils/formatters';
import { toDateInputValue } from '../utils/invoicePeriod';
import { DialogShell } from './DialogShell';
import { LocalizedDateInput } from './LocalizedDateInput';

interface InvoiceBulkPaymentDialogProps {
  invoices: Invoice[];
  onClose: () => void;
  onSaved: (processed: number, totalAmount: number) => void;
}

type PaymentDateMode = 'common' | 'createdAt';

function today(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function outstandingAmount(invoice: Invoice): number {
  return Math.max(0, Number(invoice.outstandingAmount ?? invoice.total - Number(invoice.paidAmount || 0)));
}

function invoiceCreationDate(invoice: Invoice): string {
  // createdAt is the actual invoice creation date. Older records without it
  // use the invoice date as a safe fallback.
  return toDateInputValue(invoice.createdAt) || toDateInputValue(invoice.issueDate) || today();
}

export function InvoiceBulkPaymentDialog({ invoices, onClose, onSaved }: InvoiceBulkPaymentDialogProps) {
  const { company } = useCompany();
  const locale = company?.locale || 'de-DE';
  const [dateMode, setDateMode] = useState<PaymentDateMode>('common');
  const [commonDate, setCommonDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const payableInvoices = useMemo(
    () => invoices.filter(invoice => invoice.status !== 'draft' && invoice.status !== 'paid' && outstandingAmount(invoice) >= 0.005),
    [invoices],
  );
  const skippedCount = invoices.length - payableInvoices.length;
  const totalOutstanding = payableInvoices.reduce((sum, invoice) => sum + outstandingAmount(invoice), 0);
  const money = (value: number) => formatCurrency(value, locale, company?.numberFormat, company?.currency);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (payableInvoices.length === 0) {
      setError('Es gibt keine ausgewählte Rechnung mit offenem Betrag. Entwürfe und bereits bezahlte Rechnungen werden übersprungen.');
      return;
    }
    if (dateMode === 'common' && !commonDate) {
      setError('Bitte ein Zahlungsdatum auswählen.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const result = await apiService.recordInvoicePayments(payableInvoices.map(invoice => ({
        invoiceId: invoice.id,
        amount: Number(outstandingAmount(invoice).toFixed(2)),
        entryDate: dateMode === 'createdAt' ? invoiceCreationDate(invoice) : commonDate,
        notes: notes.trim() || undefined,
      })));
      onSaved(result.processed, result.totalAmount);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Zahlungseingänge konnten nicht erfasst werden.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogShell
      titleId="invoice-bulk-payment-dialog-title"
      icon={Banknote}
      title="Zahlungseingänge erfassen"
      description={`${payableInvoices.length} Rechnungen · vollständige offene Beträge buchen`}
      onClose={saving ? () => {} : onClose}
      onSubmit={submit}
      size="lg"
      fitContent
      footer={(
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={saving} className="min-h-12 rounded-lg border border-gray-300 bg-white px-6 py-2 text-base font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50">
            Abbrechen
          </button>
          <button type="submit" disabled={saving || payableInvoices.length === 0} className="btn-primary min-h-12 rounded-lg px-6 py-2 text-base font-semibold text-white transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? 'Wird gebucht …' : `${payableInvoices.length} Zahlungen buchen`}
          </button>
        </div>
      )}
    >
      <div className="min-w-0 space-y-5 pb-2">
        <dl className="grid min-w-0 grid-cols-2 gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 sm:grid-cols-3">
          <div><dt className="text-sm text-gray-500">Rechnungen</dt><dd className="mt-1 text-lg font-semibold text-gray-900">{payableInvoices.length}</dd></div>
          <div><dt className="text-sm text-gray-500">Gesamtbetrag</dt><dd className="mt-1 text-lg font-semibold text-primary-custom">{money(totalOutstanding)}</dd></div>
          <div className="col-span-2 sm:col-span-1"><dt className="text-sm text-gray-500">Buchung</dt><dd className="mt-1 text-sm font-medium text-gray-900">je Rechnung vollständig</dd></div>
        </dl>

        {skippedCount > 0 && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
            {skippedCount} Auswahl(en) werden übersprungen, weil sie noch ein Entwurf oder bereits vollständig bezahlt sind.
          </p>
        )}

        <fieldset className="space-y-3">
          <legend className="text-base font-semibold text-gray-900">Zahlungsdatum</legend>
          <label className="flex min-w-0 items-start gap-3 rounded-lg border border-gray-200 p-3">
            <input type="radio" name="bulk-payment-date" checked={dateMode === 'common'} onChange={() => setDateMode('common')} className="mt-1" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-gray-900">Ein Datum für alle Zahlungen</span>
              <span className="mt-2 block max-w-xs">
                <LocalizedDateInput value={commonDate} onChange={setCommonDate} locale={locale} dateFormat={company?.dateFormat} className="w-full" aria-label="Gemeinsames Zahlungsdatum" />
              </span>
            </span>
          </label>
          <label className="flex min-w-0 items-start gap-3 rounded-lg border border-gray-200 p-3">
            <input type="radio" name="bulk-payment-date" checked={dateMode === 'createdAt'} onChange={() => setDateMode('createdAt')} className="mt-1" />
            <span className="min-w-0">
              <span className="block font-medium text-gray-900">Erstelldatum der jeweiligen Rechnung verwenden</span>
              <span className="mt-1 block text-sm leading-5 text-gray-500">Für ältere Rechnungen ohne Erstelldatum wird das Rechnungsdatum verwendet.</span>
            </span>
          </label>
        </fieldset>

        <label className="block text-sm font-medium text-gray-700">
          Notiz für alle Zahlungseingänge <span className="font-normal text-gray-500">(optional)</span>
          <textarea value={notes} onChange={event => setNotes(event.target.value)} maxLength={500} rows={3} className="form-input mt-1 w-full" placeholder="z. B. Zahlung aus Import vom 21.09.2026" />
        </label>

        <p className="text-sm leading-6 text-gray-500">Die Buchungen werden als Einnahmen in der EÜR erfasst. Das Kurs- oder Leistungsdatum der Rechnung bleibt unverändert.</p>
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      </div>
    </DialogShell>
  );
}
