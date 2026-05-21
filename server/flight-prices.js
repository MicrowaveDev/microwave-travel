import { buildLegsForRoute } from './optimizer.js';
import {
  formatDateOnly,
  formatDateShift,
  popularRouteDateChoices,
  shiftDisplayLegDates
} from './date-utils.js';
import {
  clearCachedFlightPrices,
  closeFlightPriceCache,
  getCachedFlightPrice,
  getCachedFlightPrices,
  getCachedPriceBundle,
  getCachedRouteAnalysis,
  getDisabledProviderReasons,
  setCachedFlightPrice,
  setCachedPriceBundle,
  setCachedRouteAnalysis,
  setDisabledProviderReason
} from './flight-price-cache.js';
import { airlineInfoForCarrier } from './airlines.js';
import { rankTransferRoutes } from './route-intelligence.js';
import { isRussianDirection, sameCityName, toIataCode } from './iata-codes.js';
import { configuredProviders, providerLabel } from './flight-prices/provider-labels.js';
import {
  cacheableLeg,
  cloneQuote,
  markQuoteBundleFromCache,
  markQuoteFromCache,
  sortForStableJson,
  stableCacheKey
} from './flight-prices/cache-keys.js';
import { withNormalizedBaggage } from './flight-prices/baggage-from-offer.js';
import {
  quoteLegWithSerpApi,
  quoteLegWithTravelpayouts,
  quoteLegWithYandexRasp,
  tryProvider
} from './flight-prices/providers.js';
import { addBookingLinks } from './flight-prices/booking-links.js';

const PORTO_DUBAI_TRANSFER_HUBS = [
  'Doha',
  'Istanbul',
  'Lisbon',
  'Madrid',
  'Barcelona',
  'Milan',
  'Rome',
  'Paris',
  'Frankfurt',
  'Warsaw',
  'Belgrade',
  'Athens',
  'Vienna',
  'Zurich',
  'Amsterdam'
];
const PORTO_RETURN_FALLBACK_HUBS = ['Warsaw', 'Madrid', 'Lisbon', 'Barcelona', 'Paris', 'Amsterdam', 'Milan'];
const POPULAR_ROUTE_SEARCH_DAYS = Number(process.env.POPULAR_ROUTE_SEARCH_DAYS || 4);
const POPULAR_ROUTE_DATE_FLEX_DAYS = Number(process.env.POPULAR_ROUTE_DATE_FLEX_DAYS || 2);
const POPULAR_ROUTE_STAY_FLEX_DAYS = Number(process.env.POPULAR_ROUTE_STAY_FLEX_DAYS || 1);
const PRICE_COMPARE_PROGRESS_DETAIL = process.env.PRICE_COMPARE_PROGRESS_DETAIL || 'compact';
const LEG_QUOTE_CACHE_TTL_MS = 60 * 60 * 1000;
const PRICE_ROUTE_ANALYSIS_CACHE_TTL_MS = Number(process.env.PRICE_ROUTE_ANALYSIS_CACHE_TTL_MS || LEG_QUOTE_CACHE_TTL_MS);
const PRICE_BUNDLE_CACHE_TTL_MS = Number(process.env.PRICE_BUNDLE_CACHE_TTL_MS || LEG_QUOTE_CACHE_TTL_MS);
const PROVIDER_DISABLE_CACHE_TTL_MS = Number(process.env.PROVIDER_DISABLE_CACHE_TTL_MS || 30 * 60 * 1000);
const AVIASALES_SEARCH_BASE_URL = process.env.AVIASALES_SEARCH_BASE_URL || 'https://search.aviasales.com/flights/';

export async function quoteFlightPrices(input, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const providerState = createProviderState();
  const passengers = normalizePassengerCount(input.passengers);
  const legs = normalizeLegs(input.legs, passengers);
  const requirements = normalizePriceRequirements(input.requirements);
  if (legs.length === 0) {
    throw new Error('Optimize a route before fetching prices.');
  }

  emitProgress(onProgress, 'pricing-start', `Pricing ${legs.length} flight leg${legs.length === 1 ? '' : 's'} in USD.`, {
    legCount: legs.length
  });
  const routeCacheKey = routeAnalysisCacheKey({ legs, requirements, passengers });
  const cachedRouteQuote = getCachedRouteAnalysis(routeCacheKey);
  if (cachedRouteQuote) {
    const quote = markQuoteFromCache(cachedRouteQuote, 'route-analysis');
    emitProgress(onProgress, 'pricing-cache-hit', 'Using cached full route price analysis.', {
      cache: 'route-analysis',
      totalAmount: quote.totalAmount,
      pricedLegCount: quote.pricedLegCount,
      legCount: quote.legCount
    });
    emitProgress(onProgress, 'pricing-complete', quote.totalAmount
      ? `Finished pricing: $${quote.totalAmount.toLocaleString()} USD.`
      : 'Finished pricing with partial or missing prices.', {
      totalAmount: quote.totalAmount,
      pricedLegCount: quote.pricedLegCount,
      legCount: quote.legCount,
      cached: true
    });
    return quote;
  }

  const quoted = await quoteNormalizedLegs(legs, {
    onProgress,
    phase: 'Current route',
    providerState,
    bundleCacheKey: legBundleCacheKey('current', legs, { stopOnUnpriced: false })
  });
  const quote = normalizeQuote('mixed', quoted.legs, quoted.attempts);
  const optimized = await optimizePopularTransferRoute(input.legs, quote, { onProgress, providerState, requirements });
  const recovered = await recoverMissingPortoReturnLeg(
    optimized || quote,
    optimized?.optimizedRouteLegs || input.legs,
    { onProgress, providerState }
  );
  const finalQuote = recovered || optimized || quote;
  emitProgress(onProgress, 'pricing-complete', finalQuote.totalAmount
    ? `Finished pricing: $${finalQuote.totalAmount.toLocaleString()} USD.`
    : 'Finished pricing with partial or missing prices.', {
    totalAmount: finalQuote.totalAmount,
    pricedLegCount: finalQuote.pricedLegCount,
    legCount: finalQuote.legCount
  });
  setCachedRouteAnalysis(routeCacheKey, cloneQuote(finalQuote), Date.now() + PRICE_ROUTE_ANALYSIS_CACHE_TTL_MS);
  return finalQuote;
}

