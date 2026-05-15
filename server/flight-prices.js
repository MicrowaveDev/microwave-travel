import { buildLegsForRoute } from './optimizer.js';

const CITY_IATA_CODES = new Map([
  ['porto', 'OPO'],
  ['doha', 'DOH'],
  ['dubai', 'DXB'],
  ['gdansk', 'GDN'],
  ['lisbon', 'LIS'],
  ['istanbul', 'IST'],
  ['belgrade', 'BEG'],
  ['warsaw', 'WAW'],
  ['madrid', 'MAD'],
  ['barcelona', 'BCN'],
  ['milan', 'MIL'],
  ['rome', 'ROM'],
  ['paris', 'PAR'],
  ['frankfurt', 'FRA'],
  ['athens', 'ATH'],
  ['vienna', 'VIE'],
  ['zurich', 'ZRH'],
  ['amsterdam', 'AMS'],
  ['kaliningrad', 'KGD'],
  ['moscow', 'MOW'],
  ['moskow', 'MOW']
]);

const RUSSIAN_CITY_NAMES = new Set(['Kaliningrad', 'Moscow']);
const RUSSIAN_IATA_CODES = new Set(['KGD', 'MOW', 'SVO', 'DME', 'VKO']);
const PORTO_DUBAI_TRANSFER_HUBS = [
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
const POPULAR_ROUTE_SEARCH_DAYS = Number(process.env.POPULAR_ROUTE_SEARCH_DAYS || 4);
const LEG_QUOTE_CACHE_TTL_MS = 60 * 60 * 1000;
const legQuoteCache = new Map();
let amadeusTokenCache = null;

export async function quoteFlightPrices(input, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const legs = normalizeLegs(input.legs);
  if (legs.length === 0) {
    throw new Error('Optimize a route before fetching prices.');
  }

  emitProgress(onProgress, 'pricing-start', `Pricing ${legs.length} flight leg${legs.length === 1 ? '' : 's'} in USD.`, {
    legCount: legs.length
  });
  const quoted = await quoteNormalizedLegs(legs, { onProgress, phase: 'Current route' });
  const quote = normalizeQuote('mixed', quoted.legs, quoted.attempts);
  const optimized = await optimizePopularTransferRoute(input.legs, quote, { onProgress });
  const finalQuote = optimized || quote;
  emitProgress(onProgress, 'pricing-complete', finalQuote.totalAmount
    ? `Finished pricing: $${finalQuote.totalAmount.toLocaleString()} USD.`
    : 'Finished pricing with partial or missing prices.', {
    totalAmount: finalQuote.totalAmount,
    pricedLegCount: finalQuote.pricedLegCount,
    legCount: finalQuote.legCount
  });
  return finalQuote;
}

export function clearFlightPriceCache() {
  legQuoteCache.clear();
}

async function quoteNormalizedLegs(legs, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const quotedLegs = [];
  const attempts = [];

  for (const [index, leg] of legs.entries()) {
    emitProgress(onProgress, 'leg-start', `${options.phase || 'Pricing'}: ${leg.from} to ${leg.to} on ${leg.departureDate}.`, {
      phase: options.phase,
      legIndex: index + 1,
      legCount: legs.length,
      route: routeLabel(leg),
      date: leg.departureDate,
      candidateRoute: options.candidateRoute || null
    });
    const result = await quoteLeg(leg, { onProgress, phase: options.phase, candidateRoute: options.candidateRoute });
    quotedLegs.push(result.leg);
    attempts.push(...result.attempts);
  }

  return { legs: quotedLegs, attempts };
}

async function optimizePopularTransferRoute(originalLegs, initialQuote, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  if (!Array.isArray(originalLegs)) return null;

  const optimizationTarget = findPopularRouteTarget(originalLegs);
  if (!optimizationTarget) return null;

  const { startIndex, endIndex = originalLegs.length, direction } = optimizationTarget;
  const currentSuffix = originalLegs.slice(startIndex, endIndex);
  if (!isReplaceablePopularRoute(currentSuffix, direction)) return null;

  const currentSuffixQuote = quoteTotalForDisplayLegs(currentSuffix, initialQuote.legs);
  let best = null;
  const routes = popularTransferRoutes(direction);
  const dates = dateWindow(currentSuffix[0].departOn, POPULAR_ROUTE_SEARCH_DAYS);

  emitProgress(onProgress, 'compare-start', `Comparing ${routes.length} ${direction.from} to ${direction.to} route options across ${dates.length} dates.`, {
    from: direction.from,
    to: direction.to,
    routeCount: routes.length,
    dateCount: dates.length,
    currentAmount: currentSuffixQuote
  });

  for (const route of routes) {
    for (const departureDate of dates) {
      const candidateLabel = route.join(' -> ');
      emitProgress(onProgress, 'candidate-start', `Trying ${candidateLabel} on ${departureDate}.`, {
        route,
        date: departureDate
      });
      const candidateDisplayLegs = buildLegsForRoute(route, departureDate);
      const candidateNormalizedLegs = normalizeLegs(candidateDisplayLegs);
      const candidateQuoted = await quoteNormalizedLegs(candidateNormalizedLegs, {
        onProgress,
        phase: 'Compare option',
        candidateRoute: candidateLabel
      });
      const candidateQuote = normalizeQuote('mixed', candidateQuoted.legs, candidateQuoted.attempts);
      if (!Number.isFinite(candidateQuote.totalAmount)) {
        emitProgress(onProgress, 'candidate-skip', `${candidateLabel} on ${departureDate}: not enough priced legs to compare.`, {
          route,
          date: departureDate,
          pricedLegCount: candidateQuote.pricedLegCount,
          legCount: candidateQuote.legCount
        });
        continue;
      }

      if (!best || candidateQuote.totalAmount < best.quote.totalAmount) {
        best = {
          route,
          departureDate,
          displayLegs: candidateDisplayLegs,
          quote: candidateQuote
        };
        emitProgress(onProgress, 'candidate-best', `${candidateLabel} on ${departureDate} is the current best at $${candidateQuote.totalAmount.toLocaleString()} USD.`, {
          route,
          date: departureDate,
          totalAmount: candidateQuote.totalAmount
        });
      } else {
        emitProgress(onProgress, 'candidate-result', `${candidateLabel} on ${departureDate}: $${candidateQuote.totalAmount.toLocaleString()} USD.`, {
          route,
          date: departureDate,
          totalAmount: candidateQuote.totalAmount
        });
      }
    }
  }

  if (!best || (Number.isFinite(currentSuffixQuote) && best.quote.totalAmount >= currentSuffixQuote)) {
    emitProgress(onProgress, 'compare-complete', 'No cheaper transfer route beat the current route.', {
      selectedRoute: null,
      currentAmount: currentSuffixQuote,
      bestAmount: best?.quote.totalAmount || null
    });
    return null;
  }

  const prefixDisplayLegs = originalLegs.slice(0, startIndex);
  const tailDisplayLegs = originalLegs.slice(endIndex);
  const prefixQuoteLegs = initialQuote.legs.filter((quotedLeg) =>
    prefixDisplayLegs.some((displayLeg) => sameDisplayLeg(displayLeg, quotedLeg))
  );
  const tailQuoteLegs = initialQuote.legs.filter((quotedLeg) =>
    tailDisplayLegs.some((displayLeg) => sameDisplayLeg(displayLeg, quotedLeg))
  );
  const optimizedLegs = [...prefixQuoteLegs, ...best.quote.legs, ...tailQuoteLegs];
  const combinedQuote = normalizeQuote('mixed', optimizedLegs, [
    ...initialQuote.attempts,
    ...best.quote.attempts.map((attempt) => ({ ...attempt, optimizedCandidate: true }))
  ]);
  combinedQuote.optimizedRouteLegs = [...prefixDisplayLegs, ...best.displayLegs, ...tailDisplayLegs];
  combinedQuote.optimization = {
    reason: `Found a cheaper priced ${direction.from} to ${direction.to} option.`,
    replacedRoute: currentSuffix.map((leg) => leg.from).concat(currentSuffix.at(-1).to),
    selectedRoute: best.route,
    departureDate: best.departureDate,
    previousReturnAmount: currentSuffixQuote,
    selectedReturnAmount: best.quote.totalAmount
  };
  combinedQuote.message = `${combinedQuote.message} Optimized ${direction.from} to ${direction.to} via ${best.route.slice(1, -1).join(' / ') || 'direct'} on ${best.departureDate}.`;
  emitProgress(onProgress, 'compare-complete', `Selected ${best.route.join(' -> ')} on ${best.departureDate} at $${best.quote.totalAmount.toLocaleString()} USD.`, {
    selectedRoute: best.route,
    date: best.departureDate,
    previousAmount: currentSuffixQuote,
    selectedAmount: best.quote.totalAmount
  });
  return combinedQuote;
}

function findPopularRouteTarget(legs) {
  const lastCity = legs.at(-1)?.to;
  const dubaiToPortoIndex = legs.findIndex((leg) => leg.from === 'Dubai' && lastCity === 'Porto');
  if (dubaiToPortoIndex !== -1) {
    return { startIndex: dubaiToPortoIndex, direction: { from: 'Dubai', to: 'Porto' } };
  }

  const portoToDubaiIndex = legs.findIndex((leg) => leg.from === 'Porto' && routeEventuallyReaches(legs, 'Dubai'));
  if (portoToDubaiIndex !== -1) {
    const targetIndex = legs.findIndex((leg, index) => index >= portoToDubaiIndex && leg.to === 'Dubai');
    return { startIndex: portoToDubaiIndex, direction: { from: 'Porto', to: 'Dubai' }, endIndex: targetIndex + 1 };
  }

  return null;
}

function routeEventuallyReaches(legs, city) {
  return legs.some((leg) => leg.to === city);
}

function isReplaceablePopularRoute(legs, direction) {
  const cities = new Set(legs.flatMap((leg) => [leg.from, leg.to]));
  for (const city of cities) {
    if (![direction.from, direction.to, ...PORTO_DUBAI_TRANSFER_HUBS].includes(city)) {
      return false;
    }
  }
  return true;
}

function popularTransferRoutes(direction) {
  return [
    [direction.from, direction.to],
    ...PORTO_DUBAI_TRANSFER_HUBS.map((hub) => [direction.from, hub, direction.to])
  ];
}

function quoteTotalForDisplayLegs(displayLegs, quoteLegs) {
  let total = 0;
  for (const displayLeg of displayLegs) {
    if (displayLeg.mode === 'bus') continue;
    const quote = quoteLegs.find((quotedLeg) => sameDisplayLeg(displayLeg, quotedLeg));
    if (!Number.isFinite(quote?.amount)) return null;
    total += quote.amount;
  }
  return roundMoney(total);
}

function sameDisplayLeg(displayLeg, quotedLeg) {
  return displayLeg.from === quotedLeg.from && displayLeg.to === quotedLeg.to && displayLeg.departOn === quotedLeg.departureDate;
}

function dateWindow(startDate, days) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

async function tryProvider(name, fn) {
  try {
    return {
      quote: await fn(),
      summary: { provider: name, ok: true }
    };
  } catch (error) {
    return {
      quote: null,
      summary: { provider: name, ok: false, error: error.message }
    };
  }
}

async function quoteWithAmadeus(legs) {
  assertEnv('AMADEUS_CLIENT_ID');
  assertEnv('AMADEUS_CLIENT_SECRET');

  const token = await getAmadeusToken();
  const pricedLegs = [];

  for (const leg of legs) {
    const params = new URLSearchParams({
      originLocationCode: leg.origin,
      destinationLocationCode: leg.destination,
      departureDate: leg.departureDate,
      adults: '1',
      currencyCode: 'USD',
      max: '1'
    });
    const response = await fetch(`${amadeusBaseUrl()}/v2/shopping/flight-offers?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      }
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(providerError(payload, `Amadeus failed for ${leg.origin}-${leg.destination}`));
    }

    const offer = payload.data?.[0];
    pricedLegs.push({
      ...leg,
      amount: offer ? Number(offer.price?.grandTotal || offer.price?.total) : null,
      currency: offer?.price?.currency || 'USD',
      providerOfferId: offer?.id || null,
      carrier: offer?.validatingAirlineCodes?.[0] || null
    });
  }

  return normalizeQuote('amadeus', pricedLegs);
}

async function quoteWithSerpApi(legs) {
  assertEnv('SERPAPI_KEY');

  const pricedLegs = [];

  for (const leg of legs) {
    const params = new URLSearchParams({
      engine: 'google_flights',
      type: '2',
      departure_id: leg.origin,
      arrival_id: leg.destination,
      outbound_date: leg.departureDate,
      currency: 'USD',
      adults: '1',
      sort_by: '2',
      api_key: process.env.SERPAPI_KEY
    });
    const response = await fetch(`https://serpapi.com/search?${params}`);
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.error || `SerpApi failed for ${leg.origin}-${leg.destination}`);
    }
    if (payload.error) {
      pricedLegs.push({
        ...leg,
        amount: null,
        currency: 'USD',
        providerOfferId: payload.search_metadata?.id || null,
        carrier: null,
        error: payload.error
      });
      continue;
    }

    const offer = payload.best_flights?.[0] || payload.other_flights?.[0] || payload.flights?.[0];
    pricedLegs.push({
      ...leg,
      amount: typeof offer?.price === 'number' ? offer.price : null,
      currency: 'USD',
      providerOfferId: payload.search_metadata?.id || null,
      carrier: offer?.flights?.[0]?.airline || null,
      error: offer ? null : 'No flights found for this leg.'
    });
  }

  return normalizeQuote('serpapi', pricedLegs);
}

