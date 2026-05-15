import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { after, before, describe, it } from 'node:test';
import { clearFlightPriceCache, closeFlightPriceCacheDb, quoteFlightPrices } from './flight-prices.js';

const originalCacheDb = process.env.FLIGHT_PRICE_CACHE_DB;
const testCacheDir = mkdtempSync(join(tmpdir(), 'microwave-travel-cache-suite-'));

before(() => {
  process.env.FLIGHT_PRICE_CACHE_DB = join(testCacheDir, 'flight-cache.sqlite');
});

after(() => {
  closeFlightPriceCacheDb();
  restoreEnv('FLIGHT_PRICE_CACHE_DB', originalCacheDb);
  rmSync(testCacheDir, { recursive: true, force: true });
});

describe('flight price providers', () => {
  it('caches successful leg quote responses for one hour', async () => {
    clearFlightPriceCache();
    const originalSerpApiKey = process.env.SERPAPI_KEY;
    const originalFetch = globalThis.fetch;
    process.env.SERPAPI_KEY = 'test-serpapi-key';
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return Response.json({
        best_flights: [{ price: 123, flights: [{ airline: 'Test Air' }] }],
        search_metadata: { id: 'cached-search' }
      });
    };

    const input = { legs: [{ from: 'Porto', to: 'Doha', departOn: '2026-05-20', mode: 'flight' }] };
    const first = await quoteFlightPrices(input);
    const second = await quoteFlightPrices(input);

    globalThis.fetch = originalFetch;
    restoreEnv('SERPAPI_KEY', originalSerpApiKey);
    clearFlightPriceCache();

    assert.equal(calls, 1);
    assert.equal(first.legs[0].amount, 123);
    assert.equal(second.legs[0].amount, 123);
    assert.equal(second.attempts[0].cached, true);
  });

  it('reuses cached provider results from SQLite after reopening the cache', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'microwave-travel-cache-'));
    const originalCacheDb = process.env.FLIGHT_PRICE_CACHE_DB;
    const originalSerpApiKey = process.env.SERPAPI_KEY;
    const originalFetch = globalThis.fetch;
    process.env.FLIGHT_PRICE_CACHE_DB = join(tempDir, 'flight-cache.sqlite');
    process.env.SERPAPI_KEY = 'test-serpapi-key';
    clearFlightPriceCache();
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return Response.json({
        best_flights: [{ price: 456, flights: [{ airline: 'Persist Air' }] }],
        search_metadata: { id: 'persistent-search' }
      });
    };

    const input = { legs: [{ from: 'Porto', to: 'Doha', departOn: '2026-05-20', mode: 'flight' }] };
    await quoteFlightPrices(input);
    closeFlightPriceCacheDb();
    const second = await quoteFlightPrices(input);

    globalThis.fetch = originalFetch;
    restoreEnv('FLIGHT_PRICE_CACHE_DB', originalCacheDb);
    restoreEnv('SERPAPI_KEY', originalSerpApiKey);
    closeFlightPriceCacheDb();
    rmSync(tempDir, { recursive: true, force: true });

    assert.equal(calls, 1);
    assert.equal(second.legs[0].amount, 456);
    assert.equal(second.attempts[0].cached, true);
  });

  it('emits progress while fetching provider prices', async () => {
    clearFlightPriceCache();
    const originalSerpApiKey = process.env.SERPAPI_KEY;
    const originalFetch = globalThis.fetch;
    process.env.SERPAPI_KEY = 'test-serpapi-key';
    const events = [];
    globalThis.fetch = async () => Response.json({
      best_flights: [{ price: 321, flights: [{ airline: 'Test Air' }] }],
      search_metadata: { id: 'progress-search' }
    });

    await quoteFlightPrices(
      { legs: [{ from: 'Porto', to: 'Doha', departOn: '2026-05-20', mode: 'flight' }] },
      { onProgress: (event) => events.push(event) }
    );

    globalThis.fetch = originalFetch;
    restoreEnv('SERPAPI_KEY', originalSerpApiKey);
    clearFlightPriceCache();

    assert.ok(events.some((event) => event.step === 'pricing-start'));
    assert.ok(events.some((event) => event.step === 'provider-start'));
    assert.ok(events.some((event) => event.step === 'provider-complete'));
    assert.ok(events.some((event) => event.message.includes('Porto -> Doha')));
  });

  it('emits route comparison progress for popular transfer checks', async () => {
    clearFlightPriceCache();
    const originalSerpApiKey = process.env.SERPAPI_KEY;
    const originalTravelpayoutsToken = process.env.TRAVELPAYOUTS_TOKEN;
    const originalYandexKey = process.env.YANDEX_RASP_API_KEY;
    const originalFetch = globalThis.fetch;
    process.env.SERPAPI_KEY = 'test-serpapi-key';
    delete process.env.TRAVELPAYOUTS_TOKEN;
    delete process.env.YANDEX_RASP_API_KEY;
    const events = [];
    const routePrices = new Map([
      ['DXB-LIS', 1000],
      ['LIS-OPO', 220],
      ['DXB-OPO', 900],
      ['DXB-DOH', 80],
      ['DOH-OPO', 120]
    ]);
    globalThis.fetch = async (url) => {
      const params = new URL(url).searchParams;
      const route = `${params.get('departure_id')}-${params.get('arrival_id')}`;
      const price = routePrices.get(route);
      return Response.json({
        best_flights: price ? [{ price, flights: [{ airline: 'Test Air' }] }] : [],
        search_metadata: { id: `search-${route}` }
      });
    };

    await quoteFlightPrices(
      {
        legs: [
          { from: 'Dubai', to: 'Lisbon', departOn: '2026-05-23', mode: 'flight' },
          { from: 'Lisbon', to: 'Porto', departOn: '2026-05-24', mode: 'flight' }
        ]
      },
      { onProgress: (event) => events.push(event) }
    );

    globalThis.fetch = originalFetch;
    restoreEnv('SERPAPI_KEY', originalSerpApiKey);
    restoreEnv('TRAVELPAYOUTS_TOKEN', originalTravelpayoutsToken);
    restoreEnv('YANDEX_RASP_API_KEY', originalYandexKey);
    clearFlightPriceCache();

    assert.ok(events.some((event) => event.step === 'compare-start'));
    assert.ok(events.some((event) => event.step === 'candidate-start' && event.message.includes('Dubai -> Doha -> Porto')));
    assert.ok(events.some((event) => event.step === 'candidate-best'));
  });

  it('reports missing provider credentials without inventing prices', async () => {
    clearFlightPriceCache();
    const originalAmadeusId = process.env.AMADEUS_CLIENT_ID;
    const originalAmadeusSecret = process.env.AMADEUS_CLIENT_SECRET;
    const originalSerpApiKey = process.env.SERPAPI_KEY;
    delete process.env.AMADEUS_CLIENT_ID;
    delete process.env.AMADEUS_CLIENT_SECRET;
    delete process.env.SERPAPI_KEY;

    const quote = await quoteFlightPrices({
      legs: [{ from: 'Porto', to: 'Doha', departOn: '2026-05-20' }]
    });

    restoreEnv('AMADEUS_CLIENT_ID', originalAmadeusId);
    restoreEnv('AMADEUS_CLIENT_SECRET', originalAmadeusSecret);
    restoreEnv('SERPAPI_KEY', originalSerpApiKey);

    assert.equal(quote.totalAmount, null);
    assert.equal(quote.currency, 'USD');
    assert.equal(quote.attempts.length, 2);
  });

  it('compares popular Dubai to Porto transfer routes including Doha', async () => {
    clearFlightPriceCache();
    const originalSerpApiKey = process.env.SERPAPI_KEY;
    const originalTravelpayoutsToken = process.env.TRAVELPAYOUTS_TOKEN;
    const originalYandexKey = process.env.YANDEX_RASP_API_KEY;
    const originalFetch = globalThis.fetch;
    process.env.SERPAPI_KEY = 'test-serpapi-key';
    delete process.env.TRAVELPAYOUTS_TOKEN;
    delete process.env.YANDEX_RASP_API_KEY;

    const routePrices = new Map([
      ['DXB-LIS', 1000],
      ['LIS-OPO', 220],
      ['DXB-OPO', 900],
      ['DXB-DOH', 80],
      ['DOH-OPO', 120]
    ]);
    globalThis.fetch = async (url) => {
      const params = new URL(url).searchParams;
      const route = `${params.get('departure_id')}-${params.get('arrival_id')}`;
      const price = routePrices.get(route);
      return Response.json({
        best_flights: price ? [{ price, flights: [{ airline: 'Test Air' }] }] : [],
        search_metadata: { id: `search-${route}` }
      });
    };

    const quote = await quoteFlightPrices({
      legs: [
        { from: 'Dubai', to: 'Lisbon', departOn: '2026-05-23', mode: 'flight' },
        { from: 'Lisbon', to: 'Porto', departOn: '2026-05-24', mode: 'flight' }
      ]
    });

    globalThis.fetch = originalFetch;
    restoreEnv('SERPAPI_KEY', originalSerpApiKey);
    restoreEnv('TRAVELPAYOUTS_TOKEN', originalTravelpayoutsToken);
    restoreEnv('YANDEX_RASP_API_KEY', originalYandexKey);
    clearFlightPriceCache();

    assert.equal(quote.totalAmount, 200);
    assert.deepEqual(quote.optimization.selectedRoute, ['Dubai', 'Doha', 'Porto']);
    assert.deepEqual(quote.optimizedRouteLegs.map((leg) => `${leg.from}-${leg.to}`), ['Dubai-Doha', 'Doha-Porto']);
  });

  it('also compares Porto to Dubai transfer routes', async () => {
    clearFlightPriceCache();
    const originalSerpApiKey = process.env.SERPAPI_KEY;
    const originalTravelpayoutsToken = process.env.TRAVELPAYOUTS_TOKEN;
    const originalYandexKey = process.env.YANDEX_RASP_API_KEY;
    const originalFetch = globalThis.fetch;
    process.env.SERPAPI_KEY = 'test-serpapi-key';
    delete process.env.TRAVELPAYOUTS_TOKEN;
    delete process.env.YANDEX_RASP_API_KEY;

    const routePrices = new Map([
      ['OPO-LIS', 500],
      ['LIS-DXB', 500],
      ['OPO-DXB', 900],
      ['OPO-DOH', 80],
      ['DOH-DXB', 60]
    ]);
    globalThis.fetch = async (url) => {
      const params = new URL(url).searchParams;
      const route = `${params.get('departure_id')}-${params.get('arrival_id')}`;
      const price = routePrices.get(route);
      return Response.json({
        best_flights: price ? [{ price, flights: [{ airline: 'Test Air' }] }] : [],
        search_metadata: { id: `search-${route}` }
      });
    };

    const quote = await quoteFlightPrices({
      legs: [
        { from: 'Porto', to: 'Lisbon', departOn: '2026-05-20', mode: 'flight' },
        { from: 'Lisbon', to: 'Dubai', departOn: '2026-05-21', mode: 'flight' }
      ]
    });

    globalThis.fetch = originalFetch;
    restoreEnv('SERPAPI_KEY', originalSerpApiKey);
    restoreEnv('TRAVELPAYOUTS_TOKEN', originalTravelpayoutsToken);
    restoreEnv('YANDEX_RASP_API_KEY', originalYandexKey);
    clearFlightPriceCache();

    assert.equal(quote.totalAmount, 140);
    assert.deepEqual(quote.optimization.selectedRoute, ['Porto', 'Doha', 'Dubai']);
    assert.deepEqual(quote.optimizedRouteLegs.map((leg) => `${leg.from}-${leg.to}`), ['Porto-Doha', 'Doha-Dubai']);
  });
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
