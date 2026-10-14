import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import {
  COMPANY_SETTINGS_GUARD_ID,
  TAX_PROFILE_GUARD_ID,
  SMTP_SETTINGS_GUARD_ID,
  confirmNavigation,
  guardScopeForNavigation,
  isNavigationBlocked,
  registerNavigationGuard,
  resetNavigationGuardsForTests,
} from '../../.test-dist/utils/navigationGuard.js';
import { visibleTaxProfileSteps } from '../../.test-dist/utils/taxProfileSteps.js';

function guard(id, { dirty = true, answer = true } = {}) {
  const calls = { confirm: 0 };
  const state = { dirty, answer };
  const unregister = registerNavigationGuard({
    id,
    isBlocking: () => state.dirty,
    confirm: async () => {
      calls.confirm += 1;
      return state.answer;
    },
  });
  return { calls, state, unregister };
}

beforeEach(() => resetNavigationGuardsForTests());

test('ohne ungespeicherte Änderungen wird nicht nachgefragt', async () => {
  const company = guard(COMPANY_SETTINGS_GUARD_ID, { dirty: false });
  assert.equal(isNavigationBlocked(), false);
  assert.equal(await confirmNavigation(), true);
  assert.equal(company.calls.confirm, 0);
});

test('ungespeicherte Änderungen fragen nach; Abbrechen verhindert das Verlassen', async () => {
  const company = guard(COMPANY_SETTINGS_GUARD_ID, { answer: false });
  assert.equal(isNavigationBlocked(), true);
  assert.equal(await confirmNavigation(), false);
  assert.equal(company.calls.confirm, 1);

  company.state.answer = true;
  assert.equal(await confirmNavigation(), true);
  assert.equal(company.calls.confirm, 2);
});

test('nach dem Speichern oder Abmelden blockiert der Schutz nicht mehr', async () => {
  const company = guard(COMPANY_SETTINGS_GUARD_ID);
  company.state.dirty = false;
  assert.equal(isNavigationBlocked(), false);
  company.state.dirty = true;
  company.unregister();
  assert.equal(isNavigationBlocked(), false);
});

test('eine alte Abmeldung entfernt nicht den neu angemeldeten Schutz', () => {
  const first = guard(TAX_PROFILE_GUARD_ID);
  guard(TAX_PROFILE_GUARD_ID);
  first.unregister();
  assert.equal(isNavigationBlocked([TAX_PROFILE_GUARD_ID]), true);
});

test('Bereichswechsel in den Einstellungen prüft nur das Steuerprofil, Seitenwechsel alles', async () => {
  assert.equal(guardScopeForNavigation({ page: 'dashboard' }, { page: 'settings', filter: 'general' }), null);
  assert.equal(guardScopeForNavigation({ page: 'settings', filter: 'general' }, { page: 'settings', filter: 'invoices' }), null);
  assert.equal(guardScopeForNavigation({ page: 'settings', filter: 'taxes' }, { page: 'settings', filter: 'taxes' }), null);
  assert.deepEqual(guardScopeForNavigation({ page: 'settings', filter: 'taxes' }, { page: 'settings', filter: 'general' }), [TAX_PROFILE_GUARD_ID]);
  assert.deepEqual(guardScopeForNavigation({ page: 'settings', filter: 'taxes' }, { page: 'settings' }), [TAX_PROFILE_GUARD_ID]);
  assert.equal(guardScopeForNavigation({ page: 'settings', filter: 'invoices' }, { page: 'customers' }), 'all');

  // Das Firmenformular bleibt beim Bereichswechsel erhalten und blockiert ihn nicht.
  const company = guard(COMPANY_SETTINGS_GUARD_ID);
  const tax = guard(TAX_PROFILE_GUARD_ID, { dirty: false });
  assert.equal(isNavigationBlocked([TAX_PROFILE_GUARD_ID]), false);
  assert.equal(await confirmNavigation([TAX_PROFILE_GUARD_ID]), true);
  assert.equal(company.calls.confirm, 0);

  tax.state.dirty = true;
  tax.state.answer = false;
  assert.equal(await confirmNavigation([TAX_PROFILE_GUARD_ID]), false);
  assert.equal(company.calls.confirm, 0);
});

test('beim Seitenwechsel wird jedes betroffene Formular einzeln bestätigt', async () => {
  const company = guard(COMPANY_SETTINGS_GUARD_ID);
  const tax = guard(TAX_PROFILE_GUARD_ID, { answer: false });
  assert.equal(await confirmNavigation('all'), false);
  assert.equal(company.calls.confirm, 1);
  assert.equal(tax.calls.confirm, 1);
});

test('Mail-Einrichtung schützt den Entwurf beim Verlassen des Systembereichs', async () => {
  const smtp = guard(SMTP_SETTINGS_GUARD_ID, { answer: false });
  assert.equal(guardScopeForNavigation({ page: 'settings', filter: 'system' }, { page: 'settings', filter: 'system' }), null);
  const scope = guardScopeForNavigation({ page: 'settings', filter: 'system' }, { page: 'settings', filter: 'general' });
  assert.deepEqual(scope, [SMTP_SETTINGS_GUARD_ID]);
  assert.equal(await confirmNavigation(scope), false);
  assert.equal(smtp.calls.confirm, 1);
  smtp.state.dirty = false;
  assert.equal(await confirmNavigation(scope), true);
});

test('Steuerprofil: Schritte sind ohne Handwerk lückenlos 1 bis 4 nummeriert', () => {
  for (const businessKind of [null, undefined, 'teacher', 'freelance', 'commercial', 'artist']) {
    const steps = visibleTaxProfileSteps(businessKind);
    assert.deepEqual(steps.map(step => step.number), [1, 2, 3, 4]);
    assert.ok(steps.every(step => step.total === 4));
    assert.equal(steps.some(step => step.id === 'craft'), false);
  }
});

test('Steuerprofil: mit Handwerk erscheint Schritt 2 und alle Schritte zählen bis 5', () => {
  for (const businessKind of ['craft_a', 'craft_b']) {
    const steps = visibleTaxProfileSteps(businessKind);
    assert.deepEqual(steps.map(step => [step.id, step.number, step.total]), [
      ['activity', 1, 5],
      ['craft', 2, 5],
      ['vat', 3, 5],
      ['insurance', 4, 5],
      ['personal', 5, 5],
    ]);
  }
});