export function clearFlightPriceCache() {
  clearCachedFlightPrices();
}

export function closeFlightPriceCacheDb() {
  closeFlightPriceCache();
}

async function quoteNormalizedLegs(legs, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const providerState = options.providerState || createProviderState();
  const emitLegDetail = shouldEmitDetailedProgress(options.progressDetail);
  const bundleCacheKey = options.bundleCacheKey || null;
  if (bundleCacheKey) {
    const cachedBundle = getCachedPriceBundle(bundleCacheKey);
    if (cachedBundle) {
      return markQuoteBundleFromCache(cachedBundle);
    }
  }
  const quotedLegs = [];
  const attempts = [];

  for (const [index, leg] of legs.entries()) {
    if (emitLegDetail) {
      emitProgress(onProgress, 'leg-start', `${options.phase || 'Pricing'}: ${leg.from} to ${leg.to} on ${leg.departureDate}.`, {
        phase: options.phase,
        legIndex: index + 1,
        legCount: legs.length,
        route: routeLabel(leg),
        date: leg.departureDate,
        candidateRoute: options.candidateRoute || null
      });
    }
    const result = await quoteLeg(leg, {
      onProgress,
      phase: options.phase,
      candidateRoute: options.candidateRoute,
      providerState,
      progressDetail: options.progressDetail
    });
    quotedLegs.push(result.leg);
    attempts.push(...result.attempts);
    if (options.stopOnUnpriced && !Number.isFinite(result.leg?.amount)) {
      if (emitLegDetail) {
        emitProgress(onProgress, 'candidate-pruned', `Stopping ${options.candidateRoute || 'candidate'} early because ${routeLabel(leg)} has no comparable USD price.`, {
          route: routeLabel(leg),
          date: leg.departureDate,
          candidateRoute: options.candidateRoute || null,
          reason: result.leg?.error || 'No comparable USD price.'
        });
      }
      break;
    }
  }

  const result = { legs: quotedLegs, attempts };
  if (bundleCacheKey) {
    setCachedPriceBundle(bundleCacheKey, cloneQuote(result), Date.now() + PRICE_BUNDLE_CACHE_TTL_MS);
  }
  return result;
}

