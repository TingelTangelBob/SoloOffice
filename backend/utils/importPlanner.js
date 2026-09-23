// Gemeinsame, datenbankfreie Importplanung. Der Server lädt den Bestand des
// Workspaces, der Demo-Modus nimmt seinen Browserzustand; beide erhalten
// dieselbe Prüfung, dieselben Meldungen und dieselben Summen. Geschrieben
// wird erst in der jeweiligen Anwendungsschicht.
import { calculateDocumentMoney } from './documentMoney.js';
import { expandRecurrence, normalizeRecurrence } from './jobRecurrenceRule.js';
import {
  normaliseEuerCategory,
  normaliseKey,
  parseBoolean,
  parseCustomerType,
  parseDate,
  parseEntryType,
  parseJobStatus,
  parseNumber,
  parsePaymentStatus,
  parseQuoteStatus,
  parseRepeatInterval,
  parseTime,
  pick,
  roundMoney,
  text,
} from './importValues.js';

export const IMPORT_RESOURCES = [
  'customers', 'jobs', 'quotes', 'positions', 'hourlyRates', 'materials',
  'euerEntries', 'invoicePayments', 'invoices',
];
export const UPDATEABLE_IMPORT_RESOURCES = ['customers', 'positions', 'hourlyRates', 'materials'];
export const SETTINGS_IMPORT_RESOURCES = ['positions', 'hourlyRates', 'materials'];
export const CUSTOMER_CREATING_RESOURCES = ['jobs', 'quotes', 'euerEntries', 'invoices'];
export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_CELL_LENGTH = 100000;
const APPLICABLE = new Set(['valid', 'warning', 'update']);

