import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Eye, Loader2, Send } from 'lucide-react';
import { apiService } from '../services/api';
import { isDemoMode } from '../services/demoApi';
import { useCompany } from '../context/CompanyContext';
import { useFeedback } from '../context/FeedbackContext';
import { getTerminology } from '../utils/terminology';
import { formatDate } from '../utils/formatters';
import type { NotificationPreview, NotificationSettings, NotificationSettingsPayload } from '../types';

const DEFAULT_FORM: NotificationSettingsPayload = { jobsCompleted: false, invoiceDrafts: false, invoiceDraftDays: 3, invoicesOverdue: false, digestHour: 8 };

function toPayload(settings: NotificationSettings): NotificationSettingsPayload {
  return { jobsCompleted: settings.jobsCompleted, invoiceDrafts: settings.invoiceDrafts, invoiceDraftDays: settings.invoiceDraftDays, invoicesOverdue: settings.invoicesOverdue, digestHour: settings.digestHour };
}

/**
 * E-Mail-Benachrichtigungen des angemeldeten Benutzers für den aktiven
 * Arbeitsbereich: eine tägliche Zusammenfassung offener Punkte. Gespeichert
 * wird je Benutzer und Workspace (Backend: /api/notification-settings).
 */
export function NotificationSettingsPanel() {
  const { company } = useCompany();
  const { notify } = useFeedback();
  const terminology = getTerminology(company.terminologyProfile);
  const locale = company.locale || 'de-DE';
  const [saved, setSaved] = useState<NotificationSettings | null>(null);
  const [form, setForm] = useState<NotificationSettingsPayload>(DEFAULT_FORM);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<'save' | 'preview' | 'send' | null>(null);
  const [preview, setPreview] = useState<NotificationPreview | null>(null);

  useEffect(() => {
    let active = true;
    apiService.getNotificationSettings()
      .then(result => {
        if (!active) return;
        setSaved(result.settings);
        setForm(toPayload(result.settings));
      })
      .catch(error => { if (active) setLoadError(error instanceof Error ? error.message : 'Die Einstellungen konnten nicht geladen werden.'); });
    return () => { active = false; };
  }, []);

  const dirty = useMemo(() => saved ? JSON.stringify(toPayload(saved)) !== JSON.stringify(form) : false, [saved, form]);
  const anyActive = form.jobsCompleted || form.invoiceDrafts || form.invoicesOverdue;
  const timeZone = company.timeZone || 'Europe/Berlin';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy('save');
    try {
      const result = await apiService.updateNotificationSettings(form);
      setSaved(result.settings);
      setForm(toPayload(result.settings));
      notify({ variant: 'success', message: anyActive ? `Benachrichtigungen gespeichert. Die Zusammenfassung kommt täglich ab ${String(form.digestHour).padStart(2, '0')}:00 Uhr an ${result.email}.` : 'Benachrichtigungen gespeichert – es werden keine E-Mails gesendet.' });
    } catch (error) {
      notify({ variant: 'error', message: error instanceof Error ? error.message : 'Die Einstellungen konnten nicht gespeichert werden.' });
    } finally {
      setBusy(null);
    }
  };

  const loadPreview = async () => {
    setBusy('preview');
    try {
      setPreview(await apiService.getNotificationPreview());
    } catch (error) {
      notify({ variant: 'error', message: error instanceof Error ? error.message : 'Die Vorschau konnte nicht geladen werden.' });
    } finally {
      setBusy(null);
    }
  };

  const sendNow = async () => {
    setBusy('send');
    try {
      const result = await apiService.sendNotificationDigestNow();
      notify({ variant: result.sent ? 'success' : 'info', message: result.message });
    } catch (error) {
      notify({ variant: 'error', message: error instanceof Error ? error.message : 'Die E-Mail konnte nicht gesendet werden.' });
    } finally {
      setBusy(null);
    }
  };

  const hourOptions = Array.from({ length: 24 }, (_, hour) => hour);

  return (
    <div>
      {loadError && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</div>}

      <form onSubmit={submit} className="form-consistent-fields space-y-4">
        <div className="space-y-2">
          {company.jobTrackingEnabled && (
            <label className="flex items-start gap-3 text-sm text-gray-800">
              <input type="checkbox" checked={form.jobsCompleted} onChange={event => setForm({ ...form, jobsCompleted: event.target.checked })} className="custom-checkbox mt-0.5 shrink-0" />
              <span>
                <span className="font-medium">Abgeschlossene {terminology.work.plural} ohne Rechnung</span>
                <span className="block text-xs text-gray-500">Erinnert, sobald {terminology.work.plural} auf „Abgeschlossen“ stehen und die Rechnung erstellt werden kann.</span>
              </span>
            </label>
          )}
          <label className="flex items-start gap-3 text-sm text-gray-800">
            <input type="checkbox" checked={form.invoiceDrafts} onChange={event => setForm({ ...form, invoiceDrafts: event.target.checked })} className="custom-checkbox mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="font-medium">Rechnungsentwürfe, die nicht versendet wurden</span>
              <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                Erinnert an Entwürfe, die seit
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={form.invoiceDraftDays}
                  disabled={!form.invoiceDrafts}
                  onChange={event => setForm({ ...form, invoiceDraftDays: Math.min(60, Math.max(1, Number(event.target.value) || 1)) })}
                  className="form-input form-input-compact w-16 text-center"
                  aria-label="Wartezeit in Tagen"
                />
                {form.invoiceDraftDays === 1 ? 'Tag' : 'Tagen'} als Entwurf gespeichert sind.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm text-gray-800">
            <input type="checkbox" checked={form.invoicesOverdue} onChange={event => setForm({ ...form, invoicesOverdue: event.target.checked })} className="custom-checkbox mt-0.5 shrink-0" />
            <span>
              <span className="font-medium">Überfällige Rechnungen</span>
              <span className="block text-xs text-gray-500">Rechnungen, deren Zahlungsziel überschritten ist.</span>
            </span>
          </label>
        </div>

        <label className="block text-sm text-gray-700">
          Uhrzeit der Zusammenfassung
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <select value={form.digestHour} onChange={event => setForm({ ...form, digestHour: Number(event.target.value) })} className="form-input form-input-compact w-36" disabled={!anyActive}>
              {hourOptions.map(hour => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00 Uhr</option>)}
            </select>
            <span className="text-xs text-gray-500">Zeitzone {timeZone} · höchstens eine E-Mail pro Tag.</span>
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={busy !== null || !dirty} className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50">
            {busy === 'save' ? 'Speichert…' : 'Benachrichtigungen speichern'}
          </button>
          <button type="button" onClick={() => { void loadPreview(); }} disabled={busy !== null} className="btn-secondary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50">
            {busy === 'preview' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}Vorschau
          </button>
          <button type="button" onClick={() => { void sendNow(); }} disabled={busy !== null || dirty || !saved || !(saved.jobsCompleted || saved.invoiceDrafts || saved.invoicesOverdue)} title={dirty ? 'Zuerst speichern' : undefined} className="btn-secondary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50">
            {busy === 'send' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Jetzt senden
          </button>
        </div>

        {saved && (saved.lastDigestAt || saved.lastDigestError) && (
          <p className="text-xs text-gray-500">
            {saved.lastDigestAt ? `Zuletzt gesendet am ${formatDate(saved.lastDigestAt, locale)}.` : ''}
            {saved.lastDigestError ? <span className="text-red-700"> Letzter Versuch fehlgeschlagen: {saved.lastDigestError}</span> : null}
          </p>
        )}
        {isDemoMode && <p className="text-xs text-gray-500">Im Demo-Modus werden keine E-Mails versendet; die Vorschau zeigt, was in der Zusammenfassung stünde.</p>}
      </form>

      {preview && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900">Vorschau: {preview.total === 0 ? 'nichts offen' : `${preview.total} ${preview.total === 1 ? 'offener Punkt' : 'offene Punkte'}`}</h3>
            <button type="button" onClick={() => setPreview(null)} className="text-xs text-gray-500 hover:underline">Schließen</button>
          </div>
          {preview.sections.length === 0 ? (
            <p className="text-sm text-gray-600">Für die aktivierten Hinweise gibt es derzeit nichts zu melden – es würde keine E-Mail gesendet.</p>
          ) : (
            <div className="space-y-3">
              {preview.sections.map(section => (
                <div key={section.key}>
                  <p className="text-sm font-medium text-gray-800">{section.title} <span className="text-gray-500">({section.count})</span></p>
                  <ul className="mt-1 space-y-1">
                    {section.items.map((item, index) => (
                      <li key={`${section.key}-${index}`} className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="min-w-0"><span className="text-gray-900">{item.title}</span>{item.subtitle && <span className="block truncate text-xs text-gray-500">{item.subtitle}</span>}</span>
                        {item.meta && <span className="shrink-0 text-xs text-gray-700">{item.meta}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
