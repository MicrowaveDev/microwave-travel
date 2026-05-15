import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { optimizeTrip, parseStops } from './optimizer.js';

describe('travel optimizer', () => {
  it('parses comma-separated travel requirements', () => {
    assert.deepEqual(parseStops('doha, dubai, kaliningrad, moskow'), [
      'Doha',
      'Dubai',
      'Kaliningrad',
      'Moscow'
    ]);
  });

  it('keeps Dubai before the provided deadline when possible', () => {
    const plan = optimizeTrip({
      origin: 'porto',
      stopsText: 'doha, dubai, kaliningrad, moskow, dubai, doha',
      requirementsText: 'dubai before 1 June',
      startDate: '2026-05-20',
      lockOrder: false
    });

    const firstDubai = plan.legs.find((leg) => leg.to === 'Dubai');
    assert.ok(firstDubai);
    assert.ok(firstDubai.arriveBy < '2026-06-01');
    assert.equal(plan.warnings.length, 0);
  });

  it('adds departure dates to each leg for flight pricing', () => {
    const plan = optimizeTrip({
      origin: 'porto',
      stops: ['doha'],
      startDate: '2026-05-20'
    });

    assert.equal(plan.legs[0].departOn, '2026-05-20');
    assert.ok(plan.legs[0].arriveBy);
  });
});
