// Localstorage round-trip for the trip planner: load/save the user's
// origin/stops/dates/passengers/lockOrder, plus the stop and passenger
// normalizers that everything else routes through. Pure module — App.vue
// passes refs in via plain snapshots.

export const TRIP_STATE_STORAGE_KEY = 'microwave-travel:trip-state:v1';

export function createStop(city = 'Doha', visitBefore = '', stayDays = 0) {
  return {
    id: crypto.randomUUID(),
    city,
    visitBefore,
    stayDays
  };
}

export function defaultTripState() {
  return {
    origin: 'Porto',
    stops: [
      createStop('Doha', '', 1),
      createStop('Dubai', '2026-06-01', 2),
      createStop('Kaliningrad', '', 2),
      createStop('Moscow', '', 2),
      createStop('Dubai', '', 2),
      createStop('Doha', '', 1)
    ],
    startDate: '2026-05-20',
    passengers: 1,
    lockOrder: false
  };
}

export function loadTripState() {
  try {
    const stored = JSON.parse(localStorage.getItem(TRIP_STATE_STORAGE_KEY) || 'null');
    if (!stored || typeof stored !== 'object') return defaultTripState();
    const storedStops = Array.isArray(stored.stops) ? stored.stops.map(normalizeStoredStop).filter(Boolean) : [];
    return {
      origin: typeof stored.origin === 'string' && stored.origin.trim() ? stored.origin : 'Porto',
      stops: storedStops.length ? storedStops : defaultTripState().stops,
      startDate: typeof stored.startDate === 'string' && stored.startDate ? stored.startDate : '2026-05-20',
      passengers: normalizePassengerCountInput(stored.passengers),
      lockOrder: stored.lockOrder === true
    };
  } catch {
    return defaultTripState();
  }
}

export function saveTripState(state) {
  localStorage.setItem(TRIP_STATE_STORAGE_KEY, JSON.stringify({
    origin: state.origin,
    stops: state.stops.map((stop) => ({
      id: stop.id,
      city: stop.city,
      visitBefore: stop.visitBefore,
      stayDays: normalizeStayDaysInput(stop.stayDays)
    })),
    startDate: state.startDate,
    passengers: normalizePassengerCountInput(state.passengers),
    lockOrder: state.lockOrder
  }));
}

export function normalizeStayDaysInput(value) {
  const days = Number(value);
  return Number.isFinite(days) && days >= 0 ? Math.round(days * 10) / 10 : 0;
}

export function normalizePassengerCountInput(value) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 1 && count <= 9 ? count : 1;
}

function normalizeStoredStop(stop) {
  if (!stop || typeof stop !== 'object') return null;
  const city = typeof stop.city === 'string' && stop.city.trim() ? stop.city : 'Doha';
  const visitBefore = typeof stop.visitBefore === 'string'
    ? stop.visitBefore
    : stop.rule === 'before' && typeof stop.date === 'string'
      ? stop.date
      : '';
  return {
    ...createStop(city, visitBefore, normalizeStayDaysInput(stop.stayDays)),
    id: typeof stop.id === 'string' && stop.id ? stop.id : crypto.randomUUID()
  };
}
