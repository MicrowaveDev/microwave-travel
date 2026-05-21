# Algorithm Regression Log

Last updated: 2026-05-21

This document records route-optimization and pricing-search regressions that appeared while changing the algorithm. Update it whenever a new regression is discovered or fixed, so future algorithm changes can check known failure patterns before repeating them.

## How To Use This Log

- Read this file before changing route ordering, transfer insertion, provider fallback, date-flex search, route intelligence, or return-leg recovery.
- Add a new entry when a regression is reported, even if the fix is small.
- Each entry should include the affected scenario, what changed, why it broke, the user-visible impact, the fix, and the regression tests that protect it.
- Keep entries factual and short enough to scan during future implementation work.

## 2026-05-21: Repeated Route Analysis Replayed Cached Candidates

### Scenario

The same Porto route was priced several times within one hour after provider results had already been written to SQLite.

### Symptom

The log showed many cached Aviasales leg hits, but repeated analysis still felt slow because the optimizer replayed transfer/date/stay and fallback candidate evaluation on every run.

### Triggering Change

Leg-level SQLite caching was added before full route-analysis caching. Later date-flex and stay-flex work increased the number of candidate combinations that could be replayed.

### Root Cause

The cache only stored individual provider leg results. It did not store:

- Final route-analysis results.
- Candidate transfer/fallback leg bundles.
- Provider quota/rate-limit disablement across requests.

### User-Visible Impact

Repeated searches spent time walking the same candidate graph even when most provider responses came from cache. SerpApi quota exhaustion could also be checked again on each new request.

### Fix

- Add full route-analysis caching keyed by normalized legs, requirements, passengers, and pricing config.
- Add candidate/fallback/tail bundle caching.
- Persist provider quota/rate-limit disablement briefly in SQLite.
- Batch-load cached provider quotes for each leg.
- Compact duplicate partial route options after ranking.

### Regression Coverage

Added API and provider tests covering:

- Full route-analysis cache reuse on repeated price requests.
- Persisted SerpApi quota disablement across repeated route analyses.

## 2026-05-21: Saint Petersburg Was Routed Through Gdansk Before Kaliningrad

### Scenario

Route included Saint Petersburg and Kaliningrad, for example:

- Origin/return: Porto.
- Stops include Saint Petersburg and Kaliningrad.
- The displayed route contained `Saint Petersburg -> Gdansk -> Kaliningrad`.

### Symptom

The optimizer inserted:

- `Saint Petersburg -> Gdansk` as a flight.
- `Gdansk -> Kaliningrad` as a bus/ground transfer.

This was nonsensical because Saint Petersburg to Kaliningrad should remain a Russian domestic flight candidate. The Gdansk ground-transfer workaround is intended for non-Russian approaches to Kaliningrad, not for Russian mainland cities.

### Triggering Change

Saint Petersburg support was added as a city alias, coordinate, IATA mapping, and route hint. The existing Kaliningrad/Gdansk transfer logic still treated only Moscow as Russian mainland.

### Root Cause

`isRussianMainland(city)` was hardcoded to:

```js
return city === 'Moscow';
```

After Saint Petersburg was added, the transfer expansion code still saw it as a non-mainland city:

```js
if (current === 'Kaliningrad' && previous !== 'Gdansk' && !isRussianMainland(previous)) {
  expanded.push('Gdansk');
}
```

So `Saint Petersburg -> Kaliningrad` incorrectly matched the external-to-Kaliningrad rule.

### User-Visible Impact

- Route cards showed an unnecessary international detour through Gdansk.
- Pricing attempted or displayed a pointless `Saint Petersburg -> Gdansk` leg.
- The route looked less trustworthy because it violated obvious geography and trip intent.

### Fix

Replace the hardcoded Moscow-only check with a data-backed mainland set:

```js
const RUSSIAN_MAINLAND_CITIES = new Set(['Moscow', 'Saint Petersburg']);

function isRussianMainland(city) {
  return RUSSIAN_MAINLAND_CITIES.has(city);
}
```

### Regression Coverage

Added `server/optimizer.test.js` coverage:

- `does not route Saint Petersburg to Kaliningrad through Gdansk`

The expected route is:

- `Saint Petersburg -> Kaliningrad`
- `Kaliningrad -> Saint Petersburg`

