import { createContext, useContext } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Company, DocumentTemplate, HourlyRate, InvoiceTemplate, MaterialTemplate } from '../types';

export interface CompanyContextType {
  company: Company;
  setCompany: Dispatch<SetStateAction<Company>>;
  updateCompany: (company: Partial<Company>) => Promise<void>;
  hourlyRates: HourlyRate[];
  setHourlyRates: Dispatch<SetStateAction<HourlyRate[]>>;
  addHourlyRate: (rate: Omit<HourlyRate, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateHourlyRate: (id: string, rate: Partial<HourlyRate>) => Promise<void>;
  deleteHourlyRate: (id: string) => Promise<void>;
  materialTemplates: MaterialTemplate[];
  setMaterialTemplates: Dispatch<SetStateAction<MaterialTemplate[]>>;
  addMaterialTemplate: (template: Omit<MaterialTemplate, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateMaterialTemplate: (id: string, template: Partial<MaterialTemplate>) => Promise<void>;
  deleteMaterialTemplate: (id: string) => Promise<void>;
  addInvoiceTemplate: (template: Omit<InvoiceTemplate, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateInvoiceTemplate: (id: string, template: Partial<InvoiceTemplate>) => Promise<void>;
  deleteInvoiceTemplate: (id: string) => Promise<void>;
  getInvoiceTemplates: () => InvoiceTemplate[];
  documentTemplates: DocumentTemplate[];
  addDocumentTemplate: (template: Omit<DocumentTemplate, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateDocumentTemplate: (id: string, template: Partial<DocumentTemplate>) => Promise<void>;
  deleteDocumentTemplate: (id: string) => Promise<void>;
}

export const CompanyContext = createContext<CompanyContextType | undefined>(undefined);

export function useCompany(): CompanyContextType {
  const context = useContext(CompanyContext);
  if (context === undefined) {
    throw new Error('useCompany must be used within a CompanyProvider');
  }
  return context;
}
