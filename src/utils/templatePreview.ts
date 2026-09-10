import type { Company, Customer, DocumentTemplate, Invoice, JobEntry, Quote } from '../types';
import { calculateDocumentMoney } from '../../backend/utils/documentMoney.js';
import { generateInvoicePDF, generateJobPDF, generateQuotePDF, generateReminderPDF } from './pdfGenerator';

export interface TemplatePreviewResult {
  blob: Blob;
  fileName: string;
}

const PREVIEW_DATE = new Date('2026-02-20T10:00:00.000Z');
const PREVIEW_DUE_DATE = new Date('2026-03-06T10:00:00.000Z');

export const templatePreviewCustomer: Customer = {
  id: 'template-preview-customer',
  customerNumber: 'KD-10042',
  name: 'Vincent Vogelstetter',
  email: 'vincent.vogelstetter@example.de',
  address: 'Jede Straße 123',
  city: 'Jede Stadt',
  postalCode: '12345',
  country: 'Deutschland',
  phone: '+49 30 1234567',
  createdAt: PREVIEW_DATE,
};

const previewInvoiceItems = [
  { id: 'template-preview-invoice-item-1', description: 'Beratung und Analyse', quantity: 6, unitPrice: 185, taxRate: 19, total: 1110, order: 1 },
  { id: 'template-preview-invoice-item-2', description: 'Leistungserbringung', quantity: 12, unitPrice: 95, taxRate: 19, total: 1140, order: 2 },
  { id: 'template-preview-invoice-item-3', description: 'Dokumentation', quantity: 1, unitPrice: 680, taxRate: 19, total: 680, order: 3 },
];

export const templatePreviewInvoice: Invoice = {
  id: 'template-preview-invoice',
  invoiceNumber: 'RE-2026-0042',
  customerId: templatePreviewCustomer.id,
  customerName: templatePreviewCustomer.name,
  issueDate: PREVIEW_DATE,
  dueDate: PREVIEW_DUE_DATE,
  items: previewInvoiceItems,
  subtotal: 2930,
  taxAmount: 556.7,
  total: 3486.7,
  outstandingAmount: 3486.7,
  status: 'sent',
  notes: 'Vielen Dank für die gute Zusammenarbeit.',
  createdAt: PREVIEW_DATE,
};

const previewQuoteItems = [
  { id: 'template-preview-quote-item-1', description: 'Konzeption und Workshop', quantity: 4, unitPrice: 320, taxRate: 19, total: 1280, order: 1 },
  { id: 'template-preview-quote-item-2', description: 'Umsetzung und Abstimmung', quantity: 8, unitPrice: 540, taxRate: 19, total: 4320, order: 2 },
  { id: 'template-preview-quote-item-3', description: 'Übergabe und Dokumentation', quantity: 1, unitPrice: 680, taxRate: 19, total: 680, order: 3 },
];

export const templatePreviewQuote: Quote = {
  id: 'template-preview-quote',
  quoteNumber: 'ANG-2026-0018',
  customerId: templatePreviewCustomer.id,
  customerName: templatePreviewCustomer.name,
  issueDate: PREVIEW_DATE,
  validUntil: new Date('2026-03-22T10:00:00.000Z'),
  items: previewQuoteItems,
  subtotal: 6280,
  taxAmount: 1193.2,
  total: 7473.2,
  status: 'draft',
  notes: 'Dieses Angebot dient als Beispiel für die Vorlagenvorschau.',
  createdAt: PREVIEW_DATE,
};

export const templatePreviewJob: JobEntry = {
  id: 'template-preview-job',
  jobNumber: 'AUF-2026-007',
  customerId: templatePreviewCustomer.id,
  customerName: templatePreviewCustomer.name,
  customerAddress: 'Jede Straße 123\n12345 Jede Stadt',
  title: 'Website-Konzeption',
  description: 'Konzeption, Gestaltung und Abstimmung einer neuen Website.',
  date: PREVIEW_DATE,
  hoursWorked: 8.5,
  hourlyRate: 120,
  timeEntries: [
    { id: 'template-preview-job-time-1', description: 'Konzeption und Workshop', hoursWorked: 5, hourlyRate: 120, taxRate: 19, total: 600 },
    { id: 'template-preview-job-time-2', description: 'Gestaltung und Abstimmung', hoursWorked: 3.5, hourlyRate: 120, taxRate: 19, total: 420 },
  ],
  materials: [
    { id: 'template-preview-job-material-1', description: 'Bild- und Icon-Lizenzen', quantity: 1, unitPrice: 85, unit: 'Pauschale', taxRate: 19, total: 85 },
  ],
  status: 'completed',
  createdAt: PREVIEW_DATE,
};

