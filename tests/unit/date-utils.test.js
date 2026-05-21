import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addDaysToDateString,
  daysBetween,
  formatDateShift,
  popularRouteDateChoices,
  shiftDisplayLegDates
} from '../../server/date-utils.js';

describe('date utility helpers', () => {
  it('adds signed day offsets to ISO date strings', () => {
    assert.equal(addDaysToDateString('2026-05-20', 2), '2026-05-22');
    assert.equal(addDaysToDateString('2026-05-20', -2), '2026-05-18');
    assert.equal(addDaysToDateString('not-a-date', 2), 'not-a-date');
  });

  it('calculates signed day differences', () => {
    assert.equal(daysBetween('2026-05-20', '2026-05-22'), 2);
    assert.equal(daysBetween('2026-05-20', '2026-05-18'), -2);
    assert.equal(daysBetween('bad', '2026-05-18'), 0);
  });

  it('builds date-flex choices around the first popular route segment', () => {
    assert.deepEqual(popularRouteDateChoices('2026-05-20', 0, 4, 2), [
      { date: '2026-05-20', offsetDays: 0 },
      { date: '2026-05-21', offsetDays: 1 },
      { date: '2026-05-19', offsetDays: -1 },
      { date: '2026-05-22', offsetDays: 2 },
      { date: '2026-05-18', offsetDays: -2 }
    ]);
  });

  it('extends leading date-flex choices through a visit-before window', () => {
    assert.deepEqual(popularRouteDateChoices('2026-05-20', 0, 4, 2, { latestBeforeDate: '2026-05-29' }), [
      { date: '2026-05-20', offsetDays: 0 },
      { date: '2026-05-21', offsetDays: 1 },
      { date: '2026-05-19', offsetDays: -1 },
      { date: '2026-05-22', offsetDays: 2 },
      { date: '2026-05-18', offsetDays: -2 },
      { date: '2026-05-23', offsetDays: 3 },
      { date: '2026-05-24', offsetDays: 4 },
      { date: '2026-05-25', offsetDays: 5 },
      { date: '2026-05-26', offsetDays: 6 },
      { date: '2026-05-27', offsetDays: 7 },
      { date: '2026-05-28', offsetDays: 8 }
    ]);
  });

  it('uses forward-only search dates for non-leading segments', () => {
    assert.deepEqual(popularRouteDateChoices('2026-05-20', 1, 3, 2), [
      { date: '2026-05-20', offsetDays: 0 },
      { date: '2026-05-21', offsetDays: 1 },
      { date: '2026-05-22', offsetDays: 2 }
    ]);
  });

  it('shifts downstream display leg dates without mutating originals', () => {
    const legs = [
      { from: 'Dubai', to: 'Moscow', departOn: '2026-05-23', arriveBy: '2026-05-23' }
    ];
    const shifted = shiftDisplayLegDates(legs, 1);
    assert.equal(shifted[0].departOn, '2026-05-24');
    assert.equal(shifted[0].arriveBy, '2026-05-24');
    assert.equal(legs[0].departOn, '2026-05-23');
  });

  it('formats date-flex labels', () => {
    assert.equal(formatDateShift(0), '');
    assert.equal(formatDateShift(2), ' (+2d flex)');
    assert.equal(formatDateShift(-1), ' (-1d flex)');
  });
});
