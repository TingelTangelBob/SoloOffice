import jsPDF from 'jspdf';
import type { Customer } from '../types';
import { csvFileName, downloadCsv } from './csvExport';
import type { CsvColumn } from './csvExport';

const customerTypeLabel = (customer: Customer) => customer.customerType === 'organization' ? 'Organisation' : 'Person';

const jsonValue = (value: unknown) => JSON.stringify(value ?? []);

/**
 * Vollständiger, wieder importierbarer Kundenexport. Auch die optionalen
 * kundenspezifischen Preise bleiben als JSON-Spalten erhalten, damit ein
 * Export-Import-Zyklus keine steuerbaren Kundendaten verliert.
 */
export const customerCsvColumns: CsvColumn<Customer>[] = [
  { header: 'Kunden-ID', value: customer => customer.id },
  { header: 'Kundennummer', value: customer => customer.customerNumber },
  { header: 'Kundenart', value: customerTypeLabel },
  { header: 'Name', value: customer => customer.name },
  { header: 'E-Mail', value: customer => customer.email },
  { header: 'Weitere E-Mails', value: customer => jsonValue(customer.additionalEmails) },
  { header: 'Adresse', value: customer => customer.address },
  { header: 'Adresszusatz', value: customer => customer.addressSupplement },
  { header: 'PLZ', value: customer => customer.postalCode },
  { header: 'Ort', value: customer => customer.city },
  { header: 'Land', value: customer => customer.country },
  { header: 'USt-IdNr.', value: customer => customer.taxId },
  { header: 'Leitweg-ID', value: customer => customer.leitwegId },
  { header: 'Telefon', value: customer => customer.phone },
  { header: 'Notizen', value: customer => customer.notes },
  { header: 'Aktiv', value: customer => customer.isActive === false ? 'Nein' : 'Ja' },
  { header: 'Stundensätze', value: customer => jsonValue(customer.hourlyRates) },
  { header: 'Materialien', value: customer => jsonValue(customer.materials) },
];

export function downloadCustomerCsv(customers: Customer[], baseName = 'kunden') {
  downloadCsv(csvFileName(baseName), customers, customerCsvColumns);
}

function pdfText(value: unknown): string {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim() || '–';
}

function pdfRows(customer: Customer): Array<[string, string]> {
  return [
    ['Kundenart', customerTypeLabel(customer)],
    ['Kundennummer', customer.customerNumber],
    ['E-Mail', customer.email],
    ['Weitere E-Mails', (customer.additionalEmails || []).map(email => email.email).join(', ')],
    ['Telefon', customer.phone],
    ['Adresse', [customer.address, customer.addressSupplement, [customer.postalCode, customer.city].filter(Boolean).join(' '), customer.country].filter(Boolean).join(', ')],
    ['USt-IdNr.', customer.taxId],
    ['Leitweg-ID', customer.leitwegId],
    ['Notizen', customer.notes],
  ].map(([label, value]) => [label, pdfText(value)] as [string, string]);
}

export function downloadCustomerPdf(customers: Customer[], baseName = 'kunden') {
  const pdf = new jsPDF();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const left = 18;
  const right = 18;
  const valueWidth = pageWidth - left - right - 42;
  let y = 20;

  customers.forEach((customer, index) => {
    if (index > 0) {
      pdf.addPage();
      y = 20;
    }
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(18);
    pdf.setTextColor(25, 25, 30);
    pdf.text(pdfText(customer.name), left, y);
    y += 8;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.setTextColor(105, 105, 115);
    pdf.text('Kundenprofil', left, y);
    y += 12;

    pdfRows(customer).forEach(([label, value]) => {
      const lines = pdf.splitTextToSize(value, valueWidth) as string[];
      if (y + Math.max(7, lines.length * 4.5) > pageHeight - 18) {
        pdf.addPage();
        y = 20;
      }
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(75, 75, 85);
      pdf.text(label, left, y);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(25, 25, 30);
      pdf.text(lines, left + 42, y);
      y += Math.max(7, lines.length * 4.5);
      pdf.setDrawColor(230, 230, 234);
      pdf.line(left, y - 3, pageWidth - right, y - 3);
    });
  });

  pdf.save(`${baseName}-${new Date().toISOString().slice(0, 10)}.pdf`);
}
