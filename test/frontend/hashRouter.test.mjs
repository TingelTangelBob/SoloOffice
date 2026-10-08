import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPageUrl, navigatePage, readPageState } from '../../.test-dist/utils/hashRouter.js';

class BrowserHistoryHarness {
  entries;
  index = 0;
  pushes = 0;

  constructor(initialUrl) {
    this.entries = [new URL(initialUrl)];
  }

  get state() { return null; }
  get href() { return this.entries[this.index].href; }

  pushState(_state, _title, url) {
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(new URL(url, this.href));
    this.index += 1;
    this.pushes += 1;
  }

  replaceState(_state, _title, url) {
    this.entries[this.index] = new URL(url, this.href);
  }

  back() { this.index = Math.max(0, this.index - 1); }
  forward() { this.index = Math.min(this.entries.length - 1, this.index + 1); }
}

test('Vor und Zurück synchronisieren Seite und Einstellungsreiter aus der URL', () => {
  const history = new BrowserHistoryHarness('https://app.example.test/#templates');

  const settingsState = navigatePage(history, history.href, 'settings');
  assert.equal(settingsState.page, 'settings');
  assert.equal(history.pushes, 1);
  assert.equal(history.entries.length, 2);

  const settingsUrl = new URL(history.href);
  settingsUrl.searchParams.set('settingsTab', 'app');
  history.replaceState(history.state, '', settingsUrl);
  assert.equal(history.entries.length, 2, 'Ein Reiterwechsel darf keinen Verlaufseintrag hinzufügen');

  history.back();
  assert.equal(readPageState(new URL(history.href)).page, 'templates');
  history.forward();
  assert.equal(readPageState(new URL(history.href)).page, 'settings');
  assert.equal(readPageState(new URL(history.href)).filter, 'app');

  navigatePage(history, history.href, 'templates');
  assert.equal(history.entries.length, 3);
  assert.equal(new URL(history.href).searchParams.has('settingsTab'), false);
  history.back();
  assert.equal(readPageState(new URL(history.href)).page, 'settings');
  assert.equal(readPageState(new URL(history.href)).filter, 'app');
  assert.equal(history.pushes, 2, 'Jede App-Navigation erzeugt genau einen Eintrag');
});

test('Ungültige Einstellungsreiter werden ignoriert und andere Query-Parameter bleiben erhalten', () => {
  assert.equal(readPageState(new URL('https://app.example.test/?settingsTab=unbekannt#settings')).filter, undefined);
  assert.equal(readPageState(new URL('https://app.example.test/?settingsTab=app#settings/general')).filter, 'general');

  const destination = buildPageUrl('https://app.example.test/?settingsTab=app&invite=abc#settings', 'templates');
  assert.equal(readPageState(destination).page, 'templates');
  assert.equal(destination.searchParams.get('invite'), 'abc');
  assert.equal(destination.searchParams.has('settingsTab'), false);
});
