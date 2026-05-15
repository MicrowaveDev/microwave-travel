<script setup>
import { computed, ref, watch } from 'vue';

const cityOptions = [
  'Porto',
  'Doha',
  'Dubai',
  'Kaliningrad',
  'Moscow',
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
const requirementOptions = [
  { value: '', label: 'No date rule' },
  { value: 'before', label: 'Visit before' },
  { value: 'after', label: 'Visit after' }
];

const origin = ref('Porto');
const stops = ref([
  createStop('Doha'),
  createStop('Dubai', 'before', '2026-06-01'),
  createStop('Kaliningrad'),
  createStop('Moscow'),
  createStop('Dubai'),
  createStop('Doha')
]);
const startDate = ref('2026-05-20');
const lockOrder = ref(false);
const loading = ref(false);
const pricingLoading = ref(false);
const error = ref('');
const plan = ref(null);
const priceQuote = ref(null);
const priceProgress = ref([]);
const copyLogStatus = ref('');
let optimizeDebounce = null;
let priceRequestId = 0;
let pricingAbortController = null;

const routeLabel = computed(() => {
  if (!plan.value) return '';
  if (plan.value.legs?.length) {
    return [plan.value.legs[0].from, ...plan.value.legs.map((leg) => leg.to)].join(' -> ');
  }
  return [plan.value.origin, ...plan.value.stops, plan.value.returnsTo].join(' -> ');
});

const priceLabel = computed(() => {
  if (pricingLoading.value) return 'Loading';
  if (!priceQuote.value) return 'No price';
  if (priceQuote.value.totalAmount) return `$${priceQuote.value.totalAmount.toLocaleString()}`;
  if (priceQuote.value.pricedLegCount > 0) return 'Partial';
  return priceQuote.value.provider ? 'No price' : 'Needs key';
});

const currentPriceStatus = computed(() => {
  if (!pricingLoading.value) return priceQuote.value?.message || '';
  return priceProgress.value.at(-1)?.message || 'Preparing price search...';
});

const visiblePriceProgress = computed(() => priceProgress.value.slice(-8).reverse());

function createStop(city = 'Doha', rule = '', date = '') {
  return {
    id: crypto.randomUUID(),
    city,
    rule,
    date
  };
}

function addStop() {
  stops.value.push(createStop());
}

function removeStop(id) {
  if (stops.value.length === 1) return;
  stops.value = stops.value.filter((stop) => stop.id !== id);
  scheduleOptimize();
}

function buildRequirements() {
  return stops.value
    .filter((stop) => stop.rule && stop.date)
    .map((stop) => ({
      city: stop.city,
      type: stop.rule,
      date: stop.date
    }));
}

async function optimize() {
  clearTimeout(optimizeDebounce);
  loading.value = true;
  error.value = '';
  priceQuote.value = null;
  priceProgress.value = [];
  copyLogStatus.value = '';

  try {
    const response = await fetch('/api/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: origin.value,
        stops: stops.value.map((stop) => stop.city),
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
  copyLogStatus.value = '';
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
      body: JSON.stringify({ legs: routePlan.legs }),
      signal: pricingAbortController.signal
    });
    if (!response.ok) throw new Error('Could not fetch flight prices.');
    const payload = await readPriceStream(response, requestId);
    if (requestId !== priceRequestId || !payload) return;
    priceQuote.value = payload;
    if (payload.optimizedRouteLegs?.length) {
      plan.value = {
        ...routePlan,
        legs: payload.optimizedRouteLegs,
        totalHours: Math.round(payload.optimizedRouteLegs.reduce((sum, leg) => sum + leg.hours, 0) * 10) / 10,
        totalDistanceKm: Math.round(payload.optimizedRouteLegs.reduce((sum, leg) => sum + leg.distanceKm, 0))
      };
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
    `Stops: ${stops.value.map((stop) => stop.city).join(' -> ')}`,
    `Requirements: ${buildRequirements().map((item) => `${item.city} ${item.type} ${item.date}`).join('; ') || 'none'}`,
    `Start date: ${startDate.value}`,
    `Lock order: ${lockOrder.value ? 'yes' : 'no'}`,
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
          optimization: quote.optimization || null
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
  const leg = plan.value?.legs?.[index];
  const price = priceQuote.value?.legs?.find((pricedLeg) => pricedLeg.from === leg?.from && pricedLeg.to === leg?.to)?.amount;
  return typeof price === 'number' ? `$${price.toLocaleString()}` : null;
}

function legProvider(index) {
  const leg = plan.value?.legs?.[index];
  return priceQuote.value?.legs?.find((pricedLeg) => pricedLeg.from === leg?.from && pricedLeg.to === leg?.to)?.provider || null;
}

function legPriceError(index) {
  const leg = plan.value?.legs?.[index];
  if (leg?.mode === 'bus') return 'Ground transfer: check bus ticket and border requirements separately.';
  return priceQuote.value?.legs?.find((pricedLeg) => pricedLeg.from === leg?.from && pricedLeg.to === leg?.to)?.error || null;
}

watch(
  [origin, stops, startDate, lockOrder],
  () => {
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
        <input v-model="origin" list="city-options" type="search" autocomplete="off" />
      </label>

      <div class="route-editor">
        <div class="route-header">
          <span>Stops</span>
          <span>Requirement</span>
          <span>Date</span>
          <span></span>
        </div>

        <div v-for="(stop, index) in stops" :key="stop.id" class="stop-row">
          <span class="stop-number">{{ index + 1 }}</span>
          <input v-model="stop.city" :aria-label="`Stop ${index + 1} city`" list="city-options" type="search" autocomplete="off" />

          <select v-model="stop.rule" :aria-label="`Stop ${index + 1} requirement`">
            <option v-for="option in requirementOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>

          <input v-model="stop.date" :aria-label="`Stop ${index + 1} requirement date`" :disabled="!stop.rule" type="date" />

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
        <p>{{ routeLabel }}</p>
      </div>

      <div v-if="priceQuote || pricingLoading" class="price-panel">
        <div class="price-panel-header">
          <div>
            <span>{{ pricingLoading ? 'Live pricing' : 'Pricing result' }}</span>
            <p>{{ currentPriceStatus }}</p>
          </div>
          <div class="price-actions">
            <strong v-if="pricingLoading">{{ priceProgress.length }} steps</strong>
            <button class="copy-log-button" type="button" :disabled="!priceProgress.length" @click="copyPricingLog">
              {{ copyLogStatus || 'Copy log' }}
            </button>
          </div>
        </div>
        <ul v-if="visiblePriceProgress.length" class="price-progress">
          <li v-for="(event, index) in visiblePriceProgress" :key="`${event.at}-${event.step}-${index}`">
            <span>{{ event.step.replaceAll('-', ' ') }}</span>
            <p>{{ event.message }}</p>
          </li>
        </ul>
        <div v-if="priceQuote?.attempts?.length" class="provider-attempts">
          <span v-for="(attempt, index) in priceQuote.attempts" :key="`${attempt.provider}-${attempt.route}-${index}`" :class="{ failed: !attempt.ok }">
            {{ attempt.provider }} {{ attempt.ok ? (attempt.cached ? 'cached' : 'ready') : attempt.error }}
          </span>
        </div>
      </div>

      <div v-if="plan?.warnings.length" class="warning-list">
        <p v-for="warning in plan.warnings" :key="warning">{{ warning }}</p>
      </div>

      <ol v-if="plan" class="legs">
        <li v-for="(leg, index) in plan.legs" :key="`${leg.from}-${leg.to}-${index}`">
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
            <small>{{ leg.note }} Reliability {{ Math.round(leg.reliability * 100) }}%.</small>
          </div>
        </li>
      </ol>
    </section>
  </main>
</template>
