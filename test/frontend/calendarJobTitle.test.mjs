import test from 'node:test';
import assert from 'node:assert/strict';
import { getCalendarJobTitle, hasCalendarJobTitle } from '../../.test-dist/utils/calendarJobTitle.js';

test('calendar title prefers the appointment name and excludes an invoice number used as title', () => {
  assert.equal(getCalendarJobTitle({ title: 'Mathe-Nachhilfe' }, 'Mara Beispiel'), 'Mathe-Nachhilfe');
  assert.equal(getCalendarJobTitle({ title: 'Rechnung RE-2026-034' }, 'Mara Beispiel'), 'Termin mit Mara Beispiel');
  assert.equal(getCalendarJobTitle({ title: '' }, 'Mara Beispiel'), 'Termin mit Mara Beispiel');
  assert.equal(getCalendarJobTitle({ title: 'Rechnung RE-2026-034' }), 'Termin');
});

test('reports whether a job has a displayable appointment title', () => {
  assert.equal(hasCalendarJobTitle({ title: 'Mathe-Nachhilfe' }), true);
  assert.equal(hasCalendarJobTitle({ title: ' Rechnung RE-2026-034 ' }), false);
  assert.equal(hasCalendarJobTitle({ title: '  ' }), false);
});
