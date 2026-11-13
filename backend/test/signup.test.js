import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createSignupRouter } from '../routes/signup.js';
import { effectiveRegistrationMode } from '../routes/auth.js';
import { csrfProtection } from '../middleware/auth.js';
import {
  NEUTRAL_RESEND_MESSAGE,
  NEUTRAL_START_MESSAGE,
  mapSignupConfig,
  mapStatusResponse,
  mapVerifyResponse,
  normalizeClientIp,
  validateStartInput,
  validateToken,
} from '../services/signupMapping.js';
import { SIGNUP_ACTIONS, callSignupAction } from '../services/controlPlaneClient.js';
import { verifyControlPlaneRequest } from '../utils/controlPlaneAuth.js';

// Testfelder der Gegenseite reicht die Fachapp nur im Testbetrieb durch.
process.env.EXPOSE_INVITATION_TOKENS = 'true';

const SECRET = 's'.repeat(48);
const CONFIGURED_ENV = { CONTROL_PLANE_URL: 'http://cp:4100', CONTROL_PLANE_INTERNAL_SECRET: SECRET };
const TOKEN = 'T0kenT0kenT0kenT0kenT0ken_-abc';
const VALID_START = { email: 'Kunde@Example.test', name: 'Muster GmbH', acceptTerms: true, acceptPrivacy: true };

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

/** Einfacher Zähler als Ersatz für das datenbankgestützte Limit. */
function memoryLimiter(max) {
  let hits = 0;
  return (_req, res, next) => {
    hits += 1;
    if (hits > max) { res.set('Retry-After', '30'); return res.status(429).json({ error: 'Zu viele Anfragen. Bitte versuchen Sie es später erneut.' }); }
    return next();
  };
}