async function optimizePopularTransferRoute(originalLegs, initialQuote, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const providerState = options.providerState || createProviderState();
  const requirements = Array.isArray(options.requirements) ? options.requirements : [];
  const passengers = initialQuote.legs?.find((leg) => Number.isFinite(leg.passengers))?.passengers || 1;
  if (!Array.isArray(originalLegs)) return null;

  const optimizationTarget = findPopularRouteTarget(originalLegs);
  if (!optimizationTarget) return null;

  const { startIndex, endIndex = originalLegs.length, direction } = optimizationTarget;
  const currentSuffix = originalLegs.slice(startIndex, endIndex);
  if (!isReplaceablePopularRoute(currentSuffix, direction)) return null;

  const currentSuffixQuote = quoteTotalForDisplayLegs(currentSuffix, initialQuote.legs);
  let best = null;
  const comparableCandidates = [];
  const skippedCandidates = [];
  const routeRanking = rankTransferRoutes(popularTransferRoutes(direction), currentSuffix[0].departOn);
  const routes = routeRanking.rankedRoutes;
  const flexLimitedRoutes = new Set(routeRanking.skippedRoutes.map((entry) => entry.route.join(' -> ')));
  const progressDetail = progressDetailLevel();
  const emitCandidateDetail = shouldEmitDetailedProgress(progressDetail);
  const dateChoices = popularRouteDateChoices(
    currentSuffix[0].departOn,
    startIndex,
    POPULAR_ROUTE_SEARCH_DAYS,
    POPULAR_ROUTE_DATE_FLEX_DAYS,
    {
      latestBeforeDate: findBeforeRequirementDate(requirements, direction.to)
    }
  );
  const tailQuoteCache = new Map();

  emitProgress(onProgress, 'compare-start', `Comparing ${routes.length} ${direction.from} to ${direction.to} route options across ${dateChoices.length} dates.`, {
    from: direction.from,
    to: direction.to,
    routeCount: routes.length,
    flexLimitedRouteCount: routeRanking.skippedRoutes.length,
    dateCount: dateChoices.length,
    currentAmount: currentSuffixQuote
  });

  if (routeRanking.skippedRoutes.length > 0) {
    emitProgress(onProgress, 'compare-pruned', `${routeRanking.skippedRoutes.length} low-priority transfer route${routeRanking.skippedRoutes.length === 1 ? '' : 's'} will only check the primary date before live date-flex pricing.`, {
      flexLimitedRouteCount: routeRanking.skippedRoutes.length
    });
  }

  for (const route of routes) {
    for (const { date: departureDate, offsetDays } of dateChoices) {
      const candidateLabel = route.join(' -> ');
      if (offsetDays !== 0 && flexLimitedRoutes.has(candidateLabel)) {
        skippedCandidates.push(buildSkippedRouteOption({
          route,
          departureDate,
          reason: 'route-intelligence',
          message: 'Skipped date-flex check for a lower-priority transfer route.',
          details: { offsetDays }
        }));
        continue;
      }
      if (emitCandidateDetail) {
        emitProgress(onProgress, 'candidate-start', `Trying ${candidateLabel} on ${departureDate}${formatDateShift(offsetDays)}.`, {
          route,
          date: departureDate,
          offsetDays
        });
      }
      const candidateDisplayLegs = buildLegsForRoute(route, departureDate);
      const candidateArrival = candidateDisplayLegs.at(-1)?.arriveBy;
      if (!satisfiesBeforeRequirement(candidateArrival, requirements, direction.to)) {
        skippedCandidates.push(buildSkippedRouteOption({
          route,
          departureDate,
          reason: 'date-constraint',
          message: `${direction.to} would miss the visit-before date.`,
          details: {
            arrivalDate: candidateArrival || null,
            requiredBefore: findBeforeRequirementDate(requirements, direction.to),
            offsetDays
          }
        }));
        continue;
      }
      const candidateNormalizedLegs = normalizeLegs(candidateDisplayLegs, passengers);
      const candidateQuoted = await quoteNormalizedLegs(candidateNormalizedLegs, {
        onProgress,
        phase: 'Compare option',
        candidateRoute: candidateLabel,
        providerState,
        stopOnUnpriced: true,
        progressDetail,
        bundleCacheKey: legBundleCacheKey('transfer-candidate', candidateNormalizedLegs, { stopOnUnpriced: true })
      });
      const candidateQuote = normalizeQuote('mixed', candidateQuoted.legs, candidateQuoted.attempts);
      if (!Number.isFinite(candidateQuote.totalAmount)) {
        skippedCandidates.push(buildSkippedRouteOption({
          route,
          departureDate,
          reason: 'missing-price',
          message: 'Not enough priced legs to compare.',
          details: {
            pricedLegCount: candidateQuote.pricedLegCount,
            legCount: candidateQuote.legCount,
            offsetDays
          }
        }));
        if (emitCandidateDetail) {
          emitProgress(onProgress, 'candidate-skip', `${candidateLabel} on ${departureDate}: not enough priced legs to compare.`, {
            route,
            date: departureDate,
            pricedLegCount: candidateQuote.pricedLegCount,
            legCount: candidateQuote.legCount,
            offsetDays
          });
        }
        continue;
      }

      for (const stayFlexDays of stayFlexDayChoices(currentSuffix, originalLegs.slice(endIndex))) {
        const tailQuote = await quoteShiftedTailForDateOffset(offsetDays + stayFlexDays, originalLegs.slice(endIndex), {
          cache: tailQuoteCache,
          onProgress,
          providerState,
          candidateRoute: candidateLabel,
          progressDetail,
          passengers
        });

        const candidate = {
          route,
          departureDate,
          offsetDays,
          stayFlexDays,
          displayLegs: candidateDisplayLegs,
          quote: candidateQuote,
          tailDisplayLegs: tailQuote.displayLegs,
          tailQuoteLegs: tailQuote.quoteLegs,
          tailAttempts: tailQuote.attempts
        };
        const previewOption = buildOptimizedRouteOption({
          candidate,
          currentSuffix,
          prefixDisplayLegs: originalLegs.slice(0, startIndex),
          tailDisplayLegs: candidate.tailDisplayLegs,
          prefixQuoteLegs: initialQuote.legs.filter((quotedLeg) =>
            originalLegs.slice(0, startIndex).some((displayLeg) => sameDisplayLeg(displayLeg, quotedLeg))
          ),
          tailQuoteLegs: candidate.tailQuoteLegs
        });
        comparableCandidates.push(candidate);
        if (!best || compareCandidates(candidate, best) < 0) {
          best = candidate;
          emitProgress(onProgress, 'candidate-best', `${candidateLabel} on ${departureDate}${formatDateShift(offsetDays)}${formatStayFlex(stayFlexDays, direction.to)} is the current best at ${formatCandidatePrice(previewOption)}.`, {
            route,
            date: departureDate,
            totalAmount: previewOption.totalAmount,
            transferAmount: candidateQuote.totalAmount,
            offsetDays,
            stayFlexDays,
            previewOption
          });
        } else {
          emitProgress(onProgress, 'candidate-result', `${candidateLabel} on ${departureDate}${formatDateShift(offsetDays)}${formatStayFlex(stayFlexDays, direction.to)}: ${formatCandidatePrice(previewOption)}.`, {
            route,
            date: departureDate,
            totalAmount: previewOption.totalAmount,
            transferAmount: candidateQuote.totalAmount,
            offsetDays,
            stayFlexDays
          });
        }
      }
    }
  }

  if (!emitCandidateDetail && skippedCandidates.length > 0) {
    emitProgress(onProgress, 'compare-skipped', `${skippedCandidates.length} transfer search${skippedCandidates.length === 1 ? '' : 'es'} skipped because prices were incomplete.`, {
      skippedCount: skippedCandidates.length,
      reason: 'missing-price'
    });
  }

  const rankedCandidates = compactRouteOptions([...comparableCandidates]
    .sort(compareCandidates)
    .map((candidate) => buildOptimizedRouteOption({
      candidate,
      currentSuffix,
      prefixDisplayLegs: originalLegs.slice(0, startIndex),
      tailDisplayLegs: candidate.tailDisplayLegs,
      prefixQuoteLegs: initialQuote.legs.filter((quotedLeg) =>
        originalLegs.slice(0, startIndex).some((displayLeg) => sameDisplayLeg(displayLeg, quotedLeg))
      ),
      tailQuoteLegs: candidate.tailQuoteLegs
    })));
  const bestOptimizedOption = rankedCandidates[0] || null;

  if (!best || !beatsCurrentRoute(bestOptimizedOption, best, initialQuote.totalAmount, currentSuffixQuote)) {
    const message = best
      ? 'No cheaper transfer route beat the current route.'
      : 'No complete priced transfer route was available for the valid stay window.';
    const enrichedQuote = {
      ...initialQuote,
      transferSearchMessage: message,
      optimizedRouteOptions: rankedCandidates,
      optimizedRouteSkippedOptions: skippedCandidates
    };
    enrichedQuote.message = `${initialQuote.message} ${message}`;
    emitProgress(onProgress, 'compare-complete', message, {
      selectedRoute: null,
      currentAmount: currentSuffixQuote,
      currentTotalAmount: initialQuote.totalAmount,
      bestAmount: best?.quote.totalAmount || null
    });
    return enrichedQuote;
  }

  const prefixDisplayLegs = originalLegs.slice(0, startIndex);
  const tailDisplayLegs = best.tailDisplayLegs;
  const prefixQuoteLegs = initialQuote.legs.filter((quotedLeg) =>
    prefixDisplayLegs.some((displayLeg) => sameDisplayLeg(displayLeg, quotedLeg))
  );
  const tailQuoteLegs = best.tailQuoteLegs;
  const optimizedLegs = [...prefixQuoteLegs, ...best.quote.legs, ...tailQuoteLegs];
  const combinedQuote = normalizeQuote('mixed', optimizedLegs, [
    ...initialQuote.attempts,
    ...best.quote.attempts.map((attempt) => ({ ...attempt, optimizedCandidate: true })),
    ...best.tailAttempts.map((attempt) => ({ ...attempt, dateFlexCandidate: best.offsetDays !== 0 }))
  ]);
  combinedQuote.optimizedRouteLegs = [
    ...prefixDisplayLegs,
    ...copyStayToReplacement(currentSuffix, best.displayLegs, best.stayFlexDays),
    ...tailDisplayLegs
  ];
  combinedQuote.optimizedRouteOptions = rankedCandidates;
  combinedQuote.optimizedRouteSkippedOptions = skippedCandidates;
  combinedQuote.transferSearchMessage = `Optimized ${direction.from} to ${direction.to} via ${best.route.slice(1, -1).join(' / ') || 'direct'} on ${best.departureDate}${formatDateShift(best.offsetDays)}.`;
  combinedQuote.optimization = {
    reason: `Found a cheaper priced ${direction.from} to ${direction.to} option.`,
    replacedRoute: currentSuffix.map((leg) => leg.from).concat(currentSuffix.at(-1).to),
    selectedRoute: best.route,
    departureDate: best.departureDate,
    dateShiftDays: best.offsetDays,
    stayFlexDays: best.stayFlexDays || 0,
    previousReturnAmount: currentSuffixQuote,
    selectedReturnAmount: best.quote.totalAmount
  };
  combinedQuote.message = `${combinedQuote.message} ${combinedQuote.transferSearchMessage}`;
  emitProgress(onProgress, 'compare-complete', `Selected ${best.route.join(' -> ')} on ${best.departureDate}${formatDateShift(best.offsetDays)}${formatStayFlex(best.stayFlexDays, direction.to)} at ${formatCandidatePrice(bestOptimizedOption)}.`, {
    selectedRoute: best.route,
    date: best.departureDate,
    offsetDays: best.offsetDays,
    stayFlexDays: best.stayFlexDays || 0,
    previousAmount: currentSuffixQuote,
    selectedAmount: best.quote.totalAmount,
    selectedTotalAmount: bestOptimizedOption?.totalAmount || null
  });
  return combinedQuote;
}

