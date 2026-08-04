/**
 * Shared PDF components for reuse across different PDF generators
 */

import jsPDF from 'jspdf';
import { Company, Customer } from '../../types';
import { ColorConfiguration } from './colorUtils';
import { loadImage } from './imageHelpers';
import type { ResolvedDocumentTemplate } from '../documentTemplateProfiles';
import logger from '../logger';
import { getTerminology } from '../terminology';

export interface PageMargins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface PDFContext {
  pdf: jsPDF;
  pageWidth: number;
  pageHeight: number;
  margins: PageMargins;
  colors: ColorConfiguration;
  company: Company;
  customer: Customer;
  locale: string;
  template: ResolvedDocumentTemplate;
}

/**
 * Reset PDF font to default state
 */
export function resetFont(pdf: jsPDF, darkText: string): void {
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(darkText);
}

/**
 * Add complete header to PDF page
 * Returns the Y position after the header
 */
async function addClassicPDFHeader(
  context: PDFContext,
  metadataBox: { title: string; fields: Array<{ label: string; value: string }> },
  customerAddress?: string
): Promise<number> {
  const { pdf, pageWidth, margins, colors, company, customer } = context;
  const { primaryRgb, grayText, darkText } = colors;
  const terminology = getTerminology(company.terminologyProfile);
  
  let currentY = margins.top;
  
  // Invoice metadata box (right side) - positioned first to avoid overlaps
  const metadataBoxX = pageWidth - 80;
  const metadataBoxY = currentY;
  const metadataBoxWidth = 60;
  // Calculate height dynamically: title (12) + spacing (8) + fields * 10 + padding (10)
  const metadataBoxHeight = 30 + (metadataBox.fields.length * 10);
  
  // Draw metadata box (only fill, no border)
  pdf.setFillColor(248, 250, 252);
  pdf.rect(metadataBoxX, metadataBoxY, metadataBoxWidth, metadataBoxHeight, 'F');
  
  // Metadata box title
  pdf.setFontSize(14);
  pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
  pdf.text(metadataBox.title, metadataBoxX + 3, metadataBoxY + 12);
  
  let metadataY = metadataBoxY + 20;
  
  // Metadata fields
  pdf.setFontSize(8);
  pdf.setTextColor(grayText);
  for (const field of metadataBox.fields) {
    pdf.text(field.label, metadataBoxX + 3, metadataY);
    pdf.setTextColor(darkText);
    pdf.text(field.value, metadataBoxX + 3, metadataY + 4);
    metadataY += 10;
    pdf.setTextColor(grayText);
  }
  
  // Company logo or name on the left
  if (company.logo && context.template.logoMode !== 'none') {
    try {
      // Add timeout and error handling for logo loading
      const logoImg = await Promise.race([
        loadImage(company.logo),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Logo loading timeout')), 5000)
        )
      ]);
      
      // Dynamic logo sizing and positioning calculation (same as original)
      const maxLogoHeight = metadataBoxHeight * 0.8; // 80% of metadata box height for padding
      const maxLogoWidth = 100; // Available width between left margin and line end (100 units)
      const aspectRatio = logoImg.width / logoImg.height;
      
      let logoWidth, logoHeight;
      
      // Determine size based on aspect ratio and constraints
      if (aspectRatio > maxLogoWidth / maxLogoHeight) {
        // Width is the limiting factor
        logoWidth = maxLogoWidth;
        logoHeight = maxLogoWidth / aspectRatio;
      } else {
        // Height is the limiting factor
        logoHeight = maxLogoHeight;
        logoWidth = maxLogoHeight * aspectRatio;
      }
      
      // Calculate dynamic positioning
      // X: Center the logo within the available space (0 to 100 units where line ends)
      const availableLogoSpaceWidth = 100; // Width until the line under company data
      const logoStartX = 20 + (availableLogoSpaceWidth - logoWidth) / 2;
      
      // Y: Center the logo vertically within the metadata box
      const logoStartY = metadataBoxY + (metadataBoxHeight - logoHeight) / 2;
      
      // Determine image format for jsPDF
      let imageFormat = 'JPEG';
      if (company.logo.toLowerCase().includes('png') || company.logo.includes('data:image/png')) {
        imageFormat = 'PNG';
      }
      
      pdf.addImage(company.logo, imageFormat, logoStartX, logoStartY, logoWidth, logoHeight);
      
    } catch (error) {
      logger.warn('Logo konnte nicht geladen werden:', { error: String(error) });
      // Fallback: Company name as header - center vertically in metadata box
      const fallbackTextY = metadataBoxY + (metadataBoxHeight / 2) + 3; // +3 for better text baseline alignment
      pdf.setFontSize(16);
      pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
      pdf.text(company.name, 20, fallbackTextY);
    }
  } else {
    // Company name as header without logo - center vertically in metadata box  
    const fallbackTextY = metadataBoxY + (metadataBoxHeight / 2) + 3; // +3 for better text baseline alignment
    pdf.setFontSize(16);
    pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
    pdf.text(company.name, 20, fallbackTextY);
  }
  
  // Move Y position down after header section
  currentY = metadataBoxY + metadataBoxHeight + 10;
  
  // Sender address line (German standard)
  pdf.setFontSize(7);
  pdf.setTextColor(grayText);
  
  if (company.companyHeaderTwoLine) {
    // Two-line layout
    const line1 = company.companyHeaderLine1 || company.name;
    const line2 = company.companyHeaderLine2 || 
      `${company.name}, ${company.address}, ${company.postalCode} ${company.city}`;
    
    pdf.text(line1, margins.left, currentY);
    currentY += 3;
    pdf.text(line2, margins.left, currentY);
    currentY += 2;
  } else {
    // Traditional single-line layout
    pdf.text(`${company.name}, ${company.address}, ${company.postalCode} ${company.city}`, margins.left, currentY);
    currentY += 2;
  }
  
  // Line under sender address
  pdf.setDrawColor(200, 200, 200);
  pdf.line(margins.left, currentY, 120, currentY);
  
  currentY += 6;
  
  // Customer address block (left side)
  const customerAddressY = currentY;
  pdf.setFontSize(11);
  pdf.setTextColor(darkText);
  pdf.text(customer.name, margins.left, currentY);
  currentY += 5;
  if (customer.addressSupplement) {
    pdf.text(customer.addressSupplement, margins.left, currentY);
    currentY += 5;
  }
  pdf.text(customer.address, margins.left, currentY);
  currentY += 5;
  pdf.text(`${customer.postalCode} ${customer.city}`, margins.left, currentY);
  if (customer.country && customer.country !== 'Deutschland') {
    currentY += 5;
    pdf.text(customer.country, margins.left, currentY);
  }
  
  // Add execution/customer address if provided
  if (customerAddress && customerAddress.trim()) {
    currentY += 6;
    pdf.setFontSize(9);
    pdf.setTextColor(grayText);
    pdf.text('Ausführungsort:', margins.left, currentY);
    currentY += 4;
    pdf.setFontSize(10);
    pdf.setTextColor(darkText);
    
    const addressLines = customerAddress.split('\n').filter(line => line.trim());
    for (const line of addressLines) {
      pdf.text(line.trim(), margins.left, currentY);
      currentY += 4;
    }
  }
  
  // Customer details (right side)
  let customerDetailsY = customerAddressY;
  pdf.setFontSize(9);
  pdf.setTextColor(grayText);
  
  const customerMetadataX = pageWidth - 80;
  
  if (customer.customerNumber) {
    pdf.text(terminology.entity.numberShortLabel, customerMetadataX, customerDetailsY);
    pdf.setTextColor(darkText);
    pdf.text(customer.customerNumber, customerMetadataX, customerDetailsY + 4);
    customerDetailsY += 10;
  }
  
  if (customer.phone) {
    pdf.setTextColor(grayText);
    pdf.text('Telefon:', customerMetadataX, customerDetailsY);
    pdf.setTextColor(darkText);
    pdf.text(customer.phone, customerMetadataX, customerDetailsY + 4);
    customerDetailsY += 10;
  }
  
  /**if (customer.email) {
    pdf.setTextColor(grayText);
    pdf.text('E-Mail:', customerMetadataX, customerDetailsY);
    pdf.setTextColor(darkText);
    pdf.text(customer.email, customerMetadataX, customerDetailsY + 4);
    customerDetailsY += 10;
  }*/
  
  if (customer.taxId) {
    pdf.setTextColor(grayText);
    pdf.text('USt-IdNr.:', customerMetadataX, customerDetailsY);
    pdf.setTextColor(darkText);
    pdf.text(customer.taxId, customerMetadataX, customerDetailsY + 4);
  }
  
  // Ensure currentY accounts for customer address section
  currentY += 18;
  
  return currentY;
}

