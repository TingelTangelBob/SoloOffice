import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WORKSPACE_BUSINESS_DATA_DELETE_ORDER,
  WORKSPACE_COMPANY_PROFILE_TABLES,
  WORKSPACE_TAKEOVER_TABLES,
  planWorkspaceReset,
} from '../services/workspaceData.js';

test('ohne Optionen setzt der Reset Fachdaten, Firmendaten und Umzugsstatus zurück', () => {
  const plan = planWorkspaceReset();
  assert.equal(plan.companyProfile, true);
  assert.equal(plan.takeover, true);
  assert.deepEqual(plan.tables, WORKSPACE_BUSINESS_DATA_DELETE_ORDER);
});

test('der Umzugsstatus wird beim Zurücksetzen mit entfernt', () => {
  const plan = planWorkspaceReset({});
  for (const table of WORKSPACE_TAKEOVER_TABLES) {
    assert.ok(plan.tables.includes(table), `${table} muss zurückgesetzt werden`);
  }
  assert.ok(plan.tables.indexOf('migration_categories') < plan.tables.indexOf('migration_sessions'), 'Kategorien werden vor der Sitzung entfernt');
  assert.ok(plan.tables.indexOf('import_runs') < plan.tables.indexOf('migration_categories'), 'Importläufe werden vor den Kategorien entfernt');
});

test('behaltener Umzugsstatus lässt Sitzung und Kategorien stehen, löscht aber die Fachdaten', () => {
  const plan = planWorkspaceReset({ takeover: false });
  assert.equal(plan.takeover, false);
  for (const table of WORKSPACE_TAKEOVER_TABLES) {
    assert.ok(!plan.tables.includes(table), `${table} darf dann nicht entfernt werden`);
  }
  assert.ok(plan.tables.includes('invoices'));
  assert.ok(plan.tables.includes('import_runs'));
  assert.ok(plan.tables.includes('company'));
});

test('behaltene Firmendaten lassen Betriebsdaten, Nummernkreise und SMTP stehen', () => {
  const plan = planWorkspaceReset({ companyProfile: false });
  assert.equal(plan.companyProfile, false);
  for (const table of WORKSPACE_COMPANY_PROFILE_TABLES) {
    assert.ok(!plan.tables.includes(table), `${table} darf dann nicht entfernt werden`);
  }
  assert.ok(plan.tables.includes('customers'));
  assert.ok(plan.tables.includes('euer_entries'));
  assert.ok(plan.tables.includes('migration_sessions'));
  assert.ok(!plan.tables.includes('hourly_rates'), 'eigene Stundensätze bleiben erhalten');
  assert.ok(!plan.tables.includes('material_templates'), 'eigene Materialvorlagen bleiben erhalten');
});

test('beide Optionen abgewählt entfernt weiterhin alle Fachdaten', () => {
  const plan = planWorkspaceReset({ companyProfile: false, takeover: false });
  const kept = [...WORKSPACE_COMPANY_PROFILE_TABLES, ...WORKSPACE_TAKEOVER_TABLES];
  assert.deepEqual(plan.tables, WORKSPACE_BUSINESS_DATA_DELETE_ORDER.filter(table => !kept.includes(table)));
  assert.ok(plan.tables.length > 20);
});

test('Workspace-Identität und Mitgliedschaften gehören nie zum Reset', () => {
  for (const table of ['workspaces', 'workspace_members', 'users', 'sessions', 'workspace_setup']) {
    assert.ok(!WORKSPACE_BUSINESS_DATA_DELETE_ORDER.includes(table), `${table} darf nicht in der Fachdatenliste stehen`);
  }
});