function buildSkippedRouteOption({ route, departureDate, reason, message, details = {} }) {
  return {
    route,
    departureDate,
    reason,
    message,
    details
  };
}

function normalizePriceRequirements(requirements) {
  if (!Array.isArray(requirements)) return [];
  return requirements
    .map((requirement) => ({
      city: String(requirement.city || '').trim(),
      type: requirement.type === 'after' || requirement.type === 'departBefore' ? requirement.type : 'before',
      date: parseIsoDate(requirement.date)
    }))
    .filter((requirement) => requirement.city && requirement.date);
}

function findBeforeRequirementDate(requirements, city) {
  const requirement = requirements.find((entry) => sameCityName(entry.city, city) && entry.type === 'before');
  return requirement?.date || null;
}

function satisfiesBeforeRequirement(arrivalDate, requirements, city) {
  const beforeDate = findBeforeRequirementDate(requirements, city);
  if (!beforeDate) return true;
  const arrival = parseIsoDate(arrivalDate);
  return Boolean(arrival && arrival < beforeDate);
}

function parseIsoDate(value) {
  const date = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function buildOptimizedRouteOption({
  candidate,
  currentSuffix,
  prefixDisplayLegs,
  tailDisplayLegs,
  prefixQuoteLegs,
  tailQuoteLegs
}) {
  const routeLegs = [
    ...prefixDisplayLegs,
    ...copyStayToReplacement(currentSuffix, candidate.displayLegs, candidate.stayFlexDays),
    ...tailDisplayLegs
  ];
  const quoteLegs = [...prefixQuoteLegs, ...candidate.quote.legs, ...tailQuoteLegs];
  const quote = normalizeQuote('mixed', quoteLegs, []);
  return {
    route: candidate.route,
    departureDate: candidate.departureDate,
    dateShiftDays: candidate.offsetDays || 0,
    stayFlexDays: candidate.stayFlexDays || 0,
    amount: candidate.quote.totalAmount,
    totalAmount: quote.totalAmount,
    pricedLegCount: quote.pricedLegCount,
    legCount: quote.legCount,
    routeLegs,
    legs: quoteLegs
  };
}

function compareCandidates(left, right) {
  const leftOption = comparableAmount(left);
  const rightOption = comparableAmount(right);
  if (leftOption.complete !== rightOption.complete) return leftOption.complete ? -1 : 1;
  const leftAmount = leftOption.complete ? leftOption.totalAmount : leftOption.transferAmount;
  const rightAmount = rightOption.complete ? rightOption.totalAmount : rightOption.transferAmount;
  if (leftAmount !== rightAmount) return leftAmount - rightAmount;
  if ((left.stayFlexDays || 0) !== (right.stayFlexDays || 0)) return (left.stayFlexDays || 0) - (right.stayFlexDays || 0);
  return left.quote.totalAmount - right.quote.totalAmount;
}

function beatsCurrentRoute(option, candidate, currentTotalAmount, currentSuffixAmount) {
  if (Number.isFinite(option?.totalAmount) && Number.isFinite(currentTotalAmount)) {
    return option.totalAmount < currentTotalAmount;
  }
  if (Number.isFinite(currentSuffixAmount)) {
    return candidate.quote.totalAmount < currentSuffixAmount;
  }
  return true;
}

function comparableAmount(candidate) {
  const quoteLegs = [...candidate.quote.legs, ...candidate.tailQuoteLegs];
  const quote = normalizeQuote('mixed', quoteLegs, []);
  return {
    complete: Number.isFinite(quote.totalAmount),
    totalAmount: quote.totalAmount,
    transferAmount: candidate.quote.totalAmount
  };
}

function stayFlexDayChoices(replacedLegs, tailLegs) {
  const staySource = replacedLegs.at(-1);
  if (!staySource?.stayHoursAfter || tailLegs.length === 0) return [0];
  const maxStayFlexDays = Math.max(0, Math.floor(POPULAR_ROUTE_STAY_FLEX_DAYS));
  return Array.from({ length: maxStayFlexDays + 1 }, (_, days) => days);
}

function formatStayFlex(stayFlexDays, city) {
  return stayFlexDays ? `, +${stayFlexDays}d in ${city}` : '';
}

function formatCandidatePrice(option) {
  if (Number.isFinite(option?.totalAmount)) return `$${option.totalAmount.toLocaleString()} USD total`;
  if (Number.isFinite(option?.amount)) return `$${option.amount.toLocaleString()} USD transfer`;
  return 'partial price';
}

function pruneDatesForTailStay(dates, replacedLegs, tailLegs) {
  const staySource = replacedLegs.at(-1);
  const stayHours = Number(staySource?.stayHoursAfter) || 0;
  const firstTailLeg = tailLegs[0];
  if (!stayHours || !firstTailLeg) return { validDates: dates, skippedDates: [] };

  const nextDeparture = new Date(`${firstTailLeg.departOn || firstTailLeg.departureDate}T00:00:00.000Z`);
  if (Number.isNaN(nextDeparture.getTime())) return { validDates: dates, skippedDates: [] };
  const latestArrival = addHoursToDate(nextDeparture, -stayHours);
  const validDates = [];
  const skippedDates = [];
  for (const date of dates) {
    const candidateDate = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(candidateDate.getTime()) || candidateDate <= latestArrival) {
      validDates.push(date);
    } else {
      skippedDates.push(date);
    }
  }

  if (skippedDates.length === 0) return { validDates, skippedDates };
  const stayDays = Number(staySource?.stayDaysAfter) || stayHours / 24;
  const details = {
    skippedDates,
    latestArrivalDate: formatDateOnly(latestArrival),
    nextDepartureDate: formatDateOnly(nextDeparture),
    stayDays
  };
  return {
    validDates,
    skippedDates,
    message: `${skippedDates.length} later date${skippedDates.length === 1 ? '' : 's'} skipped because ${staySource.to} needs ${formatStayDays(stayDays)} before the next leg leaves on ${formatDateOnly(nextDeparture)}.`,
    details
  };
}