const cents = value => Math.round(Number(value || 0) * 100);
const euro = value => (cents(value) / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateKey = value => (value ? String(value).slice(0, 10) : '');

function formatDateDe(iso) {
  const [year, month, day] = String(iso || '').split('-');
  return year && month && day ? `${day}.${month}.${year}` : String(iso || '');
}

function addDays(dateValue, days) {
  const date = new Date(`${dateValue}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function entry(rowNumbers, status, messages, data = null, extra = {}) {
  const list = (Array.isArray(messages) ? messages : [messages]).filter(Boolean);
  const message = list.length ? list.map(item => (/[.!?]$/.test(item) ? item : `${item}.`)).join(' ') : '';
  return { rowNumbers, status, message, data, ...extra };
}

function rowNumber(row, index) {
  const parsed = Number(row?._rowNumber);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : index + 2;
}

function amountValue(row, names) {
  return parseNumber(pick(row, names));
}

function dateValue(row, names) {
  const raw = pick(row, names);
  return { raw, value: raw === undefined ? null : parseDate(raw) };
}

// ---------------------------------------------------------------------------
// Kunden-Zuordnung
// ---------------------------------------------------------------------------

const CUSTOMER_ID_ALIASES = ['customerId', 'customer_id', 'kundenId', 'kunden_id', 'schülerId', 'schuelerId', 'studentId', 'student_id', 'teilnehmerId'];
const CUSTOMER_NUMBER_ALIASES = ['customerNumber', 'customer_number', 'customerNo', 'customer_no', 'kundennummer', 'kundennr', 'kundenNr', 'schülernummer', 'schuelernummer', 'studentNumber', 'student_number', 'teilnehmernummer'];
const CUSTOMER_EMAIL_ALIASES = ['customerEmail', 'customer_email', 'kundenEmail', 'kundenmail', 'schülerEmail', 'schuelerEmail', 'studentEmail', 'student_email', 'teilnehmerEmail'];
const CUSTOMER_NAME_ALIASES = ['customerName', 'customer_name', 'kundenname', 'kunde', 'customer', 'mandant', 'klient', 'patient', 'schüler', 'schueler', 'schülername', 'schuelername', 'student', 'studentName', 'student_name', 'teilnehmer', 'teilnehmername', 'teilnehmer_name'];

function customerReference(row, { includeGeneric = true } = {}) {
  return {
    customerId: text(pick(row, CUSTOMER_ID_ALIASES)),
    customerNumber: text(pick(row, includeGeneric ? [...CUSTOMER_NUMBER_ALIASES, 'nummer'] : CUSTOMER_NUMBER_ALIASES)),
    customerEmail: text(pick(row, includeGeneric ? [...CUSTOMER_EMAIL_ALIASES, 'email', 'eMail', 'mail', 'emailAddress', 'email_address'] : CUSTOMER_EMAIL_ALIASES)),
    customerName: text(pick(row, includeGeneric ? [...CUSTOMER_NAME_ALIASES, 'name'] : CUSTOMER_NAME_ALIASES)),
  };
}

function hasCustomerReference(ref) {
  return Boolean(ref.customerId || ref.customerNumber || ref.customerEmail || ref.customerName);
}

function referenceLabel(ref) {
  return ref.customerName || ref.customerNumber || ref.customerEmail || ref.customerId || '';
}

function nameTokens(value) {
  return text(value).split(/[\s,;/&+()]+/).map(normaliseKey).filter(Boolean);
}

/**
 * Findet Kunden über ID, Nummer, E-Mail und Namen. Ein Namensteil ordnet nur
 * zu, wenn alle Wörter eines Namens vollständig im anderen vorkommen und das
 * Ergebnis eindeutig ist („Anna“ passt zu „Anna Müller“, nicht zu „Johanna“).
 * Auf Wunsch werden fehlende Kunden einmalig vorgemerkt und bei jeder weiteren
 * Zeile mit demselben Namen wiederverwendet.
 */
export function createCustomerDirectory(existingCustomers = [], { createMissing = false } = {}) {
  const customers = existingCustomers.map(customer => ({
    ...customer,
    numberKey: normaliseKey(customer.customerNumber),
    emailKey: normaliseKey(customer.email),
    nameKey: normaliseKey(customer.name),
    tokens: nameTokens(customer.name),
  }));
  const created = new Map();

  function findExisting(ref) {
    if (ref.customerId) {
      const match = customers.find(customer => customer.id === ref.customerId);
      if (match) return { customer: match, matchedBy: 'ID' };
    }
    if (ref.customerNumber) {
      const key = normaliseKey(ref.customerNumber);
      const match = customers.find(customer => customer.numberKey && customer.numberKey === key);
      if (match) return { customer: match, matchedBy: 'Nummer' };
    }
    if (ref.customerEmail) {
      const key = normaliseKey(ref.customerEmail);
      const match = customers.find(customer => customer.emailKey && customer.emailKey === key);
      if (match) return { customer: match, matchedBy: 'E-Mail' };
    }
    if (ref.customerName) {
      const key = normaliseKey(ref.customerName);
      const exact = customers.filter(customer => customer.nameKey === key);
      if (exact.length === 1) return { customer: exact[0], matchedBy: 'Name' };
      if (exact.length > 1) return { ambiguous: exact.length };
      const tokens = nameTokens(ref.customerName);
      if (tokens.length === 0 || tokens.every(token => token.length < 2)) return null;
      const partial = customers.filter(customer => customer.tokens.length > 0 && (
        tokens.every(token => customer.tokens.includes(token))
        || customer.tokens.every(token => tokens.includes(token))
      ));
      if (partial.length === 1) {
        const sameWords = partial[0].tokens.length === tokens.length;
        return { customer: partial[0], matchedBy: sameWords ? 'Name' : 'Namensteil', partial: !sameWords };
      }
      if (partial.length > 1) return { ambiguous: partial.length };
    }
    return null;
  }

  function createdKey(ref) {
    if (ref.customerNumber) return `number:${normaliseKey(ref.customerNumber)}`;
    if (ref.customerEmail) return `email:${normaliseKey(ref.customerEmail)}`;
    return `name:${normaliseKey(ref.customerName)}`;
  }

  function resolve(ref, currentRow) {
    if (!hasCustomerReference(ref)) return { missing: true };
    const existing = findExisting(ref);
    if (existing?.customer) return existing;
    const key = createdKey(ref);
    const byName = ref.customerName
      ? [...created.values()].find(candidate => normaliseKey(candidate.name) === normaliseKey(ref.customerName))
      : undefined;
    const pending = created.get(key) || byName;
    if (pending) {
      if (!pending.rowNumbers.includes(currentRow)) pending.rowNumbers.push(currentRow);
      return { newCustomer: pending };
    }
    if (existing?.ambiguous) return { ambiguous: existing.ambiguous, reference: referenceLabel(ref) };
    if (createMissing && ref.customerName) {
      const newCustomer = {
        key,
        name: ref.customerName,
        customerNumber: ref.customerNumber || undefined,
        email: ref.customerEmail || undefined,
        rowNumbers: [currentRow],
      };
      created.set(key, newCustomer);
      return { newCustomer, created: true };
    }
    return { notFound: true, reference: referenceLabel(ref) };
  }

  return { resolve, newCustomers: () => [...created.values()] };
}

function customerTarget(resolution) {
  if (resolution.customer) return { customerId: resolution.customer.id, customerName: resolution.customer.name };
  if (resolution.newCustomer) return { customerKey: resolution.newCustomer.key, customerName: resolution.newCustomer.name };
  return {};
}

// Neu angelegte Kunden sind eine Information, keine Warnung; eine Zuordnung
// über einen Namensteil soll dagegen geprüft werden.
function customerInfos(resolution, entityLabel) {
  if (resolution.created) return [`${entityLabel} „${resolution.newCustomer.name}“ wird neu angelegt`];
  if (resolution.newCustomer) return [`Neuer ${entityLabel} „${resolution.newCustomer.name}“`];
  return [];
}

function customerWarnings(resolution) {
  return resolution.partial ? [`Zugeordnet über Namensteil zu „${resolution.customer.name}“ – bitte prüfen`] : [];
}

function customerErrorMessage(resolution, entityLabel, context = '') {
  if (resolution.ambiguous) return `${resolution.ambiguous} ${entityLabel === 'Kunde' ? 'Kunden' : 'Einträge'} passen zu „${resolution.reference}“${context}. Bitte Nummer oder E-Mail ergänzen`;
  return `${entityLabel}${resolution.reference ? ` „${resolution.reference}“` : ''} wurde nicht gefunden${context}. Bitte zuerst anlegen oder „Fehlende anlegen“ wählen`;
}

// ---------------------------------------------------------------------------
// Kunden
// ---------------------------------------------------------------------------

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

function normaliseCustomerType(value) {
  return parseCustomerType(value) || 'person';
}

const CUSTOMER_FIELD_LABELS = {
  name: 'Name', customerType: 'Art', email: 'E-Mail', address: 'Adresse', addressSupplement: 'Adresszusatz',
  postalCode: 'PLZ', city: 'Ort', country: 'Land', taxId: 'Steuernummer', leitwegId: 'Leitweg-ID',
  phone: 'Telefon', notes: 'Notizen', isActive: 'Aktiv', additionalEmails: 'Weitere E-Mails',
  hourlyRates: 'Stundensätze', materials: 'Materialien',
};

function customerData(row) {
  const firstName = text(pick(row, ['firstName', 'first_name', 'vorname']));
  const lastName = text(pick(row, ['lastName', 'last_name', 'nachname', 'familienname']));
  const name = text(pick(row, ['name', 'customerName', 'customer_name', 'kundenname', 'kunde', 'customer', 'firma', 'company', 'schüler', 'schueler', 'teilnehmer']))
    || [firstName, lastName].filter(Boolean).join(' ');
  const street = text(pick(row, ['address', 'adresse', 'street', 'strasse', 'straße', 'anschrift']));
  const houseNumber = text(pick(row, ['houseNumber', 'house_number', 'hausnummer', 'hausnr', 'nr']));
  const data = { name };
  const assign = (key, value) => {
    if (value !== undefined && value !== null && text(value) !== '') data[key] = value;
  };
  assign('customerNumber', text(pick(row, ['customerNumber', 'customer_number', 'customerNo', 'customer_no', 'kundennummer', 'kundennr', 'nummer'])));
  const customerType = pick(row, ['customerType', 'customer_type', 'customerKind', 'customer_kind', 'kundenart', 'kundentyp', 'type', 'typ']);
  if (customerType !== undefined) data.customerType = normaliseCustomerType(customerType);
  assign('email', text(pick(row, ['email', 'eMail', 'mail', 'emailAddress', 'email_address'])));
  const additionalEmails = pick(row, ['additionalEmails', 'additional_emails', 'weitereEmails', 'weitere_eMails', 'secondaryEmail']);
  if (additionalEmails !== undefined) data.additionalEmails = additionalEmails;
  assign('address', [street, houseNumber].filter(Boolean).join(' '));
  assign('addressSupplement', text(pick(row, ['addressSupplement', 'address_supplement', 'adresszusatz', 'zusatz'])));
  assign('city', text(pick(row, ['city', 'ort', 'town', 'stadt'])));
  assign('postalCode', text(pick(row, ['postalCode', 'postal_code', 'postcode', 'zip', 'zipCode', 'plz'])));
  assign('country', text(pick(row, ['country', 'land', 'countryName'])));
  assign('taxId', text(pick(row, ['taxId', 'tax_id', 'vatId', 'vat_id', 'ustId', 'ust_id', 'ustIdNr', 'steuerId', 'steuernummer'])));
  assign('leitwegId', text(pick(row, ['leitwegId', 'leitweg_id', 'leitweg', 'buyerReference', 'buyer_reference'])));
  assign('phone', text(pick(row, ['phone', 'telephone', 'tel', 'telefon', 'mobile', 'mobil', 'handy'])));
  assign('notes', text(pick(row, ['notes', 'note', 'notizen', 'bemerkung', 'anmerkung'])));
  const active = pick(row, ['isActive', 'is_active', 'active', 'aktiv']);
  if (active !== undefined && parseBoolean(active) !== null) data.isActive = parseBoolean(active);
  const hourlyRates = pick(row, ['hourlyRates', 'hourly_rates', 'stundensaetze', 'stundensätze']);
  if (hourlyRates !== undefined) data.hourlyRates = parseStructuredArray(hourlyRates);
  const materials = pick(row, ['materials', 'materialien', 'material_templates']);
  if (materials !== undefined) data.materials = parseStructuredArray(materials);
  return data;
}

function sameValue(left, right) {
  if (typeof left === 'boolean' || typeof right === 'boolean') return Boolean(left) === Boolean(right);
  if (Array.isArray(left) || Array.isArray(right)) return JSON.stringify(left || []) === JSON.stringify(right || []);
  return text(left) === text(right);
}

function planCustomers(rows, context, options) {
  const entityLabel = context.entityLabel;
  const existing = (context.customers || []).map(customer => ({ ...customer }));
  const seen = new Set();
  const entries = [];
  rows.forEach((row, index) => {
    const currentRow = rowNumber(row, index);
    const data = customerData(row);
    const customerId = text(pick(row, ['customerId', 'customer_id', 'kundenId', 'kunden_id']));
    if (!data.name) {
      entries.push(entry([currentRow], 'error', 'Name fehlt'));
      return;
    }
    const identity = data.customerNumber ? `number:${normaliseKey(data.customerNumber)}`
      : data.email ? `email:${normaliseKey(data.email)}`
        : `name:${normaliseKey(data.name)}`;
    if (seen.has(identity)) {
      entries.push(entry([currentRow], 'duplicate', 'Doppelte Zeile in der Importdatei'));
      return;
    }
    seen.add(identity);
    const match = existing.find(customer =>
      (customerId && customer.id === customerId)
      || (data.customerNumber && normaliseKey(customer.customerNumber) === normaliseKey(data.customerNumber))
      || (data.email && normaliseKey(customer.email) === normaliseKey(data.email))
      || (!data.customerNumber && !data.email && normaliseKey(customer.name) === normaliseKey(data.name)));
    if (match) {
      if (options.duplicateMode !== 'update') {
        entries.push(entry([currentRow], 'duplicate', `${entityLabel} bereits vorhanden (${match.name})`));
        return;
      }
      // Nur zugeordnete und befüllte Spalten ändern den Bestand. Leere oder
      // fehlende Spalten lassen vorhandene Angaben unverändert.
      const changedFields = Object.keys(data)
        .filter(key => key !== 'customerNumber' && CUSTOMER_FIELD_LABELS[key])
        .filter(key => !sameValue(data[key], match[key]));
      if (changedFields.length === 0) {
        entries.push(entry([currentRow], 'duplicate', `${entityLabel} ist bereits aktuell (${match.name})`));
        return;
      }
      const changes = Object.fromEntries(changedFields.map(key => [key, data[key]]));
      entries.push(entry([currentRow], 'update', `${entityLabel} „${match.name}“ wird aktualisiert: ${changedFields.map(key => CUSTOMER_FIELD_LABELS[key]).join(', ')}`, changes, { existingId: match.id }));
      return;
    }
    const warnings = [];
    if (!data.email) warnings.push('E-Mail fehlt');
    if (!data.address || !data.city || !data.postalCode) warnings.push('Adresse ist nicht vollständig');
    existing.push({ id: `new-${currentRow}`, customerNumber: data.customerNumber || '', name: data.name, email: data.email || '' });
    entries.push(entry([currentRow], warnings.length ? 'warning' : 'valid', warnings.length ? warnings : `${entityLabel} kann angelegt werden`, {
      country: 'Deutschland',
      ...data,
    }));
  });
  return { entries };
}

// ---------------------------------------------------------------------------
// Stundensätze, Materialien und Positionsvorlagen
// ---------------------------------------------------------------------------

function planNamedPrices(rows, existingItems, options, config) {
  const existing = existingItems.map(item => ({ ...item }));
  const seen = new Set();
  const entries = [];
  rows.forEach((row, index) => {
    const currentRow = rowNumber(row, index);
    const name = text(pick(row, config.nameAliases));
    const price = amountValue(row, config.priceAliases);
    if (!name) {
      entries.push(entry([currentRow], 'error', config.nameMissing));
      return;
    }
    if (price === null || price < 0) {
      entries.push(entry([currentRow], 'error', `${config.priceLabel} ist ungültig oder fehlt`));
      return;
    }
    const identity = normaliseKey(name);
    if (seen.has(identity)) {
      entries.push(entry([currentRow], 'duplicate', 'Doppelte Zeile in der Importdatei'));
      return;
    }
    seen.add(identity);
    const match = existing.find(item => normaliseKey(item.name) === identity);
    const taxRate = amountValue(row, ['taxRate', 'tax_rate', 'tax', 'mwst', 'ust', 'steuersatz']);
    const data = {
      name,
      description: text(pick(row, ['description', 'details', 'beschreibung', 'beschreibungstext', 'leistungstext'])),
      [config.priceKey]: price,
      ...(config.defaultUnit ? { unit: text(pick(row, ['unit', 'einheit', 'unitName'])) || config.defaultUnit } : {}),
      taxRate: taxRate ?? 19,
      isDefault: parseBoolean(pick(row, ['isDefault', 'is_default', 'default', 'standard'])) === true,
    };
    if (match && options.duplicateMode === 'update') {
      entries.push(entry([currentRow], 'update', config.updateMessage, data, { existingId: match.id }));
    } else if (match) {
      entries.push(entry([currentRow], 'duplicate', config.duplicateMessage));
    } else {
      existing.push({ id: `new-${currentRow}`, name });
      entries.push(entry([currentRow], 'valid', config.validMessage, data));
    }
  });
  return { entries };
}

const PRICE_CONFIG = {
  hourlyRates: {
    nameAliases: ['name', 'title', 'bezeichnung', 'stundensatz', 'rateName'],
    priceAliases: ['rate', 'hourlyRate', 'hourly_rate', 'preis', 'price', 'betrag', 'proStunde', 'honorar'],
    priceKey: 'rate', priceLabel: 'Stundensatz', defaultUnit: null,
    nameMissing: 'Name fehlt', updateMessage: 'Bestehender Eintrag wird aktualisiert',
    duplicateMessage: 'Eintrag mit diesem Namen bereits vorhanden', validMessage: 'Eintrag kann angelegt werden',
  },
  materials: {
    nameAliases: ['name', 'title', 'bezeichnung', 'material', 'artikel'],
    priceAliases: ['unitPrice', 'unit_price', 'price', 'preis', 'einzelpreis', 'betrag'],
    priceKey: 'unitPrice', priceLabel: 'Preis', defaultUnit: 'Stück',
    nameMissing: 'Name fehlt', updateMessage: 'Bestehender Eintrag wird aktualisiert',
    duplicateMessage: 'Eintrag mit diesem Namen bereits vorhanden', validMessage: 'Eintrag kann angelegt werden',
  },
  positions: {
    nameAliases: ['name', 'title', 'bezeichnung', 'position', 'beschreibung'],
    priceAliases: ['unitPrice', 'unit_price', 'price', 'preis', 'einzelpreis', 'betrag'],
    priceKey: 'unitPrice', priceLabel: 'Preis der Positionsvorlage', defaultUnit: 'Stunde',
    nameMissing: 'Name der Positionsvorlage fehlt', updateMessage: 'Bestehende Positionsvorlage wird aktualisiert',
    duplicateMessage: 'Positionsvorlage mit diesem Namen bereits vorhanden', validMessage: 'Positionsvorlage kann angelegt werden',
  },
};

// ---------------------------------------------------------------------------
// Aufträge, Unterricht und Kurse
// ---------------------------------------------------------------------------

function normaliseTimeEntries(value, taxRate) {
  return parseStructuredArray(value).map((item, index) => {
    const hours = parseNumber(pick(item, ['hoursWorked', 'hours_worked', 'hours', 'stunden'])) ?? 0;
    const rate = parseNumber(pick(item, ['hourlyRate', 'hourly_rate', 'rate', 'stundensatz'])) ?? 0;
    return {
      description: text(pick(item, ['description', 'beschreibung', 'name'])) || `Arbeitszeit ${index + 1}`,
      startTime: parseTime(pick(item, ['startTime', 'start_time', 'start', 'von'])),
      endTime: parseTime(pick(item, ['endTime', 'end_time', 'end', 'bis'])),
      hoursWorked: hours,
      hourlyRate: rate,
      hourlyRateId: text(pick(item, ['hourlyRateId', 'hourly_rate_id', 'stundensatzId'])) || null,
      taxRate: parseNumber(pick(item, ['taxRate', 'tax_rate', 'mwst', 'ust'])) ?? taxRate,
      total: parseNumber(pick(item, ['total', 'amount', 'betrag'])) ?? roundMoney(hours * rate),
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
      total: parseNumber(pick(item, ['total', 'amount', 'betrag'])) ?? roundMoney(quantity * unitPrice),
      unit: text(pick(item, ['unit', 'einheit'])) || 'Stück',
      templateId: text(pick(item, ['templateId', 'template_id'])) || undefined,
    };
  }).filter(item => item.description);
}

function normalisePriority(value) {
  const source = normaliseKey(value);
  if (['hoch', 'high', 'dringend', 'wichtig'].includes(source)) return 'high';
  if (['niedrig', 'low', 'gering'].includes(source)) return 'low';
  return 'medium';
}

function daysBetween(start, end) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
}

function monthsBetween(start, end) {
  const [sy, sm] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  return (ey - sy) * 12 + (em - sm);
}

function planRecurrence(row, startDate) {
  const repeatRaw = pick(row, ['repeat', 'recurrence', 'wiederholung', 'rhythmus', 'turnus', 'intervall']);
  if (repeatRaw === undefined) return { rule: null };
  const repeat = parseRepeatInterval(repeatRaw);
  if (repeat === undefined) return { error: `Wiederholung „${text(repeatRaw)}“ ist unbekannt (wöchentlich, 14-tägig oder monatlich)` };
  if (!repeat || !repeat.intervalUnit) return { rule: null };
  const untilRaw = pick(row, ['repeatUntil', 'repeat_until', 'wiederholenBis', 'serieBis', 'enddatum', 'endDate']);
  const until = untilRaw === undefined ? null : parseDate(untilRaw);
  const count = parseNumber(pick(row, ['repeatCount', 'repeat_count', 'anzahlTermine', 'termine']));
  if (untilRaw !== undefined && !until) return { error: 'Das Enddatum der Wiederholung ist ungültig' };
  if (!until && (!count || count < 1)) return { error: 'Für eine Wiederholung fehlt das Enddatum oder die Anzahl der Termine' };
  let duration;
  if (until) {
    if (until < startDate) return { error: 'Das Enddatum der Wiederholung liegt vor dem ersten Termin' };
    duration = repeat.intervalUnit === 'week'
      ? Math.floor(daysBetween(startDate, until) / 7) + 1
      : monthsBetween(startDate, until) + 1;
  } else {
    duration = Math.round(count) * repeat.interval;
  }
  try {
    const rule = normalizeRecurrence({ intervalUnit: repeat.intervalUnit, interval: repeat.interval, startDate, duration });
    const dates = expandRecurrence(rule).filter(date => !until || date <= until);
    const limited = count && !until ? dates.slice(0, Math.round(count)) : dates;
    if (limited.length === 0) return { error: 'Die Wiederholung erzeugt keinen Termin' };
    return { rule, dates: limited };
  } catch (error) {
    return { error: error.message === 'Ungültige Wiederholungsdauer' || error.message === 'Ungültiges Wiederholungsintervall'
      ? 'Die Wiederholung ist zu lang (höchstens 104 Wochen bzw. 120 Monate)'
      : error.message };
  }
}

function jobIdentity(customerKey, date, startTime, title) {
  return `${customerKey}|${date}|${startTime || ''}|${normaliseKey(title)}`;
}

function planJobs(rows, context, options) {
  const entityLabel = context.entityLabel;
  const directory = createCustomerDirectory(context.customers, { createMissing: options.createMissingCustomers });
  const existingJobs = context.jobs || [];
  const jobNumbers = new Set(existingJobs.map(job => normaliseKey(job.jobNumber)).filter(Boolean));
  const externalNumbers = new Set(existingJobs.map(job => normaliseKey(job.externalJobNumber)).filter(Boolean));
  const existingIdentities = new Map();
  existingJobs.forEach(job => {
    const key = jobIdentity(job.customerId, dateKey(job.date), job.startTime ? String(job.startTime).slice(0, 5) : '', job.title);
    existingIdentities.set(key, (existingIdentities.get(key) || 0) + 1);
  });
  const fileIdentities = new Map();
  const entries = [];

  rows.forEach((row, index) => {
    const currentRow = rowNumber(row, index);
    const messages = [];
    const infos = [];
    const ref = customerReference(row);
    const resolution = directory.resolve(ref, currentRow);
    if (resolution.missing) {
      entries.push(entry([currentRow], 'error', `${entityLabel}-Bezug fehlt`));
      return;
    }
    if (!resolution.customer && !resolution.newCustomer) {
      entries.push(entry([currentRow], 'error', customerErrorMessage(resolution, entityLabel)));
      return;
    }
    const date = dateValue(row, ['date', 'jobDate', 'job_date', 'datum', 'auftragsdatum', 'termin', 'kursdatum', 'unterrichtsdatum']);
    if (!date.value) {
      entries.push(entry([currentRow], 'error', date.raw === undefined ? 'Datum fehlt' : `Datum „${text(date.raw)}“ ist ungültig`));
      return;
    }
    let title = text(pick(row, ['title', 'jobTitle', 'job_title', 'auftrag', 'auftragtitel', 'bezeichnung', 'kurs', 'kursname', 'fach']));
    const rawDescription = text(pick(row, ['description', 'details', 'beschreibung', 'leistungstext', 'inhalt', 'thema']));
    if (!title) {
      title = rawDescription || context.workLabel || 'Auftrag';
      infos.push(`Titel wird als „${title}“ übernommen`);
    }
    const jobNumber = text(pick(row, ['jobNumber', 'job_number', 'orderNumber', 'order_number', 'auftragsnummer', 'auftragsnr']));
    const externalJobNumber = text(pick(row, ['externalJobNumber', 'external_job_number', 'externalNumber', 'extern', 'externeAuftragsnummer']));
    if ((jobNumber && jobNumbers.has(normaliseKey(jobNumber))) || (externalJobNumber && externalNumbers.has(normaliseKey(externalJobNumber)))) {
      entries.push(entry([currentRow], 'duplicate', `Bereits vorhanden (${jobNumber || externalJobNumber})`));
      return;
    }
    const startTime = parseTime(pick(row, ['startTime', 'start_time', 'start', 'beginn', 'von', 'uhrzeit']));
    const endTime = parseTime(pick(row, ['endTime', 'end_time', 'ende', 'bis', 'endeUhrzeit']));
    const recurrence = planRecurrence(row, date.value);
    if (recurrence.error) {
      entries.push(entry([currentRow], 'error', recurrence.error));
      return;
    }
    const customerKey = resolution.customer ? resolution.customer.id : `new:${resolution.newCustomer.key}`;
    if (!jobNumber && !externalJobNumber) {
      const identity = jobIdentity(customerKey, date.value, startTime, title);
      const available = existingIdentities.get(identity) || 0;
      if (available > 0) {
        existingIdentities.set(identity, available - 1);
        entries.push(entry([currentRow], 'duplicate', `Am ${formatDateDe(date.value)} gibt es bereits „${title}“ für ${resolution.customer?.name || resolution.newCustomer?.name}`));
        return;
      }
      const inFile = fileIdentities.get(identity) || 0;
      if (inFile > 0) messages.push('Gleicher Termin kommt mehrfach in der Datei vor');
      fileIdentities.set(identity, inFile + 1);
    }
    if (jobNumber) jobNumbers.add(normaliseKey(jobNumber));
    if (externalJobNumber) externalNumbers.add(normaliseKey(externalJobNumber));

    const hoursWorked = amountValue(row, ['hoursWorked', 'hours_worked', 'hours', 'stunden', 'arbeitszeit', 'dauer', 'std']) ?? 0;
    const hourlyRate = amountValue(row, ['hourlyRate', 'hourly_rate', 'rate', 'stundensatz', 'proStunde', 'preisProStunde', 'honorar', 'satz']) ?? 0;
    const taxRate = amountValue(row, ['taxRate', 'tax_rate', 'mwst', 'ust', 'steuersatz']);
    const rawStatus = pick(row, ['status', 'auftragsstatus', 'kursstatus']);
    const status = parseJobStatus(rawStatus);
    if (rawStatus === undefined) messages.push('Status wird auf Entwurf gesetzt');
    else if (!status) messages.push(`Status „${text(rawStatus)}“ ist unbekannt und wird auf Entwurf gesetzt`);
    messages.push(...customerWarnings(resolution));
    infos.push(...customerInfos(resolution, entityLabel));
    if (recurrence.rule) infos.unshift(`Serie mit ${recurrence.dates.length} Terminen bis ${formatDateDe(recurrence.dates[recurrence.dates.length - 1])}`);
    const data = {
      jobNumber: jobNumber || undefined,
      externalJobNumber: externalJobNumber || undefined,
      ...customerTarget(resolution),
      customerAddress: text(pick(row, ['customerAddress', 'customer_address', 'kundenadresse'])) || resolution.customer?.address || '',
      location: text(pick(row, ['location', 'ausführungsort', 'ausfuehrungsort', 'executionLocation', 'einsatzort', 'ort', 'raum'])) || undefined,
      title,
      description: rawDescription || title,
      date: date.value,
      startTime,
      endTime,
      hoursWorked,
      hourlyRate,
      taxRate: taxRate ?? 19,
      hourlyRateId: text(pick(row, ['hourlyRateId', 'hourly_rate_id', 'stundensatzId'])) || null,
      timeEntries: normaliseTimeEntries(pick(row, ['timeEntries', 'time_entries', 'zeiten', 'zeitpositionen']), taxRate ?? 19),
      materials: normaliseMaterials(pick(row, ['materials', 'materialien', 'materialItems', 'material_items'])),
      status: status || 'draft',
      notes: text(pick(row, ['notes', 'note', 'notizen', 'bemerkung', 'anmerkung'])),
      priority: normalisePriority(pick(row, ['priority', 'prioritaet', 'priorität', 'dringlichkeit'])),
      ...(recurrence.rule ? { recurrence: recurrence.rule, occurrenceDates: recurrence.dates } : {}),
    };
    entries.push(entry([currentRow], messages.length ? 'warning' : 'valid', messages.length || infos.length ? [...infos, ...messages] : 'Kann angelegt werden', data));
  });
  return { entries, newCustomers: directory.newCustomers() };
}

// ---------------------------------------------------------------------------
// Angebote und übernommene Rechnungen (mehrere Zeilen je Nummer)
// ---------------------------------------------------------------------------

function normaliseDiscountType(value) {
  const source = normaliseKey(value);
  if (['percentage', 'percent', 'prozent', 'prozentsatz'].includes(source) || text(value) === '%') return 'percentage';
  if (['fixed', 'betrag', 'festbetrag', 'euro', 'eur'].includes(source)) return 'fixed';
  return null;
}

function documentItems(rows, { defaultTaxRate = 19 } = {}) {
  const items = [];
  const warnings = [];
  rows.forEach(row => {
    parseStructuredArray(pick(row, ['items', 'positionen', 'positions', 'lineItems', 'line_items'])).forEach((item, index) => {
      const description = text(pick(item, ['description', 'beschreibung', 'name', 'position', 'item']));
      const quantity = parseNumber(pick(item, ['quantity', 'menge', 'anzahl'])) ?? 1;
      const unitPrice = parseNumber(pick(item, ['unitPrice', 'unit_price', 'price', 'preis', 'einzelpreis']));
      if (!description || unitPrice === null || unitPrice < 0) {
        warnings.push(`JSON-Position ${index + 1} ist unvollständig`);
        return;
      }
      items.push({
        description, quantity, unitPrice,
        taxRate: parseNumber(pick(item, ['taxRate', 'tax_rate', 'tax', 'mwst', 'ust', 'steuersatz'])) ?? defaultTaxRate,
        discountType: normaliseDiscountType(pick(item, ['discountType', 'discount_type'])),
        discountValue: parseNumber(pick(item, ['discountValue', 'discount_value'])),
        discountAmount: parseNumber(pick(item, ['discountAmount', 'discount_amount'])),
        order: items.length + 1,
      });
    });
    const description = text(pick(row, ['itemDescription', 'item_description', 'position', 'positionsbeschreibung', 'leistungsbeschreibung', 'artikel', 'article', 'item', 'leistung']));
    const itemQuantity = parseNumber(pick(row, ['itemQuantity', 'item_quantity', 'positionsmenge', 'menge', 'quantity', 'anzahl']));
    const itemUnitPrice = parseNumber(pick(row, ['itemUnitPrice', 'item_unit_price', 'positionspreis', 'einzelpreis', 'unitPrice', 'unit_price', 'price']));
    if (description || itemQuantity !== null || itemUnitPrice !== null) {
      if (!description || itemUnitPrice === null || itemUnitPrice < 0) {
        warnings.push('Eine tabellarische Position ist unvollständig');
      } else {
        items.push({
          description,
          quantity: itemQuantity ?? 1,
          unitPrice: itemUnitPrice,
          taxRate: parseNumber(pick(row, ['itemTaxRate', 'item_tax_rate', 'positionTaxRate', 'steuersatz', 'mwst', 'ust', 'taxRate', 'tax_rate'])) ?? defaultTaxRate,
          order: items.length + 1,
        });
      }
    }
  });
  return { items, warnings };
}

function groupRowsByNumber(rows, numberAliases) {
  const groups = new Map();
  rows.forEach((row, index) => {
    const currentRow = rowNumber(row, index);
    const number = text(pick(row, numberAliases));
    const key = number ? normaliseKey(number) : `row-${currentRow}`;
    if (!groups.has(key)) groups.set(key, { number, rows: [] });
    groups.get(key).rows.push({ row, currentRow });
  });
  return [...groups.values()];
}

function planQuotes(rows, context, options) {
  const entityLabel = context.entityLabel;
  const directory = createCustomerDirectory(context.customers, { createMissing: options.createMissingCustomers });
  const existingNumbers = new Set((context.quotes || []).map(quote => normaliseKey(quote.quoteNumber)));
  const entries = [];
  for (const group of groupRowsByNumber(rows, ['quoteNumber', 'quote_number', 'offerNumber', 'offer_number', 'angebotsnummer', 'angebotsnr'])) {
    const firstRow = group.rows[0].row;
    const rowNumbers = group.rows.map(item => item.currentRow);
    const resolution = directory.resolve(customerReference(firstRow), rowNumbers[0]);
    if (!resolution.customer && !resolution.newCustomer) {
      entries.push(entry(rowNumbers, 'error', resolution.missing ? `${entityLabel}-Bezug fehlt` : customerErrorMessage(resolution, entityLabel, ' für das Angebot')));
      continue;
    }
    if (group.number && existingNumbers.has(normaliseKey(group.number))) {
      entries.push(entry(rowNumbers, 'duplicate', `Angebot bereits vorhanden (${group.number})`));
      continue;
    }
    const itemResult = documentItems(group.rows.map(item => item.row));
    let items = itemResult.items;
    const warnings = [...itemResult.warnings];
    if (items.length === 0) {
      const fallbackTotal = amountValue(firstRow, ['total', 'grossAmount', 'gross_amount', 'brutto', 'gesamtbetrag', 'endbetrag']);
      if (fallbackTotal !== null && fallbackTotal >= 0) {
        const fallbackTaxRate = amountValue(firstRow, ['itemTaxRate', 'item_tax_rate', 'taxRate', 'tax_rate', 'mwst', 'ust']) ?? 19;
        const fallbackNet = amountValue(firstRow, ['subtotal', 'sub_total', 'netto', 'netAmount', 'net_amount', 'nettobetrag']) ?? fallbackTotal / (1 + fallbackTaxRate / 100);
        items = [{ description: 'Importierter Gesamtbetrag', quantity: 1, unitPrice: roundMoney(fallbackNet), taxRate: fallbackTaxRate, order: 1 }];
        warnings.push('Keine Einzelposition gefunden; eine Position aus der Gesamtsumme wurde erzeugt');
      }
    }
    if (items.length === 0) {
      entries.push(entry(rowNumbers, 'error', 'Keine gültige Position gefunden'));
      continue;
    }
    const issueRaw = pick(firstRow, ['issueDate', 'issue_date', 'offerDate', 'angebotsdatum', 'ausstellungsdatum', 'datum']);
    const issueDate = issueRaw === undefined ? context.today : parseDate(issueRaw);
    if (!issueDate) {
      entries.push(entry(rowNumbers, 'error', `Angebotsdatum „${text(issueRaw)}“ ist ungültig`));
      continue;
    }
    const validRaw = pick(firstRow, ['validUntil', 'valid_until', 'expirationDate', 'gueltigBis', 'gültigBis', 'gueltig', 'gültig']);
    const validUntil = validRaw === undefined ? addDays(issueDate, 30) : parseDate(validRaw);
    if (!validUntil) {
      entries.push(entry(rowNumbers, 'error', `„Gültig bis“ („${text(validRaw)}“) ist ungültig`));
      continue;
    }
    if (issueRaw === undefined) warnings.push('Ausstellungsdatum wird auf heute gesetzt');
    if (validRaw === undefined) warnings.push('Gültigkeit wird auf 30 Tage gesetzt');
    let calculated;
    try {
      calculated = calculateDocumentMoney({
        items,
        globalDiscountType: normaliseDiscountType(pick(firstRow, ['globalDiscountType', 'global_discount_type', 'rabattTyp', 'rabattart'])),
        globalDiscountValue: amountValue(firstRow, ['globalDiscountValue', 'global_discount_value', 'rabattWert', 'rabattwert']) ?? 0,
        globalDiscountAmount: amountValue(firstRow, ['globalDiscountAmount', 'global_discount_amount', 'rabattBetrag', 'rabattbetrag']) ?? 0,
      }, { documentType: 'quote' });
    } catch (error) {
      entries.push(entry(rowNumbers, 'error', error.message));
      continue;
    }
    const claimedTotal = amountValue(firstRow, ['total', 'grossAmount', 'gross_amount', 'brutto', 'gesamtbetrag', 'endbetrag']);
    if (claimedTotal !== null && Math.abs(claimedTotal - calculated.total) > 0.005) warnings.push('Die angegebene Gesamtsumme weicht von den Positionen ab; übernommen wird der berechnete Betrag');
    const rawStatus = pick(firstRow, ['status', 'angebotsstatus']);
    const status = parseQuoteStatus(rawStatus);
    if (!status) warnings.push('Status wird auf Entwurf gesetzt');
    warnings.push(...customerWarnings(resolution));
    const infos = customerInfos(resolution, entityLabel);
    if (group.number) existingNumbers.add(normaliseKey(group.number));
    entries.push(entry(rowNumbers, warnings.length ? 'warning' : 'valid', warnings.length || infos.length ? [...infos, ...warnings] : 'Angebot kann angelegt werden', {
      quoteNumber: group.number || undefined,
      ...customerTarget(resolution),
      issueDate,
      validUntil,
      status: status || 'draft',
      notes: text(pick(firstRow, ['notes', 'note', 'notizen', 'bemerkung', 'anmerkung'])),
      ...calculated,
      items: calculated.items.map((item, index) => ({ ...item, order: index + 1 })),
    }));
  }
  return { entries, newCustomers: directory.newCustomers() };
}

// ---------------------------------------------------------------------------
// Rechnungsbestand, Zahlungen und EÜR
// ---------------------------------------------------------------------------

function invoiceLedger(context) {
  const invoices = (context.invoices || []).filter(invoice => (invoice.documentType || 'invoice') === 'invoice');
  const paidCents = new Map();
  (context.euerEntries || []).forEach(item => {
    if (item.sourceType === 'invoice_payment' && item.sourceId && (item.status || 'active') === 'active') {
      paidCents.set(item.sourceId, (paidCents.get(item.sourceId) || 0) + cents(item.amount));
    }
  });
  const byNumber = new Map(invoices.map(invoice => [normaliseKey(invoice.invoiceNumber), invoice]));
  const remaining = invoice => Math.max(0, cents(invoice.total) - (paidCents.get(invoice.id) || 0));
  const allocate = (invoice, amountCents) => paidCents.set(invoice.id, (paidCents.get(invoice.id) || 0) + amountCents);
  const taxRate = invoice => effectiveTaxRate(invoice.itemTaxRates, invoice.total, invoice.taxAmount);
  return { invoices, byNumber, remaining, allocate, taxRate };
}

// Ein einheitlicher Positionssteuersatz wird unverändert übernommen; bei
// gemischten Sätzen bleibt nur der rechnerische Durchschnitt.
function effectiveTaxRate(itemTaxRates, total, taxAmount) {
  const rates = [...new Set((itemTaxRates || []).map(Number).filter(Number.isFinite))];
  if (rates.length === 1) return rates[0];
  const net = Number(total || 0) - Number(taxAmount || 0);
  return net > 0 ? Math.round(Number(taxAmount || 0) / net * 10000) / 100 : 0;
}

const INVOICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVOICE_NUMBER_ALIASES = ['invoiceNumber', 'invoice_number', 'rechnungsnummer', 'rechnungsnr', 'rechnungsNr', 're_nr', 'renr', 'belegnummer', 'belegnr', 'rechnung'];

function invoiceHasServiceDate(invoice, serviceDate) {
  if (!serviceDate) return true;
  return [invoice.issueDate, invoice.serviceDate, ...(invoice.jobDates || [])]
    .some(value => value && dateKey(value) === serviceDate);
}

function planInvoicePayments(rows, context) {
  const ledger = invoiceLedger(context);
  // Dubletten: gleiche Rechnung, gleiches Datum, gleicher Betrag. Vorhandene
  // Zahlungen werden gezählt, damit zwei echte gleiche Zahlungen möglich bleiben.
  const existingExternal = new Set();
  const existingKeys = new Map();
  (context.euerEntries || []).forEach(item => {
    if (item.sourceType !== 'invoice_payment' || (item.status || 'active') !== 'active') return;
    if (item.externalReference) existingExternal.add(normaliseKey(item.externalReference));
    if (item.sourceId) {
      const key = `${item.sourceId}|${dateKey(item.entryDate)}|${cents(item.amount)}`;
      existingKeys.set(key, (existingKeys.get(key) || 0) + 1);
    }
  });
  const seenExternal = new Set();
  const entries = [];

  rows.forEach((row, index) => {
    const currentRow = rowNumber(row, index);
    const date = dateValue(row, ['entryDate', 'entry_date', 'paymentDate', 'payment_date', 'zahlungsdatum', 'buchungsdatum', 'belegdatum', 'date', 'datum', 'valuta']);
    const serviceDate = parseDate(pick(row, ['serviceDate', 'service_date', 'leistungsdatum', 'unterrichtsdatum', 'kursdatum', 'jobDate', 'job_date']));
    const amount = amountValue(row, ['amount', 'paymentAmount', 'payment_amount', 'zahlungsbetrag', 'betrag', 'paidAmount', 'paid_amount', 'brutto', 'grossAmount', 'gross_amount']);
    const notes = text(pick(row, ['notes', 'note', 'notizen', 'bemerkung', 'anmerkung', 'verwendungszweck', 'zweck']));
    const externalReference = text(pick(row, ['externalReference', 'external_reference', 'externalPaymentId', 'external_payment_id', 'paymentId', 'payment_id', 'importId', 'import_id', 'importnummer']));
    if (!date.value) {
      entries.push(entry([currentRow], 'error', date.raw === undefined ? 'Zahlungsdatum fehlt' : `Zahlungsdatum „${text(date.raw)}“ ist ungültig`));
      return;
    }
    if (amount === null || amount <= 0) {
      entries.push(entry([currentRow], 'error', 'Zahlungsbetrag ist ungültig oder fehlt'));
      return;
    }
    if (notes.length > 500) {
      entries.push(entry([currentRow], 'error', 'Die Notiz darf höchstens 500 Zeichen enthalten'));
      return;
    }
    if (externalReference.length > 255) {
      entries.push(entry([currentRow], 'error', 'Die externe Zahlungs-ID darf höchstens 255 Zeichen enthalten'));
      return;
    }
    const amountCents = cents(amount);
    const invoiceId = text(pick(row, ['invoiceId', 'invoice_id', 'rechnungsId', 'rechnungs_id']));
    const invoiceNumber = text(pick(row, INVOICE_NUMBER_ALIASES));
    let invoice;
    let matchedBy;
    if (invoiceId) {
      if (!INVOICE_ID_PATTERN.test(invoiceId)) {
        entries.push(entry([currentRow], 'error', 'Die Rechnungs-ID ist ungültig'));
        return;
      }
      invoice = ledger.invoices.find(candidate => candidate.id === invoiceId);
      matchedBy = 'Rechnungs-ID';
      if (!invoice) {
        entries.push(entry([currentRow], 'error', `Rechnung mit der ID „${invoiceId}“ wurde nicht gefunden`));
        return;
      }
    } else if (invoiceNumber) {
      invoice = ledger.byNumber.get(normaliseKey(invoiceNumber));
      matchedBy = 'Rechnungsnummer';
      if (!invoice) {
        entries.push(entry([currentRow], 'error', `Rechnung „${invoiceNumber}“ wurde nicht gefunden`));
        return;
      }
    } else {
      const ref = customerReference(row);
      if (!hasCustomerReference(ref)) {
        entries.push(entry([currentRow], 'error', 'Es fehlt eine Rechnungsnummer, Rechnungs-ID oder ein Kundenbezug'));
        return;
      }
      const candidates = ledger.invoices
        .filter(candidate => (ref.customerId && candidate.customerId === ref.customerId)
          || (!ref.customerId && ref.customerNumber && normaliseKey(candidate.customerNumber) === normaliseKey(ref.customerNumber))
          || (!ref.customerId && !ref.customerNumber && ref.customerEmail && normaliseKey(candidate.customerEmail) === normaliseKey(ref.customerEmail))
          || (!ref.customerId && !ref.customerNumber && !ref.customerEmail && normaliseKey(candidate.customerName) === normaliseKey(ref.customerName)))
        .filter(candidate => cents(candidate.total) === amountCents)
        .filter(candidate => invoiceHasServiceDate(candidate, serviceDate));
      if (candidates.length !== 1) {
        entries.push(entry([currentRow], 'error', candidates.length === 0
          ? 'Keine eindeutige Rechnung über Bezug, Leistungsdatum und Betrag gefunden'
          : `${candidates.length} Rechnungen passen zu diesem Bezug und Betrag. Bitte eine Rechnungsnummer ergänzen`));
        return;
      }
      invoice = candidates[0];
      matchedBy = serviceDate ? 'Kunde, Leistungsdatum und Betrag' : 'Kunde und Betrag';
    }
    if (invoice.status === 'draft') {
      entries.push(entry([currentRow], 'error', `Für den Entwurf ${invoice.invoiceNumber} kann noch kein Zahlungseingang erfasst werden`));
      return;
    }
    const paymentKey = `${invoice.id}|${date.value}|${amountCents}`;
    const externalKey = normaliseKey(externalReference);
    if (externalReference && (existingExternal.has(externalKey) || seenExternal.has(externalKey))) {
      entries.push(entry([currentRow], 'duplicate', `Zahlung „${externalReference}“ für Rechnung ${invoice.invoiceNumber} wurde bereits importiert oder ist in der Datei doppelt enthalten`));
      return;
    }
    if (!externalReference && (existingKeys.get(paymentKey) || 0) > 0) {
      existingKeys.set(paymentKey, existingKeys.get(paymentKey) - 1);
      entries.push(entry([currentRow], 'duplicate', `Zahlung für Rechnung ${invoice.invoiceNumber} vom ${formatDateDe(date.value)} ist bereits erfasst`));
      return;
    }
    const remaining = ledger.remaining(invoice);
    if (remaining === 0) {
      entries.push(entry([currentRow], 'duplicate', `Rechnung ${invoice.invoiceNumber} ist bereits vollständig bezahlt`));
      return;
    }
    if (amountCents > remaining) {
      entries.push(entry([currentRow], 'error', `Der Betrag überschreitet den offenen Betrag von ${euro(remaining / 100)} € für Rechnung ${invoice.invoiceNumber}`));
      return;
    }
    ledger.allocate(invoice, amountCents);
    if (externalReference) seenExternal.add(externalKey);
    const warnings = [];
    if (context.cutoverDate && date.value >= context.cutoverDate) warnings.push(`Liegt am oder nach dem Stichtag ${formatDateDe(context.cutoverDate)} – ist die Zahlung schon in SoloOffice erfasst?`);
    entries.push(entry([currentRow], warnings.length ? 'warning' : 'valid', [`Zahlung für Rechnung ${invoice.invoiceNumber} kann gebucht werden (${matchedBy})`, ...warnings], {
      kind: 'payment',
      entryType: 'income',
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      entryDate: date.value,
      amount: amountCents / 100,
      taxRate: ledger.taxRate(invoice),
      notes: notes || null,
      externalReference: externalReference || null,
      customerId: invoice.customerId || null,
    }));
  });
  return { entries };
}

function euerIdentity(entryType, date, amountCents, description, customerKey) {
  return `${entryType}|${date}|${amountCents}|${normaliseKey(description)}|${customerKey || ''}`;
}

/**
 * Einnahmen und Ausgaben aus Tabellen. Jede Einnahme bekommt genau eine
 * Quelle: Gehört sie zu einer Rechnung (Rechnungsnummer oder eindeutig über
 * Kunde und Betrag), wird sie als Zahlung dieser Rechnung gebucht, sonst als
 * Einnahme ohne Rechnung. Dadurch zählt kein Geldeingang doppelt.
 */
function planEuerEntries(rows, context, options) {
  const entityLabel = context.entityLabel;
  const directory = createCustomerDirectory(context.customers, { createMissing: options.createMissingCustomers });
  const ledger = invoiceLedger(context);
  const matchOpenInvoices = options.matchOpenInvoices !== false;
  const activeEntries = (context.euerEntries || []).filter(item => (item.status || 'active') === 'active');

  const existingIdentities = new Map();
  const sameDayAmounts = new Map();
  const existingExternal = new Set();
  const existingPayments = new Map();
  activeEntries.forEach(item => {
    const itemCents = cents(item.amount);
    const date = dateKey(item.entryDate);
    if (item.externalReference) existingExternal.add(normaliseKey(item.externalReference));
    if (item.sourceType === 'invoice_payment' && item.sourceId) {
      const key = `${item.sourceId}|${date}|${itemCents}`;
      existingPayments.set(key, (existingPayments.get(key) || 0) + 1);
    }
    if (item.sourceType === 'manual' || item.sourceType === 'receipt' || !item.sourceType) {
      const key = euerIdentity(item.entryType, date, itemCents, item.description, item.customerId);
      existingIdentities.set(key, (existingIdentities.get(key) || 0) + 1);
    }
    const loose = `${item.entryType}|${date}|${itemCents}`;
    sameDayAmounts.set(loose, [...(sameDayAmounts.get(loose) || []), item]);
  });

  // Ohne Art-Spalte legen negative Beträge in der Datei die Vorzeichenregel fest.
  const hasTypeColumn = rows.some(row => pick(row, ['entryType', 'entry_type', 'art', 'typ', 'buchungsart', 'einnahmeAusgabe', 'kind']) !== undefined);
  const hasNegativeAmounts = rows.some(row => (amountValue(row, ['amount', 'betrag', 'brutto', 'grossAmount', 'gross_amount', 'summe']) ?? 0) < 0);
  const fileIdentities = new Map();
  const seenExternal = new Set();
  const entries = [];

  rows.forEach((row, index) => {
    const currentRow = rowNumber(row, index);
    const messages = [];
    const infos = [];
    const date = dateValue(row, ['entryDate', 'entry_date', 'date', 'datum', 'buchungsdatum', 'belegdatum', 'zahlungsdatum', 'valuta']);
    if (!date.value) {
      entries.push(entry([currentRow], 'error', date.raw === undefined ? 'Datum fehlt' : `Datum „${text(date.raw)}“ ist ungültig`));
      return;
    }

    const typeRaw = pick(row, ['entryType', 'entry_type', 'art', 'typ', 'buchungsart', 'einnahmeAusgabe', 'kind']);
    let entryType = typeRaw === undefined ? null : parseEntryType(typeRaw);
    if (typeRaw !== undefined && !entryType) {
      entries.push(entry([currentRow], 'error', `Art „${text(typeRaw)}“ ist weder Einnahme noch Ausgabe`));
      return;
    }
    const incomeAmount = amountValue(row, ['incomeAmount', 'income_amount', 'einnahme', 'einnahmen', 'eingang', 'einzahlung', 'gutschrift']);
    const expenseAmount = amountValue(row, ['expenseAmount', 'expense_amount', 'ausgabe', 'ausgaben', 'ausgang', 'auszahlung', 'lastschrift']);
    const quantity = amountValue(row, ['quantity', 'menge', 'anzahl', 'stunden', 'std', 'einheiten', 'hours']);
    const unitPrice = amountValue(row, ['unitPrice', 'unit_price', 'einzelpreis', 'preis', 'proStunde', 'preisProStunde', 'stundensatz', 'satz', 'honorar', 'rate']);
    const amountRaw = amountValue(row, ['amount', 'betrag', 'brutto', 'grossAmount', 'gross_amount', 'summe', 'gesamt', 'gesamtbetrag']);

    let signedAmount = null;
    if ((incomeAmount ?? 0) !== 0 && (expenseAmount ?? 0) !== 0) {
      entries.push(entry([currentRow], 'error', 'Einnahme und Ausgabe sind in derselben Zeile befüllt'));
      return;
    }
    if ((incomeAmount ?? 0) !== 0) {
      if (incomeAmount < 0) {
        entries.push(entry([currentRow], 'error', 'Negativer Betrag in der Einnahmen-Spalte. Erstattungen bitte als Ausgabe erfassen'));
        return;
      }
      entryType = entryType || 'income';
      signedAmount = incomeAmount;
    } else if ((expenseAmount ?? 0) !== 0) {
      entryType = entryType || 'expense';
      signedAmount = Math.abs(expenseAmount);
    } else if (quantity !== null && unitPrice !== null) {
      signedAmount = roundMoney(quantity * unitPrice);
      if (amountRaw !== null && Math.abs(Math.abs(amountRaw) - Math.abs(signedAmount)) > 0.005) {
        messages.push(`Betrag aus Menge × Preis (${euro(signedAmount)} €) weicht von der Betragsspalte (${euro(amountRaw)} €) ab; übernommen wird Menge × Preis`);
      }
    } else if (amountRaw !== null) {
      signedAmount = amountRaw;
    }
    if (signedAmount === null) {
      entries.push(entry([currentRow], 'error', 'Betrag fehlt oder ist ungültig'));
      return;
    }
    if (cents(signedAmount) === 0) {
      entries.push(entry([currentRow], 'error', 'Der Betrag ist 0 – die Zeile wird nicht übernommen'));
      return;
    }
    if (!entryType) {
      if (signedAmount < 0) entryType = 'expense';
      else if (hasNegativeAmounts && !hasTypeColumn) entryType = 'income';
      else {
        entries.push(entry([currentRow], 'error', 'Es ist nicht erkennbar, ob es eine Einnahme oder Ausgabe ist. Bitte die Art zuordnen oder einen festen Wert wählen'));
        return;
      }
    }
    if (entryType === 'income' && signedAmount < 0) {
      entries.push(entry([currentRow], 'error', 'Negative Einnahme. Erstattungen bitte als Ausgabe erfassen'));
      return;
    }
    const amount = roundMoney(Math.abs(signedAmount));
    const amountCents = cents(amount);

    const rawTaxRate = pick(row, ['taxRate', 'tax_rate', 'tax', 'mwst', 'ust', 'steuersatz', 'mwstSatz']);
    const taxRate = rawTaxRate === undefined ? 0 : parseNumber(rawTaxRate);
    if (taxRate === null || taxRate < 0 || taxRate > 100) {
      entries.push(entry([currentRow], 'error', 'Der MwSt.-Satz muss zwischen 0 und 100 liegen'));
      return;
    }
    const notes = text(pick(row, ['notes', 'note', 'notizen', 'bemerkung', 'anmerkung', 'kommentar']));
    const externalReference = text(pick(row, ['externalReference', 'external_reference', 'importId', 'import_id', 'buchungsId', 'transaktionsId', 'transactionId']));
    if (externalReference.length > 255) {
      entries.push(entry([currentRow], 'error', 'Die externe Buchungs-ID darf höchstens 255 Zeichen enthalten'));
      return;
    }
    if (externalReference) {
      const key = normaliseKey(externalReference);
      if (existingExternal.has(key) || seenExternal.has(key)) {
        entries.push(entry([currentRow], 'duplicate', `Buchung „${externalReference}“ wurde bereits importiert`));
        return;
      }
      seenExternal.add(key);
    }
    if (context.cutoverDate && date.value >= context.cutoverDate) {
      messages.push(`Liegt am oder nach dem Stichtag ${formatDateDe(context.cutoverDate)} – ist die Buchung schon in SoloOffice erfasst?`);
    }

    // Kundenbezug gilt nur für Einnahmen; bei Ausgaben steht dort meist ein Lieferant.
    const ref = customerReference(row, { includeGeneric: false });
    let resolution = { missing: true };
    if (entryType === 'income' && hasCustomerReference(ref)) {
      resolution = directory.resolve(ref, currentRow);
      if (resolution.ambiguous) {
        messages.push(`${resolution.ambiguous} Einträge passen zu „${resolution.reference}“ – die Einnahme wird ohne Zuordnung gebucht`);
      } else if (resolution.notFound) {
        messages.push(`${entityLabel} „${resolution.reference}“ nicht gefunden – die Einnahme wird ohne Zuordnung gebucht (oder „Fehlende anlegen“ wählen)`);
      } else {
        messages.push(...customerWarnings(resolution));
        infos.push(...customerInfos(resolution, entityLabel));
      }
    }
    const customerId = resolution.customer?.id || null;
    const customerKey = resolution.newCustomer?.key || null;

    let description = text(pick(row, ['description', 'beschreibung', 'bezeichnung', 'text', 'verwendungszweck', 'zweck', 'buchungstext', 'leistung']));
    if (!description) {
      const who = resolution.customer?.name || resolution.newCustomer?.name || (entryType === 'income' ? ref.customerName : '');
      description = [entryType === 'income' ? 'Einnahme' : 'Ausgabe', who].filter(Boolean).join(' ');
      if (quantity !== null && unitPrice !== null) description += ` (${String(quantity).replace('.', ',')} × ${euro(unitPrice)} €)`;
      infos.push(`Beschreibung wird als „${description}“ übernommen`);
    }
    if (description.length > 255) {
      entries.push(entry([currentRow], 'error', 'Die Beschreibung darf höchstens 255 Zeichen enthalten'));
      return;
    }

    // Einnahmen zu Rechnungen werden als Zahlung der Rechnung gebucht.
    if (entryType === 'income') {
      const invoiceNumber = text(pick(row, INVOICE_NUMBER_ALIASES));
      let invoice = null;
      let matchedBy = '';
      if (invoiceNumber) {
        invoice = ledger.byNumber.get(normaliseKey(invoiceNumber)) || null;
        matchedBy = 'Rechnungsnummer';
        if (!invoice) messages.push(`Rechnung „${invoiceNumber}“ ist nicht vorhanden; gebucht wird eine Einnahme ohne Rechnung`);
        else if (invoice.status === 'draft') {
          entries.push(entry([currentRow], 'error', `Rechnung ${invoice.invoiceNumber} ist noch ein Entwurf`));
          return;
        }
      } else if (matchOpenInvoices && customerId) {
        const candidates = ledger.invoices
          .filter(candidate => candidate.customerId === customerId && candidate.status !== 'draft')
          .filter(candidate => dateKey(candidate.issueDate) <= date.value)
          .filter(candidate => ledger.remaining(candidate) === amountCents)
          .sort((left, right) => dateKey(left.issueDate).localeCompare(dateKey(right.issueDate)) || text(left.invoiceNumber).localeCompare(text(right.invoiceNumber)));
        if (candidates.length > 0) {
          invoice = candidates[0];
          matchedBy = candidates.length > 1 ? `Kunde und Betrag, älteste von ${candidates.length} passenden Rechnungen` : 'Kunde und Betrag';
        }
      }
      if (invoice) {
        const paymentKey = `${invoice.id}|${date.value}|${amountCents}`;
        const available = existingPayments.get(paymentKey) || 0;
        if (available > 0) {
          existingPayments.set(paymentKey, available - 1);
          entries.push(entry([currentRow], 'duplicate', `Diese Zahlung zu Rechnung ${invoice.invoiceNumber} ist bereits erfasst`));
          return;
        }
        const remaining = ledger.remaining(invoice);
        if (remaining === 0) {
          entries.push(entry([currentRow], 'duplicate', `Rechnung ${invoice.invoiceNumber} ist bereits vollständig bezahlt`));
          return;
        }
        if (amountCents > remaining) {
          entries.push(entry([currentRow], 'error', `Der Betrag überschreitet den offenen Betrag von ${euro(remaining / 100)} € für Rechnung ${invoice.invoiceNumber}`));
          return;
        }
        ledger.allocate(invoice, amountCents);
        const autoMatched = !invoiceNumber;
        const paymentWarnings = messages;
        entries.push(entry([currentRow], autoMatched || paymentWarnings.length > 0 ? 'warning' : 'valid', [`Zahlung zu Rechnung ${invoice.invoiceNumber} (${matchedBy})`, ...paymentWarnings, ...infos], {
          kind: 'payment',
          entryType: 'income',
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          entryDate: date.value,
          amount,
          taxRate: ledger.taxRate(invoice),
          notes: notes || (description && !description.startsWith('Einnahme') ? description : null),
          externalReference: externalReference || null,
          customerId: invoice.customerId || null,
        }));
        return;
      }
    }

    const category = entryType === 'income' ? 'other_income' : (normaliseEuerCategory(pick(row, ['category', 'kategorie', 'ausgabenkategorie', 'kostenart', 'konto'])) || 'other_expense');
    if (entryType === 'expense') {
      const rawCategory = text(pick(row, ['category', 'kategorie', 'ausgabenkategorie', 'kostenart', 'konto']));
      if (!rawCategory) messages.push('Kategorie wird als sonstige Betriebsausgabe übernommen');
      else if (!normaliseEuerCategory(rawCategory)) messages.push(`Kategorie „${rawCategory}“ ist unbekannt und wird als sonstige Betriebsausgabe übernommen`);
    }
    if (rawTaxRate === undefined) messages.push('MwSt.-Satz wird mit 0 % übernommen');

    const identityCustomer = customerId || (customerKey ? `new:${customerKey}` : '');
    const identity = euerIdentity(entryType, date.value, amountCents, description, identityCustomer);
    const available = existingIdentities.get(identity) || 0;
    if (available > 0) {
      existingIdentities.set(identity, available - 1);
      entries.push(entry([currentRow], 'duplicate', `${entryType === 'income' ? 'Einnahme' : 'Ausgabe'} ist bereits vorhanden`));
      return;
    }
    const inFile = fileIdentities.get(identity) || 0;
    if (inFile > 0) messages.push('Gleiche Buchung kommt mehrfach in der Datei vor und wird mehrfach übernommen');
    fileIdentities.set(identity, inFile + 1);

    const similar = (sameDayAmounts.get(`${entryType}|${date.value}|${amountCents}`) || []);
    if (similar.length > 0) {
      const sameCustomer = customerId && similar.find(item => item.sourceType === 'invoice_payment' && item.customerId === customerId);
      if (sameCustomer) {
        entries.push(entry([currentRow], 'duplicate', 'Am selben Tag ist bereits eine Zahlung dieses Kunden über denselben Betrag erfasst'));
        return;
      }
      messages.push(`Am selben Tag gibt es bereits eine ${entryType === 'income' ? 'Einnahme' : 'Ausgabe'} über denselben Betrag („${similar[0].description}“) – bitte prüfen`);
    }

    entries.push(entry([currentRow], messages.length ? 'warning' : 'valid', messages.length || infos.length ? [...infos, ...messages] : `${entryType === 'income' ? 'Einnahme' : 'Ausgabe'} kann gebucht werden`, {
      kind: 'manual',
      entryType,
      entryDate: date.value,
      description,
      category,
      amount,
      taxRate,
      notes: notes || null,
      externalReference: externalReference || null,
      customerId,
      customerKey,
    }));
  });
  return { entries, newCustomers: directory.newCustomers() };
}

// Netto aus Brutto so bestimmen, dass die centgenaue Steuerberechnung wieder
// den übernommenen Bruttobetrag ergibt.
function netFromGross(grossCents, taxRate) {
  const base = Math.round(grossCents / (1 + taxRate / 100));
  for (const delta of [0, -1, 1, -2, 2]) {
    const net = base + delta;
    if (net + Math.round(net * taxRate / 100) === grossCents) return net;
  }
  return base;
}

/**
 * Übernommene Rechnungen aus einem anderen Programm. Sie behalten Nummer und
 * Datum, sind sofort ausgestellt und unveränderbar und werden nie von
 * SoloOffice neu gerendert. Zahlungen werden mit ihrem Zahlungsdatum gebucht.
 */
function planInvoices(rows, context, options) {
  const entityLabel = context.entityLabel;
  const directory = createCustomerDirectory(context.customers, { createMissing: options.createMissingCustomers });
  const reserved = new Set([
    ...(context.invoices || []).map(invoice => normaliseKey(invoice.invoiceNumber)),
    ...(context.reservedInvoiceNumbers || []).map(normaliseKey),
  ]);
  const defaultPaymentDays = Number.isInteger(context.defaultPaymentDays) ? context.defaultPaymentDays : 14;
  const entries = [];

  for (const group of groupRowsByNumber(rows, INVOICE_NUMBER_ALIASES)) {
    const firstRow = group.rows[0].row;
    const rowNumbers = group.rows.map(item => item.currentRow);
    const messages = [];
    const infos = [];
    if (!group.number) {
      entries.push(entry(rowNumbers, 'error', 'Rechnungsnummer fehlt. Übernommene Rechnungen behalten ihre ursprüngliche Nummer'));
      continue;
    }
    if (group.number.length > 50) {
      entries.push(entry(rowNumbers, 'error', 'Die Rechnungsnummer darf höchstens 50 Zeichen enthalten'));
      continue;
    }
    if (reserved.has(normaliseKey(group.number))) {
      entries.push(entry(rowNumbers, 'duplicate', `Rechnung ${group.number} ist bereits vorhanden`));
      continue;
    }
    const issue = dateValue(firstRow, ['issueDate', 'issue_date', 'rechnungsdatum', 'ausstellungsdatum', 'belegdatum', 'datum', 'date']);
    if (!issue.value) {
      entries.push(entry(rowNumbers, 'error', issue.raw === undefined ? 'Rechnungsdatum fehlt' : `Rechnungsdatum „${text(issue.raw)}“ ist ungültig`));
      continue;
    }
    const resolution = directory.resolve(customerReference(firstRow), rowNumbers[0]);
    if (!resolution.customer && !resolution.newCustomer) {
      entries.push(entry(rowNumbers, 'error', resolution.missing ? `${entityLabel}-Bezug fehlt` : customerErrorMessage(resolution, entityLabel)));
      continue;
    }
    messages.push(...customerWarnings(resolution));
    infos.push(...customerInfos(resolution, entityLabel));

    const defaultTaxRate = amountValue(firstRow, ['taxRate', 'tax_rate', 'mwst', 'ust', 'steuersatz', 'mwstSatz']);
    const itemResult = documentItems(group.rows.map(item => item.row), { defaultTaxRate: defaultTaxRate ?? 0 });
    const items = itemResult.items;
    messages.push(...itemResult.warnings);
    const grossAliases = ['total', 'grossAmount', 'gross_amount', 'brutto', 'bruttobetrag', 'gesamtbetrag', 'endbetrag', 'rechnungsbetrag', 'betrag', 'amount'];
    // Bei Einzelpositionen steht der Rechnungsbetrag meist in jeder Zeile gleich
    // (Kopfdaten), bei Sammelpositionen je Zeile ein Teilbetrag.
    let claimedGross = amountValue(firstRow, grossAliases);
    if (items.length === 0) {
      const rowGrossValues = group.rows.map(({ row }) => amountValue(row, grossAliases));
      claimedGross = rowGrossValues.every(value => value !== null) ? roundMoney(rowGrossValues.reduce((sum, value) => sum + value, 0)) : null;
      // Ohne Einzelpositionen entsteht je Zeile eine Sammelposition je Steuersatz.
      for (const { row } of group.rows) {
        const rowGross = amountValue(row, ['total', 'grossAmount', 'gross_amount', 'brutto', 'bruttobetrag', 'gesamtbetrag', 'endbetrag', 'rechnungsbetrag', 'betrag', 'amount']);
        const rowNet = amountValue(row, ['subtotal', 'netAmount', 'net_amount', 'netto', 'nettobetrag']);
        const rowTax = amountValue(row, ['taxAmount', 'tax_amount', 'steuerbetrag', 'mwstBetrag', 'ustBetrag']);
        let rate = amountValue(row, ['taxRate', 'tax_rate', 'mwst', 'ust', 'steuersatz', 'mwstSatz']);
        if (rate === null && rowNet !== null && rowTax !== null && rowNet > 0) rate = Math.round(rowTax / rowNet * 100);
        if (rate === null && rowNet !== null && rowGross !== null && rowNet > 0) rate = Math.round((rowGross - rowNet) / rowNet * 100);
        if (rate === null) {
          rate = 0;
          if (rowGross !== null || rowNet !== null) messages.push('Ohne Steuersatz wird 0 % angenommen');
        }
        let netCents = null;
        if (rowNet !== null) netCents = cents(rowNet);
        else if (rowGross !== null) netCents = netFromGross(cents(rowGross), rate);
        if (netCents === null) continue;
        items.push({ description: `Rechnung ${group.number}${rate ? ` (${String(rate).replace('.', ',')} %)` : ''}`, quantity: 1, unitPrice: netCents / 100, taxRate: rate, order: items.length + 1 });
      }
      if (items.length > 0) infos.push('Ohne Einzelpositionen wird je Steuersatz eine Sammelposition angelegt');
    }
    if (items.length === 0) {
      entries.push(entry(rowNumbers, 'error', 'Weder Positionen noch Rechnungsbetrag gefunden'));
      continue;
    }
    let calculated;
    try {
      calculated = calculateDocumentMoney({ items }, { documentType: 'invoice' });
    } catch (error) {
      entries.push(entry(rowNumbers, 'error', error.message));
      continue;
    }
    if (claimedGross !== null && Math.abs(claimedGross - calculated.total) > 0.015) {
      entries.push(entry(rowNumbers, 'error', `Der Rechnungsbetrag ${euro(claimedGross)} € passt nicht zu den Positionen (${euro(calculated.total)} €). Bitte Netto, Steuersatz oder Positionen prüfen`));
      continue;
    }
    if (calculated.total <= 0) {
      entries.push(entry(rowNumbers, 'error', 'Der Rechnungsbetrag muss größer als 0 sein. Gutschriften werden derzeit nicht übernommen'));
      continue;
    }

    const dueRaw = pick(firstRow, ['dueDate', 'due_date', 'faelligkeit', 'fälligkeit', 'faelligAm', 'fälligAm', 'zahlungsziel']);
    const dueDate = dueRaw === undefined ? addDays(issue.value, defaultPaymentDays) : parseDate(dueRaw);
    if (!dueDate) {
      entries.push(entry(rowNumbers, 'error', `Fälligkeit „${text(dueRaw)}“ ist ungültig`));
      continue;
    }
    const serviceRaw = pick(firstRow, ['serviceDate', 'service_date', 'leistungsdatum', 'leistungszeitraum']);
    const serviceDate = serviceRaw === undefined ? null : parseDate(serviceRaw);
    if (serviceRaw !== undefined && !serviceDate) messages.push(`Leistungsdatum „${text(serviceRaw)}“ wird nicht übernommen`);

    // Zahlungsangaben: Datum, Betrag und/oder Status aus dem Altsystem.
    const paidRaw = pick(firstRow, ['paidDate', 'paid_date', 'paymentDate', 'payment_date', 'zahlungsdatum', 'bezahltAm', 'zahlungseingang', 'eingangsdatum']);
    const paidDate = paidRaw === undefined ? null : parseDate(paidRaw);
    if (paidRaw !== undefined && !paidDate) {
      entries.push(entry(rowNumbers, 'error', `Zahlungsdatum „${text(paidRaw)}“ ist ungültig`));
      continue;
    }
    const paidAmountRaw = amountValue(firstRow, ['paidAmount', 'paid_amount', 'bezahlt', 'bezahlterBetrag', 'zahlungsbetrag', 'gezahlt']);
    const statusRaw = pick(firstRow, ['status', 'zahlungsstatus', 'paymentStatus', 'payment_status']);
    const paymentStatus = statusRaw === undefined ? null : parsePaymentStatus(statusRaw);
    if (statusRaw !== undefined && !paymentStatus) messages.push(`Status „${text(statusRaw)}“ ist unbekannt; die Rechnung gilt als offen`);
    const totalCents = cents(calculated.total);
    let paymentCents = 0;
    let paymentDate = null;
    if (paidDate || paidAmountRaw !== null || paymentStatus === 'paid') {
      paymentCents = paidAmountRaw !== null ? cents(paidAmountRaw) : (paymentStatus === 'open' ? 0 : totalCents);
      paymentDate = paidDate;
      if (paymentCents > 0 && !paymentDate) {
        paymentDate = issue.value;
        messages.push('Zahlungsdatum fehlt – das Rechnungsdatum wird als Zahlungsdatum verwendet. Für die EÜR zählt das tatsächliche Zahlungsdatum');
      }
      if (paymentCents > totalCents) {
        entries.push(entry(rowNumbers, 'error', `Der bezahlte Betrag ${euro(paymentCents / 100)} € übersteigt den Rechnungsbetrag`));
        continue;
      }
      if (paymentDate && paymentDate < issue.value) messages.push('Das Zahlungsdatum liegt vor dem Rechnungsdatum');
    }
    const status = paymentCents >= totalCents ? 'paid' : dueDate < context.today ? 'overdue' : 'sent';
    if (paymentCents > 0 && paymentCents < totalCents) messages.push(`Teilzahlung ${euro(paymentCents / 100)} € – offen bleiben ${euro((totalCents - paymentCents) / 100)} €`);
    if (context.cutoverDate && issue.value >= context.cutoverDate) messages.push(`Liegt am oder nach dem Stichtag ${formatDateDe(context.cutoverDate)} – ist die Rechnung schon in SoloOffice erfasst?`);
    reserved.add(normaliseKey(group.number));
    entries.push(entry(rowNumbers, messages.length ? 'warning' : 'valid', [
      `Rechnung ${group.number} über ${euro(calculated.total)} € wird übernommen${status === 'paid' ? ' (bezahlt)' : status === 'overdue' ? ' (überfällig)' : ' (offen)'}`,
      ...infos,
      ...messages,
    ], {
      invoiceNumber: group.number,
      ...customerTarget(resolution),
      issueDate: issue.value,
      dueDate,
      serviceDate,
      notes: text(pick(firstRow, ['notes', 'note', 'notizen', 'bemerkung', 'anmerkung'])),
      status,
      items: calculated.items.map((item, index) => ({ ...item, order: index + 1 })),
      subtotal: calculated.subtotal,
      taxAmount: calculated.taxAmount,
      total: calculated.total,
      payment: paymentCents > 0 ? {
        entryDate: paymentDate,
        amount: paymentCents / 100,
        taxRate: effectiveTaxRate(calculated.items.map(item => item.taxRate), calculated.total, calculated.taxAmount),
      } : null,
    }));
  }
  return { entries, newCustomers: directory.newCustomers() };
}

// ---------------------------------------------------------------------------
// Einstieg, Zusammenfassung und Summenkontrolle
// ---------------------------------------------------------------------------

export function planImport(resource, rows, context, options = {}) {
  const normalisedOptions = {
    duplicateMode: options.duplicateMode === 'update' && UPDATEABLE_IMPORT_RESOURCES.includes(resource) ? 'update' : 'skip',
    createMissingCustomers: options.createMissingCustomers === true && CUSTOMER_CREATING_RESOURCES.includes(resource),
    matchOpenInvoices: options.matchOpenInvoices !== false,
  };
  const fullContext = { entityLabel: 'Kunde', today: new Date().toISOString().slice(0, 10), ...context };
  let plan;
  switch (resource) {
    case 'customers': plan = planCustomers(rows, fullContext, normalisedOptions); break;
    case 'jobs': plan = planJobs(rows, fullContext, normalisedOptions); break;
    case 'quotes': plan = planQuotes(rows, fullContext, normalisedOptions); break;
    case 'positions': plan = planNamedPrices(rows, fullContext.positionTemplates || [], normalisedOptions, PRICE_CONFIG.positions); break;
    case 'hourlyRates': plan = planNamedPrices(rows, fullContext.hourlyRates || [], normalisedOptions, PRICE_CONFIG.hourlyRates); break;
    case 'materials': plan = planNamedPrices(rows, fullContext.materials || [], normalisedOptions, PRICE_CONFIG.materials); break;
    case 'euerEntries': plan = planEuerEntries(rows, fullContext, normalisedOptions); break;
    case 'invoicePayments': plan = planInvoicePayments(rows, fullContext, normalisedOptions); break;
    case 'invoices': plan = planInvoices(rows, fullContext, normalisedOptions); break;
    default: throw new Error('Nicht unterstütztes Importziel.');
  }
  const newCustomers = plan.newCustomers || [];
  // Nur Neukunden anlegen, die eine tatsächlich übernommene Zeile braucht.
  const usedKeys = new Set(plan.entries.filter(item => APPLICABLE.has(item.status) && item.data?.customerKey).map(item => item.data.customerKey));
  return {
    resource,
    options: normalisedOptions,
    entries: plan.entries,
    newCustomers: newCustomers.filter(customer => usedKeys.has(customer.key)),
    totals: importTotals(resource, plan.entries),
  };
}

export function isApplicable(entryItem) {
  return APPLICABLE.has(entryItem.status);
}

export function summariseImport(plan, total) {
  const count = predicate => plan.entries.reduce((sum, item) => sum + (predicate(item) ? item.rowNumbers.length : 0), 0);
  const duplicates = count(item => item.status === 'duplicate');
  const errors = count(item => item.status === 'error');
  return {
    total,
    valid: count(item => item.status === 'valid' || item.status === 'warning'),
    updated: plan.entries.filter(item => item.status === 'update').length,
    duplicates,
    warnings: count(item => item.status === 'warning'),
    errors,
    imported: 0,
    skipped: duplicates + errors,
    records: plan.entries.filter(isApplicable).length,
    newCustomers: plan.newCustomers.length,
  };
}

export function reportRows(plan, imported = false) {
  return plan.entries
    .flatMap(item => item.rowNumbers.map(row => ({
      rowNumber: row,
      status: imported && isApplicable(item) ? 'imported' : item.status,
      message: item.message,
    })))
    .sort((left, right) => left.rowNumber - right.rowNumber);
}

function importTotals(resource, entries) {
  if (!['euerEntries', 'invoicePayments', 'invoices'].includes(resource)) return null;
  const months = new Map();
  const month = key => {
    if (!months.has(key)) months.set(key, { month: key, income: 0, expense: 0, invoicePayments: 0, invoiced: 0, count: 0 });
    return months.get(key);
  };
  const totals = { income: 0, expense: 0, invoicePayments: 0, invoiced: 0, openAmount: 0 };
  for (const item of entries) {
    if (!isApplicable(item) || !item.data) continue;
    const data = item.data;
    if (resource === 'invoices') {
      const bucket = month(data.issueDate.slice(0, 7));
      bucket.invoiced += cents(data.total);
      bucket.count += 1;
      totals.invoiced += cents(data.total);
      totals.openAmount += cents(data.total) - cents(data.payment?.amount || 0);
      if (data.payment) {
        const paymentBucket = month(data.payment.entryDate.slice(0, 7));
        paymentBucket.invoicePayments += cents(data.payment.amount);
        totals.invoicePayments += cents(data.payment.amount);
      }
      continue;
    }
    const bucket = month(data.entryDate.slice(0, 7));
    bucket.count += 1;
    if (data.kind === 'payment') {
      bucket.invoicePayments += cents(data.amount);
      totals.invoicePayments += cents(data.amount);
    } else if (data.entryType === 'income') {
      bucket.income += cents(data.amount);
      totals.income += cents(data.amount);
    } else {
      bucket.expense += cents(data.amount);
      totals.expense += cents(data.amount);
    }
  }
  const toEuro = value => value / 100;
  return {
    income: toEuro(totals.income),
    expense: toEuro(totals.expense),
    invoicePayments: toEuro(totals.invoicePayments),
    invoiced: toEuro(totals.invoiced),
    openAmount: toEuro(totals.openAmount),
    byMonth: [...months.values()]
      .sort((left, right) => left.month.localeCompare(right.month))
      .map(bucket => ({
        month: bucket.month,
        income: toEuro(bucket.income),
        expense: toEuro(bucket.expense),
        invoicePayments: toEuro(bucket.invoicePayments),
        invoiced: toEuro(bucket.invoiced),
        count: bucket.count,
      })),
  };
}
