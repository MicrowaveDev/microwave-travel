<script setup>
import { computed, ref, watch } from 'vue';

const cityOptions = [
  'Porto',
  'Doha',
  'Dubai',
  'Kaliningrad',
  'Moscow',
  'Saint Petersburg',
  'Lisbon',
  'Istanbul',
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
const TRIP_STATE_STORAGE_KEY = 'microwave-travel:trip-state:v1';
const initialTripState = loadTripState();
const origin = ref(initialTripState.origin);
const stops = ref(initialTripState.stops);
const startDate = ref(initialTripState.startDate);
const lockOrder = ref(initialTripState.lockOrder);
const passengers = ref(initialTripState.passengers);
const loading = ref(false);
const pricingLoading = ref(false);
const error = ref('');
const plan = ref(null);
const priceQuote = ref(null);
const priceProgress = ref([]);
const inputChangeLog = ref([]);
const copyLogStatus = ref('');
const logsCollapsed = ref(false);
const selectedTransferOptionIndex = ref(0);
const expandingTransferOptionKey = ref('');
const expandedTransferOptionQuotes = ref(new Map());
let optimizeDebounce = null;
let priceRequestId = 0;
let pricingAbortController = null;
let lastInputSnapshot = snapshotTripInput();

const routeLabel = computed(() => {
  if (!plan.value) return '';
  if (plan.value.legs?.length) {
    return [plan.value.legs[0].from, ...plan.value.legs.map((leg) => leg.to)].join(' -> ');
  }
  return [plan.value.origin, ...plan.value.stops, plan.value.returnsTo].join(' -> ');
});

const routeSegments = computed(() => plan.value?.legs || []);

const priceLabel = computed(() => {
  if (pricingLoading.value) return 'Loading';
  if (!priceQuote.value) return 'No price';
  if (activeTotalAmount.value) return `$${activeTotalAmount.value.toLocaleString()}`;
  if (priceQuote.value.pricedLegCount > 0) return 'Partial';
  return priceQuote.value.provider ? 'No price' : 'Needs key';
});

const currentPriceStatus = computed(() => {
  if (!pricingLoading.value) return priceQuote.value?.message || '';
  return priceProgress.value.at(-1)?.message || 'Preparing price search...';
});

const visiblePriceProgress = computed(() => priceProgress.value.slice(-8).reverse());
const transferRouteOptions = computed(() => priceQuote.value?.optimizedRouteOptions || []);
const transferSkippedOptions = computed(() => priceQuote.value?.optimizedRouteSkippedOptions || []);
const activeTransferOption = computed(() => transferRouteOptions.value[selectedTransferOptionIndex.value] || null);
const activePriceLegs = computed(() => activeTransferOption.value?.legs || priceQuote.value?.legs || []);
const activeTotalAmount = computed(() => activeTransferOption.value?.totalAmount || priceQuote.value?.totalAmount || null);
const providerAttemptBadges = computed(() => {
  const grouped = new Map();
  for (const attempt of priceQuote.value?.attempts || []) {
    const key = providerAttemptKey(attempt);
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      grouped.set(key, {
        key,
        provider: attempt.provider,
        label: providerAttemptLabel(attempt),
        failed: !attempt.ok,
        count: 1
      });
    }
  }
  return [...grouped.values()];
});

function createStop(city = 'Doha', visitBefore = '', stayDays = 0) {
  return {
    id: crypto.randomUUID(),
    city,
    visitBefore,
    stayDays
  };
}

function defaultTripState() {
  return {
    origin: 'Porto',
    stops: [
      createStop('Doha', '', 1),
      createStop('Dubai', '2026-06-01', 2),
      createStop('Kaliningrad', '', 2),
      createStop('Moscow', '', 2),
      createStop('Dubai', '', 2),
      createStop('Doha', '', 1)
    ],
    startDate: '2026-05-20',
    passengers: 1,
    lockOrder: false
  };
}

function loadTripState() {
  try {
    const stored = JSON.parse(localStorage.getItem(TRIP_STATE_STORAGE_KEY) || 'null');
    if (!stored || typeof stored !== 'object') return defaultTripState();
    const storedStops = Array.isArray(stored.stops) ? stored.stops.map(normalizeStoredStop).filter(Boolean) : [];
    return {
      origin: typeof stored.origin === 'string' && stored.origin.trim() ? stored.origin : 'Porto',
      stops: storedStops.length ? storedStops : defaultTripState().stops,
      startDate: typeof stored.startDate === 'string' && stored.startDate ? stored.startDate : '2026-05-20',
      passengers: normalizePassengerCountInput(stored.passengers),
      lockOrder: stored.lockOrder === true
    };
  } catch {
    return defaultTripState();
  }
}

