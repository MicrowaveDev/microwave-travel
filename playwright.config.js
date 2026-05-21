import { defineConfig, devices } from '@playwright/test';

const apiPort = 3455;
const clientPort = 5174;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: {
    timeout: 20_000
  },
  use: {
    baseURL: `http://127.0.0.1:${clientPort}`,
    trace: 'on-first-retry'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  webServer: [
    {
      command: `PORT=${apiPort} FLIGHT_PRICE_FIXTURE_FILE=tests/fixtures/porto-route-prices.json FLIGHT_PRICE_CACHE_DB=/tmp/microwave-travel-e2e-cache.sqlite SERPAPI_KEY=fixture-serpapi-key TRAVELPAYOUTS_TOKEN=fixture-aviasales-token npm run start`,
      url: `http://127.0.0.1:${apiPort}/api/health`,
      reuseExistingServer: false,
      timeout: 30_000
    },
    {
      command: `VITE_API_PROXY_TARGET=http://127.0.0.1:${apiPort} npm run client -- --port ${clientPort} --strictPort`,
      url: `http://127.0.0.1:${clientPort}`,
      reuseExistingServer: false,
      timeout: 30_000
    }
  ]
});
