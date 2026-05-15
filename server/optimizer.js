const CITY_ALIASES = new Map([
  ['porto', 'Porto'],
  ['opo', 'Porto'],
  ['doha', 'Doha'],
  ['doh', 'Doha'],
  ['dubai', 'Dubai'],
  ['dxb', 'Dubai'],
  ['gdansk', 'Gdansk'],
  ['gdn', 'Gdansk'],
  ['lisbon', 'Lisbon'],
  ['lisboa', 'Lisbon'],
  ['lis', 'Lisbon'],
  ['istanbul', 'Istanbul'],
  ['ist', 'Istanbul'],
  ['belgrade', 'Belgrade'],
  ['beg', 'Belgrade'],
  ['warsaw', 'Warsaw'],
  ['waw', 'Warsaw'],
  ['madrid', 'Madrid'],
  ['mad', 'Madrid'],
  ['barcelona', 'Barcelona'],
  ['bcn', 'Barcelona'],
  ['milan', 'Milan'],
  ['mil', 'Milan'],
  ['rome', 'Rome'],
  ['rom', 'Rome'],
  ['paris', 'Paris'],
  ['par', 'Paris'],
  ['frankfurt', 'Frankfurt'],
  ['fra', 'Frankfurt'],
  ['athens', 'Athens'],
  ['ath', 'Athens'],
  ['vienna', 'Vienna'],
  ['vie', 'Vienna'],
  ['zurich', 'Zurich'],
  ['zrh', 'Zurich'],
  ['amsterdam', 'Amsterdam'],
  ['ams', 'Amsterdam'],
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
  Gdansk: [54.377, 18.466],
  Lisbon: [38.775, -9.135],
  Istanbul: [41.275, 28.751],
  Belgrade: [44.819, 20.309],
  Warsaw: [52.167, 20.967],
  Madrid: [40.472, -3.561],
  Barcelona: [41.297, 2.083],
  Milan: [45.63, 8.723],
  Rome: [41.8, 12.238],
  Paris: [49.009, 2.548],
  Frankfurt: [50.037, 8.562],
  Athens: [37.936, 23.948],
  Vienna: [48.11, 16.57],
  Zurich: [47.458, 8.555],
  Amsterdam: [52.31, 4.768],
  Kaliningrad: [54.89, 20.592],
  Moscow: [55.756, 37.617]
};

const DIRECT_ROUTE_HINTS = new Map([
  ['Porto|Doha', { hours: 8.4, reliability: 0.74, note: 'Usually one stop from Porto.' }],
  ['Doha|Dubai', { hours: 1.3, reliability: 0.96, note: 'Dense Gulf corridor.' }],
  ['Dubai|Doha', { hours: 1.3, reliability: 0.96, note: 'Dense Gulf corridor.' }],
  ['Dubai|Kaliningrad', { hours: 8.8, reliability: 0.45, note: 'Likely multiple connections.' }],
  ['Dubai|Gdansk', { hours: 7.1, reliability: 0.62, note: 'Flight to Gdansk for Kaliningrad ground transfer.' }],
  ['Gdansk|Kaliningrad', { hours: 4.5, reliability: 0.58, mode: 'bus', note: 'Bus/ground transfer from Gdansk to Kaliningrad; verify border rules before booking.' }],
  ['Kaliningrad|Gdansk', { hours: 4.5, reliability: 0.58, mode: 'bus', note: 'Bus/ground transfer from Kaliningrad to Gdansk; verify border rules before booking.' }],
  ['Gdansk|Moscow', { hours: 6.8, reliability: 0.5, note: 'Flight from Gdansk after Kaliningrad ground transfer.' }],
  ['Kaliningrad|Moscow', { hours: 2.0, reliability: 0.68, note: 'Check current border and airspace constraints.' }],
  ['Moscow|Dubai', { hours: 5.6, reliability: 0.72, note: 'Common long-haul leg.' }],
  ['Dubai|Lisbon', { hours: 8.2, reliability: 0.78, note: 'Common Europe return hub toward Porto.' }],
  ['Lisbon|Porto', { hours: 1.0, reliability: 0.9, note: 'Short domestic hop; train may also be cheaper.' }],
  ['Dubai|Istanbul', { hours: 4.8, reliability: 0.88, note: 'Major hub for Europe connections.' }],
  ['Istanbul|Porto', { hours: 5.0, reliability: 0.72, note: 'Europe connection toward Porto.' }],
  ['Dubai|Belgrade', { hours: 5.9, reliability: 0.68, note: 'Regional Europe connection option.' }],
  ['Belgrade|Porto', { hours: 4.2, reliability: 0.58, note: 'Likely connection or seasonal availability.' }],
  ['Dubai|Warsaw', { hours: 6.4, reliability: 0.72, note: 'Central Europe connection option.' }],
  ['Warsaw|Porto', { hours: 4.1, reliability: 0.7, note: 'Europe connection toward Porto.' }],
  ['Dubai|Madrid', { hours: 7.7, reliability: 0.78, note: 'Popular Europe connection option.' }],
  ['Madrid|Porto', { hours: 1.3, reliability: 0.88, note: 'Short Iberia connection toward Porto.' }],
  ['Dubai|Barcelona', { hours: 7.4, reliability: 0.78, note: 'Popular Europe connection option.' }],
  ['Barcelona|Porto', { hours: 1.8, reliability: 0.82, note: 'Iberia connection toward Porto.' }],
  ['Dubai|Milan', { hours: 6.7, reliability: 0.76, note: 'Popular Europe connection option.' }],
  ['Milan|Porto', { hours: 2.7, reliability: 0.72, note: 'Europe connection toward Porto.' }],
  ['Dubai|Rome', { hours: 6.3, reliability: 0.76, note: 'Popular Europe connection option.' }],
  ['Rome|Porto', { hours: 3.0, reliability: 0.7, note: 'Europe connection toward Porto.' }],
  ['Dubai|Paris', { hours: 7.2, reliability: 0.82, note: 'Major Europe connection option.' }],
  ['Paris|Porto', { hours: 2.2, reliability: 0.84, note: 'Europe connection toward Porto.' }],
  ['Dubai|Frankfurt', { hours: 6.9, reliability: 0.84, note: 'Major Europe connection option.' }],
  ['Frankfurt|Porto', { hours: 2.8, reliability: 0.82, note: 'Europe connection toward Porto.' }],
  ['Dubai|Athens', { hours: 5.2, reliability: 0.72, note: 'Regional Europe connection option.' }],
  ['Athens|Porto', { hours: 4.0, reliability: 0.62, note: 'Europe connection toward Porto.' }],
  ['Dubai|Vienna', { hours: 6.2, reliability: 0.78, note: 'Central Europe connection option.' }],
  ['Vienna|Porto', { hours: 3.4, reliability: 0.74, note: 'Europe connection toward Porto.' }],
  ['Dubai|Zurich', { hours: 6.8, reliability: 0.82, note: 'Major Europe connection option.' }],
  ['Zurich|Porto', { hours: 2.6, reliability: 0.82, note: 'Europe connection toward Porto.' }],
  ['Dubai|Amsterdam', { hours: 7.2, reliability: 0.82, note: 'Major Europe connection option.' }],
  ['Amsterdam|Porto', { hours: 2.8, reliability: 0.82, note: 'Europe connection toward Porto.' }],
  ['Doha|Porto', { hours: 8.4, reliability: 0.74, note: 'Usually one stop back to Porto.' }]
]);

const RETURN_HUBS = ['Lisbon', 'Istanbul', 'Warsaw', 'Belgrade'];

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
  const stopEntries = normalizeStopEntries(input);
  const stops = stopEntries.map((stop) => stop.city);
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

  const orderedStopEntries = lockOrder ? stopEntries : findBestStopOrder(origin, stopEntries, requirements, startDate);
  const orderedStops = orderedStopEntries.map((stop) => stop.city);
  const itinerary = buildItinerary(origin, orderedStopEntries, startDate);
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
    requirements,
    stopDetails: orderedStopEntries.map((stop) => ({
      city: stop.city,
      stayDays: stop.stayDays
    }))
  };
}