function normalizeStoredStop(stop) {
  if (!stop || typeof stop !== 'object') return null;
  const city = typeof stop.city === 'string' && stop.city.trim() ? stop.city : 'Doha';
  const visitBefore = typeof stop.visitBefore === 'string'
    ? stop.visitBefore
    : stop.rule === 'before' && typeof stop.date === 'string'
      ? stop.date
      : '';
  return {
    ...createStop(city, visitBefore, normalizeStayDaysInput(stop.stayDays)),
    id: typeof stop.id === 'string' && stop.id ? stop.id : crypto.randomUUID()
  };
}

function normalizeStayDaysInput(value) {
  const days = Number(value);
  return Number.isFinite(days) && days >= 0 ? Math.round(days * 10) / 10 : 0;
}

function normalizePassengerCountInput(value) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 1 && count <= 9 ? count : 1;
}

function saveTripState() {
  localStorage.setItem(TRIP_STATE_STORAGE_KEY, JSON.stringify({
    origin: origin.value,
    stops: stops.value.map((stop) => ({
      id: stop.id,
      city: stop.city,
      visitBefore: stop.visitBefore,
      stayDays: normalizeStayDaysInput(stop.stayDays)
    })),
    startDate: startDate.value,
    passengers: normalizePassengerCountInput(passengers.value),
    lockOrder: lockOrder.value
  }));
}

function addStop() {
  stops.value.push(createStop());
}

function showCityOptions(event) {
  event.currentTarget?.showPicker?.();
}

function removeStop(id) {
  if (stops.value.length === 1) return;
  stops.value = stops.value.filter((stop) => stop.id !== id);
  scheduleOptimize();
}

function moveStop(index, direction) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= stops.value.length) return;
  const nextStops = [...stops.value];
  [nextStops[index], nextStops[nextIndex]] = [nextStops[nextIndex], nextStops[index]];
  stops.value = nextStops;
  lockOrder.value = true;
  scheduleOptimize();
}

function snapshotTripInput() {
  return {
    origin: origin.value,
    startDate: startDate.value,
    passengers: normalizePassengerCountInput(passengers.value),
    lockOrder: lockOrder.value,
    stops: stops.value.map((stop, index) => ({
      id: stop.id,
      index,
      city: stop.city,
      visitBefore: stop.visitBefore,
      stayDays: stop.stayDays
    }))
  };
}

function trackTripInputChanges() {
  const nextSnapshot = snapshotTripInput();
  for (const change of describeTripInputChanges(lastInputSnapshot, nextSnapshot)) {
    appendInputChange(change);
  }
  lastInputSnapshot = nextSnapshot;
}

function describeTripInputChanges(previous, next) {
  const changes = [];
  if (!previous) return changes;

  if (previous.origin !== next.origin) {
    changes.push(`Start/return city changed from ${previous.origin || 'empty'} to ${next.origin || 'empty'}.`);
  }
  if (previous.startDate !== next.startDate) {
    changes.push(`Trip start changed from ${previous.startDate || 'empty'} to ${next.startDate || 'empty'}.`);
  }
  if (previous.passengers !== next.passengers) {
    changes.push(`Passengers changed from ${previous.passengers || 1} to ${next.passengers || 1}.`);
  }
  if (previous.lockOrder !== next.lockOrder) {
    changes.push(`Lock-order setting changed to ${next.lockOrder ? 'enabled' : 'disabled'}.`);
  }

  const previousById = new Map(previous.stops.map((stop) => [stop.id, stop]));
  const nextById = new Map(next.stops.map((stop) => [stop.id, stop]));

  for (const stop of next.stops) {
    const before = previousById.get(stop.id);
    if (!before) {
      changes.push(`Stop ${stop.index + 1} added: ${formatStopForLog(stop)}.`);
      continue;
    }
    if (before.index !== stop.index) {
      changes.push(`${formatStopLabel(stop)} moved from row ${before.index + 1} to row ${stop.index + 1}.`);
    }
    if (before.city !== stop.city) {
      changes.push(`Stop ${stop.index + 1} city changed from ${before.city || 'empty'} to ${stop.city || 'empty'}.`);
    }
    if (before.visitBefore !== stop.visitBefore) {
      changes.push(`${formatStopLabel(stop)} visit-before date changed from ${before.visitBefore || 'empty'} to ${stop.visitBefore || 'empty'}.`);
    }
    if (before.stayDays !== stop.stayDays) {
      changes.push(`${formatStopLabel(stop)} days-to-spend changed from ${before.stayDays || 0} to ${stop.stayDays || 0}.`);
    }
  }

  for (const stop of previous.stops) {
    if (!nextById.has(stop.id)) {
      changes.push(`Stop ${stop.index + 1} removed: ${formatStopForLog(stop)}.`);
    }
  }

  return changes;
}

