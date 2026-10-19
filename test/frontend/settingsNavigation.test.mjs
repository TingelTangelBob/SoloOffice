import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_SETTINGS_AREA,
  SETTINGS_AREAS,
  SETTINGS_AREA_DEFINITIONS,
  SETTINGS_GROUPS,
  changedFields,
  dirtySettingsAreas,
  findSettingsSection,
  normalizeSettingsArea,
  orderedSettingsAreas,
  settingsSectionElementId,
} from '../../.test-dist/utils/settingsNavigation.js';
import { navigatePage, readPageState } from '../../.test-dist/utils/hashRouter.js';
import { searchSettings } from '../../.test-dist/utils/settingsSearch.js';

const LEGACY_TABS = ['app', 'general', 'invoices', 'appearance', 'system', 'extensions', 'taxes'];

class BrowserHistoryHarness {
  entries;
  index = 0;

  constructor(initialUrl) {
    this.entries = [new URL(initialUrl)];
  }

  get state() { return null; }
  get href() { return this.entries[this.index].href; }

  pushState(_state, _title, url) {
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(new URL(url, this.href));
    this.index += 1;
  }

  back() { this.index = Math.max(0, this.index - 1); }
  forward() { this.index = Math.min(this.entries.length - 1, this.index + 1); }
}

test('alle bisherigen Reiter-IDs bleiben gültige Bereiche und erscheinen genau einmal in der Navigation', () => {
  assert.deepEqual([...SETTINGS_AREAS].sort(), [...LEGACY_TABS].sort());
  const navAreas = SETTINGS_GROUPS.flatMap(group => group.areas);
  assert.deepEqual([...navAreas].sort(), [...LEGACY_TABS].sort());
  assert.equal(new Set(navAreas).size, navAreas.length);
  assert.deepEqual(orderedSettingsAreas(), navAreas);
  for (const area of LEGACY_TABS) {
    assert.equal(normalizeSettingsArea(area), area);
    assert.equal(readPageState(new URL(`https://app.example.test/#settings/${area}`)).filter, area);
    assert.equal(readPageState(new URL(`https://app.example.test/?settingsTab=${area}#settings`)).filter, area);
  }
});

test('unbekannte oder fehlende Bereiche öffnen die Firmendaten', () => {
  assert.equal(DEFAULT_SETTINGS_AREA, 'general');
  assert.equal(normalizeSettingsArea(undefined), 'general');
  assert.equal(normalizeSettingsArea('unbekannt'), 'general');
  assert.equal(normalizeSettingsArea(''), 'general');
});

test('Abschnitts-IDs sind je Bereich eindeutig und als Deep-Link adressierbar', () => {
  for (const area of SETTINGS_AREAS) {
    const ids = SETTINGS_AREA_DEFINITIONS[area].sections.map(section => section.id);
    assert.ok(ids.length > 0, `${area} braucht mindestens einen Abschnitt`);
    assert.equal(new Set(ids).size, ids.length, `${area} hat doppelte Abschnitte`);
    for (const id of ids) assert.match(id, /^[a-z0-9-]+$/);
  }
  const state = readPageState(new URL('https://app.example.test/#settings/invoices/nummernkreise'));
  assert.equal(state.filter, 'invoices');
  assert.equal(state.searchTerm, 'nummernkreise');
  assert.equal(findSettingsSection('invoices', state.searchTerm)?.title, 'Nummernkreise');
  assert.equal(findSettingsSection('general', 'nummernkreise'), undefined);
  assert.equal(settingsSectionElementId('nummernkreise'), 'settings-section-nummernkreise');
});

test('Bereichswechsel legen Verlaufseinträge an, Zurück und Vor stellen Bereich und Abschnitt wieder her', () => {
  const history = new BrowserHistoryHarness('https://app.example.test/#dashboard');
  navigatePage(history, history.href, 'settings', 'general');
  navigatePage(history, history.href, 'settings', 'taxes');
  navigatePage(history, history.href, 'settings', 'invoices', 'bankverbindung');

  assert.deepEqual(
    [readPageState(new URL(history.href)).filter, readPageState(new URL(history.href)).searchTerm],
    ['invoices', 'bankverbindung'],
  );
  history.back();
  assert.equal(readPageState(new URL(history.href)).filter, 'taxes');
  history.back();
  assert.equal(readPageState(new URL(history.href)).filter, 'general');
  history.forward();
  history.forward();
  assert.equal(readPageState(new URL(history.href)).searchTerm, 'bankverbindung');
});

test('ungespeicherte Änderungen werden dem richtigen Bereich zugeordnet', () => {
  const saved = { name: 'Demo', primaryColor: '#2563eb', paymentInformation: { bankAccount: 'DE1' }, quotesEnabled: false };
  assert.deepEqual(changedFields(saved, { ...saved }), []);
  assert.deepEqual(dirtySettingsAreas(saved, { ...saved }), []);

  const edited = { ...saved, name: 'Neu', primaryColor: '#15803d', paymentInformation: { bankAccount: 'DE2' }, quotesEnabled: true };
  assert.deepEqual(changedFields(saved, edited).sort(), ['name', 'paymentInformation', 'primaryColor', 'quotesEnabled']);
  // Reihenfolge wie in der Navigation: Firmendaten, Rechnungen, Module, Darstellung.
  assert.deepEqual(dirtySettingsAreas(saved, edited), ['general', 'invoices', 'app', 'appearance']);
});

test('fehlende und leere Werte gelten nicht als Änderung', () => {
  assert.deepEqual(changedFields({ website: undefined }, { website: null }), []);
  assert.deepEqual(changedFields({}, { website: undefined }), []);
  assert.deepEqual(changedFields({ website: '' }, { website: 'x' }), ['website']);
});

test('die Suche findet Abschnitte über Titel, Stichworte und Umlaute', () => {
  assert.deepEqual(searchSettings(''), []);
  assert.deepEqual(searchSettings('   '), []);

  const iban = searchSettings('iban');
  assert.equal(iban[0]?.area, 'invoices');
  assert.equal(iban[0]?.sectionId, 'bankverbindung');

  assert.equal(searchSettings('Dunkelmodus')[0]?.sectionId, 'erscheinungsbild');
  assert.equal(searchSettings('wahrung')[0]?.sectionId, 'sprache');
  assert.equal(searchSettings('Währung')[0]?.sectionId, 'sprache');
  assert.equal(searchSettings('kirchensteuer')[0]?.area, 'taxes');
  // Der alte Reitername „Allgemein“ führt weiter zum Bereich Module & Begriffe.
  assert.ok(searchSettings('allgemein').some(result => result.area === 'app'));
  // Alle Wörter müssen passen.
  assert.deepEqual(searchSettings('iban dunkelmodus'), []);
  assert.ok(searchSettings('a', 3).length <= 3);
});
