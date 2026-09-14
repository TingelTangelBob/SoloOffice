import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreDefaultTemplates } from '../../.test-dist/utils/templateDefaults.js';

const defaults = [
  { id: 'invoice-standard', documentType: 'invoice', name: 'Klar & klassisch', accentColor: '#111111', isDefault: true },
  { id: 'invoice-modern', documentType: 'invoice', name: 'Modern & fokussiert', accentColor: '#222222', isDefault: false },
  { id: 'reminder-standard', documentType: 'reminder', name: 'Mahnung Klassisch', reminderTexts: { stage1: 'Bitte zahlen.' }, isDefault: true },
];

test('Wiederherstellen ersetzt nur Standardvorlagen und behält eigene Vorlagen samt Position', () => {
  const current = [
    { id: 'invoice-standard', documentType: 'invoice', name: 'Umbenannt', accentColor: '#ff0000', isDefault: false },
    { id: 'custom-1', documentType: 'invoice', name: 'Eigene Rechnung', accentColor: '#00ff00', isDefault: true },
  ];
  const result = restoreDefaultTemplates(current, defaults, true);
  assert.deepEqual(result.map(template => template.id), ['invoice-standard', 'custom-1', 'invoice-modern', 'reminder-standard']);
  assert.equal(result[0].name, 'Klar & klassisch');
  assert.equal(result[0].accentColor, '#111111');
  assert.equal(result[0].isDefault, false, 'die eigene Standardwahl bleibt bestehen');
  assert.equal(result[1].isDefault, true);
  assert.equal(result[1].name, 'Eigene Rechnung');
  assert.equal(result[2].isDefault, false, 'nachgelegte Standards verdrängen keine bestehende Standardwahl');
  assert.equal(result[3].isDefault, true, 'ohne markierte Vorlage wird die erste des Typs Standard');
});

test('Wiederherstellen liefert Kopien der Mahntexte statt geteilter Objekte', () => {
  const result = restoreDefaultTemplates([], defaults, true);
  const reminder = result.find(template => template.id === 'reminder-standard');
  assert.notEqual(reminder.reminderTexts, defaults[2].reminderTexts);
  assert.deepEqual(reminder.reminderTexts, { stage1: 'Bitte zahlen.' });
});

test('Textvorlagen werden ohne Standardmarkierung zurückgesetzt', () => {
  const textDefaults = [
    { id: 'text-invoice', documentType: 'invoice', subject: 'Rechnung {invoiceNumber}' },
    { id: 'text-quote', documentType: 'quote', subject: 'Angebot {quoteNumber}' },
  ];
  const current = [{ id: 'text-invoice', documentType: 'invoice', subject: 'Geändert' }];
  const result = restoreDefaultTemplates(current, textDefaults, false);
  assert.deepEqual(result.map(template => template.subject), ['Rechnung {invoiceNumber}', 'Angebot {quoteNumber}']);
  assert.equal('isDefault' in result[0], false);
});