async function quoteLeg(leg, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
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

  for (const [provider, fn] of providers) {
    emitProgress(onProgress, 'provider-start', `Checking ${providerLabel(provider)} for ${routeLabel(leg)} on ${leg.departureDate}.`, {
      provider,
      route: routeLabel(leg),
      date: leg.departureDate,
      phase: options.phase,
      candidateRoute: options.candidateRoute || null,
      russianDirection: isRussianDirection(leg)
    });
    const result = await tryCachedProvider(provider, leg, fn, { onProgress });
    attempts.push({
      ...result.summary,
      route: `${leg.origin}-${leg.destination}`,
      russianDirection: isRussianDirection(leg)
    });
    emitProgress(onProgress, result.summary.ok ? 'provider-complete' : 'provider-failed', providerProgressMessage(provider, leg, result), {
      provider,
      route: routeLabel(leg),
      date: leg.departureDate,
      amount: result.quote?.amount || null,
      cached: result.summary.cached === true,
      error: result.summary.error || result.quote?.error || null,
      phase: options.phase,
      candidateRoute: options.candidateRoute || null
    });
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
  const cached = legQuoteCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    emitProgress(onProgress, 'cache-hit', `Using cached ${providerLabel(provider)} result for ${routeLabel(leg)} on ${leg.departureDate}.`, {
      provider,
      route: routeLabel(leg),
      date: leg.departureDate
    });
    return {
      quote: cloneQuote(cached.quote),
      summary: { provider, ok: true, cached: true }
    };
  }
  if (cached) legQuoteCache.delete(cacheKey);

  const result = await tryProvider(provider, fn);
  if (result.quote) {
    legQuoteCache.set(cacheKey, {
      quote: cloneQuote(result.quote),
      expiresAt: Date.now() + LEG_QUOTE_CACHE_TTL_MS
    });
  }
  return result;
}

