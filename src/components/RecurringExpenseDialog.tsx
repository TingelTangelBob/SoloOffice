import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { CalendarClock, Plus, X } from 'lucide-react';
import type { LevyKind, RecurringExpense, RecurringExpensePayload } from '../types/finance';
import type { EuerEntryCategory } from '../types';
import { DialogShell } from './DialogShell';
import { ToggleSwitch } from './ToggleSwitch';
import { parseLocalizedNumber } from '../utils/formatters';
import { useCompany } from '../context/CompanyContext';

const businessCategories: Array<[EuerEntryCategory, string]> = [
  ['rent', 'Miete und Raumkosten'], ['insurance', 'Versicherungen'], ['software', 'Software und Lizenzen'],
  ['telecommunications', 'Telefon und Internet'], ['memberships', 'Kammern und Verbände'], ['office', 'Bürobedarf'],
  ['bank_fees', 'Bankgebühren'], ['materials', 'Material'], ['vehicle', 'Fahrzeug'], ['travel', 'Reisekosten'],
  ['marketing', 'Marketing'], ['professional_services', 'Beratungsleistungen'], ['other_expense', 'Sonstige Betriebsausgaben'],
];
const ustLegacyLabel = 'Umsatzsteuer (bitte unter Steuern → Umsatzsteuer erfassen)';
const levyKinds: Array<[LevyKind, string]> = [['kv', 'Krankenversicherung'], ['pv', 'Pflegeversicherung'], ['rv', 'Rentenversicherung'], ['av', 'Arbeitslosenversicherung'], ['ksk', 'Künstlersozialkasse'], ['est_vz', 'Einkommensteuer-Vorauszahlung'], ['gewst_vz', 'Gewerbesteuer-Vorauszahlung'], ['ust', ustLegacyLabel]];
const field = 'form-input form-input-compact mt-1 w-full text-sm';
const label = 'block min-w-0 text-sm font-medium text-gray-700';
const today = () => new Date().toISOString().slice(0, 10);
const dateOnlyLabel = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value;
};

interface Props {
  expense?: RecurringExpense;
  initialValues?: Partial<RecurringExpense>;
  scope: 'business' | 'private_levy';
  onClose: () => void;
  onSave: (payload: RecurringExpensePayload, id?: string) => Promise<void>;
}

