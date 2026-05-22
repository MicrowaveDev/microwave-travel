import { expect, test } from '@playwright/test';

const tripState = {
  origin: 'Porto',
  stops: [
    { id: 'dubai', city: 'Dubai', visitBefore: '2026-06-01', stayDays: 3 },
    { id: 'moscow', city: 'Moscow', visitBefore: '', stayDays: 14 },
    { id: 'kaliningrad', city: 'Kaliningrad', visitBefore: '', stayDays: 7 },
    // Explicit return stop — start city no longer auto-loops back.
    { id: 'porto-return', city: 'Porto', visitBefore: '', stayDays: 0 }
  ],
  startDate: '2026-05-20',
  passengers: 1,
  // Porto is in stops as the explicit return — lock so the optimizer
  // doesn't reorder Porto into the middle.
  lockOrder: true
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript((state) => {
    localStorage.setItem('microwave-travel:trip-state:v1', JSON.stringify(state));
  }, tripState);
});

test('prices the Porto route with date-flex transfer options', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('Pricing result')).toBeVisible({ timeout: 50_000 });
  await expect(page.getByLabel('Passengers')).toHaveValue('1');
  await expect(page.getByText('Optimized Porto to Dubai via Madrid on 2026-05-21 (+1d flex).')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Porto.*Madrid/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Madrid.*Dubai/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Dubai.*Moscow/ })).toBeVisible();
  const dubaiToMoscow = page.locator('.leg-card', { has: page.getByRole('heading', { name: /Dubai.*Moscow/ }) });
  await expect(dubaiToMoscow.locator('.leg-strip-end').first().locator('.leg-code')).toHaveText('DXB');
  await expect(dubaiToMoscow.locator('.leg-strip-end').last().locator('.leg-code')).toHaveText('MOW');
  await expect(dubaiToMoscow.locator('.leg-date').first()).toContainText('May 24');

  const portoToMadrid = page.locator('.leg-card', { has: page.getByRole('heading', { name: /Porto.*Madrid/ }) });
  await expect(portoToMadrid.locator('.leg-strip-end').first().locator('.leg-time')).toContainText('13:30');
  // 13:30 +01:00 + 130 min = 14:40 UTC = 16:40 Europe/Madrid (CEST)
  await expect(portoToMadrid.locator('.leg-strip-end').last().locator('.leg-time')).toContainText('16:40');
  await expect(portoToMadrid.locator('.leg-duration')).toContainText('Direct');

  const madridToDubai = page.locator('.leg-card', { has: page.getByRole('heading', { name: /Madrid.*Dubai/ }) });
  await expect(madridToDubai.locator('.leg-duration')).toContainText('1 stop');
  await expect(page.getByRole('link', { name: 'Ryanair (FR)' })).toHaveAttribute('href', 'https://www.ryanair.com/');
  await expect(page.getByRole('link', { name: 'Pegasus Airlines (PC)' })).toHaveAttribute('href', 'https://www.flypgs.com/');
  for (const summary of await page.locator('.leg-details > summary').all()) {
    await summary.click();
  }
  await expect(page.getByText('Bags: Small cabin bag included; checked bag costs extra.')).toBeVisible();
  await expect(page.getByText('Bags: Cabin bag included; checked baggage depends on fare.')).toBeVisible();
  const transferSearchUrl = await page.getByRole('link', { name: 'Search transfer route' }).first().getAttribute('href');
  const transferSearchParams = new URL(transferSearchUrl);
  expect(transferSearchParams.searchParams.get('segments[0][origin_iata]')).toBe('OPO');
  expect(transferSearchParams.searchParams.get('segments[1][destination_iata]')).toBe('DXB');
  expect(transferSearchParams.searchParams.get('adults')).toBe('1');
  await expect(page.getByText('Stay 3 days in Dubai')).toBeVisible();
  await expect(page.locator('.summary-strip > div', { hasText: 'Price' }).getByText('$1,127', { exact: true })).toBeVisible();

  const selectedTransfer = page.getByRole('button', { name: /Porto -> Madrid -> Dubai.*\(\+1d date\)$/i });
  await expect(selectedTransfer).toContainText('$277');
  await expect(selectedTransfer).toContainText('2026-05-21 (+1d date)');
  await expect(page.getByRole('button', { name: /Porto -> Madrid -> Dubai.*\+1d stay/i })).toBeVisible();
  const dubaiStayOptions = page.getByLabel('Dubai stay options');
  await expect(dubaiStayOptions.getByRole('button', { name: /3 days in Dubai.*\$520 Dubai -> Moscow/i })).toBeVisible();
  await expect(dubaiStayOptions.getByRole('button', { name: /\+1d: 4 days in Dubai.*No Dubai -> Moscow price/i })).toBeVisible();
});

test('keeps skipped transfer diagnostics compact and copyable', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.transfer-options button.skipped')).toHaveCount(0);
  const skippedSummary = page.getByText(/Skipped transfer searches/);
  await expect(skippedSummary).toBeVisible();
  await skippedSummary.click();
  await expect(page.getByText('Not enough priced legs to compare.').first()).toBeVisible();

  await page.getByRole('button', { name: 'Copy log' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
});

test('shows validation feedback from the optimize endpoint', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Start city').fill('');
  await page.getByRole('button', { name: 'Optimize route' }).click();
  await expect(page.getByText('Choose a starting city.')).toBeVisible();
});

test('includes Saint Petersburg in city suggestions', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#city-options option[value="Saint Petersburg"]')).toHaveCount(1);
});
