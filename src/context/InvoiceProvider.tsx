import { useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { Invoice } from '../types';
import { apiService } from '../services/api';
import logger from '../utils/logger';
import { InvoiceContext, type InvoiceContextType } from './InvoiceContext';

// ============================================================================
// Provider
// ============================================================================

interface InvoiceProviderProps {
  children: ReactNode;
  initialInvoices?: Invoice[];
}

export function InvoiceProvider({ children, initialInvoices = [] }: InvoiceProviderProps) {
  const [invoices, setInvoices] = useState<Invoice[]>(initialInvoices);

  const getInvoiceById = useCallback((id: string): Invoice | undefined => {
    return invoices.find(i => i.id === id);
  }, [invoices]);

  const addInvoice = useCallback(async (invoiceData: Omit<Invoice, 'id' | 'createdAt'>): Promise<Invoice> => {
    try {
      const newInvoice = await apiService.createInvoice(invoiceData);
      setInvoices(prev => [...prev, newInvoice]);
      return newInvoice;
    } catch (error) {
      logger.error('Error adding invoice:', error);
      throw error;
    }
  }, []);

  const updateInvoice = useCallback(async (id: string, invoiceData: Partial<Invoice>): Promise<void> => {
    try {
      const updatedInvoice = await apiService.updateInvoice(id, invoiceData);
      setInvoices(prev => prev.map(invoice =>
        invoice.id === id ? updatedInvoice : invoice
      ));
    } catch (error) {
      logger.error('Error updating invoice:', error);
      throw error;
    }
  }, []);

  const deleteInvoice = useCallback(async (id: string): Promise<void> => {
    try {
      await apiService.deleteInvoice(id);
      setInvoices(prev => prev.filter(invoice => invoice.id !== id));
    } catch (error) {
      logger.error('Error deleting invoice:', error);
      throw error;
    }
  }, []);

  const refreshInvoices = useCallback(async (): Promise<void> => {
    try {
      const invoicesData = await apiService.getInvoices();
      setInvoices(invoicesData);
    } catch (error) {
      logger.error('Error refreshing invoices:', error);
      throw error;
    }
  }, []);

  const value: InvoiceContextType = {
    invoices,
    setInvoices,
    addInvoice,
    updateInvoice,
    deleteInvoice,
    refreshInvoices,
    getInvoiceById,
  };

  return (
    <InvoiceContext.Provider value={value}>
      {children}
    </InvoiceContext.Provider>
  );
}
