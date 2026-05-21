import cors from 'cors';
import express from 'express';
import { quoteFlightPrices } from './flight-prices.js';
import { optimizeTrip } from './optimizer.js';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_request, response) => {
    response.json({ ok: true });
  });

  app.post('/api/optimize', (request, response) => {
    try {
      response.json(optimizeTrip(request.body || {}));
    } catch (error) {
      response.status(400).json({ error: error.message });
    }
  });

  app.post('/api/prices', async (request, response) => {
    try {
      response.json(await quoteFlightPrices(request.body || {}));
    } catch (error) {
      response.status(400).json({ error: error.message });
    }
  });

  app.post('/api/prices/stream', async (request, response) => {
    response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('X-Accel-Buffering', 'no');

    const writeEvent = (event) => {
      response.write(`${JSON.stringify({ type: 'progress', event })}\n`);
    };

    try {
      const quote = await quoteFlightPrices(request.body || {}, { onProgress: writeEvent });
      response.write(`${JSON.stringify({ type: 'result', quote })}\n`);
      response.end();
    } catch (error) {
      response.write(`${JSON.stringify({ type: 'error', error: error.message })}\n`);
      response.end();
    }
  });

  return app;
}
