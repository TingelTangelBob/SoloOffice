/**
 * PDF Generator - Main entry point
 * Refactored for better maintainability and organization
 */

import jsPDF from 'jspdf';
import logger from './logger';
import { Invoice, Company, Customer, JobEntry, Quote } from '../types';
import { formatCurrency, formatDate, formatTime } from './formatters';

// Import modular components
import { getColorConfiguration } from './pdf/colorUtils';
import {
  calculateTaxBreakdown,
  calculateJobTaxBreakdown,
  checkHasDiscounts,
  hasOnlyZeroTaxRate
} from './pdf/taxCalculations';
// loadImage is now used internally by addPDFHeader
import {
  addPDFHeader,
  addPDFFooter,
  drawTableHeader,
  resetFont,
  checkPageBreak
} from './pdf/pdfComponents';
import type { PDFContext, PageMargins } from './pdf/pdfComponents';
import { generateXRechnungXML } from './pdf/xrechnungGenerator';
import { embedZUGFeRDXMLIntoPDF } from './pdf/zugferdGenerator';
import { resolveDocumentTemplate, getReminderTemplateText } from './documentTemplateProfiles';
import { getEffectivePaymentInformation } from './paymentInformation';
import { getTerminology } from './terminology';

const DOCUMENT_PRIMARY_COLOR = '#2563eb';
const DOCUMENT_SECONDARY_COLOR = '#64748b';

