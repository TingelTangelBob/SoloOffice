import express from 'express';
import { createHash, randomUUID } from 'crypto';
import { pool, query } from '../database.js';
import logger from '../utils/logger.js';
import { hasPermission } from '../middleware/auth.js';
import { captureInvoiceSnapshot } from '../services/invoiceSnapshot.js';
import { lockDocumentNumber } from '../utils/documentNumberLock.js';
import {
  IMPORT_RESOURCES,
  MAX_IMPORT_CELL_LENGTH,
  MAX_IMPORT_ROWS,
  SETTINGS_IMPORT_RESOURCES,
  isApplicable,
  planImport,
  reportRows,
  summariseImport,
} from '../utils/importPlanner.js';
import { parseDate, text } from '../utils/importValues.js';

const router = express.Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ORIGINAL_DOCUMENT_BYTES = 10 * 1024 * 1024;
const ORIGINAL_DOCUMENT_TYPES = new Set(['application/pdf', 'application/xml', 'text/xml', 'image/png', 'image/jpeg']);

const TERMINOLOGY = {
  customers: { entityLabel: 'Kunde', workLabel: 'Auftrag' },
  mandants: { entityLabel: 'Mandant', workLabel: 'Mandat' },
  patients: { entityLabel: 'Patient', workLabel: 'Behandlung' },
  students: { entityLabel: 'Schüler / Träger', workLabel: 'Unterricht' },
  clients: { entityLabel: 'Klient', workLabel: 'Beratung' },
};

const RESOURCE_LABELS = {
  customers: 'Kunden', jobs: 'Aufträge', quotes: 'Angebote', positions: 'Positionsvorlagen',
  hourlyRates: 'Stundensätze', materials: 'Materialien', euerEntries: 'Einnahmen und Ausgaben',
  invoicePayments: 'Zahlungseingänge', invoices: 'Rechnungen',
};

const workspaceCondition = "workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid";

function httpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function sendError(res, error, fallback) {
  if (error.statusCode && error.statusCode < 500) {
    return res.status(error.statusCode).json({ error: error.message, ...(error.code ? { code: error.code } : {}), ...(error.details ? { details: error.details } : {}) });
  }
  logger.error(fallback, { error: error.message, stack: error.stack });
  return res.status(500).json({ error: fallback });
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

function takeoverDigest({ resource, rows, options, settings, file, context, plan }) {
  return createHash('sha256').update(JSON.stringify(stableValue({
    resource, rows, options, settings, file: { hash: file?.hash || null, headers: file?.headers || [], sheet: settings?.sheet || null }, context, plan,
  }))).digest('hex');
}

// node-postgres liefert DATE-Spalten als lokale Mitternacht. Die lokalen
// Bestandteile ergeben deshalb unabhängig von der Serverzeitzone das Datum.
const isoDate = value => {
  if (!value) return null;
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  return String(value).slice(0, 10);
};

// ---------------------------------------------------------------------------
// Bestand laden
// ---------------------------------------------------------------------------

async function loadCompany(client) {
  const result = await client.query(`
    SELECT id, terminology_profile, import_cutover_date, default_payment_days, invoice_templates, time_zone
    FROM company WHERE ${workspaceCondition} LIMIT 1
  `);
  return result.rows[0] || {};
}

async function loadCustomers(client) {
  const result = await client.query(`
    SELECT id, customer_number, name, email, address, address_supplement, city, postal_code, country,
           tax_id, leitweg_id, phone, notes, customer_type, is_active
    FROM customers ORDER BY name ASC
  `);
  return result.rows.map(row => ({
    id: row.id,
    customerNumber: row.customer_number,
    name: row.name,
    email: row.email || '',
    address: row.address || '',
    addressSupplement: row.address_supplement || '',
    city: row.city || '',
    postalCode: row.postal_code || '',
    country: row.country || '',
    taxId: row.tax_id || '',
    leitwegId: row.leitweg_id || '',
    phone: row.phone || '',
    notes: row.notes || '',
    customerType: row.customer_type || 'person',
    isActive: row.is_active !== false,
  }));
}

async function loadEuerEntries(client) {
  const result = await client.query(`
    SELECT e.id, e.entry_type, e.entry_date, e.description, e.amount, e.notes, e.source_type, e.source_id,
           e.external_reference, e.status, COALESCE(e.customer_id, i.customer_id) AS customer_id
    FROM euer_entries e
    LEFT JOIN invoices i ON e.source_type = 'invoice_payment' AND i.id = e.source_id
    WHERE e.status = 'active'
    ORDER BY e.entry_date, e.id
  `);
  return result.rows.map(row => ({
    id: row.id,
    entryType: row.entry_type,
    entryDate: isoDate(row.entry_date),
    description: row.description,
    amount: Number(row.amount),
    notes: row.notes || '',
    sourceType: row.source_type,
    sourceId: row.source_id,
    externalReference: row.external_reference,
    status: row.status,
    customerId: row.customer_id,
  }));
}

async function loadInvoices(client) {
  const result = await client.query(`
    SELECT i.id, i.invoice_number, i.customer_id, i.customer_name, i.issue_date, i.service_date,
           i.status, i.total, i.tax_amount, c.customer_number, c.email AS customer_email,
           COALESCE((SELECT array_agg(DISTINCT ijs.job_date ORDER BY ijs.job_date) FROM invoice_job_sources ijs WHERE ijs.invoice_id = i.id), ARRAY[]::date[]) AS job_dates,
           COALESCE((SELECT array_agg(DISTINCT ii.tax_rate ORDER BY ii.tax_rate) FROM invoice_items ii WHERE ii.invoice_id = i.id), ARRAY[]::numeric[]) AS item_tax_rates
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
    WHERE COALESCE(i.document_type, 'invoice') = 'invoice'
    ORDER BY i.issue_date, i.invoice_number, i.id
  `);
  return result.rows.map(row => ({
    id: row.id,
    invoiceNumber: row.invoice_number,
    documentType: 'invoice',
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerNumber: row.customer_number,
    customerEmail: row.customer_email,
    issueDate: isoDate(row.issue_date),
    serviceDate: isoDate(row.service_date),
    jobDates: (row.job_dates || []).map(isoDate),
    itemTaxRates: (row.item_tax_rates || []).map(Number),
    status: row.status,
    total: Number(row.total),
    taxAmount: Number(row.tax_amount),
  }));
}

async function loadContext(client, resource) {
  const company = await loadCompany(client);
  const labels = TERMINOLOGY[company.terminology_profile] || TERMINOLOGY.customers;
  const context = {
    ...labels,
    today: new Date().toISOString().slice(0, 10),
    cutoverDate: isoDate(company.import_cutover_date),
    defaultPaymentDays: Number.isInteger(company.default_payment_days) ? company.default_payment_days : 14,
    timeZone: company.time_zone || 'Europe/Berlin',
  };
  if (!SETTINGS_IMPORT_RESOURCES.includes(resource)) context.customers = await loadCustomers(client);
  if (resource === 'jobs') {
    const result = await client.query('SELECT id, job_number, external_job_number, customer_id, title, date, start_time FROM job_entries ORDER BY id');
    context.jobs = result.rows.map(row => ({
      id: row.id, jobNumber: row.job_number, externalJobNumber: row.external_job_number,
      customerId: row.customer_id, title: row.title, date: isoDate(row.date), startTime: row.start_time,
    }));
  }
  if (resource === 'quotes') {
    const result = await client.query('SELECT id, quote_number FROM quotes ORDER BY id');
    context.quotes = result.rows.map(row => ({ id: row.id, quoteNumber: row.quote_number }));
  }
  if (resource === 'hourlyRates' || resource === 'materials') {
    const table = resource === 'hourlyRates' ? 'hourly_rates' : 'material_templates';
    const result = await client.query(`SELECT id, name FROM ${table} ORDER BY name ASC`);
    context[resource] = result.rows;
  }
  if (resource === 'positions') {
    context.positionTemplates = Array.isArray(company.invoice_templates) ? company.invoice_templates : [];
  }
  if (['euerEntries', 'invoicePayments', 'invoices'].includes(resource)) {
    context.euerEntries = await loadEuerEntries(client);
    context.invoices = await loadInvoices(client);
  }
  return { context, company };
}

// ---------------------------------------------------------------------------
// Schreiben mit Protokoll für das Rückgängigmachen
// ---------------------------------------------------------------------------

function createTracker() {
  const items = [];
  return {
    items,
    track(tableName, recordId, action, oldData = null) {
      items.push({ tableName, recordId: String(recordId), action, oldData });
    },
  };
}

async function workspaceLock(client, name) {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('solooffice:' || $1 || ':' || COALESCE(NULLIF(current_setting('app.workspace_id', true), ''), 'global'), 0))",
    [name],
  );
}