function appendInputChange(message) {
  inputChangeLog.value = [
    ...inputChangeLog.value,
    {
      at: new Date().toISOString(),
      message,
      stops: stops.value.map((stop) => ({
        city: stop.city,
        visitBefore: stop.visitBefore,
        stayDays: stop.stayDays
      }))
    }
  ];
}

function formatStopLabel(stop) {
  return `Stop ${stop.index + 1} (${stop.city || 'empty'})`;
}

function formatStopForLog(stop) {
  const visitBefore = stop.visitBefore ? `, visit before ${stop.visitBefore}` : '';
  return `${stop.city || 'empty'}${visitBefore}, spend ${stop.stayDays || 0} day${Number(stop.stayDays) === 1 ? '' : 's'}`;
}

function buildRequirements() {
  return stops.value
    .filter((stop) => stop.visitBefore)
    .map((stop) => ({
      city: stop.city,
      type: 'before',
      date: stop.visitBefore
    }));
}

async function optimize() {
  clearTimeout(optimizeDebounce);
  loading.value = true;
  error.value = '';
  priceQuote.value = null;
  priceProgress.value = [];
  selectedTransferOptionIndex.value = 0;
  copyLogStatus.value = '';

  try {
    const response = await fetch('/api/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: origin.value,
        stops: stops.value.map((stop) => stop.city),
        stopDetails: stops.value.map((stop) => ({
          city: stop.city,
          stayDays: Number(stop.stayDays) || 0
        })),
        requirements: buildRequirements(),
        startDate: startDate.value,
        lockOrder: lockOrder.value
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Could not optimize this trip.');
    plan.value = payload;
    fetchPrices(payload);
  } catch (caught) {
    error.value = caught.message;
  } finally {
    loading.value = false;
  }
}

function scheduleOptimize() {
  clearTimeout(optimizeDebounce);
  priceQuote.value = null;
  priceProgress.value = [];
  expandedTransferOptionQuotes.value = new Map();
  expandingTransferOptionKey.value = '';
  copyLogStatus.value = '';
  logsCollapsed.value = false;
  optimizeDebounce = setTimeout(() => {
    optimize();
  }, 350);
}

async function fetchPrices(routePlan = plan.value) {
  if (!routePlan?.legs?.length) return;

  if (pricingAbortController) pricingAbortController.abort();
  const requestId = ++priceRequestId;
  pricingAbortController = new AbortController();
  pricingLoading.value = true;
  priceProgress.value = [
    {
      step: 'queued',
      message: 'Preparing route price search...',
      at: new Date().toISOString()
    }
  ];
  try {
    const response = await fetch('/api/prices/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        legs: routePlan.legs,
        requirements: routePlan.requirements || buildRequirements(),
        passengers: normalizePassengerCountInput(passengers.value)
      }),
      signal: pricingAbortController.signal
    });
    if (!response.ok) throw new Error('Could not fetch flight prices.');
    const payload = await readPriceStream(response, requestId);
    if (requestId !== priceRequestId || !payload) return;
    priceQuote.value = payload;
    selectedTransferOptionIndex.value = 0;
    if (payload.optimization && payload.optimizedRouteOptions?.length) {
      applyTransferOption(0, routePlan);
    } else if (payload.optimizedRouteLegs?.length) {
      applyRouteLegs(payload.optimizedRouteLegs, routePlan);
    }
  } catch (caught) {
    if (caught.name === 'AbortError') return;
    priceQuote.value = {
      provider: null,
      currency: 'USD',
      totalAmount: null,
      legs: [],
      attempts: [{ provider: 'pricing', ok: false, error: caught.message }],
      message: caught.message
    };
  } finally {
    if (requestId === priceRequestId) {
      pricingLoading.value = false;
      pricingAbortController = null;
    }
  }
}

async function readPriceStream(response, requestId) {
  if (!response.body) return response.json();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalQuote = null;

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim() || requestId !== priceRequestId) continue;
      const event = JSON.parse(line);
      if (event.type === 'progress') {
        appendPriceProgress(event.event);
        applyPriceProgressPreview(event.event);
      } else if (event.type === 'result') {
        finalQuote = event.quote;
      } else if (event.type === 'error') {
        throw new Error(event.error || 'Could not fetch flight prices.');
      }
    }

    if (done) break;
  }

  return finalQuote;
}

function appendPriceProgress(event) {
  priceProgress.value = [...priceProgress.value, event];
}