// Export types for external use
export interface PDFOptions {
  format: 'zugferd' | 'xrechnung';
  company: Company;
  customer: Customer;
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

/**
 * Generate Invoice PDF
 */
export async function generateInvoicePDF(invoice: Invoice, options: PDFOptions): Promise<Blob> {
  // For XRechnung format, generate XML instead of PDF
  if (options.format === 'xrechnung') {
    return generateXRechnungXML(invoice, options);
  }

  const pdf = new jsPDF();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const locale = options.company.locale || 'de-DE';
  const terminology = getTerminology(options.company.terminologyProfile);
  const template = resolveDocumentTemplate(options.company, 'invoice');
  const isCreditNote = invoice.documentType === 'credit_note';
  const documentTitle = isCreditNote ? 'GUTSCHRIFT' : 'RECHNUNG';
  const documentNumberLabel = isCreditNote ? 'Gutschrift-Nr.:' : 'Rechnungs-Nr.:';
  const documentNotes = [
    invoice.referenceInvoiceNumber ? `Bezug zur Rechnung: ${invoice.referenceInvoiceNumber}` : '',
    invoice.creditNoteReason ? `Grund: ${invoice.creditNoteReason}` : '',
    invoice.notes || '',
  ].filter(Boolean).join('\n');

  // Colors configuration
  const primaryColor = template.accentColor || DOCUMENT_PRIMARY_COLOR;
  const secondaryColor = DOCUMENT_SECONDARY_COLOR;
  const colors = getColorConfiguration(primaryColor, secondaryColor);
  const { primaryRgb, secondaryRgb, darkText, grayText } = colors;
  
  const margins: PageMargins = { top: 15, bottom: 25, left: 20, right: 20 };
  let yPosition = margins.top;

  // Create PDF context for shared components
  const context: PDFContext = {
    pdf,
    pageWidth,
    pageHeight,
    margins,
    colors,
    company: options.company,
    customer: options.customer,
    locale,
    template,
  };

  // Helper to check page break and handle new pages
  const handlePageBreak = async (requiredSpace: number, minimumSpace: number = 30): Promise<boolean> => {
    const result = await checkPageBreak(context, yPosition, requiredSpace, minimumSpace, async () => {
      return await addInvoiceHeader();
    });
    
    if (result.needsBreak) {
      yPosition = result.newY;
      resetFont(pdf, darkText);
      return true;
    }
    return false;
  };

  // Add invoice-specific header
  const addInvoiceHeader = async (): Promise<number> => {
    // Check payment terms for "sofort" display
    const issueDate = new Date(invoice.issueDate);
    const dueDate = new Date(invoice.dueDate);
    const daysDifference = Math.ceil((dueDate.getTime() - issueDate.getTime()) / (1000 * 3600 * 24));
    const dueDateDisplay = daysDifference <= 0 ? 'sofort' : formatDate(invoice.dueDate, locale, options.company.dateFormat);

    const metadataBox = {
      title: documentTitle,
      fields: [
        { label: documentNumberLabel, value: invoice.invoiceNumber },
        { label: 'Datum:', value: formatDate(invoice.issueDate, locale, options.company.dateFormat) },
        { label: 'Fällig am:', value: dueDateDisplay }
      ]
    };

    return await addPDFHeader(context, metadataBox);
  };

  // Add first page header
  yPosition = await addInvoiceHeader();
  resetFont(pdf, darkText);

  if (template.introText?.trim()) {
    const introLines = pdf.splitTextToSize(template.introText.trim(), pageWidth - 40);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(grayText);
    pdf.text(introLines, margins.left, yPosition);
    yPosition += introLines.length * 4.5 + 7;
    resetFont(pdf, darkText);
  }

  // === ITEMS TABLE ===
  const showDiscounts = options.company.discountsEnabled !== false && checkHasDiscounts(invoice.items);
  
  // Draw table header
  const tableColumns = showDiscounts ? [
    { label: 'Pos.', x: 25 },
    { label: 'Beschreibung', x: 40 },
    { label: 'Menge', x: 95 },
    { label: 'Einzelpreis', x: 115 },
    { label: 'Rabatt', x: 135 },
    { label: 'MwSt.', x: 155 },
    { label: 'Gesamt', x: 170 }
  ] : [
    { label: 'Pos.', x: 25 },
    { label: 'Beschreibung', x: 40 },
    { label: 'Menge', x: 95 },
    { label: 'Einzelpreis', x: 120 },
    { label: 'MwSt.', x: 150 },
    { label: 'Gesamt', x: 170 }
  ];

  yPosition = drawTableHeader(pdf, yPosition, pageWidth, colors, tableColumns, darkText, template.tableStyle, primaryRgb);

  // Table rows
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  
  const sortedItems = [...invoice.items].sort((a, b) => (a.order || 0) - (b.order || 0));
  
  for (let index = 0; index < sortedItems.length; index++) {
    const item = sortedItems[index];
    let description = item.description;
    
    // Add job number if available
    if (item.jobNumber) {
      description = `${description} (${terminology.work.singular}: ${item.jobNumber})`;
    }
    
    const splitDesc = pdf.splitTextToSize(description, 52);
    const totalRowHeight = splitDesc.length * 4.5 + 5.5;
    
    // Check for page break
    if (await handlePageBreak(totalRowHeight + 5)) {
      // Re-add table header on new page
      yPosition = drawTableHeader(pdf, yPosition, pageWidth, colors, tableColumns, darkText, template.tableStyle, primaryRgb);
      pdf.setFont('helvetica', 'normal');
    }
    
    // Alternating row colors
    if (index % 2 === 1) {
      pdf.setFillColor(248, 250, 252);
      pdf.rect(20, yPosition - 3, pageWidth - 40, totalRowHeight, 'F');
    }
    
    yPosition += 1.5;
    pdf.setTextColor(darkText);
    pdf.text((index + 1).toString(), 25, yPosition);
    pdf.text(splitDesc[0], 40, yPosition);
    pdf.text(item.quantity.toString(), 95, yPosition);
    
    const discountAmount = item.discountAmount || 0;
    if (showDiscounts) {
      pdf.text(formatCurrency(item.unitPrice, locale, options.company.numberFormat, options.company.currency), 115, yPosition);
      if (discountAmount > 0) {
        if (item.discountType === 'percentage') {
          pdf.text(`${item.discountValue}%`, 135, yPosition);
        } else {
          pdf.text(formatCurrency(item.discountValue || 0, locale, options.company.numberFormat, options.company.currency), 135, yPosition);
        }
      } else {
        pdf.text('-', 135, yPosition);
      }
      pdf.text(`${item.taxRate}%`, 155, yPosition);
    } else {
      pdf.text(formatCurrency(item.unitPrice, locale, options.company.numberFormat, options.company.currency), 120, yPosition);
      pdf.text(`${item.taxRate}%`, 150, yPosition);
    }
    
    const itemTotal = (item.quantity * item.unitPrice) - discountAmount;
    pdf.text(formatCurrency(itemTotal, locale, options.company.numberFormat, options.company.currency), 170, yPosition);
    
    yPosition += 4.5;
    
    // Additional description lines
    for (let i = 1; i < splitDesc.length; i++) {
      pdf.text(splitDesc[i], 40, yPosition);
      yPosition += 4.5;
    }
    
    yPosition += 4.0;
  }
  
  // Table bottom border
  pdf.setDrawColor(203, 213, 225);
  pdf.line(20, yPosition - 3, pageWidth - 20, yPosition - 3);
  yPosition += 10;

  // === TOTALS SECTION ===
  const taxBreakdownData = calculateTaxBreakdown(invoice.items, invoice);
  const numberOfTaxRates = Object.keys(taxBreakdownData).filter(rate => Number(rate) > 0).length;
  const showTotalTaxLine = numberOfTaxRates > 1;
  
  const itemDiscountAmount = invoice.items?.reduce((sum, item) => sum + (item.discountAmount || 0), 0) || 0;
  const globalDiscountAmount = invoice.globalDiscountAmount || 0;
  const hasDiscountData = itemDiscountAmount > 0 || globalDiscountAmount > 0;
  
  let discountLines = 0;
  if (itemDiscountAmount > 0) discountLines++;
  if (globalDiscountAmount > 0) discountLines++;
  if (hasDiscountData) discountLines++;
  
  const totalsBoxHeight = 18 + (discountLines * 7) + (numberOfTaxRates * 7) + (showTotalTaxLine ? 7 : 0);
  const reverseChargeHeight = hasOnlyZeroTaxRate(invoice.items) ? 20 : 0;
  const totalTotalsSpace = totalsBoxHeight + reverseChargeHeight + 5;
  
  // Check if page break needed for totals
  const availableSpaceForTotals = pageHeight - yPosition - margins.bottom;
  if (totalTotalsSpace > availableSpaceForTotals && availableSpaceForTotals < 80) {
    pdf.addPage();
    yPosition = await addInvoiceHeader();
    resetFont(pdf, darkText);
  }
  
  const totalsStartX = pageWidth - 40;
  const totalsLabelX = totalsStartX - 35;
  const totalsBoxWidth = 60;
  const totalsNotesStartY = yPosition;
  
  // Background for totals
  pdf.setFillColor(248, 250, 252);
  pdf.rect(totalsLabelX - 5, yPosition - 5, totalsBoxWidth, totalsBoxHeight, 'F');
  
  pdf.setFontSize(9);
  
  // Subtotal
  pdf.setTextColor(secondaryRgb.r, secondaryRgb.g, secondaryRgb.b);
  pdf.text('Zwischensumme:', totalsLabelX, yPosition);
  pdf.setTextColor(darkText);
  pdf.text(formatCurrency(invoice.subtotal, locale, options.company.numberFormat, options.company.currency), totalsStartX, yPosition);
  yPosition += 7;
  
  // Item discounts
  if (itemDiscountAmount > 0) {
    pdf.setTextColor(220, 38, 38);
    pdf.text('Artikelrabatte:', totalsLabelX, yPosition);
    pdf.text(`-${formatCurrency(itemDiscountAmount, locale, options.company.numberFormat, options.company.currency)}`, totalsStartX, yPosition);
    yPosition += 7;
  }
  
  // Global discount
  if (globalDiscountAmount > 0) {
    pdf.setTextColor(220, 38, 38);
    pdf.text('Gesamtrabatt:', totalsLabelX, yPosition);
    pdf.text(`-${formatCurrency(globalDiscountAmount, locale, options.company.numberFormat, options.company.currency)}`, totalsStartX, yPosition);
    yPosition += 7;
  }
  
  // Net amount after discounts
  if (hasDiscountData) {
    pdf.setTextColor(secondaryRgb.r, secondaryRgb.g, secondaryRgb.b);
    pdf.text('Nettobetrag:', totalsLabelX, yPosition);
    pdf.setTextColor(darkText);
    const discountedSubtotal = invoice.subtotal - itemDiscountAmount - globalDiscountAmount;
    pdf.text(formatCurrency(discountedSubtotal, locale, options.company.numberFormat, options.company.currency), totalsStartX, yPosition);
    yPosition += 7;
  }
  
  // Tax breakdown
  const taxRates = Object.keys(taxBreakdownData)
    .filter(rate => Number(rate) > 0)
    .sort((a, b) => Number(a) - Number(b));
  
  for (const rate of taxRates) {
    const breakdown = taxBreakdownData[Number(rate)];
    pdf.setTextColor(secondaryRgb.r, secondaryRgb.g, secondaryRgb.b);
    pdf.text(`MwSt. (${rate}%):`, totalsLabelX, yPosition);
    pdf.setTextColor(darkText);
    pdf.text(formatCurrency(breakdown.taxAmount, locale, options.company.numberFormat, options.company.currency), totalsStartX, yPosition);
    yPosition += 7;
  }
  
  // Total tax if multiple rates
  if (showTotalTaxLine) {
    pdf.setTextColor(secondaryRgb.r, secondaryRgb.g, secondaryRgb.b);
    pdf.text('MwSt. gesamt:', totalsLabelX, yPosition);
    pdf.setTextColor(darkText);
    pdf.text(formatCurrency(invoice.taxAmount, locale, options.company.numberFormat, options.company.currency), totalsStartX, yPosition);
    yPosition += 7;
  }
  
  // Grand total
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
  pdf.text('Gesamtbetrag:', totalsLabelX, yPosition);
  pdf.text(formatCurrency(invoice.total, locale, options.company.numberFormat, options.company.currency), totalsStartX, yPosition);
  
  resetFont(pdf, darkText);
  yPosition = totalsNotesStartY + totalsBoxHeight;

  // === REVERSE CHARGE / SMALL BUSINESS CLAUSE ===
  if (hasOnlyZeroTaxRate(invoice.items)) {
    if (await handlePageBreak(12, 20)) {
      // Clause moved to new page
    }
    
    yPosition += 4;
    
    const clauseText = options.company.isSmallBusiness 
      ? 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet (Kleinunternehmerregelung)'
      : 'Gemäß § 13b UStG geht die Steuerschuld auf den Leistungsempfänger über';
    const textWidth = pdf.getTextWidth(clauseText);
    const centerX = (pageWidth - textWidth) / 2;
    
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(darkText);
    pdf.text(clauseText, centerX, yPosition);
    
    resetFont(pdf, darkText);
    yPosition += 4;
  }

  // === NOTES AND PAYMENT INFO ===
  let notesHeight = 0;
  let paymentInfoHeight = 0;
  
  if (documentNotes) {
    const notesWidth = totalsLabelX - 35;
    const splitNotes = pdf.splitTextToSize(documentNotes, notesWidth);
    notesHeight = 15 + (splitNotes.length * 4.5);
  }
  
  // Check for payment information
  const paymentInfo = getEffectivePaymentInformation(options.company);
  const bankAccount = paymentInfo.bankAccount;
  const bic = paymentInfo.bic;
  const accountHolder = paymentInfo.accountHolder || options.company.name;
  const bankName = paymentInfo?.bankName;
  const paymentTerms = template.paymentTerms || paymentInfo.paymentTerms;
  
  if (template.showPaymentInformation && bankAccount) {
    paymentInfoHeight = 35;
    if (bankName) paymentInfoHeight += 5;
    if (paymentTerms) {
      const splitTerms = pdf.splitTextToSize(paymentTerms, pageWidth - 40);
      paymentInfoHeight += splitTerms.length * 4;
    }
  }
  
  const combinedHeight = Math.max(notesHeight, paymentInfoHeight) + 10;
  await handlePageBreak(combinedHeight);
  
  const notesStartY = yPosition;
  let notesY = totalsNotesStartY + 5;
  
  // Notes (left side)
  if (documentNotes) {
    pdf.setFontSize(10);
    pdf.setTextColor(darkText);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Anmerkungen:', 20, notesY);
    notesY += 6;
    
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(grayText);
    const splitNotes = pdf.splitTextToSize(documentNotes, totalsLabelX - 35);
    pdf.text(splitNotes, 20, notesY);
    
    resetFont(pdf, darkText);
  }
  
  // Payment information (left side, below notes or totals)
  if (template.showPaymentInformation && bankAccount) {
    yPosition = Math.max(notesStartY + 10, yPosition);
    
    // Check for immediate payment
    const issueDate = new Date(invoice.issueDate);
    const dueDate = new Date(invoice.dueDate);
    const daysDifference = Math.ceil((dueDate.getTime() - issueDate.getTime()) / (1000 * 3600 * 24));
    const isImmediatePayment = daysDifference <= 0;
    
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(darkText);
    pdf.text('Zahlungsinformationen:', 20, yPosition);
    yPosition += 6;
    
    // Add immediate payment clause if applicable
    if (isImmediatePayment && options.company.immediatePaymentClause) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
      pdf.text(options.company.immediatePaymentClause, 20, yPosition);
      yPosition += 7;
    }
    
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(grayText);
    pdf.text('Bitte überweisen Sie den Betrag auf folgendes Konto:', 20, yPosition);
    yPosition += 4;
    
    // Payment details in black (darkText)
    pdf.setTextColor(darkText);
    
    pdf.text(`Kontoinhaber: ${accountHolder}`, 20, yPosition);
    yPosition += 4;
    pdf.text(`IBAN: ${bankAccount}`, 20, yPosition);
    yPosition += 4;
    if (bic) {
      pdf.text(`BIC: ${bic}`, 20, yPosition);
      yPosition += 4;
    }
    if (bankName) {
      pdf.text(`Bank: ${bankName}`, 20, yPosition);
      yPosition += 4;
    }
    pdf.text(`Verwendungszweck: ${invoice.invoiceNumber}`, 20, yPosition);
    
    if (paymentTerms) {
      yPosition += 6;
      pdf.setFontSize(8);
      pdf.setTextColor(grayText);
      const splitTerms = pdf.splitTextToSize(paymentTerms, pageWidth - 40);
      pdf.text(splitTerms, 20, yPosition);
    }
    
    resetFont(pdf, darkText);
  }

