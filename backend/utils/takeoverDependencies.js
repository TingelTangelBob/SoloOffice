import { normaliseKey } from './importValues.js';
import { planImport } from './importPlanner.js';

const CUSTOMER_SOURCES = new Set(['jobs', 'quotes', 'invoices', 'euerEntries']);
const labels = {
  customers: 'Kunden', jobs: 'Aufträge', quotes: 'Angebote', invoices: 'Rechnungen',
  euerEntries: 'Einnahmen und Ausgaben', invoicePayments: 'Zahlungseingänge',
  positions: 'Positionen', hourlyRates: 'Stundensätze', materials: 'Materialien',
};

/**
 * Erstellt Abhängigkeiten für erkannte Importkategorien. Die Kundenauflösung
 * bleibt im planImport; diese Funktion ergänzt nur die Beziehungen zwischen
 * Kategorien und dem bereits vorhandenen Workspace-Bestand.
 */
export function planTakeoverDependencies(categories, context = {}, skipped = []) {
  const skippedSet = new Set(skipped);
  const byResource = new Map(categories.map(category => [category.resource, category]));
  const plans = new Map();
  const proposedCustomers = new Map();
  const blockers = new Map();
  const dependencies = new Map(categories.map(category => [category.resource, new Set()]));
  const customerCategory = byResource.get('customers');
  const plannedCustomerIds = new Set();
  const plannedCustomers = [];

  if (customerCategory && !skippedSet.has('customers')) {
    const customerPlan = planImport('customers', customerCategory.rows || [], context, {});
    plans.set('customers', customerPlan);
    customerPlan.entries.forEach((item, index) => {
      if (!['valid', 'warning'].includes(item.status) || !item.data?.name) return;
      const id = `takeover-customer-${index}`;
      plannedCustomerIds.add(id);
      plannedCustomers.push({ id, name: item.data.name, customerNumber: item.data.customerNumber || '', email: item.data.email || '' });
    });
  }
  const planningContext = plannedCustomers.length
    ? { ...context, customers: [...(context.customers || []), ...plannedCustomers] }
    : context;

  for (const category of categories) {
    if (skippedSet.has(category.resource)) continue;
    if (CUSTOMER_SOURCES.has(category.resource)) {
      const plan = planImport(category.resource, category.rows || [], planningContext, { createMissingCustomers: true });
      plans.set(category.resource, plan);
      const missingReference = plan.entries.find(item => item.status === 'error' && /Bezug fehlt|Kundenbezug fehlt|Kundenbezug ist erforderlich|passen zu .*Bitte Nummer oder E-Mail ergänzen/i.test(item.message));
      if (missingReference) blockers.set(category.resource, missingReference.message);
      if (plan.entries.some(item => item.data?.customerId && plannedCustomerIds.has(item.data.customerId))) {
        dependencies.get(category.resource)?.add('customers');
      }
      for (const customer of plan.newCustomers) {
        const key = normaliseKey(customer.key || customer.name);
        if (!key) continue;
        const existing = proposedCustomers.get(key);
        if (existing) {
          existing.rowNumbers = [...new Set([...existing.rowNumbers, ...customer.rowNumbers])];
          existing.sources = [...new Set([...existing.sources, category.resource])];
        } else {
          proposedCustomers.set(key, { ...customer, sources: [category.resource], rowNumbers: [...customer.rowNumbers] });
        }
      }
    }
  }

  const needsCustomerCategory = proposedCustomers.size > 0;
  if (needsCustomerCategory) {
    for (const [resource, plan] of plans) {
      if (plan.newCustomers.length) dependencies.get(resource)?.add('suggestedCustomers');
    }
  }

  const existingInvoiceNumbers = new Map();
  for (const invoice of context.invoices || []) {
    const key = normaliseKey(invoice.invoiceNumber);
    if (key) existingInvoiceNumbers.set(key, (existingInvoiceNumbers.get(key) || 0) + 1);
  }
  const proposedInvoiceNumbers = new Map();
  const invoiceCategory = byResource.get('invoices');
  if (invoiceCategory && !skippedSet.has('invoices')) {
    for (const row of invoiceCategory.rows || []) {
      const number = normaliseKey(row.invoiceNumber || row.invoice_number || row.rechnungsnummer || row.rechnungsnr || row.belegnummer);
      if (number) proposedInvoiceNumbers.set(number, (proposedInvoiceNumbers.get(number) || 0) + 1);
    }
  }

  const paymentCategory = byResource.get('invoicePayments');
  if (paymentCategory && !skippedSet.has('invoicePayments')) {
    const paymentPlan = planImport('invoicePayments', paymentCategory.rows || [], planningContext, {});
    plans.set('invoicePayments', paymentPlan);
    for (const [index, row] of (paymentCategory.rows || []).entries()) {
      const raw = row.invoiceNumber || row.invoice_number || row.rechnungsnummer || row.rechnungsnr || row.belegnummer;
      const key = normaliseKey(raw);
      if (!key) {
        blockers.set('invoicePayments', 'Mindestens eine Zahlung hat keine Rechnungsnummer.');
        continue;
      }
      if (skippedSet.has('invoices') && !existingInvoiceNumbers.has(key)) {
        dependencies.get('invoicePayments')?.add('invoices');
        blockers.set('invoicePayments', 'Die benötigte Rechnungskategorie wurde übersprungen.');
        continue;
      }
      const existingCount = existingInvoiceNumbers.get(key) || 0;
      const proposedCount = proposedInvoiceNumbers.get(key) || 0;
      if (existingCount > 1 || proposedCount > 1 || (existingCount && proposedCount)) {
        blockers.set('invoicePayments', `Die Rechnungsnummer „${String(raw).trim()}“ ist mehrdeutig.`);
      } else if (!existingCount && !proposedCount) {
        blockers.set('invoicePayments', `Die Rechnung „${String(raw).trim()}“ ist weder im Workspace vorhanden noch in einer erkannten Rechnungskategorie enthalten.`);
      } else if (!existingCount && proposedCount === 1) {
        dependencies.get('invoicePayments')?.add('invoices');
      }
      const result = paymentPlan.entries[index];
      const waitsForSelectedInvoice = !existingCount && proposedCount === 1;
      const onlyMissingBecauseInvoiceIsPlanned = waitsForSelectedInvoice && /wurde nicht gefunden/.test(result?.message || '');
      if (result?.status === 'error' && !onlyMissingBecauseInvoiceIsPlanned && !blockers.has('invoicePayments')) {
        blockers.set('invoicePayments', result.message || 'Die Rechnungszuordnung ist nicht eindeutig.');
      }
    }
  }

  const nodes = categories.map(category => ({
    id: category.resource,
    resource: category.resource,
    label: category.label || labels[category.resource] || category.resource,
    dependencies: [...(dependencies.get(category.resource) || [])],
    blockedReason: skippedSet.has(category.resource) ? 'Kategorie wurde übersprungen.' : blockers.get(category.resource) || null,
    skipped: skippedSet.has(category.resource),
  }));
  if (needsCustomerCategory) {
    nodes.push({
      id: 'suggestedCustomers', resource: 'customers', label: 'Vorgeschlagene Kunden',
      dependencies: [], blockedReason: null, skipped: false, synthetic: true,
    });
  }
  for (const node of nodes) {
    if (node.dependencies.includes('invoices') && skippedSet.has('invoices')) {
      node.blockedReason = 'Die benötigte Kategorie Rechnungen wurde übersprungen.';
    }
    if (node.dependencies.includes('suggestedCustomers') && skippedSet.has('suggestedCustomers')) {
      node.blockedReason = 'Die vorgeschlagene Kundenkategorie wurde übersprungen.';
    }
  }

  const order = topologicalOrder(nodes);
  return {
    nodes: order.map(id => nodes.find(node => node.id === id)),
    proposedCustomers: [...proposedCustomers.values()],
    plans: Object.fromEntries(plans),
  };
}

function topologicalOrder(nodes) {
  const remaining = new Set(nodes.map(node => node.id));
  const ordered = [];
  while (remaining.size) {
    const next = nodes.find(node => remaining.has(node.id) && node.dependencies.every(dep => !remaining.has(dep)));
    if (!next) return [...ordered, ...remaining];
    ordered.push(next.id);
    remaining.delete(next.id);
  }
  return ordered;
}

/** Tauscht Nutzer-Reihenfolge nur dann durch, wenn alle Kanten gültig bleiben. */
export function isValidTakeoverOrder(nodes, order) {
  if (order.length !== nodes.length || new Set(order).size !== nodes.length) return false;
  const positions = new Map(order.map((id, index) => [id, index]));
  return nodes.every(node => node.dependencies.every(dependency =>
    positions.has(dependency) && positions.get(dependency) < positions.get(node.id)));
}
