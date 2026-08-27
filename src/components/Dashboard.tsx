import React, { useEffect, useState } from 'react';
import logger from '../utils/logger';
import { AlertTriangle, Banknote, CalendarDays, CheckCircle, ChevronRight, FileText, GraduationCap, Home, Send } from 'lucide-react';
import { useCustomers } from '../context/CustomerContext';
import { useInvoices } from '../context/InvoiceContext';
import { useJobs } from '../context/JobContext';
import { useCompany } from '../context/CompanyContext';
import { useLoading } from '../context/LoadingContext';
import { calculateTotalHours } from '../utils/jobUtils';
import { formatCurrency, formatDate, formatNumber, formatTime } from '../utils/formatters';
import { blobToBase64 } from '../utils/blobUtils';
import { EmailSendModal } from './EmailSendModal';
import { generateInvoicePDF } from '../utils/pdfGenerator';
import { processAttachments } from '../utils/fileUtils';
import { apiService } from '../services/api';
import type { Invoice, JobEntry, NumberFormat, TimeFormat } from '../types';
import { PageHeader } from './PageHeader';

import { getTerminology } from '../utils/terminology';
import { useFeedback } from '../context/FeedbackContext';

interface DashboardProps {
  onNavigate: (page: string, filter?: string, searchTerm?: string, invoiceId?: string, jobSeriesId?: string) => void;
}

type DashboardCourseSeries = {
  key: string;
  job: JobEntry;
  jobs: JobEntry[];
};

function parseLocalJobDate(value: Date | string | number): Date {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  if (typeof value === 'string') {
    const datePart = value.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      return new Date(`${datePart}T00:00:00`);
    }
  }

  const parsed = new Date(value);
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function getWeekStart(value: Date): Date {
  const start = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const isoWeekday = start.getDay() === 0 ? 7 : start.getDay();
  start.setDate(start.getDate() - isoWeekday + 1);
  return start;
}

