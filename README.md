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
YANDEX_RASP_API_KEY=...
```

If no keys are configured, the app still optimizes routes, but the price panel will show that provider credentials are needed.

Flight provider responses are cached in memory per leg for one hour, keyed by provider, route, departure date, passenger count, and currency. Successful prices and provider-level "no result" responses are cached; missing credentials and other provider failures are not cached.

## Verify

```bash
npm test
npm run build
```
