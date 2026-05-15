const CITY_ALIASES = new Map([
  ['porto', 'Porto'],
  ['opo', 'Porto'],
  ['doha', 'Doha'],
  ['doh', 'Doha'],
  ['dubai', 'Dubai'],
  ['dxb', 'Dubai'],
  ['kaliningrad', 'Kaliningrad'],
  ['kgd', 'Kaliningrad'],
  ['moscow', 'Moscow'],
  ['moskow', 'Moscow'],
  ['moskva', 'Moscow'],
  ['mow', 'Moscow']
]);

const CITY_COORDS = {
  Porto: [41.242, -8.678],
  Doha: [25.273, 51.608],
  Dubai: [25.253, 55.365],
  Kaliningrad: [54.89, 20.592],
  Moscow: [55.756, 37.617]
};

const DIRECT_ROUTE_HINTS = new Map([
  ['Porto|Doha', { hours: 8.4, reliability: 0.74, note: 'Usually one stop from Porto.' }],
  ['Doha|Dubai', { hours: 1.3, reliability: 0.96, note: 'Dense Gulf corridor.' }],
  ['Dubai|Doha', { hours: 1.3, reliability: 0.96, note: 'Dense Gulf corridor.' }],
  ['Dubai|Kaliningrad', { hours: 8.8, reliability: 0.45, note: 'Likely multiple connections.' }],
  ['Kaliningrad|Moscow', { hours: 2.0, reliability: 0.68, note: 'Check current border and airspace constraints.' }],
  ['Moscow|Dubai', { hours: 5.6, reliability: 0.72, note: 'Common long-haul leg.' }],
  ['Doha|Porto', { hours: 8.4, reliability: 0.74, note: 'Usually one stop back to Porto.' }]
]);

export function normalizeCity(value) {
  const key = String(value || '').trim().toLowerCase();
  if (!key) return '';
  return CITY_ALIASES.get(key) || toTitleCase(key);
}

export function parseStops(text) {
  return String(text || '')
    .split(/\n|,|→|->|;|\band\b/gi)
    .map(normalizeCity)
    .filter(Boolean);
}

export function parseDeadline(text) {
  const match = String(text || '').match(/(.+?)\s+(?:before|by|no later than)\s+(.+)/i);
  if (!match) return null;

  const city = normalizeCity(match[1]);
  const rawDate = match[2].trim();
  const year = new Date().getFullYear();
  const date = new Date(`${rawDate} ${year}`);
  if (!city || Number.isNaN(date.getTime())) return null;
  return {
    city,
    before: date.toISOString().slice(0, 10)
  };
}

export function optimizeTrip(input) {
  const origin = normalizeCity(input.origin);
  const stops = Array.isArray(input.stops) ? input.stops.map(normalizeCity).filter(Boolean) : parseStops(input.stopsText);
  const deadline = input.deadline?.city ? input.deadline : parseDeadline(input.requirementsText);
  const requirements = normalizeRequirements(input.requirements, deadline);
  const startDate = parseDate(input.startDate) || new Date();
  const lockOrder = input.lockOrder === true;

  if (!origin) {
    throw new Error('Choose a starting city.');
  }
  if (stops.length === 0) {
    throw new Error('Add at least one stop.');
  }

  const orderedStops = lockOrder ? stops : findBestStopOrder(origin, stops, requirements, startDate);
  const itinerary = buildItinerary(origin, orderedStops, startDate);
  const warnings = validateRequirements(itinerary, requirements);
  const score = Math.max(0, Math.round(100 - itinerary.totalHours * 1.15 - warnings.length * 18));

  return {
    origin,
    stops: orderedStops,
    returnsTo: origin,
    score,
    totalHours: round1(itinerary.totalHours),
    totalDistanceKm: Math.round(itinerary.totalDistanceKm),
    legs: itinerary.legs,
    warnings,
    requirements
  };
}

function findBestStopOrder(origin, stops, requirements, startDate) {
  if (stops.length > 8) return nearestNeighbor(origin, stops);

  let best = null;
  for (const candidate of uniquePermutations(stops)) {
    const itinerary = buildItinerary(origin, candidate, startDate);
    const deadlinePenalty = validateRequirements(itinerary, requirements).length * 1000;
    const score = itinerary.totalHours + deadlinePenalty;
    if (!best || score < best.score) {
      best = { score, candidate };
    }
  }
  return best.candidate;
}

function nearestNeighbor(origin, stops) {
  const remaining = [...stops];
  const route = [];
  let current = origin;
  while (remaining.length) {
    let bestIndex = 0;
    let bestLeg = routeEstimate(current, remaining[0]);
    for (let index = 1; index < remaining.length; index += 1) {
      const leg = routeEstimate(current, remaining[index]);
      if (leg.hours < bestLeg.hours) {
        bestIndex = index;
        bestLeg = leg;
      }
    }
    current = remaining.splice(bestIndex, 1)[0];
    route.push(current);
  }
  return route;
}

