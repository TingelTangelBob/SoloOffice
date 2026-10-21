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
  
  // DIN 5008 Form B: Empfängerfeld 45 mm von oben, 20 mm von links (Fenster 90 × 45 mm).
  const RECIPIENT_TOP_Y = 45;
  const SENDER_LINE_Y = 34;
  const LOGO_ZONE_HEIGHT = 18;

  let currentY = margins.top;
  
  // Invoice metadata box (right side) - positioned first to avoid overlaps
  const metadataBoxX = pageWidth - 80;
  const metadataBoxY = currentY;
  const metadataBoxWidth = 60;
  // Calculate height dynamically: title (12) + spacing (8) + fields * 10 + padding (10)
  const metadataBoxHeight = 15 + (metadataBox.fields.length * 8) + 3;
  
  // Draw metadata box (only fill, no border)
  pdf.setFillColor(248, 250, 252);
  pdf.rect(metadataBoxX, metadataBoxY, metadataBoxWidth, metadataBoxHeight, 'F');
  
  // Metadata box title
  pdf.setFontSize(14);
  pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
  pdf.text(metadataBox.title, metadataBoxX + 3, metadataBoxY + 12);
  
  let metadataY = metadataBoxY + 15;
  
  // Metadata fields
  pdf.setFontSize(8);
  pdf.setTextColor(grayText);
  for (const field of metadataBox.fields) {
    pdf.text(field.label, metadataBoxX + 3, metadataY);
    pdf.setTextColor(darkText);
    pdf.text(field.value, metadataBoxX + 3, metadataY + 4);
    metadataY += 8;
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
      const maxLogoHeight = LOGO_ZONE_HEIGHT; // Logo bleibt oberhalb der Absenderzeile
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
      const logoStartY = metadataBoxY + (LOGO_ZONE_HEIGHT - logoHeight) / 2;
      
      // Determine image format for jsPDF
      let imageFormat = 'JPEG';
      if (company.logo.toLowerCase().includes('png') || company.logo.includes('data:image/png')) {
        imageFormat = 'PNG';
      }
      
      pdf.addImage(company.logo, imageFormat, logoStartX, logoStartY, logoWidth, logoHeight);
      
    } catch (error) {
      logger.warn('Logo konnte nicht geladen werden:', { error: String(error) });
      // Fallback: Company name as header - center vertically in metadata box
      const fallbackTextY = metadataBoxY + LOGO_ZONE_HEIGHT / 2 + 3; // +3 for better text baseline alignment
      pdf.setFontSize(16);
      pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
      pdf.text(company.name, 20, fallbackTextY);
    }
  } else {
    // Company name as header without logo - center vertically in metadata box  
    const fallbackTextY = metadataBoxY + LOGO_ZONE_HEIGHT / 2 + 3; // +3 for better text baseline alignment
    pdf.setFontSize(16);
    pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
    pdf.text(company.name, 20, fallbackTextY);
  }
  
  // Move Y position down after header section
  currentY = SENDER_LINE_Y;
  
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
  
  // Empfängerfeld im Sichtfenster, unabhängig vom Kopf darüber
  currentY = RECIPIENT_TOP_Y + 4;
  
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
  // Rechts unter dem Kasten für Rechnungsnummer und Datum beginnen
  let customerDetailsY = Math.max(customerAddressY, metadataBoxY + metadataBoxHeight + 6);
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
  
  // Der Textkörper beginnt unterhalb des Sichtfensters (Form B: bis 90 mm).
  return Math.max(currentY + 8, 95);
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

// Gemeinsame Maße für alle Kopfvarianten (DIN 5008 Form B): Der Empfänger steht im
// Sichtfenster bei 45 mm von oben und 20 mm von links; Linien und Flächen bleiben
// darüber oder seitlich davon.
const WINDOW_RECIPIENT_Y = 49;