function copyStayToReplacement(replacedLegs, replacementLegs, stayFlexDays = 0) {
  const staySource = replacedLegs.at(-1);
  if (!staySource?.stayHoursAfter || replacementLegs.length === 0) return replacementLegs;
  const extraStayDays = Number(stayFlexDays) || 0;
  const extraStayHours = extraStayDays * 24;
  return replacementLegs.map((leg, index) => index === replacementLegs.length - 1
    ? {
        ...leg,
        stayHoursAfter: staySource.stayHoursAfter + extraStayHours,
        stayDaysAfter: staySource.stayDaysAfter + extraStayDays
      }
    : leg
  );
}

async function recoverMissingPortoReturnLeg(quote, displayLegs, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const providerState = options.providerState || createProviderState();
  const progressDetail = progressDetailLevel();
  const emitCandidateDetail = shouldEmitDetailedProgress(progressDetail);
  if (Number.isFinite(quote.totalAmount)) return null;

  const missingLeg = quote.legs.find((leg) =>
    leg.to === 'Porto' &&
    leg.mode !== 'bus' &&
    !Number.isFinite(leg.amount) &&
    leg.from !== 'Porto'
  );
  if (!missingLeg) return null;

  const routes = PORTO_RETURN_FALLBACK_HUBS
    .filter((hub) => hub !== missingLeg.from && hub !== missingLeg.to)
    .map((hub) => [missingLeg.from, hub, 'Porto']);
  if (routes.length === 0) return null;

  emitProgress(onProgress, 'fallback-start', `Trying ${routes.length} fallback routes for missing ${missingLeg.from} to Porto price.`, {
    route: routeLabel(missingLeg),
    date: missingLeg.departureDate,
    routeCount: routes.length
  });

  let best = null;
  let skippedCount = 0;
  for (const route of routes) {
    const candidateLabel = route.join(' -> ');
    if (emitCandidateDetail) {
      emitProgress(onProgress, 'candidate-start', `Trying fallback ${candidateLabel} on ${missingLeg.departureDate}.`, {
        route,
        date: missingLeg.departureDate,
        fallbackFor: routeLabel(missingLeg)
      });
    }
    const candidateDisplayLegs = buildLegsForRoute(route, missingLeg.departureDate);
    const candidateNormalizedLegs = normalizeLegs(candidateDisplayLegs, missingLeg.passengers || 1);
    const candidateQuoted = await quoteNormalizedLegs(candidateNormalizedLegs, {
      onProgress,
      phase: 'Fallback option',
      candidateRoute: candidateLabel,
      providerState,
      stopOnUnpriced: true,
      progressDetail,
      bundleCacheKey: legBundleCacheKey('return-fallback', candidateNormalizedLegs, { stopOnUnpriced: true })
    });
    const candidateQuote = normalizeQuote('mixed', candidateQuoted.legs, candidateQuoted.attempts);
    if (!Number.isFinite(candidateQuote.totalAmount)) {
      skippedCount += 1;
      if (emitCandidateDetail) {
        emitProgress(onProgress, 'candidate-skip', `${candidateLabel}: not enough priced legs to replace ${routeLabel(missingLeg)}.`, {
          route,
          date: missingLeg.departureDate,
          pricedLegCount: candidateQuote.pricedLegCount,
          legCount: candidateQuote.legCount,
          fallbackFor: routeLabel(missingLeg)
        });
      }
      continue;
    }

    if (!best || candidateQuote.totalAmount < best.quote.totalAmount) {
      best = { route, displayLegs: candidateDisplayLegs, quote: candidateQuote };
      const previewQuote = buildFallbackPreviewQuote(quote, displayLegs, missingLeg, candidateDisplayLegs, candidateQuote.legs);
      emitProgress(onProgress, 'candidate-best', `${candidateLabel} is the current best fallback at $${candidateQuote.totalAmount.toLocaleString()} USD.`, {
        route,
        date: missingLeg.departureDate,
        totalAmount: candidateQuote.totalAmount,
        fallbackFor: routeLabel(missingLeg),
        previewQuote
      });
    } else {
      emitProgress(onProgress, 'candidate-result', `${candidateLabel}: $${candidateQuote.totalAmount.toLocaleString()} USD.`, {
        route,
        date: missingLeg.departureDate,
        totalAmount: candidateQuote.totalAmount,
        fallbackFor: routeLabel(missingLeg)
      });
    }
  }

  if (!emitCandidateDetail && skippedCount > 0) {
    emitProgress(onProgress, 'fallback-skipped', `${skippedCount} fallback route${skippedCount === 1 ? '' : 's'} skipped because prices were incomplete.`, {
      skippedCount,
      fallbackFor: routeLabel(missingLeg)
    });
  }

  if (!best) {
    emitProgress(onProgress, 'fallback-complete', `No fallback route returned complete prices for ${routeLabel(missingLeg)}.`, {
      route: routeLabel(missingLeg),
      selectedRoute: null
    });
    return null;
  }

  const remainingQuoteLegs = quote.legs.filter((leg) => !sameQuoteLeg(leg, missingLeg));
  const combinedQuote = normalizeQuote('mixed', [...remainingQuoteLegs, ...best.quote.legs], [
    ...quote.attempts,
    ...best.quote.attempts.map((attempt) => ({ ...attempt, fallbackCandidate: true }))
  ]);
  const baseDisplayLegs = Array.isArray(displayLegs) ? displayLegs : [];
  combinedQuote.optimizedRouteLegs = replaceDisplayLeg(baseDisplayLegs, missingLeg, best.displayLegs);
  if (Array.isArray(quote.optimizedRouteOptions)) {
    combinedQuote.optimizedRouteOptions = quote.optimizedRouteOptions.map((option) =>
      replaceMissingLegInRouteOption(option, missingLeg, best.displayLegs, best.quote.legs)
    );
  }
  if (Array.isArray(quote.optimizedRouteSkippedOptions)) {
    combinedQuote.optimizedRouteSkippedOptions = quote.optimizedRouteSkippedOptions;
  }
  if (quote.optimization) combinedQuote.optimization = quote.optimization;
  if (quote.transferSearchMessage) combinedQuote.transferSearchMessage = quote.transferSearchMessage;
  combinedQuote.fallback = {
    reason: `Found a priced fallback for ${missingLeg.from} to Porto.`,
    replacedRoute: [missingLeg.from, 'Porto'],
    selectedRoute: best.route,
    departureDate: missingLeg.departureDate,
    selectedAmount: best.quote.totalAmount
  };
  combinedQuote.message = [
    combinedQuote.message,
    quote.transferSearchMessage,
    `Replaced missing ${missingLeg.from} to Porto price via ${best.route.slice(1, -1).join(' / ')}.`
  ].filter(Boolean).join(' ');
  emitProgress(onProgress, 'fallback-complete', `Selected fallback ${best.route.join(' -> ')} at $${best.quote.totalAmount.toLocaleString()} USD.`, {
    selectedRoute: best.route,
    date: missingLeg.departureDate,
    selectedAmount: best.quote.totalAmount,
    fallbackFor: routeLabel(missingLeg)
  });
  return combinedQuote;
}

