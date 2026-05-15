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

  it('routes Kaliningrad through Gdansk ground transfer', () => {
    const plan = optimizeTrip({
      origin: 'porto',
      stops: ['kaliningrad', 'moscow'],
      startDate: '2026-05-20',
      lockOrder: true
    });

    assert.deepEqual(
      plan.legs.map((leg) => `${leg.from}->${leg.to}:${leg.mode}`),
      ['Porto->Gdansk:flight', 'Gdansk->Kaliningrad:bus', 'Kaliningrad->Moscow:flight', 'Moscow->Porto:flight']
    );
  });

  it('does not route Russia mainland to Kaliningrad through Gdansk', () => {
    const plan = optimizeTrip({
      origin: 'moscow',
      stops: ['kaliningrad'],
      startDate: '2026-05-20',
      lockOrder: true
    });

    assert.deepEqual(
      plan.legs.map((leg) => `${leg.from}->${leg.to}:${leg.mode}`),
      ['Moscow->Kaliningrad:flight', 'Kaliningrad->Moscow:flight']
    );
  });

  it('removes duplicate consecutive city legs', () => {
    const plan = optimizeTrip({
      origin: 'porto',
      stops: ['dubai', 'dubai'],
      startDate: '2026-05-20',
      lockOrder: true
    });

    assert.deepEqual(
      plan.legs.map((leg) => `${leg.from}->${leg.to}`),
      ['Porto->Dubai', 'Dubai->Porto']
    );
  });
});
