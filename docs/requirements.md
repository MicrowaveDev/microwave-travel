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
- Passenger count, defaulting to one adult passenger.

The app returns:

- An optimized route with dates, modes, durations, and distances.
- Stay separators between route legs.
- Flight price estimates when providers return USD fares.
- Airline name and official website link for each priced flight when the carrier can be resolved.
- Baggage allowance text for each flight from provider data or the curated local airline/fare database, with an explicit check-fare-rules note when no rule is known.
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
- Rank transfer hubs with route intelligence before making live provider calls.
- Consider nearby departure dates within the configured date-flex window.
- If selecting a shifted transfer date, shift downstream itinerary dates by the same offset so stay durations remain intact.
- If Gdansk to Porto is unpriced, try configured Europe return hubs.

## Functional Requirements

### Trip Input

- The user can enter a start/return city.
- The user can add, remove, and reorder stops.
- Each stop can include a visit-before date and a stay duration in days.
- The user can choose whether to keep stop order locked.
- The user can set the number of passengers from 1 to 9.
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
- Display the operating/marketing airline carrier returned by the provider for each priced leg.
- Resolve known carrier codes to readable airline names and official airline websites; keep unknown carrier text visible without inventing a link.
- Display baggage allowance per flight leg from normalized provider data.
- When a provider does not return baggage allowance, use the curated local SQLite baggage database if the carrier/fare type can be resolved.
- The local baggage database must store carrier, fare type, summary, cabin/checked allowance, official source URL, last-updated date, and notes in SQLite.
- The checked-in baggage JSON file is seed data only; runtime lookup and agent updates must read/write SQLite.
- Local baggage entries are fallback hints only; the UI must still tell users to verify exact fare rules before booking.
- Agents can add missing local baggage entries with `npm run baggage:lookup -- --carrier <IATA> [--fare <type>]` and `npm run baggage:add -- --carrier <IATA> --fare <type> --summary "..." --cabin "..." --checked "..." --url "<official airline URL>"`.

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
- Rank transfer candidates using route intelligence before live pricing.
- Candidate routes must have every leg priced before they can replace the displayed route.
- Candidate buttons must show the transfer-segment price, not necessarily the whole-trip price.
- Candidate options should be sorted by transfer-segment price.
- Skipped candidates should be available as compact diagnostics, not displayed as selectable route options.

### Route Intelligence

- Maintain a lightweight built-in route intelligence table for common transfer legs.
- Each route hint can include a typical USD price, an expense ratio, and common airline/carrier hints.
- Use route intelligence only to order and limit live searches; provider-returned prices remain authoritative.
- Search all transfer candidates on the primary departure date so an unexpected cheap route is not fully hidden.
- Apply full date-flex pricing only to the highest-ranked candidates by default.
- Lower-ranked candidates may skip extra date-flex days, but should be recorded in skipped diagnostics with a route-intelligence reason.
- The route intelligence limit must be configurable with `PRICE_ROUTE_INTELLIGENCE_LIMIT`.
- Route intelligence must have unit tests for estimation, ordering, and skipped low-priority route reporting.

### Date Flexibility

- Popular transfer search must consider nearby departure dates, currently controlled by `POPULAR_ROUTE_DATE_FLEX_DAYS`.
- Default date flex is plus/minus 2 days.
- For leading transfer replacements into a stop with a `before` requirement, pricing must receive the route requirements and extend positive date-flex choices through the latest valid arrival date before that requirement.
- Extended visit-before date search must still use route-intelligence pruning so low-priority routes do not receive unnecessary live checks across the whole window.
- When a shifted transfer candidate is selected, shift downstream itinerary dates by the same number of days.
- Stay durations must remain intact after shifting dates.
- Shifted options should show their date offset, for example `2026-05-22 (+2d)`.
- The algorithm may choose a shifted date when the original date has no price or when the shifted date is materially cheaper.
- For transfer replacements into a stop with a following outbound leg, also compare a small configurable extra-stay window, currently `POPULAR_ROUTE_STAY_FLEX_DAYS`, so options like staying one more day in Dubai can surface cheaper downstream fares.
- Extra-stay options must be explicit in route options and logs; they must not silently change the user's requested stay.