function previewTaxRate(company: Company): number {
  return company.isSmallBusiness ? 0 : 19;
}

function previewInvoiceForCompany(company: Company): Invoice {
  const money = calculateDocumentMoney({
    items: previewInvoiceItems.map(item => ({ ...item, taxRate: previewTaxRate(company) })),
  });

  return {
    ...templatePreviewInvoice,
    items: previewInvoiceItems.map((item, index) => ({ ...item, taxRate: previewTaxRate(company), total: money.items[index].total })),
    subtotal: money.subtotal,
    taxAmount: money.taxAmount,
    total: money.total,
    outstandingAmount: money.total,
  };
}

function previewQuoteForCompany(company: Company): Quote {
  const money = calculateDocumentMoney({
    items: previewQuoteItems.map(item => ({ ...item, taxRate: previewTaxRate(company) })),
  }, { documentType: 'quote' });

  return {
    ...templatePreviewQuote,
    items: previewQuoteItems.map((item, index) => ({ ...item, taxRate: previewTaxRate(company), total: money.items[index].total })),
    subtotal: money.subtotal,
    taxAmount: money.taxAmount,
    total: money.total,
  };
}

function previewJobForCompany(company: Company): JobEntry {
  const timeEntries = templatePreviewJob.timeEntries || [];
  const materials = templatePreviewJob.materials || [];
  const money = calculateDocumentMoney({
    items: [
      ...timeEntries.map(entry => ({
        description: entry.description,
        quantity: entry.hoursWorked,
        unitPrice: entry.hourlyRate,
        taxRate: previewTaxRate(company),
      })),
      ...materials.map(material => ({
        description: material.description,
        quantity: material.quantity,
        unitPrice: material.unitPrice,
        taxRate: previewTaxRate(company),
      })),
    ],
  });

  return {
    ...templatePreviewJob,
    timeEntries: timeEntries.map((entry, index) => ({
      ...entry,
      taxRate: previewTaxRate(company),
      total: money.items[index].total,
    })),
    materials: materials.map((material, index) => ({
      ...material,
      taxRate: previewTaxRate(company),
      total: money.items[timeEntries.length + index].total,
    })),
  };
}

function companyWithPreviewTemplate(company: Company, template: DocumentTemplate): Company {
  const templates = (company.documentTemplates || [])
    .filter(entry => entry.documentType !== template.documentType);

  return {
    ...company,
    documentTemplates: [...templates, { ...template, isDefault: true }],
  };
}

export async function generateTemplatePreview(template: DocumentTemplate, company: Company): Promise<TemplatePreviewResult> {
  const previewCompany = companyWithPreviewTemplate(company, template);
  const previewInvoice = previewInvoiceForCompany(company);
  const previewQuote = previewQuoteForCompany(company);
  const previewJob = previewJobForCompany(company);

  switch (template.documentType) {
    case 'invoice': {
      const blob = await generateInvoicePDF(previewInvoice, { format: 'pdf', company: previewCompany, customer: templatePreviewCustomer });
      return { blob, fileName: `Vorschau_${previewInvoice.invoiceNumber}.pdf` };
    }
    case 'quote': {
      const blob = await generateQuotePDF(previewQuote, { company: previewCompany, customer: templatePreviewCustomer });
      return { blob, fileName: `Vorschau_${previewQuote.quoteNumber}.pdf` };
    }
    case 'orderConfirmation': {
      const blob = await generateJobPDF(previewJob, { company: previewCompany, customer: templatePreviewCustomer });
      return { blob, fileName: `Vorschau_${previewJob.jobNumber}.pdf` };
    }
    case 'reminder': {
      const blob = await generateReminderPDF(
        previewInvoice,
        1,
        template.introText || 'Bitte begleichen Sie den offenen Rechnungsbetrag innerhalb der Zahlungsfrist.',
        previewCompany.reminderFeeStage1 || 0,
        { format: 'pdf', company: previewCompany, customer: templatePreviewCustomer },
      );
      return { blob, fileName: `Vorschau_Mahnung_${previewInvoice.invoiceNumber}.pdf` };
    }
  }

  throw new Error('Unbekannter Vorlagentyp.');
}