function buildFallbackPreviewQuote(quote, displayLegs, missingLeg, replacementDisplayLegs, replacementQuoteLegs) {
  const remainingQuoteLegs = quote.legs.filter((leg) => !sameQuoteLeg(leg, missingLeg));
  const preview = normalizeQuote('mixed', [...remainingQuoteLegs, ...replacementQuoteLegs], quote.attempts || []);
  preview.optimizedRouteLegs = replaceDisplayLeg(Array.isArray(displayLegs) ? displayLegs : [], missingLeg, replacementDisplayLegs);
  if (Array.isArray(quote.optimizedRouteOptions)) {
    preview.optimizedRouteOptions = quote.optimizedRouteOptions.map((option) =>
      replaceMissingLegInRouteOption(option, missingLeg, replacementDisplayLegs, replacementQuoteLegs)
    );
  }
  if (Array.isArray(quote.optimizedRouteSkippedOptions)) {
    preview.optimizedRouteSkippedOptions = quote.optimizedRouteSkippedOptions;
  }
  if (quote.optimization) preview.optimization = quote.optimization;
  if (quote.transferSearchMessage) preview.transferSearchMessage = quote.transferSearchMessage;
  preview.message = `Current best fallback: ${replacementDisplayLegs.map((leg) => leg.from).concat(replacementDisplayLegs.at(-1)?.to || []).join(' -> ')}.`;
  return preview;
}

function replaceMissingLegInRouteOption(option, missingLeg, replacementDisplayLegs, replacementQuoteLegs) {
  const legs = [
    ...option.legs.filter((leg) => !sameQuoteLeg(leg, missingLeg)),
    ...replacementQuoteLegs
  ];
  const quote = normalizeQuote('mixed', legs, []);
  return {
    ...option,
    totalAmount: quote.totalAmount,
    pricedLegCount: quote.pricedLegCount,
    legCount: quote.legCount,
    routeLegs: replaceDisplayLeg(option.routeLegs, missingLeg, replacementDisplayLegs),
    legs
  };
}

function replaceDisplayLeg(displayLegs, replacedLeg, replacementLegs) {
  const index = displayLegs.findIndex((leg) => sameDisplayLeg(leg, replacedLeg));
  if (index === -1) return displayLegs;
  return [
    ...displayLegs.slice(0, index),
    ...replacementLegs,
    ...displayLegs.slice(index + 1)
  ];
}

function sameQuoteLeg(left, right) {
  return left.from === right.from && left.to === right.to && left.departureDate === right.departureDate;
}

function findPopularRouteTarget(legs) {
  const candidates = [
    ...findPopularRouteTargetsForDirection(legs, { from: 'Porto', to: 'Dubai' }),
    ...findPopularRouteTargetsForDirection(legs, { from: 'Dubai', to: 'Porto' })
  ];
  candidates.sort((a, b) => a.startIndex - b.startIndex || a.endIndex - b.endIndex);
  return candidates[0] || null;
}

function findPopularRouteTargetsForDirection(legs, direction) {
  const candidates = [];
  for (let startIndex = 0; startIndex < legs.length; startIndex += 1) {
    if (legs[startIndex].from !== direction.from) continue;
    for (let endIndex = startIndex; endIndex < legs.length; endIndex += 1) {
      if (legs[endIndex].to !== direction.to) continue;
      const segment = legs.slice(startIndex, endIndex + 1);
      if (isReplaceablePopularRoute(segment, direction)) {
        candidates.push({ startIndex, endIndex: endIndex + 1, direction });
        break;
      }
    }
  }
  return candidates;
}

function isReplaceablePopularRoute(legs, direction) {
  const cities = new Set(legs.flatMap((leg) => [leg.from, leg.to]));
  for (const city of cities) {
    if (![direction.from, direction.to, ...PORTO_DUBAI_TRANSFER_HUBS].includes(city)) {
      return false;
    }
  }
  return true;
}

