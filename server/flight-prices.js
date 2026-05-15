const CITY_IATA_CODES = new Map([
  ['porto', 'OPO'],
  ['doha', 'DOH'],
  ['dubai', 'DXB'],
  ['gdansk', 'GDN'],
  ['kaliningrad', 'KGD'],
  ['moscow', 'MOW'],
  ['moskow', 'MOW']
]);

let amadeusTokenCache = null;

export async function quoteFlightPrices(input) {
  const legs = normalizeLegs(input.legs);
  if (legs.length === 0) {
    throw new Error('Optimize a route before fetching prices.');
  }

  const attempts = [];
  const providers = process.env.SERPAPI_KEY
    ? [
        ['serpapi', () => quoteWithSerpApi(legs)],
        ['amadeus', () => quoteWithAmadeus(legs)]
      ]
    : [
        ['amadeus', () => quoteWithAmadeus(legs)],
        ['serpapi', () => quoteWithSerpApi(legs)]
      ];

  for (const [name, provider] of providers) {
    const result = await tryProvider(name, provider);
    attempts.push(result.summary);
    if (result.quote) return { ...result.quote, attempts };
  }

  return {
    provider: null,
    currency: 'USD',
    totalAmount: null,
    legs: [],
    attempts,
    message: configuredProviders().length
      ? 'No provider returned prices for this route.'
      : 'No flight price provider is configured. Add a SerpApi key or Amadeus keys to the server environment.'
  };
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

function normalizeQuote(provider, legs) {
  const priced = legs.filter((leg) => Number.isFinite(leg.amount));
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
    message:
      priced.length === legs.length
        ? provider === 'amadeus'
          ? 'Amadeus one-way leg prices in USD. Use Flight Offers Price before booking.'
          : 'SerpApi Google Flights prices in USD.'
        : priced.length > 0
          ? `${providerLabel(provider)} returned ${priced.length} of ${legs.length} leg prices in USD.`
          : `${providerLabel(provider)} is configured, but no prices were found for this route.`
  };
}

function configuredProviders() {
  return [
    process.env.SERPAPI_KEY ? 'serpapi' : null,
    process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET ? 'amadeus' : null
  ].filter(Boolean);
}

function providerLabel(provider) {
  return provider === 'serpapi' ? 'SerpApi Google Flights' : 'Amadeus';
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
