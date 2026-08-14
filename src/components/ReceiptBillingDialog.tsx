import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { FilePlus2 } from 'lucide-react';
import type { Customer, Invoice, Receipt } from '../types';
import { apiService } from '../services/api';
import { useCompany } from '../context/CompanyContext';
import { formatCurrency } from '../utils/formatters';
import { DialogShell } from './DialogShell';
import { LocalizedNumberInput } from './LocalizedNumberInput';

interface ReceiptBillingDialogProps {
  receipt: Receipt | null;
  customers: Customer[];
  onClose: () => void;
  onCreated: (invoice: Invoice, receipt: Receipt) => void;
}

export function ReceiptBillingDialog({ receipt, customers, onClose, onCreated }: ReceiptBillingDialogProps) {
  const { company } = useCompany();
  const locale = company?.locale || 'de-DE';
  const [customerId, setCustomerId] = useState('');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState<number | ''>(1);
  const [unitPrice, setUnitPrice] = useState<number | ''>('');
  const [taxRate, setTaxRate] = useState<number | ''>(19);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!receipt) return;
    const data = receipt.extractedData || {};
    const effectiveTaxRate = company?.isSmallBusiness ? 0 : Number.isFinite(Number(data.taxRate)) ? Number(data.taxRate) : 19;
    const netAmount = Number(data.netAmount);
    const grossAmount = Number(data.grossAmount);
    const suggestedNet = Number.isFinite(netAmount)
      ? netAmount
      : Number.isFinite(grossAmount)
        ? grossAmount / (1 + effectiveTaxRate / 100)
        : 0;
    setCustomerId('');
    setDescription([
      data.vendorName ? `Weiterberechnung ${data.vendorName}` : 'Weiterberechnung Auslage',
      data.documentNumber ? `Beleg ${data.documentNumber}` : '',
    ].filter(Boolean).join(' · '));
    setQuantity(1);
    setUnitPrice(Number(suggestedNet.toFixed(2)));
    setTaxRate(effectiveTaxRate);
    setNotes('');
    setError('');
    setSaving(false);
  }, [company?.isSmallBusiness, receipt]);

  const total = useMemo(() => {
    const net = Number(quantity || 0) * Number(unitPrice || 0);
    return net * (1 + Number(taxRate || 0) / 100);
  }, [quantity, taxRate, unitPrice]);

  if (!receipt) return null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!customerId) {
      setError('Bitte einen Kunden auswählen.');
      return;
    }
    if (!description.trim() || Number(quantity) <= 0 || Number(unitPrice) < 0 || Number(taxRate) < 0 || Number(taxRate) > 100) {
      setError('Bitte Beschreibung, Menge, Nettopreis und MwSt.-Satz prüfen.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await apiService.createInvoiceFromReceipt(receipt.id, {
        customerId,
        description: description.trim(),
        quantity: Number(quantity),
        unitPrice: Number(unitPrice),
        taxRate: Number(taxRate),
        notes: notes.trim() || undefined,
      });
      onCreated(result.invoice, result.receipt);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Der Rechnungsentwurf konnte nicht erstellt werden.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogShell
      titleId="receipt-billing-dialog-title"
      icon={FilePlus2}
      title="Beleg weiterberechnen"
      description="Aus dem Beleg wird ein bearbeitbarer Rechnungsentwurf erstellt."
      onClose={saving ? () => {} : onClose}
      onSubmit={submit}
      size="md"
      zIndexClassName="z-[1150]"
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={saving} className="min-h-12 rounded-lg border border-gray-300 bg-white px-6 py-2 text-base font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50">Abbrechen</button>
          <button type="submit" disabled={saving || customers.length === 0} className="btn-primary min-h-12 rounded-lg px-6 py-2 text-base font-semibold text-white transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-50">{saving ? 'Wird erstellt …' : 'Entwurf erstellen'}</button>
        </>
      )}
    >
      <div className="space-y-4 pb-2">
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm">
          <p className="font-medium text-gray-900">{receipt.name}</p>
          <p className="mt-1 text-gray-500">Der Originalbeleg wird dem Entwurf als Anlage beigefügt und kann dort vor dem Versand entfernt werden.</p>
        </div>

        <label className="block text-sm font-medium text-gray-700">
          Kunde
          <select required autoFocus value={customerId} onChange={event => setCustomerId(event.target.value)} className="form-input mt-1 w-full">
            <option value="">Bitte auswählen</option>
            {customers.filter(customer => customer.isActive !== false).map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium text-gray-700">
          Rechnungsposition
          <input required maxLength={500} value={description} onChange={event => setDescription(event.target.value)} className="form-input mt-1 w-full" />
        </label>
        <div className="grid grid-cols-3 gap-3">
          <label className="text-sm font-medium text-gray-700">Menge<LocalizedNumberInput required min="0.01" step="0.01" value={quantity} locale={locale} numberFormat={company?.numberFormat} onValueChange={setQuantity} className="form-input mt-1 w-full" /></label>
          <label className="text-sm font-medium text-gray-700">Netto<LocalizedNumberInput required min="0" step="0.01" value={unitPrice} locale={locale} numberFormat={company?.numberFormat} onValueChange={setUnitPrice} className="form-input mt-1 w-full" /></label>
          <label className="text-sm font-medium text-gray-700">MwSt. %<LocalizedNumberInput required min="0" max="100" step="0.01" value={taxRate} locale={locale} numberFormat={company?.numberFormat} onValueChange={setTaxRate} className="form-input mt-1 w-full" /></label>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-primary-light-custom px-4 py-3 text-sm"><span className="text-gray-600">Voraussichtlicher Bruttobetrag</span><strong className="text-primary-custom">{formatCurrency(total, locale, company?.numberFormat, company?.currency)}</strong></div>
        <label className="block text-sm font-medium text-gray-700">Notiz<textarea value={notes} onChange={event => setNotes(event.target.value)} maxLength={2000} rows={2} className="form-input mt-1 w-full" placeholder="Optional für den Rechnungsentwurf" /></label>
        {customers.length === 0 && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Vor der Weiterberechnung muss ein Kunde angelegt sein.</p>}
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      </div>
    </DialogShell>
  );
}
