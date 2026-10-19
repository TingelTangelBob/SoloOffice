import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Calculator, Home, Info, Trash2 } from 'lucide-react';
import type { DateFormat, EuerEntry, EuerEntryPayload, NumberFormat, WorkLocationDay, WorkLocationDayType } from '../types';
import { formatCurrency, formatDate } from '../utils/formatters';
import { getCompletedWorkLocationDays, getWorkLocationDayLabel, localDateKey, WORK_LOCATION_DAY_TYPES } from '../utils/workLocationDays';
import { useFeedback } from '../context/FeedbackContext';
import { LocalizedNumberInput } from './LocalizedNumberInput';
import { DialogShell } from './DialogShell';

interface EuerAllowanceDialogProps {
  year: number;
  locale: string;
  dateFormat?: DateFormat;
  timeZone?: string;
  numberFormat?: NumberFormat;
  canWrite: boolean;
  entriesReady: boolean;
  workLocationDays: WorkLocationDay[];
  workLocationDaysLoading: boolean;
  workLocationDaysError: string;
  existingHomeOfficeEntries: EuerEntry[];
  onClose: () => void;
  onSave: (payload: EuerEntryPayload, existingEntryId?: string) => Promise<void>;
  onRemoveExistingHomeOfficeEntry: (entryId: string) => Promise<void>;
  onSaveWorkLocationDay: (date: string, dayType: WorkLocationDayType) => Promise<void>;
  onDeleteWorkLocationDay: (date: string) => Promise<void>;
  onReloadWorkLocationDays: () => Promise<void>;
}

type AllowanceMode = 'home_office' | 'manual';

function dateFromKey(value: string): Date {
  return new Date(`${value}T12:00:00`);
}

function readSavedDailyParameters(notes: string | null | undefined, year: number) {
  const line = notes?.split('\n').find(item => item.startsWith(`Berechnungswerte für ${year} (vom Nutzer erfasst): `));
  const match = line?.match(/^Berechnungswerte für (\d{4}) \(vom Nutzer erfasst\): ([\d.]+) EUR je Tag; Tagesgrenze=(keine|\d+); Betragsgrenze=(keine|[\d.]+) EUR; Quelle=(.*)$/);
  if (!match || Number(match[1]) !== year) return null;
  const rate = Number(match[2]);
  const amountLimit = match[4] === 'keine' ? '' : Number(match[4]);
  if (!Number.isFinite(rate) || rate <= 0 || !match[5]) return null;
  if (amountLimit !== '' && !Number.isFinite(amountLimit)) return null;
  return {
    dailyRate: rate,
    maxDays: match[3] === 'keine' ? '' : Number(match[3]),
    maxAmount: amountLimit,
    source: match[5],
  };
}

