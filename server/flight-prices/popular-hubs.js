// Static registry of European hubs the optimizer tries as transfer
// points for Porto↔Dubai search. To add a new hub: append to
// PORTO_DUBAI_TRANSFER_HUBS and register the IATA code in
// server/iata-codes.js. PORTO_RETURN_FALLBACK_HUBS is the shorter list
// used by recoverMissingPortoReturnLeg when the direct return leg has
// no price.

export const PORTO_DUBAI_TRANSFER_HUBS = [
  'Doha',
  'Istanbul',
  'Lisbon',
  'Madrid',
  'Barcelona',
  'Milan',
  'Rome',
  'Paris',
  'Frankfurt',
  'Warsaw',
  'Belgrade',
  'Athens',
  'Vienna',
  'Zurich',
  'Amsterdam'
];

export const PORTO_RETURN_FALLBACK_HUBS = ['Warsaw', 'Madrid', 'Lisbon', 'Barcelona', 'Paris', 'Amsterdam', 'Milan'];

export function findPopularRouteTarget(legs) {
  const candidates = [
    ...findPopularRouteTargetsForDirection(legs, { from: 'Porto', to: 'Dubai' }),
    ...findPopularRouteTargetsForDirection(legs, { from: 'Dubai', to: 'Porto' })
  ];
  candidates.sort((a, b) => a.startIndex - b.startIndex || a.endIndex - b.endIndex);
  return candidates[0] || null;
}

export function popularTransferRoutes(direction) {
  return [
    [direction.from, direction.to],
    ...PORTO_DUBAI_TRANSFER_HUBS.map((hub) => [direction.from, hub, direction.to])
  ];
}

function findPopularRouteTargetsForDirection(legs, direction) {
  const candidates = [];
  for (let startIndex = 0; startIndex < legs.length; startIndex += 1) {
    if (legs[startIndex].from !== direction.from) continue;
    for (let endIndex = startIndex; endIndex < legs.length; endIndex += 1) {
      if (legs[endIndex].to !== direction.to) continue;
      const segment = legs.slice(startIndex, endIndex + 1);
      if (isReplaceablePopularRoute(segment, direction)) {
        candidates.push({ startIndex, endIndex: endIndex + 1, direction });
        break;
      }
    }
  }
  return candidates;
}

export function isReplaceablePopularRoute(legs, direction) {
  const cities = new Set(legs.flatMap((leg) => [leg.from, leg.to]));
  for (const city of cities) {
    if (![direction.from, direction.to, ...PORTO_DUBAI_TRANSFER_HUBS].includes(city)) {
      return false;
    }
  }
  return true;
}
