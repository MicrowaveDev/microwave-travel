<script setup>
import { computed, ref, watch } from 'vue';

const cityOptions = ['Porto', 'Doha', 'Dubai', 'Kaliningrad', 'Moscow'];
const requirementOptions = [
  { value: '', label: 'No date rule' },
  { value: 'before', label: 'Arrive before' },
  { value: 'after', label: 'Arrive after' }
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
let optimizeDebounce = null;

const routeLabel = computed(() => {
  if (!plan.value) return '';
  return [plan.value.origin, ...plan.value.stops, plan.value.returnsTo].join(' -> ');
});

const priceLabel = computed(() => {
  if (pricingLoading.value) return 'Loading';
  if (!priceQuote.value) return 'No price';
  if (priceQuote.value.totalAmount) return `$${priceQuote.value.totalAmount.toLocaleString()}`;
  if (priceQuote.value.pricedLegCount > 0) return 'Partial';
  return priceQuote.value.provider ? 'No price' : 'Needs key';
});

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
  optimizeDebounce = setTimeout(() => {
    optimize();
  }, 350);
}

async function fetchPrices(routePlan = plan.value) {
  if (!routePlan?.legs?.length) return;

  pricingLoading.value = true;
  try {
    const response = await fetch('/api/prices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legs: routePlan.legs })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Could not fetch flight prices.');
    priceQuote.value = payload;
  } catch (caught) {
    priceQuote.value = {
      provider: null,
      currency: 'USD',
      totalAmount: null,
      legs: [],
      attempts: [{ provider: 'pricing', ok: false, error: caught.message }],
      message: caught.message
    };
  } finally {
    pricingLoading.value = false;
  }
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
        <p v-if="pricingLoading">Fetching USD flight prices...</p>
        <p v-else>{{ priceQuote.message }}</p>
        <div v-if="priceQuote?.attempts?.length" class="provider-attempts">
          <span v-for="attempt in priceQuote.attempts" :key="attempt.provider" :class="{ failed: !attempt.ok }">
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