function normalizeStopEntries(input) {
  if (Array.isArray(input.stopDetails)) {
    return input.stopDetails
      .map((stop) => ({
        city: normalizeCity(stop.city),
        stayDays: normalizeStayDays(stop.stayDays ?? stop.daysToSpend)
      }))
      .filter((stop) => stop.city);
  }

  const stops = Array.isArray(input.stops) ? input.stops.map(normalizeCity).filter(Boolean) : parseStops(input.stopsText);
  return stops.map((city) => ({
    city,
    stayDays: 0
  }));
}

function normalizeStayDays(value) {
  const days = Number(value);
  if (!Number.isFinite(days) || days < 0) return 0;
  return Math.round(days * 10) / 10;
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
    let bestLeg = routeEstimate(current, remaining[0].city);
    for (let index = 1; index < remaining.length; index += 1) {
      const leg = routeEstimate(current, remaining[index].city);
      if (leg.hours < bestLeg.hours) {
        bestIndex = index;
        bestLeg = leg;
      }
    }
    const next = remaining.splice(bestIndex, 1)[0];
    current = next.city;
    route.push(next);
  }
  return route;
}

function buildStayQueue(stops) {
  const queue = new Map();
  for (const stop of stops) {
    const hours = round1(stop.stayDays * 24);
    if (!hours) continue;
    queue.set(stop.city, [...(queue.get(stop.city) || []), hours]);
  }
  return queue;
}

function takeStayHours(stayQueue, city) {
  const queue = stayQueue.get(city);
  if (!queue?.length) return 0;
  const hours = queue.shift();
  if (queue.length === 0) stayQueue.delete(city);
  return hours;
}

