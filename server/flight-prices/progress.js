import { providerLabel } from './provider-labels.js';

const PRICE_COMPARE_PROGRESS_DETAIL = process.env.PRICE_COMPARE_PROGRESS_DETAIL || 'compact';

export function progressDetailLevel() {
  return PRICE_COMPARE_PROGRESS_DETAIL === 'verbose' ? 'verbose' : 'compact';
}

export function shouldEmitDetailedProgress(progressDetail) {
  return progressDetail !== 'compact' && progressDetail !== 'silent';
}

export function emitProgress(onProgress, step, message, details = {}) {
  onProgress({
    step,
    message,
    details,
    at: new Date().toISOString()
  });
}

export function routeLabel(leg) {
  return `${leg.from} -> ${leg.to}`;
}

export function providerProgressMessage(provider, leg, result) {
  const label = providerLabel(provider);
  if (result.summary.skipped) return `Skipping ${label} for ${routeLabel(leg)}: ${result.summary.error}.`;
  if (!result.summary.ok) return `${label} failed for ${routeLabel(leg)}: ${result.summary.error}.`;
  if (result.summary.cached) return `${label} SQLite cache hit for ${routeLabel(leg)}.`;
  if (Number.isFinite(result.quote?.amount)) return `${label} found ${routeLabel(leg)} for $${result.quote.amount.toLocaleString()} USD.`;
  if (result.quote?.schedule) return `${label} found schedule data for ${routeLabel(leg)}, but no USD fare.`;
  return `${label} returned no USD price for ${routeLabel(leg)}.`;
}

export function providerProgressStep(result) {
  if (result.summary.skipped) return 'provider-skipped';
  return result.summary.ok ? 'provider-complete' : 'provider-failed';
}