function legQuoteCacheKey(provider, leg) {
  return [provider, leg.origin, leg.destination, leg.departureDate, '1', 'USD'].join('|');
}

function emitProgress(onProgress, step, message, details = {}) {
  onProgress({
    step,
    message,
    details,
    at: new Date().toISOString()
  });
}

function routeLabel(leg) {
  return `${leg.from} -> ${leg.to}`;
}

function providerProgressMessage(provider, leg, result) {
  const label = providerLabel(provider);
  if (!result.summary.ok) return `${label} failed for ${routeLabel(leg)}: ${result.summary.error}.`;
  if (result.summary.cached) return `${label} cache hit for ${routeLabel(leg)}.`;
  if (Number.isFinite(result.quote?.amount)) return `${label} found ${routeLabel(leg)} for $${result.quote.amount.toLocaleString()} USD.`;
  if (result.quote?.schedule) return `${label} found schedule data for ${routeLabel(leg)}, but no USD fare.`;
  return `${label} returned no USD price for ${routeLabel(leg)}.`;
}

function cloneQuote(quote) {
  return quote ? JSON.parse(JSON.stringify(quote)) : null;
}

async function quoteLegWithSerpApi(leg) {
  assertEnv('SERPAPI_KEY');

  const params = new URLSearchParams({
    engine: 'google_flights',
    type: '2',
    departure_id: leg.origin,
    arrival_id: leg.destination,
    outbound_date: leg.departureDate,
    currency: 'USD',
    adults: '1',
    sort_by: '2',
    api_key: process.env.SERPAPI_KEY
  });
  const response = await fetch(`https://serpapi.com/search?${params}`);
  const payload = await readJson(response);
  if (!response.ok || payload.error) {
    throw new Error(payload.error || `SerpApi failed for ${leg.origin}-${leg.destination}`);
  }

  const offer = payload.best_flights?.[0] || payload.other_flights?.[0] || payload.flights?.[0];
  return {
    ...leg,
    amount: typeof offer?.price === 'number' ? offer.price : null,
    currency: 'USD',
    provider: 'serpapi',
    providerOfferId: payload.search_metadata?.id || null,
    carrier: offer?.flights?.[0]?.airline || null,
    error: offer ? null : 'No flights found for this leg.'
  };
}

