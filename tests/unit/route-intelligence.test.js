import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { estimateRouteCost, rankTransferRoutes } from '../../server/route-intelligence.js';

describe('route intelligence helpers', () => {
  it('estimates known transfer routes from typical leg prices', () => {
    const estimate = estimateRouteCost(['Porto', 'Madrid', 'Dubai'], '2026-05-20');
    assert.equal(Math.round(estimate.estimatedAmount), 277);
    assert.equal(estimate.confidence, 1);
    assert.deepEqual(estimate.legs.map((leg) => leg.airlines[0]), ['FR', 'PC']);
  });

  it('ranks cheaper likely transfer routes before expensive long-tail routes', () => {
    const ranked = rankTransferRoutes([
      ['Porto', 'Doha', 'Dubai'],
      ['Porto', 'Madrid', 'Dubai'],
      ['Porto', 'Paris', 'Dubai'],
      ['Porto', 'Athens', 'Dubai']
    ], '2026-05-20');

    assert.deepEqual(ranked.routes.slice(0, 2), [
      ['Porto', 'Madrid', 'Dubai'],
      ['Porto', 'Athens', 'Dubai']
    ]);
  });

  it('returns skipped low-priority routes when a live-search limit is applied', () => {
    const ranked = rankTransferRoutes([
      ['Porto', 'Madrid', 'Dubai'],
      ['Porto', 'Athens', 'Dubai'],
      ['Porto', 'Paris', 'Dubai']
    ], '2026-05-20', { limit: 2 });

    assert.deepEqual(ranked.routes.map((route) => route.join(' -> ')), [
      'Porto -> Madrid -> Dubai',
      'Porto -> Athens -> Dubai'
    ]);
    assert.deepEqual(ranked.skippedRoutes.map((entry) => entry.route.join(' -> ')), [
      'Porto -> Paris -> Dubai'
    ]);
  });
});