function buildItinerary(origin, stops, startDate) {
  const route = [origin, ...stops, origin];
  const legs = [];
  let cursor = new Date(startDate);
  let totalHours = 0;
  let totalDistanceKm = 0;

  for (let index = 0; index < route.length - 1; index += 1) {
    const from = route[index];
    const to = route[index + 1];
    const estimate = routeEstimate(from, to);
    const departOn = cursor.toISOString().slice(0, 10);
    cursor = addHours(cursor, estimate.hours);
    totalHours += estimate.hours;
    totalDistanceKm += estimate.distanceKm;
    legs.push({
      from,
      to,
      departOn,
      arriveBy: cursor.toISOString().slice(0, 10),
      hours: round1(estimate.hours),
      distanceKm: Math.round(estimate.distanceKm),
      reliability: estimate.reliability,
      note: estimate.note
    });
    cursor = addHours(cursor, 18);
  }

  return { legs, totalHours, totalDistanceKm };
}

function routeEstimate(from, to) {
  const direct = DIRECT_ROUTE_HINTS.get(`${from}|${to}`);
  const distanceKm = haversineKm(CITY_COORDS[from], CITY_COORDS[to]);
  if (direct) {
    return { ...direct, distanceKm };
  }
  const connectionPenalty = distanceKm > 3500 ? 3.2 : 1.6;
  return {
    hours: round1(distanceKm / 760 + connectionPenalty),
    distanceKm,
    reliability: distanceKm > 3500 ? 0.55 : 0.66,
    note: 'Heuristic estimate until live provider data is connected.'
  };
}

function validateDeadline(itinerary, deadline) {
  if (!deadline?.city || !deadline?.before) return [];
  const deadlineDate = new Date(`${deadline.before}T00:00:00.000Z`);
  const firstArrival = itinerary.legs.find((leg) => leg.to === normalizeCity(deadline.city));
  if (!firstArrival) return [`${deadline.city} is required before ${deadline.before}, but it is not in the route.`];
  const arrivalDate = new Date(`${firstArrival.arriveBy}T00:00:00.000Z`);
  return arrivalDate < deadlineDate
    ? []
    : [`${deadline.city} arrives on ${firstArrival.arriveBy}, missing the ${deadline.before} deadline.`];
}

function normalizeRequirements(requirements, legacyDeadline) {
  const normalized = Array.isArray(requirements)
    ? requirements
        .map((requirement) => ({
          city: normalizeCity(requirement.city),
          type: requirement.type === 'after' ? 'after' : 'before',
          date: parseDate(requirement.date)?.toISOString().slice(0, 10)
        }))
        .filter((requirement) => requirement.city && requirement.date)
    : [];

  if (normalized.length > 0) return normalized;
  if (legacyDeadline?.city && legacyDeadline?.before) {
    return [{ city: normalizeCity(legacyDeadline.city), type: 'before', date: legacyDeadline.before }];
  }
  return [];
}

function validateRequirements(itinerary, requirements) {
  return requirements.flatMap((requirement) => {
    const firstArrival = itinerary.legs.find((leg) => leg.to === requirement.city);
    if (!firstArrival) {
      return [`${requirement.city} has a ${requirement.type} ${requirement.date} rule, but it is not in the route.`];
    }

    const arrivalDate = new Date(`${firstArrival.arriveBy}T00:00:00.000Z`);
    const ruleDate = new Date(`${requirement.date}T00:00:00.000Z`);
    if (requirement.type === 'after') {
      return arrivalDate > ruleDate
        ? []
        : [`${requirement.city} arrives on ${firstArrival.arriveBy}, before the after-${requirement.date} rule.`];
    }
    return arrivalDate < ruleDate
      ? []
      : [`${requirement.city} arrives on ${firstArrival.arriveBy}, missing the before-${requirement.date} rule.`];
  });
}

function uniquePermutations(items) {
  const counts = new Map();
  for (const item of items) counts.set(item, (counts.get(item) || 0) + 1);
  const values = [...counts.keys()];
  const output = [];

  function visit(path) {
    if (path.length === items.length) {
      output.push([...path]);
      return;
    }
    for (const value of values) {
      const count = counts.get(value);
      if (!count) continue;
      counts.set(value, count - 1);
      path.push(value);
      visit(path);
      path.pop();
      counts.set(value, count);
    }
  }

  visit([]);
  return output;
}

function parseDate(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? null : date;
}

function haversineKm(a, b) {
  if (!a || !b) return 2500;
  const radiusKm = 6371;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusKm * Math.asin(Math.sqrt(x));
}

function toRad(degrees) {
  return (degrees * Math.PI) / 180;
}

function toTitleCase(value) {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function round1(value) {
  return Math.round(value * 10) / 10;
}