async function withServer({ env = CONFIGURED_ENV, fetchImpl, writeMax = 1000 }, run) {
  const realFetch = globalThis.fetch;
  const calls = [];
  const server = http.createServer();
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('http://cp:4100')) {
      calls.push({ url: String(url), init, body: JSON.parse(init.body) });
      return fetchImpl(String(url), init);
    }
    return realFetch(url, init);
  };
  const previousEnv = { ...process.env };
  Object.assign(process.env, env);
  try {
    const app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    app.use('/api/signup', createSignupRouter({ writeLimiter: memoryLimiter(writeMax), readLimiter: (_req, _res, next) => next(), env: process.env }));
    server.on('request', app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/signup`;
    const request = async (method, path, body, headers = {}) => {
      const response = await realFetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.9', ...headers }, body: body ? JSON.stringify(body) : undefined });
      return { status: response.status, body: await response.json(), headers: response.headers };
    };
    await run({ request, calls });
  } finally {
    await new Promise(resolve => server.close(resolve));
    globalThis.fetch = realFetch;
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
    Object.assign(process.env, previousEnv);
  }
}

const never = async () => { throw new Error('darf nicht gerufen werden'); };

test('ohne Control Plane antworten alle Registrierungs-Routen mit 404 und rufen nichts', async () => {
  await withServer({ env: { CONTROL_PLANE_URL: '', CONTROL_PLANE_INTERNAL_SECRET: '' }, fetchImpl: never }, async ({ request, calls }) => {
    for (const [method, path, body] of [['GET', '/config'], ['POST', '/start', VALID_START], ['POST', '/resend', { email: 'a@b.de' }], ['POST', '/verify', { token: TOKEN }], ['GET', '/status']]) {
      const result = await request(method, path, body, { 'X-Signup-Token': TOKEN });
      assert.equal(result.status, 404, `${method} ${path}`);
    }
    assert.equal(calls.length, 0);
  });
});

test('Validierung: E-Mail, Name, Zustimmungen, Tarif und Einladungscode werden vor dem Aufruf geprüft', async () => {
  await withServer({ fetchImpl: never }, async ({ request, calls }) => {
    const cases = [
      [{ ...VALID_START, email: 'keine-adresse' }, 'email'],
      [{ ...VALID_START, name: 'A' }, 'name'],
      [{ ...VALID_START, name: 'x'.repeat(121) }, 'name'],
      [{ ...VALID_START, acceptTerms: false }, 'acceptTerms'],
      [{ ...VALID_START, acceptPrivacy: 'true' }, 'acceptPrivacy'],
      [{ ...VALID_START, planId: 'a b' }, 'planId'],
      [{ ...VALID_START, inviteToken: 'zu kurz!' }, 'inviteToken'],
    ];
    for (const [body, field] of cases) {
      const result = await request('POST', '/start', body);
      assert.equal(result.status, 400, field);
      assert.equal(result.body.field, field);
      assert.equal(result.body.code, 'SIGNUP_INVALID');
    }
    assert.equal((await request('POST', '/resend', { email: 'nein' })).status, 400);
    assert.equal((await request('POST', '/verify', { token: 'kurz' })).status, 400);
    assert.equal((await request('GET', '/status')).status, 404);
    assert.equal(calls.length, 0);
  });
});

test('start: neutrale Antwort, E-Mail normalisiert', async () => {
  const answers = [
    { ok: true, verificationRequired: true, message: 'neu', verificationToken: 'GEHEIM-TESTTOKEN-1234567890' },
    { ok: true, verificationRequired: true, message: 'existiert bereits' },
  ];
  await withServer({ fetchImpl: async () => jsonResponse(200, answers.shift()) }, async ({ request, calls }) => {
    const first = await request('POST', '/start', { ...VALID_START, planId: 'pro', inviteToken: 'invite-token-1234567890' });
    const second = await request('POST', '/start', VALID_START);
    assert.equal(first.status, 200);
    assert.equal(first.body.message, second.body.message);
    assert.equal(first.body.message, NEUTRAL_START_MESSAGE);
    assert.equal(second.body.verificationToken, undefined);
    assert.equal(calls[0].url, 'http://cp:4100/internal/fachapp/signup/start');
    assert.deepEqual(
      { ...calls[0].body, clientIp: undefined },
      { email: 'kunde@example.test', name: 'Muster GmbH', acceptTerms: true, acceptPrivacy: true, planId: 'pro', inviteToken: 'invite-token-1234567890', clientIp: undefined },
    );
  });
});

test('start: Testfeld verificationToken der Gegenseite wird durchgereicht', async () => {
  await withServer({ fetchImpl: async () => jsonResponse(200, { ok: true, verificationToken: 'TESTTOKEN-1234567890' }) }, async ({ request }) => {
    assert.equal((await request('POST', '/start', VALID_START)).body.verificationToken, 'TESTTOKEN-1234567890');
  });
});

test('start: ohne Testbetrieb erscheint verificationToken nie, auch wenn die Gegenseite es schickt', async () => {
  for (const value of [undefined, 'false', 'TRUE', '1']) {
    if (value === undefined) delete process.env.EXPOSE_INVITATION_TOKENS; else process.env.EXPOSE_INVITATION_TOKENS = value;
    try {
      await withServer({ fetchImpl: async () => jsonResponse(200, { ok: true, verificationToken: 'TESTTOKEN-1234567890' }) }, async ({ request }) => {
        const result = await request('POST', '/start', VALID_START);
        assert.equal(result.body.verificationToken, undefined);
        assert.ok(!JSON.stringify(result.body).includes('TESTTOKEN'));
      });
      assert.equal(mapStatusResponse({ state: 'invitation_sent', ownerInvitation: { link: 'https://app.example.test/?invite=abc' } }).ownerInvitation, undefined);
    } finally {
      process.env.EXPOSE_INVITATION_TOKENS = 'true';
    }
  }
});

test('start: Ablehnung der Gegenseite (Einladungscode) wird mit deutscher Meldung weitergereicht, Ausfall wird 502', async () => {
  await withServer({ fetchImpl: async () => jsonResponse(403, { error: 'Der Einladungscode ist ungültig.', code: 'INVITE_INVALID' }) }, async ({ request }) => {
    const result = await request('POST', '/start', VALID_START);
    assert.equal(result.status, 403);
    assert.equal(result.body.code, 'INVITE_INVALID');
  });
  await withServer({ fetchImpl: async () => { throw new Error('connect ECONNREFUSED 10.0.0.7:4100'); } }, async ({ request }) => {
    const result = await request('POST', '/start', VALID_START);
    assert.equal(result.status, 502);
    assert.ok(!JSON.stringify(result.body).includes('10.0.0.7'));
  });
});

test('resend: immer neutral, auch wenn die Gegenseite die Adresse nicht kennt', async () => {
  for (const status of [200, 404, 400]) {
    await withServer({ fetchImpl: async () => jsonResponse(status, status === 200 ? { ok: true } : { error: 'Kein Konto', code: 'X' }) }, async ({ request, calls }) => {
      const result = await request('POST', '/resend', { email: 'Wer@Example.test' });
      assert.equal(result.status, 200);
      assert.deepEqual(result.body, { ok: true, message: NEUTRAL_RESEND_MESSAGE });
      assert.equal(calls[0].body.email, 'wer@example.test');
    });
  }
});

test('Rate-Limit je IP: nach dem Limit antwortet start mit 429 und Retry-After, ohne die Gegenseite zu rufen', async () => {
  await withServer({ writeMax: 2, fetchImpl: async () => jsonResponse(200, { ok: true }) }, async ({ request, calls }) => {
    assert.equal((await request('POST', '/start', VALID_START)).status, 200);
    assert.equal((await request('POST', '/start', VALID_START)).status, 200);
    const limited = await request('POST', '/start', VALID_START);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '30');
    assert.equal(calls.length, 2);
  });
});

test('Aufruf ist signiert, trägt die Client-IP und die Signatur lässt sich prüfen', async () => {
  await withServer({ fetchImpl: async () => jsonResponse(200, { verified: true, next: 'workspace', statusToken: TOKEN }) }, async ({ request, calls }) => {
    const result = await request('POST', '/verify', { token: TOKEN, clientIp: '6.6.6.6' });
    assert.equal(result.status, 200);
    const [call] = calls;
    assert.equal(call.url, 'http://cp:4100/internal/fachapp/signup/verify');
    assert.equal(call.init.method, 'POST');
    assert.deepEqual(call.body, { token: TOKEN, clientIp: '203.0.113.9' });
    const verification = verifyControlPlaneRequest({
      secret: SECRET,
      timestamp: call.init.headers['X-Control-Plane-Timestamp'],
      signature: call.init.headers['X-Control-Plane-Signature'],
      idempotencyKey: 'egal',
      method: 'POST',
      path: '/internal/fachapp/signup/verify',
      body: call.init.body,
    });
    assert.equal(verification.ok, true);
  });
});

test('verify: Checkout-Adresse nur auf Stripe-Hosts, sonst entfällt sie', async () => {
  const stripe = 'https://checkout.stripe.com/c/pay/cs_test_123';
  await withServer({ fetchImpl: async () => jsonResponse(200, { verified: true, next: 'checkout', url: stripe, statusToken: TOKEN, statusTokenExpiresInSeconds: 3600 }) }, async ({ request }) => {
    const result = await request('POST', '/verify', { token: TOKEN });
    assert.deepEqual(result.body, { verified: true, next: 'checkout', url: stripe, statusToken: TOKEN, statusTokenExpiresInSeconds: 3600 });
  });
  for (const url of ['https://evil.example/pay', 'http://checkout.stripe.com/x', 'javascript:alert(1)', 'https://user:pw@checkout.stripe.com/x']) {
    await withServer({ fetchImpl: async () => jsonResponse(200, { verified: true, next: 'checkout', url, statusToken: TOKEN }) }, async ({ request }) => {
      const result = await request('POST', '/verify', { token: TOKEN });
      assert.equal(result.body.next, 'checkout');
      assert.equal('url' in result.body, false, url);
    });
  }
});

test('status: Token aus Header oder ?token=, Zahlungsadresse wird geprüft, Testfeld ownerInvitation wird durchgereicht', async () => {
  await withServer({ fetchImpl: async () => jsonResponse(200, { state: 'awaiting_payment', url: 'https://checkout.stripe.com/c/x' }) }, async ({ request, calls }) => {
    assert.equal((await request('GET', '/status')).status, 404);
    const result = await request('GET', '/status', null, { 'X-Signup-Token': TOKEN });
    assert.equal(result.body.state, 'awaiting_payment');
    assert.deepEqual(calls[0].body, { token: TOKEN, clientIp: '203.0.113.9' });
    assert.equal(calls[0].url, 'http://cp:4100/internal/fachapp/signup/status');
  });
  await withServer({ fetchImpl: async () => jsonResponse(200, { state: 'invitation_sent', ownerInvitation: { link: 'https://app.test/?invite=abc' } }) }, async ({ request, calls }) => {
    const result = await request('GET', `/status?token=${TOKEN}`);
    assert.deepEqual(result.body, { state: 'invitation_sent', ownerInvitation: { link: 'https://app.test/?invite=abc' } });
    assert.equal(calls[0].body.token, TOKEN);
  });
});

test('resume-checkout: POST mit Token im Body, löst resumeCheckout aus, Adresse wird geprüft', async () => {
  await withServer({ fetchImpl: async () => jsonResponse(200, { state: 'awaiting_payment', url: 'https://checkout.stripe.com/c/neu' }) }, async ({ request, calls }) => {
    assert.equal((await request('POST', '/resume-checkout', { token: 'kurz' })).status, 404);
    const result = await request('POST', '/resume-checkout', { token: TOKEN });
    assert.deepEqual(result.body, { state: 'awaiting_payment', url: 'https://checkout.stripe.com/c/neu' });
    assert.deepEqual(calls[0].body, { token: TOKEN, resumeCheckout: true, clientIp: '203.0.113.9' });
  });
  await withServer({ fetchImpl: async () => jsonResponse(200, { state: 'awaiting_payment', url: 'https://evil.example/x' }) }, async ({ request }) => {
    assert.equal('url' in (await request('POST', '/resume-checkout', { token: TOKEN })).body, false);
  });
});

test('resend: Testfeld verificationToken wird durchgereicht', async () => {
  await withServer({ fetchImpl: async () => jsonResponse(200, { ok: true, verificationToken: 'TESTTOKEN-1234567890' }) }, async ({ request }) => {
    assert.equal((await request('POST', '/resend', { email: 'a@b.de' })).body.verificationToken, 'TESTTOKEN-1234567890');
  });
});

test('config: nur buchbare Tarife, ohne interne Felder', async () => {
  const raw = { registrationMode: 'invite_only', inviteRequired: true, requireEmailVerification: true, stripeConfigured: true, plans: [
    { id: 'pro', name: 'Pro', description: 'x', priceCents: 1900, currency: 'EUR', interval: 'month', status: 'active', checkoutAvailable: true, stripePriceId: 'price_1' },
    { id: 'alt', name: 'Alt', status: 'inactive', checkoutAvailable: true },
    { id: 'ohne', name: 'Ohne Zahlung', status: 'active', checkoutAvailable: false },
  ] };
  await withServer({ fetchImpl: async () => jsonResponse(200, raw) }, async ({ request }) => {
    const result = await request('GET', '/config');
    assert.equal(result.status, 200);
    assert.equal(result.body.inviteRequired, true);
    assert.deepEqual(result.body.plans.map(plan => plan.id), ['pro']);
    assert.ok(!JSON.stringify(result.body).includes('price_1'));
  });
  assert.deepEqual(mapSignupConfig({ stripeConfigured: false, plans: [{ id: 'a', name: 'A', status: 'active', checkoutAvailable: false }] }).plans.map(plan => plan.id), ['a']);
});

test('Abbildung: unbekannte Zustände werden vorsichtig gedeutet', () => {
  assert.equal(mapStatusResponse({ state: 'irgendwas' }).state, 'failed');
  assert.equal(mapStatusResponse({ state: 'creating_workspace' }).state, 'creating_workspace');
  assert.equal(mapVerifyResponse({ next: 'sonstwas' }).next, 'awaiting_access');
  assert.equal(mapVerifyResponse({ next: 'workspace', statusToken: 'kurz' }).statusToken, undefined);
  assert.equal(normalizeClientIp('::ffff:198.51.100.4'), '198.51.100.4');
  assert.equal(normalizeClientIp('kein-ip'), null);
  assert.equal(validateToken('a b c d e f g h i j k l m n o p'), null);
  assert.equal(validateStartInput({ ...VALID_START, name: '  Eva   Muster\u0000 ' }).value.name, 'Eva Muster');
});

test('callSignupAction: unbekannte Aktion wird abgelehnt, eigene clientIp der Eingabe wird überschrieben', async () => {
  await assert.rejects(() => callSignupAction('account/get', {}), /Unbekannte/);
  assert.deepEqual([...SIGNUP_ACTIONS], ['config', 'start', 'resend', 'verify', 'status']);
  let sent;
  await callSignupAction('config', { clientIp: 'gefälscht' }, { clientIp: '198.51.100.7', env: CONFIGURED_ENV, fetchImpl: async (_url, init) => { sent = JSON.parse(init.body); return jsonResponse(200, {}); } });
  assert.equal(sent.clientIp, '198.51.100.7');
});

test('Fachapp-Registrierung: mit Control Plane immer geschlossen, ohne unverändert; CSRF-Ausnahme für die öffentlichen Schritte', () => {
  assert.equal(effectiveRegistrationMode({ ...CONFIGURED_ENV, REGISTRATION_MODE: 'open' }), 'invite-only');
  assert.equal(effectiveRegistrationMode({}), 'closed-after-first');
  assert.equal(effectiveRegistrationMode({ REGISTRATION_MODE: 'invite-only' }), 'invite-only');
  assert.equal(effectiveRegistrationMode({ REGISTRATION_MODE: 'open' }), 'open');
  for (const path of ['/signup/start', '/signup/resend', '/signup/verify', '/signup/resume-checkout']) {
    let passed = false;
    csrfProtection({ method: 'POST', path, headers: {}, get: () => undefined }, { status: () => ({ json: () => undefined }) }, () => { passed = true; });
    assert.equal(passed, true, path);
  }
});