async function addBrand(
  context: PDFContext,
  x: number,
  y: number,
  maxWidth: number,
  maxHeight: number,
  align: 'left' | 'center' = 'left',
  fallbackColor?: { r: number; g: number; b: number },
): Promise<void> {
  const { pdf, company, colors } = context;
  const brandColor = fallbackColor || colors.primaryRgb;

  if (company.logo && context.template.logoMode !== 'none') {
    try {
      const logo = await Promise.race([
        loadImage(company.logo),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Logo loading timeout')), 5000)),
      ]);
      const ratio = logo.width / logo.height;
      const width = ratio > maxWidth / maxHeight ? maxWidth : maxHeight * ratio;
      const height = ratio > maxWidth / maxHeight ? maxWidth / ratio : maxHeight;
      const startX = align === 'center' ? x - width / 2 : x;
      const imageFormat = company.logo.toLowerCase().includes('png') ? 'PNG' : 'JPEG';
      pdf.addImage(company.logo, imageFormat, startX, y + (maxHeight - height) / 2, width, height);
      return;
    } catch (error) {
      logger.warn('Logo konnte nicht geladen werden:', { error: String(error) });
    }
  }

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(15);
  pdf.setTextColor(brandColor.r, brandColor.g, brandColor.b);
  pdf.text(company.name, align === 'center' ? x : x, y + maxHeight / 2 + 4, align === 'center' ? { align: 'center' } : undefined);
}

