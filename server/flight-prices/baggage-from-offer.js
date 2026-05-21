import { baggageAllowanceForCarrier } from '../baggage-allowances.js';
import { providerLabel } from './provider-labels.js';

export function baggageAllowanceFromOffer(provider, offer) {
  if (!offer) return null;
  const parts = uniqueStrings([
    ...collectBaggageStrings(offer),
    ...collectBaggageStrings(offer.baggage),
    ...collectBaggageStrings(offer.baggage_allowance),
    ...collectBaggageStrings(offer.baggageAllowance),
    ...collectBaggageStrings(offer.included_baggage),
    ...collectBaggageStrings(offer.includedBaggage),
    ...collectBaggageStrings(offer.handbags),
    ...collectBaggageStrings(offer.hand_baggage),
    ...collectBaggageStrings(offer.carry_on),
    ...collectBaggageStrings(offer.carryOn),
    ...collectBaggageStrings(offer.checked_baggage),
    ...collectBaggageStrings(offer.checkedBaggage),
    ...(Array.isArray(offer.flights) ? offer.flights.flatMap((flight) => collectBaggageStrings(flight)) : [])
  ]);
  if (parts.length === 0) return null;
  return {
    source: provider,
    summary: parts.slice(0, 3).join('; '),
    details: parts
  };
}

export function unknownBaggageAllowance(provider) {
  return {
    source: provider,
    summary: `${providerLabel(provider)} did not return baggage allowance; check fare rules before booking.`,
    details: [],
    included: null
  };
}

export function withNormalizedBaggage(leg) {
  if (!leg || leg.mode === 'bus' || !leg.provider) return leg;
  if (leg.baggageAllowance && !baggageAllowanceIsUnknown(leg.baggageAllowance)) return leg;
  const localAllowance = baggageAllowanceForCarrier(leg.carrier, {
    fareType: leg.fareType || leg.ticketType || leg.fareClass
  });
  if (localAllowance) {
    return {
      ...leg,
      baggageAllowance: localAllowance
    };
  }
  return {
    ...leg,
    baggageAllowance: unknownBaggageAllowance(leg.provider)
  };
}

export function baggageAllowanceIsUnknown(baggageAllowance) {
  return (
    !baggageAllowance ||
    (
      Array.isArray(baggageAllowance.details) &&
      baggageAllowance.details.length === 0 &&
      /did not return baggage allowance/i.test(baggageAllowance.summary || '')
    )
  );
}

function collectBaggageStrings(value) {
  if (!value) return [];
  if (typeof value === 'string') {
    return baggageTextLooksRelevant(value) ? [normalizeBaggageText(value)] : [];
  }
  if (typeof value === 'number' || typeof value === 'boolean') return [];
  if (Array.isArray(value)) return value.flatMap(collectBaggageStrings);
  if (typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, nested]) => {
    if (baggageKeyLooksRelevant(key)) {
      const direct = formatBaggageField(key, nested);
      if (direct) return [direct, ...collectBaggageStrings(nested)];
    }
    return typeof nested === 'object' ? collectBaggageStrings(nested) : [];
  });
}

function baggageKeyLooksRelevant(key) {
  return /bag|baggage|luggage|carry|handbag|personal_item|personal item|checked/i.test(key);
}

function baggageTextLooksRelevant(text) {
  return /bag|baggage|luggage|carry[- ]?on|handbag|personal item|checked/i.test(text);
}

function formatBaggageField(key, value) {
  if (typeof value === 'string') return normalizeBaggageText(value);
  if (typeof value === 'number') return `${humanizeBaggageKey(key)}: ${value}`;
  if (typeof value === 'boolean') return `${humanizeBaggageKey(key)}: ${value ? 'included' : 'not included'}`;
  return null;
}

function normalizeBaggageText(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

function humanizeBaggageKey(key) {
  return String(key)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

function uniqueStrings(values) {
  const seen = new Set();
  return values.filter((value) => {
    const normalized = normalizeBaggageText(value);
    if (!normalized || seen.has(normalized.toLowerCase())) return false;
    seen.add(normalized.toLowerCase());
    return true;
  });
}