No Gdansk transfer should be inserted for this domestic Russian mainland/Kaliningrad pair.

### Future Guardrail

When adding any new city that belongs to a special routing category, update the category data and tests together. Examples:

- Russian mainland cities.
- Kaliningrad/Gdansk ground-transfer cities.
- Europe return hubs.
- Popular transfer hubs.
- Provider-specific Russian direction detection.

Avoid hardcoded single-city checks for category rules. Prefer named sets or tables that make future additions visible.

## 2026-05-21: Extra Stay Days Were Not Compared After A Transfer Replacement

### Scenario

Route input included:

- Origin/return: Porto.
- Stops: Dubai 1 day, Moscow 3 days, Saint Petersburg 7 days, Kaliningrad 7 days.
- Dubai visit-before date: 2026-05-29.
- Trip start: 2026-05-20.
- Locked stop order.

### Symptom

Pricing selected a Porto to Dubai transfer arriving on 2026-05-26, then kept the requested one-day Dubai stay and priced `Dubai -> Moscow` on 2026-05-27. The UI did not show an option to stay one extra day in Dubai and depart to Moscow on 2026-05-28, even though that can materially change the downstream fare.

### Triggering Change

Date-flex search shifted the transfer and the rest of the itinerary as a block. It preserved the requested stay duration but did not create explicit extra-stay variants.

### Root Cause

`quoteShiftedTailForDateOffset()` was called only with the transfer date offset. The tail was never re-priced with `offsetDays + extraStayDays`, so downstream fares one day later were invisible to the optimizer and to transfer option buttons.

### User-Visible Impact

- The displayed route looked like the best valid route, but a nearby downstream departure date was not considered.
- The user could not compare the cost of staying one more day in Dubai.

### Fix

- Add a configurable `POPULAR_ROUTE_STAY_FLEX_DAYS` window, defaulting to 1.
- For each fully priced transfer candidate, quote downstream tail legs with both the preserved stay and the extra-stay variants.
- Keep extra-stay changes explicit in progress messages, route options, and copied logs.
- Rank comparable options by full-trip total when available, with transfer price as the fallback comparison.

### Regression Coverage

Added `server/flight-prices.test.js` coverage:

- `compares adding one extra destination stay day when downstream fares are cheaper`

The test proves a `+1d stay` option can beat the same transfer with the originally requested stay when `Dubai -> Moscow` is cheaper one day later.

### Future Guardrail

When a pricing optimization changes an upstream arrival date, evaluate whether the next outbound leg should have explicit stay-flex variants. Do not silently mutate stay duration; show the extra stay in options and logs.

## 2026-05-21: Extra-Stay Variants Were Hidden In The Itinerary

### Scenario

Route input included:

- Origin/return: Porto.
- Stops: Dubai 1 day, Moscow 3 days, Saint Petersburg 7 days, Kaliningrad 7 days.
- Dubai visit-before date: 2026-05-29.
- Trip start: 2026-05-20.
- Locked stop order.

### Symptom

The copied log contained a `+1d in Dubai` candidate for the selected `Porto -> Vienna -> Dubai` transfer, but the itinerary only displayed `Stay 1 day in Dubai`. The user could not tell whether the +1 day option had been checked or whether it was equal in price.

### Triggering Change

Stay-flex candidates were added to pricing and transfer route options, but the itinerary stay separator remained static text.

### Root Cause

Two UI issues combined:

- Transfer option keys used only route and departure date, so same-route same-date variants with different `stayFlexDays` could collide in Vue rendering.
- The stay separator did not render the stay-flex variants tied to the active transfer option.

### User-Visible Impact

- A checked but incomplete or more expensive +1 day option looked like it was missing.
- The user had to inspect copied logs to confirm whether the optimizer considered nearby stay durations.

### Fix

- Include `dateShiftDays`, `stayFlexDays`, transfer price, and trip price in transfer option keys.
- Render stay-option buttons beside the affected stay separator for the active transfer route.
- Show full-trip price when available, otherwise mark the option as a partial trip and show the transfer price.

### Regression Coverage

Updated `tests/e2e/porto-route.spec.js` to require visible Dubai stay-option buttons, including the `+1d` variant.

### Future Guardrail

Whenever candidate options differ by a dimension that is not visible in the main route label, include that dimension in both the DOM key and the user-facing option text.

## 2026-05-21: Partial Stay-Flex Options Did Not Complete On Selection