  if (template.closingText?.trim()) {
    await handlePageBreak(14, 20);
    yPosition += 8;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(grayText);
    pdf.text(pdf.splitTextToSize(template.closingText.trim(), pageWidth - 40), margins.left, yPosition);
    resetFont(pdf, darkText);
  }

  // === ADD FOOTERS TO ALL PAGES ===
  const pageCount = pdf.getNumberOfPages();
  if (template.showFooter) {
    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      pdf.setPage(pageNum);
      addPDFFooter(context, pageNum, pageCount);
    }
  }

  // === EMBED ZUGFERD XML ===
  return await embedZUGFeRDXMLIntoPDF(pdf.output('arraybuffer'), invoice, options);
}

/**
 * Generate Job PDF
 */
export async function generateJobPDF(job: JobEntry, options: JobPDFOptions): Promise<Blob> {
  const pdf = new jsPDF();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const locale = options.company.locale || 'de-DE';
  const terminology = getTerminology(options.company.terminologyProfile);
  const template = resolveDocumentTemplate(options.company, 'orderConfirmation');
  
  const primaryColor = template.accentColor || DOCUMENT_PRIMARY_COLOR;
  const secondaryColor = DOCUMENT_SECONDARY_COLOR;
  const colors = getColorConfiguration(primaryColor, secondaryColor);
  const { primaryRgb, secondaryRgb, darkText, grayText } = colors;
  
  const margins: PageMargins = { top: 15, bottom: 25, left: 20, right: 20 };
  let yPosition = margins.top;

  const context: PDFContext = {
    pdf,
    pageWidth,
    pageHeight,
    margins,
    colors,
    company: options.company,
    customer: options.customer,
    locale,
    template,
  };

  const handlePageBreak = async (requiredSpace: number, minimumSpace: number = 30): Promise<boolean> => {
    const result = await checkPageBreak(context, yPosition, requiredSpace, minimumSpace, async () => {
      return await addJobHeader();
    });
    
    if (result.needsBreak) {
      yPosition = result.newY;
      resetFont(pdf, darkText);
      return true;
    }
    return false;
  };

  const addJobHeader = async (): Promise<number> => {
    const metadataBox = {
      title: terminology.work.confirmationLabel.toUpperCase(),
      fields: [
        { label: terminology.work.numberShortLabel, value: job.jobNumber },
        { label: 'Datum:', value: formatDate(job.date, locale, options.company.dateFormat) },
        { label: 'Status:', value: job.status === 'completed' ? 'Abgeschlossen' : 
                                      job.status === 'in-progress' ? 'In Bearbeitung' : 'Offen' }
      ]
    };

    return await addPDFHeader(context, metadataBox, job.customerAddress);
  };

  yPosition = await addJobHeader();
  resetFont(pdf, darkText);

  // === JOB DESCRIPTION ===
  if (job.description) {
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(darkText);
    pdf.text(`${terminology.work.descriptionLabel}:`, 20, yPosition);
    yPosition += 6;
    
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(grayText);
    const splitDesc = pdf.splitTextToSize(job.description, pageWidth - 40);
    
    const descHeight = splitDesc.length * 4.5;
    if (await handlePageBreak(descHeight)) {
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(darkText);
      pdf.text(`${terminology.work.descriptionLabel}:`, 20, yPosition);
      yPosition += 6;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(grayText);
    }
    
    pdf.text(splitDesc, 20, yPosition);
    yPosition += splitDesc.length * 4.5 + 10;
    resetFont(pdf, darkText);
  }

  // === POSITIONS TABLE ===
  await handlePageBreak(60);
  
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(darkText);
  pdf.text('Positionen:', 20, yPosition);
  yPosition += 8;

  const tableColumns = [
    { label: 'Pos.', x: 25 },
    { label: 'Beschreibung', x: 40 },
    { label: 'Menge/Std.', x: 95 },
    { label: 'Einzelpreis', x: 125 },
    { label: 'MwSt.', x: 155 },
    { label: 'Gesamt', x: 170 }
  ];

  yPosition = drawTableHeader(pdf, yPosition, pageWidth, colors, tableColumns, darkText, template.tableStyle, primaryRgb);

  let positionIndex = 1;

  // Time entries
  const timeEntries = job.timeEntries && job.timeEntries.length > 0 
    ? job.timeEntries 
    : [{ description: 'Arbeitsleistung', hoursWorked: job.hoursWorked, hourlyRate: job.hourlyRate, taxRate: 19 }];

  for (const entry of timeEntries) {
    const desc = entry.description || 'Arbeitsleistung';
    const splitDesc = pdf.splitTextToSize(desc, 52);
    const rowHeight = splitDesc.length * 4.5 + 5.5;
    
    if (await handlePageBreak(rowHeight + 5)) {
      yPosition = drawTableHeader(pdf, yPosition, pageWidth, colors, tableColumns, darkText, template.tableStyle, primaryRgb);
    }
    
    if (positionIndex % 2 === 0) {
      pdf.setFillColor(248, 250, 252);
      pdf.rect(20, yPosition - 3, pageWidth - 40, rowHeight, 'F');
    }
    
    yPosition += 1.5;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(darkText);
    
    pdf.text(positionIndex.toString(), 25, yPosition);
    pdf.text(splitDesc[0], 40, yPosition);
    pdf.text(`${entry.hoursWorked} Std.`, 95, yPosition);
    pdf.text(formatCurrency(entry.hourlyRate, locale, options.company.numberFormat, options.company.currency), 125, yPosition);
    
    const taxRate = options.company.isSmallBusiness ? 0 : (entry.taxRate != null ? entry.taxRate : 19);
    pdf.text(`${taxRate}%`, 155, yPosition);
    
    const entryTotal = entry.hoursWorked * entry.hourlyRate;
    pdf.text(formatCurrency(entryTotal, locale, options.company.numberFormat, options.company.currency), 170, yPosition);
    
    yPosition += 4.5;
    
    for (let i = 1; i < splitDesc.length; i++) {
      pdf.text(splitDesc[i], 40, yPosition);
      yPosition += 4.5;
    }
    
    yPosition += 4.0;
    
    positionIndex++;
  }

  // Materials
  if (job.materials && job.materials.length > 0) {
    for (const material of job.materials) {
      const splitDesc = pdf.splitTextToSize(material.description, 52);
      const rowHeight = splitDesc.length * 4.5 + 5.5;
      
      if (await handlePageBreak(rowHeight + 5)) {
        yPosition = drawTableHeader(pdf, yPosition, pageWidth, colors, tableColumns, darkText, template.tableStyle, primaryRgb);
      }
      
      if (positionIndex % 2 === 0) {
        pdf.setFillColor(248, 250, 252);
        pdf.rect(20, yPosition - 3, pageWidth - 40, rowHeight, 'F');
      }
      
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(darkText);
      
      pdf.text(positionIndex.toString(), 25, yPosition);
      pdf.text(splitDesc[0], 40, yPosition);
      pdf.text(material.quantity.toString(), 95, yPosition);
      pdf.text(formatCurrency(material.unitPrice, locale, options.company.numberFormat, options.company.currency), 125, yPosition);
      
      const taxRate = options.company.isSmallBusiness ? 0 : (material.taxRate != null ? material.taxRate : 19);
      pdf.text(`${taxRate}%`, 155, yPosition);
      
      const materialTotal = material.quantity * material.unitPrice;
      pdf.text(formatCurrency(materialTotal, locale, options.company.numberFormat, options.company.currency), 170, yPosition);
      
      yPosition += 4.5;
      
      for (let i = 1; i < splitDesc.length; i++) {
        pdf.text(splitDesc[i], 40, yPosition);
        yPosition += 4.5;
      }
      
      yPosition += 4.0;
      
      positionIndex++;
    }
  }

  // Table bottom border
  pdf.setDrawColor(203, 213, 225);
  pdf.line(20, yPosition - 3, pageWidth - 20, yPosition - 3);
  yPosition += 6;

  // === TOTALS ===
  const taxBreakdown = calculateJobTaxBreakdown(job, options.company.isSmallBusiness);
  const subtotal = Object.values(taxBreakdown).reduce((sum, breakdown) => sum + breakdown.taxableAmount, 0);
  const totalTaxAmount = Object.values(taxBreakdown).reduce((sum, breakdown) => sum + breakdown.taxAmount, 0);
  const total = subtotal + totalTaxAmount;
  
  await handlePageBreak(60);
  
  yPosition += 6;
  const totalsBoxWidth = 80;
  const totalsStartX = pageWidth - margins.right;
  const totalsLabelX = totalsStartX - totalsBoxWidth + 5;
  const totalsValueX = totalsStartX - 5;
  
  const taxRates = Object.keys(taxBreakdown).filter(rate => Number(rate) > 0).sort((a, b) => Number(a) - Number(b));
  const showTotalTaxLine = taxRates.length > 1;
  
  let totalsLines = 2 + taxRates.length;
  if (showTotalTaxLine) totalsLines += 1;
  
  const totalsBoxHeight = Math.max(30, 6 + (totalsLines * 6) + 6);
  
  pdf.setFillColor(248, 250, 252);
  pdf.rect(totalsLabelX - 5, yPosition - 3, totalsBoxWidth, totalsBoxHeight, 'F');
  
  pdf.setFontSize(9);
  yPosition += 4;
  
  pdf.setTextColor(secondaryRgb.r, secondaryRgb.g, secondaryRgb.b);
  pdf.text('Nettobetrag:', totalsLabelX, yPosition);
  pdf.setTextColor(darkText);
  pdf.text(formatCurrency(subtotal, locale, options.company.numberFormat, options.company.currency), totalsValueX, yPosition, { align: 'right' });
  yPosition += 6;
  
  for (const rate of taxRates) {
    const breakdown = taxBreakdown[Number(rate)];
    pdf.setTextColor(secondaryRgb.r, secondaryRgb.g, secondaryRgb.b);
    pdf.text(`MwSt. (${rate}%):`, totalsLabelX, yPosition);
    pdf.setTextColor(darkText);
    pdf.text(formatCurrency(breakdown.taxAmount, locale, options.company.numberFormat, options.company.currency), totalsValueX, yPosition, { align: 'right' });
    yPosition += 6;
  }
  
  if (showTotalTaxLine) {
    pdf.setTextColor(secondaryRgb.r, secondaryRgb.g, secondaryRgb.b);
    pdf.text('MwSt. gesamt:', totalsLabelX, yPosition);
    pdf.setTextColor(darkText);
    pdf.text(formatCurrency(totalTaxAmount, locale, options.company.numberFormat, options.company.currency), totalsValueX, yPosition, { align: 'right' });
    yPosition += 6;
  }
  
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
  pdf.text('Gesamtbetrag:', totalsLabelX, yPosition);
  pdf.text(formatCurrency(total, locale, options.company.numberFormat, options.company.currency), totalsValueX, yPosition, { align: 'right' });
  
  resetFont(pdf, darkText);

  // Small business clause
  if (options.company.isSmallBusiness || totalTaxAmount === 0) {
    if (await handlePageBreak(12, 20)) {
      // Clause moved to new page
    }
    
    yPosition += 4;
    
    const clauseText = options.company.isSmallBusiness 
      ? 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet (Kleinunternehmerregelung)'
      : 'Gemäß § 13b UStG geht die Steuerschuld auf den Leistungsempfänger über';
    const textWidth = pdf.getTextWidth(clauseText);
    const centerX = (pageWidth - textWidth) / 2;
    
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(darkText);
    pdf.text(clauseText, centerX, yPosition);
    
    resetFont(pdf, darkText);
    yPosition += 4;
  }

  // Notes
  if (job.notes) {
    yPosition += 12;
    await handlePageBreak(30);
    
    pdf.setFontSize(10);
    pdf.setTextColor(darkText);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Anmerkungen:', margins.left, yPosition);
    yPosition += 6;
    
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(grayText);
    const splitNotes = pdf.splitTextToSize(job.notes, pageWidth - margins.left - margins.right);
    
    const notesHeight = splitNotes.length * 4.5;
    if (await handlePageBreak(notesHeight)) {
      pdf.setFontSize(10);
      pdf.setTextColor(darkText);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Anmerkungen:', margins.left, yPosition);
      yPosition += 6;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(grayText);
    }
    
    pdf.text(splitNotes, margins.left, yPosition);
    yPosition += splitNotes.length * 4.5 + 6;
  }

  // Customer signature
  if (job.signature) {
    const signatureSpace = 45;
    await handlePageBreak(signatureSpace);
    
    yPosition += 10;
    
    pdf.setFontSize(10);
    pdf.setTextColor(darkText);
    pdf.setFont('helvetica', 'bold');
    pdf.text(`${terminology.entity.signatureLabel}:`, margins.left, yPosition);
    yPosition += 6;
    
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(grayText);
    pdf.text(`${terminology.entity.singular}: ${job.signature.customerName}`, margins.left, yPosition);
    yPosition += 4;
    
    const signatureDate = `${formatDate(job.signature.signedAt, locale, options.company.dateFormat)} ${formatTime(job.signature.signedAt, locale, options.company.timeFormat)}`;
    pdf.text(`Unterschrieben am: ${signatureDate}`, margins.left, yPosition);
    yPosition += 6;
    
    try {
      const signatureImg = job.signature.signatureData;
      if (signatureImg && signatureImg.startsWith('data:image/')) {
        const maxSignatureWidth = 80;
        const maxSignatureHeight = 25;
        
        await handlePageBreak(maxSignatureHeight + 5);
        
        pdf.addImage(
          signatureImg,
          'PNG',
          margins.left,
          yPosition,
          maxSignatureWidth,
          maxSignatureHeight
        );
        
        pdf.setDrawColor(203, 213, 225);
        pdf.setLineWidth(0.5);
        pdf.rect(margins.left, yPosition, maxSignatureWidth, maxSignatureHeight);
        
        yPosition += maxSignatureHeight + 4;
      }
    } catch (error: unknown) {
      logger.warn('Could not add signature image to PDF:', { error });
      pdf.text('[Unterschrift vorhanden, konnte nicht geladen werden]', margins.left, yPosition);
      yPosition += 6;
    }
  }

  // Add footers to all pages
  const totalPages = pdf.getNumberOfPages();
  if (template.showFooter) {
    for (let i = 1; i <= totalPages; i++) {
      pdf.setPage(i);
      addPDFFooter(context, i, undefined); // Job PDFs show single page number
    }
  }
  
  return pdf.output('blob');
}

