<script setup>
import { computed, ref } from 'vue';

const origin = ref('Porto');
const stopsText = ref('Doha, Dubai, Kaliningrad, Moscow, Dubai, Doha');
const requirementsText = ref('Dubai before 1 June');
const startDate = ref('2026-05-20');
const lockOrder = ref(false);
const loading = ref(false);
const error = ref('');
const plan = ref(null);

const routeLabel = computed(() => {
  if (!plan.value) return '';
  return [plan.value.origin, ...plan.value.stops, plan.value.returnsTo].join(' -> ');
});

async function optimize() {
  loading.value = true;
  error.value = '';

  try {
    const response = await fetch('/api/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: origin.value,
        stopsText: stopsText.value,
        requirementsText: requirementsText.value,
        startDate: startDate.value,
        lockOrder: lockOrder.value
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Could not optimize this trip.');
    plan.value = payload;
  } catch (caught) {
    error.value = caught.message;
  } finally {
    loading.value = false;
  }
}

optimize();
</script>

<template>
  <main class="app-shell">
    <section class="planner-panel" aria-label="Trip requirements">
      <div>
        <p class="eyebrow">Microwave Travel</p>
        <h1>Route planner for messy multi-city trips</h1>
      </div>

      <label>
        Start and return city
        <input v-model="origin" type="text" autocomplete="off" />
      </label>

      <label>
        Stops
        <textarea v-model="stopsText" rows="5" />
      </label>

      <div class="field-row">
        <label>
          Trip start
          <input v-model="startDate" type="date" />
        </label>
        <label>
          Requirement
          <input v-model="requirementsText" type="text" autocomplete="off" />
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
      </div>

      <div v-if="plan" class="route-map">
        <p>{{ routeLabel }}</p>
      </div>

      <div v-if="plan?.warnings.length" class="warning-list">
        <p v-for="warning in plan.warnings" :key="warning">{{ warning }}</p>
      </div>

      <ol v-if="plan" class="legs">
        <li v-for="(leg, index) in plan.legs" :key="`${leg.from}-${leg.to}-${index}`">
          <div class="leg-index">{{ index + 1 }}</div>
          <div>
            <h2>{{ leg.from }} to {{ leg.to }}</h2>
            <p>{{ leg.hours }}h · {{ leg.distanceKm.toLocaleString() }} km · arrive by {{ leg.arriveBy }}</p>
            <small>{{ leg.note }} Reliability {{ Math.round(leg.reliability * 100) }}%.</small>
          </div>
        </li>
      </ol>
    </section>
  </main>
</template>
