const CITY_IATA_CODES = new Map([
  ['porto', 'OPO'],
  ['doha', 'DOH'],
  ['dubai', 'DXB'],
  ['gdansk', 'GDN'],
  ['kaliningrad', 'KGD'],
  ['moscow', 'MOW'],
  ['moskow', 'MOW']
]);

const RUSSIAN_CITY_NAMES = new Set(['Kaliningrad', 'Moscow']);
const RUSSIAN_IATA_CODES = new Set(['KGD', 'MOW', 'SVO', 'DME', 'VKO']);
const LEG_QUOTE_CACHE_TTL_MS = 60 * 60 * 1000;
const legQuoteCache = new Map();
let amadeusTokenCache = null;

export async function quoteFlightPrices(input) {
  const legs = normalizeLegs(input.legs);
  if (legs.length === 0) {
    throw new Error('Optimize a route before fetching prices.');
  }

  const quotedLegs = [];
  const attempts = [];

  for (const leg of legs) {
    const result = await quoteLeg(leg);
    quotedLegs.push(result.leg);
    attempts.push(...result.attempts);
  }

  return normalizeQuote('mixed', quotedLegs, attempts);
}

export function clearFlightPriceCache() {
  legQuoteCache.clear();
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

async function quoteLeg(leg) {
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
    const result = await tryCachedProvider(provider, leg, fn);
    attempts.push({
      ...result.summary,
      route: `${leg.origin}-${leg.destination}`,
      russianDirection: isRussianDirection(leg)
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

async function tryCachedProvider(provider, leg, fn) {
  const cacheKey = legQuoteCacheKey(provider, leg);
  const cached = legQuoteCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
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
