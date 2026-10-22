/**
 * PDF Generator - Main entry point
 * Refactored for better maintainability and organization
 */

import jsPDF from 'jspdf';
import { apiService } from '../services/api';
import { Invoice, Company, Customer, JobEntry, Quote } from '../types';
import { formatCurrency, formatDate, formatTime, getNumberLocale } from './formatters';

import {
  calculateTaxBreakdown,
  calculateJobTaxBreakdown,
  checkHasDiscounts,
  hasOnlyZeroTaxRate
} from './pdf/taxCalculations';
import { renderBusinessDocument } from './pdf/documentRenderer';
import type { PdfAmountLine, PdfDocumentModel, PdfField, PdfRenderSettings, PdfSurface, PdfTable } from './pdf/documentRenderer';
import { generateXRechnungXML } from './pdf/xrechnungGenerator';
import { embedZUGFeRDXMLIntoPDF } from './pdf/zugferdGenerator';
import { resolveDocumentTemplate, getReminderTemplateText } from './documentTemplateProfiles';
import type { ResolvedDocumentTemplate } from './documentTemplateProfiles';
import { getEffectivePaymentInformation } from './paymentInformation';
import { buildServiceDatePdfField } from './serviceDate';
import { getTerminology } from './terminology';

// Export types for external use
export interface PDFOptions {
  format: 'pdf' | 'zugferd' | 'xrechnung';
  company: Company;
  customer: Customer;
  /**
   * Neudruck einer übernommenen Rechnung im aktuellen Layout. Nummer, Datum
   * und Beträge bleiben unverändert; das Dokument wird sichtbar als
   * Zweitschrift gekennzeichnet und ersetzt das Original nicht.
   */
  legacyReprint?: boolean;
}

export interface JobPDFOptions {
  company: Company;
  customer: Customer;
}

export interface QuotePDFOptions {
  company: Company;
  customer: Customer;
}

/**
 * Download a blob as a file
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const LEGACY_REPRINT_TITLE = 'Kopie / Neudruck – kein Originalbeleg';
const LEGACY_REPRINT_NOTICE = 'Diese Rechnung wurde aus einem anderen Programm übernommen und hier im aktuellen Layout neu gedruckt. '
  + 'Rechnungsnummer, Rechnungsdatum und gespeicherte Beträge werden unverändert aus den übernommenen Rechnungsdaten wiedergegeben. '
  + 'Maßgeblich bleibt das ursprünglich ausgestellte Dokument; diese Kopie / dieser Neudruck ist kein zweites Original und keine neue Rechnung. '
  + 'Positionen und Steuersätze können aus den übernommenen Daten rekonstruiert sein; für Einzelpositionen und Rundungen gilt das Original.';

function mergeCurrentInvoiceLayout(snapshotCompany: Company, currentCompany: Company): Company {
  const currentLayout = resolveDocumentTemplate(currentCompany, 'invoice');
  const layoutFields = {
    layout: currentLayout.layout,
    accentColor: currentLayout.accentColor,
    fontFamily: currentLayout.fontFamily,
    logoMode: currentLayout.logoMode,
    showPaymentInformation: currentLayout.showPaymentInformation,
    showFooter: currentLayout.showFooter,
  };
  const savedTemplates = snapshotCompany.documentTemplates || [];
  const snapshotSelectedIndex = savedTemplates.findIndex(template => template.documentType === 'invoice' && template.isDefault)
    >= 0
    ? savedTemplates.findIndex(template => template.documentType === 'invoice' && template.isDefault)
    : savedTemplates.findIndex(template => template.documentType === 'invoice');
  const documentTemplates = [...savedTemplates];

  if (snapshotSelectedIndex >= 0) {
    documentTemplates[snapshotSelectedIndex] = {
      ...documentTemplates[snapshotSelectedIndex],
      ...layoutFields,
      isDefault: true,
    };
  } else {
    documentTemplates.push({
      id: 'legacy-reprint-current-layout',
      documentType: 'invoice',
      name: currentLayout.name,
      isDefault: true,
      ...layoutFields,
    });
  }

  return { ...snapshotCompany, documentTemplates };
}

/**
 * Original einer übernommenen Rechnung. Für Rechnungen aus einem anderen
 * Programm ist das hinterlegte Original maßgeblich; ein eigenes Dokument
 * entsteht nur als ausdrücklich gekennzeichnete Zweitschrift.
 */
