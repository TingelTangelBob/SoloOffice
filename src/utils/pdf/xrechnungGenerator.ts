/**
 * XRechnung XML generator
 * Generates XRechnung 3.0 compliant XML based on EN 16931 standard
 */

import { Invoice } from '../../types';
import { PDFOptions } from '../pdfGenerator';
import { escapeXML, formatAmountForXML } from './xmlUtils';
import { calculateTaxBreakdown, hasOnlyZeroTaxRate } from './taxCalculations';
import { getEffectivePaymentInformation } from '../paymentInformation';

/**
 * Generate XRechnung XML as a Blob
 * @param invoice - Invoice data
 * @param options - PDF options with company and customer data
 * @returns Promise with XML Blob
 */
export function generateXRechnungXML(invoice: Invoice, options: PDFOptions): Promise<Blob> {
  // Use new payment information or fall back to legacy fields
  const paymentInfo = getEffectivePaymentInformation(options.company);
  const currency = escapeXML(options.company.currency || 'EUR');
  const isCreditNote = invoice.documentType === 'credit_note';
  
  // Create a properly formatted XRechnung document following XRechnung 3.0 standard
  const xmlContent = `<?xml version="1.0" encoding="utf-8"?>
<ubl:Invoice xmlns:ubl="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" 
             xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" 
             xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0#conformant#urn:xeinkauf.de:kosit:extension:xrechnung_3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${escapeXML(invoice.invoiceNumber)}</cbc:ID>
  <cbc:IssueDate>${new Date(invoice.issueDate).toISOString().split('T')[0]}</cbc:IssueDate>
  <cbc:DueDate>${new Date(invoice.dueDate).toISOString().split('T')[0]}</cbc:DueDate>
  <cbc:InvoiceTypeCode>${isCreditNote ? '381' : '380'}</cbc:InvoiceTypeCode>
  ${(() => {
    const bankAccount = paymentInfo?.bankAccount || options.company.bankAccount;
    const bic = paymentInfo?.bic || options.company.bic || 'XXXXXXXX';
    const accountHolder = paymentInfo?.accountHolder || options.company.name;
    
    const bankInfo = bankAccount ? `${escapeXML(accountHolder)} - BIC: ${escapeXML(bic)}  IBAN: ${escapeXML(bankAccount)}` : '';
    const reverseChargeNote = hasOnlyZeroTaxRate(invoice.items) ? 'Gemäß § 13b UStG geht die Steuerschuld auf den Leistungsempfänger über' : '';
    
    const noteContent = [
      invoice.referenceInvoiceNumber ? `Bezug zur Rechnung: ${invoice.referenceInvoiceNumber}` : '',
      invoice.creditNoteReason ? `Grund: ${invoice.creditNoteReason}` : '',
      invoice.notes,
      bankInfo,
      reverseChargeNote,
    ].filter(Boolean).join('\n');
    
    return noteContent ? `<cbc:Note>${escapeXML(noteContent)}</cbc:Note>` : '';
  })()}
  <cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>${options.customer.customerNumber || 'KUNDE'}</cbc:BuyerReference>
  
  
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cbc:EndpointID schemeID="EM">${options.company.email}</cbc:EndpointID>
      <cac:PartyName>
        <cbc:Name>${escapeXML(options.company.name)}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${options.company.address}</cbc:StreetName>
        <cbc:CityName>${options.company.city}</cbc:CityName>
        <cbc:PostalZone>${options.company.postalCode}</cbc:PostalZone>
        <cac:Country>
          <cbc:IdentificationCode>${options.company.country === 'Deutschland' ? 'DE' : 'DE'}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${options.company.taxId}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${options.company.name}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
      <cac:Contact>
        <cbc:Name>${options.company.name}</cbc:Name>
        <cbc:Telephone>${options.company.phone}</cbc:Telephone>
        <cbc:ElectronicMail>${options.company.email}</cbc:ElectronicMail>
      </cac:Contact>
    </cac:Party>
  </cac:AccountingSupplierParty>
  
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cbc:EndpointID schemeID="EM">${options.customer.email}</cbc:EndpointID>
      <cac:PostalAddress>
        <cbc:StreetName>${options.customer.address}${options.customer.addressSupplement ? ', ' + options.customer.addressSupplement : ''}</cbc:StreetName>
        <cbc:CityName>${options.customer.city}</cbc:CityName>
        <cbc:PostalZone>${options.customer.postalCode}</cbc:PostalZone>
        <cac:Country>
          <cbc:IdentificationCode>${options.customer.country === 'Deutschland' ? 'DE' : 'DE'}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${options.customer.name}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:Delivery>
    <cbc:ActualDeliveryDate>${new Date(invoice.issueDate).toISOString().split('T')[0]}</cbc:ActualDeliveryDate>
  </cac:Delivery>
  
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>
    <cac:PayeeFinancialAccount>
      <cbc:ID>${(paymentInfo?.bankAccount || options.company.bankAccount)}</cbc:ID>
      <cbc:Name>${paymentInfo?.accountHolder || options.company.name}</cbc:Name>
      <cac:FinancialInstitutionBranch>
        <cbc:ID>${paymentInfo?.bic || options.company.bic || 'XXXXXXXX'}</cbc:ID>
      </cac:FinancialInstitutionBranch>
    </cac:PayeeFinancialAccount>
  </cac:PaymentMeans>
  <cac:PaymentTerms>
    <cbc:Note>/
</cbc:Note>
  </cac:PaymentTerms>
  
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${currency}">${formatAmountForXML(invoice.taxAmount)}</cbc:TaxAmount>
    ${Object.entries(calculateTaxBreakdown(invoice.items, invoice))
      .filter(([rate]) => Number(rate) > 0)
      .sort(([rateA], [rateB]) => Number(rateA) - Number(rateB))
      .map(([rate, breakdown]) => `
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${currency}">${formatAmountForXML(breakdown.taxableAmount)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${currency}">${formatAmountForXML(breakdown.taxAmount)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>${rate}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`).join('')}
  </cac:TaxTotal>
  
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${currency}">${formatAmountForXML(invoice.subtotal)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${currency}">${formatAmountForXML(invoice.subtotal - (invoice.items?.reduce((sum, item) => sum + (item.discountAmount || 0), 0) || 0) - (invoice.globalDiscountAmount || 0))}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${currency}">${formatAmountForXML(invoice.total)}</cbc:TaxInclusiveAmount>
    <cbc:AllowanceTotalAmount currencyID="${currency}">${formatAmountForXML((invoice.items?.reduce((sum, item) => sum + (item.discountAmount || 0), 0) || 0) + (invoice.globalDiscountAmount || 0))}</cbc:AllowanceTotalAmount>
    <cbc:ChargeTotalAmount currencyID="${currency}">0.00</cbc:ChargeTotalAmount>
    <cbc:PrepaidAmount currencyID="${currency}">0.00</cbc:PrepaidAmount>
    <cbc:PayableRoundingAmount currencyID="${currency}">0.00</cbc:PayableRoundingAmount>
    <cbc:PayableAmount currencyID="${currency}">${formatAmountForXML(invoice.total)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  
  ${invoice.items.map((item, index) => `
  <cac:InvoiceLine>
    <cbc:ID>${index + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">${formatAmountForXML(item.quantity)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${currency}">${formatAmountForXML((item.quantity * item.unitPrice) - (item.discountAmount || 0))}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Description>${item.description}</cbc:Description>
      <cbc:Name>${item.description}</cbc:Name>
      <cac:SellersItemIdentification>
        <cbc:ID>ITEM-${index + 1}</cbc:ID>
      </cac:SellersItemIdentification>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>${item.taxRate}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${currency}">${formatAmountForXML(item.unitPrice)}</cbc:PriceAmount>
      <cbc:BaseQuantity unitCode="C62">1.00</cbc:BaseQuantity>
    </cac:Price>
  </cac:InvoiceLine>`).join('')}
</ubl:Invoice>`;

  const blob = new Blob([xmlContent], { type: 'application/xml' });
  return Promise.resolve(blob);
}


