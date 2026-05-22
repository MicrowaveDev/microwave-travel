import 'dotenv/config';
import { installFixtureFetchFromEnv } from './test-fixture-fetch.js';
import { createApp } from './app.js';

installFixtureFetchFromEnv();

const port = process.env.PORT || 3464;
const app = createApp();

app.listen(port, () => {
  console.log(`Microwave Travel API listening on http://127.0.0.1:${port}`);
});
