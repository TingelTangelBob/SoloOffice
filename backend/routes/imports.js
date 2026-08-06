import express from 'express';
import { randomUUID } from 'crypto';
import { pool } from '../database.js';
import logger from '../utils/logger.js';
import { hasPermission } from '../middleware/auth.js';

const router = express.Router();
const supportedResources = new Set(['customers', 'jobs', 'quotes', 'positions', 'hourlyRates', 'materials']);
const MAX_IMPORT_ROWS = 5000;
const MAX_DETAIL_ROWS = 250;
const MAX_IMPORT_CELL_LENGTH = 100000;

const today = () => new Date().toISOString().split('T')[0];

function text(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normaliseKey(value) {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('de-DE')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');
}

function pick(row, names) {
  const candidates = Array.isArray(names) ? names : [names];
  for (const name of candidates) {
    if (row[name] !== undefined && row[name] !== null && text(row[name]) !== '') return row[name];
  }
  const normalisedEntries = Object.entries(row).map(([key, value]) => [normaliseKey(key), value]);
  for (const name of candidates) {
    const found = normalisedEntries.find(([key, value]) => key === normaliseKey(name) && value !== undefined && value !== null && text(value) !== '');
    if (found) return found[1];
  }
  return undefined;
}

function parseNumber(value) {
  if (value === undefined || value === null || text(value) === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let normalised = text(value).replace(/[^0-9,.-]/g, '');
  if (!normalised) return null;
  const lastComma = normalised.lastIndexOf(',');
  const lastDot = normalised.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) normalised = normalised.replace(/\./g, '').replace(',', '.');
    else normalised = normalised.replace(/,/g, '');
  } else if (lastComma >= 0) {
    normalised = normalised.replace(/\./g, '').replace(',', '.');
  } else if ((normalised.match(/\./g) || []).length > 1) {
    normalised = normalised.replace(/\./g, '');
  }
  const parsed = Number(normalised);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  const normalised = normaliseKey(value);
  if (['true', '1', 'yes', 'ja', 'y', 'x', 'standard'].includes(normalised)) return true;
  if (['false', '0', 'no', 'nein', 'n'].includes(normalised)) return false;
  return false;
}

function parseDate(value) {
  const source = text(value);
  if (!source) return null;
  const germanDate = source.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (germanDate) {
    const year = germanDate[3].length === 2 ? `20${germanDate[3]}` : germanDate[3];
    const month = germanDate[2].padStart(2, '0');
    const day = germanDate[1].padStart(2, '0');
    const result = `${year}-${month}-${day}`;
    return isValidDate(result) ? result : null;
  }
  const isoDate = source.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoDate) {
    const result = `${isoDate[1]}-${isoDate[2].padStart(2, '0')}-${isoDate[3].padStart(2, '0')}`;
    return isValidDate(result) ? result : null;
  }
  const parsed = new Date(source);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().split('T')[0];
}

