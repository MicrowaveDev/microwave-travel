import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DEFAULT_CACHE_DB_PATH = join(process.cwd(), 'data', 'flight-price-cache.sqlite');

let cacheDb = null;
let cacheDbPath = null;

export function getCachedFlightPrice(cacheKey) {
  const row = getCacheDb()
    .prepare('SELECT quote_json AS quoteJson, expires_at AS expiresAt FROM flight_price_cache WHERE cache_key = ?')
    .get(cacheKey);
  if (!row) return null;

  if (Number(row.expiresAt) <= Date.now()) {
    deleteCachedFlightPrice(cacheKey);
    return null;
  }

  return JSON.parse(row.quoteJson);
}

export function setCachedFlightPrice(cacheKey, provider, leg, quote, expiresAt) {
  getCacheDb()
    .prepare(`
      INSERT INTO flight_price_cache (
        cache_key,
        provider,
        origin,
        destination,
        departure_date,
        currency,
        passenger_count,
        quote_json,
        expires_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        provider = excluded.provider,
        origin = excluded.origin,
        destination = excluded.destination,
        departure_date = excluded.departure_date,
        currency = excluded.currency,
        passenger_count = excluded.passenger_count,
        quote_json = excluded.quote_json,
        expires_at = excluded.expires_at,
        created_at = excluded.created_at
    `)
    .run(
      cacheKey,
      provider,
      leg.origin,
      leg.destination,
      leg.departureDate,
      'USD',
      Number(leg.passengers) || 1,
      JSON.stringify(quote),
      expiresAt,
      Date.now()
    );
}

export function deleteCachedFlightPrice(cacheKey) {
  getCacheDb().prepare('DELETE FROM flight_price_cache WHERE cache_key = ?').run(cacheKey);
}

export function clearCachedFlightPrices() {
  getCacheDb().prepare('DELETE FROM flight_price_cache').run();
}

export function closeFlightPriceCache() {
  if (cacheDb) {
    cacheDb.close();
    cacheDb = null;
    cacheDbPath = null;
  }
}

function getCacheDb() {
  const databasePath = process.env.FLIGHT_PRICE_CACHE_DB || DEFAULT_CACHE_DB_PATH;
  if (cacheDb && cacheDbPath === databasePath) return cacheDb;

  closeFlightPriceCache();
  mkdirSync(dirname(databasePath), { recursive: true });
  cacheDb = new DatabaseSync(databasePath);
  cacheDbPath = databasePath;
  cacheDb.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS flight_price_cache (
      cache_key TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      origin TEXT NOT NULL,
      destination TEXT NOT NULL,
      departure_date TEXT NOT NULL,
      currency TEXT NOT NULL,
      passenger_count INTEGER NOT NULL,
      quote_json TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_flight_price_cache_expires_at
      ON flight_price_cache (expires_at);
  `);
  cacheDb.prepare('DELETE FROM flight_price_cache WHERE expires_at <= ?').run(Date.now());
  return cacheDb;
}
