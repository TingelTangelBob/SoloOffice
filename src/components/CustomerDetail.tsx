import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowLeft, Building2, Briefcase, Check, Download, Edit, FileCheck, FileText, Mail, Phone, StickyNote, UserRound } from 'lucide-react';
import type { CreditNote, Customer, Invoice, JobEntry, Quote } from '../types';
import { useCustomers } from '../context/CustomerContext';
import { useInvoices } from '../context/InvoiceContext';
import { useJobs } from '../context/JobContext';
import { useCompany } from '../context/CompanyContext';
import { useAuth } from '../context/AuthContext';
import { useQuotes } from '../context/QuoteContext';
import { useFeedback } from '../context/FeedbackContext';
import { apiService } from '../services/api';
import { formatCurrency, formatDate, formatNumber } from '../utils/formatters';
import { getTerminology } from '../utils/terminology';
import { PageHeader } from './PageHeader';
import { ActionMenu, ActionMenuItem } from './ActionMenu';
import { downloadCustomerCsv, downloadCustomerPdf } from '../utils/customerExport';
import { SortableTableHeader } from './SortableTableHeader';
import { sortByTableState, type SortState } from '../utils/tableSort';
import { TableSkeleton } from './TableSkeleton';

interface CustomerDetailProps {
  customerId?: string;
  initialTab?: string;
  onNavigate: (page: string, filter?: string, searchTerm?: string, invoiceId?: string, jobSeriesId?: string) => void;
}

type CustomerDetailTab = 'overview' | 'invoices' | 'credit-notes' | 'quotes' | 'jobs' | 'notes';

const tabs: Array<{ id: CustomerDetailTab; label: string; icon: typeof UserRound }> = [
  { id: 'overview', label: 'Übersicht', icon: UserRound },
  { id: 'invoices', label: 'Rechnungen', icon: FileText },
  { id: 'credit-notes', label: 'Gutschriften', icon: FileCheck },
  { id: 'quotes', label: 'Angebote', icon: FileCheck },
  { id: 'jobs', label: 'Aufträge', icon: Briefcase },
  { id: 'notes', label: 'Notizen', icon: StickyNote },
];

function tabFromValue(value?: string): CustomerDetailTab {
  return tabs.some(tab => tab.id === value) ? value as CustomerDetailTab : 'overview';
}

function typeLabel(customer: Customer): string {
  return customer.customerType === 'organization' ? 'Organisation' : 'Person';
}

