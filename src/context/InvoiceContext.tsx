import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { Invoice } from '../types';
import { apiService } from '../services/api';
import logger from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

interface InvoiceContextType {
  invoices: Invoice[];
  setInvoices: React.Dispatch<React.SetStateAction<Invoice[]>>;
  addInvoice: (invoice: Omit<Invoice, 'id' | 'createdAt'>) => Promise<Invoice>;
  updateInvoice: (id: string, invoice: Partial<Invoice>) => Promise<void>;
  deleteInvoice: (id: string) => Promise<void>;
  refreshInvoices: () => Promise<void>;
  getInvoiceById: (id: string) => Invoice | undefined;
}

// ============================================================================
// Context
// ============================================================================

const InvoiceContext = createContext<InvoiceContextType | undefined>(undefined);

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

// ============================================================================
// Hook
// ============================================================================

export function useInvoices(): InvoiceContextType {
  const context = useContext(InvoiceContext);
  if (context === undefined) {
    throw new Error('useInvoices must be used within an InvoiceProvider');
  }
  return context;
}