### Return-Leg Recovery

- If a Europe to Porto return leg has no price, try configured fallback hubs.
- Select the cheapest fully priced fallback route.
- Preserve any earlier transfer optimization and skipped-candidate diagnostics when applying a return fallback.

### Booking/Search Links

- Priced flight legs should include prefilled Aviasales search links.
- Connected transfer flight legs should prefer a whole-transfer Aviasales search link over a single-leg link.
- Single-leg search links remain a fallback when there is no connected transfer group.
- If `TRAVELPAYOUTS_MARKER` is configured, links should include the affiliate marker.
- Booking links are search/affiliate links, not guaranteed discounts.
- Transfer booking links must use Aviasales multi-city segment parameters so they open the whole transfer route, not just the first leg.
- Booking links must pass the selected passenger count as the shared adult passenger parameter.
- The UI must not imply that an unpriced leg has a confirmed fare.

### Logs And Diagnostics

- The price panel should show a concise pricing status.
- While pricing is still running, the displayed itinerary and price summary should update to the current best fully comparable transfer or fallback option when a new best candidate is found.
- Interim best-route updates must be replaced by better candidates or by the final quote once pricing completes.
- The user can expand/collapse recent progress logs.
- The user can copy a full price-search log.
- Copied logs should include trip input, displayed route, price result, provider attempts, priced legs, optimized options, skipped options, and progress events.
- Skipped transfer attempts should explain whether they were skipped for missing prices or date/stay constraints.
- Live progress should default to compact comparison logs, not one event per internal candidate leg/provider/cache hit.
- Verbose comparison progress should be available for debugging with `PRICE_COMPARE_PROGRESS_DETAIL=verbose`.

## Non-Functional Requirements

- Avoid unnecessary API calls through caching, provider disabling, early pruning, route intelligence, compact progress, and grouped diagnostics.
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
- `POPULAR_ROUTE_STAY_FLEX_DAYS`: Extra destination stay days to compare after a transfer replacement. Defaults to 1.
- `PRICE_ROUTE_INTELLIGENCE_LIMIT`: Number of ranked transfer routes that receive full date-flex live pricing. Lower-ranked routes still get primary-date checks.
- `PRICE_COMPARE_PROGRESS_DETAIL`: Use `compact` by default; set to `verbose` to emit per-candidate comparison/provider/cache progress events.
- `BAGGAGE_ALLOWANCE_DB`: Optional SQLite database path for curated baggage rules. Defaults to `data/baggage-allowances.sqlite`.

## Verification Requirements

Before changing route ordering, transfer insertion, provider fallback, date-flex search, route intelligence, or return-leg recovery, review [algorithm-regressions.md](algorithm-regressions.md). When a new algorithm regression appears, add an entry there with the symptom, cause, fix, and regression coverage.

Run before handoff:

```bash
npm test
npm run build
npm run test:route:porto
npm run test:e2e
```

Run the whole local regression bundle:

```bash
npm run test:all
```

Use live providers only when needed:

```bash
npm run test:route:porto -- --live
```

Live mode spends provider requests and can vary with provider cache state.

## Known Limitations

- The route optimizer uses a small built-in city and route dataset.
- Route intelligence is a curated heuristic table, not a live fare prediction model.
- Flight prices are provider estimates and may not match final checkout.
- Aviasales may return no fare for a route/date even when flights exist.
- Ground transfers, border rules, visas, sanctions, airspace restrictions, and baggage are not automatically validated.
- Date-flex currently shifts downstream dates as a block; it does not yet optimize each later stop independently.

## Future Requirements

- Let users configure date-flex tolerance in the UI.
- Show a concise reason when date-flex shifts the itinerary.
- Add hard latest/earliest constraints per stop, not only visit-before.
- Consider provider batch endpoints when available.
- Learn route intelligence hints from cached historical quotes instead of only static data.
- Add route safety checks for border and airspace risk.
- Add richer booking-link attribution and discount/referral metadata when a provider supplies it.
