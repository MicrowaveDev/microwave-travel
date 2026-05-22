import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { airportLabel, arrivalIsoInZone, inferLikelyHub } from '../../server/iata-codes.js';

describe('arrivalIsoInZone', () => {
  it('converts departure ISO + duration to destination local wall-clock time', () => {
    // Porto (UTC+1 WEST) → Madrid (UTC+2 CEST), 78 minutes.
    // 21:30 +01:00 = 20:30 UTC + 78 min = 21:48 UTC = 23:48 Europe/Madrid.
    assert.equal(
      arrivalIsoInZone('2026-05-26T21:30:00+01:00', 78, 'MAD'),
      '2026-05-26T23:48:00'
    );
  });

  it('handles cross-midnight arrivals in the destination zone', () => {
    // Madrid (UTC+2 CEST) → Dubai (UTC+4), 6h 45m.
    // 19:15 +02:00 = 17:15 UTC + 405 min = 24:00 UTC next day
    // = 04:00 Asia/Dubai next day.
    assert.equal(
      arrivalIsoInZone('2026-05-26T19:15:00+02:00', 405, 'DXB'),
      '2026-05-27T04:00:00'
    );
  });

  it('returns null when any input is missing or unsupported', () => {
    assert.equal(arrivalIsoInZone(null, 78, 'MAD'), null);
    assert.equal(arrivalIsoInZone('2026-05-26T21:30:00+01:00', 0, 'MAD'), null);
    assert.equal(arrivalIsoInZone('2026-05-26T21:30:00+01:00', 78, null), null);
    assert.equal(arrivalIsoInZone('2026-05-26T21:30:00+01:00', 78, 'XYZ'), null);
    assert.equal(arrivalIsoInZone('not-a-date', 78, 'MAD'), null);
  });
});

describe('airportLabel', () => {
  it('renders "City Airport" when the IATA has a named airport', () => {
    assert.equal(airportLabel('SAW'), 'Istanbul Sabiha Gökçen');
    assert.equal(airportLabel('CDG'), 'Paris Charles de Gaulle');
  });

  it('falls back to city only when no airport name is configured', () => {
    assert.equal(airportLabel('OPO'), 'Porto');
    assert.equal(airportLabel('DXB'), 'Dubai');
  });

  it('returns null for unknown or missing codes', () => {
    assert.equal(airportLabel('XYZ'), null);
    assert.equal(airportLabel(null), null);
    assert.equal(airportLabel(''), null);
  });
});

describe('inferLikelyHub', () => {
  it('returns the carrier\'s home hub for routes that connect through it', () => {
    assert.equal(inferLikelyHub('PC', 'MAD', 'DXB'), 'SAW');
    assert.equal(inferLikelyHub('TK', 'OPO', 'DXB'), 'IST');
    assert.equal(inferLikelyHub('LH', 'OPO', 'DXB'), 'FRA');
  });

  it('returns null when the hub coincides with origin or destination', () => {
    // Pegasus flying out of SAW directly — no transfer.
    assert.equal(inferLikelyHub('PC', 'SAW', 'DXB'), null);
    // Emirates DXB-MAD: hub equals origin.
    assert.equal(inferLikelyHub('EK', 'DXB', 'MAD'), null);
  });

  it('returns null for unknown carriers or missing input', () => {
    assert.equal(inferLikelyHub('ZZ', 'MAD', 'DXB'), null);
    assert.equal(inferLikelyHub(null, 'MAD', 'DXB'), null);
    assert.equal(inferLikelyHub('', 'MAD', 'DXB'), null);
  });
});