export async function loadImportedInvoiceOriginal(invoice: Invoice): Promise<{ blob: Blob; name: string }> {
  if (!invoice.hasOriginalDocument) {
    throw new Error(`Für die übernommene Rechnung ${invoice.invoiceNumber} ist kein Original hinterlegt. Bitte das Original-PDF an der Rechnung hinterlegen.`);
  }
  const document = await apiService.getInvoiceOriginalDocument(invoice.id);
  const binary = atob(document.content);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { blob: new Blob([bytes], { type: document.contentType }), name: document.name };
}

const SMALL_BUSINESS_CLAUSE = 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet (Kleinunternehmerregelung).';
const REVERSE_CHARGE_CLAUSE = 'Gemäß § 13b UStG geht die Steuerschuld auf den Leistungsempfänger über.';

function renderSettings(template: ResolvedDocumentTemplate): PdfRenderSettings {
  return {
    design: template.layout,
    font: template.fontFamily,
    accentColor: template.accentColor,
    showLogo: template.logoMode !== 'none',
    showFooter: template.showFooter,
    showBankDetails: template.showPaymentInformation,
  };
}

function documentFormatters(company: Company) {
  const locale = company.locale || 'de-DE';
  const quantityFormat = new Intl.NumberFormat(getNumberLocale(locale, company.numberFormat), { maximumFractionDigits: 3 });
  return {
    locale,
    money: (value: number) => formatCurrency(value, locale, company.numberFormat, company.currency),
    quantity: (value: number) => (Number.isFinite(value) ? quantityFormat.format(value) : ''),
    date: (value: Date | string) => formatDate(value, locale, company.dateFormat),
  };
}

/** Kundennummer und USt-IdNr. des Empfängers für den Informationsblock. */
function customerMetaFields(company: Company, customer: Customer): PdfField[] {
  const terminology = getTerminology(company.terminologyProfile);
  return [
    customer.customerNumber ? { label: terminology.entity.numberShortLabel.replace(/:\s*$/, ''), value: customer.customerNumber } : null,
    customer.taxId ? { label: 'Ihre USt-IdNr.', value: customer.taxId } : null,
  ].filter((field): field is PdfField => Boolean(field));
}

function itemColumns(showDiscounts: boolean): PdfTable['columns'] {
  return [
    { label: 'Pos.', width: 11 },
    { label: 'Beschreibung' },
    { label: 'Menge', width: 17, align: 'right' },
    { label: 'Einzelpreis', width: 25, align: 'right' },
    ...(showDiscounts ? [{ label: 'Rabatt', width: 19, align: 'right' as const }] : []),
    { label: 'MwSt.', width: 14, align: 'right' },
    { label: 'Gesamt', width: 27, align: 'right' },
  ];
}

function taxLines(
  breakdown: Record<number, { taxAmount: number }>,
  totalTax: number,
  money: (value: number) => string,
): PdfAmountLine[] {
  const rates = Object.keys(breakdown)
    .filter(rate => Number(rate) > 0)
    .sort((a, b) => Number(a) - Number(b));
  const lines: PdfAmountLine[] = rates.map(rate => ({
    label: `MwSt. (${rate}%)`,
    value: money(breakdown[Number(rate)].taxAmount),
  }));
  if (rates.length > 1) lines.push({ label: 'MwSt. gesamt', value: money(totalTax) });
  return lines;
}

/** Inhalt eines Dokuments samt aufgelöster Vorlage, bereit zum Zeichnen. */
export interface PreparedDocument {
  model: PdfDocumentModel;
  template: ResolvedDocumentTemplate;
  company: Company;
}

/**
 * Zeichnet ein vorbereitetes Dokument auf eine beliebige Fläche: jsPDF für
 * die Datei, eine Aufzeichnung für die sofortige Vorschau.
 */
export async function drawPreparedDocument(surface: PdfSurface, prepared: PreparedDocument): Promise<void> {
  await renderBusinessDocument(surface, prepared.model, renderSettings(prepared.template), prepared.company);
}

