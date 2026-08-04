import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock, ChevronDown, ChevronUp, Edit, FilePlus2,
  History, Pause, Play, Plus, Trash2, X, XCircle
} from 'lucide-react';
import { useCustomers } from '../context/CustomerContext';
import { useCompany } from '../context/CompanyContext';
import { apiService } from '../services/api';
import { formatCurrency, formatDate } from '../utils/formatters';
import { PageHeader } from './PageHeader';
import type { RecurringInvoice, RecurringInvoiceIntervalUnit, RecurringInvoiceRun, RecurringInvoicePayload } from '../types';
import { LocalizedNumberInput } from './LocalizedNumberInput';
import { getTerminology } from '../utils/terminology';

type ItemDraft = { description: string; quantity: string; unitPrice: string; taxRate: string };
type FormDraft = {
  name: string; customerId: string; frequency: string; customInterval: string; customUnit: RecurringInvoiceIntervalUnit;
  startDate: string; nextRunDate: string; endDate: string; paymentTerms: string; notes: string; items: ItemDraft[];
};

const emptyItem = (): ItemDraft => ({ description: '', quantity: '1', unitPrice: '0', taxRate: '19' });
const emptyForm = (): FormDraft => ({
  name: '', customerId: '', frequency: 'monthly', customInterval: '1', customUnit: 'month', startDate: new Date().toISOString().slice(0, 10), nextRunDate: new Date().toISOString().slice(0, 10),
  endDate: '', paymentTerms: '14', notes: '', items: [emptyItem()]
});

const statusLabels: Record<string, string> = { active: 'Aktiv', paused: 'Pausiert', ended: 'Beendet' };
const frequencyLabels: Record<string, string> = { monthly: 'Monatlich', quarterly: 'Vierteljährlich', semiannual: 'Halbjährlich', annual: 'Jährlich' };
const intervalUnitLabels: Record<RecurringInvoiceIntervalUnit, string> = { day: 'Tage', week: 'Wochen', month: 'Monate', year: 'Jahre' };
const runStatusLabels: Record<string, string> = { success: 'Erfolgreich', failed: 'Fehlgeschlagen' };

