import 'dotenv/config';
import { clearFlightPriceCache, quoteFlightPrices } from '../server/flight-prices.js';
import { optimizeTrip } from '../server/optimizer.js';

const useLiveProviders = process.argv.includes('--live');
const shouldPrintJson = process.argv.includes('--json');

const tripInput = {
  origin: 'Porto',
  stops: ['Dubai', 'Moscow', 'Kaliningrad'],
  stopDetails: [
    { city: 'Dubai', stayDays: 3 },
    { city: 'Moscow', stayDays: 14 },
    { city: 'Kaliningrad', stayDays: 7 }
  ],
  requirements: [{ city: 'Dubai', date: '2026-06-01' }],
  startDate: '2026-05-20',
  lockOrder: false
};

const mockRoutePrices = new Map([
  ['OPO-DXB-2026-05-20', 426],
  ['OPO-DXB-2026-05-21', 378],
  ['OPO-MAD-2026-05-21', 23],
  ['MAD-DXB-2026-05-21', 254],
  ['OPO-ATH-2026-05-20', 110],
  ['ATH-DXB-2026-05-20', 237],
  ['OPO-BCN-2026-05-20', 30],
  ['BCN-DXB-2026-05-20', 320],
  ['OPO-ROM-2026-05-20', 40],
  ['ROM-DXB-2026-05-20', 338],
  ['OPO-MIL-2026-05-20', 47],
  ['MIL-DXB-2026-05-20', 332],
  ['OPO-WAW-2026-05-20', 108],
  ['WAW-DXB-2026-05-20', 299],
  ['OPO-IST-2026-05-20', 144],
  ['IST-DXB-2026-05-20', 276],
  ['OPO-BEG-2026-05-20', 107],
  ['BEG-DXB-2026-05-20', 326],
  ['OPO-ZRH-2026-05-20', 114],
  ['ZRH-DXB-2026-05-20', 388],
  ['OPO-AMS-2026-05-20', 99],
  ['AMS-DXB-2026-05-20', 427],
  ['OPO-LIS-2026-05-20', 116],
  ['LIS-DXB-2026-05-20', 415],
  ['OPO-PAR-2026-05-20', 85],
  ['PAR-DXB-2026-05-20', 456],
  ['DXB-MOW-2026-05-23', 520],
  ['DXB-MOW-2026-05-24', 520],
  ['MOW-KGD-2026-06-06', 97],
  ['MOW-KGD-2026-06-07', 97],
  ['GDN-LIS-2026-06-13', 171],
  ['LIS-OPO-2026-06-13', 62],
  ['GDN-LIS-2026-06-14', 171],
  ['LIS-OPO-2026-06-14', 62]
]);

const originalEnv = {
  SERPAPI_KEY: process.env.SERPAPI_KEY,
  TRAVELPAYOUTS_TOKEN: process.env.TRAVELPAYOUTS_TOKEN,
  YANDEX_RASP_API_KEY: process.env.YANDEX_RASP_API_KEY
};
const originalFetch = globalThis.fetch;

try {
  if (!useLiveProviders) installMockProviders();
  clearFlightPriceCache();

  const plan = optimizeTrip(tripInput);
  const progress = [];
  const quote = await quoteFlightPrices(
    { legs: plan.legs, requirements: plan.requirements },
    { onProgress: (event) => progress.push(event) }
  );
  if (!useLiveProviders) assertMockScenario(quote);

  if (shouldPrintJson) {
    console.log(JSON.stringify({ tripInput, plan, quote, progress }, null, 2));
  } else {
    printScenarioSummary(plan, quote, progress);
  }
} finally {
  globalThis.fetch = originalFetch;
  restoreEnv('SERPAPI_KEY', originalEnv.SERPAPI_KEY);
  restoreEnv('TRAVELPAYOUTS_TOKEN', originalEnv.TRAVELPAYOUTS_TOKEN);
  restoreEnv('YANDEX_RASP_API_KEY', originalEnv.YANDEX_RASP_API_KEY);
  clearFlightPriceCache();
}

