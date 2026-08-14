import { FormEvent, useEffect, useState } from 'react';
import { Check, Download, Eye, FilePlus2, Plus, Trash2, X, XCircle } from 'lucide-react';
import { useCustomers } from '../context/CustomerContext';
import { useInvoices } from '../context/InvoiceContext';
import { useCompany } from '../context/CompanyContext';
import { apiService } from '../services/api';
import { formatCurrency, formatDate } from '../utils/formatters';
import { PageHeader } from './PageHeader';
import type { CreditNote, CreditNotePayload } from '../types';
import { generateInvoicePDF, downloadBlob } from '../utils/pdfGenerator';
import { blobToBase64 } from '../utils/blobUtils';
import { DocumentPreview } from './DocumentPreview';
import type { PreviewDocument } from '../utils/previewDocuments';
import { LocalizedNumberInput } from './LocalizedNumberInput';
import { getTerminology } from '../utils/terminology';
import { DialogShell } from './DialogShell';
import { ActionMenu, ActionMenuItem } from './ActionMenu';
import { useElementWidth } from '../hooks/useElementWidth';
import { ACTION_MENU_COLUMN_WIDTH, listTableLayout } from '../utils/tableLayout';
import { useFeedback } from '../context/FeedbackContext';

type ItemDraft = { description: string; quantity: string; unitPrice: string; taxRate: string };
type FormDraft = { customerId: string; invoiceId: string; reason: string; issueDate: string; items: ItemDraft[] };
const emptyItem = (): ItemDraft => ({ description: '', quantity: '1', unitPrice: '0', taxRate: '19' });
const emptyForm = (): FormDraft => ({ customerId: '', invoiceId: '', reason: '', issueDate: new Date().toISOString().slice(0, 10), items: [emptyItem()] });

/**
 * Spaltenmaße der Gutschriftentabelle: Nummer 128, Datum 96, Betrag 112,
 * Status 112 und Ursprungsrechnung 176 Pixel. Ein Entwurf zeigt höchstens fünf
 * Icon-Aktionen.
 */
const CREDIT_NOTE_TABLE_LAYOUT = listTableLayout({
  baseColumnsWidth: 128 + 96 + 112 + 112 + 176,
  flexibleColumnMinWidth: 176,
  maxActions: 5,
});

const creditNoteStatusLabel = (status: CreditNote['status']) =>
  status === 'draft' ? 'Entwurf' : status === 'sent' ? 'Versendet' : status;