function applyPriceProgressPreview(event) {
  const details = event?.details || {};
  if (details.previewQuote) {
    priceQuote.value = details.previewQuote;
    selectedTransferOptionIndex.value = 0;
    if (details.previewQuote.optimizedRouteLegs?.length) {
      applyRouteLegs(details.previewQuote.optimizedRouteLegs);
    }
    return;
  }

  if (!details.previewOption?.routeLegs?.length) return;
  const option = details.previewOption;
  priceQuote.value = {
    provider: 'mixed',
    currency: 'USD',
    totalAmount: option.totalAmount,
    pricedLegCount: option.pricedLegCount,
    legCount: option.legCount,
    message: `Current best transfer: ${option.route.join(' -> ')} on ${option.departureDate}.`,
    legs: option.legs || [],
    attempts: priceQuote.value?.attempts || [],
    optimizedRouteOptions: [option],
    optimizedRouteSkippedOptions: priceQuote.value?.optimizedRouteSkippedOptions || []
  };
  selectedTransferOptionIndex.value = 0;
  applyRouteLegs(option.routeLegs);
}

function providerAttemptKey(attempt) {
  return [
    attempt.provider || 'provider',
    attempt.ok ? 'ok' : 'failed',
    attempt.cached ? 'cached' : 'live',
    attempt.skipped ? 'skipped' : 'attempted',
    attempt.error || ''
  ].join('|');
}

function providerAttemptLabel(attempt) {
  if (attempt.ok) return `${attempt.provider} ${attempt.cached ? 'cached' : 'ready'}`;
  if (attempt.skipped) return `${attempt.provider} skipped`;
  return `${attempt.provider} ${attempt.error || 'failed'}`;
}

function selectTransferOption(index) {
  const option = transferRouteOptions.value[index];
  if (!option) return;
  selectedTransferOptionIndex.value = index;
  applyTransferOption(index);
  expandPartialTransferOption(option, index);
}

function applyTransferOption(index, basePlan = plan.value) {
  const option = transferRouteOptions.value[index];
  if (!option?.routeLegs?.length) return;
  applyRouteLegs(option.routeLegs, basePlan);
}

function applyRouteLegs(legs, basePlan = plan.value) {
  if (!basePlan) return;
  plan.value = {
    ...basePlan,
    legs,
    totalHours: Math.round(legs.reduce((sum, leg) => sum + leg.hours, 0) * 10) / 10,
    totalDistanceKm: Math.round(legs.reduce((sum, leg) => sum + leg.distanceKm, 0))
  };
}

function transferOptionKey(option) {
  if (!option) return 'no-option';
  return [
    option.route?.join('-') || 'route',
    option.departureDate || 'date',
    option.dateShiftDays || 0,
    option.stayFlexDays || 0,
    option.amount ?? 'partial',
    option.totalAmount ?? 'partial-trip'
  ].join('|');
}

function transferOptionLabel(option) {
  return option.route.join(' -> ');
}

function transferOptionAmount(option) {
  if (expandingTransferOptionKey.value === transferOptionKey(option)) return 'Completing...';
  const expandedQuote = expandedTransferOptionQuotes.value.get(transferOptionKey(option));
  if (Number.isFinite(expandedQuote?.totalAmount)) return `$${expandedQuote.totalAmount.toLocaleString()}`;
  return typeof option.amount === 'number' ? `$${option.amount.toLocaleString()}` : 'Partial';
}

function transferOptionDate(option) {
  const shift = Number(option.dateShiftDays) || 0;
  const stayFlex = Number(option.stayFlexDays) || 0;
  const flex = [
    shift ? `${shift > 0 ? '+' : ''}${shift}d date` : null,
    stayFlex ? `+${stayFlex}d stay` : null
  ].filter(Boolean).join(', ');
  return `${option.departureDate}${flex ? ` (${flex})` : ''}`;
}

function transferSkipReason(option) {
  if (option.message) return option.message;
  if (option.reason === 'stay-time') return 'Does not preserve required stay time.';
  if (option.reason === 'stay-time-window') return 'Later dates cannot preserve required stay time.';
  if (option.reason === 'missing-price') return 'Not enough priced legs to compare.';
  return 'Skipped during pricing.';
}

function sameTransferWithoutStayFlex(left, right) {
  return Boolean(left && right) &&
    left.route?.join(' -> ') === right.route?.join(' -> ') &&
    left.departureDate === right.departureDate &&
    (Number(left.dateShiftDays) || 0) === (Number(right.dateShiftDays) || 0) &&
    left.amount === right.amount;
}

function stayFlexOptionsForLeg(leg) {
  const active = activeTransferOption.value;
  if (!active?.route?.length || active.route.at(-1) !== leg.to) return [];
  const options = transferRouteOptions.value
    .filter((option) => sameTransferWithoutStayFlex(option, active))
    .sort((left, right) => (Number(left.stayFlexDays) || 0) - (Number(right.stayFlexDays) || 0));
  return options.length > 1 ? options : [];
}