function TypeIcon({ customer, className = 'h-5 w-5' }: { customer: Customer; className?: string }) {
  const Icon = customer.customerType === 'organization' ? Building2 : UserRound;
  return <Icon className={className} aria-hidden="true" />;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft: 'Entwurf',
    sent: 'Versendet',
    paid: 'Bezahlt',
    overdue: 'Überfällig',
    accepted: 'Angenommen',
    rejected: 'Abgelehnt',
    expired: 'Abgelaufen',
    billed: 'Abgerechnet',
    'in-progress': 'In Bearbeitung',
    completed: 'Abgeschlossen',
    invoiced: 'Abgerechnet',
  };
  return labels[status] || status;
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === 'paid' || status === 'accepted' || status === 'completed' || status === 'invoiced'
    ? 'bg-emerald-50 text-emerald-700'
    : status === 'overdue' || status === 'rejected'
      ? 'bg-rose-50 text-rose-700'
      : 'bg-gray-100 text-gray-600';
  return <span className={`status-badge inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{statusLabel(status)}</span>;
}

function EmptyRelation({ message, actionLabel, onAction }: { message: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-200 px-4 py-8 text-center">
      <p className="text-sm text-gray-500">{message}</p>
      {actionLabel && onAction && <button type="button" onClick={onAction} className="btn-primary mt-4 inline-flex min-h-9 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white"><span aria-hidden="true">+</span>{actionLabel}</button>}
    </div>
  );
}

export function CustomerDetail({ customerId, initialTab, onNavigate }: CustomerDetailProps) {
  const { customers, updateCustomer } = useCustomers();
  const { invoices } = useInvoices();
  const { quotes } = useQuotes();
  const { jobEntries } = useJobs();
  const { company } = useCompany();
  const { can, user } = useAuth();
  const { notify } = useFeedback();
  const terminology = getTerminology(company.terminologyProfile);
  const canWrite = can('data.write');
  const customer = customers.find(item => item.id === customerId);
  const [activeTab, setActiveTab] = useState<CustomerDetailTab>(tabFromValue(initialTab));
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const [notes, setNotes] = useState(customer?.notes || '');
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [creditNotesLoading, setCreditNotesLoading] = useState(true);
  const [documentSort, setDocumentSort] = useState<SortState>({ key: 'number', direction: 'asc' });

  useEffect(() => {
    setActiveTab(tabFromValue(initialTab));
  }, [initialTab]);

  useEffect(() => {
    setNotes(customer?.notes || '');
  }, [customer?.id, customer?.notes]);

  useEffect(() => {
    let active = true;
    setCreditNotesLoading(true);
    apiService.getCreditNotes()
      .then(items => {
        if (active) setCreditNotes(items);
      })
      .catch(() => {
        if (active) setCreditNotes([]);
      })
      .finally(() => {
        if (active) setCreditNotesLoading(false);
      });
    return () => { active = false; };
  }, []);

  const customerInvoices = useMemo(
    () => invoices.filter(invoice => invoice.customerId === customerId && invoice.documentType !== 'credit_note'),
    [customerId, invoices],
  );
  const customerCreditNotes = useMemo(
    () => creditNotes.filter(note => note.customerId === customerId),
    [customerId, creditNotes],
  );
  const customerQuotes = useMemo(() => quotes.filter(quote => quote.customerId === customerId), [customerId, quotes]);
  const customerJobs = useMemo(() => jobEntries.filter(job => job.customerId === customerId), [customerId, jobEntries]);
  const customerActivities = useMemo(() => {
    if (!customer) return [];
    const actor = user?.displayName || [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || 'Workspace';
    const activityItems = [
      {
        id: `customer-${customer.id}`,
        date: customer.createdAt,
        Icon: UserRound,
        text: `${actor} hat ${customer.name} als ${typeLabel(customer)} angelegt.`,
      },
      ...customerInvoices.map(invoice => ({
        id: `invoice-${invoice.id}`,
        date: invoice.createdAt,
        Icon: FileText,
        text: `${actor} hat Rechnung ${invoice.invoiceNumber} für Kunde ${customer.name} angelegt.`,
      })),
      ...customerCreditNotes.map(note => ({
        id: `credit-note-${note.id}`,
        date: note.createdAt,
        Icon: FileCheck,
        text: `${actor} hat Gutschrift ${note.invoiceNumber} für Kunde ${customer.name} angelegt.`,
      })),
      ...customerQuotes.map(quote => ({
        id: `quote-${quote.id}`,
        date: quote.createdAt,
        Icon: FileCheck,
        text: `${actor} hat Angebot ${quote.quoteNumber} für Kunde ${customer.name} angelegt.`,
      })),
      ...customerJobs.map(job => ({
        id: `job-${job.id}`,
        date: job.createdAt,
        Icon: Briefcase,
        text: `${actor} hat ${terminology.work.singular} ${job.jobNumber} für Kunde ${customer.name} angelegt.`,
      })),
    ];

    return activityItems.sort((left, right) => right.date.getTime() - left.date.getTime());
  }, [customer, customerCreditNotes, customerInvoices, customerJobs, customerQuotes, terminology.work.singular, user]);
  const money = (value: number) => formatCurrency(value, company.locale, company.numberFormat, company.currency);

  if (!customer) {
    return (
      <div className="page-root space-y-6">
        <PageHeader icon={UserRound} title={`${terminology.entity.singular} nicht gefunden`} />
        <section className="rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-gray-500">Die angeforderten Kundendaten sind nicht verfügbar.</p>
          <button type="button" onClick={() => onNavigate('customers')} className="btn-primary mt-4 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white"><ArrowLeft className="h-4 w-4" />Zur Kundenübersicht</button>
        </section>
      </div>
    );
  }

  const openTab = (tab: CustomerDetailTab) => setActiveTab(tab);
  const startInvoice = () => onNavigate('invoices', 'new', customer.id);
  const startQuote = () => onNavigate('quote-editor', 'new', customer.id);
  const startJob = () => onNavigate('jobs', 'new', customer.id);
  const handleDocumentSort = (key: string) => setDocumentSort(previous => previous.key === key
    ? { key, direction: previous.direction === 'asc' ? 'desc' : 'asc' }
    : { key, direction: 'asc' });
  const saveNotes = async () => {
    if (!canWrite) return;
    setIsSavingNotes(true);
    try {
      await updateCustomer(customer.id, { notes: notes.trim() || undefined });
      notify({ variant: 'success', message: 'Notizen gespeichert.' });
    } catch (error) {
      notify({ variant: 'error', message: error instanceof Error ? error.message : 'Notizen konnten nicht gespeichert werden.' });
    } finally {
      setIsSavingNotes(false);
    }
  };

  const renderDocumentTable = (items: Array<Invoice | CreditNote | Quote | JobEntry>, kind: CustomerDetailTab, compact = false) => {
    if (items.length === 0) {
      const action = kind === 'invoices' ? startInvoice : kind === 'quotes' ? startQuote : kind === 'jobs' ? startJob : undefined;
      const actionLabel = kind === 'invoices' ? 'Rechnung schreiben' : kind === 'quotes' ? 'Angebot erstellen' : kind === 'jobs' ? terminology.work.newLabel : undefined;
      return <EmptyRelation message={`Noch keine ${tabs.find(tab => tab.id === kind)?.label.toLocaleLowerCase('de-DE') || 'Einträge'} für diesen ${terminology.entity.singular}.`} actionLabel={actionLabel} onAction={action} />;
    }

    const sortedItems = compact ? items : sortByTableState(items, documentSort, (item, key) => {
      if (key === 'date') return 'jobNumber' in item ? item.date : 'issueDate' in item ? item.issueDate : '';
      if (key === 'dueDate') return 'dueDate' in item ? item.dueDate : '';
      if (key === 'validUntil') return 'validUntil' in item ? item.validUntil : '';
      if (key === 'title') return 'title' in item ? item.title : '';
      if (key === 'hours') return 'hoursWorked' in item ? item.hoursWorked : 0;
      if (key === 'amount') return 'total' in item ? item.total : 0;
      if (key === 'status') return item.status;
      if ('invoiceNumber' in item) return item.invoiceNumber;
      if ('quoteNumber' in item) return item.quoteNumber;
      return 'jobNumber' in item ? item.jobNumber : '';
    });

    // Die Kurzlisten der Übersicht teilen sich eine Spalte mit dem Nachbarn:
    // dort zählen Nummer, Datum, Betrag/Stunden und Status – ohne Mindestbreite
    // und ohne Sortierung, die dort ohnehin nicht greifen würde.
    const cellPadding = compact ? 'px-2 py-2.5' : 'px-3 py-3';
    const headerPadding = compact ? 'px-2 py-2' : 'px-3 py-2.5';
    const renderHeader = (label: string, sortKey: string, align: 'left' | 'right' = 'left') => compact
      ? <th scope="col" className={`${headerPadding} text-xs font-medium uppercase tracking-wider text-gray-500 ${align === 'right' ? 'text-right' : 'text-left'}`}>{label}</th>
      : <SortableTableHeader label={label} sortKey={sortKey} activeKey={documentSort.key} direction={documentSort.direction} onSort={handleDocumentSort} align={align} className={headerPadding} />;

    return (
      <div className="overflow-hidden rounded-lg border border-gray-200">
        <div className="overflow-x-auto">
          <table className={`w-full text-left text-sm ${compact ? '' : 'min-w-[760px]'}`}>
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                {renderHeader('Nummer', 'number')}
                {renderHeader('Datum', 'date')}
                {!compact && (kind === 'invoices' || kind === 'credit-notes') && renderHeader('Fällig', 'dueDate')}
                {!compact && kind === 'quotes' && renderHeader('Gültig bis', 'validUntil')}
                {!compact && kind === 'jobs' && renderHeader('Bezeichnung', 'title')}
                {kind === 'jobs' ? renderHeader('Stunden', 'hours', 'right') : renderHeader('Betrag', 'amount', 'right')}
                {renderHeader('Status', 'status')}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
          {sortedItems.map(item => {
            const isInvoice = 'invoiceNumber' in item;
            const isQuote = 'quoteNumber' in item;
            const isJob = 'jobNumber' in item;
            const number = isInvoice ? item.invoiceNumber : isQuote ? item.quoteNumber : isJob ? item.jobNumber : '';
            const title = isJob ? item.title : number;
            const date = isJob ? item.date : 'issueDate' in item ? item.issueDate : new Date();
            const total = !isJob && 'total' in item ? item.total : undefined;
            return (
              <tr
                key={item.id}
                onClick={() => {
                  if ('invoiceNumber' in item) onNavigate('invoices', 'all', item.invoiceNumber);
                  else if ('quoteNumber' in item) onNavigate('quote-editor', item.id);
                  else if ('jobNumber' in item) onNavigate('jobs', undefined, item.jobNumber);
                }}
                className="cursor-pointer transition-colors hover:bg-gray-50"
              >
                <td className={`whitespace-nowrap ${cellPadding} font-medium text-gray-900`}>{number || '–'}</td>
                <td className={`whitespace-nowrap ${cellPadding} text-gray-600`}>{formatDate(date, company.locale, company.dateFormat)}</td>
                {!compact && (kind === 'invoices' || kind === 'credit-notes') && <td className={`whitespace-nowrap ${cellPadding} text-gray-600`}>{'dueDate' in item ? formatDate(item.dueDate, company.locale, company.dateFormat) : '–'}</td>}
                {!compact && kind === 'quotes' && <td className={`whitespace-nowrap ${cellPadding} text-gray-600`}>{'validUntil' in item ? formatDate(item.validUntil, company.locale, company.dateFormat) : '–'}</td>}
                {!compact && kind === 'jobs' && <td className={`max-w-[280px] truncate ${cellPadding} text-gray-900`} title={title}>{title}</td>}
                {kind === 'jobs'
                  ? <td className={`whitespace-nowrap ${cellPadding} text-right tabular-nums text-gray-600`}>{formatNumber(('hoursWorked' in item ? item.hoursWorked : 0) || 0, company.locale, company.numberFormat, 2)} h</td>
                  : <td className={`whitespace-nowrap ${cellPadding} text-right font-medium tabular-nums text-gray-900`}>{total !== undefined ? money(total) : '–'}</td>}
                <td className={`whitespace-nowrap ${cellPadding}`}><StatusBadge status={item.status} /></td>
              </tr>
            );
          })}
            </tbody>
          </table>
        </div>
        <div className="border-t border-gray-200 bg-gray-50 px-3 py-2 text-right text-xs text-gray-500">{items.length} {items.length === 1 ? 'Eintrag' : 'Einträge'}</div>
      </div>
    );
  };

  return (
    <div className="page-root space-y-6">
      <PageHeader
        icon={customer.customerType === 'organization' ? Building2 : UserRound}
        title={customer.name}
        subtitle={`${typeLabel(customer)} · ${terminology.entity.numberShortLabel} ${customer.customerNumber}`}
      >
        <button type="button" onClick={() => onNavigate('customers')} className="action-button" title="Zur Kundenübersicht"><ArrowLeft className="h-4 w-4" />Kunden</button>
        {canWrite && <button type="button" onClick={() => onNavigate('customers', 'edit', customer.id)} className="action-button" title="Kunden bearbeiten"><Edit className="h-4 w-4" />Bearbeiten</button>}
        <ActionMenu menuClassName="min-w-56">
          {canWrite && <>
            <ActionMenuItem icon={<FileText className="h-4 w-4" />} tone="blue" onClick={startInvoice}>Rechnung schreiben</ActionMenuItem>
            {company.quotesEnabled && <ActionMenuItem icon={<FileCheck className="h-4 w-4" />} tone="orange" onClick={startQuote}>Angebot erstellen</ActionMenuItem>}
            {company.jobTrackingEnabled && <ActionMenuItem icon={<Briefcase className="h-4 w-4" />} tone="green" onClick={startJob}>{terminology.work.newLabel}</ActionMenuItem>}
            <ActionMenuItem icon={<StickyNote className="h-4 w-4" />} onClick={() => openTab('notes')}>Notiz hinzufügen</ActionMenuItem>
          </>}
          <ActionMenuItem icon={<Download className="h-4 w-4" />} onClick={() => downloadCustomerCsv([customer], `kunde-${customer.customerNumber}`)}>Als CSV exportieren</ActionMenuItem>
          <ActionMenuItem icon={<Download className="h-4 w-4" />} onClick={() => downloadCustomerPdf([customer], `kunde-${customer.customerNumber}`)}>Als PDF exportieren</ActionMenuItem>
        </ActionMenu>
      </PageHeader>

      <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <nav className="flex min-w-0 gap-1 overflow-x-auto border-b border-gray-200 px-3 pt-2" aria-label="Kundenbereiche">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            const count = tab.id === 'invoices' ? customerInvoices.length : tab.id === 'credit-notes' ? customerCreditNotes.length : tab.id === 'quotes' ? customerQuotes.length : tab.id === 'jobs' ? customerJobs.length : undefined;
            return (
              <button
                type="button"
                key={tab.id}
                onClick={() => openTab(tab.id)}
                className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition-colors ${active ? 'border-primary-custom text-primary-custom' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800'}`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {tab.label}
                {count !== undefined && <span className={`rounded-full px-1.5 py-0.5 text-xs ${active ? 'bg-primary-custom/10 text-primary-custom' : 'bg-gray-100 text-gray-500'}`}>{count}</span>}
              </button>
            );
          })}
        </nav>

        <div className="p-4 sm:p-6">
          {activeTab === 'overview' && (
            <>
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                <section className="rounded-lg border border-gray-200 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-gray-900">Verlauf</h2>
                      <p className="mt-1 text-sm text-gray-500">Die neuesten Aktivitäten dieses Kunden.</p>
                    </div>
                    <Activity className="mt-0.5 h-5 w-5 shrink-0 text-gray-400" aria-hidden="true" />
                  </div>
                  {customerActivities.length > 0 ? (
                    <ol className="mt-5 space-y-5">
                      {customerActivities.map((activity, index) => {
                        const Icon = activity.Icon;
                        return (
                          <li key={activity.id} className="relative flex gap-3">
                            {index < customerActivities.length - 1 && <span className="absolute bottom-[-1.25rem] left-4 top-9 w-px bg-gray-200" aria-hidden="true" />}
                            <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-custom/10 text-primary-custom"><Icon className="h-4 w-4" aria-hidden="true" /></span>
                            <div className="min-w-0 pt-0.5">
                              <p className="text-sm leading-6 text-gray-800">{activity.text}</p>
                              <p className="mt-0.5 text-xs text-gray-500">{formatDate(activity.date, company.locale, company.dateFormat)}</p>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  ) : (
                    <p className="mt-5 rounded-lg border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500">Noch keine Aktivitäten für diesen Kunden.</p>
                  )}
                </section>

                <div className="space-y-5">
                  <section className="rounded-lg border border-gray-200 p-5">
                    <div className="flex items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-custom/10 text-primary-custom"><TypeIcon customer={customer} /></span>
                      <div className="min-w-0">
                        <h2 className="truncate text-xl font-semibold text-gray-900">{customer.name}</h2>
                        <p className="mt-1 text-sm text-gray-500">{typeLabel(customer)}</p>
                      </div>
                    </div>
                    <h3 className="mt-5 text-base font-semibold text-gray-900">Kontakt</h3>
                    <div className="mt-4 space-y-3 text-sm">
                      <div className="flex min-w-0 items-center gap-3"><Mail className="h-4 w-4 shrink-0 text-gray-400" /><span className="truncate text-gray-900">{customer.email || 'Keine E-Mail hinterlegt'}</span></div>
                      <div className="flex min-w-0 items-center gap-3"><Phone className="h-4 w-4 shrink-0 text-gray-400" /><span className="truncate text-gray-900">{customer.phone || 'Keine Telefonnummer hinterlegt'}</span></div>
                      {(customer.additionalEmails || []).map(email => <div key={email.id} className="flex min-w-0 items-center gap-3 text-gray-600"><Mail className="h-4 w-4 shrink-0 text-gray-400" /><span className="truncate">{email.email}{email.label ? ` · ${email.label}` : ''}</span></div>)}
                    </div>
                    <div className="mt-5 border-t border-gray-100 pt-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Adresse</p>
                      <p className="mt-1 text-sm leading-6 text-gray-900">{[customer.address, customer.addressSupplement, [customer.postalCode, customer.city].filter(Boolean).join(' '), customer.country].filter(Boolean).map((value, index) => <span key={`${value}-${index}`} className="block">{value}</span>)}</p>
                    </div>
                    {(customer.taxId || customer.leitwegId) && <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                      {customer.taxId && <div><dt className="text-xs font-medium uppercase tracking-wide text-gray-500">USt-IdNr.</dt><dd className="mt-1 text-sm text-gray-900">{customer.taxId}</dd></div>}
                      {customer.leitwegId && <div><dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Leitweg-ID</dt><dd className="mt-1 break-all text-sm text-gray-900">{customer.leitwegId}</dd></div>}
                    </dl>}
                  </section>

                  <section className="rounded-lg border border-gray-200 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-base font-semibold text-gray-900">Notizen</h2>
                      <span className="text-xs text-gray-500">{notes.length}/5000</span>
                    </div>
                    <textarea value={notes} onChange={event => setNotes(event.target.value)} disabled={!canWrite || isSavingNotes} maxLength={5000} rows={6} className="form-input mt-3 w-full resize-y" placeholder="Notizen zum Kunden" />
                    {canWrite && <div className="mt-3 flex justify-end"><button type="button" onClick={() => void saveNotes()} disabled={isSavingNotes} className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"><Check className="h-4 w-4" />{isSavingNotes ? 'Speichern …' : 'Notizen speichern'}</button></div>}
                  </section>
                </div>
              </div>
            </>
          )}

          {activeTab === 'invoices' && (
            <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-gray-900">Rechnungen</h2><p className="mt-1 text-sm text-gray-500">Alle Rechnungen dieses Kunden.</p></div>{canWrite && <button type="button" onClick={startInvoice} className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white"><FileText className="h-4 w-4" />Rechnung schreiben</button>}</div>{renderDocumentTable(customerInvoices, 'invoices')}</div>
          )}
          {activeTab === 'credit-notes' && (
            <div className="space-y-4"><div><h2 className="text-lg font-semibold text-gray-900">Gutschriften</h2><p className="mt-1 text-sm text-gray-500">Alle Gutschriften dieses Kunden.</p></div>{creditNotesLoading ? <TableSkeleton rows={3} columns={5} label="Gutschriften werden geladen …" className="overflow-hidden rounded-lg border border-gray-200" /> : renderDocumentTable(customerCreditNotes, 'credit-notes')}</div>
          )}
          {activeTab === 'quotes' && (
            <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-gray-900">Angebote</h2><p className="mt-1 text-sm text-gray-500">Alle Angebote dieses Kunden.</p></div>{canWrite && company.quotesEnabled && <button type="button" onClick={startQuote} className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white"><FileCheck className="h-4 w-4" />Angebot erstellen</button>}</div>{renderDocumentTable(customerQuotes, 'quotes')}</div>
          )}
          {activeTab === 'jobs' && (
            <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-gray-900">{terminology.work.plural}</h2><p className="mt-1 text-sm text-gray-500">Alle {terminology.work.plural.toLocaleLowerCase('de-DE')} dieses Kunden.</p></div>{canWrite && company.jobTrackingEnabled && <button type="button" onClick={startJob} className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white"><Briefcase className="h-4 w-4" />{terminology.work.newLabel}</button>}</div>{renderDocumentTable(customerJobs, 'jobs')}</div>
          )}
          {activeTab === 'notes' && (
            <div className="max-w-3xl space-y-4"><div><h2 className="text-lg font-semibold text-gray-900">Notizen</h2><p className="mt-1 text-sm text-gray-500">Interne Hinweise, die nur im Workspace sichtbar sind.</p></div><textarea value={notes} onChange={event => setNotes(event.target.value)} disabled={!canWrite || isSavingNotes} maxLength={5000} rows={8} className="form-input w-full resize-y" placeholder="Notizen zum Kunden" /><div className="flex items-center justify-between gap-3"><span className="text-xs text-gray-500">{notes.length} von 5000 Zeichen</span>{canWrite && <button type="button" onClick={() => void saveNotes()} disabled={isSavingNotes} className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"><Check className="h-4 w-4" />{isSavingNotes ? 'Speichern …' : 'Notizen speichern'}</button>}</div></div>
          )}
        </div>
      </section>
    </div>
  );
}