// Wie beim Anlegen in der App: vierstellig mit führenden Nullen, fortlaufend
// nach der höchsten numerischen Kundennummer.
async function customerNumberAllocator(client) {
  await workspaceLock(client, 'customer-number');
  const result = await client.query('SELECT customer_number FROM customers');
  const used = new Set(result.rows.map(row => text(row.customer_number)));
  let highest = result.rows.reduce((max, row) => {
    const value = text(row.customer_number);
    return /^\d+$/.test(value) ? Math.max(max, Number.parseInt(value, 10)) : max;
  }, 0);
  const format = number => String(number).padStart(4, '0');
  return requested => {
    if (requested && !used.has(requested)) {
      used.add(requested);
      return requested;
    }
    do { highest += 1; } while (used.has(format(highest)) || used.has(String(highest)));
    used.add(format(highest));
    return format(highest);
  };
}

function parseEmailList(value) {
  if (Array.isArray(value)) return value.map(item => text(typeof item === 'object' ? item?.email || item?.address : item));
  const source = text(value);
  if (!source) return [];
  try {
    const parsed = JSON.parse(source);
    if (Array.isArray(parsed)) return parsed.map(item => text(typeof item === 'object' ? item?.email || item?.address : item));
  } catch {
    // Keine JSON-Liste: Trennzeichen auswerten.
  }
  return source.split(/[;,|]/).map(item => item.trim());
}

async function replaceCustomerEmails(client, customerId, value) {
  await client.query('DELETE FROM customer_emails WHERE customer_id = $1', [customerId]);
  for (const email of parseEmailList(value).filter(item => item.includes('@'))) {
    await client.query('INSERT INTO customer_emails (customer_id, email) VALUES ($1, $2) ON CONFLICT (customer_id, email) DO NOTHING', [customerId, email]);
  }
}

async function replaceCustomerPricing(client, customerId, data) {
  if (Object.prototype.hasOwnProperty.call(data, 'hourlyRates')) {
    await client.query('DELETE FROM customer_specific_hourly_rates WHERE customer_id = $1', [customerId]);
    for (const rate of Array.isArray(data.hourlyRates) ? data.hourlyRates : []) {
      const name = text(rate?.name || rate?.title);
      const value = Number(rate?.rate ?? rate?.hourlyRate);
      if (!name || !Number.isFinite(value) || value < 0) continue;
      await client.query(`
        INSERT INTO customer_specific_hourly_rates (customer_id, name, description, rate, tax_rate, is_default)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [customerId, name, text(rate?.description), value, Number(rate?.taxRate ?? rate?.tax_rate ?? 19), Boolean(rate?.isDefault ?? rate?.is_default)]);
    }
  }
  if (Object.prototype.hasOwnProperty.call(data, 'materials')) {
    await client.query('DELETE FROM customer_specific_materials WHERE customer_id = $1', [customerId]);
    for (const material of Array.isArray(data.materials) ? data.materials : []) {
      const name = text(material?.name || material?.title);
      const value = Number(material?.unitPrice ?? material?.unit_price ?? material?.price);
      if (!name || !Number.isFinite(value) || value < 0) continue;
      await client.query(`
        INSERT INTO customer_specific_materials (customer_id, name, description, unit_price, unit, tax_rate, is_default)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [customerId, name, text(material?.description), value, text(material?.unit) || 'Stück', Number(material?.taxRate ?? material?.tax_rate ?? 19), Boolean(material?.isDefault ?? material?.is_default)]);
    }
  }
}

const CUSTOMER_COLUMNS = {
  name: 'name', customerType: 'customer_type', email: 'email', address: 'address',
  addressSupplement: 'address_supplement', postalCode: 'postal_code', city: 'city', country: 'country',
  taxId: 'tax_id', leitwegId: 'leitweg_id', phone: 'phone', notes: 'notes', isActive: 'is_active',
};

async function insertCustomer(client, data, allocateNumber, tracker) {
  const customerNumber = allocateNumber(text(data.customerNumber) || null);
  const result = await client.query(`
    INSERT INTO customers (customer_number, name, customer_type, email, address, address_supplement, city, postal_code, country, tax_id, leitweg_id, phone, notes, is_active)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, COALESCE($14, TRUE))
    RETURNING id
  `, [
    customerNumber, data.name, data.customerType || 'person', data.email || null, data.address || '',
    data.addressSupplement || null, data.city || '', data.postalCode || '', data.country || 'Deutschland',
    data.taxId || null, data.leitwegId || null, data.phone || null, data.notes || null, data.isActive ?? null,
  ]);
  const id = result.rows[0].id;
  tracker.track('customers', id, 'created');
  if (data.additionalEmails !== undefined) await replaceCustomerEmails(client, id, data.additionalEmails);
  await replaceCustomerPricing(client, id, data);
  return id;
}

async function updateCustomer(client, entry, tracker) {
  const changes = entry.data;
  const keys = Object.keys(changes).filter(key => CUSTOMER_COLUMNS[key]);
  const previous = await client.query(`SELECT ${Object.values(CUSTOMER_COLUMNS).join(', ')} FROM customers WHERE id = $1 FOR UPDATE`, [entry.existingId]);
  if (previous.rows.length === 0) throw httpError(409, 'Ein zu aktualisierender Datensatz wurde zwischenzeitlich entfernt.');
  const oldData = Object.fromEntries(keys.map(key => [CUSTOMER_COLUMNS[key], previous.rows[0][CUSTOMER_COLUMNS[key]]]));
  if (changes.additionalEmails !== undefined) {
    const emails = await client.query('SELECT email FROM customer_emails WHERE customer_id = $1 ORDER BY email', [entry.existingId]);
    oldData.__emails = emails.rows.map(row => row.email);
  }
  if (changes.hourlyRates !== undefined) {
    const rates = await client.query('SELECT name, description, rate, tax_rate, is_default FROM customer_specific_hourly_rates WHERE customer_id = $1', [entry.existingId]);
    oldData.__hourlyRates = rates.rows;
  }
  if (changes.materials !== undefined) {
    const materials = await client.query('SELECT name, description, unit_price, unit, tax_rate, is_default FROM customer_specific_materials WHERE customer_id = $1', [entry.existingId]);
    oldData.__materials = materials.rows;
  }
  if (keys.length > 0) {
    const assignments = keys.map((key, index) => `${CUSTOMER_COLUMNS[key]} = $${index + 1}`);
    await client.query(`UPDATE customers SET ${assignments.join(', ')} WHERE id = $${keys.length + 1}`, [...keys.map(key => changes[key]), entry.existingId]);
  }
  if (changes.additionalEmails !== undefined) await replaceCustomerEmails(client, entry.existingId, changes.additionalEmails);
  await replaceCustomerPricing(client, entry.existingId, changes);
  tracker.track('customers', entry.existingId, 'updated', oldData);
}