function stayFlexOptionLabel(option, leg) {
  const activeStayFlex = Number(activeTransferOption.value?.stayFlexDays) || 0;
  const optionStayFlex = Number(option.stayFlexDays) || 0;
  const baseDays = (Number(leg.stayDaysAfter) || 0) - activeStayFlex;
  const optionDays = Math.round((baseDays + optionStayFlex) * 10) / 10;
  const dayText = `${optionDays} day${optionDays === 1 ? '' : 's'}`;
  if (optionStayFlex === 0) return `${dayText} in ${leg.to}`;
  return `+${optionStayFlex}d: ${dayText} in ${leg.to}`;
}

function stayFlexOptionAmount(option) {
  if (expandingTransferOptionKey.value === transferOptionKey(option)) return 'Completing trip...';
  const expandedQuote = expandedTransferOptionQuotes.value.get(transferOptionKey(option));
  if (Number.isFinite(expandedQuote?.totalAmount)) return `$${expandedQuote.totalAmount.toLocaleString()} trip`;
  if (Number.isFinite(option.totalAmount)) return `$${option.totalAmount.toLocaleString()} trip`;
  if (Number.isFinite(option.amount)) return `Partial trip · $${option.amount.toLocaleString()} transfer`;
  return 'Partial trip';
}

function selectStayFlexOption(option) {
  const index = transferRouteOptions.value.findIndex((candidate) => transferOptionKey(candidate) === transferOptionKey(option));
  if (index >= 0) selectTransferOption(index);
}

async function expandPartialTransferOption(option, index) {
  const key = transferOptionKey(option);
  if (Number.isFinite(option.totalAmount) || expandedTransferOptionQuotes.value.has(key) || expandingTransferOptionKey.value === key) return;
  expandingTransferOptionKey.value = key;
  try {
    const response = await fetch('/api/prices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        legs: option.routeLegs,
        requirements: plan.value?.requirements || buildRequirements(),
        passengers: normalizePassengerCountInput(passengers.value),
        exactRouteOnly: true
      })
    });
    if (!response.ok) throw new Error('Could not complete this route option.');
    const quote = await response.json();
    const expandedOption = {
      ...option,
      totalAmount: quote.totalAmount,
      pricedLegCount: quote.pricedLegCount,
      legCount: quote.legCount,
      routeLegs: quote.optimizedRouteLegs || option.routeLegs,
      legs: quote.legs || option.legs || []
    };
    const nextOptions = transferRouteOptions.value.slice();
    nextOptions[index] = expandedOption;
    priceQuote.value = {
      ...priceQuote.value,
      optimizedRouteOptions: nextOptions
    };
    expandedTransferOptionQuotes.value = new Map(expandedTransferOptionQuotes.value).set(key, quote);
    if (selectedTransferOptionIndex.value === index) applyTransferOption(index);
  } catch (caught) {
    appendPriceProgress({
      step: 'option-expand-failed',
      message: caught.message || 'Could not complete this route option.',
      at: new Date().toISOString(),
      details: { route: option.route, departureDate: option.departureDate, stayFlexDays: option.stayFlexDays || 0 }
    });
  } finally {
    if (expandingTransferOptionKey.value === key) expandingTransferOptionKey.value = '';
  }
}

async function copyPricingLog() {
  const text = buildPricingLog();
  try {
    await navigator.clipboard.writeText(text);
    copyLogStatus.value = 'Copied';
  } catch {
    copyLogWithFallback(text);
    copyLogStatus.value = 'Copied';
  }
  setTimeout(() => {
    copyLogStatus.value = '';
  }, 1800);
}

