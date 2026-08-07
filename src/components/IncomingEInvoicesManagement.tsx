import { type ForwardedRef, forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileCheck2, Inbox, Link2, Loader2, Upload, X } from 'lucide-react';
import { useCustomers } from '../context/CustomerContext';
import { apiService } from '../services/api';
import type { IncomingEInvoice } from '../types';
import { fileToBase64, formatFileSize } from '../utils/fileUtils';
import { formatCurrency, formatDate } from '../utils/formatters';
import { DialogShell } from './DialogShell';
import { PageHeader } from './PageHeader';

const MAX_XML_SIZE = 10 * 1024 * 1024;

interface IncomingEInvoicesManagementProps {
  embedded?: boolean;
}

export interface IncomingEInvoicesManagementHandle {
  openUpload: () => void;
}

function statusLabel(invoice: IncomingEInvoice) {
  return invoice.validationStatus === 'validated' ? 'E-Rechnung geprüft' : 'Prüfung fehlgeschlagen';
}

export const IncomingEInvoicesManagement = forwardRef(function IncomingEInvoicesManagement(
  { embedded = false }: IncomingEInvoicesManagementProps,
  ref: ForwardedRef<IncomingEInvoicesManagementHandle>,
) {
  const { customers } = useCustomers();
  const [invoices, setInvoices] = useState<IncomingEInvoice[]>([]);
  const [selected, setSelected] = useState<IncomingEInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const openUpload = useCallback(() => fileInputRef.current?.click(), []);
  useImperativeHandle(ref, () => ({ openUpload }), [openUpload]);

  const customerNames = useMemo(() => new Map(customers.map(customer => [customer.id, customer.name])), [customers]);

  useEffect(() => {
    let active = true;
    void apiService.getIncomingEInvoices()
      .then(result => { if (active) setInvoices(result); })
      .catch(loadError => { if (active) setError(loadError instanceof Error ? loadError.message : 'E-Rechnungen konnten nicht geladen werden.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    setNotice('');
    if (file.size > MAX_XML_SIZE) {
      setError('Die XML-Datei darf höchstens 10 MB groß sein.');
      return;
    }
    if (!file.name.toLowerCase().endsWith('.xml')) {
      setError('Bitte eine XML-Datei auswählen.');
      return;
    }

    setUploading(true);
    try {
      const created = await apiService.receiveEInvoice({
        filename: file.name,
        content: await fileToBase64(file),
        contentType: file.type || 'application/xml',
      });
      setInvoices(current => [created, ...current]);
      setSelected(created);
      setNotice(created.validationStatus === 'validated'
        ? 'E-Rechnung übernommen und strukturell geprüft. Bitte die Zuordnung kontrollieren.'
        : 'E-Rechnung archiviert, aber die Strukturprüfung meldet fehlende Pflichtfelder.');
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'E-Rechnung konnte nicht übernommen werden.');
    } finally {
      setUploading(false);
    }
  };

  const linkCustomer = async (customerId: string) => {
    if (!selected || !customerId) return;
    setLinking(true);
    setError('');
    try {
      const updated = await apiService.linkIncomingEInvoiceCustomer(selected.id, customerId);
      setInvoices(current => current.map(invoice => invoice.id === updated.id ? updated : invoice));
      setSelected(updated);
      setNotice('E-Rechnung dem Kunden zugeordnet.');
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : 'Die Zuordnung konnte nicht gespeichert werden.');
    } finally {
      setLinking(false);
    }
  };

  const validatedCount = invoices.filter(invoice => invoice.validationStatus === 'validated').length;
  const linkedCount = invoices.filter(invoice => invoice.linkedCustomerId).length;

  return (
    <>
      <input ref={fileInputRef} type="file" accept=".xml,application/xml,text/xml" className="hidden" onChange={handleUpload} disabled={uploading} />
      <div className="space-y-4 sm:space-y-6">
      {!embedded && <PageHeader icon={Inbox} title="E-Rechnungseingang" subtitle="E-Rechnungen lokal empfangen, prüfen, archivieren und zuordnen">
        <button type="button" onClick={openUpload} className="btn-primary inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl px-2 text-white transition-all hover:brightness-90 xl:min-w-0 xl:px-4" title="E-Rechnung als XML übernehmen" disabled={uploading}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          <span className="hidden xl:inline">{uploading ? 'Wird geprüft …' : 'XML übernehmen'}</span>
        </button>
      </PageHeader>}

      {(error || notice) && (
        <div className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
          {error ? <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />}
          <span className="flex-1">{error || notice}</span>
          <button type="button" onClick={() => { setError(''); setNotice(''); }} aria-label="Hinweis schließen"><X className="h-4 w-4" /></button>
        </div>
      )}

      <section className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-950 shadow-sm sm:p-5">
        <div className="flex items-start gap-3">
          <FileCheck2 className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
          <div>
            <h2 className="font-semibold">Lokaler Eingang mit Prüfspur</h2>
            <p className="mt-1 text-sm leading-6 text-blue-900">XRechnung- und CII-XML werden im eigenen SoloOffice-Workspace gespeichert, per SHA-256 identifizierbar archiviert und auf zentrale Pflichtfelder geprüft. Die Prüfung ersetzt keine KOSIT-/FeRD-Referenzvalidierung.</p>
            <p className="mt-2 text-xs text-blue-800">Unterstützt: XML-Dateien bis 10 MB · externe XML-Entitäten werden abgewiesen · ein Löschen über die Oberfläche ist nicht vorgesehen</p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm sm:p-4"><p className="text-[10px] font-medium uppercase tracking-wide text-gray-500 sm:text-xs">Eingegangen</p><p className="mt-1 text-xl font-bold text-gray-900 sm:text-2xl">{invoices.length}</p></div>
        <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm sm:p-4"><p className="text-[10px] font-medium uppercase tracking-wide text-gray-500 sm:text-xs">Geprüft</p><p className="mt-1 text-xl font-bold text-emerald-700 sm:text-2xl">{validatedCount}</p></div>
        <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm sm:p-4"><p className="text-[10px] font-medium uppercase tracking-wide text-gray-500 sm:text-xs">Zugeordnet</p><p className="mt-1 text-xl font-bold text-blue-700 sm:text-2xl">{linkedCount}</p></div>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-lg font-semibold text-gray-900">Eingegangene E-Rechnungen</h2><p className="mt-1 text-sm text-gray-500">Die Quelldatei bleibt zusammen mit Hash und Prüfstatus erhalten.</p></div>
          <button type="button" onClick={openUpload} className="action-button inline-flex items-center gap-2" disabled={uploading}><Upload className="h-4 w-4" />XML übernehmen</button>
        </div>

        {loading ? <div className="py-12 text-center text-sm text-gray-500">Eingänge werden geladen …</div> : invoices.length === 0 ? (
          <button type="button" onClick={openUpload} className="mt-5 block w-full rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center transition hover:border-primary-custom hover:bg-blue-50" disabled={uploading}>
            <Inbox className="mx-auto h-8 w-8 text-gray-400" />
            <span className="mt-3 block font-medium text-gray-800">Noch keine E-Rechnung eingegangen</span>
            <span className="mt-1 block text-sm text-gray-500">XRechnung- oder CII-XML auswählen</span>
          </button>
        ) : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {invoices.map(invoice => (
              <article key={invoice.id} className="document-card flex h-full min-w-0 flex-col rounded-xl border border-gray-200 p-4 transition hover:border-gray-300 hover:shadow-sm">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><FileCheck2 className="h-5 w-5" /></span>
                    <div className="min-w-0 flex-1">
                      <h3 className="break-words font-medium leading-5 text-gray-900" title={invoice.filename}>{invoice.filename}</h3>
                      <p className="mt-1 break-words text-xs leading-4 text-gray-500">{invoice.format} · {formatFileSize(invoice.size)}</p>
                    </div>
                  </div>
                  <span className={`document-card-status inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium ${invoice.validationStatus === 'validated' ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-rose-100 bg-rose-50 text-rose-700'}`} title={statusLabel(invoice)} aria-label={`Status: ${statusLabel(invoice)}`}>
                    <span className={`document-card-status-dot h-2 w-2 shrink-0 rounded-full ${invoice.validationStatus === 'validated' ? 'bg-emerald-500' : 'bg-rose-500'}`} aria-hidden="true" />
                    <span className="document-card-status-label whitespace-nowrap">{statusLabel(invoice)}</span>
                  </span>
                </div>
                <dl className="mt-4 space-y-2 text-sm"><div className="flex justify-between gap-3"><dt className="text-gray-500">Nummer</dt><dd className="truncate font-medium text-gray-800">{invoice.invoiceNumber || 'Nicht erkannt'}</dd></div><div className="flex justify-between gap-3"><dt className="text-gray-500">Aussteller</dt><dd className="truncate text-gray-800">{invoice.supplierName || 'Nicht erkannt'}</dd></div><div className="flex justify-between gap-3"><dt className="text-gray-500">Betrag</dt><dd className="font-medium text-gray-800">{invoice.grossAmount === undefined ? 'Nicht erkannt' : formatCurrency(invoice.grossAmount, 'de-DE', 'european', invoice.currency || 'EUR')}</dd></div></dl>
                <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-500">{invoice.linkedCustomerId ? <><Link2 className="h-3.5 w-3.5 text-blue-700" />{customerNames.get(invoice.linkedCustomerId) || 'Kunde zugeordnet'}</> : 'Noch keinem Kunden zugeordnet'}</p>
                <button type="button" onClick={() => { setSelected(invoice); setError(''); }} className="action-button mt-auto flex w-full items-center justify-center gap-2"><FileCheck2 className="h-4 w-4" />Eingang prüfen</button>
              </article>
            ))}
          </div>
        )}
      </section>

      {selected && (
        <DialogShell
          titleId="incoming-e-invoice-title"
          icon={FileCheck2}
          title={selected.filename}
          description={`${selected.format} · SHA-256 ${selected.sha256}`}
          onClose={() => setSelected(null)}
          size="lg"
          zIndexClassName="z-[1100]"
          footer={<button type="button" onClick={() => setSelected(null)} className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Schließen</button>}
        >
          <div className="space-y-4 pb-2">
            <section className={`rounded-xl border p-4 ${selected.validationStatus === 'validated' ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
              <p className="font-semibold">{statusLabel(selected)}</p>
              {selected.validationError && <p className="mt-1 text-sm">{selected.validationError}</p>}
              <p className="mt-1 text-xs text-gray-600">Eingegangen am {formatDate(selected.receivedAt, 'de-DE', 'DD.MM.YYYY')}</p>
            </section>
            <section className="rounded-xl border border-gray-200 bg-white p-4">
              <h3 className="font-semibold text-gray-900">Erkannte Rechnungsdaten</h3>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-gray-500">Rechnungsnummer</dt><dd className="font-medium">{selected.invoiceNumber || 'Nicht erkannt'}</dd></div><div><dt className="text-gray-500">Rechnungsdatum</dt><dd className="font-medium">{selected.issueDate ? formatDate(selected.issueDate, 'de-DE', 'DD.MM.YYYY') : 'Nicht erkannt'}</dd></div><div><dt className="text-gray-500">Aussteller</dt><dd className="font-medium">{selected.supplierName || 'Nicht erkannt'}</dd></div><div><dt className="text-gray-500">Steuer-ID</dt><dd className="font-medium">{selected.supplierTaxId || 'Nicht erkannt'}</dd></div><div><dt className="text-gray-500">BuyerReference</dt><dd className="font-medium">{selected.buyerReference || 'Nicht vorhanden'}</dd></div><div><dt className="text-gray-500">Gesamtbetrag</dt><dd className="font-medium">{selected.grossAmount === undefined ? 'Nicht erkannt' : formatCurrency(selected.grossAmount, 'de-DE', 'european', selected.currency || 'EUR')}</dd></div></dl>
            </section>
            <section className="rounded-xl border border-gray-200 bg-white p-4">
              <h3 className="font-semibold text-gray-900">Kunde zuordnen</h3>
              <p className="mt-1 text-sm text-gray-500">Die Originaldatei und die erkannten Werte bleiben unverändert.</p>
              <label htmlFor="incoming-e-invoice-customer" className="mt-4 block text-sm font-medium text-gray-700">Kunde
                <select id="incoming-e-invoice-customer" value={selected.linkedCustomerId || ''} onChange={event => void linkCustomer(event.target.value)} disabled={linking} className="mt-1.5 min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm outline-none focus:border-primary-custom focus:ring-2 focus:ring-primary-custom/20"><option value="">Bitte auswählen</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.customerNumber} · {customer.name}</option>)}</select>
              </label>
              {linking && <p className="mt-2 flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Zuordnung wird gespeichert …</p>}
            </section>
          </div>
        </DialogShell>
      )}
      </div>
    </>
  );
});
