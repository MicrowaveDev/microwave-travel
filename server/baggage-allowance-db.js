import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import seedData from '../data/baggage-allowances.seed.json' with { type: 'json' };
import { normalizeCarrierCode } from './airlines.js';

const DEFAULT_BAGGAGE_DB_PATH = join(process.cwd(), 'data', 'baggage-allowances.sqlite');

let baggageDb = null;
let baggageDbPath = null;

export function findBaggageAllowanceEntries(carrier) {
  const code = normalizeCarrierCode(carrier);
  if (!code) return [];
  return getBaggageAllowanceDb()
    .prepare(`
      SELECT
        carrier,
        fare_type AS fareType,
        summary,
        cabin,
        checked,
        source_url AS sourceUrl,
        updated_at AS updatedAt,
        notes
      FROM baggage_allowances
      WHERE carrier = ?
      ORDER BY fare_type
    `)
    .all(code);
}

export function baggageAllowanceEntries() {
  return getBaggageAllowanceDb()
    .prepare(`
      SELECT
        carrier,
        fare_type AS fareType,
        summary,
        cabin,
        checked,
        source_url AS sourceUrl,
        updated_at AS updatedAt,
        notes
      FROM baggage_allowances
      ORDER BY carrier, fare_type
    `)
    .all();
}

export function upsertBaggageAllowanceEntry(entry) {
  const carrier = normalizeCarrierCode(entry.carrier);
  const fareType = normalizeFareType(entry.fareType);
  if (!carrier) throw new Error('Baggage allowance carrier must be a two-character IATA code.');
  if (!fareType) throw new Error('Baggage allowance fare type is required.');
  getBaggageAllowanceDb()
    .prepare(`
      INSERT INTO baggage_allowances (
        carrier,
        fare_type,
        summary,
        cabin,
        checked,
        source_url,
        updated_at,
        notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(carrier, fare_type) DO UPDATE SET
        summary = excluded.summary,
        cabin = excluded.cabin,
        checked = excluded.checked,
        source_url = excluded.source_url,
        updated_at = excluded.updated_at,
        notes = excluded.notes
    `)
    .run(
      carrier,
      fareType,
      entry.summary || '',
      entry.cabin || '',
      entry.checked || '',
      entry.sourceUrl || '',
      entry.updatedAt || new Date().toISOString().slice(0, 10),
      entry.notes || ''
    );
}

export function closeBaggageAllowanceDb() {
  if (baggageDb) {
    baggageDb.close();
    baggageDb = null;
    baggageDbPath = null;
  }
}

export function seedBaggageAllowances({ replace = false } = {}) {
  const db = getBaggageAllowanceDb();
  if (replace) {
    db.prepare('DELETE FROM baggage_allowances').run();
  }
  const existingCount = db.prepare('SELECT COUNT(*) AS count FROM baggage_allowances').get().count;
  if (!replace && existingCount > 0) return { inserted: 0, skipped: existingCount };

  const entries = seedData.entries || [];
  for (const entry of entries) upsertBaggageAllowanceEntry(entry);
  return { inserted: entries.length, skipped: 0 };
}

function getBaggageAllowanceDb() {
  const databasePath = process.env.BAGGAGE_ALLOWANCE_DB || DEFAULT_BAGGAGE_DB_PATH;
  if (baggageDb && baggageDbPath === databasePath) return baggageDb;

  closeBaggageAllowanceDb();
  mkdirSync(dirname(databasePath), { recursive: true });
  baggageDb = new DatabaseSync(databasePath);
  baggageDbPath = databasePath;
  baggageDb.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS baggage_allowances (
      carrier TEXT NOT NULL,
      fare_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      cabin TEXT NOT NULL DEFAULT '',
      checked TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (carrier, fare_type)
    );
    CREATE INDEX IF NOT EXISTS idx_baggage_allowances_carrier
      ON baggage_allowances (carrier);
  `);
  seedBaggageAllowances();
  return baggageDb;
}

function normalizeFareType(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