function buildPricingLog() {
  const routePlan = plan.value;
  const quote = priceQuote.value;
  const lines = [
    'Microwave Travel price-search log',
    `Generated: ${new Date().toISOString()}`,
    '',
    'Goal for agent:',
    'Analyze this route-search log and suggest how to reduce API requests, improve candidate ordering, caching, batching, or route/date selection without missing cheaper routes.',
    '',
    'Trip input:',
    `Origin/return: ${origin.value}`,
    `Stops: ${stops.value.map((stop) => `${stop.city} (${Number(stop.stayDays) || 0}d)`).join(' -> ')}`,
    `Visit-before dates: ${buildRequirements().map((item) => `${item.city} before ${item.date}`).join('; ') || 'none'}`,
    `Start date: ${startDate.value}`,
    `Passengers: ${normalizePassengerCountInput(passengers.value)}`,
    `Lock order: ${lockOrder.value ? 'yes' : 'no'}`,
    '',
    `Input change events (${inputChangeLog.value.length}):`,
    ...(inputChangeLog.value.length
      ? inputChangeLog.value.map((event, index) => `${index + 1}. [${event.at}] ${event.message} | stops now: ${event.stops.map(formatStopSnapshot).join(' -> ')}`)
      : ['No user input changes recorded since page load.']),
    '',
    'Current displayed route:',
    routePlan?.legs?.length
      ? routePlan.legs.map((leg, index) => `${index + 1}. ${leg.from} -> ${leg.to} | ${leg.mode} | depart ${leg.departOn} | arrive ${leg.arriveBy} | ${leg.hours}h | ${leg.distanceKm} km`).join('\n')
      : 'No route plan available.',
    '',
    'Price result:',
    quote
      ? JSON.stringify({
          totalAmount: quote.totalAmount,
          currency: quote.currency,
          pricedLegCount: quote.pricedLegCount,
          legCount: quote.legCount,
          message: quote.message,
          optimization: quote.optimization || null,
          optimizedRouteOptions: (quote.optimizedRouteOptions || []).map((option) => ({
            route: option.route,
            departureDate: option.departureDate,
            dateShiftDays: option.dateShiftDays || 0,
            stayFlexDays: option.stayFlexDays || 0,
            amount: option.amount,
            totalAmount: option.totalAmount,
            pricedLegCount: option.pricedLegCount,
            legCount: option.legCount
          })),
          optimizedRouteSkippedOptions: (quote.optimizedRouteSkippedOptions || []).map((option) => ({
            route: option.route,
            departureDate: option.departureDate,
            reason: option.reason,
            message: option.message,
            details: option.details
          }))
        }, null, 2)
      : 'Pricing is still running or no quote is available.',
    '',
    `Progress events (${priceProgress.value.length}):`,
    ...priceProgress.value.map(formatProgressEvent),
    '',
    `Provider attempts (${quote?.attempts?.length || 0}):`,
    ...(quote?.attempts || []).map((attempt, index) => `${index + 1}. ${JSON.stringify(attempt)}`),
    '',
    `Priced legs (${quote?.legs?.length || 0}):`,
    ...(quote?.legs || []).map((leg, index) => `${index + 1}. ${JSON.stringify(leg)}`)
  ];

  return lines.join('\n');
}

function formatProgressEvent(event, index) {
  const details = event.details ? ` | ${JSON.stringify(event.details)}` : '';
  return `${index + 1}. [${event.at || 'no-time'}] ${event.step}: ${event.message}${details}`;
}

function formatStopSnapshot(stop) {
  const visitBefore = stop.visitBefore ? `, before ${stop.visitBefore}` : '';
  return `${stop.city || 'empty'} (${stop.stayDays || 0}d${visitBefore})`;
}

