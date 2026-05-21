// Per-search bookkeeping for provider availability: which providers are
// disabled (rate-limited / out of quota), which "skipped" messages have
// already been emitted (so we don't spam the log). Disable reasons are
// seeded from the SQLite cache (getDisabledProviderReasons) and pushed
// back to SQLite when leg-quoter.js trips a new disable.

import { getDisabledProviderReasons } from '../flight-price-cache.js';

export function createProviderState() {
  return {
    disabledProviders: getDisabledProviderReasons(),
    loggedSkippedProviders: new Set()
  };
}

export function providerDisabledReason(providerState, provider) {
  return providerState.disabledProviders.get(provider) || null;
}

export function disableProvider(providerState, provider, reason) {
  if (providerState.disabledProviders.has(provider)) return false;
  providerState.disabledProviders.set(provider, reason);
  return true;
}

export function markProviderSkipLogged(providerState, provider) {
  if (providerState.loggedSkippedProviders.has(provider)) return false;
  providerState.loggedSkippedProviders.add(provider);
  return true;
}

export function shouldDisableProvider(provider, errorMessage = '') {
  if (!errorMessage) return false;
  if (provider === 'serpapi') {
    return /run out of searches|quota|rate limit|too many requests|429/i.test(errorMessage);
  }
  return /rate limit|too many requests|429/i.test(errorMessage);
}