async function outputDocument(prepared: PreparedDocument): Promise<jsPDF> {
  const pdf = new jsPDF();
  // Der PDF-Viewer zeigt sonst die technische Blob-ID als Dokumenttitel.
  pdf.setProperties({ title: [prepared.model.title, prepared.model.number].filter(Boolean).join(' '), creator: 'SoloOffice' });
  await drawPreparedDocument(pdf, prepared);
  return pdf;
}

/**
 * Generate Invoice PDF
 */
export async function generateInvoicePDF(invoice: Invoice, options: PDFOptions): Promise<Blob> {
  const isLegacyReprint = invoice.origin === 'imported' && options.legacyReprint === true;
  if (invoice.origin === 'imported' && !isLegacyReprint) {
    return (await loadImportedInvoiceOriginal(invoice)).blob;
  }
  if (isLegacyReprint && options.format !== 'pdf') {
    // Eine E-Rechnung aus einem Fremdbeleg zu erzeugen würde einen neuen,
    // steuerlich eigenständigen Datensatz vortäuschen.
    throw new Error('Für die Zweitschrift einer übernommenen Rechnung ist nur ein PDF möglich, keine E-Rechnung.');
  }
  if (isLegacyReprint && invoice.documentSnapshot?.version !== 1) {
    throw new Error('Für den Neudruck fehlt der historische Firmen- und Empfänger-Snapshot. Bitte verwenden Sie das Originaldokument.');
  }
  if (invoice.documentSnapshot?.version === 1) {
    const snapshotCompany = invoice.documentSnapshot.company;
    options = {
      ...options,
      company: isLegacyReprint ? mergeCurrentInvoiceLayout(snapshotCompany, options.company) : snapshotCompany,
      customer: invoice.documentSnapshot.customer,
    };
  }
  // For XRechnung format, generate XML instead of PDF
  if (options.format === 'xrechnung') {
    return generateXRechnungXML(invoice, options);
  }

  const pdf = await outputDocument(prepareInvoiceDocument(invoice, options, isLegacyReprint));

  // === EMBED ZUGFERD XML ===
  if (options.format === 'pdf') return pdf.output('blob');
  return await embedZUGFeRDXMLIntoPDF(pdf.output('arraybuffer'), invoice, options);
}