function recipientBlockEnd(customerEndY: number): number {
  return Math.max(customerEndY + 8, 95);
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
  const lineY = top + 22;

  const minimalCentered = context.template.headerAlignment === 'center';
  await addBrand(context, minimalCentered ? pageWidth / 2 : margins.left, top, 70, compact ? 14 : airy ? 18 : 18, minimalCentered ? 'center' : 'left');
  pdf.setDrawColor(airy ? primaryRgb.r : 31, airy ? primaryRgb.g : 41, airy ? primaryRgb.b : 55);
  pdf.setLineWidth(0.5);
  pdf.line(margins.left, lineY, pageWidth - margins.right, lineY);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(compact ? 11 : airy ? 12 : 13);
  pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
  pdf.text(metadataBox.title, pageWidth - margins.right, top + 8, { align: 'right' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(compact ? 7 : 8);
  let metadataY = top + 14;
  for (const field of metadataBox.fields) {
    pdf.setTextColor(grayText);
    pdf.text(field.label, pageWidth - 92, metadataY);
    pdf.setTextColor(darkText);
    pdf.text(field.value, pageWidth - margins.right, metadataY, { align: 'right' });
    metadataY += 4;
  }

  // Absenderzeile oberhalb des Sichtfensters
  pdf.setFontSize(7);
  pdf.setTextColor(grayText);
  pdf.text(`${company.name} · ${company.address} · ${company.postalCode} ${company.city}`, margins.left, lineY + 4);

  let currentY = WINDOW_RECIPIENT_Y;
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

  if (customerAddress?.trim()) {
    pdf.setFontSize(8);
    pdf.setTextColor(grayText);
    currentY += 6;
    pdf.text(`Ausführungsort: ${customerAddress.replace(/\n/g, ' ')}`, margins.left, currentY);
  }
  return recipientBlockEnd(currentY);
}

async function addEditorialPDFHeader(
  context: PDFContext,
  metadataBox: { title: string; fields: Array<{ label: string; value: string }> },
): Promise<number> {
  const { pdf, pageWidth, margins, colors, customer } = context;
  const { primaryRgb, grayText, darkText } = colors;
  const top = margins.top;

  const editorialCentered = context.template.headerAlignment !== 'left';
  await addBrand(context, editorialCentered ? pageWidth / 2 : margins.left, top, 75, 18, editorialCentered ? 'center' : 'left');
  pdf.setDrawColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
  pdf.setLineWidth(1);
  pdf.line(margins.left, top + 26, pageWidth - margins.right, top + 26);

  // Titel und Metadaten rechts, damit der Empfänger links frei bleibt
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
  pdf.text(metadataBox.title, pageWidth - margins.right, top + 12, { align: 'right' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  let metadataY = top + 17;
  for (const field of metadataBox.fields) {
    pdf.setTextColor(grayText);
    pdf.text(field.label, pageWidth - 92, metadataY);
    pdf.setTextColor(darkText);
    pdf.text(field.value, pageWidth - margins.right, metadataY, { align: 'right' });
    metadataY += 4;
  }

  let currentY = WINDOW_RECIPIENT_Y;
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
  return recipientBlockEnd(currentY);
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
  // Einrückung des Empfängers: Bei Rahmen und Seitenleiste liegt die Kante links bei 20 mm.
  const customerX = margins.left + (variant === 'split' ? 11 : variant === 'frame' ? 8 : 0);

  if (variant === 'bold') {
    pdf.setFillColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
    pdf.rect(0, top - 5, pageWidth, 28, 'F');
    await addBrand(context, margins.left, top, 74, 18, 'left', white);
  } else if (variant === 'modern') {
    pdf.setFillColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
    pdf.rect(margins.left, top - 2, contentWidth, 4, 'F');
    await addBrand(context, margins.left, top + 6, 74, 18, 'left');
  } else if (variant === 'split') {
    pdf.setFillColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
    pdf.rect(margins.left, top, 4, 82, 'F');
    await addBrand(context, margins.left + 11, top + 2, 74, 18, 'left');
  } else {
    pdf.setDrawColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
    pdf.setLineWidth(0.8);
    pdf.rect(margins.left, top, contentWidth, 82);
    await addBrand(context, margins.left + 8, top + 6, 70, 18, 'left');
  }

  const titleColor = variant === 'bold' ? '#ffffff' : primaryRgb;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(13);
  if (typeof titleColor === 'string') {
    pdf.setTextColor(titleColor);
  } else {
    pdf.setTextColor(titleColor.r, titleColor.g, titleColor.b);
  }
  pdf.text(metadataBox.title, pageWidth - margins.right, top + (variant === 'bold' ? 8 : 12), { align: 'right' });

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  let metadataY = top + (variant === 'bold' ? 14 : 18);
  for (const field of metadataBox.fields) {
    pdf.setTextColor(grayText);
    pdf.text(field.label, pageWidth - 92, metadataY);
    pdf.setTextColor(darkText);
    pdf.text(field.value, pageWidth - margins.right, metadataY, { align: 'right' });
    metadataY += 4;
  }

  let currentY = WINDOW_RECIPIENT_Y;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(darkText);
  pdf.text(customer.name, customerX, currentY);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.text(customer.address, customerX, currentY + 5);
  pdf.text(`${customer.postalCode} ${customer.city}`, customerX, currentY + 9);
  currentY += 9;
  if (customerAddress?.trim()) {
    pdf.setTextColor(grayText);
    pdf.setFontSize(8);
    pdf.text(`Ausführungsort: ${customerAddress.replace(/\n/g, ' ')}`, customerX, currentY + 6);
    currentY += 6;
  }

  // Absenderzeile unterhalb des Sichtfensters, außerhalb der Empfängerzone
  pdf.setFontSize(8);
  pdf.setTextColor(grayText);
  pdf.text(`${company.name} · ${company.address} · ${company.postalCode} ${company.city}`, margins.left + (variant === 'split' ? 11 : 0), top + 80);
  return Math.max(recipientBlockEnd(currentY), top + 84);
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
    taxInfo += `Steuernummer: ${company.taxIdentificationNumber}`;
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

