import { expect, test } from '@playwright/test';

const tripState = {
  origin: 'Porto',
  stops: [
    { id: 'dubai', city: 'Dubai', visitBefore: '2026-06-01', stayDays: 3 },
    { id: 'moscow', city: 'Moscow', visitBefore: '', stayDays: 14 },
    { id: 'kaliningrad', city: 'Kaliningrad', visitBefore: '', stayDays: 7 }
  ],
  startDate: '2026-05-20',
  passengers: 1,
  lockOrder: false
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript((state) => {
    localStorage.setItem('microwave-travel:trip-state:v1', JSON.stringify(state));
  }, tripState);
});

test('prices the Porto route with date-flex transfer options', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('Pricing result')).toBeVisible();
  await expect(page.getByLabel('Passengers')).toHaveValue('1');
  await expect(page.getByText('Optimized Porto to Dubai via Madrid on 2026-05-21 (+1d flex).')).toBeVisible();
  await expect(page.getByText('Porto to Madrid')).toBeVisible();
  await expect(page.getByText('Madrid to Dubai')).toBeVisible();
  await expect(page.getByText('Dubai to Moscow')).toBeVisible();
  await expect(page.getByText('2026-05-24 · flight')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ryanair (FR)' })).toHaveAttribute('href', 'https://www.ryanair.com/');
  await expect(page.getByRole('link', { name: 'Pegasus Airlines (PC)' })).toHaveAttribute('href', 'https://www.flypgs.com/');
  await expect(page.getByText('Bags: Small cabin bag included; checked bag costs extra.')).toBeVisible();
  await expect(page.getByText('Bags: Cabin bag included; checked baggage depends on fare.')).toBeVisible();
  const transferSearchUrl = await page.getByRole('link', { name: 'Search transfer route' }).first().getAttribute('href');
  const transferSearchParams = new URL(transferSearchUrl);
  expect(transferSearchParams.searchParams.get('segments[0][origin_iata]')).toBe('OPO');
  expect(transferSearchParams.searchParams.get('segments[1][destination_iata]')).toBe('DXB');
  expect(transferSearchParams.searchParams.get('adults')).toBe('1');
  await expect(page.getByText('Stay 3 days in Dubai')).toBeVisible();
  await expect(page.locator('.summary-strip > div', { hasText: 'Price' }).getByText('$1,127', { exact: true })).toBeVisible();

  const selectedTransfer = page.getByRole('button', { name: /Porto -> Madrid -> Dubai/i });
  await expect(selectedTransfer).toContainText('$277');
  await expect(selectedTransfer).toContainText('2026-05-21 (+1d)');
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
  await page.getByLabel('Start and return city').fill('');
  await page.getByRole('button', { name: 'Optimize route' }).click();
  await expect(page.getByText('Choose a starting city.')).toBeVisible();
});

test('includes Saint Petersburg in city suggestions', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#city-options option[value="Saint Petersburg"]')).toHaveCount(1);
});
