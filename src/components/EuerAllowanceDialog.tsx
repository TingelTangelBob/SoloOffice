import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Calculator } from 'lucide-react';
import type { EuerEntry, EuerEntryPayload, NumberFormat } from '../types';
import { formatCurrency } from '../utils/formatters';
import { localDateKey } from '../utils/workLocationDays';
import { calculateAllowanceWorkdays, getAllowanceYearRange, parseAllowanceDayBasis, readLegacyAllowanceDayCount, serializeAllowanceDayBasis, type AllowanceDayBasis } from '../utils/euerAllowanceDays';
import { useFeedback } from '../context/FeedbackContext';
import { LocalizedNumberInput } from './LocalizedNumberInput';
import { DialogShell } from './DialogShell';

interface EuerAllowanceDialogProps {
  year: number;
  locale: string;
  timeZone?: string;
  numberFormat?: NumberFormat;
  canWrite: boolean;
  entriesReady: boolean;
  existingHomeOfficeEntries: EuerEntry[];
  onClose: () => void;
  onSave: (payload: EuerEntryPayload, existingEntryId?: string) => Promise<void>;
  onRemoveExistingHomeOfficeEntry: (entryId: string) => Promise<void>;
}

type AllowanceMode = 'home_office' | 'manual';
const weekdays = [
  { value: 1, label: 'Mo' }, { value: 2, label: 'Di' }, { value: 3, label: 'Mi' },
  { value: 4, label: 'Do' }, { value: 5, label: 'Fr' }, { value: 6, label: 'Sa' }, { value: 0, label: 'So' },
];

function readSavedParameters(notes: string | null | undefined, year: number) {
  const line = notes?.split('\n').find(item => item.startsWith(`Berechnungswerte für ${year} (vom Nutzer erfasst): `));
  const match = line?.match(/^Berechnungswerte für (\d{4}) \(vom Nutzer erfasst\): ([\d.]+) EUR je Tag; Tagesgrenze=(keine|\d+); Betragsgrenze=(keine|[\d.]+) EUR; Quelle=(.*)$/);
  if (!match || Number(match[1]) !== year) return null;
  const rate = Number(match[2]);
  const maxDays: number | '' = match[3] === 'keine' ? '' : Number(match[3]);
  const maxAmount: number | '' = match[4] === 'keine' ? '' : Number(match[4]);
  if (!Number.isFinite(rate) || rate <= 0 || !match[5]) return null;
  if (maxAmount !== '' && !Number.isFinite(maxAmount)) return null;
  return { rate, maxDays, maxAmount, source: match[5] };
}