function installMockProviders() {
  process.env.SERPAPI_KEY = 'mock-serpapi-key';
  process.env.TRAVELPAYOUTS_TOKEN = 'mock-travelpayouts-token';
  delete process.env.YANDEX_RASP_API_KEY;

  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === 'serpapi.com') {
      return Response.json({ error: 'Your account has run out of searches.' });
    }

    const route = [
      parsed.searchParams.get('origin'),
      parsed.searchParams.get('destination'),
      parsed.searchParams.get('departure_at')
    ].join('-');
    const price = mockRoutePrices.get(route);
    return Response.json({
      success: true,
      data: price
        ? [{ price, currency: 'usd', airline: 'Mock Air', search_id: `mock-${route}` }]
        : []
    });
  };
}

function assertMockScenario(quote) {
  const selectedRoute = quote.optimization?.selectedRoute?.join(' -> ');
  if (selectedRoute !== 'Porto -> Madrid -> Dubai') {
    throw new Error(`Expected Madrid transfer in mock scenario, got ${selectedRoute || 'none'}.`);
  }
  if (quote.optimization?.dateShiftDays !== 1) {
    throw new Error(`Expected +1 day date-flex transfer, got ${quote.optimization?.dateShiftDays ?? 'none'}.`);
  }
  if (quote.totalAmount !== 1127) {
    throw new Error(`Expected mock total $1,127 USD, got ${formatMoney(quote.totalAmount)}.`);
  }
  const shiftedMoscowLeg = quote.optimizedRouteLegs?.find((leg) => leg.from === 'Dubai' && leg.to === 'Moscow');
  if (shiftedMoscowLeg?.departOn !== '2026-05-24') {
    throw new Error(`Expected downstream legs to shift one day, got Dubai -> Moscow on ${shiftedMoscowLeg?.departOn || 'missing'}.`);
  }
}

function printScenarioSummary(plan, quote, progress) {
  console.log(`Mode: ${useLiveProviders ? 'live providers' : 'mock providers'}`);
  console.log(`Route: ${plan.legs.map((leg) => leg.from).concat(plan.legs.at(-1)?.to || []).join(' -> ')}`);
  console.log(`Price: ${formatMoney(quote.totalAmount)} (${quote.pricedLegCount}/${quote.legCount} priced legs)`);
  console.log(`Message: ${quote.message}`);

  if (quote.optimization) {
    console.log('');
    console.log('Selected transfer:');
    console.log(`  ${quote.optimization.selectedRoute.join(' -> ')} on ${quote.optimization.departureDate}`);
    console.log(`  Transfer price: ${formatMoney(quote.optimization.selectedReturnAmount)}`);
  }

  if (quote.optimizedRouteOptions?.length) {
    console.log('');
    console.log('Valid transfer options:');
    for (const option of quote.optimizedRouteOptions) {
      console.log(`  ${option.route.join(' -> ')} | ${option.departureDate} | transfer ${formatMoney(option.amount)} | trip ${formatMoney(option.totalAmount)}`);
    }
  }

  if (quote.optimizedRouteSkippedOptions?.length) {
    console.log('');
    console.log('Skipped transfer options:');
    for (const option of quote.optimizedRouteSkippedOptions) {
      console.log(`  ${option.route.join(' -> ')} | ${option.departureDate} | ${option.reason}: ${option.message}`);
    }
  }

  console.log('');
  console.log(`Progress events: ${progress.length}`);
  const disabledProviders = progress.filter((event) => event.step === 'provider-disabled');
  for (const event of disabledProviders) {
    console.log(`  Disabled ${event.details.provider}: ${event.details.reason}`);
  }
}

function formatMoney(value) {
  return Number.isFinite(value) ? `$${value.toLocaleString()} USD` : 'partial';
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
