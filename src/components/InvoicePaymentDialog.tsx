import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Banknote } from 'lucide-react';
import type { Invoice } from '../types';
import { apiService } from '../services/api';
import { useCompany } from '../context/CompanyContext';
import { formatCurrency } from '../utils/formatters';
import { DialogShell } from './DialogShell';
import { LocalizedDateInput } from './LocalizedDateInput';
import { LocalizedNumberInput } from './LocalizedNumberInput';

interface InvoicePaymentDialogProps {
  invoice: Invoice | null;
  onClose: () => void;
  onSaved: (invoice: Invoice) => void;
}

function today(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function paymentAmounts(invoice: Invoice) {
  const paid = Math.min(invoice.total, Math.max(0, Number(invoice.paidAmount ?? (invoice.status === 'paid' ? invoice.total : 0))));
  const outstanding = Math.max(0, Number(invoice.outstandingAmount ?? invoice.total - paid));
  return { paid, outstanding };
}

export function InvoicePaymentDialog({ invoice, onClose, onSaved }: InvoicePaymentDialogProps) {
  const { company } = useCompany();
  const locale = company?.locale || 'de-DE';
  const amounts = useMemo(() => invoice ? paymentAmounts(invoice) : { paid: 0, outstanding: 0 }, [invoice]);
  const [amount, setAmount] = useState<number | ''>('');
  const [entryDate, setEntryDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!invoice) return;
    setAmount(Number(amounts.outstanding.toFixed(2)));
    setEntryDate(today());
    setNotes('');
    setError('');
    setSaving(false);
  }, [amounts.outstanding, invoice]);

  if (!invoice) return null;

  const money = (value: number) => formatCurrency(value, locale, company?.numberFormat, company?.currency);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError('Bitte einen Zahlungsbetrag größer als 0 eingeben.');
      return;
    }
    if (numericAmount > amounts.outstanding + 0.005) {
      setError(`Der Betrag darf den offenen Rechnungsbetrag von ${money(amounts.outstanding)} nicht überschreiten.`);
      return;
    }

    setSaving(true);
    setError('');
    try {
      const result = await apiService.recordInvoicePayment(invoice.id, {
        amount: numericAmount,
        entryDate,
        notes: notes.trim() || undefined,
      });
      onSaved(result.invoice);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Zahlungseingang konnte nicht erfasst werden.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogShell
      titleId="invoice-payment-dialog-title"
      icon={Banknote}
      title="Zahlungseingang erfassen"
      description={`Rechnung ${invoice.invoiceNumber} · ${invoice.customerName}`}
      onClose={saving ? () => {} : onClose}
      onSubmit={submit}
      size="md"
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={saving} className="min-h-12 rounded-lg border border-gray-300 bg-white px-6 py-2 text-base font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50">Abbrechen</button>
          <button type="submit" disabled={saving || amounts.outstanding < 0.005} className="btn-primary min-h-12 rounded-lg px-6 py-2 text-base font-semibold text-white transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? 'Wird gebucht …' : 'Zahlung buchen'}
          </button>
        </>
      )}
    >
      <div className="space-y-5 pb-2">
        <dl className="grid grid-cols-3 gap-2 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm">
          <div><dt className="text-gray-500">Rechnung</dt><dd className="mt-1 font-semibold text-gray-900">{money(invoice.total)}</dd></div>
          <div><dt className="text-gray-500">Bezahlt</dt><dd className="mt-1 font-semibold text-gray-900">{money(amounts.paid)}</dd></div>
          <div><dt className="text-gray-500">Offen</dt><dd className="mt-1 font-semibold text-primary-custom">{money(amounts.outstanding)}</dd></div>
        </dl>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-gray-700">
            Zahlungsbetrag
            <LocalizedNumberInput
              required
              autoFocus
              min="0.01"
              max={amounts.outstanding}
              step="0.01"
              value={amount}
              locale={locale}
              numberFormat={company?.numberFormat}
              onValueChange={setAmount}
              className="form-input mt-1 w-full"
            />
          </label>
          <label className="text-sm font-medium text-gray-700">
            Zahlungsdatum
            <LocalizedDateInput
              required
              value={entryDate}
              onChange={setEntryDate}
              locale={locale}
              dateFormat={company?.dateFormat}
              className="form-input mt-1 w-full"
            />
          </label>
        </div>

        <label className="block text-sm font-medium text-gray-700">
          Notiz
          <textarea
            value={notes}
            onChange={event => setNotes(event.target.value)}
            maxLength={500}
            rows={3}
            className="form-input mt-1 w-full"
            placeholder="Optional, z. B. Verwendungszweck oder Konto"
          />
        </label>

        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        <p className="text-sm leading-6 text-gray-500">Die Zahlung wird als Einnahme in der EÜR gebucht. Bei einer Teilzahlung bleibt der Restbetrag offen.</p>
      </div>
    </DialogShell>
  );
}