function getCalendarWeek(value: Date): number {
  const target = new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  const dayNumber = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function getJobTimeRange(
  job: JobEntry,
  locale: string,
  timeFormat?: TimeFormat,
  numberFormat?: NumberFormat,
): string {
  const firstTimeEntry = job.timeEntries?.find(entry => entry.startTime || entry.endTime);
  const startTime = job.startTime || firstTimeEntry?.startTime;
  const endTime = job.endTime || firstTimeEntry?.endTime;

  if (startTime && endTime) {
    return `${formatTime(startTime, locale, timeFormat)} – ${formatTime(endTime, locale, timeFormat)}`;
  }

  if (startTime) {
    return `ab ${formatTime(startTime, locale, timeFormat)}`;
  }

  const hours = calculateTotalHours(job);
  return hours > 0 ? `${formatNumber(hours, locale, numberFormat, 1)} Std.` : 'Zeit offen';
}

function getJobStatusDotColor(status: JobEntry['status']): string {
  switch (status) {
    case 'in-progress': return 'bg-yellow-500';
    case 'completed': return 'bg-green-500';
    case 'invoiced': return 'bg-blue-500';
    default: return 'bg-gray-400';
  }
}

function getJobStatusLabel(status: JobEntry['status']): string {
  switch (status) {
    case 'in-progress': return 'In Bearbeitung';
    case 'completed': return 'Abgeschlossen';
    case 'invoiced': return 'Abgerechnet';
    default: return 'Entwurf';
  }
}

export function Dashboard({ onNavigate }: DashboardProps) {
  const { notify } = useFeedback();
  const { customers } = useCustomers();
  const { invoices, updateInvoice } = useInvoices();
  const { jobEntries } = useJobs();
  const { company } = useCompany();
  const terminology = getTerminology(company.terminologyProfile);
  const { loading } = useLoading();

  // Email modal state
  const [emailModal, setEmailModal] = useState<{
    isOpen: boolean;
    invoice: Invoice | null;
    customer: { email: string; additionalEmails?: { id: string; email: string; label?: string; isActive: boolean }[] } | null;
  }>({
    isOpen: false,
    invoice: null,
    customer: null
  });
  const [isSendingEmail, setIsSendingEmail] = useState<string | null>(null);

  // Get locale from company settings, default to 'de-DE'
  const locale = company?.locale || 'de-DE';

  const today = new Date();
  const todayDate = parseLocalJobDate(today);
  const currentWeekStart = getWeekStart(today);
  const currentWeekEnd = new Date(currentWeekStart);
  currentWeekEnd.setDate(currentWeekEnd.getDate() + 6);
  const currentWeekNumber = getCalendarWeek(today);

  const currentWeekJobs = jobEntries
    .map(job => ({ job, date: parseLocalJobDate(job.date) }))
    .filter(({ date }) => date >= currentWeekStart && date <= currentWeekEnd)
    .sort((a, b) => {
      const dateDifference = a.date.getTime() - b.date.getTime();
      if (dateDifference !== 0) return dateDifference;
      return (a.job.startTime || '').localeCompare(b.job.startTime || '');
    });

  const currentWeekDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(currentWeekStart);
    date.setDate(date.getDate() + index);

    return {
      date,
      jobs: currentWeekJobs
        .filter(({ date: jobDate }) => jobDate.getTime() === date.getTime())
        .map(({ job }) => job),
    };
  });

  const recurringJobsBySeries = new Map<string, JobEntry[]>();
  jobEntries.forEach(job => {
    const seriesId = job.recurrence?.id;
    if (!seriesId) return;
    const seriesJobs = recurringJobsBySeries.get(seriesId) || [];
    seriesJobs.push(job);
    recurringJobsBySeries.set(seriesId, seriesJobs);
  });

  const ongoingCourseSeries: DashboardCourseSeries[] = Array.from(recurringJobsBySeries.entries())
    .filter(([, jobs]) => jobs.length > 1 && jobs.some(job => job.status === 'draft' || job.status === 'in-progress'))
    .map(([key, jobs]) => {
      const sortedJobs = [...jobs].sort(
        (a, b) => parseLocalJobDate(a.date).getTime() - parseLocalJobDate(b.date).getTime(),
      );
      const activeJobs = sortedJobs.filter(job => job.status === 'draft' || job.status === 'in-progress');
      const representativeJob = activeJobs.find(job => parseLocalJobDate(job.date) >= todayDate)
        || activeJobs[0]
        || sortedJobs[0];

      return { key, job: representativeJob, jobs: sortedJobs };
    })
    .sort((a, b) => parseLocalJobDate(a.job.date).getTime() - parseLocalJobDate(b.job.date).getTime());

  const handleSendEmail = async (invoice: Invoice) => {
    const customer = customers.find(c => c.id === invoice.customerId);
    if (!customer) {
      notify({ variant: 'error', message: `${terminology.entity.dataLabel} nicht gefunden.` });
      return;
    }

    if (!customer.email) {
      notify({ variant: 'warning', message: terminology.entity.emailMissingMessage });
      return;
    }

    // Open email dialog with customer data
    setEmailModal({
      isOpen: true,
      invoice,
      customer: {
        email: customer.email,
        additionalEmails: customer.additionalEmails
      }
    });
  };

  const handleEmailSend = async (formats: ('zugferd' | 'xrechnung')[], customText?: string, attachments?: { id: string; file: File; name: string; size: number }[], selectedInvoiceAttachmentIds?: string[], selectedEmails?: string[], manualEmails?: string[]) => {
    if (!emailModal.invoice) return;
    
    setIsSendingEmail(emailModal.invoice.id);
    
    try {
      // Combine selected emails and manual emails
      const allEmails = [...(selectedEmails || []), ...(manualEmails?.filter(email => email.trim()) || [])];
      
      if (allEmails.length === 0) {
        notify({ variant: 'warning', message: 'Bitte wählen Sie mindestens eine E-Mail-Adresse aus.' });
        return;
      }

      // Generate PDFs for each format and send emails
      const customer = customers.find(c => c.id === emailModal.invoice!.customerId);
      if (!customer) {
      notify({ variant: 'error', message: `${terminology.entity.dataLabel} nicht gefunden.` });
        return;
      }

      // Process additional attachments
      let processedAttachments: { name: string; content: string; contentType: string }[] = [];
      if (attachments && attachments.length > 0) {
        try {
          processedAttachments = await processAttachments(attachments);
        } catch (error) {
          logger.error('Fehler beim Verarbeiten der Anhänge:', error);
          notify({ variant: 'error', message: 'Fehler beim Verarbeiten der Anhänge' });
          return;
        }
      }

      // Add selected invoice attachments to the processed attachments
      if (selectedInvoiceAttachmentIds && selectedInvoiceAttachmentIds.length > 0 && emailModal.invoice.attachments) {
        const selectedInvoiceAttachments = emailModal.invoice.attachments.filter(att => 
          selectedInvoiceAttachmentIds.includes(att.id)
        );
        
        for (const attachment of selectedInvoiceAttachments) {
          processedAttachments.push({
            name: attachment.name,
            content: attachment.content,
            contentType: attachment.contentType
          });
        }
      }

      // Send email for each selected format
      const invoiceFormats = [];
      
      for (const format of formats) {
        const pdfBlob = await generateInvoicePDF(emailModal.invoice, {
          format,
          company,
          customer
        });
        
        // Convert blob to base64 - use safe method for large files
        const base64PDF = await blobToBase64(pdfBlob);
        
        invoiceFormats.push({
          format,
          content: base64PDF
        });
      }
      
      // Send email to all recipients
      const result = await apiService.sendInvoiceEmailMultiFormat(
        allEmails, 
        invoiceFormats,
        emailModal.invoice, 
        customText,
        processedAttachments
      );
      
      if (!result.success) {
        throw new Error(`Fehler beim E-Mail-Versand: ${result.message}`);
      }
      
      const formatLabels = formats.map(f => {
        switch(f) {
          case 'zugferd': return 'PDF';
          case 'xrechnung': return 'XRechnung';
          default: return f;
        }
      });
      
      const attachmentInfo = attachments && attachments.length > 0 
        ? ` mit ${attachments.length} zusätzlichen Anhang${attachments.length > 1 ? 'en' : ''}`
        : '';
      
      notify({ variant: 'success', message: `Rechnung erfolgreich per E-Mail versendet! (${formatLabels.join(', ')})${attachmentInfo}` });
      
      // Automatically mark as sent if it was draft
      if (emailModal.invoice.status === 'draft') {
        await updateInvoice(emailModal.invoice.id, { status: 'sent' });
      }
      
      // Close email dialog
      setEmailModal({ isOpen: false, invoice: null, customer: null });
    } catch (error) {
      logger.error('Fehler beim E-Mail-Versand:', error);
      notify({ variant: 'error', message: 'Fehler beim E-Mail-Versand: ' + (error as Error).message });
    } finally {
      setIsSendingEmail(null);
    }
  };

  const handleEmailModalClose = () => {
    setEmailModal({ isOpen: false, invoice: null, customer: null });
  };

  // Check for overdue invoices automatically on every load
  useEffect(() => {
    const checkOverdueInvoices = async () => {
      if (loading || invoices.length === 0) return;
      
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Set to start of day for accurate comparison
      
      const overdueUpdates = invoices
        .filter(invoice => {
          // Only check sent invoices that are not already overdue or paid
          if (invoice.status !== 'sent') return false;
          
          const dueDate = new Date(invoice.dueDate);
          dueDate.setHours(0, 0, 0, 0);
          
          return dueDate < today;
        })
        .map(invoice => invoice.id);
      
      // Update overdue invoices
      for (const invoiceId of overdueUpdates) {
        try {
          await updateInvoice(invoiceId, { status: 'overdue' });
        } catch (error) {
          logger.error('Error updating invoice to overdue:', error);
        }
      }
      
      if (overdueUpdates.length > 0) {
        logger.info(`${overdueUpdates.length} invoices automatically marked as overdue`, { count: overdueUpdates.length });
      }
    };

    // Run overdue check whenever data is loaded
    if (!loading && invoices.length > 0) {
      checkOverdueInvoices();
    }
  }, [loading, invoices, updateInvoice]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-custom mx-auto"></div>
          <p className="mt-4 text-gray-600">Lade Daten...</p>
        </div>
      </div>
    );
  }

  // Umsatz pro Monat berechnen
  const monthlyRevenue: { [month: string]: number } = {};
  invoices.forEach(invoice => {
    const date = new Date(invoice.issueDate);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    monthlyRevenue[monthKey] = (monthlyRevenue[monthKey] || 0) + invoice.total;
  });
  const monthlyRevenueSorted = Object.entries(monthlyRevenue)
    .sort((a, b) => a[0].localeCompare(b[0]));
  const maxMonthlyRevenue = monthlyRevenueSorted.reduce(
    (maxRevenue, [, revenue]) => Math.max(maxRevenue, revenue),
    0,
  );
  const formatMonthLabel = (monthKey: string) => {
    const [year, month] = monthKey.split('-').map(Number);
    return new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' }).format(new Date(year, month - 1, 1));
  };

  const sumOf = (status: Invoice['status']) => invoices
    .filter(invoice => invoice.status === status)
    .reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
  const paidAmount = invoices.reduce((sum, invoice) => (
    sum + Number(invoice.paidAmount ?? (invoice.status === 'paid' ? invoice.total : 0))
  ), 0);
  const overdueAmount = invoices
    .filter(invoice => invoice.status === 'overdue')
    .reduce((sum, invoice) => sum + Number(invoice.outstandingAmount ?? invoice.total), 0);

  const stats = {
    totalInvoices: invoices.length,
    totalCustomers: customers.length,
    totalRevenue: invoices.reduce((sum, invoice) => sum + invoice.total, 0),
    paidInvoices: invoices.filter(invoice => invoice.status === 'paid').length,
    draftInvoices: invoices.filter(invoice => invoice.status === 'draft').length,
    overdueInvoices: invoices.filter(invoice => invoice.status === 'overdue').length,
    paidAmount,
    draftAmount: sumOf('draft'),
    overdueAmount,
  };

  /**
   * Die Kennzahlen führen den Betrag mit: Für eine Rechnungsanwendung ist die
   * offene Summe die eigentliche Aussage, die reine Anzahl sagt wenig.
   */
  const summaryCards = [
    {
      id: 'draft',
      label: 'Entwürfe',
      hint: 'Noch nicht versendet',
      count: stats.draftInvoices,
      amount: stats.draftAmount,
      icon: FileText,
      accent: 'bg-amber-500',
      iconClass: 'text-amber-600',
      filter: 'draft',
    },
    {
      id: 'overdue',
      label: 'Überfällig',
      hint: 'Zahlungsziel überschritten',
      count: stats.overdueInvoices,
      amount: stats.overdueAmount,
      icon: AlertTriangle,
      accent: 'bg-red-500',
      iconClass: 'text-red-600',
      filter: 'overdue',
    },
    {
      id: 'paid',
      label: 'Bezahlt',
      hint: 'Zahlungseingang verbucht',
      count: stats.paidInvoices,
      amount: stats.paidAmount,
      icon: CheckCircle,
      accent: 'bg-green-500',
      iconClass: 'text-green-600',
      filter: 'paid',
    },
  ];

  const recentInvoices = [...invoices]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'paid': return 'Bezahlt';
      case 'sent': return 'Versendet';
      case 'draft': return 'Entwurf';
      case 'overdue': return 'Überfällig';
      default: return status;
    }
  };

  const getStatusDotColor = (status: string) => {
    switch (status) {
      case 'paid': return 'bg-green-500';
      case 'sent': return 'bg-blue-500';
      case 'draft': return 'bg-gray-400';
      case 'overdue': return 'bg-red-500';
      default: return 'bg-gray-400';
    }
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      {/* Der Navigationspunkt heißt „Übersicht“; die Seitenüberschrift folgt
          derselben Bezeichnung. */}
      <PageHeader icon={Home} title="Übersicht" subtitle={`Ihre Rechnungen und ${terminology.entity.plural} auf einen Blick`} />

      {/* Kennzahlen. Der farbige Streifen am oberen Rand ersetzt die früheren
          Farbflächen: Er ordnet die Karte einem Status zu, ohne den Inhalt
          einzufärben, und trägt in beiden Farbmodi. */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        {summaryCards.map(({ id, label, hint, count, amount, icon: CardIcon, accent, iconClass, filter }) => (
          <button
            key={id}
            type="button"
            onClick={() => onNavigate('invoices', filter)}
            className="group relative min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-white p-3 text-left shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 sm:p-4"
          >
            <span className={`absolute inset-x-0 top-0 h-1 ${accent}`} aria-hidden="true" />
            {/* Symbol und Einheit weichen auf schmalen Geräten: Bei drei Spalten
                auf 375 Pixeln bliebe die Beschriftung sonst abgeschnitten. Der
                farbige Streifen trägt die Statuszuordnung ohnehin. */}
            <span className="flex min-w-0 items-center gap-1.5 pt-1">
              <CardIcon className={`hidden h-4 w-4 shrink-0 sm:block ${iconClass}`} aria-hidden="true" />
              <span className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</span>
            </span>
            <span className="mt-2 flex min-w-0 items-baseline gap-1.5">
              <span className="text-2xl font-bold leading-none text-gray-900 sm:text-3xl">{count}</span>
              <span className="hidden min-w-0 truncate text-[11px] text-gray-500 sm:inline">{count === 1 ? 'Rechnung' : 'Rechnungen'}</span>
            </span>
            <span className="mt-2 block truncate text-sm font-semibold text-gray-900">
              {formatCurrency(amount, locale, company?.numberFormat, company?.currency)}
            </span>
            <span className="mt-0.5 hidden truncate text-[11px] text-gray-500 sm:block">{hint}</span>
          </button>
        ))}
      </div>

      {/* Termine der aktuellen Kalenderwoche */}
      <section className="min-w-0 overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
          <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-4 lg:px-6">
            <div className="flex min-w-0 items-start gap-3">
              <div className="shrink-0 rounded-lg bg-primary-custom/10 p-2 text-primary-custom">
                <CalendarDays className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold text-gray-900 lg:text-lg">Termine · KW {currentWeekNumber}</h3>
                <p className="mt-0.5 truncate text-xs text-gray-500">
                  {formatDate(currentWeekStart, locale, company?.dateFormat)} – {formatDate(currentWeekEnd, locale, company?.dateFormat)}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('calendar')}
              className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary-custom transition-colors hover:text-primary-custom/80"
            >
              Kalender
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {currentWeekJobs.length > 0 ? (
            <div className="overflow-x-auto">
              <div className="grid min-w-[700px] grid-cols-7 divide-x divide-gray-200">
                {currentWeekDays.map(({ date, jobs }) => {
                  const isToday = date.getTime() === parseLocalJobDate(today).getTime();

                  return (
                    <div key={date.toISOString()} className={`min-w-0 ${isToday ? 'bg-primary-custom/5' : ''}`}>
                      <div className={`border-b border-gray-200 px-2 py-2 text-center ${isToday ? 'bg-primary-custom/10' : 'bg-gray-50'}`}>
                        <div className="text-xs font-semibold uppercase text-gray-500">
                          {date.toLocaleDateString(locale, { weekday: 'short' }).replace('.', '')}
                        </div>
                        <div className={`mt-0.5 text-sm font-semibold ${isToday ? 'text-primary-custom' : 'text-gray-900'}`}>
                          {formatDate(date, locale, company?.dateFormat)}
                        </div>
                      </div>
                      <div className="min-h-[5.5rem] space-y-2 p-2">
                        {jobs.length > 0 ? jobs.map((job) => (
                          <button
                            key={job.id}
                            type="button"
                            onClick={() => onNavigate('jobs', undefined, job.jobNumber)}
                            className="group relative w-full min-w-0 overflow-hidden rounded-lg border border-gray-200 bg-gray-50 py-2 pl-3 pr-2 text-left transition-colors hover:border-primary-custom hover:bg-primary-custom/5"
                            aria-label={`${job.title} am ${formatDate(date, locale, company?.dateFormat)} · ${getJobStatusLabel(job.status)} öffnen`}
                            title={getJobStatusLabel(job.status)}
                          >
                            {/* Der Status liegt als Streifen am linken Rand statt
                                als Punkt in der Zeile: In den schmalen Tagesspalten
                                bleibt so die volle Breite für Titel und Kunde. */}
                            <span
                              className={`absolute inset-y-0 left-0 w-1 ${getJobStatusDotColor(job.status)}`}
                              aria-hidden="true"
                            />
                            <span className="block min-w-0">
                              <span className="block truncate text-xs font-semibold text-gray-900 group-hover:text-primary-custom">{job.title}</span>
                              <span className="mt-1 block truncate text-[11px] text-gray-500">{job.customerName}</span>
                              <span className="mt-1 block truncate text-[11px] text-gray-500">
                                {getJobTimeRange(job, locale, company?.timeFormat, company?.numberFormat)}
                              </span>
                            </span>
                          </button>
                        )) : (
                          <div className="pt-3 text-center text-xs text-gray-400">–</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-sm text-gray-500 lg:px-6">
              In dieser Kalenderwoche sind keine Termine geplant.
            </div>
          )}
      </section>

      {/* Recent Invoices */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="px-4 lg:px-6 py-4 border-b border-gray-200 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
          <h3 className="text-base lg:text-lg font-semibold text-gray-900">Aktuelle Rechnungen</h3>
          <button
            onClick={() => onNavigate('invoices')}
            className="hidden text-sm text-primary-custom hover:text-primary-custom/80 font-medium transition-colors tablet:inline-block"
          >
            Alle anzeigen →
          </button>
        </div>
        
        {/* Desktop Table View */}
        <div className="hidden tablet:block w-full max-w-full overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Datum
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Rechnungsnummer
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{terminology.entity.singular}</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Betrag</th>
                <th className="sticky right-0 z-20 w-14 bg-gray-50 px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider 2xl:w-44 2xl:px-3">
                  <span className="sr-only">Aktionen</span>
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {recentInvoices.map((invoice) => (
                <tr 
                  key={invoice.id} 
                  className="hover:bg-gray-50 cursor-pointer transition-colors duration-200"
                  onClick={() => onNavigate('invoices', 'all', invoice.invoiceNumber)}
                  title={`Zur Rechnung ${invoice.invoiceNumber}`}
                >
                  <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">
                    {formatDate(invoice.issueDate, locale, company?.dateFormat)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-sm font-medium text-primary-custom hover:text-primary-custom/80">
                    <span className="inline-flex items-center gap-2">
                      {invoice.invoiceNumber}
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${getStatusDotColor(invoice.status)}`}
                        title={getStatusLabel(invoice.status)}
                        aria-label={getStatusLabel(invoice.status)}
                      />
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">
                    {invoice.customerName}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-right text-sm text-gray-900">
                    {formatCurrency(invoice.total, locale, company?.numberFormat, company?.currency)}
                  </td>
                  {/* Eine Zeile hat höchstens eine Aktion. Ein Drei-Punkte-Menü
                      würde bei bezahlten Rechnungen leer aufklappen. */}
                  <td className="sticky right-0 z-10 w-14 bg-white px-2 py-2 whitespace-nowrap">
                    <div
                      className="flex items-center justify-end gap-1"
                      onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    >
                      {invoice.status === 'draft' && (
                        <button
                          type="button"
                          className="action-icon-button action-icon-blue"
                          title="Per E-Mail versenden"
                          aria-label="Per E-Mail versenden"
                          onClick={() => handleSendEmail(invoice)}
                        >
                          <Send className="h-4 w-4" />
                        </button>
                      )}
                      {(invoice.status === 'sent' || invoice.status === 'overdue') && (
                        <button
                          type="button"
                          className="action-icon-button action-icon-green"
                          title="Zahlungseingang in der Rechnung erfassen"
                          aria-label="Zahlungseingang erfassen"
                          onClick={() => onNavigate('invoices', 'all', invoice.invoiceNumber)}
                        >
                          <Banknote className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile Card View */}
        <div className="tablet:hidden">
          {recentInvoices.map((invoice) => (
                <div
                  key={invoice.id}
                  className="p-3 sm:p-4 border-b border-gray-200 last:border-b-0 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => onNavigate('invoices', 'all', invoice.invoiceNumber)}
                >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <h4 className="min-w-0 truncate text-sm font-medium text-primary-custom">{invoice.invoiceNumber}</h4>
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${getStatusDotColor(invoice.status)}`}
                      title={getStatusLabel(invoice.status)}
                      aria-label={getStatusLabel(invoice.status)}
                    />
                  </div>
                  <div className="mt-1 flex min-w-0 items-center gap-2 text-xs">
                    <p className="min-w-0 truncate text-sm text-gray-900">{invoice.customerName}</p>
                    <span className="shrink-0 text-gray-500">{formatDate(invoice.issueDate, locale, company?.dateFormat)}</span>
                  </div>
                </div>
                <div
                    className="flex shrink-0 items-center gap-2"
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  >
                    <span className="min-w-0 text-right text-sm font-medium text-gray-900">
                      {formatCurrency(invoice.total, locale, company?.numberFormat, company?.currency)}
                    </span>
                    {invoice.status === 'draft' && (
                      <button
                        type="button"
                        className="action-icon-button action-icon-blue shrink-0"
                        title="Per E-Mail versenden"
                        aria-label="Per E-Mail versenden"
                        onClick={() => handleSendEmail(invoice)}
                      >
                        <Send className="h-4 w-4" />
                      </button>
                    )}
                    {(invoice.status === 'sent' || invoice.status === 'overdue') && (
                      <button
                        type="button"
                        className="action-icon-button action-icon-green shrink-0"
                        title="Zahlungseingang in der Rechnung erfassen"
                        aria-label="Zahlungseingang erfassen"
                        onClick={() => onNavigate('invoices', 'all', invoice.invoiceNumber)}
                      >
                        <Banknote className="h-4 w-4" />
                      </button>
                    )}
                </div>
              </div>
            </div>
          ))}
          {recentInvoices.length > 0 && (
            <div className="flex justify-end px-3 py-3 sm:px-4">
              <button
                type="button"
                onClick={() => onNavigate('invoices')}
                className="inline-flex items-center gap-1 text-sm font-medium text-primary-custom transition-colors hover:text-primary-custom/80"
              >
                Alle Rechnungen
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {recentInvoices.length === 0 && (
          <div className="text-center py-8">
            <p className="text-gray-500">Noch keine Rechnungen vorhanden</p>
          </div>
        )}
      </div>

      <div className={`grid min-w-0 gap-4 ${ongoingCourseSeries.length > 0 ? 'lg:grid-cols-2' : ''}`}>
        {ongoingCourseSeries.length > 0 && (
          <section className="min-w-0 overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
            <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-4 lg:px-6">
              <div className="flex min-w-0 items-start gap-3">
                <div className="shrink-0 rounded-lg bg-primary-custom/10 p-2 text-primary-custom">
                  <GraduationCap className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold text-gray-900 lg:text-lg">
                    {terminology.work.plural.toLocaleLowerCase('de-DE').includes('kurs') ? 'Laufende Kursserien' : `Laufende ${terminology.work.plural}`}
                  </h3>
                  <p className="mt-0.5 text-xs text-gray-500">Regelmäßige Termine im Überblick</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('jobs')}
                className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary-custom transition-colors hover:text-primary-custom/80"
              >
                Alle anzeigen
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="divide-y divide-gray-100">
              {ongoingCourseSeries.slice(0, 5).map((series) => {
                const weekAppointmentCount = series.jobs.filter((job) => {
                  const date = parseLocalJobDate(job.date);
                  return date >= currentWeekStart && date <= currentWeekEnd;
                }).length;

                return (
                  <button
                    key={series.key}
                    type="button"
                    onClick={() => onNavigate('jobs', undefined, undefined, undefined, series.key)}
                    className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 lg:px-6"
                    aria-label={`${series.job.title} Kursserie öffnen`}
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-yellow-500" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-gray-900">{series.job.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-gray-500">{series.job.customerName}</span>
                    </span>
                    <span className="shrink-0 text-right text-xs text-gray-500">
                      <span className="block">{series.jobs.length} Termine insgesamt</span>
                      <span className="mt-0.5 block">
                        {weekAppointmentCount === 1 ? '1 Termin diese KW' : `${weekAppointmentCount} Termine diese KW`}
                      </span>
                    </span>
                  </button>
                );
              })}
              {ongoingCourseSeries.length > 5 && (
                <button
                  type="button"
                  onClick={() => onNavigate('jobs')}
                  className="w-full px-4 py-3 text-left text-sm font-medium text-primary-custom transition-colors hover:bg-gray-50 lg:px-6"
                >
                  + {ongoingCourseSeries.length - 5} weitere anzeigen
                </button>
              )}
            </div>
          </section>
        )}

        {/* Umsatz pro Monat */}
        <section className="min-w-0 overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="px-4 lg:px-6 py-4 border-b border-gray-200">
          <h3 className="text-base lg:text-lg font-semibold text-gray-900">Gesamtumsatz pro Monat</h3>
        </div>
        {monthlyRevenueSorted.length > 0 ? (
          <div className="space-y-3 p-4 lg:p-6">
            {monthlyRevenueSorted.map(([month, revenue]) => {
              const percentage = maxMonthlyRevenue > 0 ? (revenue / maxMonthlyRevenue) * 100 : 0;

              return (
                <div key={month} className="grid min-w-0 grid-cols-[5rem_minmax(0,1fr)_7rem] items-center gap-3 sm:grid-cols-[7rem_minmax(0,1fr)_9rem]">
                  <span className="text-xs text-gray-600 sm:text-sm">{formatMonthLabel(month)}</span>
                  <div
                    className="h-6 w-full min-w-0 overflow-hidden rounded-full bg-gray-100"
                    role="progressbar"
                    aria-label={`${formatMonthLabel(month)}: ${formatCurrency(revenue, locale, company?.numberFormat, company?.currency)}`}
                    aria-valuemin={0}
                    aria-valuemax={maxMonthlyRevenue}
                    aria-valuenow={revenue}
                  >
                    <div
                      className="h-full rounded-full bg-primary-custom transition-all duration-500"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  <span className="whitespace-nowrap text-right text-xs font-medium text-gray-900 sm:text-sm">
                    {formatCurrency(revenue, locale, company?.numberFormat, company?.currency)}
                  </span>
                </div>
              );
            })}
            {company.reportingEnabled && (
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={() => onNavigate('reporting')}
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary-custom transition-colors hover:text-primary-custom/80"
                >
                  Zu den Auswertungen
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="py-8 text-center text-gray-500">
            Keine Umsätze vorhanden
          </div>
        )}
        </section>
      </div>

      {/* Email Send Modal */}
      <EmailSendModal
        isOpen={emailModal.isOpen}
        onClose={handleEmailModalClose}
        onSend={handleEmailSend}
        document={emailModal.invoice!}
        documentType="invoice"
        customer={emailModal.customer!}
        isLoading={isSendingEmail === emailModal.invoice?.id}
      />
    </div>
  );
}