function copyLogWithFallback(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.append(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function legPrice(index) {
  const price = activePriceLeg(index)?.amount;
  return typeof price === 'number' ? `$${price.toLocaleString()}` : null;
}

function legProvider(index) {
  return activePriceLeg(index)?.provider || null;
}

function legAirline(index) {
  const pricedLeg = activePriceLeg(index);
  if (!pricedLeg?.airline && !pricedLeg?.carrier) return null;
  const label = pricedLeg.airline?.code
    ? `${pricedLeg.airline.name} (${pricedLeg.airline.code})`
    : pricedLeg.airline?.name || pricedLeg.carrier;
  return {
    label,
    website: pricedLeg.airline?.website || null
  };
}

function legBaggage(index) {
  const baggage = activePriceLeg(index)?.baggageAllowance;
  return baggage?.summary || null;
}

function legBooking(index) {
  const leg = plan.value?.legs?.[index];
  const pricedLeg = activePriceLegs.value.find((candidate) =>
    candidate.from === leg?.from &&
    candidate.to === leg?.to &&
    candidate.departureDate === leg?.departOn &&
    (candidate.bookingGroupUrl || candidate.bookingUrl)
  );
  if (!pricedLeg) return null;
  if (pricedLeg.bookingGroupUrl) {
    return {
      bookingUrl: pricedLeg.bookingGroupUrl,
      bookingLabel: pricedLeg.bookingGroupLabel,
      bookingNote: pricedLeg.bookingGroupNote
    };
  }
  return activePriceLegs.value.find((pricedLeg) =>
    pricedLeg.from === leg?.from &&
    pricedLeg.to === leg?.to &&
    pricedLeg.departureDate === leg?.departOn &&
    pricedLeg.bookingUrl
  ) || null;
}

function legPriceError(index) {
  const leg = plan.value?.legs?.[index];
  if (leg?.mode === 'bus') return 'Ground transfer: check bus ticket and border requirements separately.';
  return activePriceLeg(index)?.error || null;
}

function activePriceLeg(index) {
  const leg = plan.value?.legs?.[index];
  if (!leg) return null;
  return activePriceLegs.value.find((pricedLeg) =>
    pricedLeg.from === leg.from &&
    pricedLeg.to === leg.to &&
    pricedLeg.departureDate === leg.departOn
  ) || activePriceLegs.value.find((pricedLeg) =>
    pricedLeg.from === leg.from &&
    pricedLeg.to === leg.to
  ) || null;
}

watch(
  [origin, stops, startDate, passengers, lockOrder],
  () => {
    trackTripInputChanges();
    saveTripState();
    scheduleOptimize();
  },
  { deep: true }
);

optimize();
</script>

<template>
  <main class="app-shell">
    <section class="planner-panel" aria-label="Trip requirements">
      <div>
        <p class="eyebrow">Microwave Travel</p>
        <h1>Route planner</h1>
      </div>

      <label>
        Start and return city
        <input v-model="origin" list="city-options" type="search" autocomplete="off" @click="showCityOptions" @focus="showCityOptions" />
      </label>

      <div class="route-editor">
        <div class="route-header">
          <span>Move</span>
          <span>Stops</span>
          <span>Visit before</span>
          <span>Days</span>
          <span></span>
        </div>

        <div v-for="(stop, index) in stops" :key="stop.id" class="stop-row">
          <div class="move-buttons">
            <button type="button" :disabled="index === 0" :aria-label="`Move ${stop.city || `stop ${index + 1}`} up`" @click="moveStop(index, -1)">
              ↑
            </button>
            <button type="button" :disabled="index === stops.length - 1" :aria-label="`Move ${stop.city || `stop ${index + 1}`} down`" @click="moveStop(index, 1)">
              ↓
            </button>
          </div>
          <input v-model="stop.city" :aria-label="`Stop ${index + 1} city`" list="city-options" type="search" autocomplete="off" @click="showCityOptions" @focus="showCityOptions" />

          <input v-model="stop.visitBefore" :aria-label="`Stop ${index + 1} visit before date`" type="date" />
          <input v-model.number="stop.stayDays" :aria-label="`Stop ${index + 1} days to spend`" min="0" step="0.5" type="number" />

          <button class="icon-button" type="button" :disabled="stops.length === 1" @click="removeStop(stop.id)">
            x
          </button>
        </div>

        <button class="secondary-button" type="button" @click="addStop">Add stop</button>
      </div>

      <datalist id="city-options">
        <option v-for="city in cityOptions" :key="city" :value="city"></option>
      </datalist>

      <div class="field-row">
        <label>
          Trip start
          <input v-model="startDate" type="date" />
        </label>
        <label>
          Passengers
          <input v-model.number="passengers" min="1" max="9" step="1" type="number" />
        </label>
      </div>

      <label class="check-row">
        <input v-model="lockOrder" type="checkbox" />
        Keep the stops in the order I typed
      </label>

      <button type="button" :disabled="loading" @click="optimize">
        {{ loading ? 'Optimizing...' : 'Optimize route' }}
      </button>

      <p v-if="error" class="error">{{ error }}</p>
    </section>

    <section class="results-panel" aria-label="Optimized itinerary">
      <div v-if="plan" class="summary-strip">
        <div>
          <span>Score</span>
          <strong>{{ plan.score }}</strong>
        </div>
        <div>
          <span>Travel time</span>
          <strong>{{ plan.totalHours }}h</strong>
        </div>
        <div>
          <span>Distance</span>
          <strong>{{ plan.totalDistanceKm.toLocaleString() }} km</strong>
        </div>
        <div>
          <span>Price</span>
          <strong>{{ priceLabel }}</strong>
        </div>
      </div>

      <div v-if="plan" class="route-map">
        <div v-if="routeSegments.length" class="route-segments" :aria-label="routeLabel">
          <template v-for="(leg, index) in routeSegments" :key="`${leg.from}-${leg.to}-${index}`">
            <span class="route-city">{{ leg.from }}</span>
            <span class="route-time">
              <span>{{ leg.hours }}h</span>
            </span>
            <span v-if="index === routeSegments.length - 1" class="route-city">{{ leg.to }}</span>
          </template>
        </div>
        <p v-else>{{ routeLabel }}</p>
      </div>

      <div v-if="priceQuote || pricingLoading" class="price-panel">
        <div class="price-panel-header">
          <div>
            <span>{{ pricingLoading ? 'Live pricing' : 'Pricing result' }}</span>
            <p>{{ currentPriceStatus }}</p>
          </div>
          <div class="price-actions">
            <strong v-if="pricingLoading">{{ priceProgress.length }} steps</strong>
            <button class="copy-log-button" type="button" :disabled="!priceProgress.length" @click="logsCollapsed = !logsCollapsed">
              {{ logsCollapsed ? 'Show logs' : 'Collapse logs' }}
            </button>
            <button class="copy-log-button" type="button" :disabled="!priceProgress.length" @click="copyPricingLog">
              {{ copyLogStatus || 'Copy log' }}
            </button>
          </div>
        </div>
        <div v-if="!logsCollapsed" class="price-log-details">
          <ul v-if="visiblePriceProgress.length" class="price-progress">
            <li v-for="(event, index) in visiblePriceProgress" :key="`${event.at}-${event.step}-${index}`">
              <span>{{ event.step.replaceAll('-', ' ') }}</span>
              <p>{{ event.message }}</p>
            </li>
          </ul>
          <div v-if="providerAttemptBadges.length" class="provider-attempts">
            <span v-for="badge in providerAttemptBadges" :key="badge.key" :class="{ failed: badge.failed }">
              {{ badge.label }}<small v-if="badge.count > 1">×{{ badge.count }}</small>
            </span>
          </div>
        </div>
      </div>

      <div v-if="plan?.warnings.length" class="warning-list">
        <p v-for="warning in plan.warnings" :key="warning">{{ warning }}</p>
      </div>

      <div v-if="transferRouteOptions.length" class="transfer-options" aria-label="Transfer route options">
        <button
          v-for="(option, index) in transferRouteOptions"
          :key="transferOptionKey(option)"
          type="button"
          :class="{ active: selectedTransferOptionIndex === index }"
          @click="selectTransferOption(index)"
        >
          <span>{{ transferOptionLabel(option) }}</span>
          <strong>{{ transferOptionAmount(option) }}</strong>
          <small>Transfer · {{ transferOptionDate(option) }}</small>
        </button>
      </div>
      <details v-if="transferSkippedOptions.length" class="transfer-skipped-details">
        <summary>Skipped transfer searches ({{ transferSkippedOptions.length }})</summary>
        <ul>
          <li
            v-for="option in transferSkippedOptions"
            :key="`skipped-${option.route.join('-')}-${option.departureDate}-${option.reason}`"
          >
            <strong>{{ transferOptionLabel(option) }}</strong>
            <span>{{ option.departureDate }}</span>
            <p>{{ transferSkipReason(option) }}</p>
          </li>
        </ul>
      </details>

      <div v-if="plan" class="legs">
        <template v-for="(leg, index) in plan.legs" :key="`${leg.from}-${leg.to}-${index}`">
          <article class="leg-card">
            <div class="leg-index">{{ index + 1 }}</div>
            <div>
              <h2>{{ leg.from }} to {{ leg.to }}</h2>
              <p>
                {{ leg.departOn }} · {{ leg.mode }} · {{ leg.hours }}h · {{ leg.distanceKm.toLocaleString() }} km · arrive by
                {{ leg.arriveBy }}
              </p>
              <p v-if="legPrice(index)" class="leg-price">
                {{ legPrice(index) }} USD<span v-if="legProvider(index)"> via {{ legProvider(index) }}</span>
              </p>
              <p v-else-if="legPriceError(index)" class="leg-price-missing">{{ legPriceError(index) }}</p>
              <p v-if="legAirline(index)" class="leg-airline">
                Airline:
                <a
                  v-if="legAirline(index).website"
                  :href="legAirline(index).website"
                  target="_blank"
                  rel="noreferrer"
                >
                  {{ legAirline(index).label }}
                </a>
                <span v-else>{{ legAirline(index).label }}</span>
              </p>
              <p v-if="legBaggage(index)" class="leg-baggage">Bags: {{ legBaggage(index) }}</p>
              <a
                v-if="legBooking(index)"
                class="booking-link"
                :href="legBooking(index).bookingUrl"
                target="_blank"
                rel="noreferrer"
                :title="legBooking(index).bookingNote"
              >
                {{ legBooking(index).bookingLabel }}
              </a>
              <small>{{ leg.note }} Reliability {{ Math.round(leg.reliability * 100) }}%.</small>
            </div>
          </article>
          <div v-if="leg.stayHoursAfter" class="stay-separator">
            <span>Stay {{ leg.stayDaysAfter }} day{{ leg.stayDaysAfter === 1 ? '' : 's' }} in {{ leg.to }}</span>
            <div v-if="stayFlexOptionsForLeg(leg).length" class="stay-options" :aria-label="`${leg.to} stay options`">
              <button
                v-for="option in stayFlexOptionsForLeg(leg)"
                :key="`stay-${transferOptionKey(option)}`"
                type="button"
                :class="{ active: transferOptionKey(option) === transferOptionKey(activeTransferOption) }"
                @click="selectStayFlexOption(option)"
              >
                <span>{{ stayFlexOptionLabel(option, leg) }}</span>
                <strong>{{ stayFlexOptionAmount(option) }}</strong>
              </button>
            </div>
          </div>
        </template>
      </div>
    </section>
  </main>
</template>
