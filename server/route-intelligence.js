import { buildLegsForRoute } from './optimizer.js';

const ROUTE_INTELLIGENCE_LIMIT = Number(process.env.PRICE_ROUTE_INTELLIGENCE_LIMIT || 12);
const DEFAULT_USD_PER_KM = 0.095;
const DEFAULT_LEG_BASE_USD = 35;

const LEG_PRICE_HINTS = new Map([
  ['Porto|Madrid', { typicalUsd: 23, ratio: 0.35, airlines: ['FR', 'IB'] }],
  ['Madrid|Dubai', { typicalUsd: 254, ratio: 0.7, airlines: ['PC', 'EK'] }],
  ['Porto|Athens', { typicalUsd: 110, ratio: 0.45, airlines: ['A3'] }],
  ['Athens|Dubai', { typicalUsd: 237, ratio: 0.72, airlines: ['A3', 'FZ'] }],
  ['Porto|Barcelona', { typicalUsd: 30, ratio: 0.35, airlines: ['VY', 'FR'] }],
  ['Barcelona|Dubai', { typicalUsd: 320, ratio: 0.78, airlines: ['PC', 'EK'] }],
  ['Porto|Rome', { typicalUsd: 40, ratio: 0.36, airlines: ['W6', 'FR'] }],
  ['Rome|Dubai', { typicalUsd: 338, ratio: 0.78, airlines: ['PC', 'EK'] }],
  ['Porto|Milan', { typicalUsd: 47, ratio: 0.38, airlines: ['FR', 'W6'] }],
  ['Milan|Dubai', { typicalUsd: 332, ratio: 0.78, airlines: ['PC', 'EK'] }],
  ['Porto|Vienna', { typicalUsd: 115, ratio: 0.5, airlines: ['W6', 'FR'] }],
  ['Vienna|Dubai', { typicalUsd: 259, ratio: 0.74, airlines: ['W6', 'PC'] }],
  ['Porto|Dubai', { typicalUsd: 402, ratio: 0.72, airlines: ['TP', 'PC'] }],
  ['Porto|Warsaw', { typicalUsd: 108, ratio: 0.52, airlines: ['W6'] }],
  ['Warsaw|Dubai', { typicalUsd: 299, ratio: 0.75, airlines: ['FZ', 'W6'] }],
  ['Porto|Istanbul', { typicalUsd: 144, ratio: 0.55, airlines: ['TK', 'PC'] }],
  ['Istanbul|Dubai', { typicalUsd: 276, ratio: 0.78, airlines: ['PC', 'FZ'] }],
  ['Porto|Belgrade', { typicalUsd: 107, ratio: 0.55, airlines: ['JU', 'W6'] }],
  ['Belgrade|Dubai', { typicalUsd: 326, ratio: 0.82, airlines: ['FZ'] }],
  ['Porto|Zurich', { typicalUsd: 114, ratio: 0.62, airlines: ['LX', 'U2'] }],
  ['Zurich|Dubai', { typicalUsd: 388, ratio: 0.92, airlines: ['PC', 'EK'] }],
  ['Porto|Amsterdam', { typicalUsd: 99, ratio: 0.58, airlines: ['HV', 'KL'] }],
  ['Amsterdam|Dubai', { typicalUsd: 427, ratio: 0.95, airlines: ['PC', 'EK'] }],
  ['Porto|Lisbon', { typicalUsd: 116, ratio: 0.85, airlines: ['TP'] }],
  ['Lisbon|Dubai', { typicalUsd: 415, ratio: 0.9, airlines: ['EK', 'TP'] }],
  ['Porto|Paris', { typicalUsd: 85, ratio: 0.5, airlines: ['TO', 'VY'] }],
  ['Paris|Dubai', { typicalUsd: 456, ratio: 1.0, airlines: ['PC', 'EK'] }],
  ['Porto|Doha', { typicalUsd: 454, ratio: 0.92, airlines: ['QR'] }],
  ['Doha|Dubai', { typicalUsd: 262, ratio: 1.4, airlines: ['QR', 'FZ'] }],
  ['Porto|Frankfurt', { typicalUsd: 180, ratio: 0.7, airlines: ['LH'] }],
  ['Frankfurt|Dubai', { typicalUsd: 360, ratio: 0.86, airlines: ['PC', 'EK'] }],
  ['Gdansk|Warsaw', { typicalUsd: 40, ratio: 0.45, airlines: ['LO'] }],
  ['Warsaw|Porto', { typicalUsd: 90, ratio: 0.48, airlines: ['W6', 'LO'] }],
  ['Gdansk|Lisbon', { typicalUsd: 171, ratio: 0.62, airlines: ['W6'] }],
  ['Lisbon|Porto', { typicalUsd: 62, ratio: 0.7, airlines: ['TP'] }]
]);

export function rankTransferRoutes(routes, startDate, { limit = ROUTE_INTELLIGENCE_LIMIT } = {}) {
  const ranked = routes
    .map((route, index) => ({
      route,
      index,
      intelligence: estimateRouteCost(route, startDate)
    }))
    .sort((left, right) =>
      left.intelligence.estimatedAmount - right.intelligence.estimatedAmount ||
      left.index - right.index
    );

  const boundedLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, ranked.length) : ranked.length;
  return {
    rankedRoutes: ranked.map((entry) => entry.route),
    routes: ranked.slice(0, boundedLimit).map((entry) => entry.route),
    skippedRoutes: ranked.slice(boundedLimit).map((entry) => ({
      route: entry.route,
      estimatedAmount: Math.round(entry.intelligence.estimatedAmount),
      confidence: entry.intelligence.confidence
    }))
  };
}

export function estimateRouteCost(route, startDate) {
  const legs = buildLegsForRoute(route, startDate);
  const legEstimates = legs.map((leg) => estimateLegCost(leg));
  const knownCount = legEstimates.filter((estimate) => estimate.source === 'hint').length;
  const estimatedAmount = legEstimates.reduce((total, estimate) => total + estimate.amount, 0);
  return {
    estimatedAmount,
    confidence: knownCount / Math.max(legs.length, 1),
    legs: legEstimates
  };
}

export function estimateLegCost(leg) {
  const hint = legPriceHint(leg.from, leg.to);
  if (hint) {
    return {
      from: leg.from,
      to: leg.to,
      amount: hint.typicalUsd,
      ratio: hint.ratio,
      airlines: hint.airlines,
      source: 'hint'
    };
  }

  const amount = Math.round(DEFAULT_LEG_BASE_USD + (Number(leg.distanceKm) || 0) * DEFAULT_USD_PER_KM);
  return {
    from: leg.from,
    to: leg.to,
    amount,
    ratio: DEFAULT_USD_PER_KM,
    airlines: [],
    source: 'distance'
  };
}

function legPriceHint(from, to) {
  return LEG_PRICE_HINTS.get(`${from}|${to}`) || reverseLegPriceHint(from, to);
}

function reverseLegPriceHint(from, to) {
  const hint = LEG_PRICE_HINTS.get(`${to}|${from}`);
  return hint ? { ...hint, airlines: [...hint.airlines] } : null;
}
