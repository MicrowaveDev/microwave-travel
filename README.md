# Microwave Travel

Simple Vue + Node.js travel planner for turning rough trip requirements into an optimized route.

The current optimizer is an MVP: it uses a small built-in city/route heuristic dataset, supports repeated stops, and checks deadline requirements such as `Dubai before 1 June`. It does not call airline, visa, rail, hotel, or live price APIs yet.

## Run

```bash
npm install
npm run dev
```

The Vue app runs through Vite, and the Express API listens on `http://127.0.0.1:3444`.

## Flight Price APIs

The backend uses Amadeus as the primary USD flight-price provider and SerpApi Google Flights as a fallback.

```bash
cp .env.example .env

AMADEUS_CLIENT_ID=...
AMADEUS_CLIENT_SECRET=...
# Optional, defaults to https://test.api.amadeus.com
AMADEUS_BASE_URL=https://test.api.amadeus.com

# Optional fallback
SERPAPI_KEY=...

# Russian/CIS flight fallback and schedule fallback
TRAVELPAYOUTS_TOKEN=...
# Optional Aviasales affiliate marker for booking/search links
TRAVELPAYOUTS_MARKER=...
YANDEX_RASP_API_KEY=...
```

If no keys are configured, the app still optimizes routes, but the price panel will show that provider credentials are needed.

Flight provider responses are cached in SQLite per leg for one hour, keyed by provider, route, departure date, passenger count, and currency. By default the cache is stored at `data/flight-price-cache.sqlite`, so recent results survive app restarts and repeated searches do not burn API limits. Set `FLIGHT_PRICE_CACHE_DB=/path/to/cache.sqlite` to move it. Successful prices and provider-level "no result" responses are cached; missing credentials and other provider failures are not cached.

Priced flight legs include prefilled Aviasales search links. When `TRAVELPAYOUTS_MARKER` is set, those links include the affiliate marker. These are booking/search links, not guaranteed discounts; users should compare the final checkout price before buying.

## Verify

```bash
npm test
npm run build
```

Run the Porto -> Dubai -> Moscow -> Kaliningrad pricing scenario used for regression checks:

```bash
npm run test:route:porto
```

By default this uses mocked provider responses so it does not spend API quota. Add `-- --live` to use configured live providers, or `-- --json` to print the full plan, quote, and progress events.