/** Inhalt einer Rechnung oder Gutschrift; Snapshot und Neudruck sind bereits aufgelöst. */
export function prepareInvoiceDocument(invoice: Invoice, options: PDFOptions, isLegacyReprint = false): PreparedDocument {
  const { company, customer } = options;
  const format = documentFormatters(company);
  const terminology = getTerminology(company.terminologyProfile);
  const template = resolveDocumentTemplate(company, 'invoice');
  const isCreditNote = invoice.documentType === 'credit_note';

  const issueDate = new Date(invoice.issueDate);
  const dueDate = new Date(invoice.dueDate);
  const isImmediatePayment = Math.ceil((dueDate.getTime() - issueDate.getTime()) / (1000 * 3600 * 24)) <= 0;
  const serviceDate = buildServiceDatePdfField(invoice, format.locale, company.dateFormat);

  // === POSITIONEN ===
  const showDiscounts = company.discountsEnabled !== false && checkHasDiscounts(invoice.items);
  const sortedItems = [...invoice.items].sort((a, b) => (a.order || 0) - (b.order || 0));
  const rows = sortedItems.map((item, index) => {
    let description = item.description;
    // Der Importplan legt bei Datensätzen ohne Einzelpositionen eine
    // Sammelposition an. Im Neudruck muss erkennbar bleiben, dass dies keine
    // überlieferte Einzelposition ist.
    if (isLegacyReprint && description.toLocaleLowerCase().startsWith(`rechnung ${invoice.invoiceNumber}`.toLocaleLowerCase())) {
      description = 'Importierter Gesamtbetrag – keine Einzelpositionen überliefert';
    }
    if (item.jobNumber) {
      description = `${description} (${terminology.work.singular}: ${item.jobNumber})`;
    }
    const discountAmount = item.discountAmount || 0;
    const discount = discountAmount > 0
      ? (item.discountType === 'percentage' ? `${item.discountValue}%` : format.money(item.discountValue || 0))
      : '–';
    const itemTotal = isLegacyReprint && Number.isFinite(item.total)
      ? item.total
      : (item.quantity * item.unitPrice) - discountAmount;
    return [
      String(index + 1),
      description,
      format.quantity(item.quantity),
      format.money(item.unitPrice),
      ...(showDiscounts ? [discount] : []),
      `${item.taxRate}%`,
      format.money(itemTotal),
    ];
  });

  // === SUMMEN ===
  const itemDiscountAmount = invoice.items?.reduce((sum, item) => sum + (item.discountAmount || 0), 0) || 0;
  const globalDiscountAmount = invoice.globalDiscountAmount || 0;
  const totalLines: PdfAmountLine[] = [{ label: 'Zwischensumme', value: format.money(invoice.subtotal) }];
  if (itemDiscountAmount !== 0) totalLines.push({ label: 'Artikelrabatte', value: format.money(-itemDiscountAmount), tone: 'negative' });
  if (globalDiscountAmount !== 0) totalLines.push({ label: 'Gesamtrabatt', value: format.money(-globalDiscountAmount), tone: 'negative' });
  if (itemDiscountAmount !== 0 || globalDiscountAmount !== 0) {
    totalLines.push({ label: 'Nettobetrag', value: format.money(invoice.subtotal - itemDiscountAmount - globalDiscountAmount) });
  }
  if (isLegacyReprint) {
    // Für eine Zweitschrift werden keine Steuerbeträge aus Positionen
    // nachgerechnet: ausgewiesen wird ausschließlich der gespeicherte Importwert.
    if (Number(invoice.taxAmount) !== 0) totalLines.push({ label: 'Steuerbetrag', value: format.money(invoice.taxAmount) });
  } else {
    totalLines.push(...taxLines(calculateTaxBreakdown(invoice.items, invoice), invoice.taxAmount, format.money));
  }

  // === ZAHLUNG ===
  const paymentInfo = getEffectivePaymentInformation(company);
  const paymentTerms = template.paymentTerms || paymentInfo.paymentTerms;
  const payment: PdfDocumentModel['payment'] = template.showPaymentInformation && paymentInfo.bankAccount
    ? {
        heading: 'Zahlungsinformationen',
        emphasis: isImmediatePayment ? company.immediatePaymentClause : undefined,
        intro: paymentTerms || 'Bitte überweisen Sie den Betrag auf folgendes Konto:',
        fields: [
          { label: 'Kontoinhaber', value: paymentInfo.accountHolder || company.name },
          { label: 'IBAN', value: paymentInfo.bankAccount },
          ...(paymentInfo.bic ? [{ label: 'BIC', value: paymentInfo.bic }] : []),
          ...(paymentInfo.bankName ? [{ label: 'Bank', value: paymentInfo.bankName }] : []),
          { label: 'Verwendungszweck', value: invoice.invoiceNumber },
        ],
      }
    : undefined;

  const documentNotes = [
    invoice.referenceInvoiceNumber ? `Bezug zur Rechnung: ${invoice.referenceInvoiceNumber}` : '',
    invoice.creditNoteReason ? `Grund: ${invoice.creditNoteReason}` : '',
    invoice.notes || '',
  ].filter(Boolean).join('\n');

  const model: PdfDocumentModel = {
    title: isCreditNote ? 'Gutschrift' : 'Rechnung',
    number: invoice.invoiceNumber,
    meta: [
      { label: isCreditNote ? 'Gutschrift-Nr.' : 'Rechnungs-Nr.', value: invoice.invoiceNumber },
      { label: 'Datum', value: format.date(invoice.issueDate) },
      { label: serviceDate.label.replace(/:\s*$/, ''), value: serviceDate.value },
      { label: 'Fällig am', value: isImmediatePayment ? 'sofort' : format.date(invoice.dueDate) },
      ...customerMetaFields(company, customer),
    ],
    recipient: customer,
    // Kennzeichnung der Zweitschrift unmittelbar unter dem Kopf: Sie darf
    // nicht zu überlesen sein und steht deshalb vor dem Einleitungstext.
    notice: isLegacyReprint ? { title: LEGACY_REPRINT_TITLE, text: LEGACY_REPRINT_NOTICE } : undefined,
    intro: template.introText,
    table: { columns: itemColumns(showDiscounts), rows },
    totals: { lines: totalLines, grand: { label: 'Gesamtbetrag', value: format.money(invoice.total) } },
    clauses: !isLegacyReprint && hasOnlyZeroTaxRate(invoice.items)
      ? [company.isSmallBusiness ? SMALL_BUSINESS_CLAUSE : REVERSE_CHARGE_CLAUSE]
      : [],
    notes: documentNotes ? { heading: 'Anmerkungen', text: documentNotes } : undefined,
    payment,
    // Ohne Bankverbindung stehen die Zahlungsbedingungen als eigener Absatz.
    texts: [template.showPaymentInformation && !payment ? paymentTerms || '' : '', template.closingText || ''],
  };

  return { model, template, company };
}

