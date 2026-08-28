import { createContext, useContext } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { JobEntry, Customer, Company, InvoiceItem } from '../types';
import { apiService } from '../services/api';
import { generateUUID } from '../utils/uuid';
import { formatDate } from '../utils/formatters';
import { getTerminology } from '../utils/terminology';

export interface JobContextType {
  jobEntries: JobEntry[];
  setJobEntries: Dispatch<SetStateAction<JobEntry[]>>;
  addJobEntry: (jobEntry: Omit<JobEntry, 'id' | 'createdAt' | 'updatedAt'>) => Promise<JobEntry>;
  updateJobEntry: (id: string, jobEntry: Partial<JobEntry>) => Promise<void>;
  deleteJobEntry: (id: string) => Promise<void>;
  refreshJobEntries: () => Promise<void>;
  addJobSignature: (id: string, signatureData: string, customerName: string) => Promise<void>;
  getJobEntryById: (id: string) => JobEntry | undefined;
}

export const JobContext = createContext<JobContextType | undefined>(undefined);

export function useJobs(): JobContextType {
  const context = useContext(JobContext);
  if (context === undefined) {
    throw new Error('useJobs must be used within a JobProvider');
  }
  return context;
}

export async function generateInvoiceFromJobs(
  jobIds: string[],
  type: 'single' | 'daily' | 'monthly',
  jobEntries: JobEntry[],
  customers: Customer[],
  company: Company,
  date?: Date
): Promise<void> {
  const terminology = getTerminology(company.terminologyProfile);
  const selectedJobs = jobEntries.filter(job => jobIds.includes(job.id));
  if (selectedJobs.length === 0) return;

  const jobsByCustomer = selectedJobs.reduce((acc, job) => {
    if (!acc[job.customerId]) acc[job.customerId] = [];
    acc[job.customerId].push(job);
    return acc;
  }, {} as Record<string, JobEntry[]>);

  for (const [customerId, customerJobs] of Object.entries(jobsByCustomer)) {
    const customer = customers.find(item => item.id === customerId);
    if (!customer) continue;

    const items: InvoiceItem[] = [];
    let itemOrder = 1;
    const getUnitLabel = (job: JobEntry) => job.recurrence
      ? ` - Einheit ${job.recurrence.occurrenceIndex || 1} vom ${formatDate(job.date, company.locale, company.dateFormat)}`
      : '';

    customerJobs.forEach(job => {
      const unitLabel = getUnitLabel(job);
      if (job.timeEntries?.length) {
        job.timeEntries.forEach(timeEntry => {
          items.push({
            id: generateUUID(),
            description: `${job.title}${unitLabel} - ${timeEntry.description}`,
            quantity: timeEntry.hoursWorked,
            unitPrice: timeEntry.hourlyRate,
            taxRate: timeEntry.taxRate != null ? timeEntry.taxRate : 19,
            total: timeEntry.total,
            order: itemOrder++,
          });
        });
      } else if (job.hoursWorked > 0) {
        items.push({
          id: generateUUID(),
          description: `${job.title}${unitLabel} - ${job.description}`,
          quantity: job.hoursWorked,
          unitPrice: job.hourlyRate,
          taxRate: 19,
          total: job.hoursWorked * job.hourlyRate,
          order: itemOrder++,
        });
      }
    });

    customerJobs.forEach(job => {
      const unitLabel = getUnitLabel(job);
      job.materials?.forEach(material => {
        items.push({
          id: generateUUID(),
          description: `${job.title}${unitLabel} - ${material.description}`,
          quantity: material.quantity,
          unitPrice: material.unitPrice,
          taxRate: material.taxRate != null ? material.taxRate : 19,
          total: material.total,
          order: itemOrder++,
        });
      });
    });

    const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
    const taxAmount = items.reduce((sum, item) => {
      const itemTotal = item.quantity * item.unitPrice;
      return sum + (itemTotal * (item.taxRate / 100));
    }, 0);
    const total = subtotal + taxAmount;

    let invoiceTitle: string;
    if (type === 'daily' && date) {
      invoiceTitle = `Tagesrechnung vom ${formatDate(date, company.locale, company.dateFormat)}`;
    } else if (type === 'monthly' && date) {
      invoiceTitle = `Monatsrechnung ${date.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}`;
    } else {
      invoiceTitle = `Rechnung für ${customerJobs.length > 1 ? terminology.work.plural : terminology.work.singular}: ${customerJobs.map(job => job.title).join(', ')}`;
    }

    const paymentDays = company.defaultPaymentDays !== undefined ? company.defaultPaymentDays : 30;
    const issueDate = date || new Date();
    const dueDate = new Date(issueDate.getTime() + paymentDays * 24 * 60 * 60 * 1000);

    await apiService.createInvoiceFromJobs({
      invoiceNumber: '',
      customerId: customer.id,
      customerName: customer.name,
      issueDate,
      dueDate,
      items,
      subtotal,
      taxAmount,
      total,
      status: 'draft' as const,
      notes: invoiceTitle,
    }, customerJobs.map(job => job.id));
  }
}