async function quoteLegWithTravelpayouts(leg) {
  assertEnv('TRAVELPAYOUTS_TOKEN');

  const params = new URLSearchParams({
    origin: leg.origin,
    destination: leg.destination,
    departure_at: leg.departureDate,
    currency: 'usd',
    market: 'ru',
    one_way: 'true',
    direct: 'false',
    sorting: 'price',
    limit: '1',
    token: process.env.TRAVELPAYOUTS_TOKEN
  });
  const response = await fetch(`https://api.travelpayouts.com/aviasales/v3/prices_for_dates?${params}`);
  const payload = await readJson(response);
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || `Aviasales failed for ${leg.origin}-${leg.destination}`);
  }

  const offer = payload.data?.[0];
  return {
    ...leg,
    amount: Number.isFinite(offer?.price) ? offer.price : null,
    currency: (offer?.currency || 'USD').toUpperCase(),
    provider: 'aviasales',
    providerOfferId: offer?.search_id || offer?.signature || null,
    carrier: offer?.airline || null,
    error: offer ? null : 'Aviasales did not return cached prices for this leg.'
  };
}

async function quoteLegWithYandexRasp(leg) {
  assertEnv('YANDEX_RASP_API_KEY');

  const params = new URLSearchParams({
    apikey: process.env.YANDEX_RASP_API_KEY,
    format: 'json',
    from: leg.origin,
    to: leg.destination,
    system: 'iata',
    show_systems: 'iata',
    lang: 'en_US',
    date: leg.departureDate,
    transport_types: 'plane,train,bus',
    transfers: 'true',
    limit: '5'
  });
  const response = await fetch(`https://api.rasp.yandex-net.ru/v3.0/search/?${params}`);
  const payload = await readJson(response);
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.text || payload.error || `Yandex Rasp failed for ${leg.origin}-${leg.destination}`);
  }

  const segment = [...(payload.segments || []), ...(payload.interval_segments || [])].find(Boolean);
  if (!segment) {
    return { ...leg, amount: null, currency: 'USD', provider: 'yandex-rasp', error: 'Yandex Rasp did not return schedule options for this leg.' };
  }
  const place = segment.tickets_info?.places?.find((item) => item.price?.whole);
  return {
    ...leg,
    amount: null,
    currency: 'USD',
    provider: 'yandex-rasp',
    providerOfferId: segment.thread?.uid || null,
    carrier: segment.thread?.carrier?.title || null,
    schedule: {
      transportType: segment.thread?.transport_type || segment.from?.transport_type || null,
      departure: segment.departure || null,
      arrival: segment.arrival || null,
      durationSeconds: segment.duration || null,
      rubPrice: place?.price?.whole || null
    },
    error: place?.price?.whole
      ? `Yandex Rasp found a ${place.price.whole} RUB fare; USD conversion is not connected yet.`
      : 'Yandex Rasp found schedule options, but no USD price.'
  };
}