/**
 * Generate Job PDF
 */
export async function generateJobPDF(job: JobEntry, options: JobPDFOptions): Promise<Blob> {
  return (await outputDocument(prepareJobDocument(job, options))).output('blob');
}

export function prepareJobDocument(job: JobEntry, options: JobPDFOptions): PreparedDocument {
  const { company, customer } = options;
  const format = documentFormatters(company);
  const terminology = getTerminology(company.terminologyProfile);
  const template = resolveDocumentTemplate(company, 'orderConfirmation');
  const taxRateOf = (rate: number | undefined | null) => (company.isSmallBusiness ? 0 : (rate != null ? rate : 19));

  const timeEntries = job.timeEntries && job.timeEntries.length > 0
    ? job.timeEntries
    : [{ description: 'Arbeitsleistung', hoursWorked: job.hoursWorked, hourlyRate: job.hourlyRate, taxRate: 19 }];
  const rows: string[][] = [
    ...timeEntries.map(entry => [
      entry.description || 'Arbeitsleistung',
      `${format.quantity(entry.hoursWorked)} Std.`,
      format.money(entry.hourlyRate),
      `${taxRateOf(entry.taxRate)}%`,
      format.money(entry.hoursWorked * entry.hourlyRate),
    ]),
    ...(job.materials || []).map(material => [
      material.description,
      [format.quantity(material.quantity), material.unit].filter(Boolean).join(' '),
      format.money(material.unitPrice),
      `${taxRateOf(material.taxRate)}%`,
      format.money(material.quantity * material.unitPrice),
    ]),
  ].map((row, index) => [String(index + 1), ...row]);

  const taxBreakdown = calculateJobTaxBreakdown(job, company.isSmallBusiness);
  const subtotal = Object.values(taxBreakdown).reduce((sum, breakdown) => sum + breakdown.taxableAmount, 0);
  const totalTaxAmount = Object.values(taxBreakdown).reduce((sum, breakdown) => sum + breakdown.taxAmount, 0);

  const statusLabel = job.status === 'completed' ? 'Abgeschlossen' : job.status === 'in-progress' ? 'In Bearbeitung' : 'Offen';
  const executionAddress = job.customerAddress?.split('\n').map(line => line.trim()).filter(Boolean).join(', ');

  const model: PdfDocumentModel = {
    title: terminology.work.confirmationLabel,
    number: job.jobNumber,
    meta: [
      { label: terminology.work.numberShortLabel.replace(/:\s*$/, ''), value: job.jobNumber },
      { label: 'Datum', value: format.date(job.date) },
      { label: 'Status', value: statusLabel },
      ...customerMetaFields(company, customer),
    ],
    recipient: customer,
    intro: template.introText,
    blocks: [
      ...(executionAddress ? [{ heading: 'Ausführungsort', text: executionAddress }] : []),
      ...(job.description ? [{ heading: terminology.work.descriptionLabel, text: job.description }] : []),
    ],
    table: {
      columns: [
        { label: 'Pos.', width: 11 },
        { label: 'Beschreibung' },
        { label: 'Menge', width: 22, align: 'right' },
        { label: 'Einzelpreis', width: 25, align: 'right' },
        { label: 'MwSt.', width: 14, align: 'right' },
        { label: 'Gesamt', width: 27, align: 'right' },
      ],
      rows,
    },
    totals: {
      lines: [
        { label: 'Nettobetrag', value: format.money(subtotal) },
        ...taxLines(taxBreakdown, totalTaxAmount, format.money),
      ],
      grand: { label: 'Gesamtbetrag', value: format.money(subtotal + totalTaxAmount) },
    },
    clauses: company.isSmallBusiness || totalTaxAmount === 0
      ? [company.isSmallBusiness ? SMALL_BUSINESS_CLAUSE : REVERSE_CHARGE_CLAUSE]
      : [],
    notes: job.notes ? { heading: 'Anmerkungen', text: job.notes } : undefined,
    texts: [template.paymentTerms || '', template.closingText || ''],
    signature: job.signature
      ? {
          heading: terminology.entity.signatureLabel,
          lines: [
            `${terminology.entity.singular}: ${job.signature.customerName}`,
            `Unterschrieben am: ${format.date(job.signature.signedAt)} ${formatTime(job.signature.signedAt, format.locale, company.timeFormat)}`,
          ],
          image: job.signature.signatureData?.startsWith('data:image/') ? job.signature.signatureData : undefined,
        }
      : undefined,
  };

  return { model, template, company };
}