async function createPlannedCustomers(client, plan, allocateNumber, tracker) {
  const ids = new Map();
  for (const customer of plan.newCustomers) {
    const id = await insertCustomer(client, {
      name: customer.name,
      customerNumber: customer.customerNumber,
      email: customer.email,
      customerType: 'person',
    }, allocateNumber, tracker);
    ids.set(customer.key, id);
  }
  return data => data?.customerId || (data?.customerKey ? ids.get(data.customerKey) : null) || null;
}

async function unsetDefaults(client, table, tracker) {
  const previous = await client.query(`UPDATE ${table} SET is_default = FALSE WHERE is_default = TRUE RETURNING id`);
  previous.rows.forEach(row => tracker.track(table, row.id, 'updated', { is_default: true }));
}

async function applyPriceItem(client, resource, entry, tracker) {
  const table = resource === 'hourlyRates' ? 'hourly_rates' : 'material_templates';
  const data = entry.data;
  if (data.isDefault) await unsetDefaults(client, table, tracker);
  const priceColumn = resource === 'hourlyRates' ? 'rate' : 'unit_price';
  const price = resource === 'hourlyRates' ? data.rate : data.unitPrice;
  if (entry.status === 'update') {
    const previous = await client.query(`SELECT name, description, ${priceColumn}, tax_rate, is_default${resource === 'materials' ? ', unit' : ''} FROM ${table} WHERE id = $1`, [entry.existingId]);
    tracker.track(table, entry.existingId, 'updated', previous.rows[0] || null);
    if (resource === 'hourlyRates') {
      await client.query('UPDATE hourly_rates SET name = $1, description = $2, rate = $3, tax_rate = $4, is_default = $5, updated_at = CURRENT_TIMESTAMP WHERE id = $6', [data.name, data.description || '', price, data.taxRate, data.isDefault, entry.existingId]);
    } else {
      await client.query('UPDATE material_templates SET name = $1, description = $2, unit_price = $3, unit = $4, tax_rate = $5, is_default = $6, updated_at = CURRENT_TIMESTAMP WHERE id = $7', [data.name, data.description || '', price, data.unit, data.taxRate, data.isDefault, entry.existingId]);
    }
    return;
  }
  const result = resource === 'hourlyRates'
    ? await client.query('INSERT INTO hourly_rates (name, description, rate, tax_rate, is_default) VALUES ($1, $2, $3, $4, $5) RETURNING id', [data.name, data.description || '', price, data.taxRate, data.isDefault])
    : await client.query('INSERT INTO material_templates (name, description, unit_price, unit, tax_rate, is_default) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id', [data.name, data.description || '', price, data.unit, data.taxRate, data.isDefault]);
  tracker.track(table, result.rows[0].id, 'created');
}

