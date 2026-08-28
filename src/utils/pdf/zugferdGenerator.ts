/** ZUGFeRD 2.1 XML generation and PDF attachment. */

import { PDFDocument, PDFName, AFRelationship } from 'pdf-lib';
import { Invoice } from '../../types';
import { PDFOptions } from '../pdfGenerator';
import logger from '../logger';
import { escapeXML, formatAmountForXML, countryCode, taxCategoryCode, taxExemptionReason } from './xmlUtils';
import { calculateTaxBreakdown, hasOnlyZeroTaxRate } from './taxCalculations';
import { getEffectivePaymentInformation } from '../paymentInformation';
import { assertEInvoiceXML } from './eInvoiceValidation';

function dateValue(value: string | Date) {
  return new Date(value).toISOString().split('T')[0].replace(/-/g, '');
}

export function generateZUGFeRDXML(invoice: Invoice, options: PDFOptions): string {
  const paymentInfo = getEffectivePaymentInformation(options.company);
  const currency = escapeXML(options.company.currency || 'EUR');
  const isCreditNote = invoice.documentType === 'credit_note';
  const isSmallBusiness = options.company.isSmallBusiness === true;
  const bankAccount = paymentInfo?.bankAccount || options.company.bankAccount || '';
  const accountHolder = paymentInfo?.accountHolder || options.company.name || '';
  const bic = paymentInfo?.bic || options.company.bic || '';
  const paymentTerms = paymentInfo?.paymentTerms
    || (options.company.defaultPaymentDays !== undefined ? `Zahlbar innerhalb von ${options.company.defaultPaymentDays} Tagen.` : '');
  const buyerReference = options.customer.leitwegId || options.customer.customerNumber || 'KUNDE';
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
  const paymentMeans = bankAccount ? `
      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>58</ram:TypeCode>
        <ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${escapeXML(bankAccount.replace(/\s/g, ''))}</ram:IBANID><ram:AccountName>${escapeXML(accountHolder)}</ram:AccountName></ram:PayeePartyCreditorFinancialAccount>
        ${bic ? `<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${escapeXML(bic)}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>` : ''}
      </ram:SpecifiedTradeSettlementPaymentMeans>` : '';
  const paymentTermsXml = paymentTerms ? `<ram:SpecifiedTradePaymentTerms><ram:Description>${escapeXML(paymentTerms)}</ram:Description><ram:DueDateDateTime><udt:DateTimeString format="102">${dateValue(invoice.dueDate)}</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>` : '';

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017#compliant#urn:zugferd.de:2p1:en16931</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${escapeXML(invoice.invoiceNumber)}</ram:ID><ram:TypeCode>${isCreditNote ? '381' : '380'}</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">${dateValue(invoice.issueDate)}</udt:DateTimeString></ram:IssueDateTime>
    ${noteContent ? `<ram:IncludedNote><ram:Content>${escapeXML(noteContent)}</ram:Content></ram:IncludedNote>` : ''}
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    ${invoice.items.map((item, index) => {
      const category = taxCategoryCode(item.taxRate, isSmallBusiness);
      const exemption = taxExemptionReason(category);
      return `<ram:IncludedSupplyChainTradeLineItem><ram:AssociatedDocumentLineDocument><ram:LineID>${index + 1}</ram:LineID></ram:AssociatedDocumentLineDocument><ram:SpecifiedTradeProduct><ram:SellerAssignedID>ITEM-${index + 1}</ram:SellerAssignedID><ram:Name>${escapeXML(item.description)}</ram:Name><ram:Description>${escapeXML(item.description)}</ram:Description></ram:SpecifiedTradeProduct><ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${formatAmountForXML(item.unitPrice)}</ram:ChargeAmount><ram:BasisQuantity unitCode="C62">1</ram:BasisQuantity></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement><ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="C62">${formatAmountForXML(item.quantity)}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery><ram:SpecifiedLineTradeSettlement><ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${category}</ram:CategoryCode><ram:RateApplicablePercent>${formatAmountForXML(item.taxRate)}</ram:RateApplicablePercent>${exemption ? `<ram:ExemptionReason>${escapeXML(exemption)}</ram:ExemptionReason>` : ''}</ram:ApplicableTradeTax><ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${formatAmountForXML((item.quantity * item.unitPrice) - (item.discountAmount || 0))}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement></ram:IncludedSupplyChainTradeLineItem>`;
    }).join('')}
    <ram:ApplicableHeaderTradeAgreement>
      <ram:BuyerReference>${escapeXML(buyerReference)}</ram:BuyerReference>
      <ram:SellerTradeParty><ram:Name>${escapeXML(options.company.name)}</ram:Name><ram:SpecifiedLegalOrganization><ram:TradingBusinessName>${escapeXML(options.company.name)}</ram:TradingBusinessName></ram:SpecifiedLegalOrganization><ram:DefinedTradeContact><ram:PersonName>${escapeXML(options.company.name)}</ram:PersonName><ram:TelephoneUniversalCommunication><ram:CompleteNumber>${escapeXML(options.company.phone)}</ram:CompleteNumber></ram:TelephoneUniversalCommunication><ram:EmailURIUniversalCommunication><ram:URIID>${escapeXML(options.company.email)}</ram:URIID></ram:EmailURIUniversalCommunication></ram:DefinedTradeContact><ram:PostalTradeAddress><ram:PostcodeCode>${escapeXML(options.company.postalCode)}</ram:PostcodeCode><ram:LineOne>${escapeXML(options.company.address)}</ram:LineOne><ram:CityName>${escapeXML(options.company.city)}</ram:CityName><ram:CountryID>${countryCode(options.company.country)}</ram:CountryID></ram:PostalTradeAddress>${options.company.taxId ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${escapeXML(options.company.taxId)}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${escapeXML(options.company.email)}</ram:URIID></ram:URIUniversalCommunication></ram:SellerTradeParty>
      <ram:BuyerTradeParty><ram:Name>${escapeXML(options.customer.name)}</ram:Name><ram:PostalTradeAddress><ram:PostcodeCode>${escapeXML(options.customer.postalCode)}</ram:PostcodeCode><ram:LineOne>${escapeXML(options.customer.address)}${options.customer.addressSupplement ? `, ${escapeXML(options.customer.addressSupplement)}` : ''}</ram:LineOne><ram:CityName>${escapeXML(options.customer.city)}</ram:CityName><ram:CountryID>${countryCode(options.customer.country)}</ram:CountryID></ram:PostalTradeAddress>${options.customer.taxId ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${escapeXML(options.customer.taxId)}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${escapeXML(options.customer.email)}</ram:URIID></ram:URIUniversalCommunication></ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery><ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">${dateValue(invoice.issueDate)}</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent></ram:ApplicableHeaderTradeDelivery>
    <ram:ApplicableHeaderTradeSettlement><ram:InvoiceCurrencyCode>${currency}</ram:InvoiceCurrencyCode>${paymentMeans}
      ${Object.entries(taxBreakdown).sort(([a], [b]) => Number(a) - Number(b)).map(([rate, breakdown]) => { const category = taxCategoryCode(Number(rate), isSmallBusiness); const exemption = taxExemptionReason(category); return `<ram:ApplicableTradeTax><ram:CalculatedAmount>${formatAmountForXML(breakdown.taxAmount)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode><ram:BasisAmount>${formatAmountForXML(breakdown.taxableAmount)}</ram:BasisAmount><ram:CategoryCode>${category}</ram:CategoryCode><ram:RateApplicablePercent>${formatAmountForXML(Number(rate))}</ram:RateApplicablePercent>${exemption ? `<ram:ExemptionReason>${escapeXML(exemption)}</ram:ExemptionReason>` : ''}</ram:ApplicableTradeTax>`; }).join('')}
      ${paymentTermsXml}<ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:LineTotalAmount>${formatAmountForXML(invoice.subtotal)}</ram:LineTotalAmount><ram:TaxBasisTotalAmount>${formatAmountForXML(taxableAmount)}</ram:TaxBasisTotalAmount><ram:TaxTotalAmount currencyID="${currency}">${formatAmountForXML(invoice.taxAmount)}</ram:TaxTotalAmount><ram:GrandTotalAmount>${formatAmountForXML(invoice.total)}</ram:GrandTotalAmount><ram:DuePayableAmount>${formatAmountForXML(invoice.total)}</ram:DuePayableAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;
  assertEInvoiceXML(xml, 'ZUGFeRD');
  return xml;
}

export async function embedZUGFeRDXMLIntoPDF(pdfBuffer: ArrayBuffer, invoice: Invoice, options: PDFOptions): Promise<Blob> {
  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const xmlData = generateZUGFeRDXML(invoice, options);
    const xmlBytes = new TextEncoder().encode(xmlData);
    const documentLabel = invoice.documentType === 'credit_note' ? 'Gutschrift' : 'Rechnung';
    pdfDoc.setTitle(`${documentLabel} ${invoice.invoiceNumber}`);
    pdfDoc.setSubject(`ZUGFeRD ${documentLabel.toLowerCase()} ${invoice.invoiceNumber}`);
    pdfDoc.setKeywords(['ZUGFeRD', 'invoice', 'electronic invoice', 'EN 16931']);
    pdfDoc.setProducer('SoloOffice');
    pdfDoc.setCreator('SoloOffice');
    pdfDoc.setCreationDate(new Date());
    pdfDoc.setModificationDate(new Date());
    const xmp = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:RDF><rdf:Description xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" xmlns:zf="urn:ferd:pdfa:CrossIndustryDocument:invoice:1p0#" pdfaid:part="3" pdfaid:conformance="B" zf:DocumentType="INVOICE" zf:DocumentFileName="factur-x.xml" zf:Version="2.1" zf:ConformanceLevel="EN 16931"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
    const metadataStream = pdfDoc.context.stream(new TextEncoder().encode(xmp), { Type: 'Metadata', Subtype: 'XML' });
    pdfDoc.catalog.set(PDFName.of('Metadata'), pdfDoc.context.register(metadataStream));
    await pdfDoc.attach(xmlBytes, 'factur-x.xml', {
      mimeType: 'application/xml',
      description: 'ZUGFeRD factur-x.xml',
      creationDate: new Date(),
      modificationDate: new Date(),
      afRelationship: AFRelationship.Alternative,
    });
    const pdfBytes = await pdfDoc.save({ useObjectStreams: false, addDefaultPage: false, objectsPerTick: 50 });
    // BlobPart erwartet in aktuellen TypeScript-DOM-Typen ein ArrayBuffer,
    // während pdf-lib eine Uint8Array<ArrayBufferLike> liefert.
    const blobBuffer = pdfBytes.slice().buffer as ArrayBuffer;
    return new Blob([blobBuffer], { type: 'application/pdf' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('ZUGFeRD-PDF konnte nicht erzeugt werden', { error: message });
    throw new Error(`ZUGFeRD-PDF konnte nicht erzeugt werden: ${message}`, { cause: error });
  }
}
