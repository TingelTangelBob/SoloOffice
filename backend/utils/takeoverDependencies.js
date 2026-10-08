import { normaliseKey } from './importValues.js';
import { planImport } from './importPlanner.js';

const CUSTOMER_SOURCES = new Set(['jobs', 'quotes', 'invoices', 'euerEntries']);
const labels = {
  customers: 'Kunden', jobs: 'Aufträge', quotes: 'Angebote', invoices: 'Rechnungen',
  euerEntries: 'Einnahmen und Ausgaben', invoicePayments: 'Zahlungseingänge',
  positions: 'Positionen', hourlyRates: 'Stundensätze', materials: 'Materialien',
};

/**
 * Fachliche Grundreihenfolge der Übernahme: Stammdaten vor Belegen, Belege vor
 * Zahlungen und Buchungen. Sie entscheidet, welche von mehreren gleichzeitig
 * möglichen Kategorien zuerst vorgeschlagen wird – unabhängig davon, in
 * welcher Reihenfolge die Erkennung sie geliefert hat.
 */
export const TAKEOVER_CATEGORY_ORDER = [
  'customers', 'hourlyRates', 'materials', 'positions',
  'invoices', 'invoicePayments', 'euerEntries', 'jobs', 'quotes',
];

function categoryRank(node) {
  // Vorgeschlagene Kunden gehören unmittelbar hinter die Kundenliste: erst die
  // benannten Kunden, dann die aus Folgedaten abgeleiteten Namen.
  if (node.id === 'suggestedCustomers') return 0.5;
  const index = TAKEOVER_CATEGORY_ORDER.indexOf(node.resource);
  return index < 0 ? TAKEOVER_CATEGORY_ORDER.length : index;
}

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
  const plannedCustomers = [];

  if (customerCategory && !skippedSet.has('customers')) {
    const customerPlan = planImport('customers', customerCategory.rows || [], context, {});
    plans.set('customers', customerPlan);
    customerPlan.entries.forEach((item, index) => {
      if (!['valid', 'warning'].includes(item.status) || !item.data?.name) return;
      plannedCustomers.push({ id: `takeover-customer-${index}`, name: item.data.name, customerNumber: item.data.customerNumber || '', email: item.data.email || '' });
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
      // Eine mitgelieferte Kundenliste ist fachliche Voraussetzung jeder
      // kundenbezogenen Kategorie – auch dann, wenn die Zeilen zufällig schon
      // zu vorhandenen Kunden passen. Sonst käme „Kunden“ in der Reihenfolge
      // hinter Rechnungen oder Aufträgen.
      if (customerCategory && !skippedSet.has('customers')) {
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
    // Der Importplan gruppiert Positionszeilen und lässt bereits vorhandene
    // Rechnungen aus. Quellzeilen zu zählen würde eine Rechnung mehrfach
    // zählen und nach ihrer Übernahme fälschlich als mehrdeutig sperren.
    for (const item of plans.get('invoices')?.entries || []) {
      if (!['valid', 'warning'].includes(item.status)) continue;
      const number = normaliseKey(item.data?.invoiceNumber);
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

  // Zahlungen und Geldbuchungen setzen den Rechnungsbestand voraus: beide
  // können Beträge einer übernommenen Rechnung zuordnen. Liegt eine
  // Rechnungskategorie in derselben Datei, gehört sie davor.
  if (invoiceCategory && !skippedSet.has('invoices')) {
    for (const resource of ['invoicePayments', 'euerEntries']) {
      if (byResource.has(resource) && !skippedSet.has(resource)) dependencies.get(resource)?.add('invoices');
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
      // Eine mitgelieferte Kundenliste wird zuerst übernommen; erst danach
      // bleiben die wirklich unbekannten Namen als Vorschlag übrig.
      dependencies: customerCategory && !skippedSet.has('customers') ? ['customers'] : [],
      blockedReason: null, skipped: false, synthetic: true,
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

/**
 * Topologische Reihenfolge mit fachlicher Vorentscheidung: Sind mehrere
 * Kategorien gleichzeitig möglich, gewinnt die mit dem kleineren Rang aus
 * `TAKEOVER_CATEGORY_ORDER`. Damit stehen Kunden und Preise vor Belegen,
 * unabhängig von der Erkennungsreihenfolge der Datei.
 */
function topologicalOrder(nodes) {
  const remaining = new Set(nodes.map(node => node.id));
  const ordered = [];
  while (remaining.size) {
    const ready = nodes.filter(node => remaining.has(node.id) && node.dependencies.every(dep => !remaining.has(dep)));
    if (ready.length === 0) return [...ordered, ...remaining];
    const next = ready.reduce((best, node) => (categoryRank(node) < categoryRank(best) ? node : best));
    ordered.push(next.id);
    remaining.delete(next.id);
  }
  return ordered;
}

/**
 * Benennt die erste verletzte Voraussetzung einer Nutzer-Reihenfolge, damit die
 * Oberfläche eine verständliche Rückmeldung geben kann. `null` heißt gültig.
 */
export function takeoverOrderConflict(nodes, order) {
  if (order.length !== nodes.length || new Set(order).size !== nodes.length
    || order.some(id => !nodes.some(node => node.id === id))) {
    return 'Die Reihenfolge enthält nicht alle Kategorien genau einmal.';
  }
  const positions = new Map(order.map((id, index) => [id, index]));
  const labelOf = id => nodes.find(node => node.id === id)?.label || id;
  for (const id of order) {
    const node = nodes.find(item => item.id === id);
    for (const dependency of node?.dependencies || []) {
      if (!positions.has(dependency) || positions.get(dependency) > positions.get(node.id)) {
        return `„${node.label}“ braucht „${labelOf(dependency)}“ davor.`;
      }
    }
  }
  return null;
}

/** Tauscht Nutzer-Reihenfolge nur dann durch, wenn alle Kanten gültig bleiben. */
export function isValidTakeoverOrder(nodes, order) {
  return takeoverOrderConflict(nodes, order) === null;
}
