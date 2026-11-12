export interface QuoteToJobProblem {
  status: number;
  code: 'QUOTE_ALREADY_CONVERTED' | 'QUOTE_BILLED' | 'QUOTE_STATUS_INVALID';
  error: string;
}

export interface QuoteToJobSource {
  id: string;
  quoteNumber: string;
  customerId: string;
  customerName: string;
  status?: string;
  convertedToInvoiceId?: string | null;
  notes?: string | null;
  items?: Array<{
    description?: string;
    quantity?: number | string;
    unitPrice?: number | string;
    taxRate?: number | string;
    total?: number | string;
    order?: number | string;
    discountType?: string | null;
    discountValue?: number | string | null;
    discountAmount?: number | string | null;
  }>;
}

export interface QuoteToJobMaterial {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  total: number;
  discountType?: string;
  discountValue?: number;
  discountAmount?: number;
}

export interface QuoteToJobData {
  customerId: string;
  customerName: string;
  title: string;
  description: string;
  date: string;
  hoursWorked: number;
  hourlyRate: number;
  materials: QuoteToJobMaterial[];
  status: 'draft';
  notes: string | null;
  sourceQuoteId: string;
  sourceQuoteNumber: string;
}

export declare const QUOTE_JOB_ERRORS: Readonly<{ ALREADY_CONVERTED: string; BILLED: string; WRONG_STATUS: string }>;
/** null: erlaubt. Sonst HTTP-Status, Code und Meldung. */
export declare function quoteToJobProblem(quote: Pick<QuoteToJobSource, 'status' | 'convertedToInvoiceId'>, existingJobId?: string | null): QuoteToJobProblem | null;
export declare function quoteStatusAfterJobConversion(status: string): string;
export declare function jobTitleFromQuote(quote: Pick<QuoteToJobSource, 'quoteNumber' | 'items'>): string;
export declare function materialsFromQuoteItems(items: QuoteToJobSource['items'], newId: () => string): QuoteToJobMaterial[];
export declare function quoteToJobData(quote: QuoteToJobSource, options: { today: string; newId: () => string }): QuoteToJobData;
