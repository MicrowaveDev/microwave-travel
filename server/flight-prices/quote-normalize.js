import { airlineInfoForCarrier } from '../airlines.js';
import { withNormalizedBaggage } from './baggage-from-offer.js';
import { addBookingLinks } from './booking-links.js';
import { configuredProviders, providerLabel } from './provider-labels.js';
import { roundMoney } from './money.js';

export function normalizeQuote(provider, legs, attempts = []) {
  const normalizedInputLegs = legs.map((leg) => withNormalizedAirline(withNormalizedBaggage(leg)));
  const priced = normalizedInputLegs.filter((leg) => Number.isFinite(leg.amount));
  const activeProviders = [...new Set(normalizedInputLegs.map((leg) => leg.provider).filter(Boolean))];
  const normalizedLegs = addBookingLinks(normalizedInputLegs.map((leg) => ({
    ...leg,
    amount: Number.isFinite(leg.amount) ? roundMoney(leg.amount) : null
  })));
  return {
    provider,
    currency: 'USD',
    totalAmount: priced.length === legs.length ? roundMoney(priced.reduce((sum, leg) => sum + leg.amount, 0)) : null,
    pricedLegCount: priced.length,
    legCount: legs.length,
    legs: normalizedLegs,
    attempts,
    message:
      priced.length === legs.length
        ? `${providerLabel(activeProviders.join(', ') || provider)} returned all flight leg prices in USD.`
        : priced.length > 0
          ? `${providerLabel(activeProviders.join(', ') || provider)} returned ${priced.length} of ${legs.length} leg prices in USD.`
          : configuredProviders().length
            ? 'Configured providers did not return USD prices for this route.'
            : 'No flight price provider is configured. Add provider keys to the server environment.'
  };
}

export function withNormalizedAirline(leg) {
  if (!leg || leg.mode === 'bus' || leg.airline || !leg.carrier) return leg;
  const airline = airlineInfoForCarrier(leg.carrier);
  return airline ? { ...leg, airline } : leg;
}