### Scenario

Route input included:

- Origin/return: Porto.
- Stops: Dubai 1 day, Moscow 3 days, Saint Petersburg 7 days, Kaliningrad 7 days.
- Dubai visit-before date: 2026-05-29.
- Trip start: 2026-05-20.
- Locked stop order.

### Symptom

Selecting the `+1d` Dubai stay option updated the itinerary to show the later `Dubai -> Moscow` flight, but the option still read `Partial trip · $259 transfer`. The visible route looked mostly priced, so the label did not explain what was missing.

### Triggering Change

Stay-flex options were exposed in the itinerary without a follow-up exact-route pricing step.

### Root Cause

The initial route-option snapshot was built before return fallback recovery for that specific shifted itinerary. The selected `+1d` option moved the final `Gdansk -> Porto` date, so the fallback that completed the default-stay option could not be reused.

### User-Visible Impact

- The user could see a cheaper downstream leg after selecting `+1d`, but could not compare the full route total.
- “Partial trip” was technically correct but not actionable.

### Fix

- Add `exactRouteOnly` pricing mode that quotes the selected itinerary and still runs missing Porto-return fallback, without starting another transfer search.
- When the user selects a partial transfer or stay-flex option, request exact pricing for that option and replace the option snapshot with the completed quote when available.
- Show a temporary `Completing trip...` label while the selected option is being expanded.

### Regression Coverage

Added `server/flight-prices.test.js` coverage:

- `prices an exact selected route without running transfer optimization`

The test proves an exact selected route can complete a missing Europe-to-Porto return through fallback without re-entering transfer optimization.

### Future Guardrail

Candidate cards can be partial during the broad search, but selecting one should either complete the exact route or show the specific remaining missing leg.

## 2026-05-21: Visit-Before Slack Was Not Used For Leading Transfer Price Search

### Scenario

Route input included:

- Origin/return: Porto.
- Stops: Dubai 1 day, Moscow 3 days, Saint Petersburg 7 days, Kaliningrad 7 days.
- Dubai visit-before date: 2026-05-29.
- Trip start: 2026-05-20.
- Locked stop order.

### Symptom

Pricing selected a Porto to Dubai transfer on 2026-05-22 and reported it as the optimized option. The log said:

```text
Comparing 16 Porto to Dubai route options across 5 dates.
```

That meant the app only checked the default leading date-flex window around 2026-05-20, not the whole valid window through the Dubai before-2026-05-29 constraint.

### Triggering Change

Date-flex transfer search had been added as a fixed plus/minus window. Later visit-before constraints were displayed and validated in route optimization, but those requirements were not sent to the price-search endpoint.

### Root Cause

The frontend called `/api/prices/stream` with only route legs:

```js
body: JSON.stringify({ legs: routePlan.legs })
```

`quoteFlightPrices()` therefore could not know that Dubai was allowed later than the original 2026-05-20 route date. `popularRouteDateChoices()` only used `POPULAR_ROUTE_DATE_FLEX_DAYS`, so it produced five dates: original, plus/minus one day, and plus/minus two days.

### User-Visible Impact

- The UI implied the 2026-05-22 transfer was the best found option.
- Later valid dates before 2026-05-29 were not checked, so a cheaper ticket could be missed.
- The copied log did not make clear that the visit-before slack had not been used.

### Fix

- Send route requirements to `/api/prices/stream`.
- Normalize requirements inside pricing.
- For leading transfer replacements into a destination with a `before` rule, extend positive date choices through the latest valid date before the deadline.
- Reject candidate arrivals that would miss the destination `before` requirement.
- Keep route-intelligence pruning so lower-priority routes do not receive full-window live checks.

### Regression Coverage

Added coverage:

- `tests/unit/date-utils.test.js`: `extends leading date-flex choices through a visit-before window`
- `server/flight-prices.test.js`: `searches leading transfer dates through the destination visit-before window`

The pricing regression test proves a cheaper 2026-05-25 Porto to Dubai transfer can beat the default-window 2026-05-21 option when Dubai is allowed before 2026-05-29.

### Future Guardrail

When pricing logic depends on route-level constraints, confirm those constraints are passed from the optimizer response into the pricing request. Logs should make the resulting search window visible with `dateCount`, selected date, and skipped date-constraint diagnostics.