export function EuerAllowanceDialog({
  year, locale, timeZone, numberFormat, canWrite, entriesReady, existingHomeOfficeEntries,
  onClose, onSave, onRemoveExistingHomeOfficeEntry,
}: EuerAllowanceDialogProps) {
  const { confirm } = useFeedback();
  const today = localDateKey(new Date(), timeZone);
  const range = getAllowanceYearRange(year, today);
  const [mode, setMode] = useState<AllowanceMode>('home_office');
  const [dayMethod, setDayMethod] = useState<'annual' | 'weekly'>('annual');
  const [annualDays, setAnnualDays] = useState<number | ''>('');
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.maxDays ? range.to : range.from);
  const [selectedWeekdays, setSelectedWeekdays] = useState([1, 2, 3, 4, 5]);
  const [vacationDays, setVacationDays] = useState<number | ''>(0);
  const [otherDays, setOtherDays] = useState<number | ''>(0);
  const [dailyRate, setDailyRate] = useState<number | ''>('');
  const [maxDays, setMaxDays] = useState<number | ''>('');
  const [maxAmount, setMaxAmount] = useState<number | ''>('');
  const [parameterSource, setParameterSource] = useState('');
  const [manualDescription, setManualDescription] = useState('');
  const [manualAmount, setManualAmount] = useState<number | ''>('');
  const [manualBasis, setManualBasis] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const edited = useRef(false);
  const hydrated = useRef<string | null>(null);
  const existingEntry = existingHomeOfficeEntries.length === 1 ? existingHomeOfficeEntries[0] : undefined;
  const duplicates = existingHomeOfficeEntries.length > 1;
  const disabled = !canWrite || !entriesReady || saving || removing;

  useEffect(() => {
    if (!entriesReady || edited.current) return;
    const key = `${year}:${existingEntry?.id ?? 'new'}:${existingEntry?.notes ?? ''}`;
    if (hydrated.current === key) return;
    hydrated.current = key;
    if (!existingEntry) return;
    const basis = parseAllowanceDayBasis(existingEntry.notes, year);
    if (basis) {
      setDayMethod(basis.mode);
      setAnnualDays(basis.days);
      setFrom(basis.from);
      setTo(basis.to);
      setSelectedWeekdays(basis.weekdays);
      setVacationDays(basis.vacationDays);
      setOtherDays(basis.otherDays);
    } else {
      const legacyCount = readLegacyAllowanceDayCount(existingEntry.notes, year, today);
      if (legacyCount !== null) setAnnualDays(legacyCount);
    }
    const parameters = readSavedParameters(existingEntry.notes, year);
    if (parameters) {
      setDailyRate(parameters.rate);
      setMaxDays(parameters.maxDays);
      setMaxAmount(parameters.maxAmount);
      setParameterSource(parameters.source);
    }
  }, [entriesReady, existingEntry, today, year]);

  const markEdited = () => { edited.current = true; setReviewed(false); setError(''); };
  const weekly = useMemo(() => calculateAllowanceWorkdays({
    year, from, to, weekdays: selectedWeekdays,
    vacationDays: vacationDays === '' ? 0 : vacationDays,
    otherDays: otherDays === '' ? 0 : otherDays, today,
  }), [year, from, to, selectedWeekdays, vacationDays, otherDays, today]);
  const days = dayMethod === 'weekly' ? weekly.days : annualDays;
  const validDays = typeof days === 'number' && Number.isInteger(days) && days > 0 && days <= range.maxDays
    && (dayMethod !== 'weekly' || !weekly.error);
  const validMoney = (value: number | '') => typeof value === 'number' && Number.isFinite(value)
    && value > 0 && value < 10_000_000_000 && Math.abs(value - Math.round((value + Number.EPSILON) * 100) / 100) < 0.000001;
  const validMaxDays = maxDays === '' || (Number.isInteger(maxDays) && maxDays > 0);
  const validMaxAmount = maxAmount === '' || validMoney(maxAmount);
  const validParameters = validMoney(dailyRate) && validMaxDays && validMaxAmount && Boolean(parameterSource.trim());
  const countedDays = typeof days === 'number' ? Math.min(days, maxDays === '' || !validMaxDays ? days : maxDays) : 0;
  const rawAmount = validDays && validParameters ? countedDays * Number(dailyRate) : null;
  const calculatedAmount = rawAmount === null ? null : Math.round((Math.min(rawAmount, maxAmount === '' ? rawAmount : maxAmount) + Number.EPSILON) * 100) / 100;
  const currency = (amount: number) => formatCurrency(amount, locale, numberFormat, 'EUR');
  const dailyBasis: AllowanceDayBasis = {
    version: 1, year, mode: dayMethod, days: typeof days === 'number' ? days : 0,
    from: dayMethod === 'weekly' ? from : range.from,
    to: dayMethod === 'weekly' ? to : range.to,
    weekdays: dayMethod === 'weekly' ? selectedWeekdays : [],
    vacationDays: dayMethod === 'weekly' ? Number(vacationDays || 0) : 0,
    otherDays: dayMethod === 'weekly' ? Number(otherDays || 0) : 0,
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (disabled) return;
    let description: string;
    let amount: number;
    let notes: string;
    if (mode === 'home_office') {
      if (duplicates) { setError('Bitte zuerst die doppelten Homeoffice-Posten bereinigen.'); return; }
      if (!validDays) { setError(dayMethod === 'weekly' && weekly.error ? weekly.error : `Bitte eine ganze Tagesanzahl von 1 bis ${range.maxDays} eintragen.`); return; }
      if (!validParameters || calculatedAmount === null || calculatedAmount <= 0 || calculatedAmount >= 10_000_000_000) {
        setError('Bitte Tagessatz, Quelle und optionale Grenzen prüfen.'); return;
      }
      if (!reviewed) { setError('Bitte die Angaben und Berechnung bestätigen.'); return; }
      amount = calculatedAmount;
      description = `Homeoffice-Tagespauschale ${year}`;
      const source = parameterSource.trim().replace(/\s+/g, ' ');
      notes = [
        `Steuerjahr ${year}; Jahresansatz zum 31.12.`,
        serializeAllowanceDayBasis(dailyBasis),
        dayMethod === 'weekly'
          ? `Wochenberechnung ${from} bis ${to}; Wochentage: ${weekdays.filter(day => selectedWeekdays.includes(day.value)).map(day => day.label).join(', ')}; ${weekly.baseDays} Arbeitstage abzüglich ${Number(vacationDays || 0)} Urlaubstage und ${Number(otherDays || 0)} weiterer freier Tage = ${days} Tage.`
          : `Tagesanzahl für das Jahr: ${days}; vom Nutzer anhand eigener Aufzeichnungen eingetragen.`,
        `Berechnungswerte für ${year} (vom Nutzer erfasst): ${Number(dailyRate).toFixed(2)} EUR je Tag; Tagesgrenze=${maxDays === '' ? 'keine' : maxDays}; Betragsgrenze=${maxAmount === '' ? 'keine' : maxAmount.toFixed(2)} EUR; Quelle=${source}`,
        `Berechnung: ${countedDays} berücksichtigte Tage × ${Number(dailyRate).toFixed(2)} EUR${maxAmount === '' ? '' : `; begrenzt auf ${maxAmount.toFixed(2)} EUR`}; Jahresbetrag ${amount.toFixed(2)} EUR.`,
        'Angaben, steuerliche Voraussetzungen und Zuordnung vom Nutzer geprüft. Keine Umsatzsteuer oder Vorsteuer.',
      ].join('\n');
    } else {
      if (!manualDescription.trim() || !validMoney(manualAmount) || !manualBasis.trim()) {
        setError('Bitte Bezeichnung, Betrag und Berechnungsgrundlage eintragen.'); return;
      }
      if (!reviewed) { setError('Bitte die Angaben und Berechnung bestätigen.'); return; }
      description = `${manualDescription.trim()} ${year}`;
      amount = Number(manualAmount);
      notes = `Steuerjahr ${year}; Jahresansatz zum 31.12.\nEigene Berechnungsgrundlage: ${manualBasis.trim()}\nAngaben und steuerliche Zuordnung vom Nutzer geprüft. Keine Umsatzsteuer oder Vorsteuer.`;
    }
    setSaving(true);
    try {
      await onSave({
        entryType: 'expense', entryDate: `${year}-12-31`, description, category: 'allowance', amount, taxRate: 0,
        notes, sourceType: 'manual', vatTreatment: 'no_vat', netAmount: amount, vatAmount: 0,
        inputTaxDeductible: false, documentDate: null,
      }, mode === 'home_office' ? existingEntry?.id : undefined);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Die Pauschale konnte nicht gespeichert werden.');
    } finally { setSaving(false); }
  };

  const removeExisting = async () => {
    if (disabled || !existingEntry) return;
    if (!await confirm({ title: 'Pauschale stornieren', message: 'Den gespeicherten Jahresposten stornieren? Er bleibt im Änderungsverlauf erhalten.', confirmText: 'Stornieren', isDestructive: true })) return;
    setRemoving(true);
    setError('');
    try { await onRemoveExistingHomeOfficeEntry(existingEntry.id); onClose(); }
    catch (removeError) { setError(removeError instanceof Error ? removeError.message : 'Die Pauschale konnte nicht storniert werden.'); }
    finally { setRemoving(false); }
  };

  return <DialogShell titleId="euer-allowance-dialog-title" icon={Calculator} title="Pauschale erfassen" description={`Steuerjahr ${year}`} onClose={onClose} onSubmit={submit} size="lg" fitContent footer={<>
    <button type="button" onClick={onClose} disabled={saving || removing} className="min-h-11 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Abbrechen</button>
    {canWrite && <button type="submit" disabled={disabled || (mode === 'home_office' && (duplicates || !validDays || !validParameters))} className="btn-primary min-h-11 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Speichern …' : mode === 'home_office' && existingEntry ? 'Pauschale aktualisieren' : 'Pauschale speichern'}</button>}
  </>}>
    <div className="space-y-4 pb-2">
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {!entriesReady && <p role="status" className="text-sm text-gray-600">EÜR-Buchungen werden geladen …</p>}
      {!canWrite && <p role="status" className="text-sm text-gray-600">Du kannst die Angaben ansehen.</p>}
      <div role="group" aria-label="Art der Pauschale" className="grid grid-cols-2 gap-2">
        {([{ value: 'home_office', label: 'Tagespauschale' }, { value: 'manual', label: 'Andere Pauschale' }] as const).map(option => <button key={option.value} type="button" aria-pressed={mode === option.value} disabled={disabled} onClick={() => { setMode(option.value); setReviewed(false); setError(''); }} className={`min-h-11 rounded-lg border px-3 py-2 text-sm font-medium ${mode === option.value ? 'border-primary-custom bg-primary-light-custom text-gray-900' : 'border-gray-300 bg-white text-gray-700'}`}>{option.label}</button>)}
      </div>
      {mode === 'home_office' ? <>
        {duplicates && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">Für {year} gibt es mehrere Homeoffice-Posten. Bitte zuerst bereinigen.</p>}
        {existingEntry && <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600"><span>Gespeichert: {currency(existingEntry.amount)} · wird beim Speichern aktualisiert.</span><button type="button" onClick={() => void removeExisting()} disabled={disabled} className="font-medium text-red-700 underline disabled:opacity-50">{removing ? 'Wird storniert …' : 'Posten stornieren'}</button></div>}
        <div role="group" aria-label="Tagesanzahl ermitteln" className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={dayMethod === 'annual'} disabled={disabled} onClick={() => { if (dayMethod === 'weekly' && !weekly.error) setAnnualDays(weekly.days); setDayMethod('annual'); markEdited(); }} className={`min-h-10 rounded-lg border px-3 py-2 text-sm ${dayMethod === 'annual' ? 'border-primary-custom bg-primary-light-custom text-gray-900' : 'border-gray-300 text-gray-700'}`}>Jahresanzahl eingeben</button>
          <button type="button" aria-pressed={dayMethod === 'weekly'} disabled={disabled} onClick={() => { setDayMethod('weekly'); markEdited(); }} className={`min-h-10 rounded-lg border px-3 py-2 text-sm ${dayMethod === 'weekly' ? 'border-primary-custom bg-primary-light-custom text-gray-900' : 'border-gray-300 text-gray-700'}`}>Mit Wochen berechnen</button>
        </div>
        {dayMethod === 'annual' ? <label className="block text-sm font-medium text-gray-700">Tage im Jahr {year}
          <LocalizedNumberInput locale={locale} numberFormat={numberFormat} inputMode="numeric" value={annualDays} onValueChange={value => { setAnnualDays(value); markEdited(); }} min={0} max={range.maxDays} placeholder="Anzahl aus deiner Aufstellung" disabled={disabled} className="mt-1 w-full" />
          {annualDays !== '' && !validDays && <span className="mt-1 block text-xs font-normal text-red-700">Bitte eine ganze Zahl von 1 bis {range.maxDays} eingeben.</span>}
        </label> : <div className="space-y-3 rounded-lg border border-gray-200 p-3 sm:p-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="min-w-0 text-sm font-medium text-gray-700">Von<input type="date" value={from} min={range.from} max={range.to} disabled={disabled} onChange={event => { setFrom(event.target.value); markEdited(); }} className="form-input mt-1 w-full min-w-0" /></label>
            <label className="min-w-0 text-sm font-medium text-gray-700">Bis<input type="date" value={to} min={from} max={range.to} disabled={disabled} onChange={event => { setTo(event.target.value); markEdited(); }} className="form-input mt-1 w-full min-w-0" /></label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm font-medium text-gray-700">Tage pro KW<select value={selectedWeekdays.length} disabled={disabled} onChange={event => { setSelectedWeekdays(weekdays.slice(0, Number(event.target.value)).map(day => day.value)); markEdited(); }} className="form-input mt-1 w-full">{!selectedWeekdays.length && <option value={0}>Auswählen</option>}{weekdays.map((_, index) => <option key={index + 1} value={index + 1}>{index + 1} {index === 0 ? 'Tag' : 'Tage'}</option>)}</select></label>
            <label className="text-sm font-medium text-gray-700">Urlaubstage<LocalizedNumberInput locale={locale} numberFormat={numberFormat} inputMode="numeric" value={vacationDays} onValueChange={value => { setVacationDays(value); markEdited(); }} min={0} disabled={disabled} className="mt-1 w-full" /></label>
            <label className="text-sm font-medium text-gray-700">Weitere freie Tage<LocalizedNumberInput locale={locale} numberFormat={numberFormat} inputMode="numeric" value={otherDays} onValueChange={value => { setOtherDays(value); markEdited(); }} min={0} disabled={disabled} className="mt-1 w-full" /></label>
          </div>
          <details className="text-xs text-gray-600"><summary className="cursor-pointer py-1">Wochentage anpassen · {weekdays.filter(day => selectedWeekdays.includes(day.value)).map(day => day.label).join(', ') || 'keine'}</summary><div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Wochentage">{weekdays.map(day => <button key={day.value} type="button" aria-pressed={selectedWeekdays.includes(day.value)} disabled={disabled} onClick={() => { setSelectedWeekdays(current => current.includes(day.value) ? current.filter(value => value !== day.value) : [...current, day.value]); markEdited(); }} className={`min-h-10 min-w-10 rounded-lg border px-2 font-medium ${selectedWeekdays.includes(day.value) ? 'border-primary-custom bg-primary-light-custom text-gray-900' : 'border-gray-300 text-gray-700'}`}>{day.label}</button>)}</div></details>
          <p className="text-xs leading-5 text-gray-600">Nur freie Tage abziehen, die auf deine Arbeitstage fallen, z. B. Urlaub, Feiertage oder Krankheit.</p>
          {weekly.error ? <p role="alert" className="text-sm text-red-700">{weekly.error}</p> : <p role="status" className="text-sm text-gray-700">{weekly.baseDays} Arbeitstage − {Number(vacationDays || 0)} Urlaub − {Number(otherDays || 0)} weitere freie Tage = <strong>{weekly.days} Tage</strong></p>}
        </div>}
        {range.maxDays === 0 && <p role="status" className="text-sm text-gray-600">Für dieses Jahr können noch keine geleisteten Tage angesetzt werden.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium text-gray-700">Eigener Tagessatz (EUR)<LocalizedNumberInput locale={locale} numberFormat={numberFormat} value={dailyRate} onValueChange={value => { setDailyRate(value); markEdited(); }} min={0} disabled={disabled} placeholder="0,00" className="mt-1 w-full" /></label>
          <label className="text-sm font-medium text-gray-700">Quelle / eigene Aufstellung<input value={parameterSource} onChange={event => { setParameterSource(event.target.value); markEdited(); }} maxLength={1000} disabled={disabled} placeholder="Verweis zu Werten und Nachweis" className="form-input mt-1 w-full" /></label>
        </div>
        <details className="text-sm text-gray-600"><summary className="cursor-pointer py-1">Optionale Höchstgrenzen{maxDays !== '' || maxAmount !== '' ? ' · gesetzt' : ''}</summary><div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium text-gray-700">Höchstens Tage<LocalizedNumberInput locale={locale} numberFormat={numberFormat} inputMode="numeric" value={maxDays} onValueChange={value => { setMaxDays(value); markEdited(); }} min={0} disabled={disabled} placeholder="Keine Grenze" className="mt-1 w-full" /></label>
          <label className="text-sm font-medium text-gray-700">Höchstens EUR<LocalizedNumberInput locale={locale} numberFormat={numberFormat} value={maxAmount} onValueChange={value => { setMaxAmount(value); markEdited(); }} min={0} disabled={disabled} placeholder="Keine Grenze" className="mt-1 w-full" /></label>
          {(!validMaxDays || !validMaxAmount) && <p role="alert" className="text-xs text-red-700 sm:col-span-2">Grenzen müssen positiv sein; die Tagesgrenze muss eine ganze Zahl sein.</p>}
        </div></details>
        <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-primary-light-custom px-4 py-3"><span className="text-sm text-gray-700">{typeof days === 'number' ? `${countedDays} Tage × ${dailyRate === '' ? '…' : currency(dailyRate)}${maxAmount !== '' && rawAmount !== null && rawAmount > maxAmount ? ` · max. ${currency(maxAmount)}` : ''}` : 'Jahresbetrag'}</span><strong className="text-xl text-gray-900">{calculatedAmount === null ? '—' : currency(calculatedAmount)}</strong></div>
      </> : <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium text-gray-700 sm:col-span-2">Bezeichnung<input maxLength={180} value={manualDescription} onChange={event => { setManualDescription(event.target.value); markEdited(); }} disabled={disabled} placeholder="Name der Pauschale" className="form-input mt-1 w-full" /></label>
        <label className="text-sm font-medium text-gray-700">Betrag (EUR)<LocalizedNumberInput locale={locale} numberFormat={numberFormat} value={manualAmount} onValueChange={value => { setManualAmount(value); markEdited(); }} min={0} disabled={disabled} placeholder="0,00" className="mt-1 w-full" /></label>
        <label className="text-sm font-medium text-gray-700 sm:col-span-2">Berechnungsgrundlage<textarea value={manualBasis} onChange={event => { setManualBasis(event.target.value); markEdited(); }} maxLength={2000} rows={2} disabled={disabled} placeholder="Eigene Berechnung oder Verweis" className="form-input mt-1 w-full" /></label>
      </div>}
      <label className="flex items-start gap-2 text-sm text-gray-700"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} disabled={disabled} className="mt-1 h-4 w-4 shrink-0 accent-primary-custom" /><span>Angaben, Berechnung und steuerliche Voraussetzungen selbst geprüft.</span></label>
      <details className="text-xs leading-5 text-gray-500"><summary className="cursor-pointer py-1">Hinweise und Quellen</summary><p className="mt-1">SoloOffice verwendet deine Angaben und prüft keinen steuerlichen Anspruch. Der Jahresbetrag wird zum 31.12. ohne Umsatzsteuer gespeichert. Bewahre deine Aufstellung auf.</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1"><a href="https://www.gesetze-im-internet.de/estg/__4.html" target="_blank" rel="noreferrer" className="text-primary-custom underline">§ 4 EStG</a><a href="https://www.bundesfinanzministerium.de/Web/DE/Service/Publikationen/AMTHB/amthb.htm" target="_blank" rel="noreferrer" className="text-primary-custom underline">BMF-Handbücher</a></div></details>
    </div>
  </DialogShell>;
}
