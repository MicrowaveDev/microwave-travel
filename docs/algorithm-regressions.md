# Algorithm Regression Log

Last updated: 2026-05-21

This document records route-optimization and pricing-search regressions that appeared while changing the algorithm. Update it whenever a new regression is discovered or fixed, so future algorithm changes can check known failure patterns before repeating them.

## How To Use This Log

- Read this file before changing route ordering, transfer insertion, provider fallback, date-flex search, route intelligence, or return-leg recovery.
- Add a new entry when a regression is reported, even if the fix is small.
- Each entry should include the affected scenario, what changed, why it broke, the user-visible impact, the fix, and the regression tests that protect it.
- Keep entries factual and short enough to scan during future implementation work.

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
