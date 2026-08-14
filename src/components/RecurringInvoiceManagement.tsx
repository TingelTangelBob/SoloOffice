import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Edit,
  FilePlus2,
  History,
  Pause,
  Play,
  Plus,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { useCustomers } from '../context/CustomerContext';
import { useCompany } from '../context/CompanyContext';
import { apiService } from '../services/api';
import { formatCurrency, formatDate } from '../utils/formatters';
import { PageHeader } from './PageHeader';
import type {
  RecurringInvoice,
  RecurringInvoiceIntervalUnit,
  RecurringInvoicePayload,
  RecurringInvoiceRun,
} from '../types';
import { LocalizedNumberInput } from './LocalizedNumberInput';
import { getTerminology } from '../utils/terminology';
import { DialogShell } from './DialogShell';
import { useFeedback } from '../context/FeedbackContext';

type ItemDraft = {
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
};

type FormDraft = {
  name: string;
  customerId: string;
  frequency: string;
  customInterval: string;
  customUnit: RecurringInvoiceIntervalUnit;
  startDate: string;
  nextRunDate: string;
  endDate: string;
  paymentTerms: string;
  notes: string;
  items: ItemDraft[];
};

const emptyItem = (): ItemDraft => ({
  description: '',
  quantity: '1',
  unitPrice: '0',
  taxRate: '19',
});

const emptyForm = (): FormDraft => {
  const today = new Date().toISOString().slice(0, 10);
  return {
    name: '',
    customerId: '',
    frequency: 'monthly',
    customInterval: '1',
    customUnit: 'month',
    startDate: today,
    nextRunDate: today,
    endDate: '',
    paymentTerms: '14',
    notes: '',
    items: [emptyItem()],
  };
};

const statusLabels: Record<string, string> = {
  active: 'Aktiv',
  paused: 'Pausiert',
  ended: 'Beendet',
};

const frequencyLabels: Record<string, string> = {
  monthly: 'Monatlich',
  quarterly: 'Vierteljährlich',
  semiannual: 'Halbjährlich',
  annual: 'Jährlich',
};

const intervalUnitLabels: Record<RecurringInvoiceIntervalUnit, string> = {
  day: 'Tage',
  week: 'Wochen',
  month: 'Monate',
  year: 'Jahre',
};

const runStatusLabels: Record<string, string> = {
  success: 'Erfolgreich',
  failed: 'Fehlgeschlagen',
};

const fieldLabelClassName = 'block min-w-0 text-sm font-medium text-gray-700';
const controlClassName = 'mt-1.5 block min-h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm transition focus:border-primary-custom focus:outline-none focus:ring-2 focus:ring-primary-custom/20 disabled:cursor-not-allowed disabled:bg-gray-100';
const textAreaClassName = `${controlClassName} min-h-24 resize-y`;

