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

  it('skips SerpApi for the rest of a search after quota exhaustion', async () => {
    clearFlightPriceCache();
    const originalSerpApiKey = process.env.SERPAPI_KEY;
    const originalTravelpayoutsToken = process.env.TRAVELPAYOUTS_TOKEN;
    const originalYandexKey = process.env.YANDEX_RASP_API_KEY;
    const originalFetch = globalThis.fetch;
    process.env.SERPAPI_KEY = 'test-serpapi-key';
    process.env.TRAVELPAYOUTS_TOKEN = 'test-aviasales-token';
    delete process.env.YANDEX_RASP_API_KEY;

    let serpApiCalls = 0;
    let aviasalesCalls = 0;
    const events = [];
    globalThis.fetch = async (url) => {
      const parsed = new URL(url);
      if (parsed.hostname === 'serpapi.com') {
        serpApiCalls += 1;
        return Response.json({ error: 'Your account has run out of searches.' });
      }
      aviasalesCalls += 1;
      return Response.json({
        success: true,
        data: [{ price: 123, currency: 'usd', airline: 'TP', search_id: `aviasales-${aviasalesCalls}` }]
      });
    };

    const quote = await quoteFlightPrices(
      {
        legs: [
          { from: 'Porto', to: 'Lisbon', departOn: '2026-05-20', mode: 'flight' },
          { from: 'Lisbon', to: 'Paris', departOn: '2026-05-21', mode: 'flight' }
        ]
      },
      { onProgress: (event) => events.push(event) }
    );

    globalThis.fetch = originalFetch;
    restoreEnv('SERPAPI_KEY', originalSerpApiKey);
    restoreEnv('TRAVELPAYOUTS_TOKEN', originalTravelpayoutsToken);
    restoreEnv('YANDEX_RASP_API_KEY', originalYandexKey);
    clearFlightPriceCache();

    assert.equal(quote.totalAmount, 246);
    assert.equal(serpApiCalls, 1);
    assert.equal(aviasalesCalls, 2);
    assert.ok(events.some((event) => event.step === 'provider-disabled' && event.details.provider === 'serpapi'));
    assert.ok(events.some((event) => event.step === 'provider-skipped' && event.details.provider === 'serpapi'));
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

  it('compares Porto to Dubai when a later Dubai leg is not a Porto return segment', async () => {
    clearFlightPriceCache();
    const originalSerpApiKey = process.env.SERPAPI_KEY;
    const originalTravelpayoutsToken = process.env.TRAVELPAYOUTS_TOKEN;
    const originalYandexKey = process.env.YANDEX_RASP_API_KEY;
    const originalFetch = globalThis.fetch;
    process.env.SERPAPI_KEY = 'test-serpapi-key';
    delete process.env.TRAVELPAYOUTS_TOKEN;
    delete process.env.YANDEX_RASP_API_KEY;

    const routePrices = new Map([
      ['OPO-DXB', 737],
      ['OPO-MAD', 100],
      ['MAD-DXB', 120],
      ['DXB-MOW', 484],
      ['MOW-KGD', 99],
      ['GDN-OPO', 249]
    ]);
    const events = [];
    globalThis.fetch = async (url) => {
      const params = new URL(url).searchParams;
      const route = `${params.get('departure_id')}-${params.get('arrival_id')}`;
      const price = routePrices.get(route);
      return Response.json({
        best_flights: price ? [{ price, flights: [{ airline: 'Test Air' }] }] : [],
        search_metadata: { id: `search-${route}` }
      });
    };

    const quote = await quoteFlightPrices(
      {
        legs: [
          { from: 'Porto', to: 'Dubai', departOn: '2026-05-20', mode: 'flight' },
          { from: 'Dubai', to: 'Moscow', departOn: '2026-05-23', mode: 'flight' },
          { from: 'Moscow', to: 'Kaliningrad', departOn: '2026-06-06', mode: 'flight' },
          { from: 'Kaliningrad', to: 'Gdansk', departOn: '2026-06-13', mode: 'bus' },
          { from: 'Gdansk', to: 'Porto', departOn: '2026-06-13', mode: 'flight' }
        ]
      },
      { onProgress: (event) => events.push(event) }
    );

    globalThis.fetch = originalFetch;
    restoreEnv('SERPAPI_KEY', originalSerpApiKey);
    restoreEnv('TRAVELPAYOUTS_TOKEN', originalTravelpayoutsToken);
    restoreEnv('YANDEX_RASP_API_KEY', originalYandexKey);
    clearFlightPriceCache();

    assert.equal(quote.totalAmount, 1052);
    assert.deepEqual(quote.optimization.selectedRoute, ['Porto', 'Madrid', 'Dubai']);
    assert.deepEqual(
      quote.optimizedRouteLegs.map((leg) => `${leg.from}-${leg.to}`),
      ['Porto-Madrid', 'Madrid-Dubai', 'Dubai-Moscow', 'Moscow-Kaliningrad', 'Kaliningrad-Gdansk', 'Gdansk-Porto']
    );
    assert.ok(events.some((event) => event.step === 'compare-start' && event.message.includes('Porto to Dubai')));
    assert.ok(events.some((event) => event.step === 'candidate-best' && event.message.includes('Porto -> Madrid -> Dubai')));
  });

  it('preserves destination stay days when replacing Porto to Dubai with a transfer', async () => {
    clearFlightPriceCache();
    const originalSerpApiKey = process.env.SERPAPI_KEY;
    const originalTravelpayoutsToken = process.env.TRAVELPAYOUTS_TOKEN;
    const originalYandexKey = process.env.YANDEX_RASP_API_KEY;
    const originalFetch = globalThis.fetch;
    process.env.SERPAPI_KEY = 'test-serpapi-key';
    delete process.env.TRAVELPAYOUTS_TOKEN;
    delete process.env.YANDEX_RASP_API_KEY;

    const routePrices = new Map([
      ['OPO-DXB-2026-05-20', 426],
      ['OPO-MAD-2026-05-21', 23],
      ['MAD-DXB-2026-05-21', 254],
      ['OPO-BCN-2026-05-20', 30],
      ['BCN-DXB-2026-05-20', 320],
      ['DXB-MOW-2026-05-23', 520],
      ['MOW-KGD-2026-06-06', 97],
      ['GDN-OPO-2026-06-13', 249]
    ]);
    const events = [];
    globalThis.fetch = async (url) => {
      const params = new URL(url).searchParams;
      const route = [
        params.get('departure_id'),
        params.get('arrival_id'),
        params.get('outbound_date')
      ].join('-');
      const price = routePrices.get(route);
      return Response.json({
        best_flights: price ? [{ price, flights: [{ airline: 'Test Air' }] }] : [],
        search_metadata: { id: `search-${route}` }
      });
    };

    const quote = await quoteFlightPrices(
      {
        legs: [
          { from: 'Porto', to: 'Dubai', departOn: '2026-05-20', arriveBy: '2026-05-20', mode: 'flight', stayHoursAfter: 72, stayDaysAfter: 3 },
          { from: 'Dubai', to: 'Moscow', departOn: '2026-05-23', mode: 'flight' },
          { from: 'Moscow', to: 'Kaliningrad', departOn: '2026-06-06', mode: 'flight' },
          { from: 'Kaliningrad', to: 'Gdansk', departOn: '2026-06-13', mode: 'bus' },
          { from: 'Gdansk', to: 'Porto', departOn: '2026-06-13', mode: 'flight' }
        ]
      },
      { onProgress: (event) => events.push(event) }
    );

    globalThis.fetch = originalFetch;
    restoreEnv('SERPAPI_KEY', originalSerpApiKey);
    restoreEnv('TRAVELPAYOUTS_TOKEN', originalTravelpayoutsToken);
    restoreEnv('YANDEX_RASP_API_KEY', originalYandexKey);
    clearFlightPriceCache();

    assert.equal(quote.totalAmount, 1216);
    assert.deepEqual(quote.optimization.selectedRoute, ['Porto', 'Barcelona', 'Dubai']);
    assert.equal(quote.optimizedRouteLegs[1].to, 'Dubai');
    assert.equal(quote.optimizedRouteLegs[1].stayDaysAfter, 3);
    assert.equal(quote.optimizedRouteLegs[2].from, 'Dubai');
    assert.equal(quote.optimizedRouteLegs[2].departOn, '2026-05-23');
    assert.ok(events.some((event) => event.step === 'candidate-skip' && event.details?.reason === 'stay-time'));
  });

  it('replaces a missing Europe to Porto return price with a priced fallback hub route', async () => {
    clearFlightPriceCache();
    const originalSerpApiKey = process.env.SERPAPI_KEY;
    const originalTravelpayoutsToken = process.env.TRAVELPAYOUTS_TOKEN;
    const originalYandexKey = process.env.YANDEX_RASP_API_KEY;
    const originalFetch = globalThis.fetch;
    delete process.env.SERPAPI_KEY;
    process.env.TRAVELPAYOUTS_TOKEN = 'test-aviasales-token';
    delete process.env.YANDEX_RASP_API_KEY;

    const routePrices = new Map([
      ['GDN-WAW', 40],
      ['WAW-OPO', 90],
      ['GDN-MAD', 120],
      ['MAD-OPO', 80]
    ]);
    const events = [];
    globalThis.fetch = async (url) => {
      const params = new URL(url).searchParams;
      const route = `${params.get('origin')}-${params.get('destination')}`;
      const price = routePrices.get(route);
      return Response.json({
        success: true,
        data: price ? [{ price, currency: 'usd', airline: 'Test Air', search_id: `search-${route}` }] : []
      });
    };

    const quote = await quoteFlightPrices(
      { legs: [{ from: 'Gdansk', to: 'Porto', departOn: '2026-06-13', mode: 'flight' }] },
      { onProgress: (event) => events.push(event) }
    );

    globalThis.fetch = originalFetch;
    restoreEnv('SERPAPI_KEY', originalSerpApiKey);
    restoreEnv('TRAVELPAYOUTS_TOKEN', originalTravelpayoutsToken);
    restoreEnv('YANDEX_RASP_API_KEY', originalYandexKey);
    clearFlightPriceCache();

    assert.equal(quote.totalAmount, 130);
    assert.deepEqual(quote.fallback.selectedRoute, ['Gdansk', 'Warsaw', 'Porto']);
    assert.deepEqual(quote.optimizedRouteLegs.map((leg) => `${leg.from}-${leg.to}`), ['Gdansk-Warsaw', 'Warsaw-Porto']);
    assert.ok(events.some((event) => event.step === 'fallback-start'));
    assert.ok(events.some((event) => event.step === 'fallback-complete'));
  });
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
