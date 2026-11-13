/**
 * Abbildung der Control-Plane-Antworten (Kanal `/internal/fachapp`, Konto-
 * Aktionen) auf die Form, die die Oberfläche der Fachapp erwartet.
 *
 * Die Form der Control-Plane-Seite ist an einer Stelle gekapselt: Ändert sich
 * ein Feldname dort, wird nur diese Datei angepasst. Grundlage sind die
 * heutigen Antworten von `GET /api/account`, `GET /api/plans` und
 * `GET /api/billing/history` des Control Plane; fehlende Felder werden
 * tolerant behandelt, unbekannte Felder verworfen. Es gehen keine internen
 * Kennungen (Konto-ID, Stripe-IDs) an den Browser.
 */

const DEFAULT_RETURN_HOSTS = ['checkout.stripe.com', 'billing.stripe.com'];
const INVOICE_HOST_SUFFIX = '.stripe.com';

function text(value, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function textOrNull(value, max = 200) {
  const result = text(value, max);
  return result || null;
}

function integerOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function isoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null);
}

/** Zusätzlich erlaubte Rückgabe-Hosts (nur für Tests), kommagetrennt in `ACCOUNT_REDIRECT_ALLOWED_HOSTS`. */
export function allowedReturnHosts(env = process.env) {
  const extra = String(env.ACCOUNT_REDIRECT_ALLOWED_HOSTS || '')
    .split(',')
    .map(host => host.trim().toLowerCase())
    .filter(Boolean);
  return [...DEFAULT_RETURN_HOSTS, ...extra];
}

/**
 * Gibt die URL nur zurück, wenn sie mit `https://` beginnt und auf einen
 * erlaubten Host zeigt (Stripe oder Env-Liste); sonst `null`.
 */
export function safeReturnUrl(value, env = process.env) {
  if (typeof value !== 'string' || !value.startsWith('https://')) return null;
  let parsed;
  try { parsed = new URL(value); } catch { return null; }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
  return allowedReturnHosts(env).includes(parsed.host.toLowerCase()) ? parsed.toString() : null;
}

/** Rechnungs- und Beleglinks aus dem Zahlungsverlauf: https auf Stripe-Hosts oder der Env-Liste. */
export function safeDocumentUrl(value, env = process.env) {
  if (typeof value !== 'string' || !value.startsWith('https://')) return null;
  let parsed;
  try { parsed = new URL(value); } catch { return null; }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
  const host = parsed.host.toLowerCase();
  if (host.endsWith(INVOICE_HOST_SUFFIX) || allowedReturnHosts(env).includes(host)) return parsed.toString();
  return null;
}

export function mapBillingProfile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    legalName: text(raw.legalName ?? raw.legal_name),
    contactName: text(raw.contactName ?? raw.contact_name),
    billingEmail: text(raw.billingEmail ?? raw.billing_email, 255),
    vatId: text(raw.vatId ?? raw.vat_id, 40),
    addressLine1: text(raw.addressLine1 ?? raw.address_line1),
    addressLine2: text(raw.addressLine2 ?? raw.address_line2),
    postalCode: text(raw.postalCode ?? raw.postal_code, 20),
    city: text(raw.city),
    countryCode: text(raw.countryCode ?? raw.country_code, 2).toUpperCase(),
    purchaseOrderRef: text(raw.purchaseOrderRef ?? raw.purchase_order_ref, 100),
  };
}

function mapSubscription(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    planId: textOrNull(raw.planId ?? raw.plan_id, 80),
    planName: textOrNull(raw.planName ?? raw.plan_name, 120),
    status: text(raw.status, 40) || 'none',
    access: textOrNull(raw.access, 40),
    currentPeriodEnd: isoOrNull(raw.currentPeriodEnd ?? raw.current_period_end),
    cancelAtPeriodEnd: Boolean(raw.cancelAtPeriodEnd ?? raw.cancel_at_period_end),
    graceUntil: isoOrNull(firstDefined(raw.graceUntil, raw.grace_until, raw.graceEndsAt)),
    hasStripeCustomer: Boolean(firstDefined(raw.stripeCustomerConfigured, raw.hasStripeCustomer)),
  };
}

function mapLimits(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    maxWorkspaces: integerOrNull(raw.maxWorkspaces ?? raw.max_workspaces),
    maxMembers: integerOrNull(raw.maxMembers ?? raw.max_members),
  };
}

