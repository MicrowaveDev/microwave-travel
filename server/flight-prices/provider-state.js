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
