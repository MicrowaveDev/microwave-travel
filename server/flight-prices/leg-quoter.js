// Price a single leg. quoteLeg picks the provider cascade (serpapi →
// aviasales for non-Russian routes; aviasales → yandex-rasp → serpapi
// for Russian routes), checks the SQLite cache, calls the upstream,
// emits progress events, and disables a provider for the rest of the
// search if it rate-limits. Returns { leg, attempts }. The route-search
// brain in flight-prices.js drives this for every candidate leg.

import {
  getCachedFlightPrice,
  getCachedFlightPrices,
  setCachedFlightPrice,
  setDisabledProviderReason
} from '../flight-price-cache.js';
import { isRussianDirection } from '../iata-codes.js';
import { withNormalizedBaggage } from './baggage-from-offer.js';
import { cloneQuote } from './cache-keys.js';
import {
  emitProgress,
  providerProgressMessage,
  providerProgressStep,
  routeLabel,
  shouldEmitDetailedProgress
} from './progress.js';
import { providerLabel } from './provider-labels.js';
import {
  createProviderState,
  disableProvider,
  incrementProviderNetworkRequest,
  markProviderSkipLogged,
  providerDisabledReason,
  providerNetworkRequestCount,
  shouldDisableProvider
} from './provider-state.js';
import {
  quoteLegWithDuffel,
  quoteLegWithSerpApi,
  quoteLegWithTravelpayouts,
  quoteLegWithYandexRasp,
  tryProvider
} from './providers.js';

const LEG_QUOTE_CACHE_TTL_MS = 60 * 60 * 1000;
const PROVIDER_DISABLE_CACHE_TTL_MS = Number(process.env.PROVIDER_DISABLE_CACHE_TTL_MS || 30 * 60 * 1000);

export async function quoteLeg(leg, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const providerState = options.providerState || createProviderState();
  const emitProviderDetail = shouldEmitDetailedProgress(options.progressDetail);
  const providers = isRussianDirection(leg)
    ? [
        ['aviasales', () => quoteLegWithTravelpayouts(leg)],
        ['yandex-rasp', () => quoteLegWithYandexRasp(leg)],
        ['serpapi', () => quoteLegWithSerpApi(leg)]
      ]
    : [
        ['serpapi', () => quoteLegWithSerpApi(leg)],
        ['duffel', () => quoteLegWithDuffel(leg)],
        ['aviasales', () => quoteLegWithTravelpayouts(leg)]
  ];
  const attempts = [];
  let bestNoPriceResult = null;
  const providerCache = getCachedFlightPrices(providers.map(([provider]) => legQuoteCacheKey(provider, leg)));

  for (const [provider, fn] of providers) {
    const disabledReason = providerDisabledReason(providerState, provider);
    if (!disabledReason && emitProviderDetail) {
      emitProgress(onProgress, 'provider-start', `Checking ${providerLabel(provider)} for ${routeLabel(leg)} on ${leg.departureDate}.`, {
        provider,
        route: routeLabel(leg),
        date: leg.departureDate,
        phase: options.phase,
        candidateRoute: options.candidateRoute || null,
        russianDirection: isRussianDirection(leg)
      });
    }
    const result = await tryCachedProvider(provider, leg, fn, {
      onProgress,
      skipNetworkReason: disabledReason,
      progressDetail: options.progressDetail,
      cachedQuote: providerCache.get(legQuoteCacheKey(provider, leg)) || null,
      networkGuard: () => providerNetworkGuard(providerState, provider)
    });
    attempts.push({
      ...result.summary,
      route: `${leg.origin}-${leg.destination}`,
      russianDirection: isRussianDirection(leg)
    });
    if (emitProviderDetail && (!result.summary.skipped || markProviderSkipLogged(providerState, provider))) {
      emitProgress(onProgress, providerProgressStep(result), providerProgressMessage(provider, leg, result), {
        provider,
        route: routeLabel(leg),
        date: leg.departureDate,
        amount: result.quote?.amount || null,
        cached: result.summary.cached === true,
        skipped: result.summary.skipped === true,
        error: result.summary.error || result.quote?.error || null,
        phase: options.phase,
        candidateRoute: options.candidateRoute || null
      });
    }
    if (!result.summary.ok && shouldDisableProvider(provider, result.summary.error) && disableProvider(providerState, provider, result.summary.error)) {
      setDisabledProviderReason(provider, result.summary.error, Date.now() + PROVIDER_DISABLE_CACHE_TTL_MS);
      emitProgress(onProgress, 'provider-disabled', `${providerLabel(provider)} will be skipped for the rest of this search: ${result.summary.error}.`, {
        provider,
        reason: result.summary.error
      });
    }
    if (result.quote) {
      if (Number.isFinite(result.quote.amount) || result.quote.schedule) {
        return { leg: result.quote, attempts };
      }
      bestNoPriceResult = result.quote;
    }
  }

  return {
    leg: bestNoPriceResult || { ...leg, amount: null, currency: 'USD', provider: null, error: 'No provider returned a price for this leg.' },
    attempts
  };
}

