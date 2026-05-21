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
