import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clearFlightPriceCache, quoteFlightPrices } from './flight-prices.js';

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
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