async function applyPositions(client, company, entries, tracker) {
  let templates = Array.isArray(company.invoice_templates) ? company.invoice_templates.map(template => ({ ...template })) : [];
  for (const entry of entries) {
    const data = entry.data;
    if (data.isDefault) {
      templates = templates.map(template => {
        if (!template.isDefault) return template;
        tracker.track('invoice_templates', template.id, 'updated', { ...template });
        return { ...template, isDefault: false };
      });
    }
    if (entry.status === 'update') {
      const current = templates.find(template => template.id === entry.existingId);
      if (current) tracker.track('invoice_templates', current.id, 'updated', { ...current });
      templates = templates.map(template => template.id === entry.existingId ? { ...template, ...data, updatedAt: new Date().toISOString() } : template);
    } else {
      const id = randomUUID();
      templates.push({ id, ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      tracker.track('invoice_templates', id, 'created');
    }
  }
  await client.query(`UPDATE company SET invoice_templates = $1 WHERE ${workspaceCondition}`, [JSON.stringify(templates)]);
}

function numberAllocator(existingNumbers, prefix) {
  const highest = new Map();
  const used = new Set(existingNumbers.map(number => text(number)));
  for (const number of used) {
    const match = number.match(new RegExp(`^${prefix}-(\\d{4})-(\\d+)$`));
    if (match) highest.set(match[1], Math.max(highest.get(match[1]) || 0, Number(match[2])));
  }
  return (requested, date) => {
    if (requested) {
      used.add(requested);
      return requested;
    }
    const year = String(date || new Date().toISOString()).slice(0, 4);
    let counter = highest.get(year) || 0;
    let number;
    do {
      counter += 1;
      number = `${prefix}-${year}-${String(counter).padStart(3, '0')}`;
    } while (used.has(number));
    highest.set(year, counter);
    used.add(number);
    return number;
  };
}

async function insertJobUnit(client, data, extra) {
  const result = await client.query(`
    INSERT INTO job_entries (
      job_number, external_job_number, customer_id, customer_address, location, time_zone, title, description, date,
      start_time, end_time, hours_worked, hourly_rate, hourly_rate_id, materials, status, notes, priority,
      recurrence_id, recurrence_index, recurrence_total
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
    RETURNING id
  `, [
    extra.jobNumber, data.externalJobNumber || null, extra.customerId, data.customerAddress || null, data.location || null,
    extra.timeZone, data.title, data.description, extra.date, data.startTime, data.endTime, data.hoursWorked,
    data.hourlyRate, data.hourlyRateId, JSON.stringify(data.materials || []), data.status, data.notes || null, data.priority,
    extra.recurrenceId || null, extra.recurrenceIndex || null, extra.recurrenceTotal || null,
  ]);
  const jobId = result.rows[0].id;
  const timeEntries = data.timeEntries?.length > 0
    ? data.timeEntries
    : data.hoursWorked > 0 || data.startTime || data.endTime
      ? [{ description: 'Arbeitszeit', startTime: data.startTime, endTime: data.endTime, hoursWorked: data.hoursWorked, hourlyRate: data.hourlyRate, hourlyRateId: data.hourlyRateId, taxRate: data.taxRate ?? 19, total: Math.round(data.hoursWorked * data.hourlyRate * 100) / 100 }]
      : [];
  for (const timeEntry of timeEntries) {
    await client.query(`
      INSERT INTO job_time_entries (job_id, description, start_time, end_time, hours_worked, hourly_rate, hourly_rate_id, tax_rate, total)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [jobId, timeEntry.description || '', timeEntry.startTime || null, timeEntry.endTime || null, timeEntry.hoursWorked || 0, timeEntry.hourlyRate || 0, timeEntry.hourlyRateId || null, timeEntry.taxRate ?? 19, timeEntry.total || 0]);
  }
  return jobId;
}

async function applyJobs(client, entries, customerIdFor, company, tracker) {
  const years = new Set(entries.flatMap(entry => (entry.data.occurrenceDates || [entry.data.date]).map(date => Number(date.slice(0, 4)))));
  for (const year of [...years].sort((left, right) => left - right)) await lockDocumentNumber(client, 'job', year);
  const existing = await client.query('SELECT job_number FROM job_entries');
  const allocate = numberAllocator(existing.rows.map(row => row.job_number), 'AB');
  for (const entry of entries) {
    const data = entry.data;
    const customerId = customerIdFor(data);
    const timeZone = company.time_zone || 'Europe/Berlin';
    if (data.recurrence) {
      const recurrence = await client.query('INSERT INTO job_recurrences (rule) VALUES ($1) RETURNING id', [JSON.stringify(data.recurrence)]);
      const recurrenceId = recurrence.rows[0].id;
      tracker.track('job_recurrences', recurrenceId, 'created');
      for (const [index, date] of data.occurrenceDates.entries()) {
        const id = await insertJobUnit(client, data, {
          jobNumber: allocate(index === 0 ? data.jobNumber : null, date), customerId, timeZone, date,
          recurrenceId, recurrenceIndex: index + 1, recurrenceTotal: data.occurrenceDates.length,
        });
        tracker.track('job_entries', id, 'created');
      }
      continue;
    }
    const id = await insertJobUnit(client, data, { jobNumber: allocate(data.jobNumber, data.date), customerId, timeZone, date: data.date });
    tracker.track('job_entries', id, 'created');
  }
}

async function applyQuotes(client, entries, customerIdFor, tracker) {
  const years = new Set(entries.map(entry => Number(entry.data.issueDate.slice(0, 4))));
  for (const year of [...years].sort((left, right) => left - right)) await lockDocumentNumber(client, 'quote', year);
  const existing = await client.query('SELECT quote_number FROM quotes');
  const allocate = numberAllocator(existing.rows.map(row => row.quote_number), 'AN');
  for (const entry of entries) {
    const data = entry.data;
    const result = await client.query(`
      INSERT INTO quotes (quote_number, customer_id, customer_name, issue_date, valid_until, subtotal, tax_amount, total, status, notes, global_discount_type, global_discount_value, global_discount_amount)
      SELECT $1, c.id, c.name, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
      FROM customers c WHERE c.id = $2
      RETURNING id
    `, [allocate(data.quoteNumber, data.issueDate), customerIdFor(data), data.issueDate, data.validUntil, data.subtotal, data.taxAmount, data.total, data.status, data.notes || null, data.globalDiscountType, data.globalDiscountValue, data.globalDiscountAmount]);
    if (result.rows.length === 0) throw httpError(409, 'Ein Kunde für ein Angebot wurde zwischenzeitlich entfernt.');
    const quoteId = result.rows[0].id;
    tracker.track('quotes', quoteId, 'created');
    for (const item of data.items) {
      await client.query(`
        INSERT INTO quote_items (quote_id, description, quantity, unit_price, tax_rate, total, item_order, discount_type, discount_value, discount_amount)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [quoteId, item.description, item.quantity, item.unitPrice, item.taxRate, item.total, item.order, item.discountType || null, item.discountValue ?? null, item.discountAmount ?? null]);
    }
  }
}

async function insertEuerEntry(client, values, tracker) {
  const result = await client.query(`
    INSERT INTO euer_entries (
      entry_type, entry_date, description, category, amount, tax_rate, notes,
      source_type, source_id, external_reference, customer_id, status, correction_reason
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active', NULL)
    RETURNING id
  `, [
    values.entryType, values.entryDate, values.description, values.category, values.amount, values.taxRate,
    values.notes || null, values.sourceType, values.sourceId || null, values.externalReference || null, values.customerId || null,
  ]);
  tracker.track('euer_entries', result.rows[0].id, 'created');
  return result.rows[0].id;
}

async function syncInvoiceStatuses(client, invoiceIds) {
  if (invoiceIds.length === 0) return;
  await client.query(`
    UPDATE invoices i
    SET status = CASE
      WHEN COALESCE((SELECT SUM(ee.amount) FROM euer_entries ee
        WHERE ee.source_type = 'invoice_payment' AND ee.source_id = i.id AND ee.status = 'active'), 0) >= i.total - 0.005
        THEN 'paid'
      WHEN i.status = 'paid' AND i.due_date < CURRENT_DATE THEN 'overdue'
      WHEN i.status = 'paid' THEN 'sent'
      ELSE i.status
    END
    WHERE i.id = ANY($1::uuid[]) AND COALESCE(i.document_type, 'invoice') = 'invoice' AND i.status <> 'draft'
  `, [invoiceIds]);
}

// Übernommene Buchungen verweisen auf ihre Quelle, damit sie nachvollziehbar bleiben.
function importNote(data, entry, source) {
  if (data.notes) return data.notes;
  return `Datenübernahme: ${source.fileName || 'Import'}, Zeile ${entry.rowNumbers.join(', ')}`.slice(0, 500);
}

async function applyMoneyEntries(client, entries, customerIdFor, tracker, source) {
  const invoiceIds = new Set();
  for (const entry of entries) {
    const data = entry.data;
    if (data.kind === 'payment') {
      await insertEuerEntry(client, {
        entryType: 'income', entryDate: data.entryDate, description: `Zahlung Rechnung ${data.invoiceNumber}`,
        category: 'other_income', amount: data.amount, taxRate: data.taxRate, notes: importNote(data, entry, source),
        sourceType: 'invoice_payment', sourceId: data.invoiceId, externalReference: data.externalReference,
      }, tracker);
      invoiceIds.add(data.invoiceId);
      continue;
    }
    await insertEuerEntry(client, {
      entryType: data.entryType, entryDate: data.entryDate, description: data.description, category: data.category,
      amount: data.amount, taxRate: data.taxRate, notes: importNote(data, entry, source), sourceType: 'manual',
      externalReference: data.externalReference, customerId: data.entryType === 'income' ? customerIdFor(data) : null,
    }, tracker);
  }
  await syncInvoiceStatuses(client, [...invoiceIds]);
}

async function applyInvoices(client, entries, customerIdFor, tracker, source) {
  for (const entry of entries) {
    const data = entry.data;
    const customerId = customerIdFor(data);
    const duplicate = await client.query('SELECT 1 FROM invoices WHERE invoice_number = $1 LIMIT 1', [data.invoiceNumber]);
    if (duplicate.rows.length > 0) throw httpError(409, `Die Rechnungsnummer „${data.invoiceNumber}“ wurde zwischenzeitlich vergeben.`);
    const snapshot = await captureInvoiceSnapshot(client, customerId);
    const result = await client.query(`
      INSERT INTO invoices (invoice_number, document_type, origin, customer_id, customer_name, issue_date, due_date, service_date,
                            subtotal, tax_amount, total, status, notes, global_discount_type, global_discount_value, global_discount_amount, document_snapshot)
      VALUES ($1, 'invoice', 'imported', $2, $3, $4, $5, $6, $7, $8, $9, 'draft', $10, NULL, NULL, 0, $11)
      RETURNING id
    `, [data.invoiceNumber, customerId, snapshot.customer.name, data.issueDate, data.dueDate, data.serviceDate || null,
      data.subtotal, data.taxAmount, data.total, data.notes || null, JSON.stringify(snapshot)]);
    const invoiceId = result.rows[0].id;
    tracker.track('invoices', invoiceId, 'created');
    for (const item of data.items) {
      await client.query(`
        INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, tax_rate, total, item_order, discount_type, discount_value, discount_amount)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [invoiceId, item.description, item.quantity, item.unitPrice, item.taxRate, item.total, item.order, item.discountType || null, item.discountValue ?? null, item.discountAmount ?? 0]);
    }
    // Erst nach den Positionen ausstellen: Danach ist die Rechnung unveränderbar.
    await client.query('UPDATE invoices SET status = $1 WHERE id = $2', [data.status, invoiceId]);
    if (data.payment) {
      await insertEuerEntry(client, {
        entryType: 'income', entryDate: data.payment.entryDate, description: `Zahlung Rechnung ${data.invoiceNumber}`,
        category: 'other_income', amount: data.payment.amount, taxRate: data.payment.taxRate,
        notes: importNote({}, entry, source), sourceType: 'invoice_payment', sourceId: invoiceId,
      }, tracker);
    }
  }
}

async function applyPlan(client, resource, plan, company, source = {}) {
  const tracker = createTracker();
  const entries = plan.entries.filter(isApplicable);
  const needsCustomers = plan.newCustomers.length > 0 || resource === 'customers';
  const allocateNumber = needsCustomers ? await customerNumberAllocator(client) : null;
  const customerIdFor = await createPlannedCustomers(client, plan, allocateNumber, tracker);
  if (resource === 'customers') {
    for (const entry of entries) {
      if (entry.status === 'update') await updateCustomer(client, entry, tracker);
      else await insertCustomer(client, entry.data, allocateNumber, tracker);
    }
  } else if (resource === 'hourlyRates' || resource === 'materials') {
    for (const entry of entries) await applyPriceItem(client, resource, entry, tracker);
  } else if (resource === 'positions') {
    await applyPositions(client, company, entries, tracker);
  } else if (resource === 'jobs') {
    await applyJobs(client, entries, customerIdFor, company, tracker);
  } else if (resource === 'quotes') {
    await applyQuotes(client, entries, customerIdFor, tracker);
  } else if (resource === 'euerEntries' || resource === 'invoicePayments') {
    await applyMoneyEntries(client, entries, customerIdFor, tracker, source);
  } else if (resource === 'invoices') {
    await applyInvoices(client, entries, customerIdFor, tracker, source);
  }
  return tracker.items;
}

// ---------------------------------------------------------------------------
// Importläufe
// ---------------------------------------------------------------------------

function sanitizeSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const json = JSON.stringify(value);
  return json.length > 50000 ? {} : JSON.parse(json);
}

async function saveRun(client, { resource, file, settings, summary, report, items, userId, sessionId = null, categoryId = null }) {
  const headers = Array.isArray(file?.headers) ? file.headers.slice(0, 300).map(header => text(header).slice(0, 200)) : [];
  const result = await client.query(`
    INSERT INTO import_runs (resource, file_name, file_hash, source_headers, settings, summary, report, created_by, migration_session_id, migration_category_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING id
  `, [
    resource,
    text(file?.name).slice(0, 255) || null,
    /^[0-9a-f]{64}$/i.test(text(file?.hash)) ? text(file.hash).toLowerCase() : null,
    JSON.stringify(headers),
    JSON.stringify(sanitizeSettings(settings)),
    JSON.stringify(summary),
    JSON.stringify(report),
    userId || null,
    sessionId,
    categoryId,
  ]);
  const runId = result.rows[0].id;
  for (let offset = 0; offset < items.length; offset += 500) {
    const chunk = items.slice(offset, offset + 500);
    const values = [];
    const placeholders = chunk.map((item, index) => {
      const base = index * 6;
      values.push(runId, offset + index + 1, item.tableName, item.recordId, item.action, item.oldData ? JSON.stringify(item.oldData) : null);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
    });
    await client.query(`INSERT INTO import_run_items (run_id, seq, table_name, record_id, action, old_data) VALUES ${placeholders.join(', ')}`, values);
  }
  return runId;
}

function mapRun(row, { includeReport = false } = {}) {
  return {
    id: row.id,
    resource: row.resource,
    resourceLabel: RESOURCE_LABELS[row.resource] || row.resource,
    fileName: row.file_name || '',
    fileHash: row.file_hash || null,
    sourceHeaders: row.source_headers || [],
    settings: row.settings || {},
    summary: row.summary || {},
    status: row.status,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
    revertedAt: row.reverted_at,
    createdByName: row.created_by_name || null,
    migrationSessionId: row.migration_session_id || null,
    migrationCategoryId: row.migration_category_id || null,
    ...(includeReport ? { report: row.report || [] } : {}),
  };
}

const runSelect = `
  SELECT r.id, r.resource, r.file_name, r.file_hash, r.source_headers, r.settings, r.summary, r.status,
         r.migration_session_id, r.migration_category_id,
         r.created_at, r.confirmed_at, r.reverted_at,
         NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), '') AS created_by_name
`;

router.get('/runs', async (req, res) => {
  try {
    const result = await query(`${runSelect} FROM import_runs r LEFT JOIN users u ON u.id = r.created_by ORDER BY r.created_at DESC LIMIT 200`);
    res.json(result.rows.map(row => mapRun(row)));
  } catch (error) {
    sendError(res, error, 'Die Importläufe konnten nicht geladen werden.');
  }
});

router.get('/runs/:id', async (req, res) => {
  try {
    if (!UUID_PATTERN.test(req.params.id)) return res.status(400).json({ error: 'Ungültige Import-ID.' });
    const result = await query(`${runSelect}, r.report FROM import_runs r LEFT JOIN users u ON u.id = r.created_by WHERE r.id = $1`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Import nicht gefunden.' });
    res.json(mapRun(result.rows[0], { includeReport: true }));
  } catch (error) {
    sendError(res, error, 'Der Import konnte nicht geladen werden.');
  }
});

async function lockPendingRun(client, runId, auth) {
  const result = await client.query('SELECT id, resource, status, migration_category_id, migration_session_id FROM import_runs WHERE id = $1 FOR UPDATE', [runId]);
  const run = result.rows[0];
  if (!run) throw httpError(404, 'Import nicht gefunden.');
  if (SETTINGS_IMPORT_RESOURCES.includes(run.resource) && !hasPermission(auth, 'workspace.settings')) {
    throw httpError(403, 'Nur Administratoren dürfen Stammdaten-Importe ändern.', 'FORBIDDEN');
  }
  if (run.status !== 'pending') {
    throw httpError(409, run.status === 'reverted' ? 'Dieser Import wurde bereits rückgängig gemacht.' : 'Dieser Import ist abgeschlossen und kann nicht mehr rückgängig gemacht werden.');
  }
  return run;
}

async function findRevertBlockers(client, itemsByTable, runRecordIds) {
  const blockers = [];
  const ownIds = [...runRecordIds];
  const created = table => itemsByTable.get(`${table}:created`) || [];
  const customerIds = created('customers');
  if (customerIds.length > 0) {
    const result = await client.query(`
      SELECT c.name FROM customers c
      WHERE c.id = ANY($1::uuid[]) AND (
        EXISTS (SELECT 1 FROM invoices i WHERE i.customer_id = c.id AND NOT (i.id::text = ANY($2::text[])))
        OR EXISTS (SELECT 1 FROM quotes q WHERE q.customer_id = c.id AND NOT (q.id::text = ANY($2::text[])))
        OR EXISTS (SELECT 1 FROM job_entries j WHERE j.customer_id = c.id AND NOT (j.id::text = ANY($2::text[])))
        OR EXISTS (SELECT 1 FROM recurring_invoices r WHERE r.customer_id = c.id)
        OR EXISTS (SELECT 1 FROM euer_entries e WHERE e.customer_id = c.id AND e.status = 'active' AND NOT (e.id::text = ANY($2::text[])))
      )
      ORDER BY c.name LIMIT 10
    `, [customerIds, ownIds]);
    if (result.rows.length > 0) blockers.push(`Für ${result.rows.map(row => `„${row.name}“`).join(', ')} gibt es inzwischen weitere Dokumente oder Buchungen`);
  }
  const invoiceIds = created('invoices');
  if (invoiceIds.length > 0) {
    const result = await client.query(`
      SELECT DISTINCT i.invoice_number FROM invoices i
      WHERE i.id = ANY($1::uuid[]) AND (
        EXISTS (SELECT 1 FROM euer_entries e WHERE e.source_type = 'invoice_payment' AND e.source_id = i.id AND e.status = 'active' AND NOT (e.id::text = ANY($2::text[])))
        OR EXISTS (SELECT 1 FROM invoices credit WHERE credit.reference_invoice_id = i.id)
        OR EXISTS (SELECT 1 FROM invoice_job_sources ijs WHERE ijs.invoice_id = i.id)
        OR i.last_reminder_sent_at IS NOT NULL
      )
      ORDER BY i.invoice_number LIMIT 10
    `, [invoiceIds, ownIds]);
    if (result.rows.length > 0) blockers.push(`Zu ${result.rows.map(row => row.invoice_number).join(', ')} wurden inzwischen Zahlungen, Gutschriften oder Mahnungen erfasst`);
  }
  const jobIds = created('job_entries');
  if (jobIds.length > 0) {
    const result = await client.query('SELECT COUNT(*)::int AS count FROM invoice_job_sources WHERE job_id = ANY($1::uuid[])', [jobIds]);
    if (result.rows[0].count > 0) blockers.push(`${result.rows[0].count} importierte Termine wurden inzwischen abgerechnet`);
  }
  const quoteIds = created('quotes');
  if (quoteIds.length > 0) {
    const result = await client.query('SELECT COUNT(*)::int AS count FROM quotes WHERE id = ANY($1::uuid[]) AND converted_to_invoice_id IS NOT NULL', [quoteIds]);
    if (result.rows[0].count > 0) blockers.push(`${result.rows[0].count} importierte Angebote wurden inzwischen in Rechnungen umgewandelt`);
  }
  return blockers;
}

async function restoreCustomer(client, recordId, oldData) {
  const columns = Object.keys(oldData).filter(key => !key.startsWith('__') && Object.values(CUSTOMER_COLUMNS).includes(key));
  if (columns.length > 0) {
    await client.query(`UPDATE customers SET ${columns.map((column, index) => `${column} = $${index + 1}`).join(', ')} WHERE id = $${columns.length + 1}`, [...columns.map(column => oldData[column]), recordId]);
  }
  if (oldData.__emails) await replaceCustomerEmails(client, recordId, oldData.__emails);
  const pricing = {};
  if (oldData.__hourlyRates) pricing.hourlyRates = oldData.__hourlyRates;
  if (oldData.__materials) pricing.materials = oldData.__materials;
  await replaceCustomerPricing(client, recordId, pricing);
}

async function revertRun(client, runId, auth) {
  const run = await lockPendingRun(client, runId, auth);
  const itemResult = await client.query('SELECT table_name, record_id, action, old_data FROM import_run_items WHERE run_id = $1 ORDER BY seq DESC', [runId]);
  const items = itemResult.rows;
  const itemsByTable = new Map();
  const runRecordIds = new Set();
  for (const item of items) {
    const key = `${item.table_name}:${item.action}`;
    itemsByTable.set(key, [...(itemsByTable.get(key) || []), item.record_id]);
    if (item.action === 'created') runRecordIds.add(item.record_id);
  }
  const blockers = await findRevertBlockers(client, itemsByTable, runRecordIds);
  if (blockers.length > 0) {
    const error = httpError(409, `Der Import kann nicht mehr rückgängig gemacht werden: ${blockers.join('. ')}. Machen Sie gegebenenfalls zuerst spätere Importe rückgängig.`, 'IMPORT_REVERT_BLOCKED');
    error.details = blockers;
    throw error;
  }

  await client.query("SELECT set_config('app.import_revert', 'true', true)");
  const touchedInvoices = new Set();
  const templateChanges = [];
  for (const item of items) {
    const { table_name: table, record_id: id, action, old_data: oldData } = item;
    if (table === 'invoice_templates') {
      templateChanges.push(item);
      continue;
    }
    if (action === 'created') {
      if (table === 'euer_entries') {
        const voided = await client.query(`
          UPDATE euer_entries SET status = 'voided', correction_reason = 'Import rückgängig gemacht', updated_at = NOW()
          WHERE id = $1 AND status = 'active'
          RETURNING source_type, source_id
        `, [id]);
        if (voided.rows[0]?.source_type === 'invoice_payment' && voided.rows[0].source_id) touchedInvoices.add(voided.rows[0].source_id);
      } else if (['invoices', 'job_entries', 'job_recurrences', 'quotes', 'customers', 'hourly_rates', 'material_templates'].includes(table)) {
        if (table === 'invoices') touchedInvoices.delete(id);
        await client.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
      }
    } else if (action === 'updated' && oldData) {
      if (table === 'customers') await restoreCustomer(client, id, oldData);
      else if (table === 'hourly_rates' || table === 'material_templates') {
        const columns = Object.keys(oldData).filter(column => /^[a-z_]+$/.test(column));
        if (columns.length > 0) {
          await client.query(`UPDATE ${table} SET ${columns.map((column, index) => `${column} = $${index + 1}`).join(', ')} WHERE id = $${columns.length + 1}`, [...columns.map(column => oldData[column]), id]);
        }
      }
    }
  }
  if (templateChanges.length > 0) {
    const company = await loadCompany(client);
    let templates = Array.isArray(company.invoice_templates) ? company.invoice_templates : [];
    for (const item of templateChanges) {
      if (item.action === 'created') templates = templates.filter(template => String(template.id) !== item.record_id);
      else if (item.old_data) templates = templates.map(template => String(template.id) === item.record_id ? item.old_data : template);
    }
    await client.query(`UPDATE company SET invoice_templates = $1 WHERE ${workspaceCondition}`, [JSON.stringify(templates)]);
  }
  await syncInvoiceStatuses(client, [...touchedInvoices]);
  await client.query("UPDATE import_runs SET status = 'reverted', reverted_at = NOW() WHERE id = $1", [runId]);
  if (run.migration_category_id) {
    await client.query(`
      UPDATE migration_categories
      SET status = 'open', preview_digest = NULL, idempotency_key = NULL,
          completed_at = NULL, updated_at = NOW()
      WHERE id = $1 AND status = 'completed'
    `, [run.migration_category_id]);
    if (run.migration_session_id) await client.query('UPDATE migration_sessions SET progress_revision = progress_revision + 1, updated_at = NOW() WHERE id = $1 AND status = \'open\'', [run.migration_session_id]);
  }
}

router.post('/runs/:id/revert', async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) return res.status(400).json({ error: 'Ungültige Import-ID.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await revertRun(client, req.params.id, req.auth);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    sendError(res, error, 'Der Import konnte nicht rückgängig gemacht werden.');
  } finally {
    client.release();
  }
});

router.post('/runs/confirm-all', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pending = await client.query('SELECT resource FROM import_runs WHERE status = \'pending\' FOR UPDATE');
    if (pending.rows.some(row => SETTINGS_IMPORT_RESOURCES.includes(row.resource))
      && !hasPermission(req.auth, 'workspace.settings')) {
      throw httpError(403, 'Nur Administratoren dürfen Stammdaten-Importe abschließen.', 'FORBIDDEN');
    }
    const result = await client.query("UPDATE import_runs SET status = 'confirmed', confirmed_at = NOW() WHERE status = 'pending' RETURNING id");
    await client.query('COMMIT');
    res.json({ confirmed: result.rows.length });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    sendError(res, error, 'Der Umzug konnte nicht abgeschlossen werden.');
  } finally {
    client.release();
  }
});

router.post('/runs/:id/confirm', async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) return res.status(400).json({ error: 'Ungültige Import-ID.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockPendingRun(client, req.params.id, req.auth);
    await client.query("UPDATE import_runs SET status = 'confirmed', confirmed_at = NOW() WHERE id = $1", [req.params.id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    sendError(res, error, 'Der Import konnte nicht abgeschlossen werden.');
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// Stichtag des Umzugs
// ---------------------------------------------------------------------------

router.get('/settings', async (req, res) => {
  try {
    const result = await query(`SELECT import_cutover_date FROM company WHERE ${workspaceCondition} LIMIT 1`);
    const pending = await query("SELECT COUNT(*)::int AS count FROM import_runs WHERE status = 'pending'");
    res.json({ cutoverDate: isoDate(result.rows[0]?.import_cutover_date), pendingRuns: pending.rows[0].count });
  } catch (error) {
    sendError(res, error, 'Die Einstellungen der Datenübernahme konnten nicht geladen werden.');
  }
});

router.put('/settings', async (req, res) => {
  if (!hasPermission(req.auth, 'workspace.settings')) return res.status(403).json({ error: 'Nur Administratoren dürfen den Stichtag festlegen.', code: 'FORBIDDEN' });
  const raw = req.body?.cutoverDate;
  const cutoverDate = raw === null || raw === '' || raw === undefined ? null : parseDate(raw);
  if (raw && !cutoverDate) return res.status(400).json({ error: 'Der Stichtag ist ungültig.' });
  try {
    await query(`UPDATE company SET import_cutover_date = $1 WHERE ${workspaceCondition}`, [cutoverDate]);
    res.json({ cutoverDate });
  } catch (error) {
    sendError(res, error, 'Der Stichtag konnte nicht gespeichert werden.');
  }
});

// ---------------------------------------------------------------------------
// Originaldokumente übernommener Rechnungen
// ---------------------------------------------------------------------------

async function findImportedInvoice(client, invoiceId) {
  const result = await client.query(`
    SELECT i.id, i.invoice_number, i.origin,
      EXISTS (
        SELECT 1 FROM import_run_items item JOIN import_runs run ON run.id = item.run_id
        WHERE item.table_name = 'invoices' AND item.record_id = i.id::text AND run.status = 'pending'
      ) AS import_pending
    FROM invoices i WHERE i.id = $1
  `, [invoiceId]);
  const invoice = result.rows[0];
  if (!invoice) throw httpError(404, 'Rechnung nicht gefunden.');
  if (invoice.origin !== 'imported') throw httpError(409, 'Originaldokumente können nur für übernommene Rechnungen hinterlegt werden.');
  return invoice;
}

router.get('/original-documents/:invoiceId', async (req, res) => {
  if (!UUID_PATTERN.test(req.params.invoiceId)) return res.status(400).json({ error: 'Ungültige Rechnungs-ID.' });
  try {
    const result = await query('SELECT name, content, content_type, size, sha256, uploaded_at FROM invoice_original_documents WHERE invoice_id = $1', [req.params.invoiceId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Für diese Rechnung ist kein Original hinterlegt.' });
    const row = result.rows[0];
    res.json({ name: row.name, content: row.content, contentType: row.content_type, size: row.size, sha256: row.sha256, uploadedAt: row.uploaded_at });
  } catch (error) {
    sendError(res, error, 'Das Original konnte nicht geladen werden.');
  }
});

function validateOriginalDocument(body) {
  const name = text(body?.name).slice(0, 255);
  const contentType = text(body?.contentType).toLowerCase();
  const content = text(body?.content).replace(/^data:[^,]*,/, '');
  if (!name) throw httpError(400, 'Der Dateiname fehlt.');
  if (!ORIGINAL_DOCUMENT_TYPES.has(contentType)) throw httpError(400, 'Erlaubt sind PDF, XML, PNG und JPEG.');
  if (!content || !/^[A-Za-z0-9+/]+={0,2}$/.test(content)) throw httpError(400, 'Der Dateiinhalt ist ungültig.');
  const buffer = Buffer.from(content, 'base64');
  if (buffer.length === 0 || buffer.length > MAX_ORIGINAL_DOCUMENT_BYTES) throw httpError(413, 'Das Original darf höchstens 10 MB groß sein.');
  if (contentType === 'application/pdf' && buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw httpError(400, 'Die Datei ist kein gültiges PDF.');
  if (contentType.endsWith('/xml') && !/^\s*(\uFEFF)?</.test(buffer.subarray(0, 64).toString('utf8'))) throw httpError(400, 'Die Datei ist kein gültiges XML.');
  return { name, contentType, content, size: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') };
}

router.put('/original-documents/:invoiceId', async (req, res) => {
  if (!UUID_PATTERN.test(req.params.invoiceId)) return res.status(400).json({ error: 'Ungültige Rechnungs-ID.' });
  const client = await pool.connect();
  try {
    const document = validateOriginalDocument(req.body);
    await client.query('BEGIN');
    const invoice = await findImportedInvoice(client, req.params.invoiceId);
    const existing = await client.query('SELECT id FROM invoice_original_documents WHERE invoice_id = $1 FOR UPDATE', [invoice.id]);
    // Nach Abschluss des Umzugs ist ein hinterlegtes Original unveränderbar.
    if (existing.rows.length > 0 && !invoice.import_pending) {
      throw httpError(409, 'Für diese Rechnung ist bereits ein Original hinterlegt. Es kann nach Abschluss des Umzugs nicht mehr ersetzt werden.');
    }
    if (existing.rows.length > 0) await client.query('DELETE FROM invoice_original_documents WHERE invoice_id = $1', [invoice.id]);
    await client.query(`
      INSERT INTO invoice_original_documents (invoice_id, name, content, content_type, size, sha256)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [invoice.id, document.name, document.content, document.contentType, document.size, document.sha256]);
    await client.query('COMMIT');
    res.json({ name: document.name, contentType: document.contentType, size: document.size, sha256: document.sha256 });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    sendError(res, error, 'Das Original konnte nicht gespeichert werden.');
  } finally {
    client.release();
  }
});