async function tryCachedProvider(provider, leg, fn, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const cacheKey = legQuoteCacheKey(provider, leg);
  const cachedQuote = options.cachedQuote || getCachedFlightPrice(cacheKey);
  if (cachedQuote) {
    if (shouldEmitDetailedProgress(options.progressDetail)) {
      emitProgress(onProgress, 'cache-hit', `Using SQLite cached ${providerLabel(provider)} result for ${routeLabel(leg)} on ${leg.departureDate}.`, {
        provider,
        route: routeLabel(leg),
        date: leg.departureDate
      });
    }
    return {
      quote: withNormalizedBaggage(cloneQuote(cachedQuote)),
      summary: Number.isFinite(cachedQuote.amount) || cachedQuote.schedule
        ? { provider, ok: true, cached: true }
        : {
            provider,
            ok: false,
            cached: true,
            noPrice: true,
            error: cachedQuote.error || 'Cached provider result has no comparable USD price.'
          }
    };
  }

  if (options.skipNetworkReason) {
    return {
      quote: null,
      summary: { provider, ok: false, skipped: true, error: options.skipNetworkReason }
    };
  }

  const networkGuardReason = typeof options.networkGuard === 'function' ? options.networkGuard() : null;
  if (networkGuardReason) {
    return {
      quote: null,
      summary: { provider, ok: false, skipped: true, error: networkGuardReason }
    };
  }

  const result = await tryProvider(provider, fn);
  if (result.quote) {
    result.quote = withNormalizedBaggage(result.quote);
    setCachedFlightPrice(cacheKey, provider, leg, cloneQuote(result.quote), Date.now() + LEG_QUOTE_CACHE_TTL_MS);
  }
  return result;
}

function providerNetworkGuard(providerState, provider) {
  if (provider !== 'duffel') return null;
  const limit = duffelMaxRequestsPerSearch();
  if (!Number.isFinite(limit) || limit <= 0) return null;
  if (providerNetworkRequestCount(providerState, provider) >= limit) {
    return `Duffel per-search request cap reached (${limit}).`;
  }
  incrementProviderNetworkRequest(providerState, provider);
  return null;
}

function duffelMaxRequestsPerSearch() {
  return Number(process.env.DUFFEL_MAX_REQUESTS_PER_SEARCH || 10);
}

function legQuoteCacheKey(provider, leg) {
  // Bump the trailing version tag whenever the priced-leg shape changes.
  // v2: added departureAt/arrivalAt. v3: added stopCount/hubCode.
  // v4: added flightSegments. v5: added hubLabel/hubInferred.
  return [provider, leg.origin, leg.destination, leg.departureDate, leg.passengers || 1, 'USD', 'v5'].join('|');
}
