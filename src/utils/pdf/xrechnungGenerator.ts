/** XRechnung 3.0 XML generator (UBL 2.1). */

import { Invoice } from '../../types';
import { PDFOptions } from '../pdfGenerator';
import { escapeXML, formatAmountForXML, countryCode, taxCategoryCode, taxExemptionReason } from './xmlUtils';
import { calculateTaxBreakdown, hasOnlyZeroTaxRate } from './taxCalculations';
import { getEffectivePaymentInformation } from '../paymentInformation';
import { assertEInvoiceXML } from './eInvoiceValidation';

function dateValue(value: string | Date) {
  return new Date(value).toISOString().split('T')[0];
}

export function generateXRechnungXML(invoice: Invoice, options: PDFOptions): Promise<Blob> {
  const paymentInfo = getEffectivePaymentInformation(options.company);
  const currency = escapeXML(options.company.currency || 'EUR');
  const isCreditNote = invoice.documentType === 'credit_note';
  const isSmallBusiness = options.company.isSmallBusiness === true;
  const buyerReference = options.customer.leitwegId || options.customer.customerNumber || 'KUNDE';
  const bankAccount = paymentInfo?.bankAccount || options.company.bankAccount || '';
  const accountHolder = paymentInfo?.accountHolder || options.company.name || '';
  const bic = paymentInfo?.bic || options.company.bic || '';
  const paymentTerms = paymentInfo?.paymentTerms
    || (options.company.defaultPaymentDays !== undefined ? `Zahlbar innerhalb von ${options.company.defaultPaymentDays} Tagen.` : '');
  const paymentMeans = bankAccount ? `
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>
    <cac:PayeeFinancialAccount>
      <cbc:ID>${escapeXML(bankAccount.replace(/\s/g, ''))}</cbc:ID>
      <cbc:Name>${escapeXML(accountHolder)}</cbc:Name>
      ${bic ? `<cac:FinancialInstitutionBranch><cbc:ID>${escapeXML(bic)}</cbc:ID></cac:FinancialInstitutionBranch>` : ''}
    </cac:PayeeFinancialAccount>
  </cac:PaymentMeans>` : '';
  const paymentTermsXml = paymentTerms ? `<cac:PaymentTerms><cbc:Note>${escapeXML(paymentTerms)}</cbc:Note></cac:PaymentTerms>` : '';
  const reverseChargeNote = hasOnlyZeroTaxRate(invoice.items) && !isSmallBusiness
    ? 'Gemäß § 13b UStG geht die Steuerschuld auf den Leistungsempfänger über'
    : '';
  const noteContent = [
    invoice.referenceInvoiceNumber ? `Bezug zur Rechnung: ${invoice.referenceInvoiceNumber}` : '',
    invoice.creditNoteReason ? `Grund: ${invoice.creditNoteReason}` : '',
    invoice.notes || '',
    reverseChargeNote,
  ].filter(Boolean).join('\n');
  const taxBreakdown = calculateTaxBreakdown(invoice.items, invoice);
  const taxableAmount = invoice.subtotal
    - (invoice.items?.reduce((sum, item) => sum + (item.discountAmount || 0), 0) || 0)
    - (invoice.globalDiscountAmount || 0);

  const xmlContent = `<?xml version="1.0" encoding="utf-8"?>
<ubl:Invoice xmlns:ubl="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${escapeXML(invoice.invoiceNumber)}</cbc:ID>
  <cbc:IssueDate>${dateValue(invoice.issueDate)}</cbc:IssueDate>
  <cbc:DueDate>${dateValue(invoice.dueDate)}</cbc:DueDate>
  <cbc:InvoiceTypeCode>${isCreditNote ? '381' : '380'}</cbc:InvoiceTypeCode>
  ${noteContent ? `<cbc:Note>${escapeXML(noteContent)}</cbc:Note>` : ''}
  <cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>${escapeXML(buyerReference)}</cbc:BuyerReference>
  <cac:AccountingSupplierParty><cac:Party>
    <cbc:EndpointID schemeID="EM">${escapeXML(options.company.email)}</cbc:EndpointID>
    <cac:PartyName><cbc:Name>${escapeXML(options.company.name)}</cbc:Name></cac:PartyName>
    <cac:PostalAddress>
      <cbc:StreetName>${escapeXML(options.company.address)}</cbc:StreetName>
      <cbc:CityName>${escapeXML(options.company.city)}</cbc:CityName>
      <cbc:PostalZone>${escapeXML(options.company.postalCode)}</cbc:PostalZone>
      <cac:Country><cbc:IdentificationCode>${countryCode(options.company.country)}</cbc:IdentificationCode></cac:Country>
    </cac:PostalAddress>
    ${options.company.taxId ? `<cac:PartyTaxScheme><cbc:CompanyID>${escapeXML(options.company.taxId)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ''}
    <cac:PartyLegalEntity><cbc:RegistrationName>${escapeXML(options.company.name)}</cbc:RegistrationName></cac:PartyLegalEntity>
    <cac:Contact><cbc:Name>${escapeXML(options.company.name)}</cbc:Name><cbc:Telephone>${escapeXML(options.company.phone)}</cbc:Telephone><cbc:ElectronicMail>${escapeXML(options.company.email)}</cbc:ElectronicMail></cac:Contact>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>
    <cbc:EndpointID schemeID="EM">${escapeXML(options.customer.email)}</cbc:EndpointID>
    <cac:PartyName><cbc:Name>${escapeXML(options.customer.name)}</cbc:Name></cac:PartyName>
    <cac:PostalAddress>
      <cbc:StreetName>${escapeXML(options.customer.address)}${options.customer.addressSupplement ? `, ${escapeXML(options.customer.addressSupplement)}` : ''}</cbc:StreetName>
      <cbc:CityName>${escapeXML(options.customer.city)}</cbc:CityName>
      <cbc:PostalZone>${escapeXML(options.customer.postalCode)}</cbc:PostalZone>
      <cac:Country><cbc:IdentificationCode>${countryCode(options.customer.country)}</cbc:IdentificationCode></cac:Country>
    </cac:PostalAddress>
    <cac:PartyLegalEntity><cbc:RegistrationName>${escapeXML(options.customer.name)}</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingCustomerParty>
  <cac:Delivery><cbc:ActualDeliveryDate>${dateValue(invoice.issueDate)}</cbc:ActualDeliveryDate></cac:Delivery>
  ${paymentMeans}
  ${paymentTermsXml}
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${currency}">${formatAmountForXML(invoice.taxAmount)}</cbc:TaxAmount>
    ${Object.entries(taxBreakdown).sort(([a], [b]) => Number(a) - Number(b)).map(([rate, breakdown]) => {
      const category = taxCategoryCode(Number(rate), isSmallBusiness);
      const exemption = taxExemptionReason(category);
      return `<cac:TaxSubtotal><cbc:TaxableAmount currencyID="${currency}">${formatAmountForXML(breakdown.taxableAmount)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="${currency}">${formatAmountForXML(breakdown.taxAmount)}</cbc:TaxAmount><cac:TaxCategory><cbc:ID>${category}</cbc:ID><cbc:Percent>${formatAmountForXML(Number(rate))}</cbc:Percent>${exemption ? `<cbc:TaxExemptionReason>${escapeXML(exemption)}</cbc:TaxExemptionReason>` : ''}<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`;
    }).join('')}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${currency}">${formatAmountForXML(invoice.subtotal)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${currency}">${formatAmountForXML(taxableAmount)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${currency}">${formatAmountForXML(invoice.total)}</cbc:TaxInclusiveAmount>
    <cbc:AllowanceTotalAmount currencyID="${currency}">${formatAmountForXML(invoice.items?.reduce((sum, item) => sum + (item.discountAmount || 0), 0) + (invoice.globalDiscountAmount || 0))}</cbc:AllowanceTotalAmount>
    <cbc:ChargeTotalAmount currencyID="${currency}">0.00</cbc:ChargeTotalAmount><cbc:PrepaidAmount currencyID="${currency}">0.00</cbc:PrepaidAmount><cbc:PayableAmount currencyID="${currency}">${formatAmountForXML(invoice.total)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${invoice.items.map((item, index) => {
    const category = taxCategoryCode(item.taxRate, isSmallBusiness);
    const exemption = taxExemptionReason(category);
    return `<cac:InvoiceLine><cbc:ID>${index + 1}</cbc:ID><cbc:InvoicedQuantity unitCode="C62">${formatAmountForXML(item.quantity)}</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="${currency}">${formatAmountForXML((item.quantity * item.unitPrice) - (item.discountAmount || 0))}</cbc:LineExtensionAmount><cac:Item><cbc:Description>${escapeXML(item.description)}</cbc:Description><cbc:Name>${escapeXML(item.description)}</cbc:Name><cac:SellersItemIdentification><cbc:ID>ITEM-${index + 1}</cbc:ID></cac:SellersItemIdentification><cac:ClassifiedTaxCategory><cbc:ID>${category}</cbc:ID><cbc:Percent>${formatAmountForXML(item.taxRate)}</cbc:Percent>${exemption ? `<cbc:TaxExemptionReason>${escapeXML(exemption)}</cbc:TaxExemptionReason>` : ''}<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item><cac:Price><cbc:PriceAmount currencyID="${currency}">${formatAmountForXML(item.unitPrice)}</cbc:PriceAmount><cbc:BaseQuantity unitCode="C62">1.00</cbc:BaseQuantity></cac:Price></cac:InvoiceLine>`;
  }).join('')}
</ubl:Invoice>`;

  assertEInvoiceXML(xmlContent, 'XRechnung');
  return Promise.resolve(new Blob([xmlContent], { type: 'application/xml' }));
}
