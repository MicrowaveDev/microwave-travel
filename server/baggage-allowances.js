import baggageAllowanceData from '../data/baggage-allowances.json' with { type: 'json' };
import { airlineInfoForCarrier, normalizeCarrierCode } from './airlines.js';

const DEFAULT_FARE_TYPES = ['basic', 'light', 'lite', 'discount', 'economy'];

export function baggageAllowanceForCarrier(carrier, options = {}) {
  const airline = airlineInfoForCarrier(carrier);
  const code = normalizeCarrierCode(airline?.code || carrier);

  const fareType = normalizeFareType(options.fareType);
  const entry = code
    ? findAllowanceEntryByCode(code, fareType)
    : findAllowanceEntryByAirlineName(airline?.name, fareType);
  if (!entry) return null;

  return {
    source: 'local-db',
    sourceLabel: 'Local baggage database',
    sourceUrl: entry.sourceUrl || airline?.website || null,
    fareType: entry.fareType,
    summary: entry.summary,
    details: [
      entry.cabin ? `Cabin: ${entry.cabin}` : null,
      entry.checked ? `Checked: ${entry.checked}` : null,
      entry.notes || null
    ].filter(Boolean),
    included: null,
    updatedAt: entry.updatedAt || baggageAllowanceData.updatedAt || null
  };
}

export function baggageAllowanceEntries() {
  return [...(baggageAllowanceData.entries || [])];
}

export function normalizeFareType(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findAllowanceEntryByCode(code, fareType) {
  const entries = (baggageAllowanceData.entries || []).filter((entry) => normalizeCarrierCode(entry.carrier) === code);
  return findAllowanceEntry(entries, fareType);
}

function findAllowanceEntryByAirlineName(name, fareType) {
  const normalizedName = normalizeFareType(name);
  if (!normalizedName) return null;
  const entries = (baggageAllowanceData.entries || []).filter((entry) =>
    normalizeFareType(airlineInfoForCarrier(entry.carrier)?.name) === normalizedName
  );
  return findAllowanceEntry(entries, fareType);
}

function findAllowanceEntry(entries, fareType) {
  if (entries.length === 0) return null;
  if (fareType) {
    const exact = entries.find((entry) => normalizeFareType(entry.fareType) === fareType);
    if (exact) return exact;
  }
  return entries.find((entry) => DEFAULT_FARE_TYPES.includes(normalizeFareType(entry.fareType))) || entries[0];
}
