import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  elapsedMinutes,
  estimateLayoverMinutes,
  formatMinutesLabel,
  totalLayoverMinutes
} from '../../src/lib/leg-time.js';

describe('formatMinutesLabel', () => {
  it('renders hours and minutes', () => {
    assert.equal(formatMinutesLabel(130), '2h 10m');
    assert.equal(formatMinutesLabel(60), '1h');
    assert.equal(formatMinutesLabel(45), '45m');
  });

  it('returns empty for non-positive or non-numeric input', () => {
    assert.equal(formatMinutesLabel(0), '');
    assert.equal(formatMinutesLabel(-30), '');
    assert.equal(formatMinutesLabel(null), '');
    assert.equal(formatMinutesLabel('not a number'), '');
  });
});

describe('elapsedMinutes', () => {
  it('returns difference in minutes between ISO timestamps', () => {
    assert.equal(
      elapsedMinutes('2026-05-21T13:30:00+01:00', '2026-05-21T16:40:00+02:00'),
      130
    );
  });

  it('returns null when either side is missing or invalid', () => {
    assert.equal(elapsedMinutes(null, '2026-05-21T16:40:00+02:00'), null);
    assert.equal(elapsedMinutes('not-a-date', '2026-05-21T16:40:00+02:00'), null);
    assert.equal(elapsedMinutes('2026-05-21T13:30:00+01:00', '2026-05-21T13:30:00+01:00'), null);
  });
});

describe('totalLayoverMinutes', () => {
  it('sums the gaps between consecutive segments', () => {
    const segments = [
      { departingAt: '2026-05-21T13:30:00+02:00', arrivingAt: '2026-05-21T16:00:00+03:00' },
      { departingAt: '2026-05-22T04:30:00+03:00', arrivingAt: '2026-05-22T09:10:00+04:00' }
    ];
    // SAW arrival 16:00 +03 = 13:00 UTC; SAW departure 04:30 next day +03 = 01:30 UTC next day
    // gap = 12h 30m = 750 min.
    assert.equal(totalLayoverMinutes(segments), 750);
  });

  it('returns null for single-segment or unparsable inputs', () => {
    assert.equal(totalLayoverMinutes([]), null);
    assert.equal(totalLayoverMinutes([{ departingAt: 'x', arrivingAt: 'y' }]), null);
    assert.equal(
      totalLayoverMinutes([
        { departingAt: '2026-05-21T13:30:00+02:00', arrivingAt: 'bad' },
        { departingAt: '2026-05-22T04:30:00+03:00', arrivingAt: '2026-05-22T09:10:00+04:00' }
      ]),
      null
    );
  });
});

describe('estimateLayoverMinutes', () => {
  it('approximates layover for MAD-DXB 22h 10m trip', () => {
    // distance 5649 km / 800 km/h * 60 = 423.675 min flight time.
    // 1330 min total - 424 ≈ 906 min (~15h 6m).
    const minutes = estimateLayoverMinutes(1330, 5649);
    assert.ok(minutes >= 905 && minutes <= 907, `expected ~906, got ${minutes}`);
  });

  it('returns null when the estimated layover is too small to display', () => {
    // 405 min total - 423 min flight = negative; clamped to null.
    assert.equal(estimateLayoverMinutes(405, 5649), null);
    // 470 min total - 423 = 47 min, above the 30-min threshold.
    assert.ok(Number(estimateLayoverMinutes(470, 5649)) > 30);
    // 440 min total - 423 = 17 min, below threshold.
    assert.equal(estimateLayoverMinutes(440, 5649), null);
  });

  it('returns null when either input is missing or non-positive', () => {
    assert.equal(estimateLayoverMinutes(null, 5649), null);
    assert.equal(estimateLayoverMinutes(1330, null), null);
    assert.equal(estimateLayoverMinutes(0, 5649), null);
    assert.equal(estimateLayoverMinutes(1330, 0), null);
  });
});
