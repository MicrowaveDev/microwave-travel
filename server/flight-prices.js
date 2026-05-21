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
  setCachedFlightPrice
} from './flight-price-cache.js';

const CITY_IATA_CODES = new Map([
  ['porto', 'OPO'],
  ['doha', 'DOH'],
  ['dubai', 'DXB'],
  ['gdansk', 'GDN'],
  ['lisbon', 'LIS'],
  ['istanbul', 'IST'],
  ['belgrade', 'BEG'],
  ['warsaw', 'WAW'],
  ['madrid', 'MAD'],
  ['barcelona', 'BCN'],
  ['milan', 'MIL'],
  ['rome', 'ROM'],
  ['paris', 'PAR'],
  ['frankfurt', 'FRA'],
  ['athens', 'ATH'],
  ['vienna', 'VIE'],
  ['zurich', 'ZRH'],
  ['amsterdam', 'AMS'],
  ['kaliningrad', 'KGD'],
  ['moscow', 'MOW'],
  ['moskow', 'MOW']
]);

const RUSSIAN_CITY_NAMES = new Set(['Kaliningrad', 'Moscow']);
const RUSSIAN_IATA_CODES = new Set(['KGD', 'MOW', 'SVO', 'DME', 'VKO']);
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
const LEG_QUOTE_CACHE_TTL_MS = 60 * 60 * 1000;
const AVIASALES_SEARCH_BASE_URL = process.env.AVIASALES_SEARCH_BASE_URL || 'https://search.aviasales.com/flights/';
let amadeusTokenCache = null;

export async function quoteFlightPrices(input, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const providerState = createProviderState();
  const legs = normalizeLegs(input.legs);
  if (legs.length === 0) {
    throw new Error('Optimize a route before fetching prices.');
  }

  emitProgress(onProgress, 'pricing-start', `Pricing ${legs.length} flight leg${legs.length === 1 ? '' : 's'} in USD.`, {
    legCount: legs.length
  });
  const quoted = await quoteNormalizedLegs(legs, { onProgress, phase: 'Current route', providerState });
  const quote = normalizeQuote('mixed', quoted.legs, quoted.attempts);
  const optimized = await optimizePopularTransferRoute(input.legs, quote, { onProgress, providerState });
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
  const quotedLegs = [];
  const attempts = [];

  for (const [index, leg] of legs.entries()) {
    emitProgress(onProgress, 'leg-start', `${options.phase || 'Pricing'}: ${leg.from} to ${leg.to} on ${leg.departureDate}.`, {
      phase: options.phase,
      legIndex: index + 1,
      legCount: legs.length,
      route: routeLabel(leg),
      date: leg.departureDate,
      candidateRoute: options.candidateRoute || null
    });
    const result = await quoteLeg(leg, {
      onProgress,
      phase: options.phase,
      candidateRoute: options.candidateRoute,
      providerState
    });
    quotedLegs.push(result.leg);
    attempts.push(...result.attempts);
    if (options.stopOnUnpriced && !Number.isFinite(result.leg?.amount)) {
      emitProgress(onProgress, 'candidate-pruned', `Stopping ${options.candidateRoute || 'candidate'} early because ${routeLabel(leg)} has no comparable USD price.`, {
        route: routeLabel(leg),
        date: leg.departureDate,
        candidateRoute: options.candidateRoute || null,
        reason: result.leg?.error || 'No comparable USD price.'
      });
      break;
    }
  }

  return { legs: quotedLegs, attempts };
}