export function CreditNoteManagement() {
  const { confirm } = useFeedback();
  const { customers } = useCustomers();
  const { invoices } = useInvoices();
  const { company } = useCompany();
  const terminology = getTerminology(company?.terminologyProfile);
  const [notes, setNotes] = useState<CreditNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<CreditNote | null>(null);
  const [form, setForm] = useState<FormDraft>(emptyForm());
  const [busy, setBusy] = useState<string | null>(null);
  const [previewDocument, setPreviewDocument] = useState<PreviewDocument | null>(null);
  const locale = company?.locale || 'de-DE';
  const { ref: tableRef, width: tableWidth } = useElementWidth<HTMLDivElement>();
  const showInlineActions = tableWidth >= CREDIT_NOTE_TABLE_LAYOUT.inlineActionsMinWidth;

  const load = async () => { setLoading(true); setError(''); try { setNotes(await apiService.getCreditNotes()); } catch (e) { setError(e instanceof Error ? e.message : 'Gutschriften konnten nicht geladen werden.'); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const customerName = (id: string) => customers.find(customer => customer.id === id)?.name || `Unbekannter ${terminology.entity.singular}`;
  const total = (note: CreditNote) => Math.abs(Number(note.total || 0));
  const openNew = () => { setEditingNote(null); setForm(emptyForm()); setOpen(true); };
  const openEdit = (note: CreditNote) => {
    setEditingNote(note);
    setForm({
      customerId: note.customerId,
      invoiceId: note.referenceInvoiceId || '',
      reason: note.creditNoteReason || '',
      issueDate: String(note.issueDate).slice(0, 10),
      items: (note.items || []).map(item => ({
        description: item.description,
        quantity: String(item.quantity),
        unitPrice: String(Math.abs(Number(item.unitPrice))),
        taxRate: String(item.taxRate),
      })),
    });
    setOpen(true);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.customerId || !form.reason.trim() || form.items.length === 0 || form.items.some(item => !item.description.trim() || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0 || !Number.isFinite(Number(item.unitPrice)) || Number(item.unitPrice) <= 0 || !Number.isFinite(Number(item.taxRate)) || Number(item.taxRate) < 0)) {
      setError(`Bitte wählen Sie einen ${terminology.entity.accusative}, geben Sie einen Grund und mindestens eine gültige Position an.`);
      return;
    }
    const payload: CreditNotePayload = { customerId: form.customerId, referenceInvoiceId: form.invoiceId || null, creditNoteReason: form.reason.trim(), issueDate: form.issueDate, items: form.items.map((item, index) => ({ description: item.description.trim(), quantity: Number(item.quantity), unitPrice: Number(item.unitPrice), taxRate: Number(item.taxRate), order: index })) };
    setBusy('save'); try {
      const saved = editingNote ? await apiService.updateCreditNote(editingNote.id, payload) : await apiService.createCreditNote(payload);
      setNotes(items => editingNote ? items.map(item => item.id === editingNote.id ? saved : item) : [saved, ...items]);
      setOpen(false); setEditingNote(null); setNotice(editingNote ? 'Gutschrift-Entwurf gespeichert.' : 'Gutschrift als negativer Beleg angelegt.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Gutschrift konnte nicht gespeichert werden.'); } finally { setBusy(null); }
  };
  const remove = async (note: CreditNote) => {
    if (note.status !== 'draft') return;
    const confirmed = await confirm({
      title: 'Gutschrift löschen',
      message: `Gutschrift ${note.invoiceNumber || ''} wirklich löschen?`.replace('  ', ' '),
      confirmText: 'Löschen',
      isDestructive: true,
    });
    if (!confirmed) return;
    setBusy(note.id); try { await apiService.deleteCreditNote(note.id); setNotes(items => items.filter(item => item.id !== note.id)); } catch (e) { setError(e instanceof Error ? e.message : 'Gutschrift konnte nicht gelöscht werden.'); } finally { setBusy(null); } };
  const markSent = async (note: CreditNote) => { setBusy(note.id); try { const updated = await apiService.updateCreditNote(note.id, { status: 'sent' }); setNotes(items => items.map(item => item.id === note.id ? updated : item)); setNotice('Gutschrift wurde als versendet markiert.'); } catch (e) { setError(e instanceof Error ? e.message : 'Status konnte nicht geändert werden.'); } finally { setBusy(null); } };
  const getCustomer = (note: CreditNote) => customers.find(customer => customer.id === note.customerId);
  const download = async (note: CreditNote) => {
    const customer = getCustomer(note);
    if (!customer) { setError(`Der ${terminology.entity.genitive} zur Gutschrift wurde nicht gefunden.`); return; }
    setBusy(`download-${note.id}`);
    try {
      const blob = await generateInvoicePDF(note, { format: 'zugferd', company, customer });
      downloadBlob(blob, `${note.invoiceNumber || 'Gutschrift'}.pdf`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Gutschrift konnte nicht heruntergeladen werden.'); }
    finally { setBusy(null); }
  };
  const preview = async (note: CreditNote) => {
    const customer = getCustomer(note);
    if (!customer) { setError(`Der ${terminology.entity.genitive} zur Gutschrift wurde nicht gefunden.`); return; }
    setBusy(`preview-${note.id}`);
    try {
      const blob = await generateInvoicePDF(note, { format: 'zugferd', company, customer });
      setPreviewDocument({ id: note.id, name: `${note.invoiceNumber || 'Gutschrift'}.pdf`, type: 'attachment', content: await blobToBase64(blob), contentType: 'application/pdf', size: blob.size });
    } catch (e) { setError(e instanceof Error ? e.message : 'Gutschrift konnte nicht angezeigt werden.'); }
    finally { setBusy(null); }
  };

  return <div className="space-y-6"><DocumentPreview isOpen={Boolean(previewDocument)} onClose={() => setPreviewDocument(null)} documents={previewDocument ? [previewDocument] : []} initialIndex={0} /><PageHeader icon={FilePlus2} title="Gutschriften" subtitle="Korrekturen und Rückerstattungen nachvollziehbar verwalten."><button type="button" onClick={openNew} className="btn-primary inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-xl px-3 text-white transition-all duration-300 hover:scale-105 hover:brightness-90 sm:min-w-0 sm:px-4" aria-label="Gutschrift erstellen" title="Gutschrift erstellen"><Plus className="h-4 w-4" /><span className="hidden sm:inline">Neu</span></button></PageHeader>
    {notice && <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800"><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Hinweis ausblenden"><X className="h-4 w-4" /></button></div>}{error && <div className="flex justify-between rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="Hinweis ausblenden"><XCircle className="h-4 w-4" /></button></div>}
    {loading ? <div className="rounded-lg bg-white p-10 text-center text-gray-500">Gutschriften werden geladen …</div> : notes.length === 0 ? <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center text-gray-500">Noch keine Gutschriften vorhanden.</div> : (() => {
      const referenceNumber = (note: CreditNote) => {
        const referenceId = (note as CreditNote & { referenceInvoiceId?: string }).referenceInvoiceId;
        if (!referenceId) return '–';
        return invoices.find(invoice => invoice.id === referenceId)?.invoiceNumber || referenceId;
      };
      const amount = (note: CreditNote) => `−${formatCurrency(total(note), locale, company?.numberFormat, company?.currency)}`;
      const actionItems = (note: CreditNote) => (
        <>
          {note.status === 'draft' && (
            <>
              <ActionMenuItem icon={<FilePlus2 className="h-4 w-4" />} tone="indigo" onClick={() => openEdit(note)}>Bearbeiten</ActionMenuItem>
              <ActionMenuItem icon={<Check className="h-4 w-4" />} tone="green" onClick={() => void markSent(note)} disabled={busy === note.id}>Als versendet markieren</ActionMenuItem>
            </>
          )}
          <ActionMenuItem icon={<Eye className="h-4 w-4" />} tone="green" onClick={() => void preview(note)} disabled={busy === `preview-${note.id}`}>Vorschau anzeigen</ActionMenuItem>
          <ActionMenuItem icon={<Download className="h-4 w-4" />} tone="blue" onClick={() => void download(note)} disabled={busy === `download-${note.id}`}>Herunterladen</ActionMenuItem>
          {note.status === 'draft' && (
            <ActionMenuItem icon={<Trash2 className="h-4 w-4" />} tone="red" onClick={() => void remove(note)} disabled={busy === note.id}>Löschen</ActionMenuItem>
          )}
        </>
      );

      return (
        <div className="overflow-hidden rounded-lg bg-white shadow-sm">
          <div ref={tableRef} className="hidden w-full min-w-0 max-w-full overflow-hidden tablet:block">
            <table className="w-full table-fixed text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="w-32 px-4 py-3 text-left font-medium text-gray-500">Nummer</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">{terminology.entity.singular}</th>
                  <th className="w-24 px-4 py-3 text-left font-medium text-gray-500">Datum</th>
                  <th className="w-28 px-4 py-3 text-right font-medium text-gray-500">Betrag</th>
                  <th className="w-28 px-4 py-3 text-left font-medium text-gray-500">Status</th>
                  <th className="w-44 px-4 py-3 text-left font-medium text-gray-500">Ursprungsrechnung</th>
                  <th
                    style={{ width: showInlineActions ? CREDIT_NOTE_TABLE_LAYOUT.actionsColumnWidth : ACTION_MENU_COLUMN_WIDTH }}
                    className={`sticky right-0 z-20 bg-gray-50 py-3 text-left font-medium text-gray-500 ${showInlineActions ? 'px-3' : 'px-2'}`}
                  >
                    <span className="sr-only">Aktionen</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {notes.map(note => (
                  <tr key={note.id} className="group hover:bg-gray-50">
                    <td className="w-32 truncate px-4 py-3 font-medium">{note.invoiceNumber || '–'}</td>
                    <td className="max-w-0 px-4 py-3"><span className="block truncate">{customerName(note.customerId)}</span></td>
                    <td className="w-24 whitespace-nowrap px-4 py-3">{formatDate(note.issueDate, locale, company?.dateFormat)}</td>
                    <td className="w-28 whitespace-nowrap px-4 py-3 text-right font-medium">{amount(note)}</td>
                    <td className="w-28 px-4 py-3"><span className="inline-flex rounded-full bg-gray-100 px-2 py-1 text-xs">{creditNoteStatusLabel(note.status)}</span></td>
                    <td className="w-44 max-w-0 px-4 py-3"><span className="block truncate">{referenceNumber(note)}</span></td>
                    <td
                      style={{ width: showInlineActions ? CREDIT_NOTE_TABLE_LAYOUT.actionsColumnWidth : ACTION_MENU_COLUMN_WIDTH }}
                      className={`sticky right-0 z-10 bg-white py-3 transition-colors group-hover:bg-gray-50 ${showInlineActions ? 'px-3' : 'px-2'}`}
                    >
                      {showInlineActions ? (
                        <div className="flex flex-nowrap items-center gap-1">
                          {note.status === 'draft' && (
                            <>
                              <button type="button" onClick={() => openEdit(note)} className="action-icon-button action-icon-indigo" title="Bearbeiten" aria-label="Bearbeiten"><FilePlus2 className="h-4 w-4" /></button>
                              <button type="button" onClick={() => void markSent(note)} disabled={busy === note.id} className="action-icon-button action-icon-green" title="Als versendet markieren" aria-label="Als versendet markieren"><Check className="h-4 w-4" /></button>
                            </>
                          )}
                          <button type="button" onClick={() => void preview(note)} disabled={busy === `preview-${note.id}`} className="action-icon-button action-icon-blue" title="Vorschau anzeigen" aria-label="Vorschau anzeigen"><Eye className="h-4 w-4" /></button>
                          <button type="button" onClick={() => void download(note)} disabled={busy === `download-${note.id}`} className="action-icon-button action-icon-green" title="Herunterladen" aria-label="Herunterladen"><Download className="h-4 w-4" /></button>
                          {note.status === 'draft' && (
                            <button type="button" onClick={() => void remove(note)} disabled={busy === note.id} className="action-icon-button action-icon-red" title="Löschen" aria-label="Löschen"><Trash2 className="h-4 w-4" /></button>
                          )}
                        </div>
                      ) : (
                        <ActionMenu triggerClassName="action-icon-button action-icon-blue">{actionItems(note)}</ActionMenu>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="divide-y divide-gray-100 tablet:hidden">
            {notes.map(note => (
              <article key={note.id} className="p-4">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="min-w-0 truncate text-sm font-medium text-gray-900">{note.invoiceNumber || 'Gutschrift'}</h3>
                      <p className="shrink-0 whitespace-nowrap text-sm font-medium text-gray-900">{amount(note)}</p>
                    </div>
                    <p className="mt-1 truncate text-sm text-gray-600">{customerName(note.customerId)}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                      <span className="inline-flex shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold">{creditNoteStatusLabel(note.status)}</span>
                      <span>{formatDate(note.issueDate, locale, company?.dateFormat)}</span>
                      <span className="truncate">Zu: {referenceNumber(note)}</span>
                    </div>
                  </div>
                  <ActionMenu containerClassName="shrink-0" triggerClassName="action-icon-button action-icon-blue">{actionItems(note)}</ActionMenu>
                </div>
              </article>
            ))}
          </div>
        </div>
      );
    })()}
    {open && (
      <DialogShell
        titleId="credit-note-dialog-title"
        icon={FilePlus2}
        title={editingNote ? 'Gutschrift-Entwurf bearbeiten' : 'Gutschrift erstellen'}
        description="Gutschriften werden als negative Belege gespeichert und sollten auf eine Ursprungsrechnung verweisen."
        onClose={() => { setOpen(false); setEditingNote(null); }}
        onSubmit={submit}
        size="xl"
        footer={(
          <>
            <button type="button" onClick={() => { setOpen(false); setEditingNote(null); }} className="min-h-12 rounded-lg border border-gray-300 bg-white px-8 py-2 text-base font-medium text-gray-700 transition hover:bg-gray-50">Abbrechen</button>
            <button type="submit" disabled={busy === 'save'} className="btn-primary min-h-12 rounded-lg px-8 py-2 text-base font-semibold text-white transition hover:brightness-90">{busy === 'save' ? 'Speichern …' : editingNote ? 'Entwurf speichern' : 'Speichern'}</button>
          </>
        )}
      >
        <div className="space-y-3 pb-2">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">Die Positionen werden positiv eingegeben. Die Gutschrift wird als negativer Beleg gespeichert. Eine nachträgliche Korrektur sollte immer auf die Ursprungsrechnung verweisen.</div>
          <section className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6" aria-labelledby="credit-note-data-title">
            <h3 id="credit-note-data-title" className="mb-4 text-xl font-semibold text-gray-900">Gutschriftdaten</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-base font-medium text-gray-700">{terminology.entity.singular}<select required value={form.customerId} onChange={e => setForm({ ...form, customerId: e.target.value, invoiceId: '' })} className="form-input mt-1 w-full"><option value="">Bitte wählen</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
              <label className="text-base font-medium text-gray-700">Ursprungsrechnung <span className="font-normal text-gray-400">(optional)</span><select value={form.invoiceId} onChange={e => setForm({ ...form, invoiceId: e.target.value })} className="form-input mt-1 w-full"><option value="">Keine Zuordnung</option>{invoices.filter(invoice => invoice.documentType !== 'credit_note' && (!form.customerId || invoice.customerId === form.customerId)).map(invoice => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber}</option>)}</select></label>
              <label className="text-base font-medium text-gray-700">Datum<input required type="date" value={form.issueDate} onChange={e => setForm({ ...form, issueDate: e.target.value })} className="form-input mt-1 w-full" /></label>
              <label className="text-base font-medium text-gray-700">Grund<input required value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} className="form-input mt-1 w-full" placeholder="z. B. Preisnachlass" /></label>
            </div>
          </section>
          <section className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6" aria-labelledby="credit-note-items-title">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h3 id="credit-note-items-title" className="text-xl font-semibold text-gray-900">Positionen</h3><button type="button" onClick={() => setForm({ ...form, items: [...form.items, emptyItem()] })} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-primary-custom px-3 py-2 text-sm font-medium text-primary-custom transition hover:bg-primary-light-custom"><Plus className="h-4 w-4" />Position hinzufügen</button></div>
            {form.items.map((item, index) => <div key={index} className="mb-3 grid gap-3 rounded-xl border border-gray-200 bg-gray-50/60 p-4 last:mb-0 md:grid-cols-[2fr_0.7fr_1fr_0.7fr_auto]"><label className="text-sm font-medium text-gray-700 md:contents"><span className="sr-only">Beschreibung</span><input required placeholder="Beschreibung" value={item.description} onChange={e => { const items = [...form.items]; items[index] = { ...item, description: e.target.value }; setForm({ ...form, items }); }} className="form-input" /></label><label className="text-sm font-medium text-gray-700 md:contents"><span className="sr-only">Menge</span><LocalizedNumberInput required min="0.01" step="0.01" value={item.quantity} locale={locale} numberFormat={company?.numberFormat} onValueChange={value => { const items = [...form.items]; items[index] = { ...item, quantity: value === '' ? '' : String(value) }; setForm({ ...form, items }); }} className="form-input" /></label><label className="text-sm font-medium text-gray-700 md:contents"><span className="sr-only">Einzelpreis</span><LocalizedNumberInput required min="0.01" step="0.01" value={item.unitPrice} locale={locale} numberFormat={company?.numberFormat} onValueChange={value => { const items = [...form.items]; items[index] = { ...item, unitPrice: value === '' ? '' : String(value) }; setForm({ ...form, items }); }} className="form-input" /></label><label className="text-sm font-medium text-gray-700 md:contents"><span className="sr-only">MwSt.</span><LocalizedNumberInput required min="0" step="0.01" value={item.taxRate} locale={locale} numberFormat={company?.numberFormat} onValueChange={value => { const items = [...form.items]; items[index] = { ...item, taxRate: value === '' ? '' : String(value) }; setForm({ ...form, items }); }} className="form-input" /></label>{form.items.length > 1 && <button type="button" onClick={() => setForm({ ...form, items: form.items.filter((_, itemIndex) => itemIndex !== index) })} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-red-600 transition hover:bg-red-50" aria-label="Position entfernen"><Trash2 className="h-4 w-4" /></button>}</div>)}
          </section>
        </div>
      </DialogShell>
    )}
  </div>;
}
