# Microwave Travel Agent Guide

## Scope

These instructions apply to the `microwave-travel` app.

## Module Map

Use this to jump straight to the file that owns a concern instead of grepping the whole tree. Every listed file also has a short banner comment at the top describing its responsibility.

### Frontend ([src/](src/))

- [src/App.vue](src/App.vue) — top-level page: planner form, route summary, transfer/stay-flex panels, price-log panel. Holds the reactive refs (`origin`, `stops`, `plan`, `priceQuote`, `priceProgress`, …) and orchestrates `optimize()` / `fetchPrices()` / `selectTransferOption()` / `selectStayFlexOption()`.
- [src/LegCard.vue](src/LegCard.vue) — one numbered route-leg card (header, IATA strip, airline + baggage chips, baggage details). Pure component; takes `index`, `leg`, `pricedLeg`, `booking`, `priceError` as props. Renders `HH:MM · date` on each side of the strip when `pricedLeg.departureAt` / `arrivalAt` are set (falls back to date-only when null). The middle of the strip shows `Direct` when `pricedLeg.stopCount === 0`. With stops, the hub prefix is `Via Istanbul Sabiha Gökçen (SAW) · ` when `hubInferred` is false, `Likely via Istanbul Sabiha Gökçen (SAW) · ` when `hubInferred` is true (Aviasales path). The trailing layover bracket is `(Xh Ym)` when known precisely (from `flightSegments`) or `(~Xh Ym)` when estimated from `total − distance/800 km/h`. The displayed total duration is `arrivalAt − departureAt` when both are valid, falling back to `leg.hours` (the optimizer's static estimate) only when no priced timestamps are available.
- [src/lib/leg-time.js](src/lib/leg-time.js) — `formatMinutesLabel`, `elapsedMinutes`, `totalLayoverMinutes` (precise, from segments), `estimateLayoverMinutes` (rough, from distance/speed; only returns ≥ 30 min). Shared by `LegCard.vue`.
- [src/lib/trip-state.js](src/lib/trip-state.js) — `localStorage` round-trip plus `createStop` / `defaultTripState` / `normalizeStayDaysInput` / `normalizePassengerCountInput`.
- [src/lib/trip-input-changes.js](src/lib/trip-input-changes.js) — `snapshotTripInput` + `describeTripInputChanges` for the input-change log.
- [src/lib/pricing-log.js](src/lib/pricing-log.js) — `buildPricingLog` text builder + `copyLogWithFallback`.
- [src/styles.css](src/styles.css) — thin entry that `@import`s the topic files in cascade order.
- [src/styles/base.css](src/styles/base.css) — root tokens, body, form-control defaults, app-shell grid, responsive breakpoints.
- [src/styles/planner.css](src/styles/planner.css) — left planner panel (route editor, stop rows, move/icon buttons).
- [src/styles/results.css](src/styles/results.css) — right results panel (summary strip, route map, price panel, progress log, provider attempts).
- [src/styles/transfer.css](src/styles/transfer.css) — transfer-option buttons, skipped diagnostics, stay-separator + stay-options.
- [src/styles/legs.css](src/styles/legs.css) — `.legs` container only; leg-card styles live scoped inside `LegCard.vue`.

### Backend ([server/](server/))

- [server/app.js](server/app.js), [server/index.js](server/index.js) — Express app + entry point.
- [server/optimizer.js](server/optimizer.js) — route ordering (`buildLegsForRoute`); decides which city order to fly, before pricing.
- [server/date-utils.js](server/date-utils.js) — date arithmetic for departure/arrival/flex date generation.
- [server/iata-codes.js](server/iata-codes.js) — city-name → IATA mapping (`CITY_IATA_CODES`), IATA → `{ city, airport, zone }` (`IATA_AIRPORTS`, with `IATA_TIMEZONES` derived from it), and carrier IATA → home-hub IATA (`CARRIER_HUBS`). Helpers: `isRussianDirection`, `sameCityName`, `arrivalIsoInZone` (compute arrival wall-clock in the destination zone from `departureAt + durationMinutes`), `airportLabel` (renders "City Airport" or just "City"), and `inferLikelyHub` (guesses the connecting hub from the carrier for providers that don't expose it). **Add new cities here**, including IANA timezone, airport name (or `null`), and a `CARRIER_HUBS` entry if a new carrier has a clearly dominant hub.
- [server/airlines.js](server/airlines.js) — carrier-code → airline info (name + website).
- [server/baggage-allowances.js](server/baggage-allowances.js), [server/baggage-allowance-db.js](server/baggage-allowance-db.js) — local SQLite baggage rules (see "Baggage Allowance Curation" below).
- [server/route-intelligence.js](server/route-intelligence.js) — ranks transfer-route candidates so the search tries cheaper hubs first.
- [server/flight-price-cache.js](server/flight-price-cache.js) — SQLite-backed price/bundle/route-analysis cache + disabled-provider state.
- [server/flight-prices.js](server/flight-prices.js) — **the route-optimization brain.** Exports `quoteFlightPrices`. Contains `quoteNormalizedLegs`, `optimizePopularTransferRoute`, `recoverMissingPortoReturnLeg`, and their direct helpers (`buildOptimizedRouteOption`, `compareCandidates`, `pruneDatesForTailStay`, `copyStayToReplacement`, `routeAnalysisCacheKey`, `legBundleCacheKey`, `priceCacheConfig`, `normalizeLegs`, `normalizePassengerCount`). **Behavior changes here must update [docs/algorithm-regressions.md](docs/algorithm-regressions.md).**
- [server/flight-prices/providers.js](server/flight-prices/providers.js) — per-leg upstream HTTP clients: `quoteLegWithSerpApi`, `quoteLegWithTravelpayouts`, `quoteLegWithDuffel`, `quoteLegWithYandexRasp`, plus `tryProvider`, `getAmadeusToken`. **Add a new price provider here**, then register it in the `providers` cascade in `leg-quoter.js`. Each provider populates these optional priced-leg fields when the upstream supports them:
  - `departureAt` / `arrivalAt` (ISO strings in origin/destination local time). Aviasales returns only `departureAt`; arrival is computed via `arrivalIsoInZone` using `IATA_TIMEZONES`.
  - `stopCount` (0 = direct, ≥1 = number of intermediate stops), `hubCode` (first connecting airport IATA, when the provider exposes it; Aviasales falls back to `inferLikelyHub` from the carrier), `hubLabel` (human label like "Istanbul Sabiha Gökçen"), and `hubInferred` (true when `hubCode` came from the carrier-hub guess rather than the provider).
  - `flightSegments` (array of `{ origin, destination, departingAt, arrivingAt }`) when the upstream returns per-segment data — Duffel and SerpApi do; Aviasales `prices_for_dates` does not. LegCard uses these to compute and display the layover duration.
  - Whenever the priced-leg shape gains a new field, bump the three cache versions: `routeAnalysisCacheKey.version` + `legBundleCacheKey.version` in `flight-prices.js`, and the trailing tag in `legQuoteCacheKey` in `leg-quoter.js`. Old cache entries without the new field would otherwise resurface stale shapes.
- [server/flight-prices/leg-quoter.js](server/flight-prices/leg-quoter.js) — `quoteLeg`: provider cascade + SQLite cache + progress events + rate-limit disable.
- [server/flight-prices/quote-normalize.js](server/flight-prices/quote-normalize.js) — `normalizeQuote`: wires airline metadata, baggage fallback, booking links, and the priced summary onto raw provider legs. This is what the optimization brain calls to "score" a candidate.
- [server/flight-prices/baggage-from-offer.js](server/flight-prices/baggage-from-offer.js) — extract baggage allowance from a provider offer's loose JSON; falls back to the local SQLite rules.
- [server/flight-prices/booking-links.js](server/flight-prices/booking-links.js) — Aviasales search URLs (single + multi-segment) on priced legs.
- [server/flight-prices/popular-hubs.js](server/flight-prices/popular-hubs.js) — `PORTO_DUBAI_TRANSFER_HUBS` and `PORTO_RETURN_FALLBACK_HUBS`, plus `findPopularRouteTarget` / `popularTransferRoutes` / `isReplaceablePopularRoute`. **Add a new transfer hub here** and register its IATA in `iata-codes.js`.
- [server/flight-prices/progress.js](server/flight-prices/progress.js) — `emitProgress` + provider progress messages; `PRICE_COMPARE_PROGRESS_DETAIL` env controls verbosity.
- [server/flight-prices/provider-state.js](server/flight-prices/provider-state.js) — per-search disabled-provider bookkeeping.
- [server/flight-prices/provider-labels.js](server/flight-prices/provider-labels.js) — human-readable provider labels + `configuredProviders`.
- [server/flight-prices/cache-keys.js](server/flight-prices/cache-keys.js) — stable cache-key hashing, `cacheableLeg`, `cloneQuote`, `markQuote*FromCache`.
- [server/flight-prices/route-options.js](server/flight-prices/route-options.js) — `compactRouteOptions`, `buildSkippedRouteOption`, `formatStayFlex`, `formatCandidatePrice`.
- [server/flight-prices/money.js](server/flight-prices/money.js) — `roundMoney`, `addHoursToDate`, `formatStayDays`.

### Common change recipes

- **Add a new city as a planner stop:** add it to `cityOptions` in [src/App.vue](src/App.vue), and add the IATA mapping in [server/iata-codes.js](server/iata-codes.js).
- **Add a new price provider:** add `quoteLegWith<Name>(leg)` in [server/flight-prices/providers.js](server/flight-prices/providers.js), register it in the `providers` cascade in [server/flight-prices/leg-quoter.js](server/flight-prices/leg-quoter.js), and add its label in [server/flight-prices/provider-labels.js](server/flight-prices/provider-labels.js).
- **Adjust baggage chip text/colors on the card:** [src/LegCard.vue](src/LegCard.vue) (`legBaggageChips` derivation + `.leg-chip--*` scoped styles).
- **Tweak baggage rules for a carrier:** see "Baggage Allowance Curation" below; the runtime path is [server/flight-prices/baggage-from-offer.js](server/flight-prices/baggage-from-offer.js).
- **Change the route-optimization algorithm:** [server/flight-prices.js](server/flight-prices.js); read [docs/algorithm-regressions.md](docs/algorithm-regressions.md) first.

## Algorithm Regression Log

Route optimization and pricing-search changes must keep [docs/algorithm-regressions.md](docs/algorithm-regressions.md) up to date.

When a new regression is found or fixed:

- Add an entry with the date, symptom, triggering change, root cause, user-visible impact, fix, and regression coverage.
- Include the smallest route scenario that reproduces the issue.
- Add or update automated tests when practical, and reference those tests in the entry.
- If the regression reveals a broader algorithm rule, update [docs/requirements.md](docs/requirements.md) in the same change.

Before changing route ordering, transfer insertion, provider fallback, date-flex search, route intelligence, or fallback-route recovery:

- Read the existing regression log.
- Check whether the change touches any documented failure pattern.
- Preserve the documented expectations unless the product requirement has intentionally changed.

## Baggage Allowance Curation

Use the local SQLite baggage database when the UI shows a priced flight with an airline/carrier but no useful baggage allowance from providers. The checked-in baggage JSON is seed data only; runtime lookups and agent updates should go through SQLite.

Agent flow:

1. Identify the carrier code and fare/ticket type shown or implied in the UI, logs, fixture, or provider payload. If no fare type is known, use the airline's lowest/default public economy fare only when the source clearly documents it.
2. Check the local database first:

   ```bash
   npm run baggage:lookup -- --carrier <IATA> [--fare <type>]
   ```

3. If the entry is missing or stale, open the airline's official baggage or fare-family page. Prefer official airline pages over blogs, aggregators, forums, or screenshots. Do not add rules from unofficial sources unless the user explicitly asks for a temporary note, and mark that note as unverified.
4. Add or replace the database entry with the official source URL:

   ```bash
   npm run baggage:add -- --carrier <IATA> --fare <type> --summary "..." --cabin "..." --checked "..." --url "<official airline URL>" --notes "Verify exact route and fare rules before booking."
   ```

5. Keep baggage summaries conservative. Say what is usually included and what depends on route/fare. Do not imply a confirmed allowance for the user's exact ticket unless the provider returned that exact allowance.
6. If a fresh local database is needed, import the checked-in seed data with `npm run baggage:import-seed`. Use `-- --replace true` only when intentionally resetting the local baggage database.
7. Run `npm test` after changing baggage data or baggage resolution code. Run `npm run test:e2e` too if visible itinerary text changes.

## Verification

For route algorithm or pricing behavior changes, run the relevant focused test plus the default verification:

```bash
npm test
npm run build
```

Run `npm run test:route:porto` and `npm run test:e2e` when the change affects the canonical Porto route, transfer options, pricing logs, or visible itinerary cards.
