import type { Invoice, Quote, JobEntry, TerminologyProfile } from '../types';
import { getTerminology } from './terminology';

export interface PreviewDocument {
  id: string;
  name: string;
  type: 'invoice-pdf' | 'job-pdf' | 'quote-pdf' | 'attachment';
  size?: number;
  content?: string;
  contentType?: string;
  invoice?: Invoice;
  job?: JobEntry;
  quote?: Quote;
  pdfFormat?: 'zugferd' | 'xrechnung';
}

export function createInvoiceAttachmentPreviewDocuments(invoice: Invoice): PreviewDocument[] {
  const documents: PreviewDocument[] = [{
    id: `invoice-pdf-${invoice.id}`,
    name: `Rechnung_${invoice.invoiceNumber}.pdf`,
    type: 'invoice-pdf',
    invoice,
    pdfFormat: 'zugferd',
  }];

  invoice.attachments?.forEach(attachment => {
    documents.push({
      id: attachment.id,
      name: attachment.name,
      type: 'attachment',
      content: attachment.content,
      contentType: attachment.contentType,
      size: attachment.size,
    });
  });

  return documents;
}

export function createQuoteAttachmentPreviewDocuments(quote: Quote): PreviewDocument[] {
  const documents: PreviewDocument[] = [{
    id: `quote-pdf-${quote.id}`,
    name: `Angebot_${quote.quoteNumber}.pdf`,
    type: 'quote-pdf',
    quote,
  }];

  quote.attachments?.forEach(attachment => {
    documents.push({
      id: attachment.id,
      name: attachment.name,
      type: 'attachment',
      content: attachment.content,
      contentType: attachment.contentType,
      size: attachment.size,
    });
  });

  return documents;
}

export function createJobAttachmentPreviewDocuments(
  job: JobEntry,
  terminologyProfile?: TerminologyProfile,
): PreviewDocument[] {
  const terminology = getTerminology(terminologyProfile);
  const documents: PreviewDocument[] = [{
    id: `job-pdf-${job.id}`,
    name: `${terminology.work.singular}_${job.jobNumber || job.id.slice(-8).toUpperCase()}.pdf`,
    type: 'job-pdf',
    job,
  }];

  job.attachments?.forEach(attachment => {
    documents.push({
      id: attachment.id,
      name: attachment.name,
      type: 'attachment',
      content: attachment.content,
      contentType: attachment.contentType,
      size: attachment.size,
    });
  });

  return documents;
}
