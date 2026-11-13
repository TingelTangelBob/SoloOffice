import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createAccountRouter } from '../routes/account.js';
import {
  mapAccountResponse,
  mapBillingHistoryResponse,
  mapPlansResponse,
  mapRedirectResponse,
  safeReturnUrl,
  validateBillingProfileInput,
} from '../services/accountMapping.js';
import { ACCOUNT_ACTIONS, callAccountAction } from '../services/controlPlaneClient.js';
import { verifyControlPlaneRequest } from '../utils/controlPlaneAuth.js';
import { workspaceSuspensionGuard } from '../middleware/workspaceSuspension.js';

const SECRET = 'f'.repeat(48);
const WORKSPACE_ID = '0b9d5f64-6a0a-4a3e-8a0c-3d6f2f0f8a11';
const CONFIGURED_ENV = { CONTROL_PLANE_URL: 'http://cp:4100', CONTROL_PLANE_INTERNAL_SECRET: SECRET };

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

/** Startet die Route mit ersetztem fetch; `role` steht in `req.auth`. */
async function withServer({ role = 'owner', env = CONFIGURED_ENV, fetchImpl }, run) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const realFetch = originalFetch;
  const server = http.createServer();
  globalThis.fetch = async (url, init) => {
    // Nur Aufrufe an das Control Plane gehen an den Ersatz, der Test-Client nutzt das echte fetch.
    if (String(url).startsWith(env.CONTROL_PLANE_URL || 'http://cp:4100')) {
      calls.push({ url: String(url), init });
      return fetchImpl(String(url), init);
    }
    return realFetch(url, init);
  };
  const previousEnv = { ...process.env };
  Object.assign(process.env, env);
  try {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = { userId: 'u1', workspaceId: WORKSPACE_ID, role, workspace: { name: 'Muster GmbH' }, user: { email: 'inhaber@example.test', displayName: 'Ina Inhaber' } };
      next();
    });
    app.use('/api/account', createAccountRouter({ limiter: (_req, _res, next) => next(), env: process.env }));
    server.on('request', app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = async (method, path, body) => {
      const response = await realFetch(`${base}/api/account${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: response.status, body: await response.json() };
    };
    await run({ request, calls });
  } finally {
    await new Promise(resolve => server.close(resolve));
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
    Object.assign(process.env, previousEnv);
  }
}

test('Konto-Aktionen: nur Eigentümer, andere Rollen erhalten 403 mit deutscher Meldung und der Kanal wird nicht gerufen', async () => {
  for (const role of ['admin', 'member', 'viewer']) {
    await withServer({ role, fetchImpl: async () => { throw new Error('darf nicht gerufen werden'); } }, async ({ request, calls }) => {
      for (const [method, path, body] of [['GET', '/', null], ['PUT', '/billing-profile', {}], ['GET', '/plans'], ['POST', '/checkout', { planId: 'pro' }], ['POST', '/portal'], ['GET', '/billing-history']]) {
        const result = await request(method, path, body);
        assert.equal(result.status, 403, `${method} ${path} als ${role}`);
        assert.match(result.body.error, /Eigentümer/);
        assert.equal(result.body.code, 'OWNER_REQUIRED');
      }
      assert.equal(calls.length, 0);
    });
  }
});

test('GET /status: jede Rolle darf fragen, canManage nur für den Eigentümer', async () => {
  const unused = async () => { throw new Error('kein Aufruf'); };
  await withServer({ role: 'owner', fetchImpl: unused }, async ({ request }) => {
    assert.deepEqual((await request('GET', '/status')).body, { available: true, canManage: true });
  });
  await withServer({ role: 'viewer', fetchImpl: unused }, async ({ request }) => {
    assert.deepEqual((await request('GET', '/status')).body, { available: true, canManage: false });
  });
});

test('ohne Control Plane: status meldet nicht verfügbar, Aktionen antworten 503 ohne Netzzugriff', async () => {
  await withServer({ role: 'owner', env: { CONTROL_PLANE_URL: '', CONTROL_PLANE_INTERNAL_SECRET: '' }, fetchImpl: async () => { throw new Error('kein Aufruf'); } }, async ({ request, calls }) => {
    const status = await request('GET', '/status');
    assert.equal(status.body.available, false);
    assert.equal(status.body.canManage, false);
    const account = await request('GET', '/');
    assert.equal(account.status, 503);
    assert.equal(account.body.code, 'CONTROL_PLANE_NOT_CONFIGURED');
    assert.equal(calls.length, 0);
  });
});

test('CP-Fehler: nicht erreichbar und 5xx werden zu 502 ohne interne Details, fachliche Ablehnungen bleiben erhalten', async () => {
  await withServer({ fetchImpl: async () => { throw new Error('connect ECONNREFUSED 10.0.0.7:4100'); } }, async ({ request }) => {
    const result = await request('GET', '/');
    assert.equal(result.status, 502);
    assert.equal(result.body.code, 'CONTROL_PLANE_UNAVAILABLE');
    assert.ok(!JSON.stringify(result.body).includes('10.0.0.7'));
    assert.match(result.body.error, /nicht erreichbar/);
  });
  await withServer({ fetchImpl: async () => jsonResponse(500, { error: 'SELECT * FROM accounts failed', code: 'DB' }) }, async ({ request }) => {
    const result = await request('GET', '/');
    assert.equal(result.status, 502);
    assert.ok(!JSON.stringify(result.body).includes('SELECT'));
  });
  await withServer({ fetchImpl: async () => jsonResponse(409, { error: 'Für dieses Konto besteht bereits ein Abo.', code: 'SUBSCRIPTION_EXISTS' }) }, async ({ request }) => {
    const result = await request('POST', '/checkout', { planId: 'pro' });
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'SUBSCRIPTION_EXISTS');
    assert.match(result.body.error, /Abo/);
  });
});

test('Aufruf ist signiert, trägt Workspace und Anfragenden, und die Signatur lässt sich prüfen', async () => {
  await withServer({ fetchImpl: async () => jsonResponse(200, { account: { email: 'k@example.test' } }) }, async ({ request, calls }) => {
    const result = await request('GET', '/');
    assert.equal(result.status, 200);
    const [call] = calls;
    assert.equal(call.url, 'http://cp:4100/internal/fachapp/account/get');
    assert.equal(call.init.method, 'POST');
    const body = JSON.parse(call.init.body);
    assert.equal(body.workspaceId, WORKSPACE_ID);
    assert.deepEqual(body.requester, { email: 'inhaber@example.test', name: 'Ina Inhaber', role: 'owner' });
    const verification = verifyControlPlaneRequest({
      secret: SECRET,
      timestamp: call.init.headers['X-Control-Plane-Timestamp'],
      signature: call.init.headers['X-Control-Plane-Signature'],
      idempotencyKey: 'egal',
      method: 'POST',
      path: '/internal/fachapp/account/get',
      body: call.init.body,
    });
    assert.equal(verification.ok, true);
  });
});

test('Eingabe der Aktionen: planId wird geprüft und weitergereicht, das Profil bereinigt', async () => {
  await withServer({ fetchImpl: async () => jsonResponse(200, { url: 'https://checkout.stripe.com/c/pay/cs_test_1' }) }, async ({ request, calls }) => {
    assert.equal((await request('POST', '/checkout', {})).status, 400);
    assert.equal((await request('POST', '/checkout', { planId: '../x' })).status, 400);
    assert.equal(calls.length, 0);
    const ok = await request('POST', '/checkout', { planId: 'solo-monat' });
    assert.equal(ok.status, 200);
    assert.equal(JSON.parse(calls[0].init.body).planId, 'solo-monat');
  });
  await withServer({ fetchImpl: async (_url, init) => jsonResponse(200, { billingProfile: JSON.parse(init.body).billingProfile }) }, async ({ request, calls }) => {
    assert.equal((await request('PUT', '/billing-profile', { legalName: 'X' })).status, 400);
    const saved = await request('PUT', '/billing-profile', { legalName: ' Muster GmbH ', addressLine1: 'Weg 1', postalCode: '10115', city: 'Berlin', countryCode: 'de' });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.billingProfile.countryCode, 'DE');
    assert.equal(saved.body.billingProfile.legalName, 'Muster GmbH');
    assert.equal(calls.length, 1);
  });
});

test('Rückgabe-URLs: nur https auf Stripe-Hosts oder Env-Liste', async () => {
  assert.ok(safeReturnUrl('https://checkout.stripe.com/c/pay/x'));
  assert.ok(safeReturnUrl('https://billing.stripe.com/p/session/x'));
  assert.equal(safeReturnUrl('http://checkout.stripe.com/c/pay/x'), null);
  assert.equal(safeReturnUrl('https://evil.example/checkout.stripe.com'), null);
  assert.equal(safeReturnUrl('https://checkout.stripe.com.evil.example/x'), null);
  assert.equal(safeReturnUrl('https://user:pw@checkout.stripe.com/x'), null);
  assert.equal(safeReturnUrl('javascript:alert(1)'), null);
  assert.equal(safeReturnUrl('//checkout.stripe.com/x'), null);
  assert.equal(safeReturnUrl('https://stripe.test/x'), null);
  assert.ok(safeReturnUrl('https://stripe.test/x', { ACCOUNT_REDIRECT_ALLOWED_HOSTS: 'stripe.test' }));
  assert.equal(safeReturnUrl('http://stripe.test/x', { ACCOUNT_REDIRECT_ALLOWED_HOSTS: 'stripe.test' }), null);
  assert.equal(mapRedirectResponse({ url: 'https://evil.example/' }), null);

  await withServer({ fetchImpl: async () => jsonResponse(200, { url: 'https://evil.example/pay' }) }, async ({ request }) => {
    for (const [path] of [['/checkout'], ['/portal']]) {
      const result = await request('POST', path, { planId: 'pro' });
      assert.equal(result.status, 502);
      assert.equal(result.body.code, 'REDIRECT_URL_REJECTED');
      assert.ok(!JSON.stringify(result.body).includes('evil'));
    }
  });
  await withServer({ fetchImpl: async () => jsonResponse(200, { url: 'https://billing.stripe.com/p/session/abc' }) }, async ({ request }) => {
    assert.deepEqual((await request('POST', '/portal')).body, { url: 'https://billing.stripe.com/p/session/abc' });
  });
});

test('mapAccountResponse: Form von GET /api/account des Control Plane, ohne interne Kennungen', () => {
  const mapped = mapAccountResponse({
    account: { id: 'intern', email: 'k@example.test', role: 'customer', emailVerifiedAt: '2026-01-01T00:00:00Z' },
    subscription: { id: 'sub-intern', planId: 'pro', planName: 'Pro', status: 'past_due', access: 'grace', currentPeriodEnd: '2026-12-01T00:00:00Z', cancelAtPeriodEnd: true, graceUntil: '2026-12-08T00:00:00Z', stripeCustomerConfigured: true },
    workspaces: [{ id: 'x' }],
    billingProfile: { legal_name: 'Muster GmbH', address_line1: 'Weg 1', postal_code: '10115', city: 'Berlin', country_code: 'de' },
    limits: { maxWorkspaces: 2, maxMembers: 5 },
    stripeConfigured: true,
  });
  assert.equal(mapped.account.email, 'k@example.test');
  assert.equal(mapped.account.status, 'active');
  assert.equal(mapped.subscription.planName, 'Pro');
  assert.equal(mapped.subscription.cancelAtPeriodEnd, true);
  assert.equal(mapped.subscription.graceUntil, '2026-12-08T00:00:00.000Z');
  assert.equal(mapped.subscription.hasStripeCustomer, true);
  assert.deepEqual(mapped.limits, { maxWorkspaces: 2, maxMembers: 5 });
  assert.equal(mapped.billingProfile.countryCode, 'DE');
  assert.equal(mapped.stripeConfigured, true);
  assert.ok(!JSON.stringify(mapped).includes('intern'));
  const empty = mapAccountResponse(undefined);
  assert.equal(empty.subscription, null);
  assert.equal(empty.billingProfile, null);
  assert.equal(empty.stripeConfigured, false);
});

test('mapPlansResponse und mapBillingHistoryResponse: heutige Formen, unsichere Links entfallen', () => {
  const plans = mapPlansResponse({ plans: [
    { id: 'pro', name: 'Pro', description: 'x', priceCents: 1900, currency: 'eur', interval: 'month', maxWorkspaces: 1, maxMembers: 3, status: 'active', checkoutAvailable: true },
    { id: 'alt', name: 'Alt', status: 'archived' },
    { name: 'ohne Id' },
  ] });
  assert.equal(plans.plans.length, 1);
  assert.equal(plans.plans[0].currency, 'EUR');
  assert.equal(plans.plans[0].priceCents, 1900);

  const history = mapBillingHistoryResponse({ payments: [
    { id: 'p1', planId: 'pro', planName: 'Pro', invoiceId: 'in_1', amountCents: 1900, currency: 'eur', status: 'paid', paidAt: '2026-11-01T10:00:00Z', hostedInvoiceUrl: 'https://invoice.stripe.com/i/acct/x', invoicePdf: 'http://evil.example/x.pdf' },
  ] });
  assert.equal(history.payments[0].invoiceUrl, 'https://invoice.stripe.com/i/acct/x');
  assert.equal(history.payments[0].invoicePdfUrl, null);
  assert.ok(!('invoiceId' in history.payments[0]));
  assert.deepEqual(mapBillingHistoryResponse(null), { payments: [] });
});

test('validateBillingProfileInput und callAccountAction', async () => {
  assert.ok(validateBillingProfileInput(null).error);
  assert.ok(validateBillingProfileInput({ legalName: 1 }).error);
  assert.ok(validateBillingProfileInput({ legalName: 'A', addressLine1: 'B', postalCode: '1', city: 'C', countryCode: 'DEU' }).error);
  assert.ok(validateBillingProfileInput({ legalName: 'A', addressLine1: 'B', postalCode: '1', city: 'C', countryCode: 'DE', billingEmail: 'kaputt' }).error);
  assert.ok(validateBillingProfileInput({ legalName: 'A'.repeat(201), addressLine1: 'B', postalCode: '1', city: 'C', countryCode: 'DE' }).error);

  assert.deepEqual([...ACCOUNT_ACTIONS], ['account/get', 'account/billing-profile', 'plans/list', 'billing/checkout', 'billing/portal', 'billing/history']);
  await assert.rejects(callAccountAction('tickets/list', {}), /Unbekannte/);
  // Der Kontext (Workspace) lässt sich nicht durch Eingaben überschreiben.
  let sent;
  await callAccountAction('billing/checkout', { workspaceId: 'echt' }, { planId: 'p', workspaceId: 'fremd' }, { env: CONFIGURED_ENV, fetchImpl: async (_url, init) => { sent = JSON.parse(init.body); return jsonResponse(200, {}); } });
  assert.equal(sent.workspaceId, 'echt');
});

test('gesperrter Arbeitsbereich erreicht Checkout, Portal und Rechnungsprofil', () => {
  const run = (method, path) => {
    let passed = false;
    workspaceSuspensionGuard({ auth: { workspace: { suspendedAt: '2026-09-15T10:00:00.000Z' } }, method, path }, { status() { return { json() {} }; } }, () => { passed = true; });
    return passed;
  };
  assert.equal(run('POST', '/account/checkout'), true);
  assert.equal(run('POST', '/account/portal'), true);
  assert.equal(run('PUT', '/account/billing-profile'), true);
  assert.equal(run('POST', '/invoices'), false);
});
