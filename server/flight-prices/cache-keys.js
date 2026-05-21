import { createHash } from 'node:crypto';

export function stableCacheKey(prefix, value) {
  return `${prefix}|${createHash('sha256').update(JSON.stringify(sortForStableJson(value))).digest('hex')}`;
}

export function sortForStableJson(value) {
  if (Array.isArray(value)) return value.map(sortForStableJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value)
    .sort()
    .map((key) => [key, sortForStableJson(value[key])]));
}

export function cacheableLeg(leg) {
  return {
    from: leg.from,
    to: leg.to,
    origin: leg.origin,
    destination: leg.destination,
    mode: leg.mode,
    departureDate: leg.departureDate || leg.departOn,
    arriveBy: leg.arriveBy,
    durationHours: leg.durationHours,
    distanceKm: leg.distanceKm,
    passengers: leg.passengers || 1,
    stayHoursAfter: leg.stayHoursAfter || 0,
    stayDaysAfter: leg.stayDaysAfter || 0
  };
}

export function cloneQuote(quote) {
  return quote ? JSON.parse(JSON.stringify(quote)) : null;
}

export function markQuoteFromCache(quote, cacheType) {
  const cachedQuote = cloneQuote(quote);
  cachedQuote.cached = true;
  cachedQuote.cacheType = cacheType;
  if (Array.isArray(cachedQuote.attempts)) {
    cachedQuote.attempts = cachedQuote.attempts.map((attempt) => ({ ...attempt, cached: true }));
  }
  return cachedQuote;
}

export function markQuoteBundleFromCache(bundle) {
  const cachedBundle = cloneQuote(bundle) || { legs: [], attempts: [] };
  cachedBundle.attempts = (cachedBundle.attempts || []).map((attempt) => ({ ...attempt, cached: true, bundleCached: true }));
  return cachedBundle;
}
