import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { airlineInfoForCarrier, normalizeCarrierCode } from '../../server/airlines.js';
import { baggageAllowanceForCarrier } from '../../server/baggage-allowances.js';

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

  it('resolves local baggage allowance by carrier and fare type', () => {
    const allowance = baggageAllowanceForCarrier('FR', { fareType: 'basic' });

    assert.equal(allowance.source, 'local-db');
    assert.equal(allowance.fareType, 'basic');
    assert.match(allowance.summary, /small personal bag/i);
    assert.equal(allowance.sourceUrl, 'https://help.ryanair.com/hc/en-gb/articles/12888036565521-Ryanair-s-Bag-Policy');
  });

  it('falls back to the carrier default local baggage rule when fare type is unknown', () => {
    const allowance = baggageAllowanceForCarrier('TAP Air Portugal', { fareType: 'promo' });

    assert.equal(allowance.source, 'local-db');
    assert.equal(allowance.fareType, 'discount');
    assert.match(allowance.summary, /one hand baggage item/i);
  });
});