async function optimizePopularTransferRoute(originalLegs, initialQuote, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const providerState = options.providerState || createProviderState();
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
  const routes = popularTransferRoutes(direction);
  const dateChoices = popularRouteDateChoices(
    currentSuffix[0].departOn,
    startIndex,
    POPULAR_ROUTE_SEARCH_DAYS,
    POPULAR_ROUTE_DATE_FLEX_DAYS
  );
  const tailQuoteCache = new Map();

  emitProgress(onProgress, 'compare-start', `Comparing ${routes.length} ${direction.from} to ${direction.to} route options across ${dateChoices.length} dates.`, {
    from: direction.from,
    to: direction.to,
    routeCount: routes.length,
    dateCount: dateChoices.length,
    currentAmount: currentSuffixQuote
  });

  for (const route of routes) {
    for (const { date: departureDate, offsetDays } of dateChoices) {
      const candidateLabel = route.join(' -> ');
      emitProgress(onProgress, 'candidate-start', `Trying ${candidateLabel} on ${departureDate}${formatDateShift(offsetDays)}.`, {
        route,
        date: departureDate,
        offsetDays
      });
      const candidateDisplayLegs = buildLegsForRoute(route, departureDate);
      const candidateNormalizedLegs = normalizeLegs(candidateDisplayLegs);
      const candidateQuoted = await quoteNormalizedLegs(candidateNormalizedLegs, {
        onProgress,
        phase: 'Compare option',
        candidateRoute: candidateLabel,
        providerState,
        stopOnUnpriced: true
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
        emitProgress(onProgress, 'candidate-skip', `${candidateLabel} on ${departureDate}: not enough priced legs to compare.`, {
          route,
          date: departureDate,
          pricedLegCount: candidateQuote.pricedLegCount,
          legCount: candidateQuote.legCount,
          offsetDays
        });
        continue;
      }

      const tailQuote = await quoteShiftedTailForDateOffset(offsetDays, originalLegs.slice(endIndex), {
        cache: tailQuoteCache,
        onProgress,
        providerState,
        candidateRoute: candidateLabel
      });

      const candidate = {
        route,
        departureDate,
        offsetDays,
        displayLegs: candidateDisplayLegs,
        quote: candidateQuote,
        tailDisplayLegs: tailQuote.displayLegs,
        tailQuoteLegs: tailQuote.quoteLegs,
        tailAttempts: tailQuote.attempts
      };
      comparableCandidates.push(candidate);
      if (!best || candidateQuote.totalAmount < best.quote.totalAmount) {
        best = candidate;
        emitProgress(onProgress, 'candidate-best', `${candidateLabel} on ${departureDate}${formatDateShift(offsetDays)} is the current best at $${candidateQuote.totalAmount.toLocaleString()} USD.`, {
          route,
          date: departureDate,
          totalAmount: candidateQuote.totalAmount,
          offsetDays
        });
      } else {
        emitProgress(onProgress, 'candidate-result', `${candidateLabel} on ${departureDate}${formatDateShift(offsetDays)}: $${candidateQuote.totalAmount.toLocaleString()} USD.`, {
          route,
          date: departureDate,
          totalAmount: candidateQuote.totalAmount,
          offsetDays
        });
      }
    }
  }

  const rankedCandidates = [...comparableCandidates]
    .sort((left, right) => left.quote.totalAmount - right.quote.totalAmount)
    .map((candidate) => buildOptimizedRouteOption({
      candidate,
      currentSuffix,
      prefixDisplayLegs: originalLegs.slice(0, startIndex),
      tailDisplayLegs: candidate.tailDisplayLegs,
      prefixQuoteLegs: initialQuote.legs.filter((quotedLeg) =>
        originalLegs.slice(0, startIndex).some((displayLeg) => sameDisplayLeg(displayLeg, quotedLeg))
      ),
      tailQuoteLegs: candidate.tailQuoteLegs
    }));

  if (!best || (Number.isFinite(currentSuffixQuote) && best.quote.totalAmount >= currentSuffixQuote)) {
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
    ...copyStayToReplacement(currentSuffix, best.displayLegs),
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
    previousReturnAmount: currentSuffixQuote,
    selectedReturnAmount: best.quote.totalAmount
  };
  combinedQuote.message = `${combinedQuote.message} ${combinedQuote.transferSearchMessage}`;
  emitProgress(onProgress, 'compare-complete', `Selected ${best.route.join(' -> ')} on ${best.departureDate}${formatDateShift(best.offsetDays)} at $${best.quote.totalAmount.toLocaleString()} USD.`, {
    selectedRoute: best.route,
    date: best.departureDate,
    offsetDays: best.offsetDays,
    previousAmount: currentSuffixQuote,
    selectedAmount: best.quote.totalAmount
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
    ...copyStayToReplacement(currentSuffix, candidate.displayLegs),
    ...tailDisplayLegs
  ];
  const quoteLegs = [...prefixQuoteLegs, ...candidate.quote.legs, ...tailQuoteLegs];
  const quote = normalizeQuote('mixed', quoteLegs, []);
  return {
    route: candidate.route,
    departureDate: candidate.departureDate,
    dateShiftDays: candidate.offsetDays || 0,
    amount: candidate.quote.totalAmount,
    totalAmount: quote.totalAmount,
    pricedLegCount: quote.pricedLegCount,
    legCount: quote.legCount,
    routeLegs,
    legs: quoteLegs
  };
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

function copyStayToReplacement(replacedLegs, replacementLegs) {
  const staySource = replacedLegs.at(-1);
  if (!staySource?.stayHoursAfter || replacementLegs.length === 0) return replacementLegs;
  return replacementLegs.map((leg, index) => index === replacementLegs.length - 1
    ? {
        ...leg,
        stayHoursAfter: staySource.stayHoursAfter,
        stayDaysAfter: staySource.stayDaysAfter
      }
    : leg
  );
}

async function recoverMissingPortoReturnLeg(quote, displayLegs, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const providerState = options.providerState || createProviderState();
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
  for (const route of routes) {
    const candidateLabel = route.join(' -> ');
    emitProgress(onProgress, 'candidate-start', `Trying fallback ${candidateLabel} on ${missingLeg.departureDate}.`, {
      route,
      date: missingLeg.departureDate,
      fallbackFor: routeLabel(missingLeg)
    });
    const candidateDisplayLegs = buildLegsForRoute(route, missingLeg.departureDate);
    const candidateQuoted = await quoteNormalizedLegs(normalizeLegs(candidateDisplayLegs), {
      onProgress,
      phase: 'Fallback option',
      candidateRoute: candidateLabel,
      providerState,
      stopOnUnpriced: true
    });
    const candidateQuote = normalizeQuote('mixed', candidateQuoted.legs, candidateQuoted.attempts);
    if (!Number.isFinite(candidateQuote.totalAmount)) {
      emitProgress(onProgress, 'candidate-skip', `${candidateLabel}: not enough priced legs to replace ${routeLabel(missingLeg)}.`, {
        route,
        date: missingLeg.departureDate,
        pricedLegCount: candidateQuote.pricedLegCount,
        legCount: candidateQuote.legCount,
        fallbackFor: routeLabel(missingLeg)
      });
      continue;
    }

    if (!best || candidateQuote.totalAmount < best.quote.totalAmount) {
      best = { route, displayLegs: candidateDisplayLegs, quote: candidateQuote };
      emitProgress(onProgress, 'candidate-best', `${candidateLabel} is the current best fallback at $${candidateQuote.totalAmount.toLocaleString()} USD.`, {
        route,
        date: missingLeg.departureDate,
        totalAmount: candidateQuote.totalAmount,
        fallbackFor: routeLabel(missingLeg)
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
  const normalizedLegs = normalizeLegs(displayLegs);
  const quoted = normalizedLegs.length
    ? await quoteNormalizedLegs(normalizedLegs, {
        onProgress: options.onProgress,
        phase: offsetDays === 0 ? 'Compare tail' : 'Date-flex tail',
        candidateRoute: options.candidateRoute,
        providerState: options.providerState,
        stopOnUnpriced: false
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

async function tryProvider(name, fn) {
  try {
    return {
      quote: await fn(),
      summary: { provider: name, ok: true }
    };
  } catch (error) {
    return {
      quote: null,
      summary: { provider: name, ok: false, error: error.message }
    };
  }
}

async function quoteWithAmadeus(legs) {
  assertEnv('AMADEUS_CLIENT_ID');
  assertEnv('AMADEUS_CLIENT_SECRET');

  const token = await getAmadeusToken();
  const pricedLegs = [];

  for (const leg of legs) {
    const params = new URLSearchParams({
      originLocationCode: leg.origin,
      destinationLocationCode: leg.destination,
      departureDate: leg.departureDate,
      adults: '1',
      currencyCode: 'USD',
      max: '1'
    });
    const response = await fetch(`${amadeusBaseUrl()}/v2/shopping/flight-offers?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      }
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(providerError(payload, `Amadeus failed for ${leg.origin}-${leg.destination}`));
    }

    const offer = payload.data?.[0];
    pricedLegs.push({
      ...leg,
      amount: offer ? Number(offer.price?.grandTotal || offer.price?.total) : null,
      currency: offer?.price?.currency || 'USD',
      providerOfferId: offer?.id || null,
      carrier: offer?.validatingAirlineCodes?.[0] || null
    });
  }

  return normalizeQuote('amadeus', pricedLegs);
}

async function quoteWithSerpApi(legs) {
  assertEnv('SERPAPI_KEY');

  const pricedLegs = [];

  for (const leg of legs) {
    const params = new URLSearchParams({
      engine: 'google_flights',
      type: '2',
      departure_id: leg.origin,
      arrival_id: leg.destination,
      outbound_date: leg.departureDate,
      currency: 'USD',
      adults: '1',
      sort_by: '2',
      api_key: process.env.SERPAPI_KEY
    });
    const response = await fetch(`https://serpapi.com/search?${params}`);
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.error || `SerpApi failed for ${leg.origin}-${leg.destination}`);
    }
    if (payload.error) {
      pricedLegs.push({
        ...leg,
        amount: null,
        currency: 'USD',
        providerOfferId: payload.search_metadata?.id || null,
        carrier: null,
        error: payload.error
      });
      continue;
    }

    const offer = payload.best_flights?.[0] || payload.other_flights?.[0] || payload.flights?.[0];
    pricedLegs.push({
      ...leg,
      amount: typeof offer?.price === 'number' ? offer.price : null,
      currency: 'USD',
      providerOfferId: payload.search_metadata?.id || null,
      carrier: offer?.flights?.[0]?.airline || null,
      error: offer ? null : 'No flights found for this leg.'
    });
  }

  return normalizeQuote('serpapi', pricedLegs);
}

async function quoteLeg(leg, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const providerState = options.providerState || createProviderState();
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

  for (const [provider, fn] of providers) {
    const disabledReason = providerDisabledReason(providerState, provider);
    if (!disabledReason) {
      emitProgress(onProgress, 'provider-start', `Checking ${providerLabel(provider)} for ${routeLabel(leg)} on ${leg.departureDate}.`, {
        provider,
        route: routeLabel(leg),
        date: leg.departureDate,
        phase: options.phase,
        candidateRoute: options.candidateRoute || null,
        russianDirection: isRussianDirection(leg)
      });
    }
    const result = await tryCachedProvider(provider, leg, fn, { onProgress, skipNetworkReason: disabledReason });
    attempts.push({
      ...result.summary,
      route: `${leg.origin}-${leg.destination}`,
      russianDirection: isRussianDirection(leg)
    });
    if (!result.summary.skipped || markProviderSkipLogged(providerState, provider)) {
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
  const cachedQuote = getCachedFlightPrice(cacheKey);
  if (cachedQuote) {
    emitProgress(onProgress, 'cache-hit', `Using SQLite cached ${providerLabel(provider)} result for ${routeLabel(leg)} on ${leg.departureDate}.`, {
      provider,
      route: routeLabel(leg),
      date: leg.departureDate
    });
    return {
      quote: cloneQuote(cachedQuote),
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
    setCachedFlightPrice(cacheKey, provider, leg, cloneQuote(result.quote), Date.now() + LEG_QUOTE_CACHE_TTL_MS);
  }
  return result;
}

function legQuoteCacheKey(provider, leg) {
  return [provider, leg.origin, leg.destination, leg.departureDate, '1', 'USD'].join('|');
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
    disabledProviders: new Map(),
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

function cloneQuote(quote) {
  return quote ? JSON.parse(JSON.stringify(quote)) : null;
}

async function quoteLegWithSerpApi(leg) {
  assertEnv('SERPAPI_KEY');

  const params = new URLSearchParams({
    engine: 'google_flights',
    type: '2',
    departure_id: leg.origin,
    arrival_id: leg.destination,
    outbound_date: leg.departureDate,
    currency: 'USD',
    adults: '1',
    sort_by: '2',
    api_key: process.env.SERPAPI_KEY
  });
  const response = await fetch(`https://serpapi.com/search?${params}`);
  const payload = await readJson(response);
  if (!response.ok || payload.error) {
    throw new Error(payload.error || `SerpApi failed for ${leg.origin}-${leg.destination}`);
  }

  const offer = payload.best_flights?.[0] || payload.other_flights?.[0] || payload.flights?.[0];
  return {
    ...leg,
    amount: typeof offer?.price === 'number' ? offer.price : null,
    currency: 'USD',
    provider: 'serpapi',
    providerOfferId: payload.search_metadata?.id || null,
    carrier: offer?.flights?.[0]?.airline || null,
    error: offer ? null : 'No flights found for this leg.'
  };
}

async function quoteLegWithTravelpayouts(leg) {
  assertEnv('TRAVELPAYOUTS_TOKEN');

  const params = new URLSearchParams({
    origin: leg.origin,
    destination: leg.destination,
    departure_at: leg.departureDate,
    currency: 'usd',
    market: 'ru',
    one_way: 'true',
    direct: 'false',
    sorting: 'price',
    limit: '1',
    token: process.env.TRAVELPAYOUTS_TOKEN
  });
  const response = await fetch(`https://api.travelpayouts.com/aviasales/v3/prices_for_dates?${params}`);
  const payload = await readJson(response);
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || `Aviasales failed for ${leg.origin}-${leg.destination}`);
  }

  const offer = payload.data?.[0];
  return {
    ...leg,
    amount: Number.isFinite(offer?.price) ? offer.price : null,
    currency: (offer?.currency || 'USD').toUpperCase(),
    provider: 'aviasales',
    providerOfferId: offer?.search_id || offer?.signature || null,
    carrier: offer?.airline || null,
    error: offer ? null : 'Aviasales did not return cached prices for this leg.'
  };
}

async function quoteLegWithYandexRasp(leg) {
  assertEnv('YANDEX_RASP_API_KEY');

  const params = new URLSearchParams({
    apikey: process.env.YANDEX_RASP_API_KEY,
    format: 'json',
    from: leg.origin,
    to: leg.destination,
    system: 'iata',
    show_systems: 'iata',
    lang: 'en_US',
    date: leg.departureDate,
    transport_types: 'plane,train,bus',
    transfers: 'true',
    limit: '5'
  });
  const response = await fetch(`https://api.rasp.yandex-net.ru/v3.0/search/?${params}`);
  const payload = await readJson(response);
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.text || payload.error || `Yandex Rasp failed for ${leg.origin}-${leg.destination}`);
  }

  const segment = [...(payload.segments || []), ...(payload.interval_segments || [])].find(Boolean);
  if (!segment) {
    return { ...leg, amount: null, currency: 'USD', provider: 'yandex-rasp', error: 'Yandex Rasp did not return schedule options for this leg.' };
  }
  const place = segment.tickets_info?.places?.find((item) => item.price?.whole);
  return {
    ...leg,
    amount: null,
    currency: 'USD',
    provider: 'yandex-rasp',
    providerOfferId: segment.thread?.uid || null,
    carrier: segment.thread?.carrier?.title || null,
    schedule: {
      transportType: segment.thread?.transport_type || segment.from?.transport_type || null,
      departure: segment.departure || null,
      arrival: segment.arrival || null,
      durationSeconds: segment.duration || null,
      rubPrice: place?.price?.whole || null
    },
    error: place?.price?.whole
      ? `Yandex Rasp found a ${place.price.whole} RUB fare; USD conversion is not connected yet.`
      : 'Yandex Rasp found schedule options, but no USD price.'
  };
}

async function getAmadeusToken() {
  if (amadeusTokenCache && amadeusTokenCache.expiresAt > Date.now() + 30_000) {
    return amadeusTokenCache.token;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.AMADEUS_CLIENT_ID,
    client_secret: process.env.AMADEUS_CLIENT_SECRET
  });
  const response = await fetch(`${amadeusBaseUrl()}/v1/security/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(providerError(payload, 'Amadeus authentication failed'));
  }

  amadeusTokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + Number(payload.expires_in || 0) * 1000
  };
  return amadeusTokenCache.token;
}

function normalizeQuote(provider, legs, attempts = []) {
  const priced = legs.filter((leg) => Number.isFinite(leg.amount));
  const activeProviders = [...new Set(legs.map((leg) => leg.provider).filter(Boolean))];
  return {
    provider,
    currency: 'USD',
    totalAmount: priced.length === legs.length ? roundMoney(priced.reduce((sum, leg) => sum + leg.amount, 0)) : null,
    pricedLegCount: priced.length,
    legCount: legs.length,
    legs: legs.map((leg) => addBookingLink({
      ...leg,
      amount: Number.isFinite(leg.amount) ? roundMoney(leg.amount) : null
    })),
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

function addBookingLink(leg) {
  if (leg.mode === 'bus' || !leg.origin || !leg.destination || !leg.departureDate) return leg;
  const url = buildAviasalesSearchUrl(leg);
  if (!url) return leg;
  const hasAffiliateMarker = Boolean(process.env.TRAVELPAYOUTS_MARKER);
  return {
    ...leg,
    bookingUrl: url,
    bookingProvider: 'aviasales',
    bookingLabel: hasAffiliateMarker ? 'Affiliate search link' : 'Search booking options',
    bookingNote: hasAffiliateMarker
      ? 'Affiliate link; final checkout price may differ.'
      : 'Search link; compare final checkout price before booking.'
  };
}

function buildAviasalesSearchUrl(leg) {
  try {
    const url = new URL(AVIASALES_SEARCH_BASE_URL);
    url.search = new URLSearchParams({
      origin_iata: leg.origin,
      destination_iata: leg.destination,
      depart_date: leg.departureDate,
      oneway: '1',
      adults: '1',
      children: '0',
      infants: '0',
      trip_class: '0',
      currency: 'USD',
      locale: 'en',
      ...(process.env.TRAVELPAYOUTS_MARKER ? { marker: process.env.TRAVELPAYOUTS_MARKER } : {})
    }).toString();
    return url.toString();
  } catch {
    return null;
  }
}

function configuredProviders() {
  return [
    process.env.SERPAPI_KEY ? 'serpapi' : null,
    process.env.TRAVELPAYOUTS_TOKEN ? 'aviasales' : null,
    process.env.YANDEX_RASP_API_KEY ? 'yandex-rasp' : null,
    process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET ? 'amadeus' : null
  ].filter(Boolean);
}

function providerLabel(provider) {
  return provider
    .split(', ')
    .map((name) => {
      if (name === 'serpapi') return 'SerpApi Google Flights';
      if (name === 'aviasales') return 'Aviasales';
      if (name === 'yandex-rasp') return 'Yandex Rasp';
      if (name === 'amadeus') return 'Amadeus';
      return name;
    })
    .join(', ');
}

function normalizeLegs(legs) {
  return Array.isArray(legs)
    ? legs.map((leg) => ({
        from: leg.from,
        to: leg.to,
        mode: leg.mode || 'flight',
        origin: toIataCode(leg.from),
        destination: toIataCode(leg.to),
        departureDate: leg.departOn || leg.departureDate || leg.arriveBy
      })).filter((leg) => leg.mode !== 'bus')
    : [];
}

function isRussianDirection(leg) {
  return (
    RUSSIAN_CITY_NAMES.has(leg.from) ||
    RUSSIAN_CITY_NAMES.has(leg.to) ||
    RUSSIAN_IATA_CODES.has(leg.origin) ||
    RUSSIAN_IATA_CODES.has(leg.destination)
  );
}

function toIataCode(city) {
  const value = String(city || '').trim();
  if (/^[A-Z]{3}$/.test(value)) return value;
  const code = CITY_IATA_CODES.get(value.toLowerCase());
  if (!code) {
    throw new Error(`No IATA code configured for ${value}. Use a 3-letter airport/city code for pricing.`);
  }
  return code;
}

function amadeusBaseUrl() {
  return process.env.AMADEUS_BASE_URL || 'https://test.api.amadeus.com';
}

function assertEnv(name) {
  if (!process.env[name]) {
    throw new Error(`${name} is not configured`);
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function providerError(payload, fallback) {
  return payload.errors?.[0]?.detail || payload.error_description || payload.error || fallback;
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
