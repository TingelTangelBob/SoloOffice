import { useState, type FormEvent } from 'react';
import { Home, Info, Trash2 } from 'lucide-react';
import type { DateFormat, WorkLocationDay, WorkLocationDayType } from '../types';
import { formatDate } from '../utils/formatters';
import { getWorkLocationDayLabel, localDateKey, WORK_LOCATION_DAY_TYPES } from '../utils/workLocationDays';
import { useFeedback } from '../context/FeedbackContext';
import { DialogShell } from './DialogShell';

interface WorkLocationDayDialogProps {
  date: string;
  day?: WorkLocationDay;
  locale: string;
  dateFormat?: DateFormat;
  timeZone?: string;
  canWrite: boolean;
  loading: boolean;
  loadingError: boolean;
  onClose: () => void;
  onSave: (date: string, dayType: WorkLocationDayType) => Promise<void>;
  onDelete: (date: string) => Promise<void>;
}

export function WorkLocationDayDialog({
  date,
  day,
  locale,
  dateFormat,
  timeZone,
  canWrite,
  loading,
  loadingError,
  onClose,
  onSave,
  onDelete,
}: WorkLocationDayDialogProps) {
  const { confirm } = useFeedback();
  const [dayType, setDayType] = useState<WorkLocationDayType>(day?.dayType || 'home_majority');
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isFutureDay = date > localDateKey(new Date(), timeZone);
  const dateValue = new Date(`${date}T12:00:00`);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (!canWrite) return;
    if (loading || loadingError) {
      setError('Die gespeicherten Tagesaufzeichnungen sind noch nicht zuverlässig geladen. Bitte lade den Kalender erneut.');
      return;
    }
    if (isFutureDay) {
      setError('Ein Arbeitstag kann erst nach der tatsächlichen Tätigkeit erfasst werden.');
      return;
    }
    if (!reviewed) {
      setError('Bitte bestätige, dass du die tatsächliche Arbeitssituation korrekt erfasst hast.');
      return;
    }
    setBusy(true);
    try {
      await onSave(date, dayType);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Der Tag konnte nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  };

  const removeDay = async () => {
    if (!day || !canWrite || loading || loadingError) return;
    const accepted = await confirm({
      title: 'Tagesmerkmal entfernen',
      message: `Die Arbeitsort-Erfassung für ${formatDate(dateValue, locale, dateFormat)} entfernen?`,
      confirmText: 'Entfernen',
      isDestructive: true,
    });
    if (!accepted) return;
    setBusy(true);
    setError('');
    try {
      await onDelete(date);
      onClose();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Der Tag konnte nicht entfernt werden.');
    } finally {
      setBusy(false);
    }
  };

  return <DialogShell
    titleId="work-location-day-dialog-title"
    icon={Home}
    title="Arbeitsort für einen Tag erfassen"
    description={formatDate(dateValue, locale, dateFormat)}
    onClose={onClose}
    onSubmit={submit}
    size="md"
    footer={<>
      {day && <button type="button" onClick={() => void removeDay()} disabled={busy || loading || loadingError || !canWrite} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"><Trash2 className="h-4 w-4" />Entfernen</button>}
      <button type="button" onClick={onClose} disabled={busy} className="min-h-11 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Abbrechen</button>
      <button type="submit" disabled={busy || loading || loadingError || !canWrite || isFutureDay} className="btn-primary min-h-11 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Speichern …' : day ? 'Änderung speichern' : 'Tag erfassen'}</button>
    </>}
  >
    {error && <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {!canWrite && <p role="status" className="mb-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">Du kannst diese Erfassung ansehen, aber nicht ändern.</p>}
    {loading && <p role="status" className="mb-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">Tagesaufzeichnung wird geladen …</p>}
    {loadingError && <p role="alert" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Die gespeicherte Tagesaufzeichnung konnte nicht geladen werden. Schließe den Dialog und lade den Kalender erneut, bevor du Änderungen vornimmst.</p>}
    {isFutureDay && <p role="status" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Ein zukünftiger Tag kann erst nach der tatsächlichen Tätigkeit erfasst werden.</p>}
    <div className="space-y-3">
      <p className="text-sm leading-5 text-gray-600">Der Ort eines Unterrichts- oder Arbeitstermins wird nicht übernommen. Auch Vorbereitung und andere Arbeit zu Hause können hier für einen bereits geleisteten Tag erfasst werden.</p>
      <fieldset className="space-y-2" disabled={!canWrite || loading || loadingError || isFutureDay || busy}>
        <legend className="mb-2 text-sm font-semibold text-gray-900">Welche Arbeitssituation trifft auf diesen Tag zu?</legend>
        {WORK_LOCATION_DAY_TYPES.map(option => (
          <label key={option.value} className={`block cursor-pointer rounded-lg border p-3 ${dayType === option.value ? 'border-primary-custom bg-primary-light-custom' : 'border-gray-200 bg-white'}`}>
            <span className="flex items-start gap-3">
              <input type="radio" name="work-location-day-type" value={option.value} checked={dayType === option.value} onChange={() => { setDayType(option.value); setReviewed(false); }} className="mt-1 h-4 w-4 accent-primary-custom" />
              <span><span className="block text-sm font-medium text-gray-900">{option.label}</span><span className="mt-1 block text-xs leading-5 text-gray-600">{option.description}</span></span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs leading-5 text-gray-700">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary-custom" />
        <p>Diese Erfassung beschreibt nur die Arbeitssituation. Ob und in welcher Höhe ein steuerlicher Ansatz möglich ist, welche Ausschlüsse gelten und wohin er gehört, hängt von Steuerjahr und Einzelfall ab und wird von SoloOffice nicht geprüft.</p>
      </div>
      <label className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-950">
        <input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} disabled={!canWrite || loading || loadingError || isFutureDay || busy} className="mt-1 h-4 w-4 accent-primary-custom" />
        <span>Ich habe die tatsächliche Arbeitssituation für diesen Tag korrekt erfasst. Die Erfassung ist meine eigene Aufzeichnung.</span>
      </label>
    </div>
  </DialogShell>;
}
