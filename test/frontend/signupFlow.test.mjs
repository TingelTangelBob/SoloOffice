import assert from 'node:assert/strict';
import test from 'node:test';
import {
  POLL_MAX_MS,
  clearStatusToken,
  fieldForErrorCode,
  hasSignupParams,
  initialWaitState,
  nextPollDelay,
  nextWaitState,
  readSignupParams,
  readStatusToken,
  stripSignupParams,
  validateSignupForm,
  waitView,
  writeStatusToken,
} from '../../.test-dist/utils/signupFlow.js';

test('Adressparameter werden gelesen und samt Tokens aus der Adresse entfernt', () => {
  const params = readSignupParams('?verify=abc&checkout=success&einladung=inv&register=&x=1');
  assert.deepEqual(params, { verify: 'abc', checkout: 'success', invite: 'inv', register: true });
  assert.equal(hasSignupParams(params), true);
  assert.equal(hasSignupParams(readSignupParams('?invite=x')), false);
  assert.equal(readSignupParams('?checkout=boom').checkout, null);
  assert.equal(stripSignupParams('https://app.test/?verify=abc&x=1&checkout=cancelled#settings'), '/?x=1#settings');
  assert.equal(stripSignupParams('https://app.test/?einladung=t'), '/');
});

test('Fortsetzungs-Token: sessionStorage mit try/catch, gesperrter Speicher bricht nichts', () => {
  const store = new Map();
  const storage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) };
  assert.equal(readStatusToken(storage), '');
  writeStatusToken('tok', storage);
  assert.equal(readStatusToken(storage), 'tok');
  clearStatusToken(storage);
  assert.equal(readStatusToken(storage), '');
  const broken = { getItem() { throw new Error('gesperrt'); }, setItem() { throw new Error('gesperrt'); }, removeItem() { throw new Error('gesperrt'); } };
  assert.equal(readStatusToken(broken), '');
  assert.doesNotThrow(() => { writeStatusToken('x', broken); clearStatusToken(broken); });
  assert.equal(readStatusToken(null), '');
});

test('Warteseite: Zahlung, Einrichtung, Einladung verschickt', () => {
  let state = initialWaitState;
  assert.equal(waitView(state).heading, 'Ihr Arbeitsbereich wird eingerichtet');
  state = nextWaitState(state, { type: 'response', state: 'awaiting_payment' });
  assert.equal(state.phase, 'polling');
  assert.equal(waitView(state).heading, 'Zahlung wird bestätigt');
  assert.equal(waitView(state).busy, true);
  state = nextWaitState(state, { type: 'response', state: 'creating_workspace' });
  assert.equal(waitView(state).heading, 'Ihr Arbeitsbereich wird eingerichtet');
  state = nextWaitState(state, { type: 'response', state: 'invitation_sent' });
  assert.equal(state.phase, 'done');
  assert.match(waitView(state).message, /E-Mail mit einem Link zum Einrichten Ihres Zugangs/);
  assert.equal(nextPollDelay(state, 0), null);
  // Ein beendeter Zustand bleibt.
  assert.equal(nextWaitState(state, { type: 'response', state: 'failed' }), state);
});

test('Warteseite: failed, Zeitablauf, Token abgelaufen, wiederholte Netzfehler', () => {
  assert.equal(nextWaitState(initialWaitState, { type: 'response', state: 'failed' }).phase, 'failed');
  assert.match(waitView({ phase: 'failed', serverState: 'failed', errors: 0 }).message, /Support/);
  assert.equal(nextWaitState(initialWaitState, { type: 'tick', elapsedMs: POLL_MAX_MS - 1 }).phase, 'polling');
  const timeout = nextWaitState(initialWaitState, { type: 'tick', elapsedMs: POLL_MAX_MS });
  assert.equal(timeout.phase, 'timeout');
  assert.match(waitView(timeout).message, /Support/);
  assert.equal(nextWaitState(initialWaitState, { type: 'error', status: 404 }).phase, 'expired');
  let state = initialWaitState;
  for (let i = 0; i < 4; i += 1) state = nextWaitState(state, { type: 'error', status: 502 });
  assert.equal(state.phase, 'polling');
  // Eine gute Antwort setzt die Fehlerzählung zurück.
  state = nextWaitState(state, { type: 'response', state: 'creating_workspace' });
  assert.equal(state.errors, 0);
  for (let i = 0; i < 5; i += 1) state = nextWaitState(state, { type: 'error' });
  assert.equal(state.phase, 'unreachable');
});

test('Abfragetakt: alle 3 Sekunden, nicht über zwei Minuten hinaus', () => {
  assert.equal(nextPollDelay(initialWaitState, 0), 3000);
  assert.equal(nextPollDelay(initialWaitState, 117_000), 3000);
  assert.equal(nextPollDelay(initialWaitState, 120_000), null);
});

test('Formularprüfung und Zuordnung von Fehlercodes zu Feldern', () => {
  const ok = { name: 'Eva Muster', email: 'eva@example.test', inviteToken: '', inviteRequired: false, acceptTerms: true, acceptPrivacy: true };
  assert.deepEqual(validateSignupForm(ok), {});
  const bad = validateSignupForm({ ...ok, name: 'E', email: 'x', inviteRequired: true, acceptTerms: false, acceptPrivacy: false });
  assert.deepEqual(Object.keys(bad).sort(), ['acceptPrivacy', 'acceptTerms', 'email', 'inviteToken', 'name']);
  assert.ok(validateSignupForm({ ...ok, name: 'x'.repeat(121) }).name);
  assert.equal(fieldForErrorCode('INVITE_INVALID', undefined), 'inviteToken');
  assert.equal(fieldForErrorCode('SIGNUP_INVALID', 'email'), 'email');
  assert.equal(fieldForErrorCode('RATE_LIMIT', undefined), null);
});
