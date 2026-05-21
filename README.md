# Microwave Travel

Simple Vue + Node.js travel planner for turning rough trip requirements into an optimized route.

The current optimizer is an MVP: it uses a small built-in city/route heuristic dataset, supports repeated stops, checks deadline requirements such as `Dubai before 1 June`, and prices flight legs through configured providers when possible.

See [docs/requirements.md](docs/requirements.md) for the product requirements, pricing behavior, provider fallback rules, route intelligence, date-flex transfer search, and verification expectations. Known algorithm regressions and guardrails are tracked in [docs/algorithm-regressions.md](docs/algorithm-regressions.md).

## Run

```bash
npm install
npm run dev
```

The Vue app runs through Vite, and the Express API listens on `http://127.0.0.1:3444`.

## Flight Price APIs

The backend uses SerpApi Google Flights, Aviasales/Travelpayouts, and Yandex Rasp depending on route direction and configured keys. Non-Russian directions try SerpApi first, then Aviasales. Russian directions try Aviasales first, then Yandex Rasp, then SerpApi. SerpApi quota exhaustion disables SerpApi for the rest of the current pricing run so fallback providers can continue without repeated failed calls.

```bash
cp .env.example .env

SERPAPI_KEY=...

TRAVELPAYOUTS_TOKEN=...
# Optional Aviasales affiliate marker for booking/search links
TRAVELPAYOUTS_MARKER=...
YANDEX_RASP_API_KEY=...
```

If no keys are configured, the app still optimizes routes, but the price panel will show that provider credentials are needed.

Flight provider responses are cached in SQLite per leg for one hour, keyed by provider, route, departure date, passenger count, and currency. By default the cache is stored at `data/flight-price-cache.sqlite`, so recent results survive app restarts and repeated searches do not burn API limits. Set `FLIGHT_PRICE_CACHE_DB=/path/to/cache.sqlite` to move it. Successful prices and provider-level "no result" responses are cached; missing credentials and other provider failures are not cached.

Priced flight legs include prefilled Aviasales search links. When `TRAVELPAYOUTS_MARKER` is set, those links include the affiliate marker. These are booking/search links, not guaranteed discounts; users should compare the final checkout price before buying.

Popular Porto/Dubai transfer searches include a small date-flex window. Set `POPULAR_ROUTE_DATE_FLEX_DAYS` to control how many days around the original departure should be considered. When a shifted date wins, the downstream itinerary shifts by the same number of days so stop stays remain intact.

Transfer search is ordered by a small built-in route intelligence table in `server/route-intelligence.js`. It stores typical route prices, expense ratios, and common carrier hints so likely-cheaper transfer routes are searched first. The app still checks every transfer route on the primary date, but low-priority expensive routes skip extra date-flex calls by default. Set `PRICE_ROUTE_INTELLIGENCE_LIMIT` to control how many ranked routes receive full date-flex pricing. Set `PRICE_COMPARE_PROGRESS_DETAIL=verbose` to restore detailed per-candidate provider progress logs for debugging; the default compact mode keeps copied logs small.

## Verify

```bash
npm test
npm run build
npm run test:e2e
```

Run the Porto -> Dubai -> Moscow -> Kaliningrad pricing scenario used for regression checks:

```bash
npm run test:route:porto
```

By default this uses mocked provider responses so it does not spend API quota. Add `-- --live` to use configured live providers, or `-- --json` to print the full plan, quote, and progress events.

For the full local regression pass, including API tests, build, the Porto route fixture, and Playwright UI checks:

```bash
npm run test:all
```