function popularTransferRoutes(direction) {
  return [
    [direction.from, direction.to],
    ...PORTO_DUBAI_TRANSFER_HUBS.map((hub) => [direction.from, hub, direction.to])
  ];
}

async function quoteShiftedTailForDateOffset(offsetDays, tailDisplayLegs, options = {}) {
  const cacheKey = String(offsetDays);
  if (options.cache?.has(cacheKey)) return options.cache.get(cacheKey);

  const displayLegs = shiftDisplayLegDates(tailDisplayLegs, offsetDays);
  const normalizedLegs = normalizeLegs(displayLegs, options.passengers || 1);
  const quoted = normalizedLegs.length
    ? await quoteNormalizedLegs(normalizedLegs, {
        onProgress: options.onProgress,
        phase: offsetDays === 0 ? 'Compare tail' : 'Date-flex tail',
        candidateRoute: options.candidateRoute,
        providerState: options.providerState,
        stopOnUnpriced: false,
        progressDetail: options.progressDetail,
        bundleCacheKey: legBundleCacheKey('shifted-tail', normalizedLegs, { offsetDays, stopOnUnpriced: false })
      })
    : { legs: [], attempts: [] };
  const result = {
    displayLegs,
    quoteLegs: quoted.legs,
    attempts: quoted.attempts
  };
  options.cache?.set(cacheKey, result);
  return result;
}

function quoteTotalForDisplayLegs(displayLegs, quoteLegs) {
  let total = 0;
  for (const displayLeg of displayLegs) {
    if (displayLeg.mode === 'bus') continue;
    const quote = quoteLegs.find((quotedLeg) => sameDisplayLeg(displayLeg, quotedLeg));
    if (!Number.isFinite(quote?.amount)) return null;
    total += quote.amount;
  }
  return roundMoney(total);
}

function sameDisplayLeg(displayLeg, quotedLeg) {
  return displayLeg.from === quotedLeg.from && displayLeg.to === quotedLeg.to && displayLeg.departOn === quotedLeg.departureDate;
}

async function quoteLeg(leg, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const providerState = options.providerState || createProviderState();
  const emitProviderDetail = shouldEmitDetailedProgress(options.progressDetail);
  const providers = isRussianDirection(leg)
    ? [
        ['aviasales', () => quoteLegWithTravelpayouts(leg)],
        ['yandex-rasp', () => quoteLegWithYandexRasp(leg)],
        ['serpapi', () => quoteLegWithSerpApi(leg)]
      ]
    : [
        ['serpapi', () => quoteLegWithSerpApi(leg)],
        ['aviasales', () => quoteLegWithTravelpayouts(leg)]
  ];
  const attempts = [];
  let bestNoPriceResult = null;
  const providerCache = getCachedFlightPrices(providers.map(([provider]) => legQuoteCacheKey(provider, leg)));

  for (const [provider, fn] of providers) {
    const disabledReason = providerDisabledReason(providerState, provider);
    if (!disabledReason && emitProviderDetail) {
      emitProgress(onProgress, 'provider-start', `Checking ${providerLabel(provider)} for ${routeLabel(leg)} on ${leg.departureDate}.`, {
        provider,
        route: routeLabel(leg),
        date: leg.departureDate,
        phase: options.phase,
        candidateRoute: options.candidateRoute || null,
        russianDirection: isRussianDirection(leg)
      });
    }
    const result = await tryCachedProvider(provider, leg, fn, {
      onProgress,
      skipNetworkReason: disabledReason,
      progressDetail: options.progressDetail,
      cachedQuote: providerCache.get(legQuoteCacheKey(provider, leg)) || null
    });
    attempts.push({
      ...result.summary,
      route: `${leg.origin}-${leg.destination}`,
      russianDirection: isRussianDirection(leg)
    });
    if (emitProviderDetail && (!result.summary.skipped || markProviderSkipLogged(providerState, provider))) {
      emitProgress(onProgress, providerProgressStep(result), providerProgressMessage(provider, leg, result), {
        provider,
        route: routeLabel(leg),
        date: leg.departureDate,
        amount: result.quote?.amount || null,
        cached: result.summary.cached === true,
        skipped: result.summary.skipped === true,
        error: result.summary.error || result.quote?.error || null,
        phase: options.phase,
        candidateRoute: options.candidateRoute || null
      });
    }
    if (!result.summary.ok && shouldDisableProvider(provider, result.summary.error) && disableProvider(providerState, provider, result.summary.error)) {
      setDisabledProviderReason(provider, result.summary.error, Date.now() + PROVIDER_DISABLE_CACHE_TTL_MS);
      emitProgress(onProgress, 'provider-disabled', `${providerLabel(provider)} will be skipped for the rest of this search: ${result.summary.error}.`, {
        provider,
        reason: result.summary.error
      });
    }
    if (result.quote) {
      if (Number.isFinite(result.quote.amount) || result.quote.schedule) {
        return { leg: result.quote, attempts };
      }
      bestNoPriceResult = result.quote;
    }
  }

  return {
    leg: bestNoPriceResult || { ...leg, amount: null, currency: 'USD', provider: null, error: 'No provider returned a price for this leg.' },
    attempts
  };
}

async function tryCachedProvider(provider, leg, fn, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const cacheKey = legQuoteCacheKey(provider, leg);
  const cachedQuote = options.cachedQuote || getCachedFlightPrice(cacheKey);
  if (cachedQuote) {
    if (shouldEmitDetailedProgress(options.progressDetail)) {
      emitProgress(onProgress, 'cache-hit', `Using SQLite cached ${providerLabel(provider)} result for ${routeLabel(leg)} on ${leg.departureDate}.`, {
        provider,
        route: routeLabel(leg),
        date: leg.departureDate
      });
    }
    return {
      quote: withNormalizedBaggage(cloneQuote(cachedQuote)),
      summary: { provider, ok: true, cached: true }
    };
  }

  if (options.skipNetworkReason) {
    return {
      quote: null,
      summary: { provider, ok: false, skipped: true, error: options.skipNetworkReason }
    };
  }

  const result = await tryProvider(provider, fn);
  if (result.quote) {
    result.quote = withNormalizedBaggage(result.quote);
    setCachedFlightPrice(cacheKey, provider, leg, cloneQuote(result.quote), Date.now() + LEG_QUOTE_CACHE_TTL_MS);
  }
  return result;
}

