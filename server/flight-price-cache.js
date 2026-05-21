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

export function getCachedFlightPrices(cacheKeys) {
  if (!Array.isArray(cacheKeys) || cacheKeys.length === 0) return new Map();
  const uniqueKeys = [...new Set(cacheKeys)];
  const placeholders = uniqueKeys.map(() => '?').join(', ');
  const rows = getCacheDb()
    .prepare(`SELECT cache_key AS cacheKey, quote_json AS quoteJson, expires_at AS expiresAt FROM flight_price_cache WHERE cache_key IN (${placeholders})`)
    .all(...uniqueKeys);
  const now = Date.now();
  const expiredKeys = [];
  const results = new Map();
  for (const row of rows) {
    if (Number(row.expiresAt) <= now) {
      expiredKeys.push(row.cacheKey);
      continue;
    }
    results.set(row.cacheKey, JSON.parse(row.quoteJson));
  }
  for (const cacheKey of expiredKeys) deleteCachedFlightPrice(cacheKey);
  return results;
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

export function getCachedPriceBundle(cacheKey) {
  const row = getCacheDb()
    .prepare('SELECT bundle_json AS bundleJson, expires_at AS expiresAt FROM price_bundle_cache WHERE cache_key = ?')
    .get(cacheKey);
  if (!row) return null;

  if (Number(row.expiresAt) <= Date.now()) {
    deleteCachedPriceBundle(cacheKey);
    return null;
  }

  return JSON.parse(row.bundleJson);
}

export function setCachedPriceBundle(cacheKey, bundle, expiresAt) {
  getCacheDb()
    .prepare(`
      INSERT INTO price_bundle_cache (
        cache_key,
        bundle_json,
        expires_at,
        created_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        bundle_json = excluded.bundle_json,
        expires_at = excluded.expires_at,
        created_at = excluded.created_at
    `)
    .run(cacheKey, JSON.stringify(bundle), expiresAt, Date.now());
}

export function deleteCachedPriceBundle(cacheKey) {
  getCacheDb().prepare('DELETE FROM price_bundle_cache WHERE cache_key = ?').run(cacheKey);
}

export function getCachedRouteAnalysis(cacheKey) {
  const row = getCacheDb()
    .prepare('SELECT quote_json AS quoteJson, expires_at AS expiresAt FROM route_analysis_cache WHERE cache_key = ?')
    .get(cacheKey);
  if (!row) return null;

  if (Number(row.expiresAt) <= Date.now()) {
    deleteCachedRouteAnalysis(cacheKey);
    return null;
  }

  return JSON.parse(row.quoteJson);
}

export function setCachedRouteAnalysis(cacheKey, quote, expiresAt) {
  getCacheDb()
    .prepare(`
      INSERT INTO route_analysis_cache (
        cache_key,
        quote_json,
        expires_at,
        created_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        quote_json = excluded.quote_json,
        expires_at = excluded.expires_at,
        created_at = excluded.created_at
    `)
    .run(cacheKey, JSON.stringify(quote), expiresAt, Date.now());
}

export function deleteCachedRouteAnalysis(cacheKey) {
  getCacheDb().prepare('DELETE FROM route_analysis_cache WHERE cache_key = ?').run(cacheKey);
}

export function getDisabledProviderReasons() {
  const rows = getCacheDb()
    .prepare('SELECT provider, reason, expires_at AS expiresAt FROM provider_disable_cache WHERE expires_at > ?')
    .all(Date.now());
  return new Map(rows.map((row) => [row.provider, row.reason]));
}

export function setDisabledProviderReason(provider, reason, expiresAt) {
  getCacheDb()
    .prepare(`
      INSERT INTO provider_disable_cache (
        provider,
        reason,
        expires_at,
        created_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(provider) DO UPDATE SET
        reason = excluded.reason,
        expires_at = excluded.expires_at,
        created_at = excluded.created_at
    `)
    .run(provider, reason, expiresAt, Date.now());
}

export function deleteCachedFlightPrice(cacheKey) {
  getCacheDb().prepare('DELETE FROM flight_price_cache WHERE cache_key = ?').run(cacheKey);
}

export function clearCachedFlightPrices() {
  getCacheDb().prepare('DELETE FROM flight_price_cache').run();
  getCacheDb().prepare('DELETE FROM price_bundle_cache').run();
  getCacheDb().prepare('DELETE FROM route_analysis_cache').run();
  getCacheDb().prepare('DELETE FROM provider_disable_cache').run();
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
    CREATE TABLE IF NOT EXISTS price_bundle_cache (
      cache_key TEXT PRIMARY KEY,
      bundle_json TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_price_bundle_cache_expires_at
      ON price_bundle_cache (expires_at);
    CREATE TABLE IF NOT EXISTS route_analysis_cache (
      cache_key TEXT PRIMARY KEY,
      quote_json TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_route_analysis_cache_expires_at
      ON route_analysis_cache (expires_at);
    CREATE TABLE IF NOT EXISTS provider_disable_cache (
      provider TEXT PRIMARY KEY,
      reason TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_provider_disable_cache_expires_at
      ON provider_disable_cache (expires_at);
  `);
  cacheDb.prepare('DELETE FROM flight_price_cache WHERE expires_at <= ?').run(Date.now());
  cacheDb.prepare('DELETE FROM price_bundle_cache WHERE expires_at <= ?').run(Date.now());
  cacheDb.prepare('DELETE FROM route_analysis_cache WHERE expires_at <= ?').run(Date.now());
  cacheDb.prepare('DELETE FROM provider_disable_cache WHERE expires_at <= ?').run(Date.now());
  return cacheDb;
}
