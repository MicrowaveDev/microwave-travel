import cors from 'cors';
import express from 'express';
import { optimizeTrip } from './optimizer.js';

const app = express();
const port = process.env.PORT || 3444;

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

app.listen(port, () => {
  console.log(`Microwave Travel API listening on http://127.0.0.1:${port}`);
});
