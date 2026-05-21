// Per-leg HTTP clients for each upstream price provider, plus the
// shared tryProvider wrapper that captures success/error summaries.
// Add a new provider here: write quoteLegWith<Name>(leg), then register
// it in leg-quoter.js's `providers` cascade (Russian vs. non-Russian
// direction). getAmadeusToken caches the OAuth token across calls.

import {
  baggageAllowanceFromOffer,
  unknownBaggageAllowance
} from './baggage-from-offer.js';

let amadeusTokenCache = null;

export async function tryProvider(name, fn) {
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

export async function quoteLegWithSerpApi(leg) {
  assertEnv('SERPAPI_KEY');

  const params = new URLSearchParams({
    engine: 'google_flights',
    type: '2',
    departure_id: leg.origin,
    arrival_id: leg.destination,
    outbound_date: leg.departureDate,
    currency: 'USD',
    adults: String(leg.passengers || 1),
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
    baggageAllowance: baggageAllowanceFromOffer('serpapi', offer),
    error: offer ? null : 'No flights found for this leg.'
  };
}

export async function quoteLegWithTravelpayouts(leg) {
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
    baggageAllowance: baggageAllowanceFromOffer('aviasales', offer),
    error: offer ? null : 'Aviasales did not return cached prices for this leg.'
  };
}

export async function quoteLegWithYandexRasp(leg) {
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
    baggageAllowance: unknownBaggageAllowance('yandex-rasp'),
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

export async function getAmadeusToken() {
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