/** Antwort von `account/get`. */
export function mapAccountResponse(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const account = data.account && typeof data.account === 'object' ? data.account : {};
  const subscription = mapSubscription(data.subscription);
  const entitlements = data.entitlements && typeof data.entitlements === 'object' && !Array.isArray(data.entitlements)
    ? Object.fromEntries(Object.entries(data.entitlements).filter(([, value]) => typeof value === 'boolean'))
    : {};
  return {
    account: {
      email: textOrNull(account.email, 255),
      name: textOrNull(account.name ?? account.displayName),
      status: text(account.status, 40) || 'active',
    },
    subscription,
    limits: mapLimits(data.limits ?? data.permissions),
    entitlements,
    billingProfile: mapBillingProfile(data.billingProfile),
    stripeConfigured: Boolean(data.stripeConfigured),
  };
}

/** Antwort von `plans/list`; nur buchbare Tarife, keine Stripe-Preis-IDs. */
export function mapPlansResponse(raw) {
  const plans = Array.isArray(raw?.plans) ? raw.plans : [];
  return {
    plans: plans
      .filter(plan => plan && typeof plan === 'object' && text(plan.id) && (!plan.status || plan.status === 'active'))
      .map(plan => ({
        id: text(plan.id, 80),
        name: text(plan.name, 120) || text(plan.id, 80),
        description: text(plan.description, 500),
        priceCents: integerOrNull(plan.priceCents ?? plan.price_cents),
        currency: (text(plan.currency, 3) || 'EUR').toUpperCase(),
        interval: text(plan.interval, 20) || 'month',
        maxWorkspaces: integerOrNull(plan.maxWorkspaces ?? plan.max_workspaces),
        maxMembers: integerOrNull(plan.maxMembers ?? plan.max_members),
        checkoutAvailable: plan.checkoutAvailable !== false,
      })),
  };
}

/** Antwort von `billing/history`. */
export function mapBillingHistoryResponse(raw, env = process.env) {
  const payments = Array.isArray(raw?.payments) ? raw.payments : [];
  return {
    payments: payments
      .filter(entry => entry && typeof entry === 'object')
      .map((entry, index) => ({
        id: text(String(entry.id ?? `zahlung-${index}`), 80),
        planName: textOrNull(entry.planName ?? entry.plan_name, 120),
        amountCents: integerOrNull(entry.amountCents ?? entry.amount_cents),
        currency: (text(entry.currency, 3) || 'EUR').toUpperCase(),
        status: text(entry.status, 40) || 'unknown',
        paidAt: isoOrNull(entry.paidAt ?? entry.paid_at),
        invoiceUrl: safeDocumentUrl(entry.hostedInvoiceUrl ?? entry.hosted_invoice_url, env),
        invoicePdfUrl: safeDocumentUrl(entry.invoicePdf ?? entry.invoice_pdf, env),
      })),
  };
}

/** Antwort von `billing/checkout` und `billing/portal`: nur eine geprüfte Weiterleitungs-URL. */
export function mapRedirectResponse(raw, env = process.env) {
  const url = safeReturnUrl(raw?.url, env);
  return url ? { url } : null;
}

const PROFILE_LIMITS = {
  legalName: 200,
  contactName: 200,
  billingEmail: 255,
  vatId: 40,
  addressLine1: 200,
  addressLine2: 200,
  postalCode: 20,
  city: 120,
  countryCode: 2,
  purchaseOrderRef: 100,
};

const REQUIRED_PROFILE_FIELDS = ['legalName', 'addressLine1', 'postalCode', 'city', 'countryCode'];

/**
 * Prüft und bereinigt ein Rechnungsprofil aus dem Browser, bevor es ans
 * Control Plane geht. Rückgabe `{ value }` oder `{ error }` (deutsch).
 */
export function validateBillingProfileInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Bitte die vollständigen Rechnungsdaten angeben.' };
  const value = {};
  for (const [field, max] of Object.entries(PROFILE_LIMITS)) {
    const input = body[field];
    if (input !== undefined && input !== null && typeof input !== 'string') return { error: 'Die Rechnungsdaten enthalten ungültige Angaben.' };
    const cleaned = typeof input === 'string' ? input.trim() : '';
    if (cleaned.length > max) return { error: 'Eine der Angaben ist zu lang.' };
    value[field] = cleaned;
  }
  if (REQUIRED_PROFILE_FIELDS.some(field => !value[field])) return { error: 'Bitte Name, Anschrift, Postleitzahl, Ort und Land angeben.' };
  if (!/^[A-Za-z]{2}$/.test(value.countryCode)) return { error: 'Bitte das Land als zweistelligen Ländercode angeben, z. B. DE.' };
  value.countryCode = value.countryCode.toUpperCase();
  if (value.billingEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.billingEmail)) return { error: 'Bitte eine gültige E-Mail-Adresse für Rechnungen angeben.' };
  return { value };
}
