import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { CalendarClock } from 'lucide-react';
import type { VatPayment, VatPaymentPayload } from '../types/vat';
import { vatPaymentKindLabel } from '../utils/vatDisplay';
import { DialogShell } from './DialogShell';

interface VatPaymentDialogProps {
  payment?: VatPayment | null;
  taxYear: number;
  periodOptions: Array<{ key: string; label: string }>;
  defaultPeriodKey?: string | null;
  defaultAmount?: number;
  defaultDueDate?: string | null;
  onClose: () => void;
  onSave: (payload: VatPaymentPayload, id?: string) => Promise<void>;
}

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const inputClass = 'form-input form-input-compact mt-1 w-full text-sm';
const kinds: VatPayment['kind'][] = ['advance', 'special_prepayment', 'annual_payment', 'refund'];

export function VatPaymentDialog({ payment, taxYear, periodOptions, defaultPeriodKey, defaultAmount, defaultDueDate, onClose, onSave }: VatPaymentDialogProps) {
  const titleId = useId();
  const [kind, setKind] = useState<VatPayment['kind']>(payment?.kind ?? 'advance');
  const [periodKey, setPeriodKey] = useState(payment?.periodKey ?? defaultPeriodKey ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Vorauszahlungen gehören zu einem Zeitraum; Erstattungen können auch das ganze Jahr betreffen.
  const periodRequired = kind === 'advance';
  const periodSelectable = kind === 'advance' || kind === 'refund';
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = Number(String(form.get('amount') || ''));
    if (!Number.isFinite(amount) || amount <= 0) { setError('Bitte einen Betrag größer als 0 eintragen.'); return; }
    if (periodRequired && !periodKey) { setError('Bitte einen Zeitraum auswählen.'); return; }
    const payload: VatPaymentPayload = {
      kind,
      taxYear,
      periodKey: periodSelectable ? periodKey || null : null,
      dueDate: String(form.get('dueDate') || '') || null,
      paidOn: String(form.get('paidOn') || '') || null,
      amount: Math.round(amount * 100) / 100,
      notes: String(form.get('notes') || '').trim() || null,
    };
    setSaving(true); setError('');
    try { await onSave(payload, payment?.id); }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Zahlung konnte nicht gespeichert werden.'); }
    finally { setSaving(false); }
  };

  return (
    <DialogShell
      title={payment ? 'USt-Zahlung bearbeiten' : 'USt-Zahlung erfassen'}
      titleId={titleId}
      icon={CalendarClock}
      onClose={onClose}
      size="md"
      footer={<><button type="button" onClick={onClose} disabled={saving} className="btn-secondary rounded-lg px-4 py-2">Abbrechen</button><button type="submit" form="vat-payment-form" disabled={saving} className="btn-primary rounded-lg px-4 py-2">{saving ? 'Wird gespeichert …' : 'Speichern'}</button></>}
    >
      <form id="vat-payment-form" onSubmit={handleSubmit} className="space-y-4">
        {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <label className="block text-sm font-medium text-gray-700">Art
          <select className={inputClass} value={kind} onChange={event => setKind(event.target.value as VatPayment['kind'])}>
            {kinds.map(option => <option key={option} value={option}>{vatPaymentKindLabel(option)}</option>)}
          </select>
        </label>
        {periodSelectable && <label className="block text-sm font-medium text-gray-700">Zeitraum
          <select className={inputClass} value={periodKey} onChange={event => setPeriodKey(event.target.value)} required={periodRequired}>
            <option value="">{periodRequired ? 'Zeitraum auswählen' : `Ganzes Jahr ${taxYear}`}</option>
            {periodOptions.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
        </label>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-gray-700">Betrag
            <input className={inputClass} name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" defaultValue={payment?.amount ?? defaultAmount ?? ''} required />
          </label>
          <label className="block text-sm font-medium text-gray-700">Fälligkeit
            <input className={inputClass} name="dueDate" type="date" defaultValue={payment?.dueDate ?? defaultDueDate ?? ''} />
          </label>
          <label className="block text-sm font-medium text-gray-700 sm:col-span-2">Bezahlt am
            <input className={inputClass} name="paidOn" type="date" defaultValue={payment?.paidOn ?? ''} max={today()} />
          </label>
        </div>
        <label className="block text-sm font-medium text-gray-700">Notiz
          <textarea className={`${inputClass} min-h-20`} name="notes" defaultValue={payment?.notes ?? ''} rows={2} maxLength={500} />
        </label>
        <p className="text-xs leading-5 text-gray-500">Bezahlte Zahlungen werden als Betriebsausgabe bzw. Erstattungen als Betriebseinnahme in die EÜR übernommen.</p>
      </form>
    </DialogShell>
  );
}
