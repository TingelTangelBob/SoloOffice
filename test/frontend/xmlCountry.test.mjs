import test from 'node:test';
import assert from 'node:assert/strict';
import { countryCode } from '../../.test-dist/utils/pdf/xmlUtils.js';

test('E-Rechnung übernimmt Länder korrekt und ersetzt unbekannte Werte niemals durch Deutschland', () => {
  for (const [value, expected] of [['Deutschland','DE'], ['cn','CN'], ['China','CN'], ['Portugal','PT'], ['Indien','IN'], ['Österreich','AT'], ['USA','US'], ['1A','1A'], ['XI','XI']]) {
    assert.equal(countryCode(value), expected);
  }
  for (const value of [undefined, '', 'Atlantis', 'ZZ']) assert.throws(() => countryCode(value), /Land fehlt oder ist unbekannt/);
});