router.delete('/original-documents/:invoiceId', async (req, res) => {
  if (!UUID_PATTERN.test(req.params.invoiceId)) return res.status(400).json({ error: 'Ungültige Rechnungs-ID.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const invoice = await findImportedInvoice(client, req.params.invoiceId);
    if (!invoice.import_pending) throw httpError(409, 'Nach Abschluss des Umzugs kann das Original nicht mehr entfernt werden.');
    await client.query('DELETE FROM invoice_original_documents WHERE invoice_id = $1', [invoice.id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    sendError(res, error, 'Das Original konnte nicht entfernt werden.');
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// Vorschau und Übernahme
// ---------------------------------------------------------------------------

router.post('/:resource', async (req, res) => {
  const { resource } = req.params;
  if (!IMPORT_RESOURCES.includes(resource)) return res.status(400).json({ error: 'Nicht unterstütztes Importziel.' });
  if (SETTINGS_IMPORT_RESOURCES.includes(resource) && !hasPermission(req.auth, 'workspace.settings')) {
    return res.status(403).json({ error: 'Nur Administratoren dürfen Stammdaten importieren', code: 'FORBIDDEN' });
  }
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (rows.length === 0) return res.status(400).json({ error: 'Es wurden keine Importzeilen übergeben.' });
  if (rows.length > MAX_IMPORT_ROWS) return res.status(413).json({ error: `Es dürfen höchstens ${MAX_IMPORT_ROWS.toLocaleString('de-DE')} Zeilen auf einmal importiert werden. Bitte die Datei aufteilen.` });
  if (rows.some(row => !row || typeof row !== 'object' || Array.isArray(row) || Object.values(row).some(value => text(value).length > MAX_IMPORT_CELL_LENGTH))) {
    return res.status(413).json({ error: 'Eine Importzelle ist zu groß oder die Importzeilen haben ein ungültiges Format.' });
  }
  const dryRun = req.body?.dryRun !== false;
  const options = {
    duplicateMode: req.body?.duplicateMode === 'update' ? 'update' : 'skip',
    createMissingCustomers: req.body?.createMissingCustomers === true,
    matchOpenInvoices: req.body?.matchOpenInvoices !== false,
  };
  const takeover = req.body?.takeover && typeof req.body.takeover === 'object' ? req.body.takeover : null;
  if (takeover && (!UUID_PATTERN.test(String(takeover.sessionId || ''))
    || (takeover.categoryId != null && !UUID_PATTERN.test(String(takeover.categoryId)))
    || (takeover.idempotencyKey != null && !UUID_PATTERN.test(String(takeover.idempotencyKey))))) {
    return res.status(400).json({ error: 'Die Sitzungs- oder Kategoriekennung ist ungültig.', code: 'TAKEOVER_INVALID_REFERENCE' });
  }
  if (takeover && !['preview', 'execute'].includes(takeover.phase)) {
    return res.status(400).json({ error: 'Der Freigabeschritt ist ungültig.', code: 'TAKEOVER_INVALID_PHASE' });
  }
  if (takeover && ((takeover.phase === 'preview') !== dryRun)) {
    return res.status(400).json({ error: 'Vorschau und Kategorieausführung müssen getrennt angefordert werden.', code: 'TAKEOVER_INVALID_PHASE' });
  }
  if (takeover?.phase === 'execute' && (!takeover.categoryId || !takeover.previewDigest || !takeover.idempotencyKey)) {
    return res.status(400).json({ error: 'Für die Kategorieübernahme fehlen Vorschau-Digest oder Idempotenzschlüssel.', code: 'TAKEOVER_APPROVAL_REQUIRED' });
  }
  const client = await pool.connect();
  try {
    if (takeover || !dryRun) {
      await client.query('BEGIN');
      if (takeover?.phase === 'execute') await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    }
    if (takeover) {
      const sessionResult = await client.query(`
        SELECT id, status, legacy_backfill FROM migration_sessions
        WHERE id = $1 AND workspace_id = ${workspaceCondition}
        FOR UPDATE
      `, [takeover.sessionId]);
      const session = sessionResult.rows[0];
      if (!session) {
        throw httpError(409, 'Die Umzugssitzung ist nicht für eine neue Kategorieübernahme offen.', 'TAKEOVER_NOT_OPEN');
      }
      if (session.status !== 'open' || session.legacy_backfill) {
        if (takeover.phase === 'execute' && !session.legacy_backfill) {
          const replayCategory = await client.query(`
            SELECT id, status, idempotency_key FROM migration_categories
            WHERE id = $1 AND session_id = $2 AND workspace_id = ${workspaceCondition} AND resource = $3
            FOR UPDATE
          `, [takeover.categoryId, takeover.sessionId, resource]);
          if (replayCategory.rows[0]?.status === 'completed' && replayCategory.rows[0].idempotency_key === takeover.idempotencyKey) {
            const previous = await client.query(`${runSelect}, r.report FROM import_runs r LEFT JOIN users u ON u.id = r.created_by WHERE r.migration_category_id = $1 ORDER BY r.created_at DESC LIMIT 1`, [replayCategory.rows[0].id]);
            await client.query('COMMIT');
            const run = previous.rows[0];
            return res.json({ resource, dryRun: false, runId: run?.id || null, summary: run?.summary || {}, rows: run?.report || [], truncated: false, idempotentReplay: true });
          }
        }
        throw httpError(409, 'Die Umzugssitzung ist nicht für eine neue Kategorieübernahme offen.', 'TAKEOVER_NOT_OPEN');
      }
      if (takeover.phase === 'execute') {
        const categoryResult = await client.query(`
          SELECT id, status, preview_digest, idempotency_key
          FROM migration_categories
          WHERE id = $1 AND session_id = $2 AND workspace_id = ${workspaceCondition} AND resource = $3
          FOR UPDATE
        `, [takeover.categoryId, takeover.sessionId, resource]);
        const category = categoryResult.rows[0];
        if (!category) throw httpError(409, 'Die Kategorie gehört nicht zu dieser Sitzung. Bitte die Vorschau erneut prüfen.', 'TAKEOVER_PREVIEW_STALE');
        if (category.status === 'completed') {
          if (category.idempotency_key !== takeover.idempotencyKey) throw httpError(409, 'Diese Kategorie wurde bereits freigegeben und übernommen.', 'TAKEOVER_CATEGORY_COMPLETED');
          const previous = await client.query(`${runSelect}, r.report FROM import_runs r LEFT JOIN users u ON u.id = r.created_by WHERE r.migration_category_id = $1 LIMIT 1`, [category.id]);
          await client.query('COMMIT');
          const run = previous.rows[0];
          return res.json({ resource, dryRun: false, runId: run?.id || null, summary: run?.summary || {}, rows: run?.report || [], truncated: false, idempotentReplay: true });
        }
      }
    } else if (!dryRun) {
      const openTakeover = await client.query(`
        SELECT id FROM migration_sessions
        WHERE workspace_id = ${workspaceCondition} AND status = 'open' AND legacy_backfill = FALSE
        LIMIT 1
      `);
      if (openTakeover.rows[0]) throw httpError(409, 'Während einer Umzugssitzung müssen Kategorien einzeln anhand ihrer geprüften Vorschau übernommen werden.', 'TAKEOVER_CATEGORY_APPROVAL_REQUIRED');
    }
    const { context, company } = await loadContext(client, resource);
    const plan = planImport(resource, rows, context, options);
    const summary = summariseImport(plan, rows.length);
    const previewDigest = takeoverDigest({ resource, rows, options, settings: req.body?.settings || {}, file: req.body?.file, context, plan });
    let runId = null;
    let categoryId = takeover?.categoryId || null;
    if (takeover?.phase === 'preview') {
      const categoryResult = await client.query(`
        INSERT INTO migration_categories (workspace_id, session_id, resource)
        VALUES (NULLIF(current_setting('app.workspace_id', true), '')::uuid, $1, $2)
        ON CONFLICT (session_id, resource) DO UPDATE SET updated_at = NOW()
        RETURNING id, status
      `, [takeover.sessionId, resource]);
      if (categoryResult.rows[0].status !== 'open') throw httpError(409, 'Diese Kategorie wurde in der Sitzung bereits übernommen.', 'TAKEOVER_CATEGORY_COMPLETED');
      categoryId = categoryResult.rows[0].id;
      if (takeover.categoryId && takeover.categoryId !== categoryId) throw httpError(409, 'Die Kategoriekennung ist veraltet. Vorschau erneut prüfen.', 'TAKEOVER_PREVIEW_STALE');
      await client.query('UPDATE migration_categories SET preview_digest = $2, updated_at = NOW() WHERE id = $1', [categoryId, previewDigest]);
    }
    if (!dryRun) {
      if (summary.records === 0) throw httpError(400, 'Es gibt keine Zeile, die übernommen werden kann.');
      const items = await applyPlan(client, resource, plan, company, { fileName: text(req.body?.file?.name).slice(0, 200) });
      summary.imported = summary.records;
      if (takeover) {
        const category = await client.query(`
          SELECT id, status, preview_digest FROM migration_categories
          WHERE id = $1 AND session_id = $2 AND workspace_id = ${workspaceCondition} AND resource = $3
          FOR UPDATE
        `, [takeover.categoryId, takeover.sessionId, resource]);
        if (!category.rows[0] || category.rows[0].status !== 'open'
          || category.rows[0].preview_digest !== String(takeover.previewDigest)
          || category.rows[0].preview_digest !== previewDigest) {
          throw httpError(409, 'Der Bestand oder die Zuordnung hat sich seit der Vorschau geändert. Vorschau erneut prüfen.', 'TAKEOVER_PREVIEW_STALE');
        }
        categoryId = category.rows[0].id;
      }
      runId = await saveRun(client, {
        resource,
        file: req.body?.file,
        settings: { ...(req.body?.settings || {}), options: plan.options },
        summary,
        report: reportRows(plan, true),
        items,
        userId: req.auth?.userId,
        sessionId: takeover?.sessionId || null,
        categoryId,
      });
      if (takeover) {
        await client.query(`
          UPDATE migration_categories
          SET status = 'completed', idempotency_key = $2, completed_at = NOW(), updated_at = NOW()
          WHERE id = $1
        `, [takeover.categoryId, takeover.idempotencyKey]);
        await client.query('UPDATE migration_sessions SET progress_revision = progress_revision + 1, updated_at = NOW() WHERE id = $1', [takeover.sessionId]);
      }
    }
    if (takeover || !dryRun) await client.query('COMMIT');
    res.json({
      resource,
      dryRun,
      runId,
      summary,
      rows: reportRows(plan, !dryRun),
      totals: plan.totals,
      newCustomers: plan.newCustomers.slice(0, 200).map(customer => ({ name: customer.name, rowNumbers: customer.rowNumbers.slice(0, 20) })),
      truncated: false,
      ...(takeover ? { categoryId, previewDigest } : {}),
    });
  } catch (error) {
    if (takeover || !dryRun) await client.query('ROLLBACK').catch(() => undefined);
    if (error.code === '40001') return res.status(409).json({ error: 'Der Bestand hat sich während der Übernahme geändert. Vorschau erneut prüfen.', code: 'TAKEOVER_PREVIEW_STALE' });
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Eine Nummer wurde zwischenzeitlich vergeben. Bitte die Vorschau neu prüfen und erneut übernehmen.' });
    }
    sendError(res, error, error.statusCode ? error.message : 'Import fehlgeschlagen.');
  } finally {
    client.release();
  }
});

export default router;
