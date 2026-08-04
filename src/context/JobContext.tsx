import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { JobEntry, Customer, Company, Invoice, InvoiceItem } from '../types';
import { apiService } from '../services/api';
import { generateUUID } from '../utils/uuid';
import logger from '../utils/logger';
import { formatDate } from '../utils/formatters';
import { getTerminology } from '../utils/terminology';

// ============================================================================
// Types
// ============================================================================

interface JobContextType {
  jobEntries: JobEntry[];
  setJobEntries: React.Dispatch<React.SetStateAction<JobEntry[]>>;
  addJobEntry: (jobEntry: Omit<JobEntry, 'id' | 'createdAt' | 'updatedAt'>) => Promise<JobEntry>;
  updateJobEntry: (id: string, jobEntry: Partial<JobEntry>) => Promise<void>;
  deleteJobEntry: (id: string) => Promise<void>;
  refreshJobEntries: () => Promise<void>;
  addJobSignature: (id: string, signatureData: string, customerName: string) => Promise<void>;
  getJobEntryById: (id: string) => JobEntry | undefined;
}

// ============================================================================
// Context
// ============================================================================

const JobContext = createContext<JobContextType | undefined>(undefined);

// ============================================================================
// Provider
// ============================================================================

interface JobProviderProps {
  children: ReactNode;
  initialJobEntries?: JobEntry[];
}

