import { useEffect, useState } from 'react';
import logger from '../utils/logger';
import { X, FileText, Calendar, Users, Check, AlertTriangle } from 'lucide-react';
import { Invoice, JobEntry, Customer } from '../types';
import { useCustomers } from '../context/CustomerContext';
import { useInvoices } from '../context/InvoiceContext';
import { useJobs } from '../context/JobContext';
import { useCompany } from '../context/CompanyContext';
import { generateJobPDF } from '../utils/pdfGenerator';
import { generateUUID } from '../utils/uuid';
import { formatCurrency as formatCurrencyValue, formatDate as formatDateValue } from '../utils/formatters';
import { getTerminology } from '../utils/terminology';
import { ConfirmationModal } from './ConfirmationModal';
import { apiService } from '../services/api';

export type JobInvoiceGenerationType = 'single' | 'course' | 'daily' | 'weekly' | 'monthly';

interface JobInvoiceGeneratorProps {
  selectedJobIds: string[];
  onClose: () => void;
  onInvoiceGenerated: (invoices: Invoice[]) => void;
  initialGenerationType?: JobInvoiceGenerationType;
}

export function JobInvoiceGenerator({ 
  selectedJobIds, 
  onClose,
  onInvoiceGenerated,
  initialGenerationType = 'single',
}: JobInvoiceGeneratorProps) {
  const { customers } = useCustomers();
  const { refreshInvoices } = useInvoices();
  const { jobEntries: jobs, refreshJobEntries } = useJobs();
  const { company } = useCompany();
  const terminology = getTerminology(company?.terminologyProfile);
  const [generationType, setGenerationType] = useState<JobInvoiceGenerationType>(initialGenerationType);
  const [isGenerating, setIsGenerating] = useState(false);
  const [nonCompletedNoticeDismissed, setNonCompletedNoticeDismissed] = useState(false);
  const [includedJobIds, setIncludedJobIds] = useState<string[]>([]);
  const [showFinalConfirmation, setShowFinalConfirmation] = useState(false);

  const selectedJobs = jobs.filter((job: JobEntry) => selectedJobIds.includes(job.id));
  
  // Filter only completed jobs for invoicing
  const completedJobs = selectedJobs.filter((job: JobEntry) => job.status === 'completed');
  const nonCompletedJobs = selectedJobs.filter((job: JobEntry) => job.status !== 'completed');
  const billableJobs = completedJobs.filter((job) => includedJobIds.includes(job.id));

  useEffect(() => {
    setIncludedJobIds(jobs
      .filter((job) => selectedJobIds.includes(job.id) && job.status === 'completed')
      .map((job) => job.id));
  }, [jobs, selectedJobIds]);
  
  // Group jobs by customer
  const jobsByCustomer = billableJobs.reduce((acc: Record<string, JobEntry[]>, job: JobEntry) => {
    if (!acc[job.customerId]) {
      acc[job.customerId] = [];
    }
    acc[job.customerId].push(job);
    return acc;
  }, {} as Record<string, JobEntry[]>);

  const completedJobsByCustomer = completedJobs.reduce((acc: Record<string, JobEntry[]>, job: JobEntry) => {
    if (!acc[job.customerId]) {
      acc[job.customerId] = [];
    }
    acc[job.customerId].push(job);
    return acc;
  }, {} as Record<string, JobEntry[]>);

  // Helper function to get ISO week number
  const getISOWeek = (date: Date) => {
    const tempDate = new Date(date.getTime());
    tempDate.setHours(0, 0, 0, 0);
    tempDate.setDate(tempDate.getDate() + 4 - (tempDate.getDay() || 7));
    const yearStart = new Date(tempDate.getFullYear(), 0, 1);
    const weekNo = Math.ceil((((tempDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return weekNo;
  };

  const handleGenerate = () => {
    if (billableJobs.length === 0) return;
    setShowFinalConfirmation(true);
  };

  const confirmGenerate = async () => {
    setShowFinalConfirmation(false);
    setIsGenerating(true);
    try {
      const createdInvoices = await generateInvoices();
      onInvoiceGenerated(createdInvoices);
      onClose();
    } catch (error) {
      logger.error('Error generating invoice:', error);
      alert('Fehler beim Erstellen der Rechnung. Bitte versuchen Sie es erneut.');
    } finally {
      setIsGenerating(false);
    }
  };

  const generateInvoices = async () => {
    const createdInvoices: Invoice[] = [];
    const createAndCollect = async (jobsToInvoice: JobEntry[]) => {
      const invoice = await createInvoiceForJobs(jobsToInvoice);
      if (invoice) createdInvoices.push(invoice);
    };

    switch (generationType) {
      case 'single':
        // Create separate invoice for each completed job only
        for (const job of billableJobs) {
          await createAndCollect([job]);
        }
        break;

      case 'course':
        // Create one invoice for the complete selected course/series per customer.
        for (const customerJobs of Object.values(jobsByCustomer)) {
          await createAndCollect(customerJobs as JobEntry[]);
        }
        break;
      
      case 'daily':
        // Create one invoice per day per customer
        for (const [, customerJobs] of Object.entries(jobsByCustomer)) {
          const jobsByDateForCustomer = (customerJobs as JobEntry[]).reduce((acc: Record<string, JobEntry[]>, job: JobEntry) => {
            const dateKey = new Date(job.date).toDateString();
            if (!acc[dateKey]) {
              acc[dateKey] = [];
            }
            acc[dateKey].push(job);
            return acc;
          }, {} as Record<string, JobEntry[]>);
          
          for (const dayJobs of Object.values(jobsByDateForCustomer)) {
            await createAndCollect(dayJobs);
          }
        }
        break;
      
      case 'weekly':
        // Create one invoice per week per customer
        for (const [, customerJobs] of Object.entries(jobsByCustomer)) {
          const jobsByWeekForCustomer = (customerJobs as JobEntry[]).reduce((acc: Record<string, JobEntry[]>, job: JobEntry) => {
            const date = new Date(job.date);
            // Get Monday of the week (ISO week)
            const monday = new Date(date);
            const day = date.getDay();
            const diff = date.getDate() - day + (day === 0 ? -6 : 1);
            monday.setDate(diff);
            monday.setHours(0, 0, 0, 0);
            
            const weekKey = `${monday.getFullYear()}-W${String(getISOWeek(monday)).padStart(2, '0')}`;
            if (!acc[weekKey]) {
              acc[weekKey] = [];
            }
            acc[weekKey].push(job);
            return acc;
          }, {} as Record<string, JobEntry[]>);
          
          for (const weekJobs of Object.values(jobsByWeekForCustomer)) {
            await createAndCollect(weekJobs);
          }
        }
        break;
      
      case 'monthly':
        // Create one invoice per month per customer
        for (const [, customerJobs] of Object.entries(jobsByCustomer)) {
          const jobsByMonthForCustomer = (customerJobs as JobEntry[]).reduce((acc: Record<string, JobEntry[]>, job: JobEntry) => {
            const date = new Date(job.date);
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            if (!acc[monthKey]) {
              acc[monthKey] = [];
            }
            acc[monthKey].push(job);
            return acc;
          }, {} as Record<string, JobEntry[]>);
          
          for (const monthJobs of Object.values(jobsByMonthForCustomer)) {
            await createAndCollect(monthJobs);
          }
        }
        break;
    }

    return createdInvoices;
  };

  const createInvoiceForJobs = async (jobsToInvoice: JobEntry[]) => {
    if (jobsToInvoice.length === 0) return;

    const customer = customers.find((c: Customer) => c.id === jobsToInvoice[0].customerId);
    if (!customer) return;

    const items = [];

    // Add job items
    let itemOrder = 1;
    for (const job of jobsToInvoice) {
      const unitLabel = job.recurrence
        ? ` - Einheit ${job.recurrence.occurrenceIndex || 1} vom ${formatDate(job.date)}`
        : '';
      // Check if job has multiple time entries
      if (job.timeEntries && job.timeEntries.length > 0) {
        // Add each time entry as separate line item
        job.timeEntries.forEach(timeEntry => {
          // Bei Kleinunternehmerregelung immer 0% MwSt., sonst den gespeicherten Wert oder 19% als Fallback
          const taxRate = company?.isSmallBusiness ? 0 : (timeEntry.taxRate != null ? timeEntry.taxRate : 19);
          
          items.push({
            id: `time-entry-${job.id}-${timeEntry.id}`,
            description: `${job.title}${unitLabel} - ${timeEntry.description}`,
            quantity: timeEntry.hoursWorked,
            unitPrice: timeEntry.hourlyRate,
            taxRate: taxRate,
            total: timeEntry.total,
            jobNumber: job.jobNumber,
            externalJobNumber: job.externalJobNumber,
            order: itemOrder++
          });
        });
      } else if (job.hoursWorked > 0) {
        // Only add legacy entry if there are actual hours worked and no time entries
        // Bei Kleinunternehmerregelung immer 0% MwSt., sonst den gespeicherten Wert oder 19% als Fallback
        const taxRate = company?.isSmallBusiness ? 0 : 19;
        
        items.push({
          id: `job-${job.id}`,
          description: `${job.title}${unitLabel} - ${job.description}`,
          quantity: job.hoursWorked,
          unitPrice: job.hourlyRate,
          taxRate: taxRate,
          total: job.hoursWorked * job.hourlyRate,
          jobNumber: job.jobNumber,
          externalJobNumber: job.externalJobNumber,
          order: itemOrder++
        });
      }

      // Add materials if any
      if (job.materials && job.materials.length > 0) {
        job.materials.forEach(material => {
          // Bei Kleinunternehmerregelung immer 0% MwSt., sonst den gespeicherten Wert oder 19% als Fallback
          const taxRate = company?.isSmallBusiness ? 0 : (material.taxRate != null ? material.taxRate : 19);
          
          items.push({
            id: `material-${job.id}-${material.id}`,
            description: `${job.title}${unitLabel} - ${material.description}`,
            quantity: material.quantity,
            unitPrice: material.unitPrice,
            taxRate: taxRate,
            total: material.total,
            jobNumber: job.jobNumber,
            externalJobNumber: job.externalJobNumber,
            order: itemOrder++
          });
        });
      }
    }

    const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
    const taxAmount = items.reduce((sum, item) => {
      const itemTotal = item.quantity * item.unitPrice;
      // Bei Kleinunternehmerregelung ist die Steuer immer 0
      const effectiveTaxRate = company?.isSmallBusiness ? 0 : item.taxRate;
      return sum + (itemTotal * (effectiveTaxRate / 100));
    }, 0);
    const total = subtotal + taxAmount;

    let issueDate = new Date();
    
    if (generationType === 'daily') {
      // For daily invoices, use the date of the jobs
      issueDate = new Date(jobsToInvoice[0].date);
    } else if (generationType === 'weekly') {
      // For weekly invoices, use the last day (Sunday) of the week
      const firstJobDate = new Date(jobsToInvoice[0].date);
      const monday = new Date(firstJobDate);
      const day = firstJobDate.getDay();
      const diff = firstJobDate.getDate() - day + (day === 0 ? -6 : 1);
      monday.setDate(diff);
      
      // Get Sunday of the same week
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      issueDate = sunday;
    } else if (generationType === 'monthly') {
      // For monthly invoices, use the last day of the month
      const firstJobDate = new Date(jobsToInvoice[0].date);
      const lastDayOfMonth = new Date(firstJobDate.getFullYear(), firstJobDate.getMonth() + 1, 0);
      issueDate = lastDayOfMonth;
    }
    
    // Generate job PDFs as attachments and collect job attachments
    const attachments = [];
    
    // Add original job attachments first
    for (const job of jobsToInvoice) {
      if (job.attachments && job.attachments.length > 0) {
        for (const attachment of job.attachments) {
          attachments.push({
            id: generateUUID(),
            name: `${job.title}_${attachment.name}`,
            content: attachment.content,
            contentType: attachment.contentType,
            size: attachment.size,
            uploadedAt: new Date()
          });
        }
      }
    }
    
    // Then add generated job PDFs
    for (const job of jobsToInvoice) {
      try {
        const jobPDF = await generateJobPDF(job, {
          company,
          customer
        });
        
        // Convert blob to base64
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve, reject) => {
          reader.onloadend = () => {
            const result = reader.result as string;
            // Remove data URL prefix to get just the base64 string
            const base64 = result.split(',')[1];
            resolve(base64);
          };
          reader.onerror = reject;
        });
        reader.readAsDataURL(jobPDF);
        
        const base64Content = await base64Promise;
        
        attachments.push({
          id: generateUUID(),
          name: `${terminology.work.singular}_${job.title.replace(/[^a-zA-Z0-9]/g, '_')}_${formatDateValue(new Date(job.date), company?.locale || 'de-DE', company?.dateFormat).replace(/[./]/g, '-')}.pdf`,
          content: base64Content,
          contentType: 'application/pdf',
          size: jobPDF.size,
          uploadedAt: new Date()
        });
      } catch (error) {
        logger.error('Error generating job PDF for attachment:', error);
        // Continue without this attachment if generation fails
      }
    }

    // Calculate due date based on issue date and company payment days
    const paymentDays = company.defaultPaymentDays !== undefined ? company.defaultPaymentDays : 30;
    const dueDate = new Date(issueDate.getTime() + paymentDays * 24 * 60 * 60 * 1000);
    
    const invoice = {
      invoiceNumber: '', // Will be generated by backend
      customerId: customer.id,
      customerName: customer.name,
      issueDate: issueDate,
      dueDate: dueDate,
      items,
      subtotal,
      taxAmount,
      total,
      status: 'draft' as const,
      notes: `Automatisch erstellt aus ${jobsToInvoice.length} ${terminology.work.singular}${jobsToInvoice.length > 1 ? 'en' : ''}:\n\n${jobsToInvoice.map(j => `• ${j.jobNumber}${j.externalJobNumber ? ` (Ext: ${j.externalJobNumber})` : ''}: ${j.title}`).join('\n')}`,
      attachments
    };

    const createdInvoice = await apiService.createInvoiceFromJobs(invoice, jobsToInvoice.map(job => job.id));
    
    // Refresh invoices in other components
    await refreshInvoices();
    await refreshJobEntries();
    return createdInvoice;
  };

  const formatCurrency = (amount: number) => {
    const locale = company?.locale || 'de-DE';
    return formatCurrencyValue(amount, locale, company?.numberFormat, company?.currency);
  };

  const formatDate = (date: Date) => {
    return formatDateValue(new Date(date), company?.locale || 'de-DE', company?.dateFormat);
  };

  const calculateJobTotal = (job: JobEntry) => {
    const laborCost = job.timeEntries && job.timeEntries.length > 0
      ? job.timeEntries.reduce((sum, entry) => sum + Number(entry.total ?? (entry.hoursWorked * entry.hourlyRate)), 0)
      : job.hoursWorked * job.hourlyRate;
    const materialCost = job.materials?.reduce((sum, material) => sum + material.total, 0) || 0;
    return laborCost + materialCost;
  };

  const getTotalAmount = () => {
    return billableJobs.reduce((sum: number, job: JobEntry) => sum + calculateJobTotal(job), 0);
  };

  const getPreviewInfo = () => {
    switch (generationType) {
      case 'single':
        return `${billableJobs.length} Rechnung(en) werden erstellt (eine pro ${terminology.work.singular})`;
      case 'course':
        return `${Object.keys(jobsByCustomer).length} Rechnung(en) werden erstellt (eine für den gesamten Kurs)`;
      case 'daily': {
        const completedJobsByDate = billableJobs.reduce((acc: Record<string, JobEntry[]>, job: JobEntry) => {
          const dateKey = new Date(job.date).toDateString();
          if (!acc[dateKey]) {
            acc[dateKey] = [];
          }
          acc[dateKey].push(job);
          return acc;
        }, {} as Record<string, JobEntry[]>);
        return `${Object.keys(completedJobsByDate).length} Rechnung(en) werden erstellt (eine pro Tag)`;
      }
      case 'weekly': {
        const completedJobsByWeek = billableJobs.reduce((acc: Record<string, JobEntry[]>, job: JobEntry) => {
          const date = new Date(job.date);
          // Get Monday of the week (ISO week)
          const monday = new Date(date);
          const day = date.getDay();
          const diff = date.getDate() - day + (day === 0 ? -6 : 1);
          monday.setDate(diff);
          monday.setHours(0, 0, 0, 0);
          
          const weekKey = `${monday.getFullYear()}-W${String(getISOWeek(monday)).padStart(2, '0')}`;
          if (!acc[weekKey]) {
            acc[weekKey] = [];
          }
          acc[weekKey].push(job);
          return acc;
        }, {} as Record<string, JobEntry[]>);
        return `${Object.keys(completedJobsByWeek).length} Rechnung(en) werden erstellt (eine pro Woche)`;
      }
      case 'monthly': {
        const completedJobsByMonth = billableJobs.reduce((acc: Record<string, JobEntry[]>, job: JobEntry) => {
          const date = new Date(job.date);
          const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          if (!acc[monthKey]) {
            acc[monthKey] = [];
          }
          acc[monthKey].push(job);
          return acc;
        }, {} as Record<string, JobEntry[]>);
        return `${Object.keys(completedJobsByMonth).length} Rechnung(en) werden erstellt (eine pro Monat)`;
      }
      default:
        return '';
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center">
            <FileText className="h-5 w-5 mr-2" />
            Rechnung erstellen
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 space-y-6">
          {/* Warning for non-completed jobs */}
          {nonCompletedJobs.length > 0 && !nonCompletedNoticeDismissed && (
            <div className="notice notice-warning">
              <div className="flex min-w-0 items-start space-x-2">
                <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5" />
                <div>
                  <h4 className="text-sm font-medium text-yellow-900">Hinweis</h4>
                  <p className="text-sm text-yellow-800 mt-1">
                    {nonCompletedJobs.length} der ausgewählten {terminology.work.plural} sind noch nicht als "Abgeschlossen" markiert
                    und werden nicht in die Rechnung aufgenommen. Nur abgeschlossene {terminology.work.plural} können abgerechnet werden.
                  </p>
                </div>
              </div>
              <button type="button" onClick={() => setNonCompletedNoticeDismissed(true)} className="notice-dismiss" aria-label="Hinweis ausblenden"><X className="h-4 w-4" /></button>
            </div>
          )}

          {/* Generation Type Selection */}
          <div>
            <h4 className="text-sm font-medium text-gray-900 mb-3">Rechnungsart auswählen</h4>
            <div className="space-y-3">
              <label className="flex items-start space-x-3 cursor-pointer">
                <input
                  type="radio"
                  name="generationType"
                  value="single"
                  checked={generationType === 'single'}
                  onChange={(e) => setGenerationType(e.target.value as typeof generationType)}
                  className="custom-radio"
                />
                <div>
                  <div className="text-sm font-medium text-gray-900">Einzelrechnungen pro {terminology.work.singular}</div>
                  <div className="text-xs text-gray-500">
                    Erstellt eine separate Rechnung für jeden ausgewählten {terminology.work.singular}
                  </div>
                </div>
              </label>

              <label className="flex cursor-pointer items-start space-x-3">
                <input
                  type="radio"
                  name="generationType"
                  value="course"
                  checked={generationType === 'course'}
                  onChange={(e) => setGenerationType(e.target.value as typeof generationType)}
                  className="custom-radio"
                />
                <div>
                  <div className="text-sm font-medium text-gray-900">Gesamter Kurs in einer Rechnung</div>
                  <div className="text-xs text-gray-500">
                    Übernimmt alle ausgewählten Einheiten dieses Kurses mit ihren Einzelpositionen in eine Rechnung
                  </div>
                </div>
              </label>

              <label className="flex items-start space-x-3 cursor-pointer">
                <input
                  type="radio"
                  name="generationType"
                  value="daily"
                  checked={generationType === 'daily'}
                  onChange={(e) => setGenerationType(e.target.value as typeof generationType)}
                  className="custom-radio"
                />
                <div>
                  <div className="text-sm font-medium text-gray-900">Tagesrechnungen</div>
                  <div className="text-xs text-gray-500">
                    Fasst alle {terminology.work.plural} eines Tages in einer Rechnung zusammen
                  </div>
                </div>
              </label>

              <label className="flex items-start space-x-3 cursor-pointer">
                <input
                  type="radio"
                  name="generationType"
                  value="weekly"
                  checked={generationType === 'weekly'}
                  onChange={(e) => setGenerationType(e.target.value as typeof generationType)}
                  className="custom-radio"
                />
                <div>
                  <div className="text-sm font-medium text-gray-900">Wochenrechnungen</div>
                  <div className="text-xs text-gray-500">
                    Fasst alle {terminology.work.plural} einer Kalenderwoche in einer Rechnung zusammen
                  </div>
                </div>
              </label>

              <label className="flex items-start space-x-3 cursor-pointer">
                <input
                  type="radio"
                  name="generationType"
                  value="monthly"
                  checked={generationType === 'monthly'}
                  onChange={(e) => setGenerationType(e.target.value as typeof generationType)}
                  className="custom-radio"
                />
                <div>
                  <div className="text-sm font-medium text-gray-900">Monatsrechnungen</div>
                  <div className="text-xs text-gray-500">
                    Fasst alle {terminology.work.plural} eines Monats in einer Rechnung zusammen
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Preview Information */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start space-x-2">
              <Check className="h-5 w-5 text-blue-600 mt-0.5" />
              <div>
                <h4 className="text-sm font-medium text-blue-900">Vorschau</h4>
                <p className="text-sm text-blue-700 mt-1">{getPreviewInfo()}</p>
                <p className="text-sm text-blue-700">
                  {billableJobs.length} Einheit(en) geprüft; jede Einheit wird als eigene Rechnungsposition übernommen.
                </p>
                <p className="text-sm text-blue-700">
                  Gesamtbetrag: <strong>{formatCurrency(getTotalAmount())}</strong> (netto)
                </p>
              </div>
            </div>
          </div>

          {/* Selected Jobs Summary */}
          <div>
            <h4 className="text-sm font-medium text-gray-900 mb-3">
              Einheiten prüfen ({billableJobs.length} von {completedJobs.length} abgeschlossen ausgewählt; {selectedJobs.length} insgesamt markiert)
            </h4>
            <div className="bg-gray-50 rounded-lg p-4 max-h-60 overflow-y-auto">
              <div className="space-y-3">
                {Object.entries(completedJobsByCustomer).map(([customerId, customerJobs]) => {
                  const customer = customers.find(c => c.id === customerId);
                  const customerTotal = customerJobs
                    .filter(job => includedJobIds.includes(job.id))
                    .reduce((sum, job) => sum + calculateJobTotal(job), 0);
                  
                  return (
                    <div key={customerId} className="border border-gray-200 rounded-lg p-3 bg-white">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center">
                          <Users className="h-4 w-4 text-gray-400 mr-2" />
                          <span className="font-medium text-gray-900">{customer?.name}</span>
                        </div>
                        <span className="text-sm font-medium text-gray-900">
                          {formatCurrency(customerTotal)}
                        </span>
                      </div>
                      
                      <div className="space-y-1">
                        {customerJobs.map(job => (
                          <div key={job.id} className="flex items-center justify-between text-sm">
                            <label className="flex min-w-0 items-center space-x-2">
                              <input
                                type="checkbox"
                                checked={includedJobIds.includes(job.id)}
                                onChange={(event) => setIncludedJobIds((previous) => event.target.checked
                                  ? [...previous, job.id]
                                  : previous.filter((id) => id !== job.id))}
                                className="custom-checkbox shrink-0"
                                aria-label={`${formatDate(job.date)} ${job.title} für Rechnung auswählen`}
                              />
                              <Calendar className="h-3 w-3 text-gray-400" />
                              <span className="text-gray-600">{formatDate(job.date)}</span>
                              <span className="truncate text-gray-900">
                                {job.title}{job.recurrence ? ` - Einheit ${job.recurrence.occurrenceIndex || 1}` : ''}
                              </span>
                              <span className="text-gray-500">({job.hoursWorked}h)</span>
                            </label>
                            <span className={`shrink-0 text-gray-900 ${includedJobIds.includes(job.id) ? '' : 'text-gray-400 line-through'}`}>
                              {formatCurrency(calculateJobTotal(job))}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Important Notes */}
          <div className="guidance-panel border-l-4 border-l-amber-500 p-4">
            <h4 className="text-sm font-medium text-yellow-900 mb-2">Wichtige Hinweise</h4>
            <ul className="text-sm text-yellow-800 space-y-1">
              <li>• Die Rechnungen werden im Entwurfsstatus erstellt</li>
              <li>• Nur die angehakten Einheiten werden als "Abgerechnet" markiert</li>
              <li>• Sie können die erstellten Rechnungen nachträglich bearbeiten</li>
              <li>• Die Mehrwertsteuer wird automatisch je nach Steuersatz berechnet</li>
            </ul>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Abbrechen
            </button>
            <button
              onClick={handleGenerate}
              disabled={isGenerating || billableJobs.length === 0}
              className="btn-primary text-white px-4 py-2 rounded-lg flex items-center space-x-2 text-sm disabled:opacity-50"
            >
              <FileText className="h-4 w-4" />
              <span>
                {isGenerating 
                  ? 'Erstelle Rechnungen...' 
                  : `${getPreviewInfo().split(' ')[0]} Rechnung(en) erstellen`
                }
              </span>
            </button>
          </div>
        </div>
      </div>
      <ConfirmationModal
        isOpen={showFinalConfirmation}
        title="Rechnungseinheiten bestätigen"
        message={`${billableJobs.length} ausgewählte Einheit(en) werden nach der Prüfung als Rechnungspositionen übernommen. Gesamtbetrag netto: ${formatCurrency(getTotalAmount())}. Danach werden diese Einheiten als abgerechnet markiert.`}
        confirmText="Rechnungen erstellen"
        onConfirm={confirmGenerate}
        onClose={() => setShowFinalConfirmation(false)}
      />
    </div>
  );
}
