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
  markProviderSkipLogged,
  providerDisabledReason,
  shouldDisableProvider
} from './provider-state.js';
import {
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
      cachedQuote: providerCache.get(legQuoteCacheKey(provider, leg)) || null
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
      summary: { provider, ok: true, cached: true }
    };
  }

  if (options.skipNetworkReason) {
    return {
      quote: null,
      summary: { provider, ok: false, skipped: true, error: options.skipNetworkReason }
    };
  }

  const result = await tryProvider(provider, fn);
  if (result.quote) {
    result.quote = withNormalizedBaggage(result.quote);
    setCachedFlightPrice(cacheKey, provider, leg, cloneQuote(result.quote), Date.now() + LEG_QUOTE_CACHE_TTL_MS);
  }
  return result;
}

function legQuoteCacheKey(provider, leg) {
  return [provider, leg.origin, leg.destination, leg.departureDate, leg.passengers || 1, 'USD'].join('|');
}
