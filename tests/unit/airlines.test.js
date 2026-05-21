import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { airlineInfoForCarrier, normalizeCarrierCode } from '../../server/airlines.js';

describe('airline helpers', () => {
  it('resolves known IATA carrier codes to names and websites', () => {
    assert.deepEqual(airlineInfoForCarrier('TP'), {
      code: 'TP',
      name: 'TAP Air Portugal',
      website: 'https://www.flytap.com/'
    });
  });

  it('resolves known airline names when a provider does not return a code', () => {
    assert.deepEqual(airlineInfoForCarrier('Pegasus Airlines'), {
      code: null,
      name: 'Pegasus Airlines',
      website: 'https://www.flypgs.com/'
    });
  });

  it('keeps unknown carriers displayable without inventing a website', () => {
    assert.deepEqual(airlineInfoForCarrier('Test Air'), {
      code: null,
      name: 'Test Air',
      website: null
    });
  });

  it('normalizes two-character carrier codes', () => {
    assert.equal(normalizeCarrierCode('fr'), 'FR');
    assert.equal(normalizeCarrierCode('Fixture Air'), null);
  });
});
