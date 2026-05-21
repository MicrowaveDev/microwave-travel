# Microwave Travel Requirements

Last updated: 2026-05-21

## Purpose

Microwave Travel helps a traveler turn rough multi-stop trip requirements into a bookable itinerary candidate. It should optimize route order, preserve required stays, price flight legs with available providers, and explain clearly when a provider cannot quote a leg.

The app is a planning aid, not a booking engine. It may link to booking/search pages, but final price, ticket rules, baggage, visa, border, and schedule constraints must be verified before purchase.

## Primary User Story

A user enters:

- Start and return city.
- Ordered or flexible list of stops.
- Days to spend in each stop.
- Visit-before constraints.
- Trip start date.

The app returns:

- An optimized route with dates, modes, durations, and distances.
- Stay separators between route legs.
- Flight price estimates when providers return USD fares.
- Transfer alternatives for expensive or unpriced popular route segments.
- A log explaining provider attempts, cache hits, skipped candidates, and selected replacements.

## Example Regression Trip

The canonical regression trip is:

- Origin/return: Porto.
- Stops: Dubai 3 days, Moscow 14 days, Kaliningrad 7 days.
- Dubai must be visited before 2026-06-01.
- Start date: 2026-05-20.
- Lock order: false.

Expected behavior:

- Preserve the requested 3 days in Dubai before the next outbound leg.
- Use the Kaliningrad/Gdansk ground transfer where applicable.
- If direct Porto to Dubai is unpriced or expensive, search popular transfer hubs.
- Consider nearby departure dates within the configured date-flex window.
- If selecting a shifted transfer date, shift downstream itinerary dates by the same offset so stay durations remain intact.
- If Gdansk to Porto is unpriced, try configured Europe return hubs.

## Functional Requirements

### Trip Input

- The user can enter a start/return city.
- The user can add, remove, and reorder stops.
- Each stop can include a visit-before date and a stay duration in days.
- The user can choose whether to keep stop order locked.
- Inputs are saved locally so page reloads preserve the last trip.

### Route Optimization

- Normalize common city names and IATA-like aliases.
- Support repeated stops without collapsing intentional repeated visits.
- Choose a route order that minimizes estimated travel time when order is unlocked.
- Respect visit-before requirements where possible and show warnings when missed.
- Insert ground transfers for Kaliningrad/Gdansk border routing where required.
- Add `departOn`, `arriveBy`, `stayHoursAfter`, and `stayDaysAfter` to route legs.
- Display stay duration as text between cards, not as another leg card.

### Flight Pricing

- Price only flight legs; bus/ground legs are shown as manual-check items.
- Return all price amounts in USD.
- Use provider-specific route/date/passenger/currency cache keys.
- Cache successful price results and provider-level no-price results for one hour.
- Do not cache missing credentials or transient provider failures.
- Display partial price results when not every flight leg has a USD fare.

### Provider Priority And Fallback

- For non-Russian directions, try SerpApi Google Flights first, then Aviasales.
- For Russian directions, try Aviasales first, then Yandex Rasp, then SerpApi.
- If SerpApi returns quota/rate-limit exhaustion, disable SerpApi for the rest of the current pricing run.
- If a provider is disabled during a run, later legs should skip it without making further network requests.
- Aviasales can be used as fallback, but it may return only cached/aggregated fares and can legitimately return no USD price for a route/date.
- Provider attempts should be grouped in the UI to avoid repeated duplicate badges.

### Popular Transfer Search

- Search popular transfer alternatives for replaceable Porto/Dubai and Dubai/Porto segments.
- Include the direct route as a candidate.
- Candidate routes must have every leg priced before they can replace the displayed route.
- Candidate buttons must show the transfer-segment price, not necessarily the whole-trip price.
- Candidate options should be sorted by transfer-segment price.
- Skipped candidates should be available as compact diagnostics, not displayed as selectable route options.

### Date Flexibility

- Popular transfer search must consider nearby departure dates, currently controlled by `POPULAR_ROUTE_DATE_FLEX_DAYS`.
- Default date flex is plus/minus 2 days.
- When a shifted transfer candidate is selected, shift downstream itinerary dates by the same number of days.
- Stay durations must remain intact after shifting dates.
- Shifted options should show their date offset, for example `2026-05-22 (+2d)`.
- The algorithm may choose a shifted date when the original date has no price or when the shifted date is materially cheaper.

### Return-Leg Recovery

- If a Europe to Porto return leg has no price, try configured fallback hubs.
- Select the cheapest fully priced fallback route.
- Preserve any earlier transfer optimization and skipped-candidate diagnostics when applying a return fallback.

### Booking/Search Links

- Priced flight legs should include prefilled Aviasales search links.
- If `TRAVELPAYOUTS_MARKER` is configured, links should include the affiliate marker.
- Booking links are search/affiliate links, not guaranteed discounts.
- The UI must not imply that an unpriced leg has a confirmed fare.

### Logs And Diagnostics

- The price panel should show a concise pricing status.
- The user can expand/collapse recent progress logs.
- The user can copy a full price-search log.
- Copied logs should include trip input, displayed route, price result, provider attempts, priced legs, optimized options, skipped options, and progress events.
- Skipped transfer attempts should explain whether they were skipped for missing prices or date/stay constraints.

## Non-Functional Requirements

- Avoid unnecessary API calls through caching, provider disabling, early pruning, and grouped diagnostics.
- Preserve enough diagnostics to understand why no route was selected.
- Keep the UI dense and operational rather than marketing-style.
- Do not hide partial results when pricing is incomplete.
- Keep tests able to run without live API quota by default.

## Configuration

- `SERPAPI_KEY`: Enables SerpApi Google Flights.
- `TRAVELPAYOUTS_TOKEN`: Enables Aviasales/Travelpayouts price lookup.
- `TRAVELPAYOUTS_MARKER`: Optional affiliate marker for Aviasales search links.
- `YANDEX_RASP_API_KEY`: Enables Yandex Rasp schedule fallback.
- `FLIGHT_PRICE_CACHE_DB`: Optional SQLite cache path.
- `POPULAR_ROUTE_SEARCH_DAYS`: Search-day count for non-flex popular-route checks.
- `POPULAR_ROUTE_DATE_FLEX_DAYS`: Date-flex radius for popular transfer pricing.

## Verification Requirements

Run before handoff:

```bash
npm test
npm run build
npm run test:route:porto
```

Use live providers only when needed:

```bash
npm run test:route:porto -- --live
```

Live mode spends provider requests and can vary with provider cache state.

## Known Limitations

- The route optimizer uses a small built-in city and route dataset.
- Flight prices are provider estimates and may not match final checkout.
- Aviasales may return no fare for a route/date even when flights exist.
- Ground transfers, border rules, visas, sanctions, airspace restrictions, and baggage are not automatically validated.
- Date-flex currently shifts downstream dates as a block; it does not yet optimize each later stop independently.

## Future Requirements

- Let users configure date-flex tolerance in the UI.
- Show a concise reason when date-flex shifts the itinerary.
- Add hard latest/earliest constraints per stop, not only visit-before.
- Consider provider batch endpoints when available.
- Add route safety checks for border and airspace risk.
- Add richer booking-link attribution and discount/referral metadata when a provider supplies it.