function legQuoteCacheKey(provider, leg) {
  return [provider, leg.origin, leg.destination, leg.departureDate, leg.passengers || 1, 'USD'].join('|');
}

function progressDetailLevel() {
  return PRICE_COMPARE_PROGRESS_DETAIL === 'verbose' ? 'verbose' : 'compact';
}

function shouldEmitDetailedProgress(progressDetail) {
  return progressDetail !== 'compact' && progressDetail !== 'silent';
}

function emitProgress(onProgress, step, message, details = {}) {
  onProgress({
    step,
    message,
    details,
    at: new Date().toISOString()
  });
}

function routeLabel(leg) {
  return `${leg.from} -> ${leg.to}`;
}

function providerProgressMessage(provider, leg, result) {
  const label = providerLabel(provider);
  if (result.summary.skipped) return `Skipping ${label} for ${routeLabel(leg)}: ${result.summary.error}.`;
  if (!result.summary.ok) return `${label} failed for ${routeLabel(leg)}: ${result.summary.error}.`;
  if (result.summary.cached) return `${label} SQLite cache hit for ${routeLabel(leg)}.`;
  if (Number.isFinite(result.quote?.amount)) return `${label} found ${routeLabel(leg)} for $${result.quote.amount.toLocaleString()} USD.`;
  if (result.quote?.schedule) return `${label} found schedule data for ${routeLabel(leg)}, but no USD fare.`;
  return `${label} returned no USD price for ${routeLabel(leg)}.`;
}

function providerProgressStep(result) {
  if (result.summary.skipped) return 'provider-skipped';
  return result.summary.ok ? 'provider-complete' : 'provider-failed';
}

function createProviderState() {
  return {
    disabledProviders: getDisabledProviderReasons(),
    loggedSkippedProviders: new Set()
  };
}

function providerDisabledReason(providerState, provider) {
  return providerState.disabledProviders.get(provider) || null;
}

function disableProvider(providerState, provider, reason) {
  if (providerState.disabledProviders.has(provider)) return false;
  providerState.disabledProviders.set(provider, reason);
  return true;
}

function markProviderSkipLogged(providerState, provider) {
  if (providerState.loggedSkippedProviders.has(provider)) return false;
  providerState.loggedSkippedProviders.add(provider);
  return true;
}

function shouldDisableProvider(provider, errorMessage = '') {
  if (!errorMessage) return false;
  if (provider === 'serpapi') {
    return /run out of searches|quota|rate limit|too many requests|429/i.test(errorMessage);
  }
  return /rate limit|too many requests|429/i.test(errorMessage);
}

function routeAnalysisCacheKey({ legs, requirements, passengers }) {
  return stableCacheKey('route-analysis', {
    version: 4,
    legs: legs.map(cacheableLeg),
    requirements,
    passengers,
    config: priceCacheConfig()
  });
}

function legBundleCacheKey(scope, legs, details = {}) {
  return stableCacheKey('leg-bundle', {
    version: 1,
    scope,
    legs: legs.map(cacheableLeg),
    details,
    config: {
      providerOrder: 'current',
      priceTtl: LEG_QUOTE_CACHE_TTL_MS,
      providers: priceCacheConfig().providers
    }
  });
}

function priceCacheConfig() {
  return {
    popularRouteSearchDays: POPULAR_ROUTE_SEARCH_DAYS,
    popularRouteDateFlexDays: POPULAR_ROUTE_DATE_FLEX_DAYS,
    popularRouteStayFlexDays: POPULAR_ROUTE_STAY_FLEX_DAYS,
    compareProgressDetail: PRICE_COMPARE_PROGRESS_DETAIL,
    routeIntelligenceLimit: process.env.PRICE_ROUTE_INTELLIGENCE_LIMIT || null,
    aviasalesSearchBaseUrl: AVIASALES_SEARCH_BASE_URL,
    travelpayoutsMarker: process.env.TRAVELPAYOUTS_MARKER || null,
    providers: {
      serpapi: Boolean(process.env.SERPAPI_KEY),
      aviasales: Boolean(process.env.TRAVELPAYOUTS_TOKEN),
      yandexRasp: Boolean(process.env.YANDEX_RASP_API_KEY)
    }
  };
}

function compactRouteOptions(options) {
  const completeKeys = new Set(options
    .filter((option) => Number.isFinite(option.totalAmount))
    .map(routeOptionCompactKey));
  const partialRouteCounts = new Map();
  const compacted = [];
  for (const option of options) {
    const key = routeOptionCompactKey(option);
    if (!Number.isFinite(option.totalAmount) && completeKeys.has(key)) continue;
    if (!Number.isFinite(option.totalAmount)) {
      const routeKey = option.route.join(' -> ');
      const count = partialRouteCounts.get(routeKey) || 0;
      if (count >= 2) continue;
      partialRouteCounts.set(routeKey, count + 1);
    }
    compacted.push(option);
  }
  return compacted.slice(0, 40);
}

function routeOptionCompactKey(option) {
  return [
    option.route.join(' -> '),
    option.departureDate,
    option.dateShiftDays || 0,
    option.stayFlexDays || 0,
    option.amount || ''
  ].join('|');
}

function normalizeQuote(provider, legs, attempts = []) {
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

function withNormalizedAirline(leg) {
  if (!leg || leg.mode === 'bus' || leg.airline || !leg.carrier) return leg;
  const airline = airlineInfoForCarrier(leg.carrier);
  return airline ? { ...leg, airline } : leg;
}

function normalizeLegs(legs, passengers = 1) {
  const passengerCount = normalizePassengerCount(passengers);
  return Array.isArray(legs)
    ? legs.map((leg) => ({
        from: leg.from,
        to: leg.to,
        mode: leg.mode || 'flight',
        origin: toIataCode(leg.from),
        destination: toIataCode(leg.to),
        departureDate: leg.departOn || leg.departureDate || leg.arriveBy,
        passengers: normalizePassengerCount(leg.passengers || passengerCount)
      })).filter((leg) => leg.mode !== 'bus')
    : [];
}

function normalizePassengerCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count)) return 1;
  return Math.min(9, Math.max(1, count));
}

function addHoursToDate(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function formatStayDays(days) {
  const rounded = Math.round(days * 10) / 10;
  return `${rounded} day${rounded === 1 ? '' : 's'}`;
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}