async function addMinimalPDFHeader(
  context: PDFContext,
  metadataBox: { title: string; fields: Array<{ label: string; value: string }> },
  customerAddress?: string,
): Promise<number> {
  const { pdf, pageWidth, margins, colors, company, customer } = context;
  const { primaryRgb, grayText, darkText } = colors;
  const top = margins.top;
  const compact = context.template.layout === 'compact';
  const airy = context.template.layout === 'air';
  const lineY = top + (compact ? 24 : airy ? 34 : 29);

  const minimalCentered = context.template.headerAlignment === 'center';
  await addBrand(context, minimalCentered ? pageWidth / 2 : margins.left, top, 70, compact ? 16 : airy ? 24 : 20, minimalCentered ? 'center' : 'left');
  pdf.setDrawColor(airy ? primaryRgb.r : 31, airy ? primaryRgb.g : 41, airy ? primaryRgb.b : 55);
  pdf.setLineWidth(0.5);
  pdf.line(margins.left, lineY, pageWidth - margins.right, lineY);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(compact ? 11 : airy ? 12 : 13);
  pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
  pdf.text(metadataBox.title, pageWidth - margins.right, top + (compact ? 8 : 9), { align: 'right' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(compact ? 7 : 8);
  let metadataY = top + (compact ? 14 : 16);
  for (const field of metadataBox.fields) {
    pdf.setTextColor(grayText);
    pdf.text(field.label, pageWidth - 58, metadataY);
    pdf.setTextColor(darkText);
    pdf.text(field.value, pageWidth - margins.right, metadataY, { align: 'right' });
    metadataY += 4;
  }

  let currentY = top + (compact ? 36 : airy ? 48 : 43);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(darkText);
  pdf.text(customer.name, margins.left, currentY);
  currentY += 5;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.text(customer.address, margins.left, currentY);
  currentY += 4;
  pdf.text(`${customer.postalCode} ${customer.city}`, margins.left, currentY);
  if (customer.country && customer.country !== 'Deutschland') {
    currentY += 4;
    pdf.text(customer.country, margins.left, currentY);
  }

  pdf.setFontSize(8);
  pdf.setTextColor(grayText);
  const sender = `${company.name} · ${company.address} · ${company.postalCode} ${company.city}`;
  pdf.text(sender, margins.left, top + (compact ? 70 : airy ? 86 : 80));
  if (customerAddress?.trim()) {
    pdf.text(`Ausführungsort: ${customerAddress.replace(/\n/g, ' ')}`, margins.left, top + (compact ? 75 : airy ? 91 : 85));
    return top + (compact ? 81 : airy ? 97 : 91);
  }
  return top + (compact ? 76 : airy ? 92 : 86);
}

async function addEditorialPDFHeader(
  context: PDFContext,
  metadataBox: { title: string; fields: Array<{ label: string; value: string }> },
): Promise<number> {
  const { pdf, pageWidth, margins, colors, customer } = context;
  const { primaryRgb, grayText, darkText } = colors;
  const top = margins.top;

  const editorialCentered = context.template.headerAlignment !== 'left';
  await addBrand(context, editorialCentered ? pageWidth / 2 : margins.left, top, 75, 24, editorialCentered ? 'center' : 'left');
  pdf.setDrawColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
  pdf.setLineWidth(1);
  pdf.line(margins.left, top + 31, pageWidth - margins.right, top + 31);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
  pdf.text(metadataBox.title, margins.left, top + 45);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  let metadataY = top + 52;
  for (const field of metadataBox.fields) {
    pdf.setTextColor(grayText);
    pdf.text(field.label, pageWidth - 64, metadataY);
    pdf.setTextColor(darkText);
    pdf.text(field.value, pageWidth - margins.right, metadataY, { align: 'right' });
    metadataY += 4;
  }

  let currentY = top + 49;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(darkText);
  pdf.text(customer.name, margins.left, currentY);
  currentY += 5;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.text(customer.address, margins.left, currentY);
  currentY += 4;
  pdf.text(`${customer.postalCode} ${customer.city}`, margins.left, currentY);
  return top + 82;
}

type AccentHeaderVariant = 'modern' | 'bold' | 'split' | 'frame';

async function addAccentPDFHeader(
  context: PDFContext,
  metadataBox: { title: string; fields: Array<{ label: string; value: string }> },
  variant: AccentHeaderVariant,
  customerAddress?: string,
): Promise<number> {
  const { pdf, pageWidth, margins, colors, company, customer } = context;
  const { primaryRgb, grayText, darkText } = colors;
  const top = margins.top;
  const contentWidth = pageWidth - margins.left - margins.right;
  const white = { r: 255, g: 255, b: 255 };

  if (variant === 'bold') {
    pdf.setFillColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
    pdf.rect(0, top - 5, pageWidth, 34, 'F');
    await addBrand(context, margins.left, top, 74, 20, 'left', white);
  } else if (variant === 'modern') {
    pdf.setFillColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
    pdf.rect(margins.left, top - 2, contentWidth, 4, 'F');
    await addBrand(context, margins.left, top + 7, 74, 20, 'left');
  } else if (variant === 'split') {
    pdf.setFillColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
    pdf.rect(margins.left, top, 4, 82, 'F');
    await addBrand(context, margins.left + 11, top + 3, 74, 20, 'left');
  } else {
    pdf.setDrawColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
    pdf.setLineWidth(0.8);
    pdf.rect(margins.left, top, contentWidth, 82);
    await addBrand(context, margins.left + 8, top + 7, 70, 20, 'left');
  }

  const titleColor = variant === 'bold' ? '#ffffff' : primaryRgb;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(13);
  if (typeof titleColor === 'string') {
    pdf.setTextColor(titleColor);
  } else {
    pdf.setTextColor(titleColor.r, titleColor.g, titleColor.b);
  }
  pdf.text(metadataBox.title, pageWidth - margins.right, top + (variant === 'bold' ? 9 : 14), { align: 'right' });

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  let metadataY = top + (variant === 'bold' ? 16 : 22);
  for (const field of metadataBox.fields) {
    pdf.setTextColor(grayText);
    pdf.text(field.label, pageWidth - 62, metadataY);
    pdf.setTextColor(darkText);
    pdf.text(field.value, pageWidth - margins.right, metadataY, { align: 'right' });
    metadataY += 4;
  }

  const customerY = top + (variant === 'bold' ? 48 : 54);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(darkText);
  pdf.text(customer.name, margins.left + (variant === 'split' ? 11 : 0), customerY);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.text(customer.address, margins.left + (variant === 'split' ? 11 : 0), customerY + 5);
  pdf.text(`${customer.postalCode} ${customer.city}`, margins.left + (variant === 'split' ? 11 : 0), customerY + 9);
  if (customerAddress?.trim()) {
    pdf.setTextColor(grayText);
    pdf.setFontSize(8);
    pdf.text(`Ausführungsort: ${customerAddress.replace(/\n/g, ' ')}`, margins.left + (variant === 'split' ? 11 : 0), customerY + 15);
  }

  pdf.setFontSize(8);
  pdf.setTextColor(grayText);
  pdf.text(`${company.name} · ${company.address} · ${company.postalCode} ${company.city}`, margins.left + (variant === 'split' ? 11 : 0), top + 78);
  return top + (variant === 'bold' ? 91 : 94);
}

/** Add the selected PDF layout profile's header. */
export async function addPDFHeader(
  context: PDFContext,
  metadataBox: { title: string; fields: Array<{ label: string; value: string }> },
  customerAddress?: string,
): Promise<number> {
  switch (context.template.layout) {
    case 'minimal':
    case 'compact':
    case 'air':
      return addMinimalPDFHeader(context, metadataBox, customerAddress);
    case 'editorial':
      return addEditorialPDFHeader(context, metadataBox);
    case 'modern':
    case 'bold':
    case 'split':
    case 'frame':
      return addAccentPDFHeader(context, metadataBox, context.template.layout, customerAddress);
    case 'classic':
    default:
      return addClassicPDFHeader(context, metadataBox, customerAddress);
  }
}

/**
 * Add footer to PDF page
 */
export function addPDFFooter(
  context: PDFContext,
  pageNum: number,
  totalPages?: number
): void {
  const { pdf, pageWidth, pageHeight, margins, colors, company } = context;
  const { grayText } = colors;
  
  const footerY = pageHeight - margins.bottom;
  
  // Footer separator line
  pdf.setDrawColor(203, 213, 225);
  pdf.setLineWidth(0.5);
  pdf.line(margins.left, footerY - 8, pageWidth - margins.right, footerY - 8);
  
  pdf.setFontSize(8);
  pdf.setTextColor(grayText);
  
  // Company info in footer
  const footerInfo = `${company.name} | ${company.address} | ${company.postalCode} ${company.city}`;
  pdf.text(footerInfo, margins.left, footerY - 4);
  
  // Build tax information string
  let taxInfo = '';
  if (company.taxId) {
    taxInfo += `USt-IdNr: ${company.taxId}`;
  }
  if (company.taxIdentificationNumber) {
    if (taxInfo) taxInfo += ' | ';
    taxInfo += `Steuer-ID: ${company.taxIdentificationNumber}`;
  }
  
  const footerContact = `Tel: ${company.phone} | E-Mail: ${company.email}${taxInfo ? ' | ' + taxInfo : ''}`;
  pdf.text(footerContact, margins.left, footerY);
  
  // Page number if multiple pages
  if (totalPages && totalPages > 1) {
    pdf.text(`Seite ${pageNum} von ${totalPages}`, pageWidth - margins.right - 30, footerY + 8);
  } else if (!totalPages) {
    // Single page number without total
    pdf.text(`Seite ${pageNum}`, pageWidth - margins.right - 20, footerY + 8);
  }
}

/**
 * Draw table header
 */
export function drawTableHeader(
  pdf: jsPDF,
  yPosition: number,
  pageWidth: number,
  _colors: ColorConfiguration,
  columns: Array<{ label: string; x: number }>,
  darkText: string,
  tableStyle: 'light' | 'dark' | 'accent' = 'light',
  accentRgb: { r: number; g: number; b: number } = { r: 37, g: 99, b: 235 },
): number {
  // Table header background
  const isDark = tableStyle === 'dark';
  const isAccent = tableStyle === 'accent';
  pdf.setFillColor(isDark ? 31 : isAccent ? accentRgb.r : 240, isDark ? 41 : isAccent ? accentRgb.g : 243, isDark ? 55 : isAccent ? accentRgb.b : 248);
  pdf.rect(20, yPosition - 2, pageWidth - 40, 12, 'F');
  
  // Table border
  pdf.setDrawColor(203, 213, 225);
  pdf.setLineWidth(0.5);
  pdf.rect(20, yPosition - 2, pageWidth - 40, 12);
  
  pdf.setFontSize(9);
  pdf.setTextColor(isDark || isAccent ? '#ffffff' : darkText);
  pdf.setFont('helvetica', 'bold');
  
  // Column headers
  for (const col of columns) {
    pdf.text(col.label, col.x, yPosition + 5);
  }
  
  return yPosition + 15;
}

/**
 * Check if page break is needed and add new page if necessary
 * Returns true if a new page was added
 */
export async function checkPageBreak(
  context: PDFContext,
  currentY: number,
  requiredSpace: number,
  minimumSpace: number = 30,
  onNewPage?: () => Promise<number>
): Promise<{ needsBreak: boolean; newY: number }> {
  const availableSpace = context.pageHeight - context.margins.bottom - currentY;
  
  if (availableSpace < Math.max(requiredSpace, minimumSpace)) {
    context.pdf.addPage();
    
    let newY = context.margins.top;
    if (onNewPage) {
      newY = await onNewPage();
    }
    
    return { needsBreak: true, newY };
  }
  
  return { needsBreak: false, newY: currentY };
}