/**
 * Generate Quote PDF
 */
export async function generateQuotePDF(quote: Quote, options: QuotePDFOptions): Promise<Blob> {
  const pdf = new jsPDF();
  
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const locale = options.company.locale || 'de-DE';
  const template = resolveDocumentTemplate(options.company, 'quote');
  
  const primaryColor = template.accentColor || DOCUMENT_PRIMARY_COLOR;
  const secondaryColor = DOCUMENT_SECONDARY_COLOR;
  const colors = getColorConfiguration(primaryColor, secondaryColor);
  const { primaryRgb, secondaryRgb, darkText, grayText } = colors;
  
  const margins: PageMargins = { top: 15, bottom: 25, left: 20, right: 20 };
  let yPosition = margins.top;

  const context: PDFContext = {
    pdf,
    pageWidth,
    pageHeight,
    margins,
    colors,
    company: options.company,
    customer: options.customer,
    locale,
    template,
  };

  // Add quote-specific header
  const addQuoteHeader = async (): Promise<number> => {
    const metadataBox = {
      title: 'ANGEBOT',
      fields: [
        { label: 'Angebots-Nr.:', value: quote.quoteNumber },
        { label: 'Datum:', value: formatDate(quote.issueDate, locale, options.company.dateFormat) },
        { label: 'Gültig bis:', value: formatDate(quote.validUntil, locale, options.company.dateFormat) }
      ]
    };

    return await addPDFHeader(context, metadataBox);
  };

  // Helper to check page break and handle new pages
  const handlePageBreak = async (requiredSpace: number, minimumSpace: number = 30): Promise<boolean> => {
    const result = await checkPageBreak(context, yPosition, requiredSpace, minimumSpace, async () => {
      return await addQuoteHeader();
    });
    
    if (result.needsBreak) {
      yPosition = result.newY;
      resetFont(pdf, darkText);
      return true;
    }
    return false;
  };

  yPosition = await addQuoteHeader();
  resetFont(pdf, darkText);

  if (template.introText?.trim()) {
    const introLines = pdf.splitTextToSize(template.introText.trim(), pageWidth - 40);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(grayText);
    pdf.text(introLines, margins.left, yPosition);
    yPosition += introLines.length * 4.5 + 7;
    resetFont(pdf, darkText);
  }

  // === ITEMS TABLE ===
  const showDiscounts = options.company.discountsEnabled !== false && checkHasDiscounts(quote.items);
  
  const tableColumns = showDiscounts ? [
    { label: 'Pos.', x: 25 },
    { label: 'Beschreibung', x: 40 },
    { label: 'Menge', x: 95 },
    { label: 'Einzelpreis', x: 115 },
    { label: 'Rabatt', x: 135 },
    { label: 'MwSt.', x: 155 },
    { label: 'Gesamt', x: 170 }
  ] : [
    { label: 'Pos.', x: 25 },
    { label: 'Beschreibung', x: 40 },
    { label: 'Menge', x: 95 },
    { label: 'Einzelpreis', x: 120 },
    { label: 'MwSt.', x: 150 },
    { label: 'Gesamt', x: 170 }
  ];

  yPosition = drawTableHeader(pdf, yPosition, pageWidth, colors, tableColumns, darkText, template.tableStyle, primaryRgb);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  
  const sortedItems = [...quote.items].sort((a, b) => (a.order || 0) - (b.order || 0));
  
  for (let index = 0; index < sortedItems.length; index++) {
    const item = sortedItems[index];
    const description = item.description;
    
    const splitDesc = pdf.splitTextToSize(description, 52);
    const totalRowHeight = splitDesc.length * 4.5 + 5.5;
    
    if (await handlePageBreak(totalRowHeight + 5)) {
      yPosition = drawTableHeader(pdf, yPosition, pageWidth, colors, tableColumns, darkText, template.tableStyle, primaryRgb);
      pdf.setFont('helvetica', 'normal');
    }
    
    if (index % 2 === 1) {
      pdf.setFillColor(248, 250, 252);
      pdf.rect(20, yPosition - 3, pageWidth - 40, totalRowHeight, 'F');
    }
    
    yPosition += 1.5;
    pdf.setTextColor(darkText);
    pdf.text((index + 1).toString(), 25, yPosition);
    pdf.text(splitDesc[0], 40, yPosition);
    pdf.text(item.quantity.toString(), 95, yPosition);
    
    const discountAmount = item.discountAmount || 0;
    if (showDiscounts) {
      pdf.text(formatCurrency(item.unitPrice, locale, options.company.numberFormat, options.company.currency), 115, yPosition);
      if (discountAmount > 0) {
        if (item.discountType === 'percentage') {
          pdf.text(`${item.discountValue}%`, 135, yPosition);
        } else {
          pdf.text(formatCurrency(item.discountValue || 0, locale, options.company.numberFormat, options.company.currency), 135, yPosition);
        }
      } else {
        pdf.text('-', 135, yPosition);
      }
      pdf.text(`${item.taxRate}%`, 155, yPosition);
    } else {
      pdf.text(formatCurrency(item.unitPrice, locale, options.company.numberFormat, options.company.currency), 120, yPosition);
      pdf.text(`${item.taxRate}%`, 150, yPosition);
    }
    
    const itemTotal = (item.quantity * item.unitPrice) - discountAmount;
    pdf.text(formatCurrency(itemTotal, locale, options.company.numberFormat, options.company.currency), 170, yPosition);
    
    yPosition += 4.5;
    
    for (let i = 1; i < splitDesc.length; i++) {
      pdf.text(splitDesc[i], 40, yPosition);
      yPosition += 4.5;
    }
    
    yPosition += 4.0;
  }
  
  pdf.setDrawColor(203, 213, 225);
  pdf.line(20, yPosition - 3, pageWidth - 20, yPosition - 3);
  yPosition += 10;

  // === TOTALS ===
  const taxBreakdownData = calculateTaxBreakdown(quote.items);
  const numberOfTaxRates = Object.keys(taxBreakdownData).filter(rate => Number(rate) > 0).length;
  const showTotalTaxLine = numberOfTaxRates > 1;
  
  const itemDiscountAmount = quote.items?.reduce((sum, item) => sum + (item.discountAmount || 0), 0) || 0;
  const globalDiscountAmount = quote.globalDiscountAmount || 0;
  const hasDiscountData = itemDiscountAmount > 0 || globalDiscountAmount > 0;
  
  let discountLines = 0;
  if (itemDiscountAmount > 0) discountLines++;
  if (globalDiscountAmount > 0) discountLines++;
  if (hasDiscountData) discountLines++;
  
  const totalsBoxHeight = 18 + (discountLines * 7) + (numberOfTaxRates * 7) + (showTotalTaxLine ? 7 : 0);
  const smallBusinessHeight = (options.company.isSmallBusiness && hasOnlyZeroTaxRate(quote.items)) ? 20 : 0;
  const totalTotalsSpace = totalsBoxHeight + smallBusinessHeight + 5;
  
  const availableSpaceForTotals = pageHeight - yPosition - margins.bottom;
  if (totalTotalsSpace > availableSpaceForTotals && availableSpaceForTotals < 80) {
    pdf.addPage();
    yPosition = await addQuoteHeader();
    resetFont(pdf, darkText);
  }
  
  const totalsStartX = pageWidth - 40;
  const totalsLabelX = totalsStartX - 35;
  const totalsBoxWidth = 60;
  const totalsNotesStartY = yPosition;
  
  pdf.setFillColor(248, 250, 252);
  pdf.rect(totalsLabelX - 5, yPosition - 5, totalsBoxWidth, totalsBoxHeight, 'F');
  
  pdf.setFontSize(9);
  
  pdf.setTextColor(secondaryRgb.r, secondaryRgb.g, secondaryRgb.b);
  pdf.text('Zwischensumme:', totalsLabelX, yPosition);
  pdf.setTextColor(darkText);
  pdf.text(formatCurrency(quote.subtotal, locale, options.company.numberFormat, options.company.currency), totalsStartX, yPosition);
  yPosition += 7;
  
  if (itemDiscountAmount > 0) {
    pdf.setTextColor(220, 38, 38);
    pdf.text('Artikelrabatte:', totalsLabelX, yPosition);
    pdf.text(`-${formatCurrency(itemDiscountAmount, locale, options.company.numberFormat, options.company.currency)}`, totalsStartX, yPosition);
    yPosition += 7;
  }
  
  if (globalDiscountAmount > 0) {
    pdf.setTextColor(220, 38, 38);
    pdf.text('Gesamtrabatt:', totalsLabelX, yPosition);
    pdf.text(`-${formatCurrency(globalDiscountAmount, locale, options.company.numberFormat, options.company.currency)}`, totalsStartX, yPosition);
    yPosition += 7;
  }
  
  if (hasDiscountData) {
    pdf.setTextColor(secondaryRgb.r, secondaryRgb.g, secondaryRgb.b);
    pdf.text('Nettobetrag:', totalsLabelX, yPosition);
    pdf.setTextColor(darkText);
    const discountedSubtotal = quote.subtotal - itemDiscountAmount - globalDiscountAmount;
    pdf.text(formatCurrency(discountedSubtotal, locale, options.company.numberFormat, options.company.currency), totalsStartX, yPosition);
    yPosition += 7;
  }
  
  const taxRates = Object.keys(taxBreakdownData)
    .filter(rate => Number(rate) > 0)
    .sort((a, b) => Number(a) - Number(b));
  
  for (const rate of taxRates) {
    const breakdown = taxBreakdownData[Number(rate)];
    pdf.setTextColor(secondaryRgb.r, secondaryRgb.g, secondaryRgb.b);
    pdf.text(`MwSt. (${rate}%):`, totalsLabelX, yPosition);
    pdf.setTextColor(darkText);
    pdf.text(formatCurrency(breakdown.taxAmount, locale, options.company.numberFormat, options.company.currency), totalsStartX, yPosition);
    yPosition += 7;
  }
  
  if (showTotalTaxLine) {
    pdf.setTextColor(secondaryRgb.r, secondaryRgb.g, secondaryRgb.b);
    pdf.text('MwSt. gesamt:', totalsLabelX, yPosition);
    pdf.setTextColor(darkText);
    pdf.text(formatCurrency(quote.taxAmount, locale, options.company.numberFormat, options.company.currency), totalsStartX, yPosition);
    yPosition += 7;
  }
  
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
  pdf.text('Gesamtbetrag:', totalsLabelX, yPosition);
  pdf.text(formatCurrency(quote.total, locale, options.company.numberFormat, options.company.currency), totalsStartX, yPosition);
  
  resetFont(pdf, darkText);
  yPosition = totalsNotesStartY + totalsBoxHeight;

  // Small business clause
  if (options.company.isSmallBusiness && hasOnlyZeroTaxRate(quote.items)) {
    if (await handlePageBreak(12, 20)) {
      // Clause moved to new page
    }
    
    yPosition += 4;
    
    const clauseText = 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet (Kleinunternehmerregelung)';
    const textWidth = pdf.getTextWidth(clauseText);
    const centerX = (pageWidth - textWidth) / 2;
    
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(darkText);
    pdf.text(clauseText, centerX, yPosition);
    
    resetFont(pdf, darkText);
    yPosition += 4;
  }

  // Notes
  if (quote.notes) {
    yPosition = Math.max(yPosition, totalsNotesStartY + totalsBoxHeight + 10);
    
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(darkText);
    pdf.text('Anmerkungen:', 20, yPosition);
    yPosition += 6;
    
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(grayText);
    const splitNotes = pdf.splitTextToSize(quote.notes, totalsLabelX - 35);
    pdf.text(splitNotes, 20, yPosition);
    
    resetFont(pdf, darkText);
  }

  if (template.paymentTerms?.trim() || template.closingText?.trim()) {
    await handlePageBreak(24, 20);
    yPosition += 8;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(grayText);
    if (template.paymentTerms?.trim()) {
      pdf.text(pdf.splitTextToSize(template.paymentTerms.trim(), pageWidth - 40), margins.left, yPosition);
      yPosition += 8;
    }
    if (template.closingText?.trim()) {
      pdf.text(pdf.splitTextToSize(template.closingText.trim(), pageWidth - 40), margins.left, yPosition);
    }
    resetFont(pdf, darkText);
  }

  // Add footers to all pages
  const pageCount = pdf.getNumberOfPages();
  if (template.showFooter) {
    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      pdf.setPage(pageNum);
    
    const footerY = pageHeight - margins.bottom;
    
    // Footer separator line
    pdf.setDrawColor(203, 213, 225);
    pdf.setLineWidth(0.5);
    pdf.line(20, footerY - 8, pageWidth - 20, footerY - 8);
    
    pdf.setFontSize(8);
    pdf.setTextColor(grayText);
    
    // Company info in footer
    const footerInfo = `${options.company.name} | ${options.company.address} | ${options.company.postalCode} ${options.company.city}`;
    pdf.text(footerInfo, 20, footerY - 4);
    
    // Build tax information string
    let taxInfo = '';
    if (options.company.taxId) {
      taxInfo += `USt-IdNr: ${options.company.taxId}`;
    }
    if (options.company.taxIdentificationNumber) {
      if (taxInfo) taxInfo += ' | ';
      taxInfo += `Steuer-ID: ${options.company.taxIdentificationNumber}`;
    }
    
    const footerContact = `Tel: ${options.company.phone} | E-Mail: ${options.company.email}${taxInfo ? ' | ' + taxInfo : ''}`;
    pdf.text(footerContact, 20, footerY);
    
    // Page number if multiple pages
      if (pageCount > 1) {
        pdf.text(`Seite ${pageNum} von ${pageCount}`, pageWidth - 40, footerY + 8);
      }
    }
  }
  
  return pdf.output('blob');
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
  const pdf = new jsPDF();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const locale = options.company.locale || 'de-DE';
  const template = resolveDocumentTemplate(options.company, 'reminder');
  
  const primaryColor = template.accentColor || DOCUMENT_PRIMARY_COLOR;
  const secondaryColor = DOCUMENT_SECONDARY_COLOR;
  const colors = getColorConfiguration(primaryColor, secondaryColor);
  const { primaryRgb, darkText, grayText } = colors;
  
  const margins: PageMargins = { top: 15, bottom: 25, left: 20, right: 20 };
  let yPos = 15;

  const context: PDFContext = {
    pdf,
    pageWidth,
    pageHeight,
    margins,
    colors,
    company: options.company,
    customer: options.customer,
    locale,
    template,
  };

  const selectedReminderText = getReminderTemplateText(template, stage, reminderText);

  // Add reminder-specific header
  const addReminderHeader = async (): Promise<number> => {
    const stageText = stage === 1 ? '1. MAHNUNG' : stage === 2 ? '2. MAHNUNG' : '3. MAHNUNG';
    
    const metadataBox = {
      title: stageText,
      fields: [
        { label: 'Rechnung-Nr.:', value: invoice.invoiceNumber },
        { label: 'Mahndatum:', value: formatDate(new Date(), locale, options.company.dateFormat) },
        { label: 'Fällig war:', value: formatDate(invoice.dueDate, locale, options.company.dateFormat) }
      ]
    };

    return await addPDFHeader(context, metadataBox);
  };

  yPos = await addReminderHeader();
  resetFont(pdf, darkText);

  // Invoice reference box
  yPos += 10;
  
  pdf.setFillColor(255, 251, 235);
  pdf.setDrawColor(200, 200, 200);
  pdf.setLineWidth(0.3);
  pdf.rect(20, yPos, pageWidth - 40, 25, 'FD');
  
  yPos += 7;
  
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(60, 60, 60);
  pdf.text('Bezug: Rechnung', 25, yPos);
  
  yPos += 6;
  
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(0, 0, 0);
  pdf.text(`${invoice.invoiceNumber}`, 25, yPos);
  
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(80, 80, 80);
  const invoiceDateText = `vom ${formatDate(invoice.issueDate, locale, options.company.dateFormat)}`;
  const dueDateText = `fällig am ${formatDate(invoice.dueDate, locale, options.company.dateFormat)}`;
  const rightBoxText = `${invoiceDateText}, ${dueDateText}`;
  const rightBoxTextWidth = pdf.getTextWidth(rightBoxText);
  pdf.text(rightBoxText, pageWidth - 25 - rightBoxTextWidth, yPos);
  
  yPos += 20;

  // Reminder text
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(0, 0, 0);
  
  const reminderLines = pdf.splitTextToSize(selectedReminderText, pageWidth - 40);
  reminderLines.forEach((line: string) => {
    if (yPos > pageHeight - 80) {
      pdf.addPage();
      yPos = 20;
    }
    pdf.text(line, 20, yPos);
    yPos += 5;
  });
  
  yPos += 15;

  // Calculate cumulative fees
  const cumulativeFee = (() => {
    let totalFees = 0;
    const feeStage1 = options.company.reminderFeeStage1 || 0;
    const feeStage2 = options.company.reminderFeeStage2 || 0;
    const feeStage3 = options.company.reminderFeeStage3 || 0;
    
    if (stage >= 1) totalFees += feeStage1;
    if (stage >= 2) totalFees += feeStage2;
    if (stage >= 3) totalFees += feeStage3;
    
    return totalFees;
  })();

  // Amounts display
  const colLabelX = 25;
  const colAmountX = pageWidth - 50;
  
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(60, 60, 60);
  pdf.text('Rechnungsbetrag:', colLabelX, yPos);
  const originalAmount = formatCurrency(invoice.total, locale, options.company.numberFormat, options.company.currency);
  const originalAmountWidth = pdf.getTextWidth(originalAmount);
  pdf.text(originalAmount, colAmountX + 20 - originalAmountWidth, yPos);
  
  yPos += 7;

  const paidAmountValue = Math.min(
    Number(invoice.total || 0),
    Math.max(0, Number(invoice.paidAmount ?? (invoice.status === 'paid' ? invoice.total : 0))),
  );
  const outstandingAmountValue = Math.max(
    0,
    Number(invoice.outstandingAmount ?? Number(invoice.total || 0) - paidAmountValue),
  );
  if (paidAmountValue > 0) {
    pdf.setTextColor(60, 60, 60);
    pdf.text('Bereits bezahlt:', colLabelX, yPos);
    pdf.setTextColor(22, 120, 75);
    const paidAmount = `- ${formatCurrency(paidAmountValue, locale, options.company.numberFormat, options.company.currency)}`;
    const paidAmountWidth = pdf.getTextWidth(paidAmount);
    pdf.text(paidAmount, colAmountX + 20 - paidAmountWidth, yPos);
    yPos += 7;
  }
  
  if (cumulativeFee > 0) {
    pdf.setTextColor(60, 60, 60);
    pdf.text('Mahngebühren:', colLabelX, yPos);
    pdf.setTextColor(180, 50, 50);
    const feeAmount = formatCurrency(cumulativeFee, locale, options.company.numberFormat, options.company.currency);
    const feeAmountWidth = pdf.getTextWidth(feeAmount);
    pdf.text(feeAmount, colAmountX + 20 - feeAmountWidth, yPos);
    yPos += 7;
    pdf.setTextColor(0, 0, 0);
  }
  
  pdf.setDrawColor(180, 180, 180);
  pdf.setLineWidth(0.5);
  pdf.line(colLabelX, yPos, colAmountX + 20, yPos);
  yPos += 8;
  
  pdf.setFontSize(13);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
  pdf.text('Zu zahlender Gesamtbetrag:', colLabelX, yPos);
  const totalAmount = formatCurrency(outstandingAmountValue + cumulativeFee, locale, options.company.numberFormat, options.company.currency);
  const totalAmountWidth = pdf.getTextWidth(totalAmount);
  pdf.text(totalAmount, colAmountX + 20 - totalAmountWidth, yPos);
  
  yPos += 15;
  
  pdf.setTextColor(0, 0, 0);
  pdf.setDrawColor(0, 0, 0);

  // Payment information
  const paymentInfo = getEffectivePaymentInformation(options.company);
  const bankAccount = paymentInfo.bankAccount;
  const bic = paymentInfo.bic;
  
  if (template.showPaymentInformation) {
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(60, 60, 60);
    pdf.text('Zahlungsinformationen:', 20, yPos);

    yPos += 6;

    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(0, 0, 0);

    if (bankAccount) {
      pdf.text(`IBAN: ${bankAccount}`, 20, yPos);
      yPos += 5;
    }
    if (bic) {
      pdf.text(`BIC: ${bic}`, 20, yPos);
      yPos += 5;
    }
    pdf.setFont('helvetica', 'bold');
    pdf.text(`Verwendungszweck: ${invoice.invoiceNumber}`, 20, yPos);
  }

  // Footer (same style as invoice PDF)
  const addFooter = () => {
    const footerY = pageHeight - margins.bottom;
    
    // Footer separator line
    pdf.setDrawColor(203, 213, 225);
    pdf.setLineWidth(0.5);
    pdf.line(20, footerY - 8, pageWidth - 20, footerY - 8); // Reduced from 10 to 8
    
    pdf.setFontSize(8);
    pdf.setTextColor(grayText);
    
    // Company info in footer
    const footerInfo = `${options.company.name} | ${options.company.address} | ${options.company.postalCode} ${options.company.city}`;
    pdf.text(footerInfo, 20, footerY - 4); // Reduced from 5 to 4
    
    // Build tax information string
    let taxInfo = '';
    if (options.company.taxId) {
      taxInfo += `USt-IdNr: ${options.company.taxId}`;
    }
    if (options.company.taxIdentificationNumber) {
      if (taxInfo) taxInfo += ' | ';
      taxInfo += `Steuer-ID: ${options.company.taxIdentificationNumber}`;
    }
    
    const footerContact = `Tel: ${options.company.phone} | E-Mail: ${options.company.email}${taxInfo ? ' | ' + taxInfo : ''}`;
    pdf.text(footerContact, 20, footerY);
  };
  
  if (template.showFooter) {
    addFooter();
  }
  
  return pdf.output('blob');
}
