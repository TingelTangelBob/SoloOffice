import { createContext, useContext } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Invoice } from '../types';

export interface InvoiceContextType {
  invoices: Invoice[];
  setInvoices: Dispatch<SetStateAction<Invoice[]>>;
  addInvoice: (invoice: Omit<Invoice, 'id' | 'createdAt'>) => Promise<Invoice>;
  updateInvoice: (id: string, invoice: Partial<Invoice>) => Promise<void>;
  deleteInvoice: (id: string) => Promise<void>;
  refreshInvoices: () => Promise<void>;
  getInvoiceById: (id: string) => Invoice | undefined;
}

export const InvoiceContext = createContext<InvoiceContextType | undefined>(undefined);

export function useInvoices(): InvoiceContextType {
  const context = useContext(InvoiceContext);
  if (context === undefined) {
    throw new Error('useInvoices must be used within an InvoiceProvider');
  }
  return context;
}
