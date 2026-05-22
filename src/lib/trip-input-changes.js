// Diff two trip-input snapshots into human-readable change lines for
// the price-search log. snapshotTripInput captures the planner state
// at a point in time; describeTripInputChanges produces messages like
// "Stop 2 city changed from Doha to Dubai".

import { normalizePassengerCountInput } from './trip-state.js';

export function snapshotTripInput(state) {
  return {
    origin: state.origin,
    startDate: state.startDate,
    passengers: normalizePassengerCountInput(state.passengers),
    lockOrder: state.lockOrder,
    stops: state.stops.map((stop, index) => ({
      id: stop.id,
      index,
      city: stop.city,
      visitBefore: stop.visitBefore,
      stayDays: stop.stayDays
    }))
  };
}

export function describeTripInputChanges(previous, next) {
  const changes = [];
  if (!previous) return changes;

  if (previous.origin !== next.origin) {
    changes.push(`Start city changed from ${previous.origin || 'empty'} to ${next.origin || 'empty'}.`);
  }
  if (previous.startDate !== next.startDate) {
    changes.push(`Trip start changed from ${previous.startDate || 'empty'} to ${next.startDate || 'empty'}.`);
  }
  if (previous.passengers !== next.passengers) {
    changes.push(`Passengers changed from ${previous.passengers || 1} to ${next.passengers || 1}.`);
  }
  if (previous.lockOrder !== next.lockOrder) {
    changes.push(`Lock-order setting changed to ${next.lockOrder ? 'enabled' : 'disabled'}.`);
  }

  const previousById = new Map(previous.stops.map((stop) => [stop.id, stop]));
  const nextById = new Map(next.stops.map((stop) => [stop.id, stop]));

  for (const stop of next.stops) {
    const before = previousById.get(stop.id);
    if (!before) {
      changes.push(`Stop ${stop.index + 1} added: ${formatStopForLog(stop)}.`);
      continue;
    }
    if (before.index !== stop.index) {
      changes.push(`${formatStopLabel(stop)} moved from row ${before.index + 1} to row ${stop.index + 1}.`);
    }
    if (before.city !== stop.city) {
      changes.push(`Stop ${stop.index + 1} city changed from ${before.city || 'empty'} to ${stop.city || 'empty'}.`);
    }
    if (before.visitBefore !== stop.visitBefore) {
      changes.push(`${formatStopLabel(stop)} visit-before date changed from ${before.visitBefore || 'empty'} to ${stop.visitBefore || 'empty'}.`);
    }
    if (before.stayDays !== stop.stayDays) {
      changes.push(`${formatStopLabel(stop)} days-to-spend changed from ${before.stayDays || 0} to ${stop.stayDays || 0}.`);
    }
  }

  for (const stop of previous.stops) {
    if (!nextById.has(stop.id)) {
      changes.push(`Stop ${stop.index + 1} removed: ${formatStopForLog(stop)}.`);
    }
  }

  return changes;
}

function formatStopLabel(stop) {
  return `Stop ${stop.index + 1} (${stop.city || 'empty'})`;
}

function formatStopForLog(stop) {
  const visitBefore = stop.visitBefore ? `, visit before ${stop.visitBefore}` : '';
  return `${stop.city || 'empty'}${visitBefore}, spend ${stop.stayDays || 0} day${Number(stop.stayDays) === 1 ? '' : 's'}`;
}