export function JobProvider({ children, initialJobEntries = [] }: JobProviderProps) {
  const [jobEntries, setJobEntries] = useState<JobEntry[]>(initialJobEntries);

  const getJobEntryById = useCallback((id: string): JobEntry | undefined => {
    return jobEntries.find(j => j.id === id);
  }, [jobEntries]);

  const addJobEntry = useCallback(async (jobEntryData: Omit<JobEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<JobEntry> => {
    try {
      const newJobEntry = await apiService.createJobEntry(jobEntryData);
      setJobEntries(prev => [...prev, newJobEntry]);
      return newJobEntry;
    } catch (error) {
      logger.error('Error adding job entry:', error);
      // Fallback: Create locally
      const newJobEntry: JobEntry = {
        ...jobEntryData,
        id: generateUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      setJobEntries(prev => [...prev, newJobEntry]);
      throw error; // Re-throw to inform calling component
    }
  }, []);

  const updateJobEntry = useCallback(async (id: string, jobEntryData: Partial<JobEntry>): Promise<void> => {
    try {
      const updatedJobEntry = await apiService.updateJobEntry(id, jobEntryData);
      setJobEntries(prev => prev.map(job =>
        job.id === id ? updatedJobEntry : job
      ));
    } catch (error) {
      logger.error('Error updating job entry:', error);
      // Fallback: Update locally
      setJobEntries(prev => prev.map(job =>
        job.id === id ? { ...job, ...jobEntryData, updatedAt: new Date() } : job
      ));
    }
  }, []);

  const deleteJobEntry = useCallback(async (id: string): Promise<void> => {
    try {
      await apiService.deleteJobEntry(id);
      setJobEntries(prev => prev.filter(job => job.id !== id));
    } catch (error) {
      logger.error('Error deleting job entry:', error);
      // Fallback: Delete locally
      setJobEntries(prev => prev.filter(job => job.id !== id));
    }
  }, []);

  const refreshJobEntries = useCallback(async (): Promise<void> => {
    try {
      const jobEntriesData = await apiService.getJobEntries();
      setJobEntries(jobEntriesData);
    } catch (error) {
      logger.error('Error refreshing job entries:', error);
    }
  }, []);

  const addJobSignature = useCallback(async (id: string, signatureData: string, customerName: string): Promise<void> => {
    try {
      const response = await apiService.addJobSignature(id, signatureData, customerName);
      setJobEntries(prev => prev.map(job =>
        job.id === id ? response.job : job
      ));
    } catch (error) {
      logger.error('Error adding job signature:', error);
      throw error;
    }
  }, []);

  const value: JobContextType = {
    jobEntries,
    setJobEntries,
    addJobEntry,
    updateJobEntry,
    deleteJobEntry,
    refreshJobEntries,
    addJobSignature,
    getJobEntryById,
  };

  return (
    <JobContext.Provider value={value}>
      {children}
    </JobContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useJobs(): JobContextType {
  const context = useContext(JobContext);
  if (context === undefined) {
    throw new Error('useJobs must be used within a JobProvider');
  }
  return context;
}

// ============================================================================
// Invoice Generation from Jobs
// ============================================================================

export async function generateInvoiceFromJobs(
  jobIds: string[],
  type: 'single' | 'daily' | 'monthly',
  jobEntries: JobEntry[],
  customers: Customer[],
  company: Company,
  addInvoice: (invoice: Omit<Invoice, 'id' | 'createdAt'>) => Promise<Invoice>,
  updateJobEntry: (id: string, jobEntry: Partial<JobEntry>) => Promise<void>,
  date?: Date
): Promise<void> {
  const terminology = getTerminology(company.terminologyProfile);
  const selectedJobs = jobEntries.filter(job => jobIds.includes(job.id));
  if (selectedJobs.length === 0) return;

  // Group jobs by customer
  const jobsByCustomer = selectedJobs.reduce((acc, job) => {
    if (!acc[job.customerId]) {
      acc[job.customerId] = [];
    }
    acc[job.customerId].push(job);
    return acc;
  }, {} as Record<string, JobEntry[]>);

  // Generate invoices for each customer
  for (const [customerId, customerJobs] of Object.entries(jobsByCustomer)) {
    const customer = customers.find(c => c.id === customerId);
    if (!customer) continue;

    // Create invoice items from jobs
    const items: InvoiceItem[] = [];

    // Add job items (use time entries if available, otherwise use legacy fields)
    let itemOrder = 1;
    customerJobs.forEach(job => {
      if (job.timeEntries && job.timeEntries.length > 0) {
        job.timeEntries.forEach(timeEntry => {
          items.push({
            id: generateUUID(),
            description: `${job.title} - ${timeEntry.description}`,
            quantity: timeEntry.hoursWorked,
            unitPrice: timeEntry.hourlyRate,
            taxRate: timeEntry.taxRate != null ? timeEntry.taxRate : 19,
            total: timeEntry.total,
            order: itemOrder++,
          });
        });
      } else if (job.hoursWorked > 0) {
        // Only add legacy entry if there are actual hours worked and no time entries
        items.push({
          id: generateUUID(),
          description: `${job.title} - ${job.description}`,
          quantity: job.hoursWorked,
          unitPrice: job.hourlyRate,
          taxRate: 19, // Default for legacy data
          total: job.hoursWorked * job.hourlyRate,
          order: itemOrder++,
        });
      }
    });

    // Add material items
    customerJobs.forEach(job => {
      if (job.materials && job.materials.length > 0) {
        job.materials.forEach(material => {
          items.push({
            id: generateUUID(),
            description: `${job.title} - ${material.description}`,
            quantity: material.quantity,
            unitPrice: material.unitPrice,
            taxRate: material.taxRate != null ? material.taxRate : 19,
            total: material.total,
            order: itemOrder++,
          });
        });
      }
    });

    const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
    const taxAmount = items.reduce((sum, item) => {
      const itemTotal = item.quantity * item.unitPrice;
      return sum + (itemTotal * (item.taxRate / 100));
    }, 0);
    const total = subtotal + taxAmount;

    // Generate invoice title
    let invoiceTitle = '';
    if (type === 'daily' && date) {
      invoiceTitle = `Tagesrechnung vom ${formatDate(date, company.locale, company.dateFormat)}`;
    } else if (type === 'monthly' && date) {
      invoiceTitle = `Monatsrechnung ${date.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}`;
    } else {
      invoiceTitle = `Rechnung für ${customerJobs.length > 1 ? terminology.work.plural : terminology.work.singular}: ${customerJobs.map(j => j.title).join(', ')}`;
    }

    const paymentDays = company.defaultPaymentDays !== undefined ? company.defaultPaymentDays : 30;
    const issueDate = date || new Date();
    const dueDate = new Date(issueDate.getTime() + paymentDays * 24 * 60 * 60 * 1000);

    const newInvoice = {
      invoiceNumber: '', // Will be set by backend
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
    };

    await addInvoice(newInvoice);

    // Mark jobs as invoiced
    for (const job of customerJobs) {
      await updateJobEntry(job.id, { status: 'invoiced' });
    }
  }
}

