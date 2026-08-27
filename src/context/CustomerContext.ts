import { createContext, useContext } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Customer, HourlyRate, MaterialTemplate } from '../types';

export interface CustomerContextType {
  customers: Customer[];
  setCustomers: Dispatch<SetStateAction<Customer[]>>;
  addCustomer: (customer: Omit<Customer, 'id' | 'customerNumber' | 'createdAt'>) => Promise<Customer>;
  updateCustomer: (id: string, customer: Partial<Customer>) => Promise<void>;
  deleteCustomer: (id: string) => Promise<void>;
  archiveCustomer: (id: string) => Promise<void>;
  restoreCustomer: (id: string) => Promise<void>;
  refreshCustomers: (includeArchived?: boolean) => Promise<void>;
  getCustomerById: (id: string) => Customer | undefined;
}

export const CustomerContext = createContext<CustomerContextType | undefined>(undefined);

export function useCustomers(): CustomerContextType {
  const context = useContext(CustomerContext);
  if (context === undefined) {
    throw new Error('useCustomers must be used within a CustomerProvider');
  }
  return context;
}

export function getHourlyRatesForCustomer(
  customers: Customer[],
  hourlyRates: HourlyRate[],
  customerId?: string
): HourlyRate[] {
  if (!customerId) return hourlyRates;

  const customer = customers.find(c => c.id === customerId);
  return customer?.hourlyRates?.length ? customer.hourlyRates : hourlyRates;
}

export function getMaterialTemplatesForCustomer(
  customers: Customer[],
  materialTemplates: MaterialTemplate[],
  customerId?: string
): MaterialTemplate[] {
  if (!customerId) return materialTemplates;

  const customer = customers.find(c => c.id === customerId);
  return customer?.materials?.length ? customer.materials : materialTemplates;
}

interface CombinedRate extends HourlyRate {
  displayName: string;
  isGeneral: boolean;
  isCustomerSpecific: boolean;
}

interface CombinedMaterial extends MaterialTemplate {
  displayName: string;
  isGeneral: boolean;
  isCustomerSpecific: boolean;
}

export function getCombinedHourlyRatesForCustomer(
  customers: Customer[],
  hourlyRates: HourlyRate[],
  showCombinedDropdowns: boolean,
  customerId: string | undefined,
  specificLabel: string
): CombinedRate[] {
  if (!showCombinedDropdowns) {
    const originalRates = getHourlyRatesForCustomer(customers, hourlyRates, customerId);
    const customer = customerId ? customers.find(c => c.id === customerId) : undefined;
    return originalRates.map(rate => ({
      ...rate,
      displayName: rate.name,
      isGeneral: !customerId || !customer?.hourlyRates?.some(hr => hr.id === rate.id),
      isCustomerSpecific: !!(customerId && customer?.hourlyRates?.some(hr => hr.id === rate.id)),
    }));
  }

  const rates: CombinedRate[] = hourlyRates.map(rate => ({
    ...rate,
    displayName: `${rate.name} (Allgemein)`,
    isGeneral: true,
    isCustomerSpecific: false,
  }));

  if (customerId) {
    const customer = customers.find(c => c.id === customerId);
    customer?.hourlyRates?.forEach(rate => {
      rates.push({
        ...rate,
        displayName: `${rate.name} (${specificLabel})`,
        isGeneral: false,
        isCustomerSpecific: true,
      });
    });
  }

  return rates;
}

export function getCombinedMaterialTemplatesForCustomer(
  customers: Customer[],
  materialTemplates: MaterialTemplate[],
  showCombinedDropdowns: boolean,
  customerId: string | undefined,
  specificLabel: string
): CombinedMaterial[] {
  if (!showCombinedDropdowns) {
    const originalMaterials = getMaterialTemplatesForCustomer(customers, materialTemplates, customerId);
    const customer = customerId ? customers.find(c => c.id === customerId) : undefined;
    return originalMaterials.map(material => ({
      ...material,
      displayName: material.name,
      isGeneral: !customerId || !customer?.materials?.some(item => item.id === material.id),
      isCustomerSpecific: !!(customerId && customer?.materials?.some(item => item.id === material.id)),
    }));
  }

  const materials: CombinedMaterial[] = materialTemplates.map(material => ({
    ...material,
    displayName: `${material.name} (Allgemein)`,
    isGeneral: true,
    isCustomerSpecific: false,
  }));

  if (customerId) {
    const customer = customers.find(c => c.id === customerId);
    customer?.materials?.forEach(material => {
      materials.push({
        ...material,
        displayName: `${material.name} (${specificLabel})`,
        isGeneral: false,
        isCustomerSpecific: true,
      });
    });
  }

  return materials;
}