function buildItinerary(origin, stops, startDate) {
  const route = collapseConsecutiveDuplicates(expandRouteForTransfers(expandReturnHubs([origin, ...stops.map((stop) => stop.city), origin])));
  return buildItineraryFromRoute(route, startDate, buildStayQueue(stops));
}

export function buildLegsForRoute(route, startDate) {
  return buildItineraryFromRoute(route, startDate).legs;
}

function buildItineraryFromRoute(route, startDate, stayQueue = new Map()) {
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
    const stayHoursAfter = takeStayHours(stayQueue, to);
    legs.push({
      from,
      to,
      departOn,
      arriveBy: cursor.toISOString().slice(0, 10),
      hours: round1(estimate.hours),
      distanceKm: Math.round(estimate.distanceKm),
      mode: estimate.mode,
      reliability: estimate.reliability,
      note: estimate.note,
      stayHoursAfter,
      stayDaysAfter: round1(stayHoursAfter / 24)
    });
    cursor = addHours(cursor, stayHoursAfter);
  }

  return { legs, totalHours, totalDistanceKm };
}

function expandReturnHubs(route) {
  const expanded = [];
  for (let index = 0; index < route.length - 1; index += 1) {
    const from = route[index];
    const to = route[index + 1];
    expanded.push(from);
    if (from !== to && to === route[0] && shouldUseReturnHub(from, to)) {
      expanded.push(selectReturnHub(from, to));
    }
  }
  expanded.push(route[route.length - 1]);
  return expanded;
}

function shouldUseReturnHub(from, to) {
  if (from === 'Kaliningrad') return false;
  const direct = routeEstimate(from, to);
  const viaHub = selectReturnHub(from, to);
  const hubEstimate = routeEstimate(from, viaHub).hours + routeEstimate(viaHub, to).hours;
  return hubEstimate + 1 < direct.hours || from === 'Dubai';
}

function selectReturnHub(from, to) {
  let bestHub = RETURN_HUBS[0];
  let bestHours = Number.POSITIVE_INFINITY;
  for (const hub of RETURN_HUBS) {
    if (hub === from || hub === to) continue;
    const hours = routeEstimate(from, hub).hours + routeEstimate(hub, to).hours;
    if (hours < bestHours) {
      bestHours = hours;
      bestHub = hub;
    }
  }
  return bestHub;
}

function collapseConsecutiveDuplicates(route) {
  return route.filter((city, index) => index === 0 || city !== route[index - 1]);
}

function expandRouteForTransfers(route) {
  const expanded = [route[0]];
  for (let index = 1; index < route.length; index += 1) {
    const previous = expanded[expanded.length - 1];
    const current = route[index];

    if (current === 'Kaliningrad' && previous !== 'Gdansk' && !isRussianMainland(previous)) {
      expanded.push('Gdansk');
    }
    if (previous === 'Kaliningrad' && current !== 'Gdansk' && !isRussianMainland(current)) {
      expanded.push('Gdansk');
    }
    expanded.push(current);
  }
  return expanded;
}

function isRussianMainland(city) {
  return city === 'Moscow';
}

function routeEstimate(from, to) {
  const direct = DIRECT_ROUTE_HINTS.get(`${from}|${to}`);
  const distanceKm = haversineKm(CITY_COORDS[from], CITY_COORDS[to]);
  if (direct) {
    return { mode: 'flight', ...direct, distanceKm };
  }
  const reverse = DIRECT_ROUTE_HINTS.get(`${to}|${from}`);
  if (reverse) {
    return { mode: 'flight', ...reverse, distanceKm, note: reverse.note.replace('toward Porto', 'toward Dubai') };
  }
  const connectionPenalty = distanceKm > 3500 ? 3.2 : 1.6;
  return {
    hours: round1(distanceKm / 760 + connectionPenalty),
    distanceKm,
    reliability: distanceKm > 3500 ? 0.55 : 0.66,
    mode: 'flight',
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
          type: normalizeRequirementType(requirement.type),
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
    const firstDeparture = itinerary.legs.find((leg) => leg.from === requirement.city);
    if (!firstArrival) {
      return [`${requirement.city} has a ${requirement.type} ${requirement.date} rule, but it is not in the route.`];
    }

    const ruleDate = new Date(`${requirement.date}T00:00:00.000Z`);
    if (requirement.type === 'departBefore') {
      if (!firstDeparture) {
        return [`${requirement.city} has a leave-before ${requirement.date} rule, but there is no departure from that city.`];
      }
      const departDate = new Date(`${firstDeparture.departOn}T00:00:00.000Z`);
      return departDate < ruleDate
        ? []
        : [`${requirement.city} departs on ${firstDeparture.departOn}, missing the leave-before-${requirement.date} rule.`];
    }

    const arrivalDate = new Date(`${firstArrival.arriveBy}T00:00:00.000Z`);
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

function normalizeRequirementType(type) {
  if (type === 'after') return 'after';
  if (type === 'departBefore') return 'departBefore';
  return 'before';
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