async function getAmadeusToken() {
  if (amadeusTokenCache && amadeusTokenCache.expiresAt > Date.now() + 30_000) {
    return amadeusTokenCache.token;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.AMADEUS_CLIENT_ID,
    client_secret: process.env.AMADEUS_CLIENT_SECRET
  });
  const response = await fetch(`${amadeusBaseUrl()}/v1/security/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(providerError(payload, 'Amadeus authentication failed'));
  }

  amadeusTokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + Number(payload.expires_in || 0) * 1000
  };
  return amadeusTokenCache.token;
}

function normalizeQuote(provider, legs, attempts = []) {
  const priced = legs.filter((leg) => Number.isFinite(leg.amount));
  const activeProviders = [...new Set(legs.map((leg) => leg.provider).filter(Boolean))];
  return {
    provider,
    currency: 'USD',
    totalAmount: priced.length === legs.length ? roundMoney(priced.reduce((sum, leg) => sum + leg.amount, 0)) : null,
    pricedLegCount: priced.length,
    legCount: legs.length,
    legs: legs.map((leg) => ({
      ...leg,
      amount: Number.isFinite(leg.amount) ? roundMoney(leg.amount) : null
    })),
    attempts,
    message:
      priced.length === legs.length
        ? `${providerLabel(activeProviders.join(', ') || provider)} returned all flight leg prices in USD.`
        : priced.length > 0
          ? `${providerLabel(activeProviders.join(', ') || provider)} returned ${priced.length} of ${legs.length} leg prices in USD.`
          : configuredProviders().length
            ? 'Configured providers did not return USD prices for this route.'
            : 'No flight price provider is configured. Add provider keys to the server environment.'
  };
}

function configuredProviders() {
  return [
    process.env.SERPAPI_KEY ? 'serpapi' : null,
    process.env.TRAVELPAYOUTS_TOKEN ? 'aviasales' : null,
    process.env.YANDEX_RASP_API_KEY ? 'yandex-rasp' : null,
    process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET ? 'amadeus' : null
  ].filter(Boolean);
}

function providerLabel(provider) {
  return provider
    .split(', ')
    .map((name) => {
      if (name === 'serpapi') return 'SerpApi Google Flights';
      if (name === 'aviasales') return 'Aviasales';
      if (name === 'yandex-rasp') return 'Yandex Rasp';
      if (name === 'amadeus') return 'Amadeus';
      return name;
    })
    .join(', ');
}

function normalizeLegs(legs) {
  return Array.isArray(legs)
    ? legs.map((leg) => ({
        from: leg.from,
        to: leg.to,
        mode: leg.mode || 'flight',
        origin: toIataCode(leg.from),
        destination: toIataCode(leg.to),
        departureDate: leg.departOn || leg.departureDate || leg.arriveBy
      })).filter((leg) => leg.mode !== 'bus')
    : [];
}

function isRussianDirection(leg) {
  return (
    RUSSIAN_CITY_NAMES.has(leg.from) ||
    RUSSIAN_CITY_NAMES.has(leg.to) ||
    RUSSIAN_IATA_CODES.has(leg.origin) ||
    RUSSIAN_IATA_CODES.has(leg.destination)
  );
}

function toIataCode(city) {
  const value = String(city || '').trim();
  if (/^[A-Z]{3}$/.test(value)) return value;
  const code = CITY_IATA_CODES.get(value.toLowerCase());
  if (!code) {
    throw new Error(`No IATA code configured for ${value}. Use a 3-letter airport/city code for pricing.`);
  }
  return code;
}

function amadeusBaseUrl() {
  return process.env.AMADEUS_BASE_URL || 'https://test.api.amadeus.com';
}

function assertEnv(name) {
  if (!process.env[name]) {
    throw new Error(`${name} is not configured`);
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function providerError(payload, fallback) {
  return payload.errors?.[0]?.detail || payload.error_description || payload.error || fallback;
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}
