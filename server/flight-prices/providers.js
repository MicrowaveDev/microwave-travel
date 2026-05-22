// Per-leg HTTP clients for each upstream price provider, plus the
// shared tryProvider wrapper that captures success/error summaries.
// Add a new provider here: write quoteLegWith<Name>(leg), then register
// it in leg-quoter.js's `providers` cascade (Russian vs. non-Russian
// direction). getAmadeusToken caches the OAuth token across calls.

import { airportLabel, arrivalIsoInZone, inferLikelyHub } from '../iata-codes.js';
import {
  baggageAllowanceFromOffer,
  unknownBaggageAllowance
} from './baggage-from-offer.js';

let amadeusTokenCache = null;

export async function tryProvider(name, fn) {
  try {
    const quote = await fn();
    const hasUsableResult = Number.isFinite(quote?.amount) || Boolean(quote?.schedule);
    return {
      quote,
      summary: hasUsableResult
        ? { provider: name, ok: true }
        : {
            provider: name,
            ok: false,
            noPrice: true,
            error: quote?.error || 'Provider returned no comparable USD price.'
          }
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
  const segments = Array.isArray(offer?.flights) ? offer.flights : [];
  const stopCount = Math.max(0, segments.length - 1);
  return {
    ...leg,
    amount: typeof offer?.price === 'number' ? offer.price : null,
    currency: 'USD',
    provider: 'serpapi',
    providerOfferId: payload.search_metadata?.id || null,
    carrier: segments[0]?.airline || null,
    departureAt: normalizeIsoTime(segments[0]?.departure_airport?.time),
    arrivalAt: normalizeIsoTime(segments.at(-1)?.arrival_airport?.time),
    stopCount,
    hubCode: stopCount > 0 ? segments[0]?.arrival_airport?.id || null : null,
    hubLabel: stopCount > 0 ? airportLabel(segments[0]?.arrival_airport?.id) : null,
    hubInferred: false,
    flightSegments: segments.map((segment) => ({
      origin: segment.departure_airport?.id || null,
      destination: segment.arrival_airport?.id || null,
      departingAt: normalizeIsoTime(segment.departure_airport?.time),
      arrivingAt: normalizeIsoTime(segment.arrival_airport?.time)
    })),
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
  const departureAt = normalizeIsoTime(offer?.departure_at);
  const stopCount = Number.isFinite(offer?.transfers) ? Math.max(0, Number(offer.transfers)) : 0;
  // Travelpayouts prices_for_dates doesn't return the connecting airport
  // IATA, so for legs with stops we fall back to a carrier-hub guess.
  // Mark the result with hubInferred so the UI can label it "Likely via".
  const inferredHub = stopCount > 0 ? inferLikelyHub(offer?.airline, leg.origin, leg.destination) : null;
  return {
    ...leg,
    amount: Number.isFinite(offer?.price) ? offer.price : null,
    currency: (offer?.currency || 'USD').toUpperCase(),
    provider: 'aviasales',
    providerOfferId: offer?.search_id || offer?.signature || null,
    carrier: offer?.airline || null,
    departureAt,
    arrivalAt: arrivalIsoInZone(departureAt, offer?.duration, leg.destination),
    stopCount,
    hubCode: inferredHub,
    hubLabel: airportLabel(inferredHub),
    hubInferred: Boolean(inferredHub),
    baggageAllowance: baggageAllowanceFromOffer('aviasales', offer),
    error: offer ? null : 'Aviasales did not return cached prices for this leg.'
  };
}

export async function quoteLegWithDuffel(leg) {
  assertEnv('DUFFEL_ACCESS_TOKEN');
  assertDuffelLiveModeAllowed();

  const response = await fetch('https://api.duffel.com/air/offer_requests?return_offers=true&supplier_timeout=10000', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Duffel-Version': 'v2',
      Authorization: `Bearer ${process.env.DUFFEL_ACCESS_TOKEN}`
    },
    body: JSON.stringify({
      data: {
        cabin_class: 'economy',
        max_connections: 1,
        passengers: passengerList(leg.passengers),
        slices: [
          {
            origin: leg.origin,
            destination: leg.destination,
            departure_date: leg.departureDate
          }
        ]
      }
    })
  });
  const payload = await readJson(response);
  if (!response.ok || payload.errors?.length) {
    throw new Error(providerError(payload, `Duffel failed for ${leg.origin}-${leg.destination}`));
  }

  const offer = cheapestDuffelUsdOffer(payload.data?.offers || []);
  const segments = offer?.slices?.[0]?.segments || [];
  const stopCount = Math.max(0, segments.length - 1);
  return {
    ...leg,
    amount: offer ? Number(offer.total_amount) : null,
    currency: 'USD',
    provider: 'duffel',
    providerOfferId: offer?.id || null,
    carrier: duffelCarrierCode(offer),
    departureAt: normalizeIsoTime(segments[0]?.departing_at),
    arrivalAt: normalizeIsoTime(segments.at(-1)?.arriving_at),
    stopCount,
    hubCode: stopCount > 0
      ? segments[0]?.destination?.iata_code || null
      : null,
    hubLabel: stopCount > 0 ? airportLabel(segments[0]?.destination?.iata_code) : null,
    hubInferred: false,
    flightSegments: segments.map((segment) => ({
      origin: segment.origin?.iata_code || null,
      destination: segment.destination?.iata_code || null,
      departingAt: normalizeIsoTime(segment.departing_at),
      arrivingAt: normalizeIsoTime(segment.arriving_at)
    })),
    baggageAllowance: unknownBaggageAllowance('duffel'),
    error: offer ? null : 'Duffel did not return USD flight offers for this leg.'
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
  const yandexStops = Array.isArray(segment.has_transfers) ? segment.has_transfers : [];
  return {
    ...leg,
    amount: null,
    currency: 'USD',
    provider: 'yandex-rasp',
    providerOfferId: segment.thread?.uid || null,
    carrier: segment.thread?.carrier?.title || null,
    departureAt: normalizeIsoTime(segment.departure),
    arrivalAt: normalizeIsoTime(segment.arrival),
    stopCount: yandexStops.length,
    hubCode: yandexStops[0]?.code || null,
    hubLabel: airportLabel(yandexStops[0]?.code),
    hubInferred: false,
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

function assertDuffelLiveModeAllowed() {
  if (!String(process.env.DUFFEL_ACCESS_TOKEN || '').startsWith('duffel_live_')) return;
  if (process.env.DUFFEL_ALLOW_LIVE === 'true') return;
  throw new Error('DUFFEL_ALLOW_LIVE=true is required before using a live Duffel token.');
}

function passengerList(passengers = 1) {
  const count = Math.max(1, Math.min(9, Number(passengers) || 1));
  return Array.from({ length: count }, () => ({ type: 'adult' }));
}

function cheapestDuffelUsdOffer(offers) {
  return offers
    .filter((offer) => offer?.total_currency === 'USD' && Number.isFinite(Number(offer.total_amount)))
    .sort((left, right) => Number(left.total_amount) - Number(right.total_amount))[0] || null;
}

function duffelCarrierCode(offer) {
  return (
    offer?.owner?.iata_code ||
    offer?.slices?.[0]?.segments?.[0]?.marketing_carrier?.iata_code ||
    offer?.slices?.[0]?.segments?.[0]?.operating_carrier?.iata_code ||
    null
  );
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

function normalizeIsoTime(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(text)) {
    return text.replace(' ', 'T');
  }
  return null;
}