export function RecurringExpenseDialog({ expense, initialValues, scope, onClose, onSave }: Props) {
  const { company } = useCompany();
  const initial = expense || initialValues;
  const [name, setName] = useState(initial?.name || '');
  const [counterparty, setCounterparty] = useState(initial?.counterparty || '');
  const [category, setCategory] = useState(initial?.category || (scope === 'business' ? 'other_expense' : 'est_vz'));
  const [amount, setAmount] = useState(String(initial?.amountGross ?? ''));
  const [taxRate, setTaxRate] = useState(initial?.taxRate == null ? '' : String(initial.taxRate));
  const [interval, setInterval] = useState<RecurringExpense['interval']>(initial?.interval || 'monthly');
  const [intervalCount, setIntervalCount] = useState(String(initial?.intervalCount || 1));
  const [intervalUnit, setIntervalUnit] = useState<'months' | 'weeks'>(initial?.intervalUnit || 'months');
  const [startDate, setStartDate] = useState(initial?.startDate || today());
  const [endDate, setEndDate] = useState(initial?.endDate || '');
  const [noticeDays, setNoticeDays] = useState(String(initial?.noticePeriodDays ?? 0));
  const [cancelledOn, setCancelledOn] = useState(initial?.cancelledOn || '');
  const [automaticBooking, setAutomaticBooking] = useState(initial?.automaticBooking || false);
  const [notes, setNotes] = useState(initial?.notes || '');
  const [prices, setPrices] = useState(initial?.priceChanges || []);
  const [pauses, setPauses] = useState(initial?.pauses || []);
  const [newPriceDate, setNewPriceDate] = useState(today());
  const [newPrice, setNewPrice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (interval !== 'custom') return;
    if (intervalCount.trim() === '') setIntervalCount('1');
  }, [interval, intervalCount]);

  const addPrice = () => {
    const value = parseLocalizedNumber(newPrice, company?.locale, company?.numberFormat);
    if (!newPriceDate || newPriceDate < today() || !Number.isFinite(value) || value < 0) return setError('Bitte ein heutiges oder künftiges Gültigkeitsdatum und einen gültigen Betrag eintragen.');
    if (prices.some(price => price.validFrom === newPriceDate)) return setError('Für dieses Datum gibt es bereits eine Preisänderung.');
    setPrices(current => [...current, { validFrom: newPriceDate, amountGross: value }].sort((a, b) => a.validFrom.localeCompare(b.validFrom)));
    setNewPrice(''); setError('');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const amountValue = parseLocalizedNumber(amount, company?.locale, company?.numberFormat);
    const count = Number(intervalCount);
    const pendingPrice = newPrice.trim() ? parseLocalizedNumber(newPrice, company?.locale, company?.numberFormat) : null;
    if (newPrice.trim() && (!newPriceDate || newPriceDate < today() || !Number.isFinite(pendingPrice) || (pendingPrice as number) < 0)) {
      setError('Die noch nicht hinzugefügte Preisänderung ist unvollständig oder ungültig. Bitte ergänzen oder löschen Sie den Betrag.'); return;
    }
    const savedPrices = pendingPrice === null ? prices : [...prices, { validFrom: newPriceDate, amountGross: pendingPrice }].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
    if (pendingPrice !== null && prices.some(price => price.validFrom === newPriceDate)) {
      setError('Für dieses Datum gibt es bereits eine Preisänderung. Bitte wählen Sie ein anderes Datum.'); return;
    }
    if (!name.trim() || !startDate || !Number.isFinite(amountValue) || amountValue < 0
      || !Number.isInteger(count) || count < 1 || (endDate && endDate < startDate)
      || !Number.isInteger(Number(noticeDays)) || Number(noticeDays) < 0) {
      setError('Bitte Name, Betrag, Intervall und Datumsangaben prüfen.'); return;
    }
    const isLevy = scope === 'private_levy';
    const payload: RecurringExpensePayload = {
      name: name.trim(), counterparty: counterparty.trim(), category, amountGross: amountValue,
      taxRate: isLevy || taxRate === '' ? null : parseLocalizedNumber(taxRate, company?.locale, company?.numberFormat),
      interval, intervalCount: interval === 'monthly' ? 1 : interval === 'quarterly' ? 3 : interval === 'half_yearly' ? 6 : interval === 'yearly' ? 12 : count,
      intervalUnit: interval === 'custom' ? intervalUnit : 'months', startDate, endDate: endDate || null,
      noticePeriodDays: Number(noticeDays), cancelledOn: cancelledOn || null,
      status: expense?.status === 'ended' ? 'ended' : expense?.status || 'active',
      pauses, priceChanges: savedPrices, automaticBooking: isLevy ? false : automaticBooking,
      scope, levyKind: isLevy ? category as LevyKind : null, linkedReceiptId: expense?.linkedReceiptId ?? initialValues?.linkedReceiptId ?? null, notes,
    };
    setBusy(true); setError('');
    try { await onSave(payload, expense?.id); onClose(); }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Die Fixkosten konnten nicht gespeichert werden.'); }
    finally { setBusy(false); }
  };

  return <DialogShell titleId="recurring-expense-dialog" icon={CalendarClock} title={expense ? 'Fixkosten bearbeiten' : scope === 'business' ? 'Fixkosten erfassen' : 'Private Abgabe erfassen'} description="Änderungen an Preisen gelten ab dem angegebenen Datum. Bereits gebuchte EÜR-Werte bleiben unverändert." onClose={onClose} onSubmit={submit} size="xl" footer={<><button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-gray-300 bg-white px-5 text-sm font-medium text-gray-700">Abbrechen</button><button type="submit" disabled={busy} className="btn-primary min-h-11 rounded-lg px-5 text-sm font-semibold text-white">{busy ? 'Wird gespeichert …' : 'Speichern'}</button></>}>
    <div className="space-y-5">
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={label}>Bezeichnung<input className={field} value={name} onChange={e => setName(e.target.value)} required maxLength={160} /></label>
        <label className={label}>{scope === 'business' ? 'Anbieter' : 'Empfänger'}<input className={field} value={counterparty} onChange={e => setCounterparty(e.target.value)} maxLength={160} /></label>
        <label className={label}>{scope === 'business' ? 'EÜR-Kategorie' : 'Abgabenart'}<select className={field} value={category} onChange={e => setCategory(e.target.value)}>{(scope === 'business' ? businessCategories : levyKinds).filter(([key]) => key !== 'ust' || category === 'ust').map(([key, text]) => <option key={key} value={key} disabled={key === 'ust'}>{text}</option>)}</select></label>
        <label className={label}>Basisbetrag je Fälligkeit<input className={field} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} required /><span className="mt-1 block text-xs font-normal text-gray-500">Gilt ab der ersten Fälligkeit. Künftige Beträge legen Sie im Abschnitt „Preis ändern ab“ fest.</span></label>
        {scope === 'business' && <label className={label}>Umsatzsteuersatz in %<input className={field} inputMode="decimal" value={taxRate} onChange={e => setTaxRate(e.target.value)} placeholder="Nicht angegeben" /></label>}
        <label className={label}>Intervall<select className={field} value={interval} onChange={e => setInterval(e.target.value as RecurringExpense['interval'])}><option value="monthly">Monatlich</option><option value="quarterly">Vierteljährlich</option><option value="half_yearly">Halbjährlich</option><option value="yearly">Jährlich</option><option value="custom">Individuell</option></select></label>
        {interval === 'custom' && <div className="grid grid-cols-2 gap-3"><label className={label}>Alle<input className={field} type="number" min="1" max="120" value={intervalCount} onChange={e => setIntervalCount(e.target.value)} /></label><label className={label}>Einheit<select className={field} value={intervalUnit} onChange={e => setIntervalUnit(e.target.value as 'months'|'weeks')}><option value="months">Monate</option><option value="weeks">Wochen</option></select></label></div>}
        <label className={label}>Erste Fälligkeit<input className={field} type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></label>
        <label className={label}>Vertrag endet am<input className={field} type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /><span className="mt-1 block text-xs font-normal text-gray-500">Ab diesem Tag gibt es keine Fälligkeiten.</span></label>
        <label className={label}>Kündigungsfrist in Tagen<input className={field} type="number" min="0" value={noticeDays} onChange={e => setNoticeDays(e.target.value)} /></label>
        <label className={label}>Kündigung eingereicht am<input className={field} type="date" value={cancelledOn} onChange={e => setCancelledOn(e.target.value)} /></label>
      </div>
      <section className="space-y-3 rounded-lg border border-gray-200 p-3"><div><h3 className="text-sm font-semibold text-gray-900">Preis ändern ab …</h3><p className="mt-1 text-xs text-gray-600">Der neue Betrag gilt für Fälligkeiten ab diesem Datum. Bereits gebuchte Beträge bleiben unverändert.</p></div><div className="space-y-2">{prices.length ? prices.map((price, index) => <div key={`${price.validFrom}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm"><span>{price.validFrom < today() ? 'Bisheriger Preis' : 'Gültig ab'} {dateOnlyLabel(price.validFrom)}: {price.amountGross.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</span>{price.validFrom >= today() && <button type="button" onClick={() => setPrices(current => current.filter((_, itemIndex) => itemIndex !== index))} aria-label="Preisänderung entfernen" className="rounded border border-gray-300 bg-white p-1 text-gray-600 hover:bg-gray-50"><X className="h-4 w-4" /></button>}</div>) : <p className="text-sm text-gray-500">Noch keine Preisänderungen erfasst.</p>}</div><div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><label className={label}>Gültig ab<input type="date" min={today()} className={field} value={newPriceDate} onChange={e => setNewPriceDate(e.target.value)} /></label><label className={label}>Neuer Betrag<input className={field} inputMode="decimal" value={newPrice} onChange={e => setNewPrice(e.target.value)} /></label><button type="button" onClick={addPrice} className="mt-5 min-h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"><Plus className="mr-1 inline h-4 w-4" />Hinzufügen</button></div></section>
      {scope === 'business' && <div className="rounded-lg border border-gray-200 p-3"><ToggleSwitch checked={automaticBooking} onChange={() => setAutomaticBooking(value => !value)} label="Fällige Ausgaben automatisch buchen" /><p className="mt-2 text-xs text-gray-500">Standard ist aus. Automatische Buchungen erfolgen nur für Fälligkeiten bis heute und mit ausdrücklicher Generierung.</p></div>}
      <label className={`${label} block`}>Notizen<textarea className={`${field} min-h-20`} value={notes} onChange={e => setNotes(e.target.value)} maxLength={2000} /></label>
      <section className="space-y-2 rounded-lg border border-gray-200 p-3"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-gray-900">Pausen</h3><button type="button" onClick={() => setPauses(current => [...current, { from: today(), until: null }])} className="min-h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"><Plus className="mr-1 inline h-4 w-4" />Pause hinzufügen</button></div>{pauses.map((pause, index) => <div key={`${pause.from}-${index}`} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]"><label className={label}>Von<input className={field} type="date" value={pause.from} onChange={e => setPauses(current => current.map((item, i) => i === index ? { ...item, from: e.target.value } : item))} /></label><label className={label}>Bis (leer = unbegrenzt)<input className={field} type="date" value={pause.until || ''} onChange={e => setPauses(current => current.map((item, i) => i === index ? { ...item, until: e.target.value || null } : item))} /></label><button type="button" onClick={() => setPauses(current => current.filter((_, i) => i !== index))} aria-label="Pause entfernen" className="min-h-10 rounded-lg border border-gray-300 px-3 text-gray-600"><X className="h-4 w-4" /></button></div>)}</section>
    </div>
  </DialogShell>;
}
