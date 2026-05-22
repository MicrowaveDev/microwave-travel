import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../../server/app.js';
import { clearFlightPriceCache, closeFlightPriceCacheDb } from '../../server/flight-prices.js';
import { installFixtureFetch } from '../../server/test-fixture-fetch.js';
import fixture from '../fixtures/porto-route-prices.json' with { type: 'json' };

const tripInput = {
  origin: 'Porto',
  // Porto is an explicit final stop so this regression keeps testing the
  // round-trip + return-leg recovery after auto-return-to-origin was
  // dropped from the optimizer.
  stops: ['Dubai', 'Moscow', 'Kaliningrad', 'Porto'],
  stopDetails: [
    { city: 'Dubai', stayDays: 3 },
    { city: 'Moscow', stayDays: 14 },
    { city: 'Kaliningrad', stayDays: 7 },
    { city: 'Porto', stayDays: 0 }
  ],
  requirements: [{ city: 'Dubai', type: 'before', date: '2026-06-01' }],
  startDate: '2026-05-20',
  // Lock the order — Porto now appears as both origin and final stop,
  // so without lockOrder the optimizer would reorder Porto out of the
  // tail and skip the Kaliningrad → Gdansk → Porto return leg.
  lockOrder: true
};

const originalEnv = {
  SERPAPI_KEY: process.env.SERPAPI_KEY,
  TRAVELPAYOUTS_TOKEN: process.env.TRAVELPAYOUTS_TOKEN,
  YANDEX_RASP_API_KEY: process.env.YANDEX_RASP_API_KEY,
  FLIGHT_PRICE_CACHE_DB: process.env.FLIGHT_PRICE_CACHE_DB
};
const cacheDir = mkdtempSync(join(tmpdir(), 'microwave-travel-api-'));
let server;
let baseUrl;
let restoreFetch;

before(async () => {
  process.env.SERPAPI_KEY = 'fixture-serpapi-key';
  process.env.TRAVELPAYOUTS_TOKEN = 'fixture-aviasales-token';
  delete process.env.YANDEX_RASP_API_KEY;
  process.env.FLIGHT_PRICE_CACHE_DB = join(cacheDir, 'flight-cache.sqlite');
  restoreFetch = installFixtureFetch(fixture);
  clearFlightPriceCache();
  server = createApp().listen(0);
  await new Promise((resolveListen) => server.once('listening', resolveListen));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  restoreFetch?.();
  await new Promise((resolveClose) => server.close(resolveClose));
  closeFlightPriceCacheDb();
  restoreEnv('SERPAPI_KEY', originalEnv.SERPAPI_KEY);
  restoreEnv('TRAVELPAYOUTS_TOKEN', originalEnv.TRAVELPAYOUTS_TOKEN);
  restoreEnv('YANDEX_RASP_API_KEY', originalEnv.YANDEX_RASP_API_KEY);
  restoreEnv('FLIGHT_PRICE_CACHE_DB', originalEnv.FLIGHT_PRICE_CACHE_DB);
  rmSync(cacheDir, { recursive: true, force: true });
});

describe('travel API endpoints', () => {
  it('reports health', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  });

  it('returns validation errors for invalid optimization input', async () => {
    const response = await fetch(`${baseUrl}/api/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin: '', stops: [] })
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /starting city/i);
  });

  it('optimizes the canonical Porto trip', async () => {
    const plan = await postJson('/api/optimize', tripInput);
    assert.equal(plan.legs[0].from, 'Porto');
    assert.equal(plan.legs[0].to, 'Dubai');
    assert.equal(plan.legs[0].stayDaysAfter, 3);
    assert.ok(plan.legs.some((leg) => leg.mode === 'bus' && leg.from === 'Kaliningrad' && leg.to === 'Gdansk'));
  });

  it('prices with fixture providers and applies date-flex transfer optimization', async () => {
    const plan = await postJson('/api/optimize', tripInput);
    const quote = await postJson('/api/prices', { legs: plan.legs });
    assert.equal(quote.totalAmount, 1127);
    assert.deepEqual(quote.optimization.selectedRoute, ['Porto', 'Madrid', 'Dubai']);
    assert.equal(quote.optimization.dateShiftDays, 1);
    assert.equal(quote.optimizedRouteLegs.find((leg) => leg.from === 'Dubai' && leg.to === 'Moscow').departOn, '2026-05-24');
    assert.ok(quote.attempts.some((attempt) => attempt.provider === 'serpapi' && attempt.ok === false));
    assert.ok(quote.attempts.some((attempt) => attempt.provider === 'aviasales' && attempt.ok === true));
  });

  it('streams pricing progress and final quote as NDJSON', async () => {
    const plan = await postJson('/api/optimize', tripInput);
    const response = await fetch(`${baseUrl}/api/prices/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legs: plan.legs })
    });
    assert.equal(response.status, 200);
    const lines = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
    assert.ok(lines.some((line) =>
      line.type === 'progress' &&
      (line.event.step === 'compare-start' || line.event.step === 'pricing-cache-hit')
    ));
    assert.ok(lines.filter((line) => line.type === 'progress').length < 120);
    assert.ok(!lines.some((line) => line.type === 'progress' && line.event.details?.phase === 'Compare option'));
    const result = lines.find((line) => line.type === 'result');
    assert.equal(result.quote.optimization.dateShiftDays, 1);
  });

  it('reuses cached full route analysis for repeated price requests', async () => {
    clearFlightPriceCache();
    const plan = await postJson('/api/optimize', tripInput);
    await postJson('/api/prices', { legs: plan.legs });
    const response = await fetch(`${baseUrl}/api/prices/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legs: plan.legs })
    });
    assert.equal(response.status, 200);
    const lines = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
    assert.ok(lines.some((line) => line.type === 'progress' && line.event.step === 'pricing-cache-hit'));
    assert.ok(!lines.some((line) => line.type === 'progress' && line.event.step === 'compare-start'));
    const result = lines.find((line) => line.type === 'result');
    assert.equal(result.quote.cached, true);
    assert.equal(result.quote.cacheType, 'route-analysis');
    assert.equal(result.quote.totalAmount, 1127);
  });
});

async function postJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  assert.equal(response.status, 200);
  return response.json();
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