/**
 * Generate Quote PDF
 */
export async function generateQuotePDF(quote: Quote, options: QuotePDFOptions): Promise<Blob> {
  return (await outputDocument(prepareQuoteDocument(quote, options))).output('blob');
}

export function prepareQuoteDocument(quote: Quote, options: QuotePDFOptions): PreparedDocument {
  const { company, customer } = options;
  const format = documentFormatters(company);
  const template = resolveDocumentTemplate(company, 'quote');

  const showDiscounts = company.discountsEnabled !== false && checkHasDiscounts(quote.items);
  const sortedItems = [...quote.items].sort((a, b) => (a.order || 0) - (b.order || 0));
  const rows = sortedItems.map((item, index) => {
    const discountAmount = item.discountAmount || 0;
    const discount = discountAmount > 0
      ? (item.discountType === 'percentage' ? `${item.discountValue}%` : format.money(item.discountValue || 0))
      : '–';
    return [
      String(index + 1),
      item.description,
      format.quantity(item.quantity),
      format.money(item.unitPrice),
      ...(showDiscounts ? [discount] : []),
      `${item.taxRate}%`,
      format.money((item.quantity * item.unitPrice) - discountAmount),
    ];
  });

  const itemDiscountAmount = quote.items?.reduce((sum, item) => sum + (item.discountAmount || 0), 0) || 0;
  const globalDiscountAmount = quote.globalDiscountAmount || 0;
  const totalLines: PdfAmountLine[] = [{ label: 'Zwischensumme', value: format.money(quote.subtotal) }];
  if (itemDiscountAmount > 0) totalLines.push({ label: 'Artikelrabatte', value: `-${format.money(itemDiscountAmount)}`, tone: 'negative' });
  if (globalDiscountAmount > 0) totalLines.push({ label: 'Gesamtrabatt', value: `-${format.money(globalDiscountAmount)}`, tone: 'negative' });
  if (itemDiscountAmount > 0 || globalDiscountAmount > 0) {
    totalLines.push({ label: 'Nettobetrag', value: format.money(quote.subtotal - itemDiscountAmount - globalDiscountAmount) });
  }
  totalLines.push(...taxLines(calculateTaxBreakdown(quote.items, {
    id: quote.id,
    taxAmount: quote.taxAmount,
    total: quote.total,
    globalDiscountType: quote.globalDiscountType,
    globalDiscountValue: quote.globalDiscountValue,
    globalDiscountAmount: quote.globalDiscountAmount,
  }), quote.taxAmount, format.money));

  const model: PdfDocumentModel = {
    title: 'Angebot',
    number: quote.quoteNumber,
    meta: [
      { label: 'Angebots-Nr.', value: quote.quoteNumber },
      { label: 'Datum', value: format.date(quote.issueDate) },
      { label: 'Gültig bis', value: format.date(quote.validUntil) },
      ...customerMetaFields(company, customer),
    ],
    recipient: customer,
    intro: template.introText,
    table: { columns: itemColumns(showDiscounts), rows },
    totals: { lines: totalLines, grand: { label: 'Gesamtbetrag', value: format.money(quote.total) } },
    clauses: company.isSmallBusiness && hasOnlyZeroTaxRate(quote.items) ? [SMALL_BUSINESS_CLAUSE] : [],
    notes: quote.notes ? { heading: 'Anmerkungen', text: quote.notes } : undefined,
    texts: [template.paymentTerms || '', template.closingText || ''],
  };

  return { model, template, company };
}