export function EuerAllowanceDialog({
  year,
  locale,
  dateFormat,
  timeZone,
  numberFormat,
  canWrite,
  entriesReady,
  workLocationDays,
  workLocationDaysLoading,
  workLocationDaysError,
  existingHomeOfficeEntries,
  onClose,
  onSave,
  onRemoveExistingHomeOfficeEntry,
  onSaveWorkLocationDay,
  onDeleteWorkLocationDay,
  onReloadWorkLocationDays,
}: EuerAllowanceDialogProps) {
  const { confirm } = useFeedback();
  const [mode, setMode] = useState<AllowanceMode>('home_office');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedDayType, setSelectedDayType] = useState<WorkLocationDayType>('home_majority');
  const [dayReviewed, setDayReviewed] = useState(false);
  const [dayBusy, setDayBusy] = useState(false);
  const [dayError, setDayError] = useState('');
  const [removingHomeOfficeEntry, setRemovingHomeOfficeEntry] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [manualDescription, setManualDescription] = useState('');
  const [manualAmount, setManualAmount] = useState<number | ''>('');
  const [manualBasis, setManualBasis] = useState('');
  const [dailyRate, setDailyRate] = useState<number | ''>('');
  const [maxDays, setMaxDays] = useState<number | ''>('');
  const [maxAmount, setMaxAmount] = useState<number | ''>('');
  const [parameterSource, setParameterSource] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const today = localDateKey(new Date(), timeZone);
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const selectedDay = workLocationDays.find(day => day.date === selectedDate);
  const completedDays = useMemo(() => getCompletedWorkLocationDays(workLocationDays, year, today), [today, workLocationDays, year]);
  const predominantDays = completedDays.filter(day => day.dayType === 'home_majority').length;
  const noOtherWorkplaceDays = completedDays.filter(day => day.dayType === 'home_no_other_workspace').length;
  const parsedDailyRate = dailyRate === '' ? Number.NaN : Number(dailyRate);
  const parsedMaxDays = maxDays === '' ? undefined : Number(maxDays);
  const parsedMaxAmount = maxAmount === '' ? undefined : Number(maxAmount);
  const normalizedParameterSource = parameterSource.trim().replace(/\s+/g, ' ');
  const hasTwoDecimals = (value: number) => Math.abs(value - Math.round((value + Number.EPSILON) * 100) / 100) < 0.000001;
  const hasValidDailyRate = Number.isFinite(parsedDailyRate) && parsedDailyRate > 0 && parsedDailyRate < 10_000_000_000 && hasTwoDecimals(parsedDailyRate);
  const hasValidMaxDays = parsedMaxDays === undefined || (Number.isInteger(parsedMaxDays) && parsedMaxDays > 0);
  const hasValidMaxAmount = parsedMaxAmount === undefined || (Number.isFinite(parsedMaxAmount) && parsedMaxAmount > 0 && parsedMaxAmount < 10_000_000_000 && hasTwoDecimals(parsedMaxAmount));
  const countedDays = parsedMaxDays === undefined || !hasValidMaxDays
    ? completedDays.length
    : Math.min(completedDays.length, parsedMaxDays);
  const rawCalculatedAmount = hasValidDailyRate && hasValidMaxDays ? countedDays * parsedDailyRate : Number.NaN;
  const cappedAmount = Number.isFinite(rawCalculatedAmount) && parsedMaxAmount !== undefined && hasValidMaxAmount
    ? Math.min(rawCalculatedAmount, parsedMaxAmount)
    : rawCalculatedAmount;
  const calculatedAmount = hasValidMaxAmount && Number.isFinite(cappedAmount) && cappedAmount < 10_000_000_000
    ? Math.round((cappedAmount + Number.EPSILON) * 100) / 100
    : null;
  const hasValidDailyCalculation = hasValidDailyRate
    && hasValidMaxDays
    && hasValidMaxAmount
    && Boolean(normalizedParameterSource)
    && calculatedAmount !== null;
  const pendingDays = workLocationDays.filter(day => day.date > today).length;
  const existingHomeOfficeEntry = existingHomeOfficeEntries.length === 1 ? existingHomeOfficeEntries[0] : undefined;
  const duplicateHomeOfficeEntries = existingHomeOfficeEntries.length > 1;
  const savedDailyParameters = useMemo(
    () => readSavedDailyParameters(existingHomeOfficeEntry?.notes, year),
    [existingHomeOfficeEntry?.notes, year],
  );
  useEffect(() => {
    if (!existingHomeOfficeEntry || !savedDailyParameters) return;
    setDailyRate(savedDailyParameters.dailyRate);
    setMaxDays(savedDailyParameters.maxDays);
    setMaxAmount(savedDailyParameters.maxAmount);
    setParameterSource(savedDailyParameters.source);
  }, [existingHomeOfficeEntry, savedDailyParameters]);
  const currentEvidenceLine = `Tagesnachweis (Datum=Art): ${completedDays.map(day => `${day.date}=${day.dayType}`).join(', ')}.`;
  const currentParametersLine = hasValidDailyCalculation && calculatedAmount !== null
    ? `Berechnungswerte für ${year} (vom Nutzer erfasst): ${parsedDailyRate.toFixed(2)} EUR je Tag; Tagesgrenze=${parsedMaxDays ?? 'keine'}; Betragsgrenze=${parsedMaxAmount === undefined ? 'keine' : parsedMaxAmount.toFixed(2)} EUR; Quelle=${normalizedParameterSource}`
    : '';
  const existingHomeOfficeEntryIsStale = Boolean(existingHomeOfficeEntry && (
    hasValidDailyCalculation
    && calculatedAmount !== null
    && (Number(existingHomeOfficeEntry.amount) !== calculatedAmount
      || !existingHomeOfficeEntry.notes?.includes(currentEvidenceLine)
      || !existingHomeOfficeEntry.notes?.includes(currentParametersLine))
  ));
  const currency = (amount: number) => formatCurrency(amount, locale, numberFormat, 'EUR');
  const dayTypeSummary = WORK_LOCATION_DAY_TYPES
    .map(option => `${option.label}: ${completedDays.filter(day => day.dayType === option.value).length}`)
    .join('; ');

  const selectDate = (date: string) => {
    setSelectedDate(date);
    setSelectedDayType(workLocationDays.find(day => day.date === date)?.dayType || 'home_majority');
    setDayReviewed(false);
    setDayError('');
  };

  const saveDay = async () => {
    setDayError('');
    if (!canWrite) {
      setDayError('Für diese Aktion fehlt die Schreibberechtigung.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate) || selectedDate < yearStart || selectedDate > yearEnd) {
      setDayError(`Bitte ein Datum im Steuerjahr ${year} auswählen.`);
      return;
    }
    if (selectedDate > today) {
      setDayError('Ein Arbeitstag kann erst nach der tatsächlichen Tätigkeit erfasst werden.');
      return;
    }
    if (!dayReviewed) {
      setDayError('Bitte bestätige, dass du die tatsächliche Arbeitssituation korrekt erfasst hast.');
      return;
    }
    setDayBusy(true);
    setReviewed(false);
    try {
      await onSaveWorkLocationDay(selectedDate, selectedDayType);
      setDayReviewed(false);
    } catch (saveError) {
      setDayError(saveError instanceof Error ? saveError.message : 'Der Tag konnte nicht gespeichert werden.');
    } finally {
      setDayBusy(false);
    }
  };

  const deleteDay = async (date: string) => {
    if (!canWrite) return;
    const accepted = await confirm({
      title: 'Tagesmerkmal entfernen',
      message: `Die Arbeitsort-Erfassung für ${formatDate(dateFromKey(date), locale, dateFormat)} entfernen?`,
      confirmText: 'Entfernen',
      isDestructive: true,
    });
    if (!accepted) return;
    setDayBusy(true);
    setDayError('');
    setReviewed(false);
    try {
      await onDeleteWorkLocationDay(date);
      if (selectedDate === date) setSelectedDate('');
    } catch (deleteError) {
      setDayError(deleteError instanceof Error ? deleteError.message : 'Der Tag konnte nicht entfernt werden.');
    } finally {
      setDayBusy(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (!canWrite) {
      setError('Für diese Aktion fehlt die Schreibberechtigung.');
      return;
    }
    if (!entriesReady) {
      setError('Die EÜR-Buchungen für dieses Jahr sind noch nicht zuverlässig geladen. Bitte lade die EÜR erneut, bevor du eine Pauschale speicherst.');
      return;
    }

    let description: string;
    let amount: number;
    let notes: string;
    let existingEntryId: string | undefined;

    if (mode === 'home_office') {
      if (duplicateHomeOfficeEntries) {
        setError('Für dieses Jahr sind mehrere Homeoffice-Pauschalposten vorhanden. Bitte bereinige die doppelten Buchungen zuerst.');
        return;
      }
      if (!completedDays.length) {
        setError('Für dieses Jahr ist noch kein geleisteter und geprüfter Tag erfasst.');
        return;
      }
      if (!hasValidDailyCalculation || calculatedAmount === null) {
        setError('Bitte trage für dieses Steuerjahr einen gültigen Tagessatz und eine Quelle ein. Optionale Grenzen müssen gültig sein.');
        return;
      }
      if (!reviewed) {
        setError('Bitte bestätige, dass du die Werte, ihre Quelle, die Tagesaufstellung, Voraussetzungen und mögliche Ausschlüsse selbst geprüft hast.');
        return;
      }
      description = `Homeoffice-Tagespauschale ${year}`;
      amount = calculatedAmount;
      existingEntryId = existingHomeOfficeEntry?.id;
      notes = [
        `Steuerjahr ${year}; Jahresansatz zum 31.12.`,
        `Tagearten: ${dayTypeSummary}.`,
        `Tagesnachweis (Datum=Art): ${completedDays.map(day => `${day.date}=${day.dayType}`).join(', ')}.`,
        currentParametersLine,
        pendingDays > 0 ? `${pendingDays} zukünftige Erfassungen sind nicht im Betrag enthalten.` : '',
        `Rechenweg laut eingegebenen Werten: ${countedDays} von ${completedDays.length} erfassten Tagen × ${parsedDailyRate.toFixed(2)} EUR = ${Math.round((countedDays * parsedDailyRate + Number.EPSILON) * 100) / 100} EUR${parsedMaxAmount === undefined ? '' : `; Betragsgrenze ${parsedMaxAmount.toFixed(2)} EUR`}; gespeicherter Betrag ${amount.toFixed(2)} EUR.`,
        'Arbeitssituation, aktuelle Voraussetzungen, mögliche Ausschlüsse und Zuordnung wurden von dir selbst geprüft. SoloOffice nimmt keine steuerliche Einzelfallprüfung vor.',
        'Keine Umsatzsteuer oder Vorsteuer erfasst. ELSTER-Zuordnung bitte passend zum Steuerjahr selbst prüfen.',
      ].filter(Boolean).join('\n');
    } else {
      const parsedAmount = manualAmount === '' ? Number.NaN : Number(manualAmount);
      if (!manualDescription.trim()) {
        setError('Bitte die Pauschale benennen.');
        return;
      }
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || parsedAmount >= 10_000_000_000) {
        setError('Bitte einen gültigen Betrag größer als 0 € eintragen.');
        return;
      }
      if (!manualBasis.trim()) {
        setError('Bitte die Berechnungsgrundlage oder einen Hinweis zur eigenen Aufstellung eintragen.');
        return;
      }
      if (!reviewed) {
        setError('Bitte bestätige, dass du Anspruch, Betrag und Zuordnung selbst geprüft hast.');
        return;
      }
      description = `${manualDescription.trim()} ${year}`;
      const roundedAmount = Math.round((parsedAmount + Number.EPSILON) * 100) / 100;
      if (Math.abs(parsedAmount - roundedAmount) > 0.000001) {
        setError('Der Betrag darf höchstens zwei Nachkommastellen haben.');
        return;
      }
      amount = roundedAmount;
      notes = [
        `Steuerjahr ${year}; Jahresansatz zum 31.12.`,
        `Eigene Berechnungsgrundlage: ${manualBasis.trim()}`,
        'Betrag, Abziehbarkeit und Zuordnung wurden von dir geprüft; SoloOffice nimmt keine steuerliche Einzelfallprüfung vor.',
        'Keine Umsatzsteuer oder Vorsteuer erfasst. ELSTER-Zuordnung bitte passend zum Steuerjahr selbst prüfen.',
      ].join('\n');
    }

    const payload: EuerEntryPayload = {
      entryType: 'expense',
      entryDate: `${year}-12-31`,
      description,
      category: 'allowance',
      amount,
      taxRate: 0,
      notes,
      sourceType: 'manual',
      vatTreatment: 'no_vat',
      netAmount: amount,
      vatAmount: 0,
      inputTaxDeductible: false,
      documentDate: null,
    };

    setSaving(true);
    try {
      await onSave(payload, existingEntryId);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Die Pauschale konnte nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  };

  const removeHomeOfficeEntry = async () => {
    if (!canWrite || workLocationDaysLoading || workLocationDaysError || !existingHomeOfficeEntry || completedDays.length > 0) return;
    const accepted = await confirm({
      title: 'Homeoffice-Pauschalposten stornieren',
      message: 'Es sind keine geprüften Arbeitstage mehr gespeichert. Den vorhandenen EÜR-Posten stornieren? Die Buchung bleibt im Änderungsverlauf erhalten.',
      confirmText: 'Posten stornieren',
      isDestructive: true,
    });
    if (!accepted) return;
    setRemovingHomeOfficeEntry(true);
    setError('');
    try {
      await onRemoveExistingHomeOfficeEntry(existingHomeOfficeEntry.id);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Der Homeoffice-Pauschalposten konnte nicht storniert werden.');
    } finally {
      setRemovingHomeOfficeEntry(false);
    }
  };

  const workLocationEditor = (
    <section className="rounded-xl border border-gray-200 bg-white p-4" aria-labelledby="work-location-records-heading">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Home className="mt-0.5 h-4 w-4 shrink-0 text-primary-custom" />
          <div>
            <h3 id="work-location-records-heading" className="text-sm font-semibold text-gray-900">Arbeitstage für {year}</h3>
            <p className="mt-1 text-xs leading-5 text-gray-600">Tage einzeln erfassen. Termine werden nicht gezählt; Vorbereitung und andere Arbeit ohne Termin können berücksichtigt werden.</p>
          </div>
        </div>
        {workLocationDaysLoading && <span role="status" className="shrink-0 text-xs text-gray-500">Lädt …</span>}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <label className="text-sm font-medium text-gray-700">Arbeitstag
          <input type="date" value={selectedDate} min={yearStart} max={yearEnd < today ? yearEnd : today} onChange={event => selectDate(event.target.value)} className="form-input mt-1 w-full" disabled={!canWrite || dayBusy || workLocationDaysLoading || Boolean(workLocationDaysError)} />
        </label>
        <label className="text-sm font-medium text-gray-700">Tagesart
          <select value={selectedDayType} onChange={event => { setSelectedDayType(event.target.value as WorkLocationDayType); setDayReviewed(false); }} className="form-input mt-1 w-full" disabled={!canWrite || dayBusy || workLocationDaysLoading || Boolean(workLocationDaysError)}>
            {WORK_LOCATION_DAY_TYPES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      </div>
      {selectedDay && <p className="mt-2 text-xs text-gray-600">Für dieses Datum ist bereits „{getWorkLocationDayLabel(selectedDay.dayType)}“ gespeichert. Die neue Auswahl ersetzt diesen Eintrag.</p>}
      <p className="mt-2 flex items-start gap-2 text-xs leading-5 text-gray-600"><Info className="mt-0.5 h-4 w-4 shrink-0 text-primary-custom" />Diese Erfassung beschreibt nur die Arbeitssituation. Steuerliche Voraussetzungen, Ausschlüsse und Zuordnung hängen von Steuerjahr und Einzelfall ab und werden von SoloOffice nicht geprüft.</p>
      <label className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950">
        <input type="checkbox" checked={dayReviewed} onChange={event => setDayReviewed(event.target.checked)} disabled={!canWrite || !selectedDate || selectedDate > today || dayBusy || workLocationDaysLoading || Boolean(workLocationDaysError)} className="mt-1 h-4 w-4 accent-primary-custom" />
        <span>Ich habe die tatsächliche Arbeitssituation für diesen Tag korrekt erfasst.</span>
      </label>
      {dayError && <p role="alert" className="mt-2 text-sm text-red-700">{dayError}</p>}
      {selectedDate > today && <p className="mt-2 text-xs text-amber-800">Zukünftige Arbeitstage können erst nach der tatsächlichen Tätigkeit erfasst werden.</p>}
      <button type="button" onClick={() => void saveDay()} disabled={!canWrite || dayBusy || workLocationDaysLoading || Boolean(workLocationDaysError) || !selectedDate || selectedDate > today || !dayReviewed} className="mt-3 min-h-10 rounded-lg border border-primary-custom px-3 py-2 text-sm font-medium text-primary-custom hover:bg-primary-custom/10 disabled:cursor-not-allowed disabled:opacity-50">{dayBusy ? 'Wird gespeichert …' : selectedDay ? 'Tagesart aktualisieren' : 'Tag hinzufügen'}</button>

      <div className="mt-4 border-t border-gray-100 pt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-gray-900">Erfasste Tage: {completedDays.length}</p>
          {pendingDays > 0 && <p className="text-xs text-gray-500">{pendingDays} zukünftige Tage nicht berücksichtigt</p>}
        </div>
        {workLocationDays.length === 0 ? <p className="mt-2 text-xs text-gray-500">Noch keine Tagesmerkmale gespeichert.</p> : (
          <ul className="mt-2 max-h-40 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-100" aria-label={`Erfasste Arbeitstage ${year}`}>
            {workLocationDays.map(day => (
              <li key={day.date} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                <button type="button" onClick={() => selectDate(day.date)} className="min-w-0 flex-1 text-left hover:text-primary-custom">
                  <span className="font-medium text-gray-900">{formatDate(dateFromKey(day.date), locale, dateFormat)}</span>
                  <span className="ml-2 text-gray-600">{getWorkLocationDayLabel(day.dayType)}</span>
                  {day.date > today && <span className="ml-2 text-amber-700">(zukünftig)</span>}
                </button>
                {canWrite && <button type="button" onClick={() => void deleteDay(day.date)} disabled={dayBusy} className="shrink-0 rounded p-1 text-gray-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-50" aria-label={`Erfassung vom ${formatDate(dateFromKey(day.date), locale, dateFormat)} entfernen`} title="Tagesmerkmal entfernen"><Trash2 className="h-4 w-4" /></button>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );

  return <DialogShell
    titleId="euer-allowance-dialog-title"
    icon={Calculator}
    title="Pauschale für die EÜR erfassen"
    description={`Steuerjahr ${year} · Der Jahresansatz wird dem 31.12. zugeordnet.`}
    onClose={onClose}
    onSubmit={submit}
    size="lg"
    footer={<>
      <button type="button" onClick={onClose} className="min-h-12 rounded-lg border border-gray-300 bg-white px-5 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50" disabled={saving || dayBusy || removingHomeOfficeEntry}>Abbrechen</button>
      {canWrite && <button type="submit" disabled={saving || dayBusy || removingHomeOfficeEntry || !entriesReady || (mode === 'home_office' && (completedDays.length === 0 || duplicateHomeOfficeEntries || workLocationDaysLoading || Boolean(workLocationDaysError)))} className="btn-primary min-h-12 rounded-lg px-5 py-2 text-sm font-semibold text-white transition hover:brightness-90 disabled:opacity-50">{saving ? 'Speichern …' : mode === 'home_office' && existingHomeOfficeEntry ? 'Pauschale aktualisieren' : 'Pauschale speichern'}</button>}
    </>}
  >
    {error && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    {!canWrite && <p role="status" className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">Du kannst die Aufzeichnungen ansehen, aber nicht ändern.</p>}
    {!entriesReady && <p role="alert" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Die EÜR-Buchungen für dieses Jahr sind noch nicht zuverlässig geladen. Eine Pauschale kann erst danach gespeichert werden.</p>}
    <div className="space-y-4 pb-2">
      <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Art der Pauschale">
        <button type="button" aria-pressed={mode === 'home_office'} onClick={() => { setMode('home_office'); setReviewed(false); setError(''); }} className={`min-h-11 rounded-lg border px-4 py-2 text-left text-sm font-medium ${mode === 'home_office' ? 'border-primary-custom bg-primary-light-custom text-gray-900' : 'border-gray-300 bg-white text-gray-700'}`}>Tagespauschale – eigene Werte</button>
        <button type="button" aria-pressed={mode === 'manual'} onClick={() => { setMode('manual'); setReviewed(false); setError(''); }} className={`min-h-11 rounded-lg border px-4 py-2 text-left text-sm font-medium ${mode === 'manual' ? 'border-primary-custom bg-primary-light-custom text-gray-900' : 'border-gray-300 bg-white text-gray-700'}`}>Andere Pauschale – eigener Betrag</button>
      </div>

      {mode === 'home_office' ? (
        <>
          <section className="rounded-xl border border-gray-200 bg-white p-4" aria-labelledby="home-office-allowance-heading">
            <div className="flex items-start gap-3">
              <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary-custom" />
              <div>
                <h3 id="home-office-allowance-heading" className="font-semibold text-gray-900">Tagesberechnung für {year}</h3>
                <p className="mt-1 text-sm leading-6 text-gray-600">Trage die für dieses Steuerjahr recherchierten Werte selbst ein. SoloOffice zählt nur gespeicherte Tage bis einschließlich heute und wendet ausschließlich deine Eingaben an. Die Werte werden mit Quelle im EÜR-Posten dokumentiert; für ein anderes Steuerjahr bitte neu prüfen.</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <a href="https://www.gesetze-im-internet.de/estg/__4.html" target="_blank" rel="noreferrer" className="font-medium text-primary-custom underline">§ 4 EStG, Nr. 6c</a>
                  <a href="https://www.bundesfinanzministerium.de/Web/DE/Service/Publikationen/AMTHB/amthb.htm" target="_blank" rel="noreferrer" className="font-medium text-primary-custom underline">BMF: Amtliche Handbücher</a>
                </div>
              </div>
            </div>
          </section>

          {existingHomeOfficeEntry && !workLocationDaysLoading && !workLocationDaysError && <div role={existingHomeOfficeEntryIsStale || !savedDailyParameters ? 'alert' : 'status'} className={`rounded-lg border p-3 text-sm ${existingHomeOfficeEntryIsStale || !savedDailyParameters ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-gray-200 bg-gray-50 text-gray-700'}`}>
            {!savedDailyParameters
              ? `Der gespeicherte Homeoffice-Posten über ${currency(existingHomeOfficeEntry.amount)} enthält keine dokumentierten, von dir eingegebenen Jahreswerte und Quelle. Recherchiere die Werte für ${year}, prüfe den Tagesnachweis und speichere den Posten neu.`
              : existingHomeOfficeEntryIsStale
                ? `Der gespeicherte Homeoffice-Posten über ${currency(existingHomeOfficeEntry.amount)} passt nicht mehr zu den aktuellen Werten oder zum Tagesnachweis. ${completedDays.length ? 'Speichere die geprüfte aktuelle Aufstellung, um den Posten zu aktualisieren.' : 'Storniere den alten Posten, wenn du keine Tage mehr ansetzen möchtest.'}`
                : `Es gibt bereits einen Homeoffice-Pauschalposten über ${currency(existingHomeOfficeEntry.amount)}. Beim Speichern wird dieser vorhandene Posten mit den aktuellen Werten und dem Tagesnachweis aktualisiert.`}
            {canWrite && completedDays.length === 0 && <button type="button" onClick={() => void removeHomeOfficeEntry()} disabled={removingHomeOfficeEntry || saving || dayBusy || workLocationDaysLoading || Boolean(workLocationDaysError)} className="mt-2 block rounded border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">{removingHomeOfficeEntry ? 'Wird storniert …' : 'Vorhandenen Posten stornieren'}</button>}
          </div>}
          {duplicateHomeOfficeEntries && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">Für dieses Jahr sind mehrere Homeoffice-Pauschalposten vorhanden. Bereinige sie vor einer Neuberechnung.</div>}
          {workLocationDaysError && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><span>{workLocationDaysError}</span><button type="button" onClick={() => void onReloadWorkLocationDays()} className="rounded border border-red-300 bg-white px-3 py-1.5 font-medium hover:bg-red-100">Erneut laden</button></div>}

          {workLocationEditor}

          <div className="grid gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-gray-700">Eigener Tagessatz für {year} (EUR)
              <LocalizedNumberInput locale={locale} numberFormat={numberFormat} value={dailyRate} onValueChange={value => { setDailyRate(value); setReviewed(false); }} min={0} allowNegative={false} className="form-input mt-1 w-full" placeholder="Je recherchiertem Steuerjahr eingeben" disabled={!canWrite} />
              {dailyRate !== '' && hasValidDailyRate === false && <span className="mt-1 block text-xs font-normal text-red-700">Bitte einen Betrag größer als 0 mit höchstens zwei Nachkommastellen eintragen.</span>}
            </label>
            <label className="text-sm font-medium text-gray-700">Tagesgrenze (optional)
              <LocalizedNumberInput locale={locale} numberFormat={numberFormat} value={maxDays} onValueChange={value => { setMaxDays(value); setReviewed(false); }} min={0} allowNegative={false} className="form-input mt-1 w-full" placeholder="Keine Grenze" disabled={!canWrite} />
              {maxDays !== '' && !hasValidMaxDays && <span className="mt-1 block text-xs font-normal text-red-700">Bitte eine ganze Zahl größer als 0 eintragen.</span>}
            </label>
            <label className="text-sm font-medium text-gray-700">Betragsgrenze in EUR (optional)
              <LocalizedNumberInput locale={locale} numberFormat={numberFormat} value={maxAmount} onValueChange={value => { setMaxAmount(value); setReviewed(false); }} min={0} allowNegative={false} className="form-input mt-1 w-full" placeholder="Keine Grenze" disabled={!canWrite} />
              {maxAmount !== '' && !hasValidMaxAmount && <span className="mt-1 block text-xs font-normal text-red-700">Bitte einen Betrag größer als 0 mit höchstens zwei Nachkommastellen eintragen.</span>}
            </label>
            <label className="text-sm font-medium text-gray-700 sm:col-span-2">Quelle oder Verweis auf die eigene Recherche für diese Werte
              <textarea maxLength={1000} rows={2} value={parameterSource} onChange={event => { setParameterSource(event.target.value); setReviewed(false); }} className="form-input mt-1 w-full" placeholder="z. B. amtliche Quelle, URL und Stand des Steuerjahrs" disabled={!canWrite} />
            </label>
            <p className="text-xs leading-5 text-gray-500 sm:col-span-2">Die Grenzfelder bleiben leer, wenn du keine Grenze anwenden möchtest. SoloOffice prüft weder, ob die Quelle aktuell ist, noch ob die Werte oder deine Berechtigung steuerlich zutreffen.</p>
          </div>

          <div className="rounded-xl border border-primary-custom/30 bg-primary-light-custom p-4">
            <div className="flex items-center justify-between gap-4 text-sm text-gray-700"><span>Berücksichtigte Tage</span><strong>{parsedMaxDays === undefined || !hasValidMaxDays ? `${countedDays} von ${completedDays.length}` : `${countedDays} von höchstens ${parsedMaxDays}`}</strong></div>
            <div className="mt-1 flex items-center justify-between gap-4 text-xs text-gray-600"><span>Überwiegende Arbeit zu Hause</span><span>{predominantDays}</span></div>
            <div className="mt-1 flex items-center justify-between gap-4 text-xs text-gray-600"><span>Dauerhaft kein anderer Arbeitsplatz</span><span>{noOtherWorkplaceDays}</span></div>
            <div className="mt-2 flex items-center justify-between gap-4 border-t border-primary-custom/20 pt-2 text-sm text-gray-700"><span>Berechneter Jahresbetrag</span><strong className="text-lg text-gray-900">{calculatedAmount === null ? hasValidDailyRate ? 'Grenzen prüfen' : 'Tagessatz eingeben' : currency(calculatedAmount)}</strong></div>
            {parsedMaxAmount !== undefined && calculatedAmount !== null && rawCalculatedAmount > parsedMaxAmount && <p className="mt-2 text-xs text-gray-600">Der Betrag ist gemäß deiner Eingabe auf {currency(parsedMaxAmount)} begrenzt. Alle erfassten Tage bleiben im Tagesnachweis erhalten.</p>}
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
            <p className="font-medium">Vor dem Jahresansatz selbst prüfen</p>
            <p className="mt-1">Prüfe die aktuelle gesetzliche Grundlage, Voraussetzungen, mögliche Ausschlüsse und Zuordnung für dieses Steuerjahr anhand der verlinkten amtlichen Quellen. SoloOffice bewertet deine Tagesarten nicht als steuerlich abzugsfähig.</p>
            <label className="mt-3 flex items-start gap-3 border-t border-amber-200 pt-3 font-medium">
              <input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} disabled={!canWrite || !completedDays.length || !hasValidDailyCalculation || duplicateHomeOfficeEntries} className="mt-1 h-4 w-4 accent-primary-custom" />
              <span>Ich habe die Werte, die angegebene Quelle, meine Tagesaufstellung, Anspruch und Zuordnung selbst geprüft. SoloOffice berechnet keine steuerlichen Vorgaben und bestätigt keinen Anspruch.</span>
            </label>
          </div>
        </>
      ) : (
        <>
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-sm leading-6 text-gray-600">Für weitere oder besondere Pauschalen kannst du Beschreibung, Betrag und eigene Berechnungsgrundlage eintragen. SoloOffice berechnet und bewertet diese Fälle nicht und nimmt keine ELSTER-Zuordnung vor.</p>
          </section>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-gray-700 sm:col-span-2">Bezeichnung
            <input maxLength={180} value={manualDescription} onChange={event => { setManualDescription(event.target.value); setReviewed(false); }} className="form-input mt-1 w-full" placeholder="z. B. eigene Pauschale" disabled={!canWrite} />
            </label>
            <label className="text-sm font-medium text-gray-700">Betrag
              <LocalizedNumberInput locale={locale} numberFormat={numberFormat} value={manualAmount} onValueChange={value => { setManualAmount(value); setReviewed(false); }} min={0} allowNegative={false} className="form-input mt-1 w-full" placeholder="0,00" disabled={!canWrite} />
            </label>
            <label className="text-sm font-medium text-gray-700 sm:col-span-2">Eigene Berechnungsgrundlage oder Verweis auf die Aufstellung
              <textarea maxLength={2000} rows={3} value={manualBasis} onChange={event => { setManualBasis(event.target.value); setReviewed(false); }} className="form-input mt-1 w-full" placeholder="Erkläre, wie du den Betrag ermittelt hast." disabled={!canWrite} />
            </label>
          </div>
          <label className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
            <input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} disabled={!canWrite} className="mt-1 h-4 w-4 accent-primary-custom" />
            <span>Ich habe Anspruch, Betrag und Zuordnung selbst geprüft. SoloOffice nimmt keine steuerliche Einzelfallprüfung vor.</span>
          </label>
        </>
      )}
    </div>
  </DialogShell>;
}
