import {
  useCustomers,
  getCombinedHourlyRatesForCustomer,
  getCombinedMaterialTemplatesForCustomer,
  getHourlyRatesForCustomer,
  getMaterialTemplatesForCustomer,
} from '../context/CustomerContext';
import { useCompany } from '../context/CompanyContext';
import { useJobs, generateInvoiceFromJobs } from '../context/JobContext';
import { getTerminology } from '../utils/terminology';

export function useDocumentHelpers() {
  const { customers } = useCustomers();
  const companyCtx = useCompany();
  const { jobEntries } = useJobs();
  const terminology = getTerminology(companyCtx.company.terminologyProfile);

  return {
    getHourlyRatesForCustomer: (customerId?: string) =>
      getHourlyRatesForCustomer(customers, companyCtx.hourlyRates, customerId),

    getMaterialTemplatesForCustomer: (customerId?: string) =>
      getMaterialTemplatesForCustomer(customers, companyCtx.materialTemplates, customerId),

    getCombinedHourlyRatesForCustomer: (customerId?: string) =>
      getCombinedHourlyRatesForCustomer(
        customers,
        companyCtx.hourlyRates,
        companyCtx.company.showCombinedDropdowns ?? false,
        customerId,
        terminology.entity.specificOptionLabel
      ),

    getCombinedMaterialTemplatesForCustomer: (customerId?: string) =>
      getCombinedMaterialTemplatesForCustomer(
        customers,
        companyCtx.materialTemplates,
        companyCtx.company.showCombinedDropdowns ?? false,
        customerId,
        terminology.entity.specificOptionLabel
      ),

    generateInvoiceFromJobs: async (
      jobIds: string[],
      type: 'single' | 'daily' | 'monthly',
      date?: Date
    ) => {
      await generateInvoiceFromJobs(
        jobIds,
        type,
        jobEntries,
        customers,
        companyCtx.company,
        date
      );
    },
  };
}