export function RecurringInvoiceManagement() {
  const { confirm } = useFeedback();
  const { customers } = useCustomers();
  const { company } = useCompany();
  const terminology = getTerminology(company?.terminologyProfile);
  const [entries, setEntries] = useState<RecurringInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState<{ open: boolean; entry?: RecurringInvoice }>({ open: false });
  const [form, setForm] = useState<FormDraft>(emptyForm());
  const [busy, setBusy] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, RecurringInvoiceRun[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const locale = company?.locale || 'de-DE';

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setEntries(await apiService.getRecurringInvoices());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Wiederkehrende Rechnungen konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openNew = () => {
    setError('');
    setForm(emptyForm());
    setDialog({ open: true });
  };

  const openEdit = (entry: RecurringInvoice) => {
    const source = entry as RecurringInvoice & { items?: ItemDraft[]; paymentTerms?: number | string };
    setError('');
    setForm({
      name: source.name || '',
      customerId: source.customerId || '',
      frequency: source.frequency || 'monthly',
      customInterval: String(source.intervalValue || '1'),
      customUnit: source.intervalUnit || 'month',
      startDate: String(source.startDate || '').slice(0, 10),
      nextRunDate: String(source.nextRunDate || source.startDate || '').slice(0, 10),
      endDate: source.endDate ? String(source.endDate).slice(0, 10) : '',
      paymentTerms: String(source.dueDays || '14'),
      notes: source.notes || '',
      items: (source.items || [emptyItem()]).map(item => ({
        description: String(item.description || ''),
        quantity: String(item.quantity || '1'),
        unitPrice: String(item.unitPrice || '0'),
        taxRate: String(item.taxRate || '19'),
      })),
    });
    setDialog({ open: true, entry });
  };

  const updateItem = (index: number, changes: Partial<ItemDraft>) => {
    setForm(current => ({
      ...current,
      items: current.items.map((item, itemIndex) => (
        itemIndex === index ? { ...item, ...changes } : item
      )),
    }));
  };

  const addItem = () => {
    setForm(current => ({ ...current, items: [...current.items, emptyItem()] }));
  };

  const removeItem = (index: number) => {
    setForm(current => ({
      ...current,
      items: current.items.filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const hasInvalidItem = form.items.length === 0 || form.items.some(item => (
      !item.description.trim()
      || !Number.isFinite(Number(item.quantity))
      || Number(item.quantity) <= 0
      || !Number.isFinite(Number(item.unitPrice))
      || Number(item.unitPrice) < 0
      || !Number.isFinite(Number(item.taxRate))
      || Number(item.taxRate) < 0
    ));
    const invalidDates = !form.startDate
      || !form.nextRunDate
      || (Boolean(form.endDate) && form.endDate < form.startDate)
      || form.nextRunDate < form.startDate;
    const invalidSchedule = form.frequency === 'custom'
      && (!Number.isInteger(Number(form.customInterval)) || Number(form.customInterval) <= 0);

    if (
      !form.customerId
      || !form.name.trim()
      || hasInvalidItem
      || invalidDates
      || invalidSchedule
      || !Number.isInteger(Number(form.paymentTerms))
      || Number(form.paymentTerms) < 0
    ) {
      setError('Bitte prüfen Sie Name, Positionen, Datumsangaben, Zahlungsziel und Intervall.');
      return;
    }

    const payload = {
      name: form.name,
      customerId: form.customerId,
      frequency: form.frequency as RecurringInvoice['frequency'],
      ...(form.frequency === 'custom'
        ? { intervalValue: Number(form.customInterval), intervalUnit: form.customUnit }
        : {}),
      startDate: form.startDate,
      nextRunDate: form.nextRunDate,
      endDate: form.endDate || undefined,
      dueDays: Number(form.paymentTerms),
      notes: form.notes,
      // Always send a value copy so later template edits cannot alter generated invoice snapshots.
      items: form.items.map((item, index) => ({
        description: item.description,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        taxRate: Number(item.taxRate),
        order: index,
      })),
    } satisfies RecurringInvoicePayload;

    setBusy('save');
    try {
      const result = dialog.entry
        ? await apiService.updateRecurringInvoice(dialog.entry.id, payload)
        : await apiService.createRecurringInvoice(payload);
      setEntries(current => dialog.entry
        ? current.map(item => item.id === dialog.entry?.id ? result : item)
        : [result, ...current]);
      setDialog({ open: false });
      setNotice(dialog.entry ? 'Vorlage gespeichert.' : 'Wiederkehrende Rechnung angelegt.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(null);
    }
  };

  const updateStatus = async (entry: RecurringInvoice, status: 'active' | 'paused' | 'ended') => {
    setBusy(entry.id);
    try {
      const updated = await apiService.updateRecurringInvoice(entry.id, { status });
      setEntries(items => items.map(item => item.id === entry.id ? updated : item));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Status konnte nicht geändert werden.');
    } finally {
      setBusy(null);
    }
  };

  const generate = async (entry: RecurringInvoice) => {
    setBusy(`generate-${entry.id}`);
    try {
      await apiService.generateRecurringInvoice(entry.id);
      setNotice('Eine Entwurfsrechnung wurde erstellt.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Entwurfsrechnung konnte nicht erstellt werden.');
    } finally {
      setBusy(null);
    }
  };

  const toggleRuns = async (entry: RecurringInvoice) => {
    if (expanded === entry.id) {
      setExpanded(null);
      return;
    }

    setExpanded(entry.id);
    setBusy(`runs-${entry.id}`);
    try {
      const entryRuns = await apiService.getRecurringInvoiceRuns(entry.id);
      setRuns(current => ({ ...current, [entry.id]: entryRuns }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Laufprotokoll konnte nicht geladen werden.');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (entry: RecurringInvoice) => {
    const confirmed = await confirm({
      title: 'Wiederkehrende Rechnung löschen',
      message: `„${entry.name}“ wirklich löschen? Bereits erzeugte Rechnungen bleiben erhalten.`,
      confirmText: 'Löschen',
      isDestructive: true,
    });
    if (!confirmed) return;
    setBusy(entry.id);
    try {
      await apiService.deleteRecurringInvoice(entry.id);
      setEntries(items => items.filter(item => item.id !== entry.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Löschen fehlgeschlagen.');
    } finally {
      setBusy(null);
    }
  };

  const customerName = (id: string) => (
    customers.find(customer => customer.id === id)?.name
    || `Unbekannter ${terminology.entity.singular}`
  );
  const total = (entry: RecurringInvoice) => entry.items.reduce(
    (sum, item) => sum + Number(item.quantity) * Number(item.unitPrice) * (1 + Number(item.taxRate) / 100),
    0,
  );
  const itemTotal = (item: ItemDraft) => (
    Number(item.quantity || 0) * Number(item.unitPrice || 0) * (1 + Number(item.taxRate || 0) / 100)
  );
  const frequency = (entry: RecurringInvoice) => frequencyLabels[entry.frequency]
    || `Alle ${entry.intervalValue} ${intervalUnitLabels[entry.intervalUnit] || 'Perioden'}`;
  const ordered = useMemo(
    () => [...entries].sort((a, b) => String(a.nextRunDate || '').localeCompare(String(b.nextRunDate || ''))),
    [entries],
  );
  const draftTotal = form.items.reduce((sum, item) => sum + itemTotal(item), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={CalendarClock}
        title="Wiederkehrende Rechnungen"
        subtitle="Vorlagen planen und zum nächsten Termin als Entwurf erzeugen."
      >
        <button
          type="button"
          onClick={openNew}
          className="btn-primary inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-xl px-3 text-white transition-all duration-300 hover:scale-105 hover:brightness-90 sm:min-w-0 sm:px-4"
          aria-label="Wiederkehrende Rechnung anlegen"
          title="Wiederkehrende Rechnung anlegen"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Neu</span>
        </button>
      </PageHeader>

      {notice && (
        <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} aria-label="Hinweis ausblenden">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} aria-label="Fehler ausblenden">
            <XCircle className="h-4 w-4" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="rounded-lg bg-white p-10 text-center text-gray-500">
          Wiederkehrende Rechnungen werden geladen …
        </div>
      ) : ordered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center">
          <CalendarClock className="mx-auto mb-3 h-10 w-10 text-gray-400" />
          <p className="font-medium text-gray-700">Noch keine Vorlagen</p>
          <p className="mt-1 text-sm text-gray-500">Legen Sie Ihre erste wiederkehrende Rechnung an.</p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {ordered.map(entry => (
            <article key={entry.id} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate font-semibold text-gray-900">{entry.name}</h2>
                  <p className="mt-1 truncate text-sm text-gray-600">{customerName(entry.customerId)}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${entry.status === 'active' ? 'bg-green-100 text-green-700' : entry.status === 'paused' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                  {statusLabels[entry.status] || entry.status}
                </span>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-gray-500">Intervall</dt>
                  <dd className="font-medium">{frequency(entry)}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Nächste Ausführung</dt>
                  <dd className="font-medium">{entry.nextRunDate ? formatDate(entry.nextRunDate, locale, company?.dateFormat) : '–'}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Voraussichtlicher Betrag</dt>
                  <dd className="font-medium">{formatCurrency(total(entry), locale, company?.numberFormat, company?.currency)}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Start</dt>
                  <dd className="font-medium">{formatDate(entry.startDate, locale, company?.dateFormat)}</dd>
                </div>
              </dl>

              <div className="mt-5 flex flex-wrap gap-2 border-t border-gray-100 pt-4">
                <button type="button" onClick={() => openEdit(entry)} className="action-button">
                  <Edit className="h-4 w-4" />Bearbeiten
                </button>
                {entry.status === 'active' ? (
                  <button type="button" onClick={() => void updateStatus(entry, 'paused')} className="action-button" disabled={busy === entry.id}>
                    <Pause className="h-4 w-4" />Pausieren
                  </button>
                ) : entry.status === 'paused' ? (
                  <button type="button" onClick={() => void updateStatus(entry, 'active')} className="action-button" disabled={busy === entry.id}>
                    <Play className="h-4 w-4" />Fortsetzen
                  </button>
                ) : null}
                {entry.status !== 'ended' && (
                  <>
                    <button type="button" onClick={() => void generate(entry)} className="action-button text-primary-custom" disabled={busy === `generate-${entry.id}`}>
                      <FilePlus2 className="h-4 w-4" />Jetzt erzeugen
                    </button>
                    <button type="button" onClick={() => void updateStatus(entry, 'ended')} className="action-button text-red-600">
                      <XCircle className="h-4 w-4" />Beenden
                    </button>
                  </>
                )}
                <button type="button" onClick={() => void toggleRuns(entry)} className="action-button">
                  <History className="h-4 w-4" />
                  Laufprotokoll
                  {expanded === entry.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                <button type="button" onClick={() => void remove(entry)} className="action-button ml-auto text-red-600">
                  <Trash2 className="h-4 w-4" />Löschen
                </button>
              </div>

              {expanded === entry.id && (
                <div className="mt-4 rounded-md bg-gray-50 p-3 text-sm">
                  {busy === `runs-${entry.id}` ? 'Laufprotokoll wird geladen …' : (runs[entry.id] || []).length === 0 ? 'Noch keine Läufe protokolliert.' : runs[entry.id].map(run => (
                    <div key={run.id} className="space-y-1 border-b border-gray-200 py-2 last:border-0">
                      <div className="flex justify-between">
                        <span>{formatDate(run.scheduledDate, locale, company?.dateFormat)}</span>
                        <span className={run.status === 'success' ? 'text-green-700' : 'text-red-700'}>{runStatusLabels[run.status] || run.status}</span>
                      </div>
                      {run.invoiceNumber && <span className="text-gray-600">{run.invoiceNumber}</span>}
                      {run.errorMessage && <p className="text-red-700">{run.errorMessage}</p>}
                    </div>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {dialog.open && (
        <DialogShell
          titleId="recurring-invoice-dialog-title"
          icon={CalendarClock}
          title={dialog.entry ? 'Vorlage bearbeiten' : 'Wiederkehrende Rechnung anlegen'}
          description="Definieren Sie Kunde, Zeitplan und Positionen für die automatisch erzeugten Entwürfe."
          onClose={() => setDialog({ open: false })}
          onSubmit={submit}
          size="xl"
          zIndexClassName="z-[1000]"
          footer={(
            <>
              <button type="button" onClick={() => setDialog({ open: false })} className="inline-flex min-h-12 items-center justify-center rounded-lg border border-gray-300 bg-white px-8 py-2 text-base font-medium text-gray-700 transition hover:bg-gray-50">Abbrechen</button>
              <button type="submit" disabled={busy === 'save'} className="btn-primary inline-flex min-h-12 items-center justify-center rounded-lg px-8 py-2 text-base font-semibold text-white transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-60">{busy === 'save' ? 'Speichern …' : 'Speichern'}</button>
            </>
          )}
        >
              <div className="space-y-5 sm:space-y-6">
                <section className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6" aria-labelledby="recurring-master-data-title">
                  <div className="mb-3">
                    <h3 id="recurring-master-data-title" className="text-base font-semibold text-gray-900">Stammdaten</h3>
                    <p className="mt-1 text-sm text-gray-500">Name und Kunde der wiederkehrenden Rechnung.</p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className={fieldLabelClassName}>
                      Name <span className="text-red-600">*</span>
                      <input
                        required
                        value={form.name}
                        onChange={event => setForm(current => ({ ...current, name: event.target.value }))}
                        className={controlClassName}
                        placeholder="z. B. Wartungsvertrag"
                      />
                    </label>
                    <label className={fieldLabelClassName}>
                      {terminology.entity.singular} <span className="text-red-600">*</span>
                      <select
                        required
                        value={form.customerId}
                        onChange={event => setForm(current => ({ ...current, customerId: event.target.value }))}
                        className={`${controlClassName} appearance-auto`}
                      >
                        <option value="">Bitte wählen</option>
                        {customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
                      </select>
                    </label>
                  </div>
                </section>

                <section className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6" aria-labelledby="recurring-schedule-title">
                  <div className="mb-3">
                    <h3 id="recurring-schedule-title" className="text-base font-semibold text-gray-900">Zeitplan</h3>
                    <p className="mt-1 text-sm text-gray-500">Legen Sie fest, wann die nächste Rechnung und die folgenden Entwürfe entstehen.</p>
                  </div>
                  <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className={fieldLabelClassName}>
                        Frequenz
                        <select
                          value={form.frequency}
                          onChange={event => setForm(current => ({ ...current, frequency: event.target.value }))}
                          className={`${controlClassName} appearance-auto`}
                        >
                          <option value="monthly">Monatlich</option>
                          <option value="quarterly">Vierteljährlich</option>
                          <option value="semiannual">Halbjährlich</option>
                          <option value="annual">Jährlich</option>
                          <option value="custom">Benutzerdefiniert</option>
                        </select>
                      </label>
                      {form.frequency === 'custom' ? (
                        <div className="grid grid-cols-2 gap-3">
                          <label className={fieldLabelClassName}>
                            Intervall
                            <input
                              required
                              type="number"
                              min="1"
                              value={form.customInterval}
                              onChange={event => setForm(current => ({ ...current, customInterval: event.target.value }))}
                              className={controlClassName}
                            />
                          </label>
                          <label className={fieldLabelClassName}>
                            Einheit
                            <select
                              required
                              value={form.customUnit}
                              onChange={event => setForm(current => ({ ...current, customUnit: event.target.value as RecurringInvoiceIntervalUnit }))}
                              className={`${controlClassName} appearance-auto`}
                            >
                              <option value="day">Tage</option>
                              <option value="week">Wochen</option>
                              <option value="month">Monate</option>
                              <option value="year">Jahre</option>
                            </select>
                          </label>
                        </div>
                      ) : (
                        <div className="hidden md:block" aria-hidden="true" />
                      )}
                    </div>

                    <div className="grid gap-4 sm:grid-cols-3">
                      <label className={fieldLabelClassName}>
                        Startdatum <span className="text-red-600">*</span>
                        <input
                          type="date"
                          required
                          value={form.startDate}
                          onChange={event => setForm(current => ({ ...current, startDate: event.target.value }))}
                          className={controlClassName}
                        />
                      </label>
                      <label className={fieldLabelClassName}>
                        Erste Ausführung <span className="text-red-600">*</span>
                        <input
                          type="date"
                          required
                          min={form.startDate}
                          value={form.nextRunDate}
                          onChange={event => setForm(current => ({ ...current, nextRunDate: event.target.value }))}
                          className={controlClassName}
                        />
                      </label>
                      <label className={fieldLabelClassName}>
                        Enddatum <span className="font-normal text-gray-400">(optional)</span>
                        <input
                          type="date"
                          min={form.nextRunDate}
                          value={form.endDate}
                          onChange={event => setForm(current => ({ ...current, endDate: event.target.value }))}
                          className={controlClassName}
                        />
                      </label>
                    </div>
                  </div>
                </section>

                <section className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6" aria-labelledby="recurring-details-title">
                  <div className="mb-3">
                    <h3 id="recurring-details-title" className="text-base font-semibold text-gray-900">Zahlung und Notizen</h3>
                    <p className="mt-1 text-sm text-gray-500">Diese Angaben werden in die erzeugten Rechnungsentwürfe übernommen.</p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-3">
                    <label className={fieldLabelClassName}>
                      Zahlungsziel (Tage) <span className="text-red-600">*</span>
                      <input
                        required
                        type="number"
                        min="0"
                        value={form.paymentTerms}
                        onChange={event => setForm(current => ({ ...current, paymentTerms: event.target.value }))}
                        className={controlClassName}
                      />
                    </label>
                    <label className={`${fieldLabelClassName} md:col-span-2`}>
                      Notizen <span className="font-normal text-gray-400">(optional)</span>
                      <textarea
                        value={form.notes}
                        onChange={event => setForm(current => ({ ...current, notes: event.target.value }))}
                        className={textAreaClassName}
                        rows={3}
                        placeholder="z. B. Leistungszeitraum oder interne Hinweise"
                      />
                    </label>
                  </div>
                </section>

                <section className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6" aria-labelledby="recurring-items-title">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 id="recurring-items-title" className="text-base font-semibold text-gray-900">Positionen</h3>
                      <p className="mt-1 text-sm text-gray-500">Die Positionen werden bei jeder Ausführung in den Entwurf übernommen.</p>
                    </div>
                    <button
                      type="button"
                      onClick={addItem}
                      className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-primary-custom px-3 py-2 text-sm font-medium text-primary-custom transition hover:bg-primary-light"
                    >
                      <Plus className="h-4 w-4" />
                      Position hinzufügen
                    </button>
                  </div>

                  <div className="space-y-3">
                    {form.items.map((item, index) => (
                      <div key={index} className="rounded-xl border border-gray-200 bg-gray-50/60 p-3 shadow-sm sm:p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-light text-sm font-semibold text-primary-custom">
                              {index + 1}
                            </span>
                            <span className="text-sm font-semibold text-gray-900">Position {index + 1}</span>
                          </div>
                          {form.items.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeItem(index)}
                              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-red-600 transition hover:bg-red-50"
                              aria-label={`Position ${index + 1} entfernen`}
                            >
                              <Trash2 className="h-4 w-4" />
                              Entfernen
                            </button>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-3 min-[480px]:grid-cols-4">
                          <label className={`${fieldLabelClassName} col-span-2 min-[480px]:col-span-4`}>
                            Beschreibung <span className="text-red-600">*</span>
                            <input
                              required
                              value={item.description}
                              onChange={event => updateItem(index, { description: event.target.value })}
                              className={controlClassName}
                              placeholder="z. B. Support-Paket"
                            />
                          </label>
                          <label className={`${fieldLabelClassName} col-span-1 min-[480px]:col-span-1`}>
                            Menge <span className="text-red-600">*</span>
                            <LocalizedNumberInput
                              required
                              min="0.01"
                              step="0.01"
                              value={item.quantity}
                              locale={locale}
                              numberFormat={company?.numberFormat}
                              onValueChange={value => updateItem(index, { quantity: value === '' ? '' : String(value) })}
                              className={controlClassName}
                            />
                          </label>
                          <label className={`${fieldLabelClassName} col-span-1 min-[480px]:col-span-1`}>
                            Einzelpreis (€) <span className="text-red-600">*</span>
                            <LocalizedNumberInput
                              required
                              min="0"
                              step="0.01"
                              value={item.unitPrice}
                              locale={locale}
                              numberFormat={company?.numberFormat}
                              onValueChange={value => updateItem(index, { unitPrice: value === '' ? '' : String(value) })}
                              className={controlClassName}
                            />
                          </label>
                          <label className={`${fieldLabelClassName} col-span-1 min-[480px]:col-span-1`}>
                            MwSt. (%) <span className="text-red-600">*</span>
                            <LocalizedNumberInput
                              required
                              min="0"
                              step="0.01"
                              value={item.taxRate}
                              locale={locale}
                              numberFormat={company?.numberFormat}
                              onValueChange={value => updateItem(index, { taxRate: value === '' ? '' : String(value) })}
                              className={controlClassName}
                            />
                          </label>
                          <div className="col-span-1 min-w-0">
                            <span className="block text-sm font-medium text-gray-700">Gesamt</span>
                            <div className="mt-1.5 flex min-h-10 items-center overflow-hidden rounded-lg border border-gray-200 bg-white px-2 text-xs font-semibold text-gray-900 sm:px-3 sm:text-sm">
                              {formatCurrency(itemTotal(item), locale, company?.numberFormat, company?.currency)}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-blue-50 px-4 py-3 text-sm">
                    <span className="font-medium text-blue-900">Voraussichtlicher Gesamtbetrag inkl. MwSt.</span>
                    <span className="text-base font-semibold text-blue-950">{formatCurrency(draftTotal, locale, company?.numberFormat, company?.currency)}</span>
                  </div>
                </section>
              </div>
        </DialogShell>
      )}
    </div>
  );
}