function isValidDate(value) {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function addDays(dateValue, days) {
  const date = new Date(`${dateValue}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split('T')[0];
}

function parseTime(value) {
  const source = text(value);
  if (!source) return null;
  const match = source.match(/^(\d{1,2})[:.](\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}` : null;
}

function parseStructuredArray(value) {
  if (Array.isArray(value)) return value;
  const source = text(value);
  if (!source) return [];
  try {
    const parsed = JSON.parse(source);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normaliseStatus(value, allowed, fallback) {
  const source = normaliseKey(value);
  const aliases = {
    offen: 'draft',
    entwurf: 'draft',
    inarbeit: 'in-progress',
    laufend: 'in-progress',
    erledigt: 'completed',
    abgeschlossen: 'completed',
    abgerechnet: 'invoiced',
    gesendet: 'sent',
    versendet: 'sent',
    angenommen: 'accepted',
    abgelehnt: 'rejected',
    abgelaufen: 'expired',
    abgerechnetangebot: 'billed',
  };
  const candidate = aliases[source] || text(value);
  return allowed.includes(candidate) ? candidate : fallback;
}

function normalisePriority(value) {
  const source = normaliseKey(value);
  if (['hoch', 'high', 'dringend'].includes(source)) return 'high';
  if (['niedrig', 'low'].includes(source)) return 'low';
  return 'medium';
}

function normaliseDiscountType(value) {
  const source = normaliseKey(value);
  if (['percentage', 'percent', 'prozent', 'prozentsatz', '%'].includes(source)) return 'percentage';
  if (['fixed', 'betrag', 'festbetrag', 'euro', 'eur'].includes(source)) return 'fixed';
  return null;
}

function rowNumber(row, index) {
  const parsed = Number(row._rowNumber);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : index + 2;
}

function resultEntry(rowNumbers, status, message, data = null, existingId = null) {
  return { rowNumbers, status, message, data, existingId };
}

function countRows(entries, predicate) {
  return entries.reduce((total, entry) => total + (predicate(entry) ? entry.rowNumbers.length : 0), 0);
}

function buildSummary(entries, total) {
  const validEntries = entries.filter(entry => ['valid', 'warning'].includes(entry.status));
  const updateEntries = entries.filter(entry => entry.status === 'update');
  const duplicateRows = countRows(entries, entry => entry.status === 'duplicate');
  const errorRows = countRows(entries, entry => entry.status === 'error');
  const warningRows = countRows(entries, entry => entry.status === 'warning');
  const validRows = countRows(entries, entry => ['valid', 'warning'].includes(entry.status));
  return {
    total,
    valid: validRows,
    updated: updateEntries.reduce((totalUpdates, entry) => totalUpdates + 1, 0),
    duplicates: duplicateRows,
    warnings: warningRows,
    errors: errorRows,
    imported: 0,
    skipped: duplicateRows + errorRows,
    validEntries,
  };
}

function reportRows(entries, importedEntryIds = new Set()) {
  return entries
    .flatMap((entry, entryIndex) => entry.rowNumbers.map(row => ({
      rowNumber: row,
      status: importedEntryIds.has(entryIndex) ? 'imported' : entry.status,
      message: entry.message,
    })))
    .sort((left, right) => left.rowNumber - right.rowNumber)
    .slice(0, MAX_DETAIL_ROWS);
}

async function loadCustomers(client) {
  const result = await client.query('SELECT id, customer_number, name, email, address FROM customers ORDER BY name ASC');
  return result.rows;
}

function findCustomer(customers, row) {
  const customerId = text(pick(row, ['customerId', 'customer_id', 'kundenId', 'kunden_id']));
  const customerNumber = text(pick(row, ['customerNumber', 'customer_number', 'customerNo', 'customer_no', 'kundennummer', 'kundennr']));
  const customerEmail = normaliseKey(pick(row, ['customerEmail', 'customer_email', 'kundenEmail', 'email', 'eMail']));
  const customerName = normaliseKey(pick(row, ['customerName', 'customer_name', 'kundenname', 'kunde', 'customer', 'name']));
  if (customerId) return customers.find(customer => customer.id === customerId) || null;
  if (customerNumber) return customers.find(customer => normaliseKey(customer.customer_number) === normaliseKey(customerNumber)) || null;
  if (customerEmail) return customers.find(customer => normaliseKey(customer.email) === customerEmail) || null;
  if (customerName) return customers.find(customer => normaliseKey(customer.name) === customerName) || null;
  return null;
}

function customerIdentity(row) {
  const number = text(pick(row, ['customerNumber', 'customer_number', 'customerNo', 'customer_no', 'kundennummer', 'kundennr']));
  const email = text(pick(row, ['email', 'eMail', 'mail']));
  const name = text(pick(row, ['name', 'customerName', 'customer_name', 'kundenname', 'kunde']));
  if (number) return `number:${normaliseKey(number)}`;
  if (email) return `email:${normaliseKey(email)}`;
  return `name:${normaliseKey(name)}`;
}

async function planCustomers(client, rows, duplicateMode) {
  const existing = await loadCustomers(client);
  const seen = new Set();
  const entries = [];
  rows.forEach((row, index) => {
    const number = text(pick(row, ['customerNumber', 'customer_number', 'customerNo', 'customer_no', 'kundennummer', 'kundennr']));
    const name = text(pick(row, ['name', 'customerName', 'customer_name', 'kundenname', 'kunde']));
    const email = text(pick(row, ['email', 'eMail', 'mail', 'emailAddress']));
    const identity = customerIdentity(row);
    const currentRow = rowNumber(row, index);
    if (!name) {
      entries.push(resultEntry([currentRow], 'error', 'Name fehlt.'));
      return;
    }
    if (seen.has(identity)) {
      entries.push(resultEntry([currentRow], 'duplicate', 'Doppelte Zeile in der Importdatei.'));
      return;
    }
    seen.add(identity);
    const match = existing.find(customer =>
      (number && normaliseKey(customer.customer_number) === normaliseKey(number))
      || (email && normaliseKey(customer.email) === normaliseKey(email))
      || (!number && !email && normaliseKey(customer.name) === normaliseKey(name))
    );
    const data = {
      customerNumber: number || undefined,
      name,
      email: email || '',
      additionalEmails: pick(row, ['additionalEmails', 'additional_emails', 'weitereEmails']),
      address: text(pick(row, ['address', 'adresse', 'street', 'strasse', 'straße'])),
      addressSupplement: text(pick(row, ['addressSupplement', 'address_supplement', 'adresszusatz'])),
      city: text(pick(row, ['city', 'ort', 'town'])),
      postalCode: text(pick(row, ['postalCode', 'postal_code', 'postcode', 'zip', 'plz'])),
      country: text(pick(row, ['country', 'land'])) || 'Deutschland',
      taxId: text(pick(row, ['taxId', 'tax_id', 'vatId', 'vat_id', 'ustId', 'ust_id'])),
      phone: text(pick(row, ['phone', 'telephone', 'tel', 'telefon', 'mobile'])),
    };
    const warnings = [];
    if (!data.email) warnings.push('E-Mail fehlt');
    if (!data.address || !data.city || !data.postalCode) warnings.push('Adresse ist nicht vollständig');
    if (match) {
      if (duplicateMode === 'update') {
        entries.push(resultEntry([currentRow], 'update', `Bestehender Kunde wird aktualisiert${warnings.length ? ` (${warnings.join(', ')})` : ''}.`, data, match.id));
      } else {
        entries.push(resultEntry([currentRow], 'duplicate', `Kunde bereits vorhanden (${match.name}).`));
      }
      return;
    }
    existing.push({ id: `new-${currentRow}`, customer_number: number || `new-${currentRow}`, name, email });
    entries.push(resultEntry([currentRow], warnings.length ? 'warning' : 'valid', warnings.length ? `${warnings.join(', ')}.` : 'Kunde kann angelegt werden.', data));
  });
  return { entries };
}

function simpleMasterConfig(resource) {
  if (resource === 'hourlyRates') return { table: 'hourly_rates', priceKey: 'rate', priceLabel: 'Stundensatz', defaultUnit: null };
  if (resource === 'materials') return { table: 'material_templates', priceKey: 'unitPrice', priceLabel: 'Preis', defaultUnit: 'Stück' };
  return null;
}

async function planSimpleMaster(client, resource, rows, duplicateMode) {
  const config = simpleMasterConfig(resource);
  const existingResult = await client.query(`SELECT id, name FROM ${config.table} ORDER BY name ASC`);
  const existing = existingResult.rows;
  const seen = new Set();
  const entries = [];
  rows.forEach((row, index) => {
    const currentRow = rowNumber(row, index);
    const name = text(pick(row, ['name', 'title', 'bezeichnung', resource === 'materials' ? 'material' : 'stundensatz']));
    const price = parseNumber(pick(row, [config.priceKey, 'price', 'preis', 'unit_price', 'unitPrice', 'rate', 'betrag']));
    if (!name) {
      entries.push(resultEntry([currentRow], 'error', 'Name fehlt.'));
      return;
    }
    if (price === null || price < 0) {
      entries.push(resultEntry([currentRow], 'error', `${config.priceLabel} ist ungültig oder fehlt.`));
      return;
    }
    const identity = normaliseKey(name);
    if (seen.has(identity)) {
      entries.push(resultEntry([currentRow], 'duplicate', 'Doppelte Zeile in der Importdatei.'));
      return;
    }
    seen.add(identity);
    const match = existing.find(item => normaliseKey(item.name) === identity);
    const data = {
      name,
      description: text(pick(row, ['description', 'details', 'beschreibung'])),
      [config.priceKey]: price,
      unit: config.defaultUnit ? (text(pick(row, ['unit', 'einheit'])) || config.defaultUnit) : undefined,
      taxRate: parseNumber(pick(row, ['taxRate', 'tax_rate', 'tax', 'mwst', 'ust', 'steuersatz'])) ?? 19,
      isDefault: parseBoolean(pick(row, ['isDefault', 'is_default', 'default', 'standard'])),
    };
    if (match && duplicateMode === 'update') {
      entries.push(resultEntry([currentRow], 'update', 'Bestehender Eintrag wird aktualisiert.', data, match.id));
    } else if (match) {
      entries.push(resultEntry([currentRow], 'duplicate', 'Eintrag mit diesem Namen bereits vorhanden.'));
    } else {
      existing.push({ id: `new-${currentRow}`, name });
      entries.push(resultEntry([currentRow], 'valid', 'Eintrag kann angelegt werden.', data));
    }
  });
  return { entries };
}

function normaliseTimeEntries(value) {
  return parseStructuredArray(value).map((item, index) => {
    const hours = parseNumber(pick(item, ['hoursWorked', 'hours_worked', 'hours', 'stunden'])) ?? 0;
    const rate = parseNumber(pick(item, ['hourlyRate', 'hourly_rate', 'rate', 'stundensatz'])) ?? 0;
    return {
      description: text(pick(item, ['description', 'beschreibung', 'name'])) || `Arbeitszeit ${index + 1}`,
      startTime: parseTime(pick(item, ['startTime', 'start_time', 'start', 'von'])),
      endTime: parseTime(pick(item, ['endTime', 'end_time', 'end', 'bis'])),
      hoursWorked: hours,
      hourlyRate: rate,
      hourlyRateId: text(pick(item, ['hourlyRateId', 'hourly_rate_id'])) || null,
      taxRate: parseNumber(pick(item, ['taxRate', 'tax_rate', 'mwst', 'ust'])) ?? 19,
      total: parseNumber(pick(item, ['total', 'amount', 'betrag'])) ?? hours * rate,
    };
  });
}

function normaliseMaterials(value) {
  return parseStructuredArray(value).map(item => {
    const quantity = parseNumber(pick(item, ['quantity', 'menge', 'anzahl'])) ?? 1;
    const unitPrice = parseNumber(pick(item, ['unitPrice', 'unit_price', 'price', 'preis', 'rate'])) ?? 0;
    return {
      description: text(pick(item, ['description', 'beschreibung', 'name', 'material'])),
      quantity,
      unitPrice,
      taxRate: parseNumber(pick(item, ['taxRate', 'tax_rate', 'mwst', 'ust'])) ?? 19,
      total: parseNumber(pick(item, ['total', 'amount', 'betrag'])) ?? quantity * unitPrice,
      unit: text(pick(item, ['unit', 'einheit'])) || 'Stück',
      templateId: text(pick(item, ['templateId', 'template_id'])) || undefined,
    };
  }).filter(item => item.description);
}

async function planJobs(client, rows, duplicateMode) {
  const customers = await loadCustomers(client);
  const existingResult = await client.query('SELECT id, job_number, external_job_number, title, date FROM job_entries ORDER BY created_at ASC');
  const existing = existingResult.rows;
  const entries = [];
  rows.forEach((row, index) => {
    const currentRow = rowNumber(row, index);
    const title = text(pick(row, ['title', 'jobTitle', 'job_title', 'auftrag', 'bezeichnung']));
    const customer = findCustomer(customers, row);
    const date = parseDate(pick(row, ['date', 'jobDate', 'job_date', 'datum', 'auftragsdatum']));
    if (!title) {
      entries.push(resultEntry([currentRow], 'error', 'Auftragstitel fehlt.'));
      return;
    }
    if (!customer) {
      entries.push(resultEntry([currentRow], 'error', 'Kunde konnte nicht über ID, Nummer, E-Mail oder Namen gefunden werden.'));
      return;
    }
    if (!date) {
      entries.push(resultEntry([currentRow], 'error', 'Auftragsdatum fehlt oder ist ungültig.'));
      return;
    }
    const jobNumber = text(pick(row, ['jobNumber', 'job_number', 'orderNumber', 'order_number', 'auftragsnummer', 'auftragsnr']));
    const externalJobNumber = text(pick(row, ['externalJobNumber', 'external_job_number', 'externalNumber', 'extern']));
    const duplicate = existing.find(job =>
      (jobNumber && normaliseKey(job.job_number) === normaliseKey(jobNumber))
      || (externalJobNumber && normaliseKey(job.external_job_number) === normaliseKey(externalJobNumber))
    );
    if (duplicate) {
      entries.push(resultEntry([currentRow], 'duplicate', `Auftrag bereits vorhanden (${duplicate.job_number}).`));
      return;
    }
    const hoursWorked = parseNumber(pick(row, ['hoursWorked', 'hours_worked', 'hours', 'stunden', 'arbeitszeit'])) ?? 0;
    const hourlyRate = parseNumber(pick(row, ['hourlyRate', 'hourly_rate', 'rate', 'stundensatz'])) ?? 0;
    const rawDescription = text(pick(row, ['description', 'details', 'beschreibung', 'leistungstext']));
    const warnings = [];
    if (!rawDescription) warnings.push('Beschreibung wird aus dem Titel erzeugt');
    if (!text(pick(row, ['status', 'auftragsstatus']))) warnings.push('Status wird auf Entwurf gesetzt');
    const data = {
      jobNumber: jobNumber || undefined,
      externalJobNumber: externalJobNumber || undefined,
      customerId: customer.id,
      customerAddress: text(pick(row, ['customerAddress', 'customer_address', 'kundenadresse'])) || customer.address || '',
      location: text(pick(row, ['location', 'ausführungsort', 'ausfuehrungsort', 'executionLocation'])) || undefined,
      title,
      description: rawDescription || title,
      date,
      startTime: parseTime(pick(row, ['startTime', 'start_time', 'start', 'von'])),
      endTime: parseTime(pick(row, ['endTime', 'end_time', 'end', 'bis'])),
      hoursWorked,
      hourlyRate,
      hourlyRateId: text(pick(row, ['hourlyRateId', 'hourly_rate_id'])) || null,
      timeEntries: normaliseTimeEntries(pick(row, ['timeEntries', 'time_entries', 'zeiten', 'zeitpositionen'])),
      materials: normaliseMaterials(pick(row, ['materials', 'materialien', 'materialItems', 'material_items'])),
      status: normaliseStatus(pick(row, ['status', 'auftragsstatus']), ['draft', 'in-progress', 'completed', 'invoiced'], 'draft'),
      notes: text(pick(row, ['notes', 'note', 'notizen', 'bemerkung', 'anmerkung'])),
      priority: normalisePriority(pick(row, ['priority', 'prioritaet', 'priorität', 'dringlichkeit'])),
    };
    existing.push({ id: `new-${currentRow}`, job_number: jobNumber || `new-${currentRow}`, external_job_number: externalJobNumber, title, date });
    entries.push(resultEntry([currentRow], warnings.length ? 'warning' : 'valid', warnings.length ? `${warnings.join(', ')}.` : 'Auftrag kann angelegt werden.', data));
  });
  return { entries };
}

function normaliseQuoteItems(rows) {
  const items = [];
  const warnings = [];
  rows.forEach(row => {
    const structuredItems = parseStructuredArray(pick(row, ['items', 'positionen', 'positions', 'lineItems', 'line_items']));
    structuredItems.forEach((item, index) => {
      const description = text(pick(item, ['description', 'beschreibung', 'name', 'position', 'item']));
      const quantity = parseNumber(pick(item, ['quantity', 'menge', 'anzahl'])) ?? 1;
      const unitPrice = parseNumber(pick(item, ['unitPrice', 'unit_price', 'price', 'preis', 'einzelpreis'])) ?? null;
      if (!description || unitPrice === null || unitPrice < 0) {
        warnings.push(`JSON-Position ${index + 1} ist unvollständig`);
        return;
      }
      items.push({
        description,
        quantity,
        unitPrice,
        taxRate: parseNumber(pick(item, ['taxRate', 'tax_rate', 'tax', 'mwst', 'ust', 'steuersatz'])) ?? 19,
        order: items.length + 1,
      });
    });
    const description = text(pick(row, ['itemDescription', 'item_description', 'position', 'positionsbeschreibung', 'leistungsbeschreibung', 'artikel', 'article', 'item', 'beschreibung', 'description']));
    const itemQuantity = parseNumber(pick(row, ['itemQuantity', 'item_quantity', 'positionsmenge', 'menge', 'quantity', 'anzahl']));
    const itemUnitPrice = parseNumber(pick(row, ['itemUnitPrice', 'item_unit_price', 'positionspreis', 'einzelpreis', 'unitPrice', 'unit_price', 'preis', 'price']));
    if (description || itemQuantity !== null || itemUnitPrice !== null) {
      if (!description || itemUnitPrice === null || itemUnitPrice < 0) {
        warnings.push('Eine tabellarische Position ist unvollständig');
      } else {
        items.push({
          description,
          quantity: itemQuantity ?? 1,
          unitPrice: itemUnitPrice,
          taxRate: parseNumber(pick(row, ['itemTaxRate', 'item_tax_rate', 'positionTaxRate', 'steuersatz', 'mwst', 'ust', 'taxRate', 'tax_rate'])) ?? 19,
          order: items.length + 1,
        });
      }
    }
  });
  return { items, warnings };
}

function calculateQuoteTotals(items, row) {
  const subtotalBeforeDiscount = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const itemDiscounts = items.reduce((sum, item) => sum + (item.discountAmount || 0), 0);
  const subtotalAfterItems = subtotalBeforeDiscount - itemDiscounts;
  const discountType = normaliseDiscountType(pick(row, ['globalDiscountType', 'global_discount_type', 'rabattTyp', 'rabattart']));
  const discountValue = parseNumber(pick(row, ['globalDiscountValue', 'global_discount_value', 'rabattWert', 'rabattwert'])) ?? 0;
  const requestedDiscountAmount = parseNumber(pick(row, ['globalDiscountAmount', 'global_discount_amount', 'rabattBetrag', 'rabattbetrag']));
  const calculatedDiscount = discountType === 'percentage'
    ? subtotalAfterItems * discountValue / 100
    : discountType === 'fixed' ? Math.min(discountValue, subtotalAfterItems) : 0;
  const globalDiscountAmount = requestedDiscountAmount ?? calculatedDiscount;
  const discountedSubtotal = Math.max(0, subtotalAfterItems - globalDiscountAmount);
  const discountRatio = subtotalAfterItems > 0 ? Math.min(Math.max(globalDiscountAmount / subtotalAfterItems, 0), 1) : 0;
  const taxAmount = items.reduce((sum, item) => {
    const taxableItemTotal = item.quantity * item.unitPrice - (item.discountAmount || 0);
    return sum + taxableItemTotal * (1 - discountRatio) * (item.taxRate || 0) / 100;
  }, 0);
  return {
    subtotal: parseNumber(pick(row, ['subtotal', 'sub_total', 'netto', 'netAmount', 'net_amount', 'nettobetrag'])) ?? subtotalAfterItems,
    taxAmount: parseNumber(pick(row, ['taxAmount', 'tax_amount', 'vatAmount', 'vat_amount', 'steuerbetrag', 'mwstBetrag'])) ?? taxAmount,
    total: parseNumber(pick(row, ['total', 'grossAmount', 'gross_amount', 'brutto', 'gesamtbetrag', 'endbetrag'])) ?? discountedSubtotal + taxAmount,
    globalDiscountType: discountType,
    globalDiscountValue: discountType ? discountValue : null,
    globalDiscountAmount,
  };
}

async function planQuotes(client, rows, duplicateMode) {
  const customers = await loadCustomers(client);
  const existingResult = await client.query('SELECT id, quote_number FROM quotes ORDER BY created_at ASC');
  const existing = existingResult.rows;
  const groups = new Map();
  rows.forEach((row, index) => {
    const currentRow = rowNumber(row, index);
    const quoteNumber = text(pick(row, ['quoteNumber', 'quote_number', 'offerNumber', 'offer_number', 'angebotsnummer', 'angebotsnr']));
    const groupKey = quoteNumber || `row-${currentRow}`;
    if (!groups.has(groupKey)) groups.set(groupKey, { quoteNumber, rows: [] });
    groups.get(groupKey).rows.push({ row, currentRow });
  });
  const entries = [];
  for (const group of groups.values()) {
    const firstRow = group.rows[0].row;
    const rowNumbers = group.rows.map(item => item.currentRow);
    const customer = findCustomer(customers, firstRow);
    if (!customer) {
      entries.push(resultEntry(rowNumbers, 'error', 'Kunde konnte für das Angebot nicht gefunden werden.'));
      continue;
    }
    if (group.quoteNumber) {
      const duplicate = existing.find(quote => normaliseKey(quote.quote_number) === normaliseKey(group.quoteNumber));
      if (duplicate) {
        entries.push(resultEntry(rowNumbers, 'duplicate', `Angebot bereits vorhanden (${duplicate.quote_number}).`));
        continue;
      }
    }
    const itemResult = normaliseQuoteItems(group.rows.map(item => item.row));
    let items = itemResult.items;
    const warnings = [...itemResult.warnings];
    if (items.length === 0) {
      const fallbackTotal = parseNumber(pick(firstRow, ['total', 'grossAmount', 'gross_amount', 'brutto', 'gesamtbetrag', 'endbetrag']));
      if (fallbackTotal !== null && fallbackTotal >= 0) {
        const fallbackTaxRate = parseNumber(pick(firstRow, ['itemTaxRate', 'item_tax_rate', 'taxRate', 'tax_rate', 'mwst', 'ust'])) ?? 19;
        const fallbackNet = parseNumber(pick(firstRow, ['subtotal', 'sub_total', 'netto', 'netAmount', 'net_amount', 'nettobetrag'])) ?? fallbackTotal / (1 + fallbackTaxRate / 100);
        items = [{ description: 'Importierter Gesamtbetrag', quantity: 1, unitPrice: fallbackNet, taxRate: fallbackTaxRate, order: 1 }];
        warnings.push('Keine Einzelposition gefunden; eine Position aus der Gesamtsumme wurde erzeugt');
      }
    }
    if (items.length === 0) {
      entries.push(resultEntry(rowNumbers, 'error', 'Keine gültige Position gefunden.'));
      continue;
    }
    const issueDate = parseDate(pick(firstRow, ['issueDate', 'issue_date', 'offerDate', 'angebotsdatum', 'ausstellungsdatum', 'datum'])) || today();
    const validUntil = parseDate(pick(firstRow, ['validUntil', 'valid_until', 'expirationDate', 'gueltigBis', 'gültigBis', 'gueltig', 'gültig'])) || addDays(issueDate, 30);
    if (!pick(firstRow, ['issueDate', 'issue_date', 'offerDate', 'angebotsdatum', 'ausstellungsdatum', 'datum'])) warnings.push('Ausstellungsdatum wird auf heute gesetzt');
    if (!pick(firstRow, ['validUntil', 'valid_until', 'expirationDate', 'gueltigBis', 'gültigBis', 'gueltig', 'gültig'])) warnings.push('Gültigkeit wird auf 30 Tage gesetzt');
    const data = {
      quoteNumber: group.quoteNumber || undefined,
      customerId: customer.id,
      issueDate,
      validUntil,
      status: normaliseStatus(pick(firstRow, ['status', 'angebotsstatus']), ['draft', 'sent', 'accepted', 'rejected', 'expired', 'billed'], 'draft'),
      notes: text(pick(firstRow, ['notes', 'note', 'notizen', 'bemerkung', 'anmerkung'])),
      items,
      ...calculateQuoteTotals(items, firstRow),
    };
    if (!pick(firstRow, ['status', 'angebotsstatus'])) warnings.push('Status wird auf Entwurf gesetzt');
    existing.push({ id: `new-${rowNumbers[0]}`, quote_number: group.quoteNumber || `new-${rowNumbers[0]}` });
    entries.push(resultEntry(rowNumbers, warnings.length ? 'warning' : 'valid', warnings.length ? `${warnings.join(', ')}.` : 'Angebot kann angelegt werden.', data));
  }
  return { entries };
}

async function planPositions(client, rows, duplicateMode) {
  const companyResult = await client.query("SELECT invoice_templates FROM company WHERE workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid");
  const existing = Array.isArray(companyResult.rows[0]?.invoice_templates) ? companyResult.rows[0].invoice_templates : [];
  const seen = new Set();
  const entries = [];
  rows.forEach((row, index) => {
    const currentRow = rowNumber(row, index);
    const name = text(pick(row, ['name', 'title', 'bezeichnung', 'position', 'beschreibung']));
    const unitPrice = parseNumber(pick(row, ['unitPrice', 'unit_price', 'price', 'preis', 'einzelpreis', 'betrag']));
    if (!name) {
      entries.push(resultEntry([currentRow], 'error', 'Name der Positionsvorlage fehlt.'));
      return;
    }
    if (unitPrice === null || unitPrice < 0) {
      entries.push(resultEntry([currentRow], 'error', 'Preis der Positionsvorlage ist ungültig oder fehlt.'));
      return;
    }
    const identity = normaliseKey(name);
    if (seen.has(identity)) {
      entries.push(resultEntry([currentRow], 'duplicate', 'Doppelte Zeile in der Importdatei.'));
      return;
    }
    seen.add(identity);
    const match = existing.find(template => normaliseKey(template.name) === identity);
    const data = {
      name,
      description: text(pick(row, ['description', 'details', 'beschreibungstext', 'leistungstext'])),
      unitPrice,
      unit: text(pick(row, ['unit', 'einheit', 'unitName'])) || 'Stunde',
      taxRate: parseNumber(pick(row, ['taxRate', 'tax_rate', 'tax', 'mwst', 'ust', 'steuersatz'])) ?? 19,
      isDefault: parseBoolean(pick(row, ['isDefault', 'is_default', 'default', 'standard'])),
    };
    if (match && duplicateMode === 'update') {
      entries.push(resultEntry([currentRow], 'update', 'Bestehende Positionsvorlage wird aktualisiert.', data, match.id));
    } else if (match) {
      entries.push(resultEntry([currentRow], 'duplicate', 'Positionsvorlage mit diesem Namen bereits vorhanden.'));
    } else {
      const newTemplate = { id: `new-${currentRow}`, ...data };
      existing.push(newTemplate);
      entries.push(resultEntry([currentRow], 'valid', 'Positionsvorlage kann angelegt werden.', data));
    }
  });
  return { entries, positionTemplates: existing };
}

async function createPlan(client, resource, rows, duplicateMode) {
  switch (resource) {
    case 'customers': return planCustomers(client, rows, duplicateMode);
    case 'jobs': return planJobs(client, rows, duplicateMode);
    case 'quotes': return planQuotes(client, rows, duplicateMode);
    case 'positions': return planPositions(client, rows, duplicateMode);
    case 'hourlyRates':
    case 'materials':
      return planSimpleMaster(client, resource, rows, duplicateMode);
    default:
      throw new Error('Nicht unterstütztes Importziel.');
  }
}

async function nextNumber(client, table, column, prefix, year) {
  const result = await client.query(`SELECT ${column} FROM ${table} WHERE ${column} LIKE $1`, [`${prefix}-${year}-%`]);
  const max = result.rows.reduce((highest, row) => {
    const number = Number.parseInt(text(row[column]).split('-').pop(), 10);
    return Number.isFinite(number) ? Math.max(highest, number) : highest;
  }, 0);
  return `${prefix}-${year}-${String(max + 1).padStart(3, '0')}`;
}

async function nextCustomerNumber(client) {
  const result = await client.query('SELECT customer_number FROM customers');
  const max = result.rows.reduce((highest, row) => {
    const number = Number.parseInt(text(row.customer_number), 10);
    return Number.isFinite(number) ? Math.max(highest, number) : highest;
  }, 0);
  return String(max + 1).padStart(4, '0');
}

async function insertAdditionalEmails(client, customerId, value) {
  const source = text(value);
  if (!source) return;
  let emails = parseStructuredArray(value);
  if (emails.length === 0) emails = source.split(/[;,|]/).map(item => item.trim()).filter(Boolean);
  for (const item of emails) {
    const email = text(typeof item === 'object' ? pick(item, ['email', 'address']) : item);
    if (!email || !email.includes('@')) continue;
    await client.query('INSERT INTO customer_emails (customer_id, email) VALUES ($1, $2) ON CONFLICT (customer_id, email) DO NOTHING', [customerId, email]);
  }
}

async function applyCustomer(client, entry) {
  const data = entry.data;
  if (entry.status === 'update') {
    const result = await client.query(`
      UPDATE customers
      SET name = $1, email = $2, address = $3, address_supplement = $4, city = $5,
          postal_code = $6, country = $7, tax_id = $8, phone = $9
      WHERE id = $10
      RETURNING id
    `, [data.name, data.email || null, data.address, data.addressSupplement || null, data.city, data.postalCode, data.country, data.taxId || null, data.phone || null, entry.existingId]);
    if (result.rows.length === 0) throw new Error('Bestehender Kunde wurde nicht gefunden.');
    await insertAdditionalEmails(client, entry.existingId, data.additionalEmails);
    return 'updated';
  }
  const customerNumber = data.customerNumber || await nextCustomerNumber(client);
  const result = await client.query(`
    INSERT INTO customers (customer_number, name, email, address, address_supplement, city, postal_code, country, tax_id, phone)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING id
  `, [customerNumber, data.name, data.email || null, data.address || '', data.addressSupplement || null, data.city || '', data.postalCode || '', data.country || 'Deutschland', data.taxId || null, data.phone || null]);
  await insertAdditionalEmails(client, result.rows[0].id, data.additionalEmails);
  return 'created';
}

async function applyMaster(client, resource, entry) {
  const config = simpleMasterConfig(resource);
  const data = entry.data;
  const table = config.table;
  if (data.isDefault) await client.query(`UPDATE ${table} SET is_default = FALSE WHERE is_default = TRUE`);
  if (entry.status === 'update') {
    if (resource === 'hourlyRates') {
      await client.query(`UPDATE ${table} SET name = $1, description = $2, rate = $3, tax_rate = $4, is_default = $5, updated_at = CURRENT_TIMESTAMP WHERE id = $6`, [data.name, data.description || '', data.rate, data.taxRate, data.isDefault, entry.existingId]);
    } else {
      await client.query(`UPDATE ${table} SET name = $1, description = $2, unit_price = $3, unit = $4, tax_rate = $5, is_default = $6, updated_at = CURRENT_TIMESTAMP WHERE id = $7`, [data.name, data.description || '', data.unitPrice, data.unit, data.taxRate, data.isDefault, entry.existingId]);
    }
    return 'updated';
  }
  if (resource === 'hourlyRates') {
    await client.query(`INSERT INTO ${table} (name, description, rate, tax_rate, is_default) VALUES ($1, $2, $3, $4, $5)`, [data.name, data.description || '', data.rate, data.taxRate, data.isDefault]);
  } else {
    await client.query(`INSERT INTO ${table} (name, description, unit_price, unit, tax_rate, is_default) VALUES ($1, $2, $3, $4, $5, $6)`, [data.name, data.description || '', data.unitPrice, data.unit, data.taxRate, data.isDefault]);
  }
  return 'created';
}

async function applyJob(client, entry) {
  const data = entry.data;
  const year = new Date(`${data.date}T00:00:00Z`).getUTCFullYear();
  const jobNumber = data.jobNumber || await nextNumber(client, 'job_entries', 'job_number', 'AB', year);
  const result = await client.query(`
    INSERT INTO job_entries (
      job_number, external_job_number, customer_id, customer_address, location, title, description, date,
      start_time, end_time, hours_worked, hourly_rate, hourly_rate_id, materials, status, notes, priority
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    RETURNING id
  `, [jobNumber, data.externalJobNumber || null, data.customerId, data.customerAddress || null, data.location || null, data.title, data.description, data.date, data.startTime, data.endTime, data.hoursWorked, data.hourlyRate, data.hourlyRateId, JSON.stringify(data.materials || []), data.status, data.notes || null, data.priority]);
  const jobId = result.rows[0].id;
  const timeEntries = data.timeEntries?.length > 0
    ? data.timeEntries
    : data.hoursWorked > 0 || data.startTime || data.endTime
      ? [{ description: 'Arbeitszeit', startTime: data.startTime, endTime: data.endTime, hoursWorked: data.hoursWorked, hourlyRate: data.hourlyRate, hourlyRateId: data.hourlyRateId, taxRate: 19, total: data.hoursWorked * data.hourlyRate }]
      : [];
  for (const timeEntry of timeEntries) {
    await client.query(`
      INSERT INTO job_time_entries (job_id, description, start_time, end_time, hours_worked, hourly_rate, hourly_rate_id, tax_rate, total)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [jobId, timeEntry.description || '', timeEntry.startTime || null, timeEntry.endTime || null, timeEntry.hoursWorked || 0, timeEntry.hourlyRate || 0, timeEntry.hourlyRateId || null, timeEntry.taxRate ?? 19, timeEntry.total || 0]);
  }
  return 'created';
}

function quoteInsertItems(items) {
  return items.map((item, index) => ({
    ...item,
    order: item.order || index + 1,
    total: item.total ?? item.quantity * item.unitPrice,
  }));
}

async function applyQuote(client, entry) {
  const data = entry.data;
  const issueDate = data.issueDate || today();
  const quoteNumber = data.quoteNumber || await nextNumber(client, 'quotes', 'quote_number', 'AN', new Date(`${issueDate}T00:00:00Z`).getUTCFullYear());
  const items = quoteInsertItems(data.items || []);
  const result = await client.query(`
    INSERT INTO quotes (quote_number, customer_id, customer_name, issue_date, valid_until, subtotal, tax_amount, total, status, notes, global_discount_type, global_discount_value, global_discount_amount)
    SELECT $1, c.id, c.name, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
    FROM customers c WHERE c.id = $2
    RETURNING id
  `, [quoteNumber, data.customerId, issueDate, data.validUntil, data.subtotal, data.taxAmount, data.total, data.status, data.notes || null, data.globalDiscountType, data.globalDiscountValue, data.globalDiscountAmount]);
  if (result.rows.length === 0) throw new Error('Kunde für das Angebot wurde nicht gefunden.');
  const quoteId = result.rows[0].id;
  for (const item of items) {
    await client.query(`
      INSERT INTO quote_items (quote_id, description, quantity, unit_price, tax_rate, total, item_order, discount_type, discount_value, discount_amount)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [quoteId, item.description, item.quantity, item.unitPrice, item.taxRate, item.total, item.order, item.discountType || null, item.discountValue || null, item.discountAmount || null]);
  }
  return 'created';
}

async function applyPositions(client, entries, existingTemplates) {
  let templates = existingTemplates.filter(template => !String(template.id).startsWith('new-'));
  for (const entry of entries) {
    if (!['valid', 'warning', 'update'].includes(entry.status)) continue;
    const data = entry.data;
    const template = entry.status === 'update'
      ? templates.find(item => item.id === entry.existingId)
      : null;
    const nextTemplate = {
      ...(template || {}),
      ...(template ? {} : { id: randomUUID(), createdAt: new Date().toISOString() }),
      ...data,
      updatedAt: new Date().toISOString(),
    };
    if (nextTemplate.isDefault) templates = templates.map(item => ({ ...item, isDefault: false }));
    if (template) templates = templates.map(item => item.id === entry.existingId ? nextTemplate : item);
    else templates.push(nextTemplate);
  }
  await client.query("UPDATE company SET invoice_templates = $1 WHERE workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid", [JSON.stringify(templates)]);
  return entries.filter(entry => ['valid', 'warning', 'update'].includes(entry.status)).map(entry => entry.status === 'update' ? 'updated' : 'created');
}

async function applyPlan(client, resource, plan) {
  const applicable = plan.entries.filter(entry => ['valid', 'warning', 'update'].includes(entry.status));
  if (resource === 'positions') {
    return applyPositions(client, applicable, plan.positionTemplates || []);
  }
  const results = [];
  for (const entry of applicable) {
    if (resource === 'customers') results.push(await applyCustomer(client, entry));
    else if (resource === 'jobs') results.push(await applyJob(client, entry));
    else if (resource === 'quotes') results.push(await applyQuote(client, entry));
    else results.push(await applyMaster(client, resource, entry));
  }
  return results;
}

router.post('/:resource', async (req, res) => {
  const { resource } = req.params;
  if (!supportedResources.has(resource)) return res.status(400).json({ error: 'Nicht unterstütztes Importziel.' });
  if (['positions', 'hourlyRates', 'materials'].includes(resource) && !hasPermission(req.auth, 'workspace.settings')) {
    return res.status(403).json({ error: 'Nur Administratoren dürfen Stammdaten importieren', code: 'FORBIDDEN' });
  }
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (rows.length === 0) return res.status(400).json({ error: 'Es wurden keine Importzeilen übergeben.' });
  if (rows.length > MAX_IMPORT_ROWS) return res.status(413).json({ error: `Es dürfen höchstens ${MAX_IMPORT_ROWS} Zeilen importiert werden.` });
  if (rows.some(row => !row || typeof row !== 'object' || Array.isArray(row) || Object.values(row).some(value => text(value).length > MAX_IMPORT_CELL_LENGTH))) {
    return res.status(413).json({ error: 'Eine Importzelle ist zu groß oder die Importzeilen haben ein ungültiges Format.' });
  }
  const dryRun = req.body?.dryRun !== false;
  const duplicateMode = req.body?.duplicateMode === 'update' ? 'update' : 'skip';
  const client = await pool.connect();
  try {
    if (!dryRun) await client.query('BEGIN');
    const plan = await createPlan(client, resource, rows, duplicateMode);
    const summary = buildSummary(plan.entries, rows.length);
    let importedEntryIds = new Set();
    if (!dryRun) {
      const applied = await applyPlan(client, resource, plan);
      summary.imported = applied.length;
      summary.skipped = summary.duplicates + summary.errors;
      plan.entries.forEach((entry, index) => {
        if (['valid', 'warning', 'update'].includes(entry.status)) importedEntryIds.add(index);
      });
      await client.query('COMMIT');
    }
    res.json({
      resource,
      dryRun,
      summary: {
        total: summary.total,
        valid: summary.valid,
        updated: summary.updated,
        duplicates: summary.duplicates,
        warnings: summary.warnings,
        errors: summary.errors,
        imported: summary.imported,
        skipped: summary.skipped,
      },
      rows: reportRows(plan.entries, importedEntryIds),
      truncated: plan.entries.reduce((count, entry) => count + entry.rowNumbers.length, 0) > MAX_DETAIL_ROWS,
    });
  } catch (error) {
    if (!dryRun) await client.query('ROLLBACK').catch(() => undefined);
    logger.error('Import failed', { resource, error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message || 'Import fehlgeschlagen.' });
  } finally {
    client.release();
  }
});

export default router;
