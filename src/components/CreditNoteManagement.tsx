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

type ItemDraft = { description: string; quantity: string; unitPrice: string; taxRate: string };
type FormDraft = { customerId: string; invoiceId: string; reason: string; issueDate: string; items: ItemDraft[] };
const emptyItem = (): ItemDraft => ({ description: '', quantity: '1', unitPrice: '0', taxRate: '19' });
const emptyForm = (): FormDraft => ({ customerId: '', invoiceId: '', reason: '', issueDate: new Date().toISOString().slice(0, 10), items: [emptyItem()] });

export function CreditNoteManagement() {
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
  const remove = async (note: CreditNote) => { if (note.status !== 'draft' || !window.confirm(`Gutschrift ${note.invoiceNumber || ''} löschen?`)) return; setBusy(note.id); try { await apiService.deleteCreditNote(note.id); setNotes(items => items.filter(item => item.id !== note.id)); } catch (e) { setError(e instanceof Error ? e.message : 'Gutschrift konnte nicht gelöscht werden.'); } finally { setBusy(null); } };
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
    {loading ? <div className="rounded-lg bg-white p-10 text-center text-gray-500">Gutschriften werden geladen …</div> : notes.length === 0 ? <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center text-gray-500">Noch keine Gutschriften vorhanden.</div> : <div className="overflow-x-auto rounded-lg bg-white shadow-sm"><table className="min-w-full divide-y divide-gray-200 text-sm"><thead className="bg-gray-50"><tr>{['Nummer', terminology.entity.singular, 'Datum', 'Betrag', 'Status', 'Ursprungsrechnung', 'Aktionen'].map(label => <th key={label} className="px-4 py-3 text-left font-medium text-gray-500">{label}</th>)}</tr></thead><tbody className="divide-y divide-gray-100">{notes.map(note => <tr key={note.id}><td className="px-4 py-3 font-medium">{note.invoiceNumber || '–'}</td><td className="px-4 py-3">{customerName(note.customerId)}</td><td className="px-4 py-3">{formatDate(note.issueDate, locale, company?.dateFormat)}</td><td className="px-4 py-3 font-medium">−{formatCurrency(total(note), locale, company?.numberFormat, company?.currency)}</td><td className="px-4 py-3"><span className="rounded-full bg-gray-100 px-2 py-1 text-xs">{note.status === 'draft' ? 'Entwurf' : note.status === 'sent' ? 'Versendet' : note.status}</span></td><td className="px-4 py-3">{(note as CreditNote & { referenceInvoiceId?: string }).referenceInvoiceId ? invoices.find(invoice => invoice.id === (note as CreditNote & { referenceInvoiceId?: string }).referenceInvoiceId)?.invoiceNumber || (note as CreditNote & { referenceInvoiceId?: string }).referenceInvoiceId : '–'}</td><td className="px-4 py-3"><div className="flex flex-wrap gap-2">{note.status === 'draft' && <><button onClick={() => openEdit(note)} className="action-button"><FilePlus2 className="h-4 w-4" />Bearbeiten</button><button onClick={() => void markSent(note)} disabled={busy === note.id} className="action-button text-primary-custom"><Check className="h-4 w-4" />Versendet</button></>}<button onClick={() => void preview(note)} disabled={busy === `preview-${note.id}`} className="action-button"><Eye className="h-4 w-4" />Vorschau</button><button onClick={() => void download(note)} disabled={busy === `download-${note.id}`} className="action-button"><Download className="h-4 w-4" />PDF</button>{note.status === 'draft' && <button onClick={() => void remove(note)} disabled={busy === note.id} className="action-button text-red-600"><Trash2 className="h-4 w-4" />Löschen</button>}</div></td></tr>)}</tbody></table></div>}
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