/**
 * Generate Reminder PDF
 */
export async function generateReminderPDF(
  invoice: Invoice,
  stage: 1 | 2 | 3,
  reminderText: string,
  _fee: number,
  options: PDFOptions
): Promise<Blob> {
  return (await outputDocument(prepareReminderDocument(invoice, stage, reminderText, options))).output('blob');
}

export function prepareReminderDocument(
  invoice: Invoice,
  stage: 1 | 2 | 3,
  reminderText: string,
  options: PDFOptions,
): PreparedDocument {
  const { company, customer } = options;
  const format = documentFormatters(company);
  const template = resolveDocumentTemplate(company, 'reminder');

  const fees = [company.reminderFeeStage1 || 0, company.reminderFeeStage2 || 0, company.reminderFeeStage3 || 0];
  const cumulativeFee = fees.slice(0, stage).reduce((sum, fee) => sum + fee, 0);
  const paidAmountValue = Math.min(
    Number(invoice.total || 0),
    Math.max(0, Number(invoice.paidAmount ?? (invoice.status === 'paid' ? invoice.total : 0))),
  );
  const outstandingAmountValue = Math.max(
    0,
    Number(invoice.outstandingAmount ?? Number(invoice.total || 0) - paidAmountValue),
  );

  const totalLines: PdfAmountLine[] = [{ label: 'Rechnungsbetrag', value: format.money(invoice.total) }];
  if (paidAmountValue > 0) totalLines.push({ label: 'Bereits bezahlt', value: `- ${format.money(paidAmountValue)}`, tone: 'positive' });
  if (cumulativeFee > 0) totalLines.push({ label: 'Mahngebühren', value: format.money(cumulativeFee), tone: 'negative' });

  const paymentInfo = getEffectivePaymentInformation(company);
  const model: PdfDocumentModel = {
    title: `${stage}. Mahnung`,
    number: `zu Rechnung ${invoice.invoiceNumber}`,
    meta: [
      { label: 'Rechnungs-Nr.', value: invoice.invoiceNumber },
      { label: 'Mahndatum', value: format.date(new Date()) },
      { label: 'Fällig war', value: format.date(invoice.dueDate) },
      ...customerMetaFields(company, customer),
    ],
    recipient: customer,
    intro: getReminderTemplateText(template, stage, reminderText),
    table: {
      columns: [
        { label: 'Rechnung' },
        { label: 'Rechnungsdatum', width: 34 },
        { label: 'Fällig am', width: 30 },
        { label: 'Betrag', width: 32, align: 'right' },
      ],
      rows: [[invoice.invoiceNumber, format.date(invoice.issueDate), format.date(invoice.dueDate), format.money(invoice.total)]],
    },
    totals: {
      lines: totalLines,
      grand: { label: 'Zu zahlender Betrag', value: format.money(outstandingAmountValue + cumulativeFee) },
    },
    payment: template.showPaymentInformation
      ? {
          heading: 'Zahlungsinformationen',
          fields: [
            ...(paymentInfo.bankAccount ? [{ label: 'Kontoinhaber', value: paymentInfo.accountHolder || company.name }] : []),
            ...(paymentInfo.bankAccount ? [{ label: 'IBAN', value: paymentInfo.bankAccount }] : []),
            ...(paymentInfo.bic ? [{ label: 'BIC', value: paymentInfo.bic }] : []),
            { label: 'Verwendungszweck', value: invoice.invoiceNumber },
          ],
        }
      : undefined,
  };

  return { model, template, company };
}