export function RecurringInvoiceManagement() {
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
    setLoading(true); setError('');
    try { setEntries(await apiService.getRecurringInvoices()); }
    catch (e) { setError(e instanceof Error ? e.message : 'Wiederkehrende Rechnungen konnten nicht geladen werden.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const openNew = () => { setForm(emptyForm()); setDialog({ open: true }); };
  const openEdit = (entry: RecurringInvoice) => {
    const source = entry as RecurringInvoice & { items?: ItemDraft[]; paymentTerms?: number | string };
    setForm({
      name: source.name || '', customerId: source.customerId || '', frequency: source.frequency || 'monthly',
      customInterval: String(source.intervalValue || '1'), startDate: String(source.startDate || '').slice(0, 10),
      customUnit: source.intervalUnit || 'month',
      nextRunDate: String(source.nextRunDate || source.startDate || '').slice(0, 10), endDate: source.endDate ? String(source.endDate).slice(0, 10) : '', paymentTerms: String(source.dueDays || '14'),
      notes: source.notes || '', items: (source.items || [emptyItem()]).map(item => ({
        description: String(item.description || ''), quantity: String(item.quantity || '1'), unitPrice: String(item.unitPrice || '0'), taxRate: String(item.taxRate || '19')
      }))
    });
    setDialog({ open: true, entry });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const hasInvalidItem = form.items.length === 0 || form.items.some(item => !item.description.trim() || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0 || !Number.isFinite(Number(item.unitPrice)) || Number(item.unitPrice) < 0 || !Number.isFinite(Number(item.taxRate)) || Number(item.taxRate) < 0);
    const invalidDates = !form.startDate || !form.nextRunDate || (form.endDate && form.endDate < form.startDate) || form.nextRunDate < form.startDate;
    const invalidSchedule = form.frequency === 'custom' && (!Number.isInteger(Number(form.customInterval)) || Number(form.customInterval) <= 0);
    if (!form.customerId || !form.name.trim() || hasInvalidItem || invalidDates || invalidSchedule || !Number.isInteger(Number(form.paymentTerms)) || Number(form.paymentTerms) < 0) {
      setError('Bitte prüfen Sie Name, Positionen, Datumsangaben, Zahlungsziel und Intervall.');
      return;
    }
    const payload = {
      name: form.name, customerId: form.customerId, frequency: form.frequency as RecurringInvoice['frequency'],
      ...(form.frequency === 'custom' ? { intervalValue: Number(form.customInterval), intervalUnit: form.customUnit } : {}),
      startDate: form.startDate, nextRunDate: form.nextRunDate, endDate: form.endDate || undefined, dueDays: Number(form.paymentTerms), notes: form.notes,
      // Always send a value copy so later template edits cannot alter generated invoice snapshots.
      items: form.items.map((item, index) => ({ description: item.description, quantity: Number(item.quantity), unitPrice: Number(item.unitPrice), taxRate: Number(item.taxRate), order: index }))
    } satisfies RecurringInvoicePayload;
    setBusy('save');
    try {
      const result = dialog.entry ? await apiService.updateRecurringInvoice(dialog.entry.id, payload) : await apiService.createRecurringInvoice(payload);
      setEntries(current => dialog.entry ? current.map(item => item.id === dialog.entry?.id ? result : item) : [result, ...current]);
      setDialog({ open: false }); setNotice(dialog.entry ? 'Vorlage gespeichert.' : 'Wiederkehrende Rechnung angelegt.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.'); }
    finally { setBusy(null); }
  };

  const updateStatus = async (entry: RecurringInvoice, status: 'active' | 'paused' | 'ended') => {
    setBusy(entry.id);
    try { const updated = await apiService.updateRecurringInvoice(entry.id, { status }); setEntries(items => items.map(item => item.id === entry.id ? updated : item)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Status konnte nicht geändert werden.'); }
    finally { setBusy(null); }
  };
  const generate = async (entry: RecurringInvoice) => {
    setBusy(`generate-${entry.id}`);
    try { await apiService.generateRecurringInvoice(entry.id); setNotice('Eine Entwurfsrechnung wurde erstellt.'); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Entwurfsrechnung konnte nicht erstellt werden.'); }
    finally { setBusy(null); }
  };
  const toggleRuns = async (entry: RecurringInvoice) => {
    if (expanded === entry.id) { setExpanded(null); return; }
    setExpanded(entry.id); setBusy(`runs-${entry.id}`);
    try {
      const entryRuns = await apiService.getRecurringInvoiceRuns(entry.id);
      setRuns(current => ({ ...current, [entry.id]: entryRuns }));
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Laufprotokoll konnte nicht geladen werden.'); }
    finally { setBusy(null); }
  };
  const remove = async (entry: RecurringInvoice) => {
    if (!window.confirm(`„${entry.name}“ wirklich löschen?`)) return;
    setBusy(entry.id); try { await apiService.deleteRecurringInvoice(entry.id); setEntries(items => items.filter(item => item.id !== entry.id)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Löschen fehlgeschlagen.'); } finally { setBusy(null); }
  };

  const customerName = (id: string) => customers.find(customer => customer.id === id)?.name || `Unbekannter ${terminology.entity.singular}`;
  const total = (entry: RecurringInvoice) => entry.items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitPrice) * (1 + Number(item.taxRate) / 100), 0);
  const frequency = (entry: RecurringInvoice) => frequencyLabels[entry.frequency] || `Alle ${entry.intervalValue} ${intervalUnitLabels[entry.intervalUnit] || 'Perioden'}`;
  const ordered = useMemo(() => [...entries].sort((a, b) => String(a.nextRunDate || '').localeCompare(String(b.nextRunDate || ''))), [entries]);

  return <div className="space-y-6">
    <PageHeader icon={CalendarClock} title="Wiederkehrende Rechnungen" subtitle="Vorlagen planen und zum nächsten Termin als Entwurf erzeugen.">
      <button onClick={openNew} className="btn-primary flex items-center justify-center space-x-2 rounded-xl px-4 py-2 text-white transition-all duration-300 hover:scale-105 hover:brightness-90"><Plus className="h-4 w-4" />Neu</button>
    </PageHeader>
    {notice && <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</div>}
    {error && <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><span>{error}</span><button onClick={() => setError('')}><XCircle className="h-4 w-4" /></button></div>}
    {loading ? <div className="rounded-lg bg-white p-10 text-center text-gray-500">Wiederkehrende Rechnungen werden geladen …</div> : ordered.length === 0 ? <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center"><CalendarClock className="mx-auto mb-3 h-10 w-10 text-gray-400" /><p className="font-medium text-gray-700">Noch keine Vorlagen</p><p className="mt-1 text-sm text-gray-500">Legen Sie Ihre erste wiederkehrende Rechnung an.</p></div> : <div className="grid gap-4 xl:grid-cols-2">
      {ordered.map(entry => <article key={entry.id} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold text-gray-900">{entry.name}</h2><p className="mt-1 text-sm text-gray-600">{customerName(entry.customerId)}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${entry.status === 'active' ? 'bg-green-100 text-green-700' : entry.status === 'paused' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>{statusLabels[entry.status] || entry.status}</span></div><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-gray-500">Intervall</dt><dd className="font-medium">{frequency(entry)}</dd></div><div><dt className="text-gray-500">Nächste Ausführung</dt><dd className="font-medium">{entry.nextRunDate ? formatDate(entry.nextRunDate, locale, company?.dateFormat) : '–'}</dd></div><div><dt className="text-gray-500">Voraussichtlicher Betrag</dt><dd className="font-medium">{formatCurrency(total(entry), locale, company?.numberFormat, company?.currency)}</dd></div><div><dt className="text-gray-500">Start</dt><dd className="font-medium">{formatDate(entry.startDate, locale, company?.dateFormat)}</dd></div></dl><div className="mt-5 flex flex-wrap gap-2 border-t border-gray-100 pt-4"><button onClick={() => openEdit(entry)} className="action-button"><Edit className="h-4 w-4" />Bearbeiten</button>{entry.status === 'active' ? <button onClick={() => void updateStatus(entry, 'paused')} className="action-button" disabled={busy === entry.id}><Pause className="h-4 w-4" />Pausieren</button> : entry.status === 'paused' ? <button onClick={() => void updateStatus(entry, 'active')} className="action-button" disabled={busy === entry.id}><Play className="h-4 w-4" />Fortsetzen</button> : null}{entry.status !== 'ended' && <><button onClick={() => void generate(entry)} className="action-button text-primary-custom" disabled={busy === `generate-${entry.id}`}><FilePlus2 className="h-4 w-4" />Jetzt erzeugen</button><button onClick={() => void updateStatus(entry, 'ended')} className="action-button text-red-600"><XCircle className="h-4 w-4" />Beenden</button></>}<button onClick={() => void toggleRuns(entry)} className="action-button"><History className="h-4 w-4" />Laufprotokoll {expanded === entry.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button><button onClick={() => void remove(entry)} className="ml-auto action-button text-red-600"><Trash2 className="h-4 w-4" />Löschen</button></div>{expanded === entry.id && <div className="mt-4 rounded-md bg-gray-50 p-3 text-sm">{busy === `runs-${entry.id}` ? 'Laufprotokoll wird geladen …' : (runs[entry.id] || []).length === 0 ? 'Noch keine Läufe protokolliert.' : runs[entry.id].map(run => <div key={run.id} className="space-y-1 border-b border-gray-200 py-2 last:border-0"><div className="flex justify-between"><span>{formatDate(run.scheduledDate, locale, company?.dateFormat)}</span><span className={run.status === 'success' ? 'text-green-700' : 'text-red-700'}>{runStatusLabels[run.status] || run.status}</span></div>{run.invoiceNumber && <span className="text-gray-600">{run.invoiceNumber}</span>}{run.errorMessage && <p className="text-red-700">{run.errorMessage}</p>}</div>)}</div>}</article>)}
    </div>}
    {dialog.open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><form onSubmit={submit} className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl"><div className="mb-5 flex items-center justify-between"><h2 className="text-xl font-semibold">{dialog.entry ? 'Vorlage bearbeiten' : 'Wiederkehrende Rechnung anlegen'}</h2><button type="button" onClick={() => setDialog({ open: false })}><X className="h-5 w-5" /></button></div><div className="grid gap-4 md:grid-cols-2"><label>Name<input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="form-input" placeholder="z. B. Wartungsvertrag" /></label><label>{terminology.entity.singular}<select required value={form.customerId} onChange={e => setForm({ ...form, customerId: e.target.value })} className="form-input"><option value="">Bitte wählen</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label><label>Frequenz<select value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value })} className="form-input"><option value="monthly">Monatlich</option><option value="quarterly">Vierteljährlich</option><option value="semiannual">Halbjährlich</option><option value="annual">Jährlich</option><option value="custom">Benutzerdefiniert</option></select></label>{form.frequency === 'custom' && <><label>Intervall<input required type="number" min="1" value={form.customInterval} onChange={e => setForm({ ...form, customInterval: e.target.value })} className="form-input" /></label><label>Einheit<select required value={form.customUnit} onChange={e => setForm({ ...form, customUnit: e.target.value as RecurringInvoiceIntervalUnit })} className="form-input"><option value="day">Tage</option><option value="week">Wochen</option><option value="month">Monate</option><option value="year">Jahre</option></select></label></>}<label>Startdatum<input type="date" required value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} className="form-input" /></label><label>Erste Ausführung<input type="date" required value={form.nextRunDate} min={form.startDate} onChange={e => setForm({ ...form, nextRunDate: e.target.value })} className="form-input" /></label><label>Enddatum (optional)<input type="date" min={form.nextRunDate} value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} className="form-input" /></label><label>Zahlungsziel (Tage)<input required type="number" min="0" value={form.paymentTerms} onChange={e => setForm({ ...form, paymentTerms: e.target.value })} className="form-input" /></label><label>Notizen<textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="form-input" rows={2} /></label></div><div className="mt-6"><div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">Positionen</h3><button type="button" onClick={() => setForm({ ...form, items: [...form.items, emptyItem()] })} className="text-sm text-primary-custom"><Plus className="mr-1 inline h-4 w-4" />Position hinzufügen</button></div>{form.items.map((item, index) => <div key={index} className="mb-3 grid gap-2 rounded-md border border-gray-200 p-3 md:grid-cols-[2fr_0.7fr_1fr_0.7fr_auto]"><input required placeholder="Beschreibung" value={item.description} onChange={e => { const items = [...form.items]; items[index] = { ...item, description: e.target.value }; setForm({ ...form, items }); }} className="form-input" /><LocalizedNumberInput required min="0.01" step="0.01" placeholder="Menge" value={item.quantity} locale={locale} numberFormat={company?.numberFormat} onValueChange={value => { const items = [...form.items]; items[index] = { ...item, quantity: value === '' ? '' : String(value) }; setForm({ ...form, items }); }} className="form-input" /><LocalizedNumberInput required min="0" step="0.01" placeholder="Preis" value={item.unitPrice} locale={locale} numberFormat={company?.numberFormat} onValueChange={value => { const items = [...form.items]; items[index] = { ...item, unitPrice: value === '' ? '' : String(value) }; setForm({ ...form, items }); }} className="form-input" /><LocalizedNumberInput required min="0" step="0.01" placeholder="MwSt. %" value={item.taxRate} locale={locale} numberFormat={company?.numberFormat} onValueChange={value => { const items = [...form.items]; items[index] = { ...item, taxRate: value === '' ? '' : String(value) }; setForm({ ...form, items }); }} className="form-input" />{form.items.length > 1 && <button type="button" onClick={() => setForm({ ...form, items: form.items.filter((_, itemIndex) => itemIndex !== index) })} className="text-red-600"><Trash2 className="h-4 w-4" /></button>}</div>)}</div><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setDialog({ open: false })} className="rounded-md border px-4 py-2">Abbrechen</button><button type="submit" disabled={busy === 'save'} className="btn-primary rounded-lg px-4 py-2 text-white transition-colors hover:brightness-90">{busy === 'save' ? 'Speichern …' : 'Speichern'}</button></div></form></div>}
  </div>;
}
