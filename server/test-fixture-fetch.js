import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function installFixtureFetchFromEnv() {
  if (!process.env.FLIGHT_PRICE_FIXTURE_FILE) return null;
  const fixture = JSON.parse(readFileSync(resolve(process.env.FLIGHT_PRICE_FIXTURE_FILE), 'utf8'));
  return installFixtureFetch(fixture);
}

export function installFixtureFetch(fixture) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(typeof url === 'string' ? url : url.url);
    if (parsed.hostname === 'serpapi.com') return serpApiResponse(parsed, fixture);
    if (!isAviasalesPriceRequest(parsed)) return originalFetch(url, init);
    return aviasalesResponse(parsed, fixture);
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function isAviasalesPriceRequest(url) {
  return (
    url.searchParams.has('origin') &&
    url.searchParams.has('destination') &&
    url.searchParams.has('departure_at')
  );
}

function serpApiResponse(url, fixture) {
  if (fixture.serpapi?.error) {
    return Response.json({ error: fixture.serpapi.error });
  }

  const route = [
    url.searchParams.get('departure_id'),
    url.searchParams.get('arrival_id'),
    url.searchParams.get('outbound_date')
  ].join('-');
  const offer = fixture.serpapi?.prices?.[route];
  return Response.json({
    best_flights: Number.isFinite(offer?.price)
      ? [{
          price: offer.price,
          extensions: offer.baggage ? [offer.baggage] : [],
          flights: [{ airline: offer.carrier || 'Fixture Air' }]
        }]
      : [],
    search_metadata: { id: `fixture-serpapi-${route}` }
  });
}

function aviasalesResponse(url, fixture) {
  const route = [
    url.searchParams.get('origin'),
    url.searchParams.get('destination'),
    url.searchParams.get('departure_at')
  ].join('-');
  const offer = fixture.aviasales?.prices?.[route];
  return Response.json({
    success: true,
    data: Number.isFinite(offer?.price)
      ? [{
          price: offer.price,
          currency: 'usd',
          airline: offer.carrier || 'Fixture Air',
          baggage: offer.baggage || undefined,
          departure_at: offer.departureAt || undefined,
          duration: Number.isFinite(offer.durationMinutes) ? offer.durationMinutes : undefined,
          transfers: Number.isFinite(offer.transfers) ? offer.transfers : 0,
          search_id: `fixture-aviasales-${route}`
        }]
      : []
  });
}
