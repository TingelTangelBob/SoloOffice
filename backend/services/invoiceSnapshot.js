import { mapCompanyRow } from '../utils/companyMapping.js';

// Enthält nur öffentliche Dokumentdaten, keine SMTP- oder Kontogeheimnisse.
export async function captureInvoiceSnapshot(client, customerId) {
  const companyResult = await client.query(`SELECT * FROM company
    WHERE workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid LIMIT 1`);
  const customerResult = await client.query('SELECT * FROM customers WHERE id = $1', [customerId]);
  const row = customerResult.rows[0];
  if (!companyResult.rows[0] || !row) {
    const error = new Error('Firma oder Kunde für die Rechnung wurde nicht gefunden.');
    error.statusCode = 400;
    throw error;
  }
  const company = mapCompanyRow(companyResult.rows[0]);
  // Artikelvorlagen gehören nicht zum ausgestellten Dokument.
  delete company.invoiceTemplates;
  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    company,
    customer: {
      id: row.id, customerNumber: row.customer_number, name: row.name,
      email: row.email, address: row.address, addressSupplement: row.address_supplement,
      city: row.city, postalCode: row.postal_code, country: row.country,
      phone: row.phone, taxId: row.tax_id, leitwegId: row.leitweg_id,
      isActive: row.is_active, createdAt: row.created_at,
    },
  };
}
