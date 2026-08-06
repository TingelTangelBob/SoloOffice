export function assertEInvoiceXML(xml: string, format: 'XRechnung' | 'ZUGFeRD') {
  if (!xml.trim()) throw new Error(`${format}-XML ist leer.`);
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) {
    throw new Error(`${format}-XML ist nicht wohlgeformt.`);
  }
  const rootName = document.documentElement?.localName;
  const expectedRoot = format === 'XRechnung' ? 'Invoice' : 'CrossIndustryInvoice';
  if (rootName !== expectedRoot) throw new Error(`${format}-XML hat kein erwartetes Wurzelelement.`);
  for (const tag of format === 'XRechnung' ? ['ID', 'IssueDate', 'DocumentCurrencyCode'] : ['ID', 'IssueDateTime', 'InvoiceCurrencyCode']) {
    if (!document.getElementsByTagNameNS('*', tag).length) {
      throw new Error(`${format}-XML enthält kein Pflichtfeld ${tag}.`);
    }
  }
}
