# Microwave Travel Agent Guide

## Scope

These instructions apply to the `microwave-travel` app.

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

## Verification

For route algorithm or pricing behavior changes, run the relevant focused test plus the default verification:

```bash
npm test
npm run build
```

Run `npm run test:route:porto` and `npm run test:e2e` when the change affects the canonical Porto route, transfer options, pricing logs, or visible itinerary cards.
